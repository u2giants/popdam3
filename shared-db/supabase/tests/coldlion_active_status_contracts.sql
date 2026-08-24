-- Rollback-safe behavioral contracts for 20260824155745 / issue #1429.
begin;

do $$
declare
  v_lic uuid;
  v_prop uuid;
  v_conflict uuid;
  v_higher uuid;
  v_snap jsonb;
  v_result record;
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  v_expected jsonb := jsonb_build_object('hash','1230f5a12d0f2a3029f1d3df17fc5b5f','count','542','distinct_canonical','271');
begin
  -- Canonical fixtures use the real exact-column transaction guard.
  insert into plm.licensing_write_authorization
    (backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'issue-1429-contract',array['name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.licensor(name,code,status) values('1429 Licensor','ZL'||v_suffix,'active') returning id into v_lic;

  insert into plm.licensing_write_authorization
    (backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
  values
   (pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'issue-1429-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute'),
   (pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('3',64),'issue-1429-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute'),
   (pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('4',64),'issue-1429-contract',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
  insert into core.property(licensor_id,name,code,status) values(v_lic,'1429 Property','ZP'||v_suffix,'potential') returning id into v_prop;
  insert into core.property(licensor_id,name,code,status) values(v_lic,'1429 Conflict','ZC'||v_suffix,'potential') returning id into v_conflict;
  insert into core.property(licensor_id,name,code,status) values(v_lic,'1429 Higher','ZH'||v_suffix,'potential') returning id into v_higher;

  -- First mirror cycle. Every detail carries a typed boolean. The same canonical identity
  -- appears in two divisions so unanimity is tested, not assumed.
  v_snap := jsonb_build_object(
    'companyCode','ISSUE1429',
    'headers',jsonb_build_array(
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','05','mgTypeDesc','Licensor'),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','06','mgTypeDesc','Property'),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','05','mgTypeDesc','Licensor'),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','06','mgTypeDesc','Property')),
    'pairs',jsonb_build_array(
      jsonb_build_object('divisionCode','CW001','mgTypeCode','05','mgTypeDesc','Licensor','entityType','licensor'),
      jsonb_build_object('divisionCode','CW001','mgTypeCode','06','mgTypeDesc','Property','entityType','property'),
      jsonb_build_object('divisionCode','SP001','mgTypeCode','05','mgTypeDesc','Licensor','entityType','licensor'),
      jsonb_build_object('divisionCode','SP001','mgTypeCode','06','mgTypeDesc','Property','entityType','property')),
    'pages',jsonb_build_array(
      jsonb_build_object('divisionCode','CW001','mgTypeCode','05','terminalReached',true),
      jsonb_build_object('divisionCode','CW001','mgTypeCode','06','terminalReached',true),
      jsonb_build_object('divisionCode','SP001','mgTypeCode','05','terminalReached',true),
      jsonb_build_object('divisionCode','SP001','mgTypeCode','06','terminalReached',true)),
    'config',jsonb_build_object('headerDivisions',jsonb_build_array('CW001','SP001'),'requiredDivisions',jsonb_build_array('CW001','SP001'),'licensorFloor',1,'propertyFloor',1),
    'details',jsonb_build_array(
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','05','mgCode','L','mgDesc','1429 Licensor','active',false),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','05','mgCode','L','mgDesc','1429 Licensor','active',false),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','06','mgCode','P','mgDesc','1429 Property','active',true),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','06','mgCode','P','mgDesc','1429 Property','active',true),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','06','mgCode','C','mgDesc','1429 Conflict','active',true),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','06','mgCode','C','mgDesc','1429 Conflict','active',false),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','CW001','mgTypeCode','06','mgCode','H','mgDesc','1429 Higher','active',false),
      jsonb_build_object('companyCode','ISSUE1429','divisionCode','SP001','mgTypeCode','06','mgCode','H','mgDesc','1429 Higher','active',false)));
  perform * from plm.sync_coldlion_licensors_properties(v_snap,'mirror_only',null);

  update plm.erp_licensor set licensor_id=v_lic,resolution_status='manually_matched' where company_code='ISSUE1429';
  update plm.erp_property set property_id=case mg_code when 'P' then v_prop when 'C' then v_conflict else v_higher end,
         resolution_status='manually_matched' where company_code='ISSUE1429';
  insert into core.taxonomy_source_ref(entity_table,entity_id,source_system,source_table,source_id)
    values('property',v_higher,'authorized_licensor_source','contract','issue-1429-'||v_suffix);

  select * into v_result from plm.promote_coldlion_source_owned(v_expected,null,false);
  if (select status::text from core.licensor where id=v_lic) <> 'inactive' then raise exception 'active->inactive failed'; end if;
  if (select status::text from core.property where id=v_prop) <> 'active' then raise exception 'inactive/potential->active failed'; end if;
  if (select status::text from core.property where id=v_conflict) <> 'potential' then raise exception 'conflicting division flags did not abstain'; end if;
  if (select status::text from core.property where id=v_higher) <> 'potential' then raise exception 'higher source authority did not abstain'; end if;

  -- Re-upsert the SAME mirror keys with opposite unanimous flags. This proves the importer
  -- updates existing source_active values (the exact regression the string-only test missed).
  v_snap := jsonb_set(v_snap,'{details}',(
    select jsonb_agg(case when e->>'mgCode' in ('L','P') then jsonb_set(e,'{active}',to_jsonb(not (e->>'active')::boolean)) else e end)
    from jsonb_array_elements(v_snap->'details') e));
  perform * from plm.sync_coldlion_licensors_properties(v_snap,'mirror_only',null);
  if exists(select 1 from plm.erp_licensor where company_code='ISSUE1429' and source_active is not true) then raise exception 'existing licensor mirror source_active was not updated'; end if;
  if exists(select 1 from plm.erp_property where company_code='ISSUE1429' and mg_code='P' and source_active is not false) then raise exception 'existing property mirror source_active was not updated'; end if;

  select * into v_result from plm.promote_coldlion_source_owned(v_expected,null,false);
  if (select status::text from core.licensor where id=v_lic) <> 'active' then raise exception 'inactive->active failed'; end if;
  if (select status::text from core.property where id=v_prop) <> 'inactive' then raise exception 'active->inactive failed'; end if;
  raise notice 'issue #1429 ColdLion active-status behavioral contracts PASS';
end
$$;

rollback;
