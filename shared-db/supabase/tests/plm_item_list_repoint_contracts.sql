-- Issue #2466 contract: invented rows only; all writes roll back.

begin;

do $$
declare
  v_run uuid;
  v_item uuid;
  v_duplicate uuid;
  v_legacy uuid;
  v_licensor uuid;
  v_property uuid;
  v_count integer;
  v_row record;
  v_columns text[];
  v_viewdef text;
  v_reloptions text[];
begin
  select array_agg(column_name order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'api' and table_name = 'plm_item_list';

  if v_columns is distinct from array[
    'id','source_id','style_number','item_description','mg_category',
    'mg01_code','mg02_code','mg03_code','mg04_code','mg05_code','mg06_code',
    'size_code','licensor_code','property_code','division_code','prepack_code',
    'prepack_codes','dismissed','erp_updated_at','synced_at','source_system'
  ]::text[] then
    raise exception '#2466: api.plm_item_list column contract changed: %', v_columns;
  end if;

  select pg_get_viewdef('api.plm_item_list'::regclass, true) into v_viewdef;
  if v_viewdef not like '%plm.item item%'
     or v_viewdef not like '%core.licensor%'
     or v_viewdef not like '%core.property%'
     or lower(v_viewdef) not like '%row_number() over%'
     or v_viewdef not like '%legacy_rank%' then
    raise exception '#2466: api.plm_item_list does not carry its canonical item/attribution joins';
  end if;

  select c.reloptions into v_reloptions
  from pg_class c where c.oid = 'api.plm_item_list'::regclass;
  if v_reloptions is null
     or not ('security_invoker=false' = any(v_reloptions))
     or not ('security_barrier=true' = any(v_reloptions)) then
    raise exception '#2466: api.plm_item_list is not a definer/barrier serving view: %', v_reloptions;
  end if;
  if not has_table_privilege('authenticated', 'api.plm_item_list', 'select') then
    raise exception '#2466: authenticated lacks SELECT on api.plm_item_list';
  end if;
  if has_table_privilege('authenticated', 'coldlion.item_detail', 'select') then
    raise exception '#2466: authenticated can bypass the serving view and read coldlion.item_detail';
  end if;

  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
          gen_random_uuid(), repeat('2', 64), 'issue-2466-contract',
          array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status)
  values ('ZZ2466 LICENSOR', 'ZZ2466LIC', 'active') returning id into v_licensor;
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
          gen_random_uuid(), repeat('4', 64), 'issue-2466-contract',
          array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.property (licensor_id, name, code, status)
  values (v_licensor, 'ZZ2466 PROPERTY', 'ZZ2466PROP', 'potential') returning id into v_property;

  insert into plm.item (
    item_number, style_number, description, licensor_id, property_id,
    source_system, source_id, raw, updated_at
  ) values (
    'ZZ2466ITEM', null, 'ZZ2466 DESCRIPTION', v_licensor, v_property,
    'coldlion', 'ZZCO|ZZ001|ZZ2466ITEM',
    jsonb_build_object(
      'companyCode','ZZCO','divisionCode','ZZ001','itemNo','ZZ2466ITEM',
      'licensorCode','RAW-LIC','propertyCode','RAW-PROP',
      'mGCategory','ZZCAT','merchGroup01','ZZ01','merchGroup02','ZZ02',
      'merchGroup03','ZZ03','merchGroup04','ZZ04','merchGroup05','ZZ05',
      'merchGroup06','ZZ06','sizeRangeCode','ZZSIZE',
      'modTime','2024-05-06T07:08:09Z'
    ),
    '2026-09-09T12:00:00Z'
  ) returning id into v_item;

  insert into plm.legacy_erp_item_identity (id, external_id)
  values (gen_random_uuid(), 'ZZ2466ITEM') returning id into v_legacy;

  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/itemDetails', 'ZZCO', 'ZZ2466') returning id into v_run;
  insert into coldlion.item_header (
    company_code, division_code, item_no, run_id, fetched_at, source_hash,
    first_seen_at, last_seen_at
  ) values (
    'ZZCO','ZZ001','ZZ2466ITEM',v_run,now(),repeat('a',64),now(),now()
  );
  insert into coldlion.item_detail (
    company_code, division_code, item_no, item_pkey, pre_pack_code,
    run_id, fetched_at, source_hash, first_seen_at, last_seen_at
  ) values
    ('ZZCO','ZZ001','ZZ2466ITEM','ZZSKU1',' ZZPACK2 ',v_run,now(),repeat('b',64),now(),now()),
    ('ZZCO','ZZ001','ZZ2466ITEM','ZZSKU2','ZZPACK1',v_run,now(),repeat('c',64),now(),now()),
    ('ZZCO','ZZ001','ZZ2466ITEM','ZZSKU3','ZZPACK1',v_run,now(),repeat('d',64),now(),now());

  select * into strict v_row from api.plm_item_list where source_id = 'ZZ2466ITEM';
  if (v_row.id, v_row.source_id, v_row.style_number, v_row.item_description,
      v_row.mg_category, v_row.mg01_code, v_row.mg06_code, v_row.size_code,
      v_row.licensor_code, v_row.property_code, v_row.division_code,
      v_row.prepack_code, v_row.prepack_codes, v_row.dismissed,
      v_row.erp_updated_at, v_row.synced_at, v_row.source_system)
     is distinct from
     (v_legacy,'ZZ2466ITEM','ZZ2466ITEM','ZZ2466 DESCRIPTION','ZZCAT','ZZ01','ZZ06','ZZSIZE',
      'ZZ2466LIC','ZZ2466PROP','ZZ001','ZZPACK1','["ZZPACK1", "ZZPACK2"]'::jsonb,false,
      '2024-05-06T07:08:09Z'::timestamptz,'2026-09-09T12:00:00Z'::timestamptz,'coldlion') then
    raise exception '#2466/#2644: canonical mapping/legacy identity/prepack/PopDAM-owned dismissal contract failed: %', row_to_json(v_row);
  end if;

  insert into plm.item (item_number, description, source_system, source_id, raw)
  values ('ZZ2466ITEM', 'ZZ2466 SAME NUMBER OTHER DIVISION', 'coldlion',
          'ZZCO|ZZ002|ZZ2466ITEM',
          '{"companyCode":"ZZCO","divisionCode":"ZZ002","itemNo":"ZZ2466ITEM"}')
  returning id into v_duplicate;
  select count(*) into v_count
  from api.plm_item_list
  where source_id = 'ZZ2466ITEM'
    and id in (v_legacy, v_duplicate);
  if v_count <> 2
     or (select count(*) from api.plm_item_list where source_id = 'ZZ2466ITEM') <> 2
     or (select count(distinct id) from api.plm_item_list where source_id = 'ZZ2466ITEM') <> 2 then
    raise exception '#2466: cross-division item numbers did not retain exactly one legacy UUID and unique row IDs';
  end if;

  insert into plm.item (item_number, description, source_system, source_id, raw)
  values ('ZZ2466NULL', 'ZZ2466 UNRESOLVED', 'coldlion', 'ZZCO|ZZ001|ZZ2466NULL',
          '{"companyCode":"ZZCO","divisionCode":"ZZ001","itemNo":"ZZ2466NULL"}')
  returning id into v_item;

  select * into strict v_row from api.plm_item_list where id = v_item;
  if v_row.licensor_code is not null or v_row.property_code is not null
     or v_row.prepack_code is not null or v_row.prepack_codes is not null
     or v_row.dismissed is distinct from false then
    raise exception '#2466: unresolved/new-item null/default contract failed: %', row_to_json(v_row);
  end if;
  if v_row.id is distinct from v_item then
    raise exception '#2466: canonical-only item did not fall back to its plm.item UUID: %', row_to_json(v_row);
  end if;

  insert into plm.item (item_number, description, source_system, source_id, raw)
  values ('ZZ2466OTHER', 'ZZ2466 OTHER SOURCE', 'manual', 'ZZ2466OTHER', '{}'::jsonb);
  if exists (select 1 from api.plm_item_list where source_id = 'ZZ2466OTHER') then
    raise exception '#2466: non-ColdLion plm.item leaked into api.plm_item_list';
  end if;

  execute 'set local role authenticated';
  select count(*) into v_count from api.plm_item_list where source_id in ('ZZ2466ITEM','ZZ2466NULL');
  execute 'set local role none';
  if v_count <> 3 then
    raise exception '#2466: authenticated serving-view read returned % fixture rows, expected 3', v_count;
  end if;

  raise notice '#2466/#2644 PASSED: 21 columns, protected authenticated serving, legacy identity, canonical mappings, direct prepacks, source filter, null attribution and PopDAM-owned dismissal state.';
end;
$$;

rollback;
