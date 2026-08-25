-- Issue #1451 contracts. Every fixture is invented and the transaction rolls back.
begin;

-- Objects, append-only ACL, RLS, and the two separate capture clocks.
do $$
declare v_table text; v_policy_count integer;
begin
  foreach v_table in array array[
    'sega_submission_capture','sega_submission_property',
    'sega_style_guide_property_inferred','sega_character_property_inferred'
  ] loop
    if to_regclass('plm.'||v_table) is null then
      raise exception 'missing plm.%',v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid=('plm.'||v_table)::regclass) then
      raise exception 'RLS disabled on plm.%',v_table;
    end if;
    select count(*) into v_policy_count from pg_policies
      where schemaname='plm' and tablename=v_table;
    if v_policy_count<>2 then raise exception 'plm.% has % policies, expected 2',v_table,v_policy_count; end if;
    if not has_table_privilege('service_role','plm.'||v_table,'SELECT')
       or not has_table_privilege('authenticated','plm.'||v_table,'SELECT')
       or has_table_privilege('anon','plm.'||v_table,'SELECT')
       or has_table_privilege('service_role','plm.'||v_table,'UPDATE')
       or has_table_privilege('service_role','plm.'||v_table,'DELETE')
       or has_table_privilege('service_role','plm.'||v_table,'TRUNCATE') then
      raise exception 'append-only/read ACL mismatch on plm.%',v_table;
    end if;
  end loop;
  if has_table_privilege('service_role','plm.sega_submission_capture','INSERT') then
    raise exception 'submission root must be function-only';
  end if;
  foreach v_table in array array[
    'sega_submission_property','sega_style_guide_property_inferred',
    'sega_character_property_inferred'
  ] loop
    if not has_table_privilege('service_role','plm.'||v_table,'INSERT') then
      raise exception 'service_role lacks append privilege on plm.%',v_table;
    end if;
  end loop;
  if has_function_privilege('authenticated',
      'plm.begin_sega_submission_capture(text,text,text,text,text,timestamptz,text,jsonb,boolean,text,text,boolean,jsonb,text)','EXECUTE')
     or not has_function_privilege('service_role',
      'plm.finalize_sega_submission_capture(uuid,jsonb,jsonb)','EXECUTE') then
    raise exception 'submission function ACL mismatch';
  end if;
end $$;

-- Read-only Product Approval vocabulary: idempotency, success, and refusal gates.
do $$
declare v_id uuid; v_again uuid; v_bad uuid;
begin
  v_id:=plm.begin_sega_submission_capture(
    'ZZTEST-submission-good','ZZTEST/repo',repeat('1',40),repeat('2',64),
    'https://example.invalid/submission','2099-08-25T01:00:00Z','ZZTEST-contract',
    '{"submission_properties":2}',false,repeat('3',64),repeat('3',64),true,
    '{"invented":true}','ZZTEST');
  v_again:=plm.begin_sega_submission_capture(
    'ZZTEST-submission-good','ZZTEST/repo',repeat('1',40),repeat('2',64),
    'https://example.invalid/submission','2099-08-25T01:00:00Z','ZZTEST-contract',
    '{"submission_properties":2}',false,repeat('3',64),repeat('3',64),true,
    '{"invented":true}','ZZTEST');
  if v_id<>v_again then raise exception 'identical submission capture did not resume'; end if;

  insert into plm.sega_submission_property
    (submission_capture_id,property_source_id,property_label,source_url,source_hash,raw)
  values
    (v_id,'ZZTEST-SP1','ZZTEST Property One','https://example.invalid/1','ZZTEST-h1','{}'),
    (v_id,'ZZTEST-SP2','ZZTEST Property Two','https://example.invalid/2','ZZTEST-h2','{}');
  perform plm.finalize_sega_submission_capture(v_id,'{"submission_properties":2}','[]');
  if (select status from plm.sega_submission_capture where id=v_id)<>'complete' then
    raise exception 'valid read-only vocabulary capture did not complete';
  end if;

  v_bad:=plm.begin_sega_submission_capture(
    'ZZTEST-submission-save','ZZTEST/repo',repeat('4',40),repeat('5',64),
    'https://example.invalid/save','2099-08-25T01:01:00Z','ZZTEST-contract',
    '{"submission_properties":0}',true,repeat('6',64),repeat('7',64),false,
    '{"invented":true}','ZZTEST');
  perform plm.finalize_sega_submission_capture(v_bad,'{"submission_properties":0}','[]');
  if (select status from plm.sega_submission_capture where id=v_bad)<>'rejected'
     or not ((select error_summary from plm.sega_submission_capture where id=v_bad)
       @> '[{"code":"save_clicked"},{"code":"submission_created_or_unknown"},{"code":"submission_list_changed"}]') then
    raise exception 'submission mutation gates did not reject with named evidence';
  end if;

  v_bad:=plm.begin_sega_submission_capture(
    'ZZTEST-submission-count','ZZTEST/repo',repeat('8',40),repeat('9',64),
    'https://example.invalid/count','2099-08-25T01:02:00Z','ZZTEST-contract',
    '{"submission_properties":1}',false,repeat('a',64),repeat('a',64),true,
    '{"invented":true}','ZZTEST');
  perform plm.finalize_sega_submission_capture(v_bad,'{"submission_properties":0}','[]');
  if (select status from plm.sega_submission_capture where id=v_bad)<>'rejected' then
    raise exception 'submission count mismatch did not reject';
  end if;

  begin
    perform plm.begin_sega_submission_capture(
      'ZZTEST-submission-good','ZZTEST/repo',repeat('1',40),repeat('f',64),
      'https://example.invalid/submission','2099-08-25T01:00:00Z','ZZTEST-contract',
      '{"submission_properties":2}',false,repeat('3',64),repeat('3',64),true,
      '{"invented":true}','ZZTEST');
    raise exception 'contradictory capture key was accepted';
  exception when others then
    if position('different evidence' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- Multi-Property inferred evidence remains separate from direct source truth.
do $$
declare v_cap uuid; v_other uuid; v_counts jsonb:=
  '{"properties":2,"property_licensors":0,"catalogs":1,"style_guide_candidates":1,
    "character_candidates":1,"character_evidence":1,"assets":0,"tags":0,
    "asset_catalogs":0,"asset_tags":0,"asset_properties":0,
    "asset_properties_inferred":0,"style_guide_properties_inferred":2,
    "character_properties_inferred":2}'::jsonb;
begin
  v_cap:=plm.begin_sega_capture('ZZTEST-1451-main', 'ZZTEST/repo',repeat('b',40),repeat('c',64),
    'https://example.invalid/assets','2099-08-25T02:00:00Z',v_counts,'{}','ZZTEST',false,true,true,true);
  v_other:=plm.begin_sega_capture('ZZTEST-1451-other','ZZTEST/repo',repeat('d',40),repeat('e',64),
    'https://example.invalid/other','2099-08-25T02:01:00Z',v_counts,'{}','ZZTEST',false,true,true,true);
  insert into plm.sega_property(capture_id,property_source_id,property_label,source_url,source_hash,raw)
  values(v_cap,'ZZTEST-P1','ZZTEST Property One','https://example.invalid/p1','h1','{}'),
        (v_cap,'ZZTEST-P2','ZZTEST Property Two','https://example.invalid/p2','h2','{}'),
        (v_other,'ZZTEST-P1','ZZTEST Property One','https://example.invalid/p1','h1','{}');
  insert into plm.sega_catalog(capture_id,catalog_source_id,parent_catalog_source_id,catalog_label,
    hierarchy_path,hierarchy_depth,source_hash,raw)
  values(v_cap,'ZZTEST-C1',null,'ZZTEST Catalog','/zztest',1,'h','{}');
  insert into plm.sega_style_guide_candidate(capture_id,catalog_source_id,candidate_label,
    classification_type,evidence_value,rule_version,confidence,raw)
  values(v_cap,'ZZTEST-C1','ZZTEST Guide','style_guide','ZZTEST evidence','v1',0.9,'{}');
  insert into plm.sega_character_candidate(capture_id,character_candidate_key,candidate_label,
    normalized_candidate_label,inference_method,rule_version,raw)
  values(v_cap,'ZZTEST-CH1','ZZTEST Character','zztest character','catalog_path','v1','{}');
  insert into plm.sega_character_evidence(capture_id,character_candidate_key,evidence_key,
    catalog_source_id,evidence_type,evidence_value,confidence,raw)
  values(v_cap,'ZZTEST-CH1','ZZTEST-E1','ZZTEST-C1','catalog_path','ZZTEST evidence',0.8,'{}');

  insert into plm.sega_style_guide_property_inferred(capture_id,catalog_source_id,
    property_source_id,evidence_key,evidence_catalog_source_id,match_method,rule_version,confidence,raw)
  values(v_cap,'ZZTEST-C1','ZZTEST-P1','ZZTEST-path-1','ZZTEST-C1','exact_label','v1',1,'{}'),
        (v_cap,'ZZTEST-C1','ZZTEST-P2','ZZTEST-path-2','ZZTEST-C1','normalized_label','v1',0.8,'{}');
  insert into plm.sega_character_property_inferred(capture_id,character_candidate_key,
    property_source_id,evidence_key,match_method,rule_version,confidence,raw)
  values(v_cap,'ZZTEST-CH1','ZZTEST-P1','ZZTEST-E1','exact_label','v1',1,'{}'),
        (v_cap,'ZZTEST-CH1','ZZTEST-P2','ZZTEST-E1','subtree_of_match','v1',0.7,'{}');
  if (select count(*) from plm.sega_style_guide_property_inferred where capture_id=v_cap)<>2
     or (select count(*) from plm.sega_character_property_inferred where capture_id=v_cap)<>2 then
    raise exception 'multi-Property evidence collapsed';
  end if;
  if exists(select 1 from plm.sega_style_guide_property_inferred where relationship_truth<>'inferred')
     or exists(select 1 from plm.sega_character_property_inferred where relationship_truth<>'inferred') then
    raise exception 'inferred provenance was not pinned';
  end if;

  begin
    insert into plm.sega_style_guide_property_inferred(capture_id,catalog_source_id,
      property_source_id,evidence_key,evidence_catalog_source_id,match_method,rule_version,confidence,raw)
    values(v_cap,'ZZTEST-C1','ZZTEST-P1','ZZTEST-cross','ZZTEST-C1','exact_label','v1',0.5,'{}');
    -- Duplicate proves identity includes evidence key; now force a cross-capture Property.
    update plm.sega_style_guide_property_inferred set property_source_id='ZZTEST-P-X'
      where capture_id=v_cap and evidence_key='ZZTEST-cross';
    raise exception 'missing/cross-capture Property endpoint was accepted';
  exception when foreign_key_violation then null; end;

  begin
    insert into plm.sega_character_property_inferred(capture_id,character_candidate_key,
      property_source_id,evidence_key,match_method,rule_version,confidence,relationship_truth,raw)
    values(v_cap,'ZZTEST-CH1','ZZTEST-P1','ZZTEST-E1','exact_label','v1',0.5,'direct','{}');
    raise exception 'direct truth was accepted in inferred table';
  exception when check_violation then null; end;

  begin
    insert into plm.sega_asset_property(capture_id,asset_source_id,property_source_id,evidence_type,raw)
    values(v_cap,'ZZTEST-NO-ASSET','ZZTEST-P1','catalog_containment_inference','{}');
    raise exception 'direct table accepted inferred evidence';
  exception when check_violation then null; end;

  perform plm.finalize_sega_capture(v_cap,v_counts,'[]');
  if (select status from plm.sega_capture where id=v_cap)<>'complete' then
    raise exception '14-key asset publication gate did not complete';
  end if;
end $$;

-- Inventory exposes all four additions, with a submission clock independent of asset capture.
do $$
declare r record;
begin
  if (select count(*) from api.source_capture_inventory
      where source_system='sega' and table_name in ('sega_submission_capture',
        'sega_submission_property','sega_style_guide_property_inferred',
        'sega_character_property_inferred'))<>4 then
    raise exception 'ordinary inventory does not classify all #1451 tables';
  end if;
  select * into r from api.source_capture_inventory_exact('sega_submission_property');
  if r.latest_complete_row_count<>2 or r.count_basis<>'latest_complete'
     or r.latest_complete_status<>'complete' then
    raise exception 'submission exact inventory returned % / % / %',
      r.latest_complete_row_count,r.count_basis,r.latest_complete_status;
  end if;
  select * into r from api.source_capture_inventory_exact('sega_style_guide_property_inferred');
  if r.latest_complete_row_count<>2 then
    raise exception 'asset-clock inferred guide count was %, expected 2',r.latest_complete_row_count;
  end if;
end $$;

rollback;
