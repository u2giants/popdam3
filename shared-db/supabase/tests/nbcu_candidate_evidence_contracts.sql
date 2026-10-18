begin;
-- Synthetic-only fixture. Capture starts just before load completion so the
-- inverse's first-seen cutoff remains valid against the current transaction time.
do $fixture$
declare
  c uuid := '25980000-0000-0000-0000-000000000001';
  s text := 'href-sha256:'||repeat('a',64);
  p1 text := 'source-id:2598-property-1';
  p2 text := 'source-id:2598-property-2';
  f1 text := 'label-sha256:'||repeat('b',64);
  f2 text := 'label-sha256:'||repeat('c',64);
  ch text := '2598-character-1';
  g text := '2598-guide-1';
  a text := '/synthetic/asset.jpg';
  counts jsonb := jsonb_build_object(
    'assets',1,'properties',2,'characters',1,'style_guides',1,'scopes',1,
    'ip_family_property',3,'property_character',1,'asset_property',1,
    'asset_character',0,'asset_style_guide',1,'style_guide_property',1,
    'asset_ip_family',1
  );
begin
 insert into plm.nbcu_capture(
  id,capture_key,source_repository,source_commit_sha,source_manifest_sha256,portal_base_url,
  source_captured_at,load_completed_at,status,expected_counts,observed_counts,raw_summary,created_by
 ) values (
  c,'synthetic-2598-candidate-evidence','fixture',repeat('a',40),repeat('b',64),
  'https://fixture.invalid',clock_timestamp()-interval '1 second',clock_timestamp(),'complete',
  counts,counts||jsonb_build_object('asset_metadata_values',1,'asset_scopes',1),
  jsonb_build_object('synthetic_fixture',true),'synthetic-contract-test'
 );
 insert into plm.nbcu_scope(capture_id,scope_key,scope_label,scope_href,page_count,indexed_rows,unique_assets,terminal,missing_offsets,source_files,raw)
 values(c,s,'Synthetic scope','https://fixture.invalid/scope',2,1,1,true,'{}','[]','{}');
 insert into plm.nbcu_property(capture_id,property_key,property_source_id,property_label,source_kind,source_url,source_captured_at,raw)
 values(c,p1,'2598-property-1','Synthetic property one','property','https://fixture.invalid/property/1',now(),'{}'),
       (c,p2,'2598-property-2','Synthetic property two','franchise_asset','https://fixture.invalid/property/2',now(),'{}');
 insert into plm.nbcu_character(capture_id,character_key,character_source_id,character_label,source_url,source_captured_at,raw)
 values(c,ch,ch,'Synthetic character','https://fixture.invalid/character',now(),'{}');
 insert into plm.nbcu_ip_family(capture_id,ip_family_key,ip_family_label,source_url,raw)
 values(c,f1,'Synthetic IP Family One','https://fixture.invalid/family/1','{}'),
       (c,f2,'Synthetic IP Family Two','https://fixture.invalid/family/2','{}');
 insert into plm.nbcu_style_guide(capture_id,style_guide_key,style_guide_label,folder_path,source_url,source_captured_at,raw)
 values(c,g,'Synthetic guide','/synthetic/guide','https://fixture.invalid/guide',now(),'{}');
 insert into plm.nbcu_asset(capture_id,asset_source_key,asset_path,file_name,studio_labels,ip_family_labels,property_labels,character_labels,restriction_labels,style_guide_natural_keys,scope_paths,source_captured_at,source_url,raw,source_hash)
 values(c,a,a,'asset.jpg','[]','[]','[]','[]','[]','[]',jsonb_build_array('https://fixture.invalid/scope'),now(),'https://fixture.invalid/asset','{}',repeat('d',64));
 insert into plm.nbcu_asset_metadata_value(capture_id,asset_source_key,field_name,value_ordinal,value_text,value_attributes,raw)
 values(c,a,'Synthetic metadata',0,'Synthetic value','{}','{}');
 insert into plm.nbcu_asset_scope(capture_id,asset_source_key,scope_key) values(c,a,s);
 insert into plm.nbcu_ip_family_property(capture_id,ip_family_key,property_key,ip_family_label,property_label,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,f1,p1,'Synthetic IP Family One','Synthetic property one','observed_asset_co_tag','Synthetic candidate evidence one',now(),'https://fixture.invalid/evidence/1','{"synthetic":1}'),
       (c,f2,p2,'Synthetic IP Family Two','Synthetic property two','OBSERVED_ASSET_CO_TAG','Synthetic candidate evidence two',now(),'https://fixture.invalid/evidence/2','{"synthetic":2}'),
       (c,f1,p2,'Synthetic IP Family One','Synthetic property two','explicit_ip_family_property','Synthetic explicit family property',now(),'https://fixture.invalid/evidence/direct-family-property','{}');
 insert into plm.nbcu_property_character(capture_id,property_key,character_key,property_label,character_label,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,p1,ch,'Synthetic property one','Synthetic character','exact_native_pair','Synthetic explicit pair',now(),'https://fixture.invalid/evidence/character','{}');
 insert into plm.nbcu_asset_property(capture_id,asset_source_key,property_key,property_label,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,a,p1,'Synthetic property one','asset_property_metadata','Synthetic explicit asset property',now(),'https://fixture.invalid/evidence/asset-property','{}');
 insert into plm.nbcu_asset_style_guide(capture_id,asset_source_key,style_guide_key,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,a,g,'asset_guide_folder','Synthetic explicit guide folder',now(),'https://fixture.invalid/evidence/asset-guide','{}');
 insert into plm.nbcu_style_guide_property(capture_id,style_guide_key,property_key,property_label,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,g,p1,'Synthetic property one','guide_asset_property_metadata','Synthetic permitted guide asset Property metadata',now(),'https://fixture.invalid/evidence/guide-property','{}');
 insert into plm.nbcu_asset_ip_family(capture_id,asset_source_key,ip_family_key,ip_family_label,evidence_type,evidence_value,source_captured_at,source_url,raw)
 values(c,a,f1,'Synthetic IP Family One','asset_ip_family_metadata','Synthetic explicit asset IP Family',now(),'https://fixture.invalid/evidence/asset-family','{}');
end;
$fixture$;

do $assertions$
declare
 c uuid := '25980000-0000-0000-0000-000000000001';
 snap jsonb;
 expected jsonb;
begin
 snap:=plm.licensing_consolidation_capture_snapshot('nbcu',c);
 if snap->>'nbcu_adapter_contract_version' is distinct from '1' or jsonb_typeof(snap->'candidate_edges') is distinct from 'array' then
  raise exception 'NBCU candidate partition contract metadata missing';
 end if;
 if jsonb_array_length(snap->'candidate_edges') is distinct from 2 then
  raise exception 'both case-insensitive observed_asset_co_tag rows must be retained as candidates';
 end if;
 if exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='property_franchise' and lower(e->'native'->>'evidence_type')='observed_asset_co_tag') then
  raise exception 'observed_asset_co_tag was exposed as a direct edge';
 end if;
 if exists(select 1 from jsonb_array_elements(snap->'candidate_edges') e where e->>'candidate_reason' is distinct from 'observed_asset_co_tag' or lower(e->'native'->>'evidence_type') is distinct from 'observed_asset_co_tag') then
  raise exception 'candidate reason or exact source evidence was not preserved';
 end if;
 select to_jsonb(r) into expected from plm.nbcu_ip_family_property r where capture_id=c and ip_family_key='label-sha256:'||repeat('b',64) and property_key='source-id:2598-property-1';
 if not exists(select 1 from jsonb_array_elements(snap->'candidate_edges') e where e->'native'=expected and e->>'candidate_reason'='observed_asset_co_tag') then
  raise exception 'candidate native source evidence payload was not retained exactly';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='property_franchise' and e->'native'->>'evidence_type'='explicit_ip_family_property') then
  raise exception 'explicit property-franchise relationship no longer remains direct';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='property_character' and e->'native'->>'evidence_type'='exact_native_pair') then
  raise exception 'explicit property-character relationship no longer remains direct';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='asset_property' and e->'native'->>'evidence_type'='asset_property_metadata') then
  raise exception 'explicit asset-property relationship no longer remains direct';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='asset_franchise' and e->'native'->>'evidence_type'='asset_ip_family_metadata') then
  raise exception 'explicit asset-franchise relationship no longer remains direct';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'edges') e where e->>'kind'='property_style_guide' and e->'native'->>'evidence_type'='guide_asset_property_metadata') then
  raise exception 'permitted guide asset Property metadata was changed';
 end if;
 if (select count(*) from jsonb_array_elements(snap->'entities') e where e->>'kind'='franchise' and e->>'source_term'='IP Family' and e->'native' @> '[{"source_term":"IP Family"}]'::jsonb) is distinct from 2 then
  raise exception 'derived IP Family term missing from entity/native provenance';
 end if;
 if snap->'root'->'expected_counts'->>'ip_family_property' is distinct from '3' or snap->'root'->'observed_counts'->>'ip_family_property' is distinct from '3' or (select count(*) from plm.nbcu_ip_family_property where capture_id=c) is distinct from 3 then
  raise exception 'candidate partition altered source capture expected/observed/physical counts';
 end if;
 if not exists(select 1 from plm.nbcu_scope where capture_id=c and page_count=2 and indexed_rows=1 and terminal is true)
  or not exists(select 1 from plm.nbcu_asset where capture_id=c and asset_source_key='/synthetic/asset.jpg' and asset_path='/synthetic/asset.jpg') then
  raise exception 'synthetic asset path and two-page/one-indexed-row terminal scope fixture is malformed';
 end if;
 begin
  update plm.nbcu_property_character set evidence_type='cooccurrence' where capture_id=c;
  perform plm.licensing_consolidation_capture_snapshot('nbcu',c);
  raise exception 'legacy cooccurrence evidence was accepted';
 exception when sqlstate 'P0001' then
  if sqlerrm is distinct from 'NBCU inferred or missing evidence is not direct source authority' then raise;end if;
 end;
 raise notice 'NBCU observed co-tag candidate partition, native provenance, direct edge retention and inferred-evidence refusal PASS';
end;
$assertions$;

-- Exercise the native v2 planner, apply, and exact applied-state inverse against real
-- canonical rows. Every write is synthetic and the final outer ROLLBACK removes it.
do $native_lifecycle$
declare
 c uuid := '25980000-0000-0000-0000-000000000001';
 l uuid := '25980000-0000-0000-0000-000000000010';
 p1id uuid := '25980000-0000-0000-0000-000000000011';
 p2id uuid := '25980000-0000-0000-0000-000000000012';
 f1id uuid := '25980000-0000-0000-0000-000000000013';
 f2id uuid := '25980000-0000-0000-0000-000000000014';
 chid uuid := '25980000-0000-0000-0000-000000000015';
 p1 text := 'source-id:2598-property-1';
 p2 text := 'source-id:2598-property-2';
 f1 text := 'label-sha256:'||repeat('b',64);
 f2 text := 'label-sha256:'||repeat('c',64);
 ch text := '2598-character-1';
 x record;
 p plm.licensing_consolidation_plan;
 applied plm.licensing_consolidation_plan;
 inverse plm.licensing_consolidation_plan;
 reverted plm.licensing_consolidation_plan;
 expected_filter text;
 expected_native_id text;
 expected_franchise uuid;
 expected_property uuid;
 direct_count integer;
begin
 insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
 values(pg_backend_pid(),txid_current(),'core.licensor','scrape_consolidation',gen_random_uuid(),repeat('1',64),'nbcu-2598-synthetic-test',array['name','code','status'],clock_timestamp()+interval '1 minute');
 insert into core.licensor(id,name,code,status) values(l,'Synthetic NBCU 2598','ZZ2598N','active');
 insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
 values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('2',64),'nbcu-2598-synthetic-test',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
 insert into core.property(id,licensor_id,name,code,status) values(p1id,l,'Synthetic property one','ZZ2598P1','potential');
 insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
 values(pg_backend_pid(),txid_current(),'core.property','licensing_review_create',gen_random_uuid(),repeat('3',64),'nbcu-2598-synthetic-test',array['licensor_id','name','code','status'],clock_timestamp()+interval '1 minute');
 insert into core.property(id,licensor_id,name,code,status) values(p2id,l,'Synthetic property two','ZZ2598P2','potential');
 insert into core.franchise(id,licensor_id,name,source_system,source_id,status) values
  (f1id,l,'Synthetic IP Family One','nbcu',f1,'active'),
  (f2id,l,'Synthetic IP Family Two','nbcu',f2,'active');
 insert into core.character(id,licensor_id,name) values(chid,l,'Synthetic character');

 insert into plm.source_resolution(source_system,entity_kind,source_id,core_property_id,resolution_status) values
  ('nbcu','property',p1,p1id,'matched'),('nbcu','property',p2,p2id,'matched');
 insert into plm.source_resolution(source_system,entity_kind,source_id,core_franchise_id,resolution_status) values
  ('nbcu','franchise',f1,f1id,'matched'),('nbcu','franchise',f2,f2id,'matched');
 insert into plm.source_resolution(source_system,entity_kind,source_id,core_character_id,resolution_status)
 values('nbcu','character',ch,chid,'matched');
 insert into plm.licensing_source_scope(licensor_id,source_system,source_purpose,scope_axis,permitted_kind,authorized_at,authorized_by,authorization_note) values
  (l,'nbcu','canonical_identity','entity','property',clock_timestamp(),'synthetic-test','Synthetic complete-capture contract fixture'),
  (l,'nbcu','canonical_identity','entity','franchise',clock_timestamp(),'synthetic-test','Synthetic complete-capture contract fixture'),
  (l,'nbcu','canonical_identity','entity','character',clock_timestamp(),'synthetic-test','Synthetic complete-capture contract fixture'),
  (l,'nbcu','relationship_evidence','relationship','property_franchise',clock_timestamp(),'synthetic-test','Synthetic direct native pair fixture'),
  (l,'nbcu','relationship_evidence','relationship','property_character',clock_timestamp(),'synthetic-test','Synthetic direct native pair fixture');

 for x in select * from (values (p1,p1id,null::uuid),(p2,p2id,f1id),(f1,p2id,f1id)) q(source_id,property_id,franchise_id) loop
  expected_native_id:=x.source_id;
  expected_filter:=jsonb_build_array('nbcu',case when expected_native_id=f1 then 'plm.nbcu_ip_family' else 'plm.nbcu_property' end,case when expected_native_id=f1 then 'franchise' else 'property' end,expected_native_id)::text;
  expected_property:=x.property_id;
  expected_franchise:=x.franchise_id;
  p:=plm.plan_licensing_consolidation('nbcu',c,expected_filter);
  if p.plan_status is distinct from 'preview' or p.plan_schema_version is distinct from 2 or p.capture_complete is distinct from true or p.source_scope_checked is distinct from true then
   raise exception 'native filtered NBCU plan did not produce a complete current preview';
  end if;
  if coalesce(jsonb_array_length(p.operations),0)<1 or not exists(select 1 from jsonb_array_elements(p.operations) op where op->>'kind'='entity_source' and op->'identity'->>'source_id'=expected_filter) then
   raise exception 'native filtered plan did not contain its exact mapped entity operation';
  end if;
  select count(*) into direct_count from jsonb_array_elements(p.operations) op
   where op->>'kind'='relationship_source' and op->>'entity_kind'='property_franchise';
  if expected_native_id=p1 then
   if direct_count is distinct from 0 then raise exception 'property-1 filter planned a franchise pair from its candidate-only co-tag';end if;
  else
   if direct_count is distinct from 1 or not exists(
    select 1 from jsonb_array_elements(p.operations) op
    where op->>'kind'='relationship_source' and op->>'entity_kind'='property_franchise'
     and op->'after'->>'property_id'=expected_property::text
     and op->'after'->>'franchise_id'=expected_franchise::text
   ) then raise exception 'filtered native direct pair plan did not contain exactly its expected property/franchise support';end if;
   if exists(select 1 from jsonb_array_elements(p.operations) op where op->>'kind'='relationship_source' and op->>'entity_kind'='property_franchise' and op->'after'->>'franchise_id'=f2id::text) then
    raise exception 'candidate-only property/family pair entered a native direct support plan';
   end if;
  end if;

  applied:=plm.apply_licensing_consolidation(p.id,p.plan_hash);
  if applied.plan_status is distinct from 'applied' or applied.applied_state is null or coalesce(applied.entity_operation_count,0)<1 then raise exception 'filtered native NBCU plan did not apply a real entity change with recorded state';end if;
  if expected_native_id=f1 then
   if not exists(select 1 from core.taxonomy_source_ref r where r.entity_id=f1id and r.source_system='nbcu' and r.source_table='plm.nbcu_ip_family' and r.missing_since is null and r.raw->'native_provenance' @> '[{"source_term":"IP Family"}]'::jsonb) then
    raise exception 'IP Family source term did not reach canonical taxonomy source provenance after apply';
   end if;
  end if;
  if expected_native_id=p2 or expected_native_id=f1 then
   if not exists(select 1 from core.property_franchise_source_edge e where e.property_id=p2id and e.franchise_id=f1id and e.source_system='nbcu' and e.evidence_kind='direct_source_assertion' and e.is_current)
    or not exists(select 1 from core.property_franchise e where e.property_id=p2id and e.franchise_id=f1id and e.is_current) then
    raise exception 'native direct property-2/family-1 support and canonical pair were not applied';
   end if;
  end if;
  if exists(select 1 from core.property_franchise_source_edge e where e.source_system='nbcu' and e.is_current and ((e.property_id=p1id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f2id)))
   or exists(select 1 from core.property_franchise e where e.is_current and ((e.property_id=p1id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f2id))) then
   raise exception 'candidate-only co-tag pair became current canonical support';
  end if;

  inverse:=plm.plan_licensing_consolidation_rollback(applied.id,encode(extensions.digest(applied.applied_state::text,'sha256'),'hex'));
  if inverse.plan_status is distinct from 'preview' or inverse.rollback_of is distinct from applied.id then raise exception 'native filtered inverse was not pinned to the applied plan';end if;
  reverted:=plm.apply_licensing_consolidation(inverse.id,inverse.plan_hash);
  if reverted.plan_status is distinct from 'applied' then raise exception 'native filtered inverse did not apply';end if;
  if exists(select 1 from core.property_franchise_source_edge e where e.source_system='nbcu' and e.is_current and ((e.property_id=p1id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f2id)))
   or exists(select 1 from core.property_franchise e where e.is_current and ((e.property_id=p1id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f1id) or (e.property_id=p2id and e.franchise_id=f2id))) then
   raise exception 'native inverse did not restore the original no-current-pair state';
  end if;
 end loop;
 raise notice 'NBCU native filtered planner/apply/applied-state inverse and IP Family provenance PASS';
end;
$native_lifecycle$;
rollback;
