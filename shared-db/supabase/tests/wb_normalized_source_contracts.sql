-- Issue #925. Synthetic catalog contract tests; no licensed values.
do $$
declare expected text[]:=array['wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property','wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence']; t text; bad integer;
begin
 foreach t in array expected loop
  if to_regclass('plm.'||t) is null then raise exception 'missing normalized Warner table %',t; end if;
 end loop;
 select count(*) into bad from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
 where n.nspname='plm' and r.relname=any(expected) and c.contype='f' and c.confdeltype<>'r';
 if bad<>0 then raise exception 'normalized Warner foreign keys must use ON DELETE RESTRICT'; end if;
 if (select count(*) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='plm' and r.relname=any(expected) and c.contype='f')<>24 then raise exception 'normalized Warner FK inventory changed'; end if;
 if exists(select 1 from pg_indexes where schemaname='plm' and tablename in('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized') and indexdef~*'label') then raise exception 'label must not participate in normalized identity indexes'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname=any(array(select 'sync_'||unnest(expected))))<>11 then raise exception 'normalized loader inventory must contain eleven exact targets'; end if;
 if not exists(select 1 from pg_constraint c where c.conrelid='plm.wb_capture'::regclass and pg_get_constraintdef(c.oid) like '%wb_franchise_property_evidence%') then raise exception 'capture target check lacks normalized routes'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='plm' and p.proname like 'sync_wb_%' and p.proname like '%normalized%' and has_function_privilege('authenticated',p.oid,'execute'))<>0 then raise exception 'authenticated may execute a normalized loader'; end if;
 if position('wb_franchise_property' in pg_get_functiondef('plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure))=0 or position('wb_property_character' in pg_get_functiondef('plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure))=0 then raise exception 'legacy finalize routes were not preserved'; end if;
 if position('finalize_wb_capture_legacy' in pg_get_functiondef('plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure))=0 then raise exception 'legacy finalize authority changed'; end if;
 if (select proconfig from pg_proc where oid='plm.begin_wb_capture(text,date,text,text,integer,text,text,text)'::regprocedure) is distinct from array['search_path=pg_catalog, extensions'] then raise exception 'begin capture search path is unsafe'; end if;
 if (select proconfig from pg_proc where oid='plm.finalize_wb_capture(uuid,text,numeric)'::regprocedure) is distinct from array['search_path=pg_catalog, extensions'] then raise exception 'finalize capture search path is unsafe'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('plm','public') and p.proname=any(array(select 'sync_'||unnest(expected))) and has_function_privilege('authenticated',p.oid,'execute'))<>0 then raise exception 'authenticated may execute a normalized wrapper'; end if;
end $$;

-- NULL manifest fields fail closed with no header write.
do $null_manifest$
declare before_count bigint; rejected boolean;
begin
 select count(*) into before_count from plm.wb_capture;
 rejected:=false;
 begin perform plm.begin_wb_capture('wb_franchise',date '2099-01-09','synthetic',null,1,'synthetic','https://example.invalid',null);
 exception when sqlstate 'P0001' then rejected:=position('invalid manifest metadata' in sqlerrm)>0; end;
 if not rejected then raise exception 'NULL snapshot digest did not reach the controlled refusal'; end if;
 rejected:=false;
 begin perform plm.begin_wb_capture('wb_franchise',date '2099-01-09','synthetic',repeat('a',64),null,'synthetic','https://example.invalid',null);
 exception when sqlstate 'P0001' then rejected:=position('invalid manifest metadata' in sqlerrm)>0; end;
 if not rejected then raise exception 'NULL expected count did not reach the controlled refusal'; end if;
 if (select count(*) from plm.wb_capture)<>before_count then raise exception 'NULL manifest refusal wrote a header'; end if;
end
$null_manifest$;

begin;
insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values('99999999-9999-4999-8999-000000000925',0,'wb_franchise','loading',date '2099-01-01','synthetic','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'synthetic','https://example.invalid',now());
insert into plm.wb_franchise(source_namespace,source_id,label,source_term,identity_method,capture_id,source_url,raw,source_hash)
values('synthetic_namespace','synthetic-id','Synthetic Label','Franchise','source_id','99999999-9999-4999-8999-000000000925','https://example.invalid','{}','synthetic-hash');
update plm.wb_franchise set label='Synthetic Label Changed' where source_namespace='synthetic_namespace' and source_id='synthetic-id';
do $$ begin
 begin
  insert into plm.wb_franchise(source_namespace,source_id,label,source_term,identity_method,capture_id,source_url,raw,source_hash)
  values('synthetic_namespace','synthetic-id','Different Synthetic Label','Franchise','source_id','99999999-9999-4999-8999-000000000925','https://example.invalid','{}','synthetic-hash');
  raise exception 'duplicate source identity unexpectedly passed';
 exception when unique_violation then null; end;
 begin
  insert into plm.wb_property(source_namespace,source_id,label,source_term,identity_method,capture_id,source_url,raw,source_hash)
  values('wrong_namespace','synthetic-id','Synthetic Property','Property','source_id','99999999-9999-4999-8999-000000000925','https://example.invalid','{}','synthetic-hash');
  raise exception 'wrong Property namespace unexpectedly passed';
 exception when check_violation then null; end;
end $$;
rollback;

-- A legacy replacement-heavy refresh is refused before changing its table.
begin;
do $legacy_shrink$
declare first_snapshot jsonb; replacement jsonb; before_rows bigint; rejected boolean:=false;
begin
 first_snapshot:='{"captured_at":"2099-01-10","rows":[{"source_term":"Property","source_id":"shrink-old-1","label":"Synthetic Old One","captured_date":"2099-01-10","source_url":"https://example.invalid"},{"source_term":"Property","source_id":"shrink-old-2","label":"Synthetic Old Two","captured_date":"2099-01-10","source_url":"https://example.invalid"}]}'::jsonb;
 replacement:='{"captured_at":"2099-01-11","rows":[{"source_term":"Property","source_id":"shrink-new","label":"Synthetic New","captured_date":"2099-01-11","source_url":"https://example.invalid"}]}'::jsonb;
 perform * from plm.sync_wb_franchise_property(first_snapshot,'mirror_only',1);
 select count(*) into before_rows from plm.wb_franchise_property;
 begin perform * from plm.sync_wb_franchise_property(replacement,'mirror_only',0);
 exception when sqlstate 'P0001' then rejected:=true; end;
 if not rejected then raise exception 'legacy shrink refusal did not fire'; end if;
 if (select count(*) from plm.wb_franchise_property)<>before_rows or exists(select 1 from plm.wb_franchise_property where source_id='shrink-new') then raise exception 'legacy shrink refusal wrote rows'; end if;
end
$legacy_shrink$;
rollback;

-- Representative legacy protocol failures are controlled and leave no landed row.
begin;
do $legacy_failures$
declare c uuid; payload text:='[{"source_term":"Property","source_id":"legacy-failure","label":"Synthetic Failure","captured_date":"2099-01-08","source_url":"https://example.invalid"}]';
 chunk_hash text; manifest_hash text; before_rows bigint; rejected boolean;
begin
 chunk_hash:=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
 manifest_hash:=encode(extensions.digest(convert_to(chunk_hash,'UTF8'),'sha256'),'hex');
 select count(*) into before_rows from plm.wb_franchise_property;
 c:=plm.begin_wb_capture('wb_franchise_property',date '2099-01-08','synthetic-failure',manifest_hash,2,'synthetic','https://example.invalid',null);
 rejected:=false;
 begin perform plm.load_wb_chunk(c,1,payload,repeat('0',64));
 exception when sqlstate 'P0001' then rejected:=true; end;
 if not rejected then raise exception 'bad chunk digest passed'; end if;
 perform plm.load_wb_chunk(c,1,payload,chunk_hash);
 rejected:=false;
 begin perform * from plm.finalize_wb_capture(c,manifest_hash,1);
 exception when sqlstate 'P0001' then rejected:=true; end;
 if not rejected then raise exception 'declared count mismatch passed'; end if;
 if (select count(*) from plm.wb_franchise_property)<>before_rows then raise exception 'failed legacy finalize wrote rows'; end if;
 perform plm.fail_wb_capture(c,'synthetic controlled failure');
 if not exists(select 1 from plm.wb_capture where capture_id=c and chunk_number=0 and status='failed') then raise exception 'fail_wb_capture did not fail header'; end if;
 if exists(select 1 from plm.wb_capture wc where wc.capture_id=c and wc.chunk_number=1 and wc.payload is not null) then raise exception 'fail_wb_capture did not clear payload'; end if;
end
$legacy_failures$;
rollback;

begin;
set local role authenticated;
do $denied$ declare rejected boolean:=false; begin
 begin perform plm.begin_wb_capture('wb_franchise_property',date '2099-01-08','synthetic',repeat('a',64),1,'synthetic','https://example.invalid',null);
 exception when insufficient_privilege then rejected:=true; when sqlstate 'P0001' then rejected:=true; end;
 if not rejected then raise exception 'authenticated legacy begin passed'; end if;
end $denied$;
rollback;

-- Every legacy route still completes through the byte-checked canonical protocol.
begin;
do $legacy_pipelines$
declare targets text[]:=array['wb_franchise_property','wb_style_guide','wb_character','wb_asset','wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character','wb_property_character'];
 t text; rowj jsonb; payload text; chunk_hash text; manifest_hash text; c uuid; r record;
begin
 foreach t in array targets loop
  rowj:=case t
   when 'wb_franchise_property' then '{"source_term":"Property","source_id":"legacy-fp","label":"Synthetic Legacy","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_style_guide' then '{"source_term":"Style Guide","source_id":"","label":"Synthetic Legacy Guide","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_character' then '{"source_term":"Character","source_id":"legacy-char","label":"Synthetic Legacy Character","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset' then '{"asset_source_id":"legacy-asset","file_name":"synthetic.bin","source_path":"synthetic/path","property_labels":"Synthetic","franchise_labels":"Synthetic","character_labels":"Synthetic","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_style_guide' then '{"asset_source_id":"legacy-asset","style_guide_natural_key":"Synthetic Legacy Guide","file_name":"synthetic.bin","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_franchise_property' then '{"asset_source_id":"legacy-asset","franchise_property_label":"Synthetic Legacy","file_name":"synthetic.bin","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_character' then '{"asset_source_id":"legacy-asset","character_source_id":"legacy-char","character_label":"Synthetic Legacy Character","file_name":"synthetic.bin","captured_date":"2099-01-07","source_url":"https://example.invalid"}'::jsonb
   else '{"property_source_id":"legacy-fp","property_label":"Synthetic Legacy","character_source_id":"legacy-char","character_label":"Synthetic Legacy Character","id_fallback":false,"captured_at":"2099-01-07T00:00:00Z","source_url":"https://example.invalid"}'::jsonb end;
  payload:=jsonb_build_array(rowj)::text;
  chunk_hash:=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
  manifest_hash:=encode(extensions.digest(convert_to(chunk_hash,'UTF8'),'sha256'),'hex');
  c:=plm.begin_wb_capture(t,date '2099-01-07','synthetic-legacy',manifest_hash,1,'synthetic','https://example.invalid',null);
  perform plm.load_wb_chunk(c,1,payload,chunk_hash);
  select * into r from plm.finalize_wb_capture(c,manifest_hash,1);
  if r.rows_seen<>1 or r.rows_landed<>1 then raise exception 'legacy pipeline report failed: %',t; end if;
  if not exists(select 1 from plm.wb_capture where capture_id=c and chunk_number=0 and status='complete' and loader_report is not null) then raise exception 'legacy header completion failed: %',t; end if;
  if exists(select 1 from plm.wb_capture wc where wc.capture_id=c and wc.chunk_number=1 and wc.payload is not null) then raise exception 'legacy payload was not cleared: %',t; end if;
 end loop;
end
$legacy_pipelines$;
rollback;

-- Full begin + byte-checked chunk + finalize dispatch for every normalized route.
begin;
do $pipelines$
declare targets text[]:=array['wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property','wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence'];
 t text; rowj jsonb; payload text; chunk_hash text; manifest_hash text; c uuid; c_repeat uuid; r record; core_before bigint; hierarchy_before bigint;
begin
 select count(*) into core_before from core.property;
 select (select count(*) from plm.wb_franchise_property)+(select count(*) from plm.wb_property_character) into hierarchy_before;
 foreach t in array targets loop
  rowj:=case t
   when 'wb_franchise' then '{"source_namespace":"pipeline","fallback_key":"franchise-fallback","label":"Synthetic Franchise","identity_method":"natural_key_fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_property' then '{"source_namespace":"warner_product_catalogue","source_id":"pipeline-property","label":"Synthetic Property","identity_method":"source_id","source_url":"https://example.invalid"}'::jsonb
   when 'wb_character_normalized' then '{"source_namespace":"pipeline","fallback_key":"character-fallback","label":"Synthetic Character","identity_method":"natural_key_fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_style_guide_normalized' then '{"source_namespace":"pipeline","fallback_key":"style-fallback","label":"Synthetic Style Guide","identity_method":"natural_key_fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_normalized' then '{"source_namespace":"pipeline","source_id":"pipeline-asset","file_name":"synthetic.bin","source_path":"synthetic/path","file_size_bytes":"1","source_created_at":"2099-01-01T00:00:00Z","source_modified_at":"2099-01-02T00:00:00Z","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_franchise' then '{"asset_namespace":"pipeline","asset_source_id":"pipeline-asset","franchise_namespace":"pipeline","franchise_fallback_key":"franchise-fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_property' then '{"asset_namespace":"pipeline","asset_source_id":"pipeline-asset","property_namespace":"warner_product_catalogue","property_source_id":"pipeline-property","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_character_normalized' then '{"asset_namespace":"pipeline","asset_source_id":"pipeline-asset","character_namespace":"pipeline","character_fallback_key":"character-fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_asset_style_guide_normalized' then '{"asset_namespace":"pipeline","asset_source_id":"pipeline-asset","style_guide_namespace":"pipeline","style_guide_fallback_key":"style-fallback","source_url":"https://example.invalid"}'::jsonb
   when 'wb_property_character_normalized' then '{"property_namespace":"warner_product_catalogue","property_source_id":"pipeline-property","character_namespace":"pipeline","character_fallback_key":"character-fallback","property_label":"Synthetic Property","character_label":"Synthetic Character","identity_fallback":true,"source_url":"https://example.invalid"}'::jsonb
   else '{"franchise_namespace":"pipeline","franchise_fallback_key":"franchise-fallback","property_namespace":"warner_product_catalogue","property_source_id":"pipeline-property","evidence_source":"synthetic_direct","source_url":"https://example.invalid"}'::jsonb end;
  payload:=jsonb_build_array(rowj)::text;
  chunk_hash:=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
  manifest_hash:=encode(extensions.digest(convert_to(chunk_hash,'UTF8'),'sha256'),'hex');
  c:=plm.begin_wb_capture(t,date '2099-01-05','synthetic',manifest_hash,1,'synthetic','https://example.invalid',null);
  if plm.load_wb_chunk(c,1,payload,chunk_hash)<>1 then raise exception 'chunk dispatch count changed'; end if;
  select * into r from plm.finalize_wb_capture(c,manifest_hash,1);
  if r.rows_seen<>1 or r.rows_landed<>1 or r.rows_inserted<>1 then raise exception 'normalized route first finalize counts failed: %',t; end if;
  c_repeat:=plm.begin_wb_capture(t,date '2099-01-06','synthetic-repeat',manifest_hash,1,'synthetic','https://example.invalid',null);
  if c_repeat=c then raise exception 'same-target capture identity was reused after completion'; end if;
  perform plm.load_wb_chunk(c_repeat,1,payload,chunk_hash);
  select * into r from plm.finalize_wb_capture(c_repeat,manifest_hash,1);
  if r.rows_seen<>1 or r.rows_landed<>1 or r.rows_unchanged<>1 or r.rows_inserted<>0 or r.rows_updated<>0 then raise exception 'normalized route repeat is not a no-op: %',t; end if;
 end loop;
 if (select count(*) from core.property)<>core_before then raise exception 'normalized pipelines wrote core.property'; end if;
 if (select count(*) from plm.wb_franchise_property)+(select count(*) from plm.wb_property_character)<>hierarchy_before then raise exception 'asset routes invented a direct hierarchy'; end if;
 begin
  perform plm.wb_validate_normalized_row('wb_franchise_property_evidence','{"franchise_namespace":"pipeline","franchise_fallback_key":"franchise-fallback","property_namespace":"warner_product_catalogue","property_source_id":"pipeline-property","evidence_source":"synthetic_direct","evidence_type":"inferred_asset_cooccurrence","source_url":"https://example.invalid"}');
  raise exception 'unsupported hierarchy evidence unexpectedly passed';
 exception when sqlstate 'P0001' then null; end;
end
$pipelines$;
rollback;

-- Each normalized route accepts its exact documented row shape.
do $routes$
begin
 perform plm.wb_validate_normalized_row('wb_franchise','{"source_namespace":"synthetic","fallback_key":"f","label":"Synthetic","identity_method":"natural_key_fallback","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_property','{"source_namespace":"warner_product_catalogue","source_id":"p","label":"Synthetic","identity_method":"source_id","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_character_normalized','{"source_namespace":"synthetic","source_id":"c","label":"Synthetic","identity_method":"source_id","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_style_guide_normalized','{"source_namespace":"synthetic","fallback_key":"s","label":"Synthetic","identity_method":"natural_key_fallback","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_asset_normalized','{"source_namespace":"synthetic","source_id":"a","file_name":"synthetic.bin","source_path":"synthetic/path","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_asset_franchise','{"asset_namespace":"synthetic","asset_source_id":"a","franchise_namespace":"synthetic","franchise_fallback_key":"f","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_asset_property','{"asset_namespace":"synthetic","asset_source_id":"a","property_namespace":"warner_product_catalogue","property_source_id":"p","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_asset_character_normalized','{"asset_namespace":"synthetic","asset_source_id":"a","character_namespace":"synthetic","character_source_id":"c","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_asset_style_guide_normalized','{"asset_namespace":"synthetic","asset_source_id":"a","style_guide_namespace":"synthetic","style_guide_fallback_key":"s","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_property_character_normalized','{"property_namespace":"warner_product_catalogue","property_source_id":"p","character_namespace":"synthetic","character_source_id":"c","property_label":"Synthetic Property","character_label":"Synthetic Character","source_url":"https://example.invalid"}');
 perform plm.wb_validate_normalized_row('wb_franchise_property_evidence','{"franchise_namespace":"synthetic","franchise_fallback_key":"f","property_namespace":"warner_product_catalogue","property_source_id":"p","evidence_source":"synthetic_direct","source_url":"https://example.invalid"}');
end
$routes$;

-- All eight legacy routes still enter the original capture authority.
begin;
do $legacy$
declare t text; c uuid; i integer:=0;
begin
 foreach t in array array['wb_franchise_property','wb_style_guide','wb_character','wb_asset','wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character','wb_property_character'] loop
  i:=i+1;
  c:=plm.begin_wb_capture(t,date '2099-01-04','synthetic',repeat(to_hex(i),64),1,'synthetic','https://example.invalid',null);
  if c is null or not exists(select 1 from plm.wb_capture where capture_id=c and chunk_number=0 and target=t and status='loading') then raise exception 'legacy route failed: %',t; end if;
 end loop;
end
$legacy$;
rollback;

-- Executable loader behavior. Every value below is synthetic.
begin;
do $phase3$
declare c1 uuid:='99999999-9999-4999-8999-000000000931'; c2 uuid:='99999999-9999-4999-8999-000000000932';
 s jsonb; changed jsonb; r record; before_core bigint; after_core bigint; before_rows bigint;
begin
 select count(*) into before_core from core.property;
 insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
 values(c1,0,'wb_franchise','validating',date '2099-01-02','synthetic','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',1,'synthetic','https://example.invalid',now());
 s:=jsonb_build_object('captured_at','2099-01-02','rows',jsonb_build_array(jsonb_build_object('source_namespace','synthetic','source_id','id-1','label','Synthetic One','identity_method','source_id','source_url','https://example.invalid')));
 select * into r from plm.sync_wb_normalized_target(c1,'wb_franchise',s,'mirror_only',1);
 if r.rows_inserted<>1 or r.rows_updated<>0 or r.rows_unchanged<>0 then raise exception 'first load counts are untruthful'; end if;
 update plm.wb_capture set status='complete',completed_at=now(),loader_report=jsonb_build_object('synthetic',true) where capture_id=c1 and chunk_number=0;
 insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
 values(c2,0,'wb_franchise','validating',date '2099-01-03','synthetic','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',1,'synthetic','https://example.invalid',now());
 changed:=jsonb_build_object('captured_at','2099-01-03','rows',jsonb_build_array(jsonb_build_object('source_namespace','synthetic','source_id','id-1','label','Synthetic Changed','identity_method','source_id','source_url','https://example.invalid')));
 select * into r from plm.sync_wb_normalized_target(c2,'wb_franchise',changed,'mirror_only',1);
 if r.rows_updated<>1 or r.rows_inserted<>0 or r.rows_unchanged<>0 then raise exception 'changed load counts are untruthful'; end if;
 select * into r from plm.sync_wb_normalized_target(c2,'wb_franchise',changed,'mirror_only',1);
 if r.rows_unchanged<>1 or r.rows_updated<>0 or r.rows_inserted<>0 then raise exception 'repeat load is not a no-op'; end if;
 if not exists(select 1 from plm.wb_franchise where source_namespace='synthetic' and source_id='id-1' and label='Synthetic Changed' and capture_id=c2) then raise exception 'mutable fields or provenance were not updated'; end if;

 -- A replacement-heavy snapshot must fail before inserting its replacement.
 select count(*) into before_rows from plm.wb_franchise;
 begin
  perform * from plm.sync_wb_normalized_target(c2,'wb_franchise',
   jsonb_build_object('captured_at','2099-01-03','rows',jsonb_build_array(jsonb_build_object('source_namespace','synthetic','source_id','replacement','label','Synthetic Replacement','identity_method','source_id','source_url','https://example.invalid'))),'mirror_only',0);
  raise exception 'replacement-heavy snapshot unexpectedly passed';
 exception when sqlstate 'P0001' then null; end;
 if (select count(*) from plm.wb_franchise)<>before_rows or exists(select 1 from plm.wb_franchise where source_id='replacement') then raise exception 'shrink refusal wrote rows'; end if;

 -- Unsafe input and wrong capture target both fail atomically.
 begin
  perform * from plm.sync_wb_normalized_target(c2,'wb_franchise',
   jsonb_build_object('captured_at','2099-01-03','rows',jsonb_build_array(jsonb_build_object('source_namespace','synthetic','source_id','unsafe','label','Synthetic','identity_method','source_id','source_url','https://example.invalid?token=x'))),'mirror_only',1);
  raise exception 'unsafe URL unexpectedly passed';
 exception when sqlstate 'P0001' then null; end;
 begin
  perform * from plm.sync_wb_normalized_target(c2,'wb_property',changed,'mirror_only',1);
  raise exception 'capture target isolation failed';
 exception when sqlstate 'P0001' then null; end;
 if exists(select 1 from plm.wb_franchise where source_id='unsafe') then raise exception 'unsafe refusal wrote rows'; end if;
 -- Invalid typed values are value-free and atomic.
 begin
  perform plm.wb_validate_normalized_row('wb_asset_normalized',
   jsonb_build_object('source_namespace','synthetic','source_id','bad-cast','file_name','synthetic.bin','source_path','synthetic/path','file_size_bytes','distinctive_bad_sentinel_925','source_url','https://example.invalid'));
  raise exception 'bad typed value unexpectedly passed';
 exception when sqlstate 'P0001' then
  if position('distinctive_bad_sentinel_925' in sqlerrm)>0 then raise exception 'typed-value error leaked its input'; end if;
 end;
 if exists(select 1 from plm.wb_asset_normalized where source_id='bad-cast') then raise exception 'bad typed value wrote rows'; end if;
 begin
  perform * from plm.sync_wb_normalized_target(c2,'wb_franchise',
   jsonb_build_object('captured_at','distinctive_bad_sentinel_925','rows',jsonb_build_array(jsonb_build_object('source_namespace','synthetic','source_id','bad-date','label','Synthetic','identity_method','source_id','source_url','https://example.invalid'))),'mirror_only',1);
  raise exception 'bad captured date unexpectedly passed';
 exception when sqlstate 'P0001' then
  if position('distinctive_bad_sentinel_925' in sqlerrm)>0 then raise exception 'captured-date error leaked its input'; end if;
 end;
 if exists(select 1 from plm.wb_franchise where source_id='bad-date') then raise exception 'bad captured date wrote rows'; end if;
 select count(*) into after_core from core.property;
 if before_core<>after_core then raise exception 'normalized loaders changed core.property'; end if;
end
$phase3$;
rollback;
