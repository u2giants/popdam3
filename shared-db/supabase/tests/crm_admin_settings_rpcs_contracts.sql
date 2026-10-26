-- Contract test for the CRM admin settings RPCs (migration 20261026155023, #4811).
-- All fixture changes roll back. Requires two active authenticated profiles
-- (supabase/ci-bootstrap/020_test_fixture_seed.sql provides four in CI).
--
-- Proves, as real authenticated users (SET LOCAL role + JWT sub):
--   * a non-administrator is refused by all seven functions (insufficient_privilege);
--   * an administrator can list roles and the directory, replace a user's role set,
--     toggle app access, change status, assign departments to salespeople, list department assignments, and read history;
--   * unknown roles/apps/statuses/fields are rejected, and an administrator cannot
--     remove their own administrator role, their own CRM access, or deactivate self.
begin;

do $$
declare
  v_admin_role uuid;
  v_a_profile uuid; v_a_auth uuid;
  v_b_profile uuid; v_b_auth uuid;
  v_customer uuid;
  v_department uuid;
  v_obj jsonb;
  v_arr jsonb;
  v_n integer;
  v_refused boolean;
  v_call text;
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

  select id into v_admin_role from app.role where slug = 'administrator';
  insert into app.user_role (profile_id, role_id) values (v_a_profile, v_admin_role)
  on conflict (profile_id, role_id) do update set revoked_at = null;
  update app.user_role set revoked_at = now()
   where profile_id = v_b_profile and revoked_at is null;
  update app.user_role ur set revoked_at = now()
    from app.role r
   where r.id = ur.role_id and r.slug = 'sales'
     and ur.profile_id = v_a_profile and ur.revoked_at is null;
  insert into app.app_access (profile_id, app) values (v_b_profile, 'crm')
  on conflict (profile_id, app) do update set revoked_at = null;

  insert into core.customer (name, status)
  values ('ZZ CRM Admin Fixture ' || gen_random_uuid()::text, 'active')
  returning id into v_customer;
  insert into crm.department (company_id, name, sort_order)
  values (v_customer, 'ZZ CRM Admin Fixture Dept', 1)
  returning id into v_department;

  -- Non-administrator: every function refuses.
  perform set_config('request.jwt.claim.sub', v_b_auth::text, true);
  perform set_config('role', 'authenticated', true);
  foreach v_call in array array[
    'select api.crm_admin_role_list()',
    'select api.crm_admin_user_directory()',
    format('select api.crm_admin_set_user_roles(%L, array[''viewer''])', v_b_profile),
    format('select api.crm_admin_set_app_access(%L, ''crm'', true)', v_b_profile),
    format('select api.crm_admin_set_user_status(%L, ''active'')', v_b_profile),
    format('select api.crm_admin_assign_departments(array[%L]::uuid[], %L)', v_department, v_b_profile),
    'select api.crm_admin_department_assignments()',
    'select api.crm_admin_access_history(10)'
  ] loop
    v_refused := false;
    begin
      execute v_call;
    exception when insufficient_privilege then
      v_refused := true;
    end;
    if not v_refused then
      raise exception 'non-administrator was not refused: %', v_call;
    end if;
  end loop;

  -- Administrator.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', v_a_auth::text, true);
  perform set_config('role', 'authenticated', true);

  v_arr := api.crm_admin_role_list();
  if jsonb_array_length(v_arr) < 6
     or not v_arr @> '[{"slug":"sales"},{"slug":"administrator"}]'::jsonb
     or not (v_arr->0 ? 'name' and v_arr->0 ? 'description') then
    raise exception 'role list wrong: %', v_arr;
  end if;

  v_arr := api.crm_admin_user_directory();
  select e into v_obj from jsonb_array_elements(v_arr) e where e->>'id' = v_b_profile::text;
  if v_obj is null or not (v_obj ?& array['id','email','display_name','avatar_url','status',
       'created_at','last_sign_in_at','roles','apps','crm_access',
       'department_count']) then
    raise exception 'directory object wrong: %', v_obj;
  end if;
  if (v_obj->>'crm_access')::boolean is not true or v_obj->'roles' <> '[]'::jsonb then
    raise exception 'directory baseline wrong: %', v_obj;
  end if;

  v_obj := api.crm_admin_set_user_roles(v_b_profile, array['viewer','sales','sales']);
  if v_obj->'roles' <> '["sales","viewer"]'::jsonb then
    raise exception 'set roles wrong: %', v_obj;
  end if;
  v_obj := api.crm_admin_set_user_roles(v_b_profile, array['sales']);
  if v_obj->'roles' <> '["sales"]'::jsonb then
    raise exception 'role removal wrong: %', v_obj;
  end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_user_roles(v_b_profile, array['bogus']);
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'unknown role accepted'; end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_user_roles(v_a_profile, array['sales']);
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'self administrator removal accepted'; end if;

  v_obj := api.crm_admin_set_app_access(v_b_profile, 'crm', false);
  if (v_obj->>'crm_access')::boolean or v_obj->'apps' @> '["crm"]'::jsonb then
    raise exception 'crm revoke wrong: %', v_obj;
  end if;
  v_obj := api.crm_admin_set_app_access(v_b_profile, 'crm', true);
  if not (v_obj->>'crm_access')::boolean then
    raise exception 'crm regrant wrong: %', v_obj;
  end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_app_access(v_a_profile, 'crm', false);
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'self crm removal accepted'; end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_app_access(v_b_profile, 'nope', true);
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'unknown app accepted'; end if;

  v_obj := api.crm_admin_set_user_status(v_b_profile, 'inactive');
  if v_obj->>'status' <> 'inactive' then raise exception 'status wrong: %', v_obj; end if;
  v_obj := api.crm_admin_set_user_status(v_b_profile, 'active');

  v_refused := false;
  begin
    perform api.crm_admin_set_user_status(v_a_profile, 'inactive');
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'self deactivation accepted'; end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_user_status(v_b_profile, 'deleted');
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'deleted status accepted'; end if;

  -- B holds the sales role at this point.
  v_n := api.crm_admin_assign_departments(array[v_department], v_b_profile);
  if v_n <> 1 then raise exception 'assign department count %', v_n; end if;
  select e into v_obj from jsonb_array_elements(api.crm_admin_user_directory()) e
   where e->>'id' = v_b_profile::text;
  if (v_obj->>'department_count')::int < 1 then
    raise exception 'department_count wrong: %', v_obj;
  end if;
  select e into v_obj from jsonb_array_elements(api.crm_admin_department_assignments()) e
   where e->>'id' = v_department::text;
  if v_obj is null or v_obj->>'salesperson_profile_id' <> v_b_profile::text
     or v_obj->>'customer_id' <> v_customer::text
     or not (v_obj ?& array['id','name','division','category','status','is_active','customer_id',
       'customer_name','customer_display_name','customer_status','salesperson_profile_id']) then
    raise exception 'department assignment object wrong: %', v_obj;
  end if;
  v_n := api.crm_admin_assign_departments(array[v_department], null);
  if v_n <> 1 then raise exception 'unassign count %', v_n; end if;
  if (select salesperson_profile_id from crm.department where id = v_department) is not null then
    raise exception 'department not unassigned';
  end if;

  -- A profile without the sales role is rejected.
  v_refused := false;
  begin
    perform api.crm_admin_assign_departments(array[v_department], v_a_profile);
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'non-sales assignee accepted'; end if;

  v_arr := api.crm_admin_access_history(500);
  if not v_arr @> jsonb_build_array(jsonb_build_object(
       'kind','role','action','granted','value','sales','profile_id', v_b_profile)) then
    raise exception 'history missing sales grant';
  end if;
  if not v_arr @> jsonb_build_array(jsonb_build_object(
       'kind','role','action','revoked','value','viewer','profile_id', v_b_profile)) then
    raise exception 'history missing viewer revoke';
  end if;

  -- Edge inputs.
  v_refused := false;
  begin
    perform api.crm_admin_set_user_roles(v_b_profile, null);
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'null roles accepted'; end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_user_roles(gen_random_uuid(), array['viewer']);
  exception when no_data_found then v_refused := true;
  end;
  if not v_refused then raise exception 'unknown profile accepted'; end if;

  if api.crm_admin_assign_departments(null, v_b_profile) <> 0
     or api.crm_admin_assign_departments(array[]::uuid[], v_b_profile) <> 0
     or api.crm_admin_assign_departments(array[gen_random_uuid()], v_b_profile) <> 0 then
    raise exception 'empty/unknown department arrays must update nothing';
  end if;

  if jsonb_array_length(api.crm_admin_access_history(0)) > 1
     or jsonb_array_length(api.crm_admin_access_history(-5)) > 1 then
    raise exception 'history limit not clamped';
  end if;
  perform api.crm_admin_access_history(null);

  -- Last-administrator invariant: make A the only database administrator, then act
  -- as B holding administrator only through JWT app_metadata (not a DB grant).
  perform set_config('role', 'postgres', true);
  update app.user_role ur set revoked_at = now()
    from app.role r
   where r.id = ur.role_id and r.slug = 'administrator'
     and ur.revoked_at is null and ur.profile_id <> v_a_profile;
  perform set_config('request.jwt.claim.sub', v_b_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_b_auth, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('roles', jsonb_build_array('administrator')))::text, true);
  perform set_config('role', 'authenticated', true);

  v_refused := false;
  begin
    perform api.crm_admin_set_user_status(v_a_profile, 'inactive');
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'last administrator deactivation accepted'; end if;

  v_refused := false;
  begin
    perform api.crm_admin_set_user_roles(v_a_profile, array['viewer']);
  exception when check_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'last administrator role removal accepted'; end if;

  perform set_config('role', 'postgres', true);

  -- Static: exact signatures, security definer, pinned search_path, grants.
  foreach v_call in array array[
    'api.crm_admin_role_list()',
    'api.crm_admin_user_directory()',
    'api.crm_admin_set_user_roles(uuid,text[])',
    'api.crm_admin_set_app_access(uuid,text,boolean)',
    'api.crm_admin_set_user_status(uuid,text)',
    'api.crm_admin_assign_departments(uuid[],uuid)',
    'api.crm_admin_department_assignments()',
    'api.crm_admin_access_history(integer)'
  ] loop
    if to_regprocedure(v_call) is null then
      raise exception 'missing function %', v_call;
    end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=app, public']
            from pg_proc p where p.oid = to_regprocedure(v_call)) then
      raise exception '% must be security definer with pinned search_path', v_call;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure(v_call), 'execute')
       or has_function_privilege('anon', to_regprocedure(v_call), 'execute') then
      raise exception 'unexpected grants on %', v_call;
    end if;
  end loop;

  -- Storage objects and the table-level assignee guard.
  if to_regclass('crm.crm_department_salesperson_profile_idx') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'crm' and table_name = 'department'
                      and column_name = 'salesperson_profile_id')
     or not exists (select 1 from pg_trigger
                    where tgrelid = 'crm.department'::regclass
                      and tgname = 'crm_department_salesperson_guard') then
    raise exception 'department salesperson column, index or guard trigger missing';
  end if;
  v_refused := false;
  begin
    update crm.department set salesperson_profile_id = gen_random_uuid() where id = v_department;
  exception when invalid_parameter_value or foreign_key_violation then v_refused := true;
  end;
  if not v_refused then raise exception 'direct write of unknown salesperson accepted'; end if;
  -- A (administrator, no sales role) written directly must be refused by the trigger.
  v_refused := false;
  begin
    update crm.department set salesperson_profile_id = v_a_profile where id = v_department;
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'direct write of non-sales salesperson accepted'; end if;

  raise notice 'crm_admin_settings_rpcs_contracts: PASS';
end;
$$;

rollback;
