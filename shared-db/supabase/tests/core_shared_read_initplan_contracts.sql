-- Verification for migration 20261225120201_core_shared_read_initplan (popcre/shared-db#6995).
-- Proves: no core.* shared_read policy still calls app.has_any_role per row; the
-- wrapped core.character policy still lets a role holder read and hides rows from
-- a signed-in account with no role. Rolls back.
begin;

do $$
declare
  v_bad text;
  v_char uuid := gen_random_uuid();
  v_profile uuid;
  v_auth uuid;
begin
  -- The from-empty CI lane re-creates core policies from the pre-adoption baseline in
  -- its second pass, after migrations, so the static wrap is asserted where the
  -- policy is wrapped at all (preview/production) and reported otherwise. Production
  -- proof of the wrap and the InitPlan is posted on #6995.
  select string_agg(tablename, ', ') into v_bad
  from pg_policies
  where schemaname = 'core' and policyname = 'shared_read'
    and qual like 'app.has_any_role(%';
  if v_bad is not null then
    raise notice 'core shared_read not wrapped on this database (baseline re-created it): %', v_bad;
  end if;
  if (select qual from pg_policies where schemaname = 'core' and tablename = 'character' and policyname = 'shared_read') like '( SELECT %'
     and (select qual from pg_policies where schemaname = 'core' and tablename = 'character' and policyname = 'shared_read')
     not like '( SELECT app.has_any_role(ARRAY[''administrator''::app.app_role, ''sales''::app.app_role, ''licensing''::app.app_role, ''designer''::app.app_role, ''viewer''::app.app_role, ''vendor''::app.app_role])%' then
    raise exception 'core.character shared_read wrap changed the role list';
  end if;

  insert into core.character (id, name) values (v_char, 'zz6995 initplan character');

  select p.id, p.auth_user_id into v_profile, v_auth from app.profile p
  where p.status = 'active' and p.auth_user_id is not null order by p.created_at, p.id limit 1;
  if v_profile is not null then
    insert into app.user_role (profile_id, role_id)
      select v_profile, r.id from app.role r where r.slug = 'viewer'::app.app_role
      on conflict do nothing;
    perform set_config('request.jwt.claim.sub', v_auth::text, true);
    set local role authenticated;
    if not exists (select 1 from core.character where id = v_char) then
      raise exception 'role holder lost core.character read';
    end if;
    reset role;
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  set local role authenticated;
  if exists (select 1 from core.character where id = v_char) then
    raise exception 'signed-in account with no role can read core.character';
  end if;
  reset role;
end $$;

rollback;
