begin;

do $$
declare
  v_capture constant uuid := 'a5000000-0000-0000-0000-000000000001';
  v_partial constant uuid := 'a5000000-0000-0000-0000-000000000002';
  v_parent text;
  v_payload jsonb;
  v_result jsonb;
  v_i integer;
  v_count bigint;
  v_asset uuid;
  v_character uuid;
  v_guide uuid;
begin
  perform plm.begin_marvel_asgard_capture(
    v_capture,'marvel_asgard','https://synthetic.invalid/asgard','synthetic licensed scope',
    'contract-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '2026-08-26T00:00:00Z',
    '{"categories":1,"guides":1,"nodes":12,"pages":3,"assets":2,"node_assets":4,"characters":2,"asset_characters":2,"terms":6,"asset_terms":6,"asset_likeness":2}',
    '{"fixture":"invented"}'
  );
  -- Exact replay is idempotent.
  perform plm.begin_marvel_asgard_capture(
    v_capture,'marvel_asgard','https://synthetic.invalid/asgard','synthetic licensed scope',
    'contract-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '2026-08-26T00:00:00Z',
    '{"categories":1,"guides":1,"nodes":12,"pages":3,"assets":2,"node_assets":4,"characters":2,"asset_characters":2,"terms":6,"asset_terms":6,"asset_likeness":2}',
    '{"fixture":"invented"}'
  );

  perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','root',jsonb_build_object(
    'categories',jsonb_build_array(jsonb_build_object('source_identity_key','category-1','source_category_key','cat-source-1','exact_label','Synthetic Category','display_order',0,'raw_source','{}'::jsonb)),
    'style_guides',jsonb_build_array(jsonb_build_object('source_identity_key','guide-1','source_guide_key','guide-source-1','category_identity_key','category-1','exact_label','Synthetic Guide','display_order',0,'raw_source','{}'::jsonb))
  ));

  v_parent := null;
  v_payload := '[]'::jsonb;
  for v_i in 1..12 loop
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'source_identity_key','node-'||v_i,'source_node_key','node-source-'||v_i,
      'style_guide_identity_key','guide-1','parent_node_identity_key',v_parent,
      'depth',v_i,'exact_label','Synthetic Node '||v_i,'display_order',v_i,
      'materialized_source_path','/synthetic/'||v_i,'raw_source','{}'::jsonb));
    v_parent := 'node-'||v_i;
  end loop;
  -- Parent and all eleven descendants arrive in one chunk, deliberately child-after-parent
  -- within one INSERT input. The loader must link them in its second pass.
  perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','all-nodes',jsonb_build_object('guide_nodes',v_payload));
  if exists (
    select 1 from plm.marvel_asgard_guide_node n
    where n.source_identity_key<>'node-1' and n.last_seen_capture_key=v_capture
      and n.parent_node_id is null
  ) then raise exception 'same-chunk hierarchy was flattened'; end if;

  perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','leaf-pages',jsonb_build_object(
    'assets',jsonb_build_array(
      jsonb_build_object('source_identity_key','asset-1','style_guide_asset_id','sga-1','asset_id','asset-source-1','original_file_id','file-1','exact_filename','invented-one.bin','file_extension','bin','file_size_bytes',10,'display_order',1,'raw_source','{}'::jsonb),
      jsonb_build_object('source_identity_key','asset-2','style_guide_asset_id','sga-2','asset_id','asset-source-2','original_file_id','file-2','exact_filename','invented-two.bin','file_extension','bin','file_size_bytes',20,'display_order',2,'raw_source','{}'::jsonb)),
    'characters',jsonb_build_array(
      jsonb_build_object('source_identity_key','character-1','source_character_key','char-source-1','exact_label','Invented Character One','normalized_search_label','invented character one','raw_source','{}'::jsonb),
      jsonb_build_object('source_identity_key','character-2','source_character_key','char-source-2','exact_label','Invented Character Two','normalized_search_label','invented character two','raw_source','{}'::jsonb)),
    'terms',(select jsonb_agg(value) from (
      select jsonb_build_object('source_identity_key','term-'||kind,'term_kind',kind,'source_term_key','term-source-'||kind,'exact_value','Invented '||kind,'normalized_search_value','invented '||kind,'raw_source','{}'::jsonb) value from unnest(array['character_action','artwork_type','image_coloration','iteration']) kind
      union all select jsonb_build_object('source_identity_key','term-keyword-a','term_kind','descriptive_keyword','source_term_key','term-source-keyword-a','exact_value','Invented A','normalized_search_value','invented a','raw_source','{}'::jsonb)
      union all select jsonb_build_object('source_identity_key','term-keyword-b','term_kind','descriptive_keyword','source_term_key','term-source-keyword-b','exact_value','Invented B','normalized_search_value','invented b','raw_source','{}'::jsonb)
    ) terms),
    'checkpoints',jsonb_build_array(
      jsonb_build_object('style_guide_identity_key','guide-1','guide_node_identity_key','node-12','page_number',1,'page_size',3,'expected_page_count',2,'expected_asset_count',3,'observed_asset_count',3,'request_sha256',repeat('b',64),'result_sha256',repeat('c',64),'status','complete'),
      jsonb_build_object('style_guide_identity_key','guide-1','guide_node_identity_key','node-12','page_number',2,'page_size',3,'expected_page_count',2,'expected_asset_count',0,'observed_asset_count',0,'request_sha256',repeat('d',64),'result_sha256',repeat('e',64),'status','complete'))
  ));

  insert into plm.marvel_asgard_capture_checkpoint(capture_key,style_guide_id,guide_node_id,page_number,page_size,expected_page_count,expected_asset_count,observed_asset_count,request_sha256,result_sha256,status)
  select v_capture,n.style_guide_id,n.id,1,1,1,1,1,repeat('4',64),repeat('5',64),'complete'
  from plm.marvel_asgard_guide_node n where n.source_identity_key='node-11';

  perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','relationships',jsonb_build_object(
    'node_assets',jsonb_build_array(
      jsonb_build_object('guide_node_identity_key','node-12','page_number',1,'asset_identity_key','asset-1','file_observation_key','obs-1a','exact_filename','invented-one-a.bin','file_extension','bin','file_size_bytes',10,'source_display_order',1,'raw_observation_sha256',repeat('1',64),'raw_observation',jsonb_build_object('fixture','one-a')),
      jsonb_build_object('guide_node_identity_key','node-12','page_number',1,'asset_identity_key','asset-1','file_observation_key','obs-1b','exact_filename','invented-one-b.bin','file_extension','bin','file_size_bytes',11,'source_display_order',2,'raw_observation_sha256',repeat('2',64),'raw_observation',jsonb_build_object('fixture','one-b')),
      jsonb_build_object('guide_node_identity_key','node-12','page_number',1,'asset_identity_key','asset-2','file_observation_key','obs-2','exact_filename','invented-two.bin','file_extension','bin','file_size_bytes',20,'source_display_order',3,'raw_observation_sha256',repeat('3',64),'raw_observation',jsonb_build_object('fixture','two')),
      jsonb_build_object('guide_node_identity_key','node-11','page_number',1,'asset_identity_key','asset-1','file_observation_key','obs-1-node11','exact_filename','invented-one-a.bin','file_extension','bin','file_size_bytes',10,'source_display_order',1,'raw_observation_sha256',repeat('4',64),'raw_observation',jsonb_build_object('fixture','one-node11'))),
    'asset_characters',jsonb_build_array(
      jsonb_build_object('asset_identity_key','asset-1','character_identity_key','character-1','raw_observation','{}'::jsonb),
      jsonb_build_object('asset_identity_key','asset-1','character_identity_key','character-2','raw_observation','{}'::jsonb)),
    'asset_terms',(select jsonb_agg(value) from (
      select jsonb_build_object('asset_identity_key','asset-1','term_identity_key','term-'||kind,'raw_combined_value',null,'raw_observation','{}'::jsonb) value from unnest(array['character_action','artwork_type','image_coloration','iteration']) kind
      union all select jsonb_build_object('asset_identity_key','asset-1','term_identity_key','term-keyword-a','raw_combined_value','Invented A|Invented B','raw_observation','{}'::jsonb)
      union all select jsonb_build_object('asset_identity_key','asset-1','term_identity_key','term-keyword-b','raw_combined_value','Invented A|Invented B','raw_observation','{}'::jsonb)
    ) asset_terms),
    'asset_likeness',jsonb_build_array(
      jsonb_build_object('asset_identity_key','asset-1','source_value','invented true','likeness_state','yes','raw_observation','{}'::jsonb),
      jsonb_build_object('asset_identity_key','asset-2','source_value',null,'likeness_state','unknown','raw_observation','{}'::jsonb))
  ));
  -- Conflicting identity and media-access fields fail while the capture is still open.
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','conflict',jsonb_build_object('assets',jsonb_build_array(jsonb_build_object('source_identity_key','asset-1','style_guide_asset_id','different','asset_id','asset-source-1','original_file_id','file-1','exact_filename','invented.bin','raw_source','{}'::jsonb))));
    raise exception 'identifier conflict unexpectedly succeeded';
  exception when others then if sqlerrm not like '%asset identifier conflict%' then raise; end if; end;
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','secret',jsonb_build_object('assets',jsonb_build_array(jsonb_build_object('source_identity_key','asset-1','style_guide_asset_id','sga-1','asset_id','asset-source-1','original_file_id','file-1','exact_filename','invented-one.bin','raw_source',jsonb_build_object('downloadUrl','https://synthetic.invalid/file')))));
    raise exception 'forbidden URL unexpectedly accepted';
  exception when others then if sqlerrm not like '%forbidden media-access%' then raise; end if; end;
  -- Every referenced source identity must resolve; inner joins may not silently drop rows.
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','missing-ref',jsonb_build_object('asset_characters',jsonb_build_array(jsonb_build_object('asset_identity_key','asset-1','character_identity_key','missing-character','raw_observation','{}'::jsonb))));
    raise exception 'missing relationship unexpectedly accepted';
  exception when others then if sqlerrm not like '%unresolved asset-character key%' then raise; end if; end;
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','missing-parent',jsonb_build_object('guide_nodes',jsonb_build_array(jsonb_build_object('source_identity_key','orphan-node','source_node_key','orphan-source','style_guide_identity_key','guide-1','parent_node_identity_key','absent-parent','depth',2,'exact_label','Synthetic Orphan','display_order',1,'materialized_source_path','/absent/orphan','raw_source','{}'::jsonb))));
    raise exception 'missing parent unexpectedly accepted';
  exception when others then if sqlerrm not like '%unresolved or cross-guide parent%' then raise; end if; end;
  -- Exact observation replay is idempotent, but changed direct evidence fails closed.
  perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','relationships-replay',jsonb_build_object('node_assets',jsonb_build_array(jsonb_build_object('guide_node_identity_key','node-12','page_number',1,'asset_identity_key','asset-1','file_observation_key','obs-1a','exact_filename','invented-one-a.bin','file_extension','bin','file_size_bytes',10,'source_display_order',1,'raw_observation_sha256',repeat('1',64),'raw_observation',jsonb_build_object('fixture','one-a')))));
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','relationships-conflict',jsonb_build_object('node_assets',jsonb_build_array(jsonb_build_object('guide_node_identity_key','node-12','page_number',1,'asset_identity_key','asset-1','file_observation_key','obs-1a','exact_filename','invented-one-conflict.bin','file_extension','bin','file_size_bytes',10,'source_display_order',1,'raw_observation_sha256',repeat('1',64),'raw_observation',jsonb_build_object('fixture','one-a')))));
    raise exception 'observation conflict unexpectedly accepted';
  exception when others then if sqlerrm not like '%file-observation replay conflict%' then raise; end if; end;
  -- A node identity cannot silently move to another guide. A raw source node key may,
  -- however, legitimately recur under a different guide.
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','second-guide',jsonb_build_object(
      'style_guides',jsonb_build_array(jsonb_build_object('source_identity_key','guide-2','source_guide_key','guide-source-2','category_identity_key','category-1','exact_label','Synthetic Guide Two','display_order',1,'raw_source','{}'::jsonb)),
      'guide_nodes',jsonb_build_array(jsonb_build_object('source_identity_key','node-other-guide','source_node_key','node-source-1','style_guide_identity_key','guide-2','parent_node_identity_key',null,'depth',1,'exact_label','Synthetic Other Root','display_order',1,'materialized_source_path','/other','raw_source','{}'::jsonb))));
    perform plm.load_marvel_asgard_chunk(v_capture,'marvel_asgard','node-guide-conflict',jsonb_build_object('guide_nodes',jsonb_build_array(jsonb_build_object('source_identity_key','node-1','source_node_key','node-source-1','style_guide_identity_key','guide-2','parent_node_identity_key',null,'depth',1,'exact_label','Synthetic Root','display_order',1,'materialized_source_path','/other/root','raw_source','{}'::jsonb))));
    raise exception 'node guide conflict unexpectedly accepted';
  exception when others then if sqlerrm not like '%node identifier conflict%' then raise; end if; end;

  v_result := plm.finalize_marvel_asgard_capture(v_capture,'marvel_asgard');
  if v_result->>'status' <> 'complete' then raise exception 'expected complete capture, got %',v_result; end if;
  if (select max(depth) from plm.marvel_asgard_guide_node where last_seen_capture_key=v_capture) <> 12 then raise exception '12-level hierarchy was not retained'; end if;
  select id into v_asset from plm.marvel_asgard_asset where source_identity_key='asset-1';
  select count(*) into v_count from plm.marvel_asgard_node_asset_observation where capture_key=v_capture and asset_id=v_asset;
  if v_count<>3 then raise exception 'asset multi-filename observation failed: %',v_count; end if;
  if (select count(*) from plm.marvel_asgard_node_asset_observation where capture_key=v_capture and guide_node_id=(select id from plm.marvel_asgard_guide_node where source_identity_key='node-12') and asset_id=v_asset)<>2 then raise exception 'one source UUID did not retain two file observations'; end if;
  if (select count(distinct exact_filename) from plm.marvel_asgard_node_asset_observation where capture_key=v_capture and guide_node_id=(select id from plm.marvel_asgard_guide_node where source_identity_key='node-12') and asset_id=v_asset)<>2 then raise exception 'distinct filenames sharing one source UUID were lost'; end if;
  if (select count(*) from plm.marvel_asgard_asset where source_identity_key='asset-1')<>1 then raise exception 'asset identity duplicated'; end if;
  if (select count(*) from plm.marvel_asgard_asset_character_observation where capture_key=v_capture and asset_id=v_asset)<>2 then raise exception 'many-to-many characters failed'; end if;
  if (select count(*) from plm.marvel_asgard_asset_term_observation where capture_key=v_capture and asset_id=v_asset)<>6 then raise exception 'typed terms failed'; end if;
  if (select likeness_state from plm.marvel_asgard_asset_likeness_observation where capture_key=v_capture and asset_id=(select id from plm.marvel_asgard_asset where source_identity_key='asset-2'))<>'unknown' then raise exception 'tri-state likeness failed'; end if;

  -- A partial successor is rejected and cannot withdraw current evidence.
  perform plm.begin_marvel_asgard_capture(v_partial,'marvel_asgard','https://synthetic.invalid/asgard','synthetic licensed scope','contract-1',repeat('f',64),'2026-08-26T01:00:00Z','{"categories":1,"guides":1,"nodes":1,"pages":1,"assets":1,"node_assets":1,"characters":0,"asset_characters":0,"terms":0,"asset_terms":0,"asset_likeness":0}','{}');
  v_result:=plm.finalize_marvel_asgard_capture(v_partial,'marvel_asgard');
  if v_result->>'status'<>'rejected' then raise exception 'incomplete capture was not rejected'; end if;
  if not (select is_current from plm.marvel_asgard_capture where capture_key=v_capture) then raise exception 'partial capture withdrew current capture'; end if;
  if not (select is_actively_observed from plm.marvel_asgard_asset where id=v_asset) then raise exception 'partial capture deactivated evidence'; end if;

  -- OPA mappings require explicit authority/evidence and never arise from labels.
  select id into v_character from plm.marvel_asgard_character where source_identity_key='character-1';
  select id into v_guide from plm.marvel_asgard_style_guide where source_identity_key='guide-1';
  if exists(select 1 from plm.marvel_asgard_character_opa_resolution) or exists(select 1 from plm.marvel_asgard_guide_opa_property_resolution) then raise exception 'resolution was inferred automatically'; end if;
  begin
    insert into plm.marvel_asgard_character_opa_resolution(asgard_character_id,status) values(v_character,'confirmed');
    raise exception 'authority-free confirmation unexpectedly succeeded';
  exception when check_violation then null; end;
  insert into plm.opa_character(character_id,character_name) values(-910001,'Synthetic OPA Character One'),(-910002,'Synthetic OPA Character Two');
  insert into plm.opa_property(licensed_property_id,property_name) values(-920001,'Synthetic OPA Property One'),(-920002,'Synthetic OPA Property Two');
  insert into plm.marvel_asgard_character_opa_resolution(asgard_character_id,opa_character_id,status,decision_authority,decision_evidence,decided_at)
  values(v_character,-910001,'confirmed','synthetic reviewer','invented contract evidence',now());
  begin
    insert into plm.marvel_asgard_character_opa_resolution(asgard_character_id,opa_character_id,status,decision_authority,decision_evidence,decided_at)
    values(v_character,-910002,'confirmed','synthetic reviewer','invented conflicting evidence',now());
    raise exception 'stacked character confirmation unexpectedly succeeded';
  exception when unique_violation then null; end;
  insert into plm.marvel_asgard_guide_opa_property_resolution(asgard_style_guide_id,opa_property_id,status,decision_authority,decision_evidence,decided_at)
  values(v_guide,-920001,'confirmed','synthetic reviewer','invented contract evidence',now());
  begin
    insert into plm.marvel_asgard_guide_opa_property_resolution(asgard_style_guide_id,opa_property_id,status,decision_authority,decision_evidence,decided_at)
    values(v_guide,-920002,'confirmed','synthetic reviewer','invented conflicting evidence',now());
    raise exception 'stacked guide confirmation unexpectedly succeeded';
  exception when unique_violation then null; end;

  -- Payloads from another source and media/account secrets are refused.
  begin
    perform plm.load_marvel_asgard_chunk(v_capture,'dcp','mixed-guide','{}');
    raise exception 'DCP source unexpectedly accepted';
  exception when others then if sqlerrm='DCP source unexpectedly accepted' then raise; end if; end;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='plm' and table_name like 'marvel_asgard_%'
      and grantee in ('anon','authenticated')
  ) then raise exception 'licensed ASGARD table leaked to client role'; end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='plm' and table_name like 'marvel_asgard_%'
      and grantee='service_role' and privilege_type<>'SELECT'
  ) then raise exception 'service_role has direct table mutation privilege'; end if;
end $$;

rollback;
