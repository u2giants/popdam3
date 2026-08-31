begin;

do $$
declare
  v_auth uuid; v_profile uuid; v_role uuid;
  v_lic uuid; v_property uuid; v_updated timestamptz; v_op uuid:=gen_random_uuid();
  v_invalid_op uuid:=gen_random_uuid(); v_missing_op uuid:=gen_random_uuid();
  v_stale_op uuid:=gen_random_uuid(); v_noop_op uuid:=gen_random_uuid();
  v_result jsonb; v_authz uuid; v_suffix text:=substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  -- Null identity must fail closed.
  begin
    perform api.db_data_admin_set_property_status(gen_random_uuid(),'probe',gen_random_uuid(),'active',now());
    raise exception 'null identity was admitted';
  exception when insufficient_privilege then null; end;

  select id,auth_user_id into v_profile,v_auth from app.profile
  where status='active' and auth_user_id is not null order by created_at,id limit 1;
  if v_profile is null then raise exception 'fixture requires an active authenticated profile'; end if;
  select id into v_role from app.role where slug='licensing';
  delete from app.user_role where profile_id=v_profile;
  delete from app.app_access where profile_id=v_profile and app in ('plm','admin');
  insert into app.user_role(profile_id,role_id) values(v_profile,v_role);

  -- Role alone is insufficient; explicit PLM/admin access is mandatory.
  perform set_config('request.jwt.claim.sub',v_auth::text,true);
  begin
    perform api.db_data_admin_set_property_status(gen_random_uuid(),'probe',gen_random_uuid(),'active',now());
    raise exception 'licensing role without app access was admitted';
  exception when insufficient_privilege then null; end;
  insert into app.app_access(profile_id,app) values(v_profile,'plm');

  insert into plm.licensing_write_authorization
    (backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values(pg_backend_pid(),txid_current(),'core.licensor','licensing_review_create',gen_random_uuid(),
    repeat('1',64),'issue-1952-test',array['name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.licensor(name,code,status) values('Issue 1952', 'I'||v_suffix,'active') returning id into v_lic;
  insert into plm.licensing_write_authorization
    (backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),
    repeat('2',64),'issue-1952-test',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.property(licensor_id,name,code,status)
    values(v_lic,'Issue 1952 Property','P'||v_suffix,'potential') returning id,updated_at into v_property,v_updated;

  -- Invalid states, missing rows and stale tokens never create authority.
  v_result:=api.db_data_admin_set_property_status(v_invalid_op,'invalid',v_property,'potential',v_updated);
  if v_result->>'code'<>'validation' then raise exception 'invalid status was not refused'; end if;
  v_result:=api.db_data_admin_set_property_status(v_missing_op,'missing',gen_random_uuid(),'active',v_updated);
  if v_result->>'code'<>'not_found' then raise exception 'missing Property was not refused'; end if;
  v_result:=api.db_data_admin_set_property_status(v_stale_op,'stale',v_property,'active',v_updated-interval '1 second');
  if v_result->>'code'<>'stale_token' then raise exception 'stale token was not refused'; end if;
  if exists(select 1 from plm.licensing_write_authorization
      where plan_id in (v_invalid_op,v_missing_op,v_stale_op)) then
    raise exception 'a refused request created licensing authority';
  end if;

  v_result:=api.db_data_admin_set_property_status(v_op,'activate',v_property,'active',v_updated);
  if v_result->>'success'<>'true' or v_result->>'idempotent_replay'<>'false' then raise exception 'valid transition failed'; end if;
  v_authz:=(v_result->>'authorization_id')::uuid;
  if (select status::text from core.property where id=v_property)<>'active' then raise exception 'status did not change'; end if;
  if not exists(select 1 from plm.licensing_write_authorization where id=v_authz and consumed_at is not null
    and protected_columns=array['status']::text[]) then raise exception 'exact authorization was not consumed'; end if;
  if not exists(select 1 from plm.licensing_write_guard_audit where authorization_id=v_authz
    and protected_columns=array['status']::text[]) then raise exception 'licensing audit missing'; end if;
  if not exists(select 1 from app.db_data_admin_audit_event where operation_id=v_op
    and old_snapshot->>'status'='potential' and new_snapshot->>'status'='active') then raise exception 'admin audit missing'; end if;

  select updated_at into v_updated from core.property where id=v_property;
  v_result:=api.db_data_admin_set_property_status(v_noop_op,'already active',v_property,'active',v_updated);
  if v_result->>'code'<>'no_changes' then raise exception 'no-change request was not refused'; end if;
  if exists(select 1 from plm.licensing_write_authorization where plan_id=v_noop_op) then
    raise exception 'no-change refusal created licensing authority';
  end if;

  v_result:=api.db_data_admin_set_property_status(v_op,'activate',v_property,'active',
    (select (old_snapshot->>'updated_at')::timestamptz from app.db_data_admin_audit_event
     where operation_id=v_op and operation_item_key='primary'));
  if v_result->>'idempotent_replay'<>'true' then raise exception 'idempotent replay failed'; end if;
  if (select count(*) from plm.licensing_write_authorization where plan_id=v_op)<>1 then raise exception 'replay created authority'; end if;

  begin
    perform api.db_data_admin_set_property_status(v_op,'activate another way',v_property,'active',
      (select (old_snapshot->>'updated_at')::timestamptz from app.db_data_admin_audit_event
       where operation_id=v_op and operation_item_key='primary'));
    raise exception 'divergent-reason replay was admitted';
  exception when unique_violation then null; end;
  begin
    perform api.db_data_admin_set_property_status(v_op,'activate',v_property,'inactive',
      (select (old_snapshot->>'updated_at')::timestamptz from app.db_data_admin_audit_event
       where operation_id=v_op and operation_item_key='primary'));
    raise exception 'divergent-status replay was admitted';
  exception when unique_violation then null; end;
  begin
    perform api.db_data_admin_set_property_status(v_op,'activate',v_property,'active',
      (select (old_snapshot->>'updated_at')::timestamptz - interval '1 second'
       from app.db_data_admin_audit_event
       where operation_id=v_op and operation_item_key='primary'));
    raise exception 'divergent-token replay was admitted';
  exception when unique_violation then null; end;

  if has_function_privilege('anon','api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz)','EXECUTE')
     or has_function_privilege('service_role','api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated','api.db_data_admin_set_property_status(uuid,text,uuid,text,timestamptz)','EXECUTE') then
    raise exception 'RPC grants are not authenticated-only';
  end if;
  raise notice 'db_data_admin_property_status_api: OK';
end $$;

rollback;
