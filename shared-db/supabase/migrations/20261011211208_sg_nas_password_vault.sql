-- =====================================================================================
-- Issue #4168 - PopSG NAS password: move out of plaintext admin_config into Supabase
-- Vault, readable only server-side (PopDAM u2giants/popdam3#194, browser exposure
-- already removed in popdam3 PR #313).
-- Claim #4181 reserves version 20261011211208 and exactly two objects:
--
--   function public.get_sg_nas_password()        (new)
--   function public.set_sg_nas_password(text)    (new)
--
-- derived-from: none
--
-- WHAT IT DOES
-- ---------------------------------------------------------------------------------
-- 1. Vault secret name 'popdam_sg_nas_password' becomes the single store for the
--    PopSG NAS password used by the Windows render agent.
-- 2. get_sg_nas_password() returns it ('' when unset); set_sg_nas_password(text)
--    creates or replaces it ('' or null clears it). Both are SECURITY DEFINER and
--    executable by service_role only (admin-api and agent-api edge functions).
--    Authenticated and anon clients cannot call them; vault.secrets is encrypted at
--    rest and not exposed through PostgREST.
-- 3. The current admin_config value (key WINDOWS_AGENT_SG_NAS_PASS) is copied into
--    Vault inside this migration; the value never leaves the database and is never
--    printed. The admin_config row is intentionally KEPT by this migration so the
--    currently deployed app keeps working; it is removed after popdam3 cuts over to
--    these functions (issue #4168 step 3, an application row cleanup).
--
-- Preconditions are asserted up front (named errors, not raw failures): the
-- supabase_vault extension and the vault objects this file calls, and that neither
-- new function exists yet. vault.secrets carries a unique index on name
-- (secrets_name_idx, asserted below), so at most one row can hold the name; two
-- concurrent first writes cannot both succeed (the loser gets a unique violation and
-- its admin save fails visibly). No advisory lock is used.
-- Vault signatures are pinned to the installed supabase_vault 0.3.1 forms
-- create_secret(text,text,text,uuid) and update_secret(uuid,text,text,text,uuid)
-- (observed on production 2026-10-11); the calls below use their leading arguments
-- and defaults. A different Vault version stops the migration with a named error.
--
-- When the source admin_config row holds a string: if no Vault secret of that name
-- exists, it is created from the source; if one exists, it is never overwritten and
-- must already equal the source or the migration fails. Either way the value is
-- verified: if the source row holds a string, the migration
-- fails unless Vault then holds exactly that value.
--
-- Accepted, stated for the record: get_sg_nas_password reads one named row through
-- the extension's vault.decrypted_secrets view (Vault holds a handful of rows); the
-- copy block is exercised by this migration itself and fails closed rather than by a
-- separate test, because it runs exactly once against the real source row.
--
-- ROLLBACK: drop both functions; the admin_config row is untouched by this migration,
-- so the previous capability is intact. The Vault secret may be left in place or
-- deleted with: delete from vault.secrets where name = 'popdam_sg_nas_password';
-- =====================================================================================

do $preflight$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'shared-db#4168 preflight: extension supabase_vault is not installed';
  end if;
  if to_regclass('vault.secrets') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is null then
    raise exception 'shared-db#4168 preflight: vault.secrets, vault.decrypted_secrets, vault.create_secret or vault.update_secret is missing';
  end if;
  if (select c.relkind from pg_class c where c.oid = to_regclass('public.admin_config')) is distinct from 'r' then
    raise exception 'shared-db#4168 preflight: public.admin_config is missing or not an ordinary table';
  end if;
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = 'public.admin_config'::regclass and a.attname = 'key' and not a.attisdropped) is distinct from 'text'
     or (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = 'public.admin_config'::regclass and a.attname = 'value' and not a.attisdropped) is distinct from 'jsonb' then
    raise exception 'shared-db#4168 preflight: public.admin_config key/value are not text/jsonb';
  end if;
  -- The copy reads one row by key: key must be unique.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.admin_config'::regclass and c.contype in ('p', 'u')
      and not c.condeferrable and c.convalidated
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = 'public.admin_config'::regclass and a.attname = 'key')]::int2[]
  ) then
    raise exception 'shared-db#4168 preflight: public.admin_config has no primary key or unique constraint on (key)';
  end if;
  -- Server-side only: API roles must not read Vault directly.
  if has_table_privilege('anon', 'vault.secrets', 'select')
     or has_table_privilege('authenticated', 'vault.secrets', 'select')
     or has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
     or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') then
    raise exception 'shared-db#4168 preflight: anon/authenticated can read vault.secrets or vault.decrypted_secrets';
  end if;
  -- vault.secrets must expose id and name, and name must be unique (secrets_name_idx):
  -- set_sg_nas_password relies on at most one row holding the name.
  if (select count(*) from pg_attribute a
       where a.attrelid = 'vault.secrets'::regclass and not a.attisdropped
         and (a.attname, format_type(a.atttypid, a.atttypmod)) in (('id', 'uuid'), ('name', 'text'))) <> 2
     or (select count(*) from pg_attribute a
       where a.attrelid = 'vault.decrypted_secrets'::regclass and not a.attisdropped
         and (a.attname, format_type(a.atttypid, a.atttypmod)) in (('name', 'text'), ('decrypted_secret', 'text'))) <> 2 then
    raise exception 'shared-db#4168 preflight: vault.secrets(id uuid, name text) or vault.decrypted_secrets(name text, decrypted_secret text) has a different shape';
  end if;
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'vault.secrets'::regclass and i.indisunique and i.indisvalid
       and i.indnkeyatts = 1
       and i.indkey[0] = (select a.attnum from pg_attribute a
                           where a.attrelid = 'vault.secrets'::regclass and a.attname = 'name')
  ) then
    raise exception 'shared-db#4168 preflight: vault.secrets has no unique index on (name)';
  end if;
  if to_regprocedure('public.get_sg_nas_password()') is not null
     or to_regprocedure('public.set_sg_nas_password(text)') is not null then
    raise exception 'shared-db#4168 preflight: get/set_sg_nas_password already exist';
  end if;
end;
$preflight$;

create function public.get_sg_nas_password()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select ds.decrypted_secret
       from vault.decrypted_secrets ds
      where ds.name = 'popdam_sg_nas_password'
      limit 1),
    '');
$function$;

create function public.set_sg_nas_password(p_password text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  select s.id into v_id
    from vault.secrets s
   where s.name = 'popdam_sg_nas_password'
   limit 1;

  if v_id is null then
    perform vault.create_secret(
      coalesce(p_password, ''),
      'popdam_sg_nas_password',
      'PopSG NAS password for the PopDAM Windows render agent (shared-db#4168)');
  else
    perform vault.update_secret(v_id, coalesce(p_password, ''));
  end if;
end;
$function$;

revoke all on function public.get_sg_nas_password() from public;
revoke all on function public.get_sg_nas_password() from anon;
revoke all on function public.get_sg_nas_password() from authenticated;
grant execute on function public.get_sg_nas_password() to service_role;

revoke all on function public.set_sg_nas_password(text) from public;
revoke all on function public.set_sg_nas_password(text) from anon;
revoke all on function public.set_sg_nas_password(text) from authenticated;
grant execute on function public.set_sg_nas_password(text) to service_role;

comment on function public.get_sg_nas_password() is
  'shared-db#4168: PopSG NAS password from Vault secret popdam_sg_nas_password; service_role only.';
comment on function public.set_sg_nas_password(text) is
  'shared-db#4168: create/replace Vault secret popdam_sg_nas_password ('''' clears); service_role only.';

-- Copy the existing plaintext value into Vault, database-side only, and verify it.
do $copy$
declare
  v_source jsonb;
begin
  select ac.value into v_source
    from public.admin_config ac
   where ac.key = 'WINDOWS_AGENT_SG_NAS_PASS';

  if v_source is null or jsonb_typeof(v_source) <> 'string' then
    -- No source to verify against: an already-present secret would be unexplained.
    if exists (select 1 from vault.secrets s where s.name = 'popdam_sg_nas_password') then
      raise exception 'shared-db#4168: Vault secret popdam_sg_nas_password exists but WINDOWS_AGENT_SG_NAS_PASS has no string value to verify it against';
    end if;
    raise notice 'shared-db#4168: no string WINDOWS_AGENT_SG_NAS_PASS row and no Vault secret; nothing copied';
    return;
  end if;
  if exists (select 1 from vault.secrets s where s.name = 'popdam_sg_nas_password') then
    -- Never overwrite an existing secret; but it must already equal the source.
    if public.get_sg_nas_password() is distinct from (v_source #>> '{}') then
      raise exception 'shared-db#4168: Vault secret popdam_sg_nas_password already exists with a different value than WINDOWS_AGENT_SG_NAS_PASS';
    end if;
    raise notice 'shared-db#4168: Vault secret already holds the WINDOWS_AGENT_SG_NAS_PASS value; verified';
    return;
  end if;

  perform public.set_sg_nas_password(v_source #>> '{}');

  if public.get_sg_nas_password() is distinct from (v_source #>> '{}') then
    raise exception 'shared-db#4168: Vault copy of WINDOWS_AGENT_SG_NAS_PASS did not verify';
  end if;
  raise notice 'shared-db#4168: WINDOWS_AGENT_SG_NAS_PASS copied into Vault and verified';
end;
$copy$;
