-- Contract test for the DesignFlow sole-writer entry points (migration
-- 20261028185539, #4977). All fixture changes roll back. Requires two active
-- authenticated profiles (supabase/ci-bootstrap/020_test_fixture_seed.sql).
--
-- Proves:
--   * browser roles (authenticated, even an administrator) cannot execute api.dflow_admin_*;
--   * the DesignFlow backend runtime is refused without an active database
--     administrator actor (null, non-administrator, revoked administrator);
--   * with an administrator actor it grants and revokes roles and app access,
--     records granted_by_profile_id = actor, keeps revoked history, changes status;
--   * the 20261026155023 invariants still apply (unknown role, self-revoke);
--   * the caller's JWT settings are restored after each call.
begin;

-- A throwaway login with exactly the DesignFlow runtime grants (the real
-- runtime login may exist here but the test runner cannot SET ROLE to it).
create role dflow_admin_contract_runtime nologin;
grant usage on schema api to dflow_admin_contract_runtime;
grant execute on function api.dflow_admin_role_list(uuid), api.dflow_admin_user_directory(uuid),
  api.dflow_admin_set_user_roles(uuid, uuid, text[]), api.dflow_admin_set_app_access(uuid, uuid, text, boolean),
  api.dflow_admin_set_user_status(uuid, uuid, text), api.dflow_admin_access_history(uuid, integer),
  api.dflow_admin_actor_profile_id(text)
  to dflow_admin_contract_runtime;
do $$ begin execute format('grant dflow_admin_contract_runtime to %I', current_user); end $$;

do $$
declare
  v_admin_role uuid;
  v_a_profile uuid; v_a_auth uuid;
  v_b_profile uuid; v_b_auth uuid;
  v_obj jsonb;
  v_n integer;
  v_refused boolean;
  v_call text;
  v_actor uuid;
  v_a_email text;
begin
  select p.id, p.auth_user_id into v_a_profile, v_a_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_b_profile, v_b_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_b_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  select upper(email::text) into v_a_email from app.profile where id = v_a_profile;
  select id into v_admin_role from app.role where slug = 'administrator';
  insert into app.user_role (profile_id, role_id) values (v_a_profile, v_admin_role)
  on conflict (profile_id, role_id) do update set revoked_at = null;
  update app.user_role set revoked_at = now()
   where profile_id = v_b_profile and revoked_at is null;

  -- 1. Browser roles cannot execute any entry point, administrator or not.
  foreach v_actor in array array[v_a_auth, v_b_auth] loop
    foreach v_call in array array[
      format('select api.dflow_admin_role_list(%L)', v_a_profile),
      format('select api.dflow_admin_user_directory(%L)', v_a_profile),
      format('select api.dflow_admin_set_user_roles(%L, %L, array[''viewer''])', v_a_profile, v_b_profile),
      format('select api.dflow_admin_set_app_access(%L, %L, ''crm'', true)', v_a_profile, v_b_profile),
      format('select api.dflow_admin_set_user_status(%L, %L, ''active'')', v_a_profile, v_b_profile),
      format('select api.dflow_admin_access_history(%L, 10)', v_a_profile),
      'select api.dflow_admin_actor_profile_id(''x@example.invalid'')'
    ] loop
      perform set_config('request.jwt.claim.sub', v_actor::text, true);
      perform set_config('role', 'authenticated', true);
      v_refused := false;
      begin
        execute v_call;
      exception when insufficient_privilege then
        v_refused := true;
      end;
      perform set_config('role', 'postgres', true);
      if not v_refused then
        raise exception 'authenticated caller was not refused: %', v_call;
      end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);

  -- 2. Runtime role without an administrator actor is refused everywhere.
  perform set_config('role', 'dflow_admin_contract_runtime', true);
  foreach v_call in array array[
    'select api.dflow_admin_role_list(null)',
    format('select api.dflow_admin_user_directory(%L)', v_b_profile),
    format('select api.dflow_admin_set_user_roles(%L, %L, array[''viewer''])', v_b_profile, v_b_profile),
    format('select api.dflow_admin_set_app_access(%L, %L, ''crm'', true)', v_b_profile, v_b_profile),
    format('select api.dflow_admin_set_user_status(%L, %L, ''active'')', v_b_profile, v_b_profile),
    format('select api.dflow_admin_access_history(%L, 10)', v_b_profile)
  ] loop
    v_refused := false;
    begin
      execute v_call;
    exception when insufficient_privilege then
      v_refused := true;
    end;
    if not v_refused then
      raise exception 'non-administrator actor was not refused: %', v_call;
    end if;
  end loop;

  -- 3. Administrator actor: lookup, list, grant, revoke.
  if api.dflow_admin_actor_profile_id(v_a_email) <> v_a_profile then
    raise exception 'actor lookup by email failed';
  end if;
  if jsonb_array_length(api.dflow_admin_role_list(v_a_profile)) < 1 then
    raise exception 'role list empty';
  end if;
  if not exists (select 1 from jsonb_array_elements(api.dflow_admin_user_directory(v_a_profile)) e
                 where e->>'id' = v_b_profile::text) then
    raise exception 'directory missing profile B';
  end if;

  v_obj := api.dflow_admin_set_user_roles(v_a_profile, v_b_profile, array['viewer', 'sales']);
  if v_obj->'roles' <> '["sales", "viewer"]'::jsonb then
    raise exception 'set roles returned %', v_obj->'roles';
  end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from app.user_role ur join app.role r on r.id = ur.role_id
   where ur.profile_id = v_b_profile and ur.revoked_at is null
     and r.slug in ('viewer', 'sales') and ur.granted_by_profile_id = v_a_profile;
  if v_n <> 2 then
    raise exception 'grants not attributed to actor (%)', v_n;
  end if;
  perform set_config('role', 'dflow_admin_contract_runtime', true);
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> '' then
    raise exception 'jwt sub not restored after call';
  end if;

  v_obj := api.dflow_admin_set_user_roles(v_a_profile, v_b_profile, array['viewer']);
  perform set_config('role', 'postgres', true);
  if exists (select 1 from app.user_role ur join app.role r on r.id = ur.role_id
             where ur.profile_id = v_b_profile and r.slug = 'sales' and ur.revoked_at is null)
     or not exists (select 1 from app.user_role ur join app.role r on r.id = ur.role_id
             where ur.profile_id = v_b_profile and r.slug = 'sales' and ur.revoked_at is not null) then
    raise exception 'sales not soft-revoked';
  end if;
  perform set_config('role', 'dflow_admin_contract_runtime', true);

  v_obj := api.dflow_admin_set_app_access(v_a_profile, v_b_profile, 'crm', true);
  if not (v_obj->'apps') ? 'crm' then raise exception 'crm not granted'; end if;
  v_obj := api.dflow_admin_set_app_access(v_a_profile, v_b_profile, 'crm', false);
  if (v_obj->'apps') ? 'crm' then raise exception 'crm not revoked'; end if;

  v_obj := api.dflow_admin_set_user_status(v_a_profile, v_b_profile, 'inactive');
  if v_obj->>'status' <> 'inactive' then raise exception 'status not set'; end if;
  v_obj := api.dflow_admin_set_user_status(v_a_profile, v_b_profile, 'active');

  if jsonb_array_length(api.dflow_admin_access_history(v_a_profile, 5)) < 1 then
    raise exception 'history empty';
  end if;

  -- 4. Existing invariants still apply.
  v_refused := false;
  begin
    perform api.dflow_admin_set_user_roles(v_a_profile, v_b_profile, array['no_such_role']);
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'unknown role accepted'; end if;
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> '' then
    raise exception 'jwt sub not restored after a refused call';
  end if;

  v_refused := false;
  begin
    perform api.dflow_admin_set_user_roles(v_a_profile, v_a_profile, array['viewer']);
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'self administrator removal accepted'; end if;

  -- 5. A revoked administrator cannot act.
  perform set_config('role', 'postgres', true);
  update app.user_role set revoked_at = now() where profile_id = v_a_profile and role_id = v_admin_role;
  perform set_config('role', 'dflow_admin_contract_runtime', true);
  v_refused := false;
  begin
    perform api.dflow_admin_role_list(v_a_profile);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'revoked administrator was accepted'; end if;
  perform set_config('role', 'postgres', true);
end;
$$;

-- 6. Static posture: security definer, pinned search_path, exact grants.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'api' and p.proname like 'dflow\_admin\_%')
       or (n.nspname = 'app' and p.proname in ('dflow_admin_assume_actor', 'dflow_admin_restore_claims'))
  loop
    if not r.prosecdef or not ('search_path=app, public' = any(r.proconfig)) then
      raise exception '% is not security definer with search_path app, public', r.sig;
    end if;
    if has_function_privilege('anon', r.sig, 'execute')
       or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception '% is executable by a browser role', r.sig;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api' and p.proname like 'dflow\_admin\_%') <> 7 then
    raise exception 'expected exactly seven api.dflow_admin_* functions';
  end if;
end;
$$;

rollback;
