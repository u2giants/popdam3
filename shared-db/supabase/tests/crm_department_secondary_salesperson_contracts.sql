-- Contract test for migration 20261027000349 (#4851): sales_assistant role value,
-- secondary department salesperson, api.crm_admin_set_department_salespeople.
-- All fixture changes roll back. Requires three active authenticated profiles
-- (supabase/ci-bootstrap/020_test_fixture_seed.sql provides four in CI).
begin;

do $$
declare
  v_admin_role uuid; v_sales_role uuid;
  v_a uuid; v_a_auth uuid;
  v_b uuid; v_b_auth uuid;
  v_c uuid;
  v_customer uuid; v_dept uuid; v_dept2 uuid;
  v_obj jsonb; v_n integer; v_refused boolean; v_call text;
begin
  if not ('sales_assistant' = any(enum_range(null::app.app_role)::text[])) then
    raise exception 'app.app_role lacks sales_assistant';
  end if;

  select p.id, p.auth_user_id into v_a, v_a_auth from app.profile p
   where p.status = 'active' and p.auth_user_id is not null order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_b, v_b_auth from app.profile p
   where p.status = 'active' and p.auth_user_id is not null order by p.created_at, p.id limit 1 offset 1;
  select p.id into v_c from app.profile p
   where p.status = 'active' and p.auth_user_id is not null order by p.created_at, p.id limit 1 offset 2;
  if v_c is null then raise exception 'fixture requires three active authenticated profiles'; end if;

  select id into v_admin_role from app.role where slug = 'administrator';
  select id into v_sales_role from app.role where slug = 'sales';
  insert into app.user_role (profile_id, role_id) values (v_a, v_admin_role)
  on conflict (profile_id, role_id) do update set revoked_at = null;
  update app.user_role set revoked_at = now()
   where profile_id = v_a and role_id = v_sales_role and revoked_at is null;
  update app.user_role set revoked_at = now()
   where profile_id = v_b and role_id = v_admin_role and revoked_at is null;
  insert into app.user_role (profile_id, role_id) values (v_b, v_sales_role), (v_c, v_sales_role)
  on conflict (profile_id, role_id) do update set revoked_at = null;

  insert into core.customer (name, status) values ('ZZ CRM Sec Fixture ' || gen_random_uuid()::text, 'active')
  returning id into v_customer;
  insert into crm.department (company_id, name, sort_order) values (v_customer, 'ZZ Sec Dept 1', 1)
  returning id into v_dept;
  insert into crm.department (company_id, name, sort_order) values (v_customer, 'ZZ Sec Dept 2', 2)
  returning id into v_dept2;

  -- Non-administrator (B) is refused.
  perform set_config('request.jwt.claim.sub', v_b_auth::text, true);
  perform set_config('role', 'authenticated', true);
  v_refused := false;
  begin
    perform api.crm_admin_set_department_salespeople(array[v_dept], array[v_b]);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'non-administrator was not refused'; end if;

  -- Administrator (A).
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', v_a_auth::text, true);
  perform set_config('role', 'authenticated', true);

  v_n := api.crm_admin_set_department_salespeople(array[v_dept, v_dept2], array[v_b, v_c]);
  if v_n <> 2 then raise exception 'set salespeople count %', v_n; end if;
  select e into v_obj from jsonb_array_elements(api.crm_admin_department_assignments()) e
   where e->>'id' = v_dept::text;
  if v_obj->>'salesperson_profile_id' <> v_b::text or v_obj->>'secondary_salesperson_profile_id' <> v_c::text then
    raise exception 'assignment object wrong: %', v_obj;
  end if;
  select e into v_obj from jsonb_array_elements(api.crm_admin_user_directory()) e where e->>'id' = v_c::text;
  if (v_obj->>'department_count')::int < 2 then raise exception 'secondary not counted: %', v_obj; end if;

  -- Existing primary-only function keeps working and leaves the secondary alone.
  v_n := api.crm_admin_assign_departments(array[v_dept2], null);
  if v_n <> 1 or (select secondary_salesperson_profile_id from crm.department where id = v_dept2) <> v_c then
    raise exception 'assign_departments changed the secondary';
  end if;

  -- Primary only, then clear both.
  v_n := api.crm_admin_set_department_salespeople(array[v_dept], array[v_b]);
  if (select secondary_salesperson_profile_id from crm.department where id = v_dept) is not null then
    raise exception 'single entry must clear the secondary';
  end if;
  v_n := api.crm_admin_set_department_salespeople(array[v_dept], array[]::uuid[]);
  if (select salesperson_profile_id from crm.department where id = v_dept) is not null then
    raise exception 'empty list must clear both';
  end if;

  foreach v_call in array array[
    format('select api.crm_admin_set_department_salespeople(array[%L]::uuid[], array[%L,%L,%L]::uuid[])', v_dept, v_b, v_c, v_b),
    format('select api.crm_admin_set_department_salespeople(array[%L]::uuid[], array[%L,%L]::uuid[])', v_dept, v_b, v_b),
    format('select api.crm_admin_set_department_salespeople(array[%L]::uuid[], array[null,%L]::uuid[])', v_dept, v_c),
    format('select api.crm_admin_set_department_salespeople(array[%L]::uuid[], array[%L]::uuid[])', v_dept, v_a)
  ] loop
    v_refused := false;
    begin
      execute v_call;
    exception when invalid_parameter_value then v_refused := true;
    end;
    if not v_refused then raise exception 'invalid input accepted: %', v_call; end if;
  end loop;

  -- Table guard: secondary = primary and non-sales secondary are refused on direct writes.
  perform set_config('role', 'postgres', true);
  v_refused := false;
  begin
    update crm.department set salesperson_profile_id = v_b, secondary_salesperson_profile_id = v_b where id = v_dept;
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'direct secondary = primary accepted'; end if;
  v_refused := false;
  begin
    update crm.department set secondary_salesperson_profile_id = v_a where id = v_dept;
  exception when invalid_parameter_value then v_refused := true;
  end;
  if not v_refused then raise exception 'direct non-sales secondary accepted'; end if;

  if to_regclass('crm.crm_department_secondary_salesperson_profile_idx') is null
     or to_regprocedure('api.crm_admin_set_department_salespeople(uuid[],uuid[])') is null
     or not has_function_privilege('authenticated', 'api.crm_admin_set_department_salespeople(uuid[],uuid[])', 'execute')
     or has_function_privilege('anon', 'api.crm_admin_set_department_salespeople(uuid[],uuid[])', 'execute') then
    raise exception 'objects or grants wrong';
  end if;

  raise notice 'crm_department_secondary_salesperson_contracts: PASS';
end;
$$;

rollback;
