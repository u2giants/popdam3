-- Preview/disposable verification for DB Data Admin Step 6 read contracts
-- (migration 20260722005000). All fixture changes roll back.
--
-- Proves:
--   * the full authorization matrix, including denial of an administrator
--     WITHOUT an explicit, non-revoked `admin` app_access grant;
--   * EXECUTE revoked from public and granted to authenticated;
--   * channel tables keep their no-browser-grant protection;
--   * filter, sort, cursor, and page-size parameters on the list contracts;
--   * vendor source refs expose no source_name; vendor PLM status stays null;
--   * licensor/property hierarchy with loud orphan surfacing;
--   * audit read; grid-state round trip, optimistic concurrency, and
--     profile scoping.
--
-- Run only after 20260722005000 is applied to the target database.
begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_role_id uuid;
  v_admin_profile uuid;
  v_admin_auth uuid;
  v_no_grant_profile uuid;
  v_no_grant_auth uuid;
  v_non_admin_profile uuid;
  v_non_admin_auth uuid;
  v_second_admin_profile uuid;
  v_second_admin_auth uuid;
  v_sig text;
  v_call text;
  v_calls text[];
  v_result jsonb;
  v_row jsonb;
  v_cust_a uuid;
  v_cust_b uuid;
  v_cust_c uuid;
  v_cust_d uuid;
  v_cust_e uuid;
  v_channel_id uuid;
  v_company uuid;
  v_factory uuid;
  v_licensor uuid;
  v_prop1 uuid;
  v_prop2 uuid;
  v_orphan uuid;
  v_audit_id uuid;
  v_cursor text;
  v_pages integer;
  v_seen uuid[];
  v_asc jsonb;
  v_desc jsonb;
  v_grid_key text;
begin
  v_grid_key := 'step6-view-' || v_suffix;
  v_calls := array[
    'api.db_data_admin_channel_list()',
    'api.db_data_admin_customer_list()',
    'api.db_data_admin_vendor_list()',
    'api.db_data_admin_licensor_property_list()',
    'api.db_data_admin_audit_list()',
    'api.db_data_admin_grid_state_get(''customer'', ''step6-denial'')',
    'api.db_data_admin_grid_state_upsert(''customer'', ''step6-denial'', ''{}''::jsonb, null)'
  ];

  -- ------------------------------------------------------------------
  -- Static object and privilege assertions.
  -- ------------------------------------------------------------------
  foreach v_sig in array array[
    'api.db_data_admin_channel_list()',
    'api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer,uuid)',
    'api.db_data_admin_vendor_list(text,text,text,text,boolean,text,text,text,integer)',
    'api.db_data_admin_licensor_property_list(text,boolean,text,integer)',
    'api.db_data_admin_audit_list(text,uuid,text,uuid,timestamptz,timestamptz,text,integer)',
    'api.db_data_admin_grid_state_get(text,text)',
    'api.db_data_admin_grid_state_upsert(text,text,jsonb,bigint)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'missing protected function: %', v_sig;
    end if;
    if has_function_privilege('public', v_sig::regprocedure, 'execute') then
      raise exception 'public can execute %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
      raise exception 'authenticated cannot execute %', v_sig;
    end if;
  end loop;

  if to_regprocedure('app.require_db_data_admin_access()') is null then
    raise exception 'missing DB Data Admin authorization helper';
  end if;
  if has_function_privilege('public', 'app.require_db_data_admin_access()'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'app.require_db_data_admin_access()'::regprocedure, 'execute') then
    raise exception 'authorization helper must stay private';
  end if;

  if has_table_privilege('authenticated', 'core.channel', 'select')
     or has_table_privilege('authenticated', 'core.customer_channel', 'select') then
    raise exception 'authenticated received a direct channel table grant';
  end if;

  -- ------------------------------------------------------------------
  -- Fixture identities: reuse four active preview profiles. Their role/access
  -- rows are normalized inside this transaction and restored by the rollback.
  -- Creating auth.users would trip the repository's invitation-only signup
  -- guard before this contract test can begin.
  -- ------------------------------------------------------------------
  select p.id, p.auth_user_id into v_admin_profile, v_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_no_grant_profile, v_no_grant_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  select p.id, p.auth_user_id into v_non_admin_profile, v_non_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 2;
  select p.id, p.auth_user_id into v_second_admin_profile, v_second_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 3;

  if v_second_admin_profile is null then
    raise exception 'fixture requires four active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'administrator'::app.app_role;
  if v_role_id is null then
    raise exception 'fixture requires the administrator role';
  end if;

  delete from app.user_role
  where profile_id in (
    v_admin_profile, v_no_grant_profile, v_non_admin_profile, v_second_admin_profile
  ) and role_id = v_role_id;
  delete from app.app_access
  where profile_id in (
    v_admin_profile, v_no_grant_profile, v_non_admin_profile, v_second_admin_profile
  ) and app = 'admin';

  insert into app.user_role (profile_id, role_id) values
    (v_admin_profile, v_role_id),
    (v_no_grant_profile, v_role_id),
    (v_second_admin_profile, v_role_id);

  insert into app.app_access (profile_id, app) values
    (v_admin_profile, 'admin'),
    (v_non_admin_profile, 'admin'),
    (v_second_admin_profile, 'admin');

  -- ------------------------------------------------------------------
  -- Authorization matrix.
  -- ------------------------------------------------------------------

  -- 1. Administrator WITH explicit non-revoked grant: allowed everywhere.
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  foreach v_call in array v_calls loop
    begin
      execute 'select ' || v_call;
    exception
      when insufficient_privilege then
        raise exception 'authorized administrator was denied on %', v_call;
    end;
  end loop;

  -- 2. Administrator WITHOUT explicit grant: denied everywhere.
  perform set_config('request.jwt.claim.sub', v_no_grant_auth::text, true);
  foreach v_call in array v_calls loop
    begin
      execute 'select ' || v_call;
      raise exception 'administrator without explicit admin grant was allowed on %', v_call;
    exception
      when insufficient_privilege then null;
    end;
  end loop;

  -- 3. Non-administrator WITH explicit grant: denied everywhere.
  perform set_config('request.jwt.claim.sub', v_non_admin_auth::text, true);
  foreach v_call in array v_calls loop
    begin
      execute 'select ' || v_call;
      raise exception 'non-administrator with explicit grant was allowed on %', v_call;
    exception
      when insufficient_privilege then null;
    end;
  end loop;

  -- 4. Revoked grant: denied; un-revoked: allowed again.
  update app.app_access
  set revoked_at = now()
  where profile_id = v_admin_profile and app = 'admin';
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  begin
    perform api.db_data_admin_customer_list();
    raise exception 'revoked admin grant was accepted';
  exception
    when insufficient_privilege then null;
  end;
  update app.app_access
  set revoked_at = null
  where profile_id = v_admin_profile and app = 'admin';
  perform api.db_data_admin_customer_list();

  -- ------------------------------------------------------------------
  -- Customer fixtures and read-contract behavior (as authorized admin).
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  insert into core.customer (name, display_name, status)
  values ('Step6 Fixture Alpha ' || v_suffix, 'Alpha Display ' || v_suffix, 'active')
  returning id into v_cust_a;
  insert into core.customer (name, status)
  values ('Step6 Fixture Bravo ' || v_suffix, 'inactive')
  returning id into v_cust_b;
  insert into core.customer (name, status)
  values ('Step6 Fixture Charlie ' || v_suffix, 'active')
  returning id into v_cust_c;
  insert into core.customer (name, status)
  values ('Step6 Fixture Delta ' || v_suffix, 'active')
  returning id into v_cust_d;
  insert into core.customer (name, status)
  values ('Step6 Fixture Echo ' || v_suffix, 'active')
  returning id into v_cust_e;

  insert into crm.customer_ext (customer_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_cust_c, 'inactive', 'Step6 fixture', now(), v_admin_profile);
  insert into pim.customer_ext (customer_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_cust_d, 'inactive', 'Step6 fixture', now(), v_admin_profile);

  insert into core.channel (code, name, status, sort_order)
  values ('S6-' || v_suffix, 'Step6 Channel ' || v_suffix, 'active', 99)
  returning id into v_channel_id;
  insert into core.customer_channel (customer_id, channel_id, assigned_by)
  values (v_cust_a, v_channel_id, v_admin_profile);

  insert into core.company_source_ref (company_id, source_system, source_table,
                                       source_id, source_code, source_name)
  values (v_cust_a, 'coldlion', 'customers', 'S6-' || v_suffix, 'S6C', 'Step6 Source Name');
  insert into core.customer_alias (customer_id, alias, alias_type)
  values (v_cust_a, 'Step6 Alias ' || v_suffix, 'other');

  -- Search + default inactive hiding.
  select api.db_data_admin_customer_list('Step6 Fixture') into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 4 then
    raise exception 'default listing must hide globally inactive customers (expected 4, got %)',
      jsonb_array_length(v_result -> 'rows');
  end if;

  select api.db_data_admin_customer_list('Step6 Fixture', null, null, null, true) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 5 then
    raise exception 'include_inactive must return all five fixture customers';
  end if;

  -- Global status filter.
  select api.db_data_admin_customer_list('Step6 Fixture', 'inactive', null, null, true) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1
     or (v_result -> 'rows' -> 0 ->> 'id')::uuid <> v_cust_b then
    raise exception 'status filter with include_inactive must return exactly Bravo';
  end if;

  -- Per-app status filters.
  select api.db_data_admin_customer_list('Step6 Fixture', null, 'crm', 'inactive', true) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1
     or (v_result -> 'rows' -> 0 ->> 'id')::uuid <> v_cust_c then
    raise exception 'crm inactive filter must return exactly Charlie';
  end if;
  select api.db_data_admin_customer_list('Step6 Fixture', null, 'pm', 'inactive', true) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1
     or (v_result -> 'rows' -> 0 ->> 'id')::uuid <> v_cust_d then
    raise exception 'pm inactive filter must return exactly Delta';
  end if;

  -- PLM filter semantics: unlinked Customers match neither value.
  select api.db_data_admin_customer_list('Step6 Fixture', null, 'plm', 'active', true) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 0 then
    raise exception 'unlinked customers must not match a plm active filter';
  end if;

  -- Sorting.
  select api.db_data_admin_customer_list('Step6 Fixture', null, null, null, true, 'name', 'asc', null, 200)
  into v_asc;
  select api.db_data_admin_customer_list('Step6 Fixture', null, null, null, true, 'name', 'desc', null, 200)
  into v_desc;
  if v_asc -> 'rows' -> 0 ->> 'name' <> 'Step6 Fixture Alpha ' || v_suffix then
    raise exception 'ascending name sort must lead with Alpha';
  end if;
  if v_desc -> 'rows' -> 0 ->> 'name' <> 'Step6 Fixture Echo ' || v_suffix then
    raise exception 'descending name sort must lead with Echo';
  end if;

  -- Cursor pagination: 5 rows at page size 2 = 3 pages, no loss, no dupes.
  v_seen := array[]::uuid[];
  v_cursor := null;
  v_pages := 0;
  loop
    select api.db_data_admin_customer_list('Step6 Fixture', null, null, null, true,
                                           'name', 'asc', v_cursor, 2)
    into v_result;
    v_pages := v_pages + 1;
    select v_seen || array(select (j ->> 'id')::uuid from jsonb_array_elements(v_result -> 'rows') j)
    into v_seen;
    v_cursor := v_result ->> 'next_cursor';
    exit when v_cursor is null;
    if v_pages > 10 then
      raise exception 'cursor pagination did not terminate';
    end if;
  end loop;
  if v_pages <> 3 then
    raise exception 'expected 3 pages for 5 rows at page size 2, got %', v_pages;
  end if;
  if coalesce(array_length(v_seen, 1), 0) <> 5 then
    raise exception 'cursor pagination returned the wrong row count';
  end if;
  if (select count(distinct x) from unnest(v_seen) x) <> 5 then
    raise exception 'cursor pagination duplicated or lost rows';
  end if;

  -- Approved row shape: channels, aliases, source refs, per-app status.
  select api.db_data_admin_customer_list('Step6 Fixture Alpha ' || v_suffix, null, null, null, true)
  into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1 then
    raise exception 'alpha search must return exactly one row';
  end if;
  v_row := v_result -> 'rows' -> 0;
  if (v_row ->> 'id')::uuid <> v_cust_a then
    raise exception 'alpha row id mismatch';
  end if;
  if jsonb_array_length(v_row -> 'channels') <> 1
     or v_row -> 'channels' -> 0 ->> 'code' <> 'S6-' || v_suffix then
    raise exception 'alpha channels must embed the fixture channel';
  end if;
  if (v_row ->> 'alias_count')::integer <> 1 then
    raise exception 'alpha alias_count must be 1';
  end if;
  if jsonb_array_length(v_row -> 'source_refs') <> 1
     or v_row -> 'source_refs' -> 0 ->> 'source_code' <> 'S6C' then
    raise exception 'alpha source_refs must embed the fixture ref';
  end if;
  if v_row ->> 'crm_status' <> 'active' or v_row ->> 'status' <> 'active' then
    raise exception 'alpha must report active global and crm status';
  end if;

  select api.db_data_admin_customer_list('Step6 Fixture Charlie ' || v_suffix, null, null, null, true)
  into v_result;
  v_row := v_result -> 'rows' -> 0;
  if v_row ->> 'crm_status' <> 'inactive'
     or v_row ->> 'crm_status_reason' <> 'Step6 fixture' then
    raise exception 'charlie must report crm inactive with reason';
  end if;

  -- Parameter validation fails closed.
  begin
    perform api.db_data_admin_customer_list(p_sort => 'name; drop table core.customer');
    raise exception 'invalid sort accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform api.db_data_admin_customer_list(p_status => 'bogus');
    raise exception 'invalid status accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform api.db_data_admin_customer_list(p_cursor => 'not-base64-cursor');
    raise exception 'invalid cursor accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform api.db_data_admin_customer_list(p_app_status => 'inactive');
    raise exception 'app status without app accepted';
  exception when invalid_parameter_value then null;
  end;

  -- ------------------------------------------------------------------
  -- Vendor fixtures and read-contract behavior.
  -- ------------------------------------------------------------------
  insert into core.customer (name, status)
  values ('Step6 Vendor Owner ' || v_suffix, 'active')
  returning id into v_company;
  insert into core.factory (name, display_name, status, company_id, country)
  values ('Step6 Factory ' || v_suffix, 'S6 Factory ' || v_suffix, 'active', v_company, 'CN')
  returning id into v_factory;
  insert into core.factory_source_ref (factory_id, source_system, source_table, source_id, source_code)
  values (v_factory, 'coldlion', 'vendors', 'S6V-' || v_suffix, 'S6V');
  insert into core.factory_alias (factory_id, alias, alias_type)
  values (v_factory, 'Step6 Factory Alias ' || v_suffix, 'other');
  insert into crm.factory_ext (factory_id, status, status_reason, status_changed_at, status_changed_by)
  values (v_factory, 'inactive', 'Step6 fixture', now(), v_admin_profile);

  select api.db_data_admin_vendor_list('Step6 Factory ' || v_suffix, null, null, null, true)
  into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1 then
    raise exception 'vendor search must return exactly one row';
  end if;
  v_row := v_result -> 'rows' -> 0;
  if (v_row ->> 'id')::uuid <> v_factory then
    raise exception 'vendor row id mismatch';
  end if;
  if v_row ->> 'company_label' <> 'Step6 Vendor Owner ' || v_suffix then
    raise exception 'vendor must expose the related customer label';
  end if;
  if (v_row ->> 'alias_count')::integer <> 1 then
    raise exception 'vendor alias_count must be 1';
  end if;
  if jsonb_array_length(v_row -> 'source_refs') <> 1 then
    raise exception 'vendor source_refs must embed the fixture ref';
  end if;
  if jsonb_exists(v_row -> 'source_refs' -> 0, 'source_name') then
    raise exception 'vendor source refs must not expose source_name';
  end if;
  if v_row ->> 'plm_status' is not null then
    raise exception 'vendor plm_status must stay null until Factory mapping exists';
  end if;
  if (v_row ->> 'plm_linked')::boolean then
    raise exception 'vendor plm_linked must be false before Factory mapping exists';
  end if;
  if v_row ->> 'crm_status' <> 'inactive' then
    raise exception 'vendor must report crm inactive';
  end if;

  select api.db_data_admin_vendor_list('Step6 Factory ' || v_suffix, null, 'crm', 'inactive', true)
  into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1 then
    raise exception 'crm-inactive vendor filter must match the fixture';
  end if;

  begin
    perform api.db_data_admin_vendor_list(p_app => 'plm', p_app_status => 'active');
    raise exception 'plm vendor filter must be rejected until Factory mapping exists';
  exception when invalid_parameter_value then null;
  end;

  -- ------------------------------------------------------------------
  -- Licensor / Property fixtures, hierarchy, and loud orphans.
  -- ------------------------------------------------------------------
  insert into core.licensor (name, code, status)
  values ('Step6 Licensor ' || v_suffix, 'S6L-' || v_suffix, 'active')
  returning id into v_licensor;
  insert into core.property (licensor_id, name, code, status)
  values (v_licensor, 'Step6 Property One ' || v_suffix, 'S6P1-' || v_suffix, 'active')
  returning id into v_prop1;
  insert into core.property (licensor_id, name, code, status)
  values (v_licensor, 'Step6 Property Two ' || v_suffix, 'S6P2-' || v_suffix, 'active')
  returning id into v_prop2;
  insert into core.property (licensor_id, name, code, status)
  values (null, 'Step6 Orphan Property ' || v_suffix, 'S6PO-' || v_suffix, 'active')
  returning id into v_orphan;
  insert into core.character (property_id, name, status)
  values (v_prop1, 'Step6 Character ' || v_suffix, 'active');
  insert into core.taxonomy_source_ref (entity_schema, entity_table, entity_id,
                                        source_system, source_table, source_id,
                                        source_code, source_name)
  values ('core', 'licensor', v_licensor, 'designflow_plm', 'merchGroups',
          'S6LID-' || v_suffix, 'S6L', 'Step6 Licensor Source');

  select api.db_data_admin_licensor_property_list('Step6 Licensor ' || v_suffix) into v_result;
  if jsonb_array_length(v_result -> 'licensors') <> 1 then
    raise exception 'licensor search must return exactly one licensor';
  end if;
  v_row := v_result -> 'licensors' -> 0;
  if (v_row ->> 'id')::uuid <> v_licensor then
    raise exception 'licensor row id mismatch';
  end if;
  if (v_row ->> 'property_count')::integer <> 2 then
    raise exception 'licensor property_count must be 2';
  end if;
  if jsonb_array_length(v_row -> 'properties') <> 2 then
    raise exception 'licensor must embed both fixture properties';
  end if;
  if jsonb_array_length(v_row -> 'source_refs') <> 1
     or v_row -> 'source_refs' -> 0 ->> 'source_system' <> 'designflow_plm' then
    raise exception 'licensor source_refs must embed the designflow_plm ref';
  end if;
  if (
    select (p ->> 'character_count')::integer
    from jsonb_array_elements(v_row -> 'properties') p
    where (p ->> 'id')::uuid = v_prop1
  ) <> 1 then
    raise exception 'property one must report one character';
  end if;

  -- Orphan surfacing is loud and structurally correct.
  if not exists (
    select 1
    from jsonb_array_elements(v_result -> 'orphan_properties') p
    where (p ->> 'id')::uuid = v_orphan
  ) then
    raise exception 'fixture orphan property must be surfaced in orphan_properties';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_result -> 'orphan_properties') p
    where p ->> 'licensor_id' is not null
  ) then
    raise exception 'orphan_properties must only contain properties without a licensor';
  end if;

  -- Every fixture property appears exactly once across the nested hierarchy
  -- plus the orphan list.
  if (
    select count(*)
    from (
      select (p ->> 'id')::uuid as pid
      from jsonb_array_elements(v_row -> 'properties') p
      union all
      select (p ->> 'id')::uuid
      from jsonb_array_elements(v_result -> 'orphan_properties') p
    ) coverage
    where pid in (v_prop1, v_prop2, v_orphan)
  ) <> 3 then
    raise exception 'every fixture property must appear under exactly one licensor or as a loud orphan';
  end if;

  -- ------------------------------------------------------------------
  -- Audit read.
  -- ------------------------------------------------------------------
  insert into app.db_data_admin_audit_event (operation_id, entity_type, entity_id, action,
                                             old_snapshot, new_snapshot, reason,
                                             actor_profile_id, succeeded)
  values (gen_random_uuid(), 'customer', v_cust_a, 'step6_fixture',
          '{"display_name":"Before"}'::jsonb, '{"display_name":"After"}'::jsonb,
          'Step6 audit read fixture', v_admin_profile, true)
  returning id into v_audit_id;

  select api.db_data_admin_audit_list('customer', v_cust_a) into v_result;
  if not exists (
    select 1
    from jsonb_array_elements(v_result -> 'rows') r
    where (r ->> 'id')::uuid = v_audit_id
  ) then
    raise exception 'audit list must return the fixture event';
  end if;
  if (v_result -> 'rows' -> 0 ->> 'id')::uuid <> v_audit_id then
    raise exception 'audit list must order newest first';
  end if;

  -- ------------------------------------------------------------------
  -- Grid state: round trip, optimistic concurrency, profile scoping.
  -- ------------------------------------------------------------------
  select api.db_data_admin_grid_state_upsert('customer', v_grid_key, '{"filters":[]}'::jsonb, null)
  into v_result;
  if (v_result ->> 'ok')::boolean is distinct from true
     or (v_result ->> 'version')::bigint is distinct from 1 then
    raise exception 'first grid state save must create version 1';
  end if;

  select api.db_data_admin_grid_state_get('customer', v_grid_key) into v_result;
  if (v_result ->> 'found')::boolean is distinct from true
     or (v_result ->> 'version')::bigint is distinct from 1 then
    raise exception 'grid state get must return the saved row';
  end if;

  select api.db_data_admin_grid_state_upsert('customer', v_grid_key, '{"filters":["global"]}'::jsonb, 1)
  into v_result;
  if (v_result ->> 'ok')::boolean is distinct from true
     or (v_result ->> 'version')::bigint is distinct from 2 then
    raise exception 'matching expected version must bump to 2';
  end if;

  select api.db_data_admin_grid_state_upsert('customer', v_grid_key, '{"filters":["stale"]}'::jsonb, 1)
  into v_result;
  if (v_result ->> 'ok')::boolean is distinct from false
     or v_result ->> 'code' <> 'version_conflict'
     or (v_result ->> 'current_version')::bigint is distinct from 2 then
    raise exception 'stale expected version must return version_conflict';
  end if;

  select api.db_data_admin_grid_state_get('customer', v_grid_key) into v_result;
  if v_result -> 'state' <> '{"filters":["global"]}'::jsonb then
    raise exception 'conflicted upsert must not overwrite stored state';
  end if;

  -- A second authorized administrator sees only their own state.
  perform set_config('request.jwt.claim.sub', v_second_admin_auth::text, true);
  select api.db_data_admin_grid_state_get('customer', v_grid_key) into v_result;
  if (v_result ->> 'found')::boolean is distinct from false then
    raise exception 'grid state must be profile-scoped';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  begin
    perform api.db_data_admin_grid_state_get('  ', 'x');
    raise exception 'blank entity_type accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform api.db_data_admin_grid_state_upsert('customer', v_grid_key, '"not-an-object"'::jsonb, null);
    raise exception 'non-object state accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
