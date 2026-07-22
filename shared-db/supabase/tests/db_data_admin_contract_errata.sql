-- Preview/disposable verification for DB Data Admin read-contract errata.
-- All fixtures and identity changes roll back.
begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_role_id uuid;
  v_admin_profile uuid;
  v_admin_auth uuid;
  v_denied_profile uuid;
  v_denied_auth uuid;
  v_customer uuid;
  v_tie_customer uuid;
  v_null_customer uuid;
  v_other_customer uuid;
  v_vendor uuid;
  v_channel uuid;
  v_result jsonb;
  v_detail jsonb;
begin
  -- Object shape and grants.
  if to_regprocedure('api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer)') is not null then
    raise exception 'obsolete nine-argument Customer list signature still exists';
  end if;
  if to_regprocedure('api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer,uuid)') is null then
    raise exception 'ten-argument Customer list signature is missing';
  end if;
  if not has_function_privilege(
      'authenticated',
      'api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer,uuid)'::regprocedure,
      'execute')
     or has_function_privilege(
      'public',
      'api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer,uuid)'::regprocedure,
      'execute') then
    raise exception 'Customer list execute grants are incorrect';
  end if;

  if to_regprocedure('app.db_data_admin_latest_plm_customer_status(uuid)') is null
     or has_function_privilege(
       'public', 'app.db_data_admin_latest_plm_customer_status(uuid)'::regprocedure, 'execute')
     or has_function_privilege(
       'authenticated', 'app.db_data_admin_latest_plm_customer_status(uuid)'::regprocedure, 'execute') then
    raise exception 'latest PLM helper must exist and remain private';
  end if;

  if to_regprocedure('api.db_data_admin_customer_detail(uuid)') is null
     or to_regprocedure('api.db_data_admin_vendor_detail(uuid)') is null then
    raise exception 'detail RPCs are missing';
  end if;
  if has_function_privilege('public', 'api.db_data_admin_customer_detail(uuid)'::regprocedure, 'execute')
     or has_function_privilege('public', 'api.db_data_admin_vendor_detail(uuid)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'api.db_data_admin_customer_detail(uuid)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'api.db_data_admin_vendor_detail(uuid)'::regprocedure, 'execute') then
    raise exception 'detail RPC execute grants are incorrect';
  end if;

  -- Reuse preview identities because invitation-only signup prevents synthetic
  -- auth.users. All role/access changes are transaction-scoped.
  select p.id, p.auth_user_id into v_admin_profile, v_admin_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  select p.id, p.auth_user_id into v_denied_profile, v_denied_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  if v_denied_profile is null then
    raise exception 'fixture requires two active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r
  where r.slug = 'administrator'::app.app_role;
  delete from app.user_role
  where profile_id in (v_admin_profile, v_denied_profile) and role_id = v_role_id;
  delete from app.app_access
  where profile_id in (v_admin_profile, v_denied_profile) and app = 'admin';
  insert into app.user_role (profile_id, role_id)
  values (v_admin_profile, v_role_id), (v_denied_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_admin_profile, 'admin');

  perform set_config('request.jwt.claim.sub', v_denied_auth::text, true);
  begin
    perform api.db_data_admin_customer_detail(gen_random_uuid());
    raise exception 'administrator without explicit admin access reached Customer detail';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  insert into core.customer (name, display_name, status)
  values ('Errata Latest ' || v_suffix, 'Errata Latest', 'active') returning id into v_customer;
  insert into core.customer (name, status)
  values ('Errata Tie ' || v_suffix, 'active') returning id into v_tie_customer;
  insert into core.customer (name, status)
  values ('Errata Null ' || v_suffix, 'active') returning id into v_null_customer;
  insert into core.customer (name, status)
  values ('Errata Other ' || v_suffix, 'active') returning id into v_other_customer;

  insert into plm.customer_import (
    plm_customer_id, company_id, customer_name, status, imported_at, updated_at
  ) values
    ('ERR-OLD-' || v_suffix, v_customer, 'Errata Latest', 'ACTIVE',
     '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
    ('ERR-NEW-' || v_suffix, v_customer, 'Errata Latest', 'INACTIVE',
     '2026-02-01 00:00:00+00', '2026-02-01 00:00:00+00'),
    ('ERR-TIE-A-' || v_suffix, v_tie_customer, 'Errata Tie', 'ACTIVE',
     '2026-03-01 00:00:00+00', '2026-03-01 00:00:00+00'),
    ('ERR-TIE-Z-' || v_suffix, v_tie_customer, 'Errata Tie', 'INACTIVE',
     '2026-03-01 00:00:00+00', '2026-03-01 00:00:00+00'),
    ('ERR-NULL-' || v_suffix, v_null_customer, 'Errata Null', null,
     '2026-04-01 00:00:00+00', '2026-04-01 00:00:00+00');

  select api.db_data_admin_customer_list(
    p_search => 'Errata Latest ' || v_suffix,
    p_include_inactive => true
  ) into v_result;
  if v_result -> 'rows' -> 0 ->> 'plm_status' <> 'INACTIVE' then
    raise exception 'display did not use deterministic latest PLM status';
  end if;
  select api.db_data_admin_customer_list(
    p_search => 'Errata Latest ' || v_suffix,
    p_app => 'plm', p_app_status => 'active', p_include_inactive => true
  ) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 0 then
    raise exception 'older ACTIVE PLM row incorrectly matched active filter';
  end if;
  select api.db_data_admin_customer_list(
    p_search => 'Errata Latest ' || v_suffix,
    p_app => 'plm', p_app_status => 'inactive', p_include_inactive => true
  ) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1 then
    raise exception 'latest INACTIVE PLM row did not match inactive filter';
  end if;

  if app.db_data_admin_latest_plm_customer_status(v_tie_customer) <> 'INACTIVE' then
    raise exception 'PLM status tie-breaker is not deterministic';
  end if;
  if app.db_data_admin_latest_plm_customer_status(v_null_customer) is not null then
    raise exception 'null PLM status must remain unknown';
  end if;
  select api.db_data_admin_customer_list(
    p_search => 'Errata Null ' || v_suffix,
    p_app => 'plm', p_app_status => 'inactive', p_include_inactive => true
  ) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 0 then
    raise exception 'unknown PLM status incorrectly matched inactive filter';
  end if;

  insert into core.channel (code, name, status, sort_order)
  values ('ERR-' || v_suffix, 'Errata Channel ' || v_suffix, 'active', 999)
  returning id into v_channel;
  insert into core.customer_channel (customer_id, channel_id, assigned_by)
  values (v_customer, v_channel, v_admin_profile);
  select api.db_data_admin_customer_list(
    p_search => 'Errata', p_include_inactive => true, p_channel_id => v_channel
  ) into v_result;
  if jsonb_array_length(v_result -> 'rows') <> 1
     or (v_result -> 'rows' -> 0 ->> 'id')::uuid <> v_customer then
    raise exception 'Channel filter did not return exactly the assigned Customer';
  end if;

  insert into core.customer_alias (
    customer_id, alias, alias_type, source_system, notes, created_at
  ) values
    (v_customer, 'Zulu ' || v_suffix, 'other', 'manual', 'second', '2026-02-01'),
    (v_customer, 'Alpha ' || v_suffix, 'legacy_name', 'coldlion', 'first', '2026-01-01');
  insert into core.company_source_ref (
    company_id, source_system, source_table, source_id, source_code, source_name
  ) values (
    v_customer, 'errata', 'customers', v_suffix, 'ERR', 'Errata Source'
  );
  select api.db_data_admin_customer_detail(v_customer) into v_detail;
  if v_detail -> 'aliases' -> 0 ->> 'alias' <> 'Alpha ' || v_suffix
     or v_detail -> 'aliases' -> 0 ->> 'alias_type' <> 'legacy_name'
     or v_detail -> 'aliases' -> 0 ->> 'source_system' <> 'coldlion'
     or v_detail -> 'source_refs' -> 0 ->> 'source_name' <> 'Errata Source' then
    raise exception 'Customer detail did not return ordered alias metadata and source refs';
  end if;

  insert into core.factory (name, code, status)
  values ('Errata Vendor ' || v_suffix, 'EV-' || v_suffix, 'active')
  returning id into v_vendor;
  insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
  values (v_vendor, 'Errata Vendor Alias ' || v_suffix, 'dba', 'manual', 'fixture');
  insert into core.factory_source_ref (
    factory_id, source_system, source_table, source_id, source_code
  ) values (v_vendor, 'errata', 'vendors', v_suffix, 'EV');
  select api.db_data_admin_vendor_detail(v_vendor) into v_detail;
  if v_detail -> 'aliases' -> 0 ->> 'alias_type' <> 'dba'
     or v_detail -> 'source_refs' -> 0 ? 'source_name' then
    raise exception 'Vendor detail shape is incorrect or leaked source_name';
  end if;

  begin
    perform api.db_data_admin_customer_detail(gen_random_uuid());
    raise exception 'unknown Customer id did not fail closed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform api.db_data_admin_vendor_detail(null);
    raise exception 'null Vendor id did not fail closed';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
