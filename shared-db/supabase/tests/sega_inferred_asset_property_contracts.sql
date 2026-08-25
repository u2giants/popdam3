-- Issue #1276. Invented fixtures only; every change rolls back.
begin;

do $$
declare
  v_n integer;
  v_def text := pg_get_functiondef(
    'plm.finalize_sega_capture(uuid,jsonb,jsonb)'::regprocedure);
begin
  if to_regclass('plm.sega_asset_property_inferred') is null then
    raise exception 'A FAILED: inferred table is missing';
  end if;
  if position('asset_properties_inferred' in v_def) = 0
     or position('orphan_asset_property_inferred_link' in v_def) = 0 then
    raise exception 'A FAILED: finalize lacks inferred count/orphan gates';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname='plm' and tablename='sega_asset_property_inferred'
     and policyname in ('sega_asset_property_inferred_service_read',
                        'sega_asset_property_inferred_plm_read');
  if v_n <> 2 then raise exception 'A FAILED: expected two explicit read policies, got %',v_n; end if;
  if not has_table_privilege('service_role','plm.sega_asset_property_inferred','SELECT')
     or not has_table_privilege('service_role','plm.sega_asset_property_inferred','INSERT')
     or has_table_privilege('service_role','plm.sega_asset_property_inferred','UPDATE')
     or has_table_privilege('service_role','plm.sega_asset_property_inferred','DELETE')
     or has_table_privilege('service_role','plm.sega_asset_property_inferred','TRUNCATE')
     or has_table_privilege('anon','plm.sega_asset_property_inferred','SELECT') then
    raise exception 'A FAILED: inferred table ACL contract is wrong';
  end if;
  if (select source_system from api.source_capture_inventory
       where table_name='sega_asset_property_inferred') <> 'sega'
     or (select count_basis from api.source_capture_inventory
       where table_name='sega_asset_property_inferred') <> 'latest_complete' then
    raise exception 'A FAILED: additive Sega inventory classification is wrong';
  end if;
  if position('source_asset_ip_association' in pg_get_constraintdef(
       (select oid from pg_constraint
         where conrelid='plm.sega_asset_property'::regclass
           and conname='sega_asset_property_evidence_type_chk'))) = 0 then
    raise exception 'A FAILED: direct-table truth constraint changed';
  end if;
  raise notice 'A passed: objects, finalize, inventory, direct boundary and ACL/RLS exist';
end;
$$;

do $$
declare
  v_cap uuid;
  v_other uuid;
  v_counts jsonb := '{
    "properties":2,"property_licensors":0,"catalogs":1,
    "style_guide_candidates":0,"character_candidates":0,"character_evidence":0,
    "assets":1,"tags":0,"asset_catalogs":0,"asset_tags":0,
    "asset_properties":0,"asset_properties_inferred":2,
    "style_guide_properties_inferred":0,"character_properties_inferred":0,
    "media_downloaded":0
  }'::jsonb;
  v_bad integer := 0;
  v_con text;
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-1276-main', 'ZZTEST-repo', repeat('1',40), repeat('1',64),
    'https://example.invalid', '2099-08-25Z', v_counts, '{}', 'ZZTEST',
    false,true,true,true);
  v_other := plm.begin_sega_capture(
    'ZZTEST-1276-other', 'ZZTEST-repo', repeat('2',40), repeat('2',64),
    'https://example.invalid', '2099-08-26Z', v_counts, '{}', 'ZZTEST',
    false,true,true,true);

  insert into plm.sega_property
    (capture_id,property_source_id,property_label,source_url,source_hash,raw)
  values
    (v_cap,'ZZ-P1','ZZ property one','https://example.invalid','h1','{}'),
    (v_cap,'ZZ-P2','ZZ property two','https://example.invalid','h2','{}'),
    (v_other,'ZZ-P1','ZZ property one','https://example.invalid','h3','{}'),
    (v_other,'ZZ-P2','ZZ property two','https://example.invalid','h4','{}');
  insert into plm.sega_catalog
    (capture_id,catalog_source_id,catalog_label,hierarchy_path,hierarchy_depth,source_hash,raw)
  values
    (v_cap,'ZZ-C1','ZZ catalog','/zz-catalog',1,'h5','{}'),
    (v_other,'ZZ-C1','ZZ catalog','/zz-catalog',1,'h6','{}'),
    (v_other,'ZZ-OTHER','ZZ other catalog','/zz-other',1,'h9','{}');
  insert into plm.sega_asset(capture_id,asset_source_id,file_name,source_hash,raw)
  values
    (v_cap,'ZZ-A1','zz-one.ext','h7','{}'),
    (v_other,'ZZ-A1','zz-one.ext','h8','{}');

  -- Multi-property is intentional: the same asset and catalog can retain two properties.
  insert into plm.sega_asset_property_inferred
    (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
     match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
  values
    (v_cap,'ZZ-A1','ZZ-P1','ZZ-E1','ZZ-C1','normalized_label','zz one','zz one','v1',0.900,'{}'),
    (v_cap,'ZZ-A1','ZZ-P2','ZZ-E2','ZZ-C1','subtree_of_match','zz two','zz two','v1',0.800,'{}');
  if (select count(*) from plm.sega_asset_property_inferred
       where capture_id=v_cap and asset_source_id='ZZ-A1') <> 2 then
    raise exception 'B FAILED: multi-property asset was collapsed';
  end if;

  begin
    insert into plm.sega_asset_property_inferred
      (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
       match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
    values (v_cap,'ZZ-A1','ZZ-P1','ZZ-XCAP','ZZ-C1','exact_label','x','x','v1',1,'{}');
    raise exception 'B FAILED: duplicate asset/property/catalog evidence was accepted';
  exception when unique_violation then v_bad:=v_bad+1; end;

  begin
    insert into plm.sega_asset_property_inferred
      (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
       match_method,matched_property_key,matched_catalog_key,rule_version,confidence,
       relationship_truth,raw)
    values (v_other,'ZZ-A1','ZZ-P1','ZZ-BAD-TRUTH','ZZ-C1','exact_label','x','x',
            'v1',1,'direct','{}');
    raise exception 'B FAILED: non-inferred truth was accepted';
  exception when check_violation then
    get stacked diagnostics v_con=constraint_name;
    if v_con <> 'sega_asset_property_inferred_truth_chk' then raise; end if;
    v_bad:=v_bad+1;
  end;

  begin
    insert into plm.sega_asset_property_inferred
      (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
       match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
    values (v_other,'ZZ-A1','ZZ-P1','ZZ-BAD-METHOD','ZZ-C1','guessed','x','x','v1',1,'{}');
    raise exception 'B FAILED: unknown match method was accepted';
  exception when check_violation then v_bad:=v_bad+1; end;

  begin
    insert into plm.sega_asset_property_inferred
      (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
       match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
    values (v_other,'ZZ-A1','ZZ-P1','ZZ-BAD-CONF','ZZ-C1','exact_label','x','x','v1',1.001,'{}');
    raise exception 'B FAILED: out-of-range confidence was accepted';
  exception when check_violation then v_bad:=v_bad+1; end;

  begin
    -- All endpoint IDs exist, but not together in v_cap: composite FKs refuse crossing.
    insert into plm.sega_asset_property_inferred
      (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
       match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
    values (v_cap,'ZZ-A1','ZZ-P1','ZZ-XCAP-2','ZZ-OTHER','exact_label','x','x','v1',1,'{}');
    raise exception 'B FAILED: a cross-capture endpoint was accepted';
  exception when foreign_key_violation then v_bad:=v_bad+1; end;

  if v_bad <> 5 then raise exception 'B FAILED: only % of 5 refusals fired',v_bad; end if;

  perform plm.finalize_sega_capture(v_cap,v_counts,'[]');
  if (select status from plm.sega_capture where id=v_cap) <> 'complete'
     or (select observed_counts->>'asset_properties_inferred'
           from plm.sega_capture where id=v_cap) <> '2' then
    raise exception 'B FAILED: matching inferred count did not finalize complete';
  end if;
  raise notice 'B passed: multi-property survives; constraints, capture FKs and final count pass';
end;
$$;

do $$
declare
  v_cap uuid;
  v_counts jsonb := '{
    "properties":1,"property_licensors":0,"catalogs":1,
    "style_guide_candidates":0,"character_candidates":0,"character_evidence":0,
    "assets":1,"tags":0,"asset_catalogs":0,"asset_tags":0,
    "asset_properties":0,"asset_properties_inferred":0,
    "style_guide_properties_inferred":0,"character_properties_inferred":0,
    "media_downloaded":0
  }'::jsonb;
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-1276-mismatch', 'ZZTEST-repo', repeat('3',40), repeat('3',64),
    'https://example.invalid', '2099-08-27Z', v_counts, '{}', 'ZZTEST',
    false,true,true,true);
  insert into plm.sega_property
    (capture_id,property_source_id,property_label,source_url,source_hash,raw)
  values (v_cap,'ZZ-P','ZZ property','https://example.invalid','h','{}');
  insert into plm.sega_catalog
    (capture_id,catalog_source_id,catalog_label,hierarchy_path,hierarchy_depth,source_hash,raw)
  values (v_cap,'ZZ-C','ZZ catalog','/zz-c',1,'h','{}');
  insert into plm.sega_asset(capture_id,asset_source_id,file_name,source_hash,raw)
  values (v_cap,'ZZ-A','zz.ext','h','{}');
  insert into plm.sega_asset_property_inferred
    (capture_id,asset_source_id,property_source_id,evidence_key,catalog_source_id,
     match_method,matched_property_key,matched_catalog_key,rule_version,confidence,raw)
  values (v_cap,'ZZ-A','ZZ-P','ZZ-E','ZZ-C','exact_label','zz','zz','v1',1,'{}');

  perform plm.finalize_sega_capture(v_cap,v_counts,'[]');
  if (select status from plm.sega_capture where id=v_cap) <> 'rejected'
     or not (select error_summary @> '[{"code":"count_mismatch","entity":"asset_properties_inferred"}]'
               from plm.sega_capture where id=v_cap) then
    raise exception 'C FAILED: inferred count mismatch did not persist a rejection';
  end if;
  raise notice 'C passed: inferred three-way count mismatch rejects publication';
end;
$$;

rollback;
