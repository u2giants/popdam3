-- Rollback-safe Step 9 contract test. Run on preview only after migration 20260722194000.
begin;
do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  v_profile uuid; v_auth uuid; v_role uuid;
  v_s uuid; v_l uuid; v_vs uuid; v_vl uuid; v_channel uuid;
  v_preview jsonb; v_result jsonb; v_token text; v_op uuid := gen_random_uuid();
begin
  if to_regprocedure('api.db_data_admin_preview_customer_merge(uuid,uuid)') is null
     or to_regprocedure('api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb)') is null
     or to_regprocedure('api.db_data_admin_preview_vendor_merge(uuid,uuid)') is null
     or to_regprocedure('api.db_data_admin_merge_vendor(uuid,uuid,text,uuid,text,jsonb)') is null then
    raise exception 'Step 9 RPC signatures are missing';
  end if;
  if has_function_privilege('public','api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb)'::regprocedure,'execute')
     or not has_function_privilege('authenticated','api.db_data_admin_merge_customer(uuid,uuid,text,uuid,text,jsonb)'::regprocedure,'execute') then
    raise exception 'merge execute grants are incorrect';
  end if;
  if not exists(select 1 from app.db_data_admin_feature_gate where feature='merge_execute') then
    raise exception 'merge gate is missing';
  end if;

  select p.id,p.auth_user_id into v_profile,v_auth from app.profile p
  where p.status='active' and p.auth_user_id is not null order by p.created_at,p.id limit 1;
  select id into v_role from app.role where slug='administrator'::app.app_role;
  delete from app.user_role where profile_id=v_profile and role_id=v_role;
  delete from app.app_access where profile_id=v_profile and app='admin';
  insert into app.user_role(profile_id,role_id) values(v_profile,v_role);
  insert into app.app_access(profile_id,app) values(v_profile,'admin');
  perform set_config('request.jwt.claim.sub',v_auth::text,true);

  insert into core.customer(name,display_name,status) values('Merge survivor '||v_suffix,'Survivor','active') returning id into v_s;
  insert into core.customer(name,display_name,status) values('Merge loser '||v_suffix,'Loser','active') returning id into v_l;
  insert into crm.customer_ext(customer_id,status,status_reason,status_changed_at,status_changed_by)
    values(v_s,'inactive','survivor reason',now(),v_profile),(v_l,'inactive','loser reason',now(),v_profile);
  insert into core.channel(code,name) values('M'||v_suffix,'Merge channel '||v_suffix) returning id into v_channel;
  insert into core.customer_channel(customer_id,channel_id) values(v_l,v_channel);
  insert into core.company_source_ref(company_id,source_system,source_table,source_id,source_code)
    values(v_l,'step9-test','customers',v_suffix,'OLD-'||v_suffix);

  v_preview:=api.db_data_admin_preview_customer_merge(v_s,v_l);
  if not (v_preview->>'success')::boolean or jsonb_array_length(v_preview#>'{preview,conflicts}')=0 then
    raise exception 'customer preview did not expose extension conflict: %',v_preview;
  end if;
  if coalesce((v_preview#>>array['preview','affected_counts','core.company_source_ref.company_id'])::integer,0)<>1 then
    raise exception 'customer preview count is wrong: %',v_preview;
  end if;

  update app.db_data_admin_feature_gate set enabled=false where feature='merge_execute';
  v_result:=api.db_data_admin_merge_customer(v_s,v_l,v_preview->>'preview_token',gen_random_uuid(),'gate test',jsonb_build_object('crm.status_reason','survivor'));
  if v_result->>'code'<>'writes_disabled' then raise exception 'disabled gate was bypassed: %',v_result; end if;

  update app.db_data_admin_feature_gate set enabled=true where feature='merge_execute';
  v_result:=api.db_data_admin_merge_customer(v_s,v_l,'stale',gen_random_uuid(),'stale test',jsonb_build_object('crm.status_reason','survivor'));
  if v_result->>'code'<>'stale_preview' then raise exception 'stale preview was accepted: %',v_result; end if;

  v_token:=v_preview->>'preview_token';
  v_result:=api.db_data_admin_merge_customer(v_s,v_l,v_token,v_op,'verified duplicate',jsonb_build_object('crm.status_reason','survivor'));
  if not (v_result->>'success')::boolean or exists(select 1 from core.customer where id=v_l) then
    raise exception 'customer merge failed: %',v_result;
  end if;
  if not exists(select 1 from core.company_source_ref where company_id=v_s and source_id=v_suffix)
     or not exists(select 1 from core.customer_channel where customer_id=v_s and channel_id=v_channel)
     or not exists(select 1 from core.customer_alias where customer_id=v_s and normalized_alias=lower('Merge loser '||v_suffix)) then
    raise exception 'customer old identifiers or links were not transferred';
  end if;
  v_result:=api.db_data_admin_merge_customer(v_s,v_l,v_token,v_op,'verified duplicate',jsonb_build_object('crm.status_reason','survivor'));
  if not coalesce((v_result->>'idempotent_replay')::boolean,false) then raise exception 'customer retry was not idempotent'; end if;

  insert into core.factory(name,code,status) values('Vendor survivor '||v_suffix,'VS-'||v_suffix,'active') returning id into v_vs;
  insert into core.factory(name,code,status) values('Vendor loser '||v_suffix,'VL-'||v_suffix,'active') returning id into v_vl;
  insert into core.factory_source_ref(factory_id,source_system,source_table,source_id,source_code)
    values(v_vl,'step9-test','vendors',v_suffix,'VL-'||v_suffix);
  v_preview:=api.db_data_admin_preview_vendor_merge(v_vs,v_vl);
  v_result:=api.db_data_admin_merge_vendor(v_vs,v_vl,v_preview->>'preview_token',gen_random_uuid(),'verified vendor duplicate','{}');
  if not (v_result->>'success')::boolean or exists(select 1 from core.factory where id=v_vl)
     or not exists(select 1 from core.factory_source_ref where factory_id=v_vs and source_id=v_suffix) then
    raise exception 'vendor merge or old source reference failed: %',v_result;
  end if;
end $$;
rollback;
