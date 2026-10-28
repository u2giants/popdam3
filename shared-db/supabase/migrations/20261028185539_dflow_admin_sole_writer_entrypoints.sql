-- derived-from: none
-- DesignFlow sole-writer entry points for cross-app roles and app access
-- (shared-db #4977; application need popcre/designflow-backend#250; owner
-- ruling §6.33: DesignFlow PLM holds all user roles/permissions).
--
-- DesignFlow's backend connects over plain Postgres as
-- designflow_prod_backend_runtime and carries no Supabase JWT, so it cannot
-- pass the app.has_role('administrator') gate of the 20261026155023
-- api.crm_admin_* functions. Each api.dflow_admin_* wrapper below:
--   1. is executable only by the DesignFlow backend runtime role (the grant is
--      the service-caller gate; public/anon/authenticated are revoked);
--   2. requires a named acting administrator: an active app.profile holding an
--      active DATABASE administrator grant in app.user_role (JWT app_metadata
--      roles are not counted), so DesignFlow cannot skip its own admin gate;
--   3. assumes that actor for the current transaction only (local
--      request.jwt.claim.sub / request.jwt.claims, no app_metadata), calls the
--      unchanged api.crm_admin_* function, and restores the previous settings.
-- Every invariant (unknown slugs, self-revoke, last administrator, advisory
-- lock api.crm_admin_access_invariant, soft grant/revoke history,
-- granted_by_profile_id = actor) therefore stays in its one existing copy.
--
-- Additive only: two app helpers and seven api functions. The api.crm_admin_*
-- functions and their authenticated grants are not modified (Phase 4 retires
-- them). Never writes auth.users.

create or replace function app.dflow_admin_assume_actor(p_actor_profile_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_auth_user_id uuid;
begin
  select p.auth_user_id into v_auth_user_id
  from app.profile p
  where p.id = p_actor_profile_id
    and p.status = 'active'
    and p.auth_user_id is not null
    and exists (
      select 1 from app.user_role ur
      join app.role r on r.id = ur.role_id
      where ur.profile_id = p.id and ur.revoked_at is null and r.slug = 'administrator'
    );

  if p_actor_profile_id is null or v_auth_user_id is null then
    raise exception 'dflow: actor is not an active administrator'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_auth_user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

revoke all on function app.dflow_admin_assume_actor(uuid) from public, anon, authenticated;
comment on function app.dflow_admin_assume_actor(uuid) is
  'Internal to api.dflow_admin_*: verify the actor is an active profile with an active database administrator grant, then set transaction-local JWT sub/claims (no app_metadata) so app.current_profile_id() resolves to the actor.';

create or replace function app.dflow_admin_restore_claims(p_sub text, p_claims text)
returns void
language plpgsql
volatile
security definer
set search_path = app, public
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(p_claims, ''), true);
end;
$$;

revoke all on function app.dflow_admin_restore_claims(text, text) from public, anon, authenticated;
comment on function app.dflow_admin_restore_claims(text, text) is
  'Internal to api.dflow_admin_*: restore the transaction-local JWT settings captured before the actor was assumed.';

-- Role catalogue.
create or replace function api.dflow_admin_role_list(p_actor_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_role_list();
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_role_list(uuid) from public, anon, authenticated;
comment on function api.dflow_admin_role_list(uuid) is
  'DesignFlow backend only: role catalogue as the named acting administrator via api.crm_admin_role_list (all its invariants apply).';

-- User directory.
create or replace function api.dflow_admin_user_directory(p_actor_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_user_directory();
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_user_directory(uuid) from public, anon, authenticated;
comment on function api.dflow_admin_user_directory(uuid) is
  'DesignFlow backend only: user directory as the named acting administrator via api.crm_admin_user_directory (all its invariants apply).';

-- Replace a user's active role set.
create or replace function api.dflow_admin_set_user_roles(p_actor_profile_id uuid, p_profile_id uuid, p_roles text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_user_roles(p_profile_id, p_roles);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_set_user_roles(uuid, uuid, text[]) from public, anon, authenticated;
comment on function api.dflow_admin_set_user_roles(uuid, uuid, text[]) is
  'DesignFlow backend only: replace a user''s active role set as the named acting administrator via api.crm_admin_set_user_roles (all its invariants apply).';

-- Grant or revoke one app.
create or replace function api.dflow_admin_set_app_access(p_actor_profile_id uuid, p_profile_id uuid, p_app text, p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_app_access(p_profile_id, p_app, p_enabled);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_set_app_access(uuid, uuid, text, boolean) from public, anon, authenticated;
comment on function api.dflow_admin_set_app_access(uuid, uuid, text, boolean) is
  'DesignFlow backend only: grant or revoke one app as the named acting administrator via api.crm_admin_set_app_access (all its invariants apply).';

-- Activate or deactivate a user.
create or replace function api.dflow_admin_set_user_status(p_actor_profile_id uuid, p_profile_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_set_user_status(p_profile_id, p_status);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_set_user_status(uuid, uuid, text) from public, anon, authenticated;
comment on function api.dflow_admin_set_user_status(uuid, uuid, text) is
  'DesignFlow backend only: activate or deactivate a user as the named acting administrator via api.crm_admin_set_user_status (all its invariants apply).';

-- Grant/revoke history.
create or replace function api.dflow_admin_access_history(p_actor_profile_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app, public
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
begin
  perform app.dflow_admin_assume_actor(p_actor_profile_id);
  begin
    v_result := api.crm_admin_access_history(p_limit);
  exception when others then
    perform app.dflow_admin_restore_claims(v_sub, v_claims);
    raise;
  end;
  perform app.dflow_admin_restore_claims(v_sub, v_claims);
  return v_result;
end;
$$;

revoke all on function api.dflow_admin_access_history(uuid, integer) from public, anon, authenticated;
comment on function api.dflow_admin_access_history(uuid, integer) is
  'DesignFlow backend only: grant/revoke history as the named acting administrator via api.crm_admin_access_history (all its invariants apply).';

-- Actor lookup: DesignFlow users are matched to their shared app.profile by
-- email until the dflow users.app_profile_id bridge is populated. Returns the
-- id of the one active profile with that email, or null.
create or replace function api.dflow_admin_actor_profile_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = app, public
as $$
  select p.id
  from app.profile p
  where lower(p.email::text) = lower(btrim(p_email))
    and p.status = 'active'
  order by p.created_at, p.id
  limit 1;
$$;

revoke all on function api.dflow_admin_actor_profile_id(text) from public, anon, authenticated;
comment on function api.dflow_admin_actor_profile_id(text) is
  'DesignFlow backend only: the active app.profile id for an email (null if none). Used to resolve the acting administrator; api.dflow_admin_* still verify the administrator grant.';

-- Grant to the DesignFlow backend runtime where that login exists (it is
-- absent from ephemeral contract-test databases).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_runtime') then
    grant usage on schema api to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_role_list(uuid) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_user_directory(uuid) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_set_user_roles(uuid, uuid, text[]) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_set_app_access(uuid, uuid, text, boolean) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_set_user_status(uuid, uuid, text) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_access_history(uuid, integer) to designflow_prod_backend_runtime;
    grant execute on function api.dflow_admin_actor_profile_id(text) to designflow_prod_backend_runtime;
  end if;
end;
$$;
