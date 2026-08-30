-- Issue #1380. All fixture labels and identifiers are synthetic. Always rolled back.
begin;

do $contracts$
declare
  v_property uuid := '13800000-0000-4000-8000-000000000021';
  v_character uuid := '13800000-0000-4000-8000-000000000022';
  v_licensor uuid := '13800000-0000-4000-8000-000000000020';
  v_capture uuid := '13800000-0000-4000-8000-000000000001';
  v_asset uuid := '13800000-0000-4000-8000-000000000011';
  v_style uuid := '13800000-0000-4000-8000-000000000012';
  v_char uuid := '13800000-0000-4000-8000-000000000013';
  v_result record;
begin
  if to_regprocedure('plm.sync_wb_canonical_relationship_edges(text,jsonb)') is null then
    raise exception 'guarded Warner canonical relationship sync is absent';
  end if;
  if has_function_privilege('authenticated', 'plm.sync_wb_canonical_relationship_edges(text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'plm.sync_wb_canonical_relationship_edges(text,jsonb)', 'execute') then
    raise exception 'Warner sync execution gate changed';
  end if;
  if has_table_privilege('service_role', 'plm.wb_asset_canonical_property_edge', 'insert')
     or has_table_privilege('service_role', 'plm.wb_style_guide_canonical_property_edge', 'update')
     or has_table_privilege('service_role', 'plm.wb_character_canonical_property_edge', 'delete') then
    raise exception 'direct evidence-table writes are not refused';
  end if;
  if not coalesce((select 'security_invoker=true'=any(reloptions) from pg_class where oid='api.wb_canonical_relationship_candidates'::regclass),false) then
    raise exception 'candidate view is not security invoker';
  end if;
  if (select udt_name from information_schema.columns
      where table_schema='api' and table_name='wb_canonical_relationship_candidates'
        and column_name='canonical_property_id') <> 'uuid' then
    raise exception 'candidate view did not expose the canonical Property UUID contract';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='api' and table_name='wb_canonical_relationship_candidates' and column_name in ('label','raw','source_url')) then
    raise exception 'licensed payload field escaped into candidate view';
  end if;

  insert into core.licensor(id,code,name,status)
  values (v_licensor,'SYN-1380','Synthetic Licensor 1380','active');
  insert into core.property(id,licensor_id,code,name,status)
  values (v_property,v_licensor,'SYN-PROP-1380','Synthetic Property 1380','active');
  insert into core.character(id,licensor_id,code,name,status)
  values (v_character,v_licensor,'SYN-CHAR-1380','Synthetic Character 1380','active');

  insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
  values (v_capture,0,'wb_asset_normalized','loading',date '2099-08-23','synthetic',repeat('a',64),1,'synthetic','https://example.invalid',now());
  insert into plm.wb_asset_normalized(id,source_namespace,source_id,file_name,source_path,capture_id,source_url,raw,source_hash)
  values(v_asset,'synthetic_asset','asset-1','invented.bin','invented/path',v_capture,'https://example.invalid','{}','asset-hash');
  insert into plm.wb_style_guide_normalized(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash)
  values(v_style,'synthetic_style','style-1','Synthetic Style','source_id',v_capture,'https://example.invalid','{}','style-hash');
  insert into plm.wb_character_normalized(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash)
  values(v_char,'synthetic_character','character-1','Synthetic Character','source_id',v_capture,'https://example.invalid','{}','character-hash');

  select * into v_result from plm.sync_wb_canonical_relationship_edges('asset', jsonb_build_array(jsonb_build_object(
    'source_entity_id',v_asset,'canonical_property_id',v_property,'assertion_type','direct_warner_source',
    'evidence_source','synthetic-direct','evidence_hash','hash-1','source_active',true,'within_entitlement',true,
    'observed_at','2099-08-23T00:00:00Z')));
  if v_result.rows_seen<>1 or v_result.rows_upserted<>1 then raise exception 'asset sync counts changed'; end if;

  -- Same natural evidence key updates rather than duplicates.
  perform plm.sync_wb_canonical_relationship_edges('asset', jsonb_build_array(jsonb_build_object(
    'source_entity_id',v_asset,'canonical_property_id',v_property,'assertion_type','direct_warner_source',
    'evidence_source','synthetic-direct','evidence_hash','hash-2','source_active',true,'within_entitlement',true)));
  if (select count(*) from plm.wb_asset_canonical_property_edge where source_entity_id=v_asset)<>1
     or not exists(select 1 from plm.wb_asset_canonical_property_edge where source_entity_id=v_asset and evidence_hash='hash-2') then
    raise exception 'asset sync is not idempotent';
  end if;

  perform plm.sync_wb_canonical_relationship_edges('style_guide', jsonb_build_array(jsonb_build_object(
    'source_entity_id',v_style,'canonical_property_id',v_property,'assertion_type','inferred_asset_cooccurrence',
    'evidence_source','synthetic-inferred','evidence_hash','hash-3','source_active',false,'within_entitlement',true)));
  perform plm.sync_wb_canonical_relationship_edges('character', jsonb_build_array(
    jsonb_build_object('source_entity_id',v_char,'canonical_property_id',v_property,'assertion_type','direct_warner_source','evidence_source','synthetic-direct','evidence_hash','hash-4','source_active',true,'within_entitlement',false),
    jsonb_build_object('source_entity_id',v_char,'canonical_property_id',v_property,'assertion_type','inferred_asset_cooccurrence','evidence_source','synthetic-inferred','evidence_hash','hash-5','source_active',true,'within_entitlement',true)));

  if (select count(*) from plm.wb_character_canonical_property_edge where source_entity_id=v_char)<>2 then
    raise exception 'direct and inferred character evidence did not coexist';
  end if;
  if exists(select 1 from api.wb_canonical_relationship_candidates where edge_kind='style_guide' and source_entity_id=v_style)
     or exists(select 1 from api.wb_canonical_relationship_candidates where edge_kind='character' and source_entity_id=v_char and assertion_type='direct_warner_source') then
    raise exception 'inactive or out-of-entitlement evidence became promotable';
  end if;
  if not exists(select 1 from api.wb_canonical_relationship_candidates where edge_kind='asset' and source_entity_id=v_asset and assertion_type='direct_warner_source')
     or not exists(select 1 from api.wb_canonical_relationship_candidates where edge_kind='character' and source_entity_id=v_char and assertion_type='inferred_asset_cooccurrence') then
    raise exception 'eligible evidence is absent from candidates';
  end if;

  begin
    perform plm.sync_wb_canonical_relationship_edges('asset', jsonb_build_array(jsonb_build_object(
      'source_entity_id',v_asset,'canonical_property_id',v_property,'assertion_type','inferred_asset_cooccurrence',
      'evidence_source','synthetic-bad','evidence_hash','bad','source_active',true,'within_entitlement',true)));
    raise exception 'inferred asset evidence masqueraded as direct';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform plm.sync_wb_canonical_relationship_edges('asset', jsonb_build_array(jsonb_build_object(
      'source_entity_id',v_asset,'canonical_property_id',v_character,'assertion_type','direct_warner_source',
      'evidence_source','synthetic-bad','evidence_hash','bad','source_active',true,'within_entitlement',true)));
    raise exception 'CHARACTER target was accepted as canonical Property';
  exception when sqlstate 'P0001' then null; end;
  begin
    perform plm.sync_wb_canonical_relationship_edges('asset', jsonb_build_array(jsonb_build_object(
      'source_entity_id','13800000-0000-4000-8000-000000000099','canonical_property_id',v_property,'assertion_type','direct_warner_source',
      'evidence_source','synthetic-bad','evidence_hash','bad','source_active',true,'within_entitlement',true)));
    raise exception 'unknown source endpoint was accepted';
  exception when sqlstate 'P0001' then null; end;
end
$contracts$;

rollback;
