-- Issue #2543. Invented fixtures only; no licensed source values.
begin;

do $$
declare
  v_scopes jsonb := jsonb_build_object(
    'disney_home_standard',jsonb_build_object(
      'region','North America','branch','Disney','lob','200','submission_type','Standard',
      'template_id','21','workflow_id','49','source_sha256',repeat('1',64),
      'property_count',2,'character_count',2,'relationship_count',2,
      'relationship_sha256','a7798b5c1be73e8422c9cde8a7be9a5d1eba1c02505531bc259081a3b5d70339'),
    'lucas_home_standard',jsonb_build_object(
      'region','North America','branch','Lucas','lob','200','submission_type','Standard',
      'template_id','462','workflow_id','50','source_sha256',repeat('2',64),
      'property_count',2,'character_count',2,'relationship_count',2,
      'relationship_sha256','dfd3e0e250673988db545b188f75f4e8bdfab99b5e427d7a146ad629a47f561a'));
  v_totals jsonb := '{"unique_property_count":3,"unique_character_count":3,"scope_membership_count":4,"cross_scope_property_count":1}';
  v_d1 jsonb := '[{"licensed_property_id":"1","property_name":"ZZTEST Disney One","option_source_id":"1007","character_id":"10","character_name":"ZZTEST Character Ten","brand_property_id":"101"}]';
  v_d2 jsonb := '[{"licensed_property_id":"2","property_name":"ZZTEST Shared","option_source_id":"1007","character_id":"20","character_name":"ZZTEST Character Twenty","brand_property_id":"202"}]';
  v_l jsonb := '[{"licensed_property_id":"2","property_name":"ZZTEST Shared","option_source_id":"1007","character_id":"20","character_name":"ZZTEST Character Twenty","brand_property_id":"202"},{"licensed_property_id":"3","property_name":"ZZTEST Lucas Three","option_source_id":"1007","character_id":"30","character_name":"ZZTEST Character Thirty","brand_property_id":"303"}]';
  v_property_only jsonb := '[{"licensed_property_id":"9","property_name":"ZZTEST Property Only","option_source_id":"1007"}]';
  v_id uuid;
  v_bad uuid;
  v_result jsonb;
  v_inventory record;
begin
  -- Before the first complete root, append-only capture tables must report an
  -- unknown latest-complete count, never zero or a retained loading/rejected mix.
  select * into v_inventory from api.source_capture_inventory_exact('opa_capture_scope');
  if v_inventory.latest_complete_row_count is not null
     or v_inventory.latest_complete_status is not null
     or v_inventory.count_basis<>'latest_complete' then
    raise exception 'A0 FAILED: scope inventory invented first-capture coverage: %',row_to_json(v_inventory);
  end if;
  select * into v_inventory from api.source_capture_inventory_exact('opa_property_character_capture');
  if v_inventory.latest_complete_row_count is not null
     or v_inventory.latest_complete_status is not null
     or v_inventory.count_basis<>'latest_complete' then
    raise exception 'A0 FAILED: relationship inventory invented first-capture coverage: %',row_to_json(v_inventory);
  end if;

  -- Two-scope success plus identical chunk idempotency.
  v_id:=plm.begin_opa_capture('ZZTEST-complete','u2giants/licensor-source-data',repeat('a',40),repeat('b',64),
    '2099-01-01Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.load_opa_capture_chunk(v_id,'disney_home_standard','d1',
    'a2a9f355791c754bebf946550c6e30b3a752111b468b69dc4153572c23d9ef7e',repeat('c',64),v_d1,false);
  if v_result->>'status'<>'loaded' then raise exception 'A1 FAILED: first chunk %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_id,'disney_home_standard','d1',
    'a2a9f355791c754bebf946550c6e30b3a752111b468b69dc4153572c23d9ef7e',repeat('c',64),v_d1,false);
  if v_result->>'status'<>'identical_retry' then raise exception 'A2 FAILED: identical retry %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_id,'disney_home_standard','d2',
    '81cd7ba540228e25d033c1745671e132fbad8305bfea6f7038610941669ccfbd',repeat('c',64),v_d2,false);
  if v_result->>'status'<>'loaded' then raise exception 'A3 FAILED: Disney final chunk load %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_id,'disney_home_standard','d2',
    '81cd7ba540228e25d033c1745671e132fbad8305bfea6f7038610941669ccfbd',repeat('c',64),v_d2,true);
  if v_result->>'status'<>'scope_complete' then raise exception 'A4 FAILED: Disney finish retry %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_id,'disney_home_standard','d2',
    '81cd7ba540228e25d033c1745671e132fbad8305bfea6f7038610941669ccfbd',repeat('c',64),v_d2,true);
  if v_result->>'status'<>'scope_complete' then raise exception 'A5 FAILED: completed finish retry %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_id,'lucas_home_standard','l1',
    'dfd3e0e250673988db545b188f75f4e8bdfab99b5e427d7a146ad629a47f561a',repeat('d',64),v_l,true);
  if v_result->>'status'<>'scope_complete' then raise exception 'A6 FAILED: Lucas cross-scope-pair finish %',v_result; end if;
  v_result:=plm.finalize_opa_capture(v_id);
  if v_result->>'status'<>'complete' then raise exception 'A7 FAILED: finalize %',v_result; end if;
  if not exists(select 1 from plm.opa_capture where id=v_id and status='complete'
    and observed_unique_property_count=3 and observed_unique_character_count=3
    and observed_scope_membership_count=4 and observed_cross_scope_property_count=1
    and observed_relationship_count=4 and observed_duplicate_pair_count=0) then
    raise exception 'A8 FAILED: coherent aggregate was not recorded';
  end if;

  -- Authentication failure is terminal and loads nothing.
  v_bad:=plm.begin_opa_capture('ZZTEST-auth','u2giants/licensor-source-data',repeat('a',40),repeat('c',64),
    '2099-02-01Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','d1',repeat('9',64),'bad',v_d1,false);
  if v_result->>'status'<>'rejected' or exists(select 1 from plm.opa_property_character_capture where capture_id=v_bad) then
    raise exception 'B FAILED: authentication failure was not a zero-write rejection';
  end if;

  -- Zero and shrink manifests are refused at begin.
  begin
    perform plm.begin_opa_capture('ZZTEST-zero','repo',repeat('a',40),repeat('d',64),'2099-03-01Z',
      jsonb_set(v_scopes,'{disney_home_standard,property_count}','0'),v_totals,'ZZTEST');
    raise exception 'C1 FAILED: zero scope accepted';
  exception when others then
    if sqlerrm like 'C1 FAILED:%' then raise; end if;
  end;
  begin
    perform plm.begin_opa_capture('ZZTEST-shrink','repo',repeat('a',40),repeat('e',64),'2099-03-02Z',
      jsonb_set(v_scopes,'{disney_home_standard,property_count}','1'),
      jsonb_set(v_totals,'{unique_property_count}','2'),'ZZTEST');
    raise exception 'C2 FAILED: shrink accepted';
  exception when others then
    if sqlerrm like 'C2 FAILED:%' then raise; end if;
  end;

  -- A duplicate pair in one chunk is rejected.
  v_bad:=plm.begin_opa_capture('ZZTEST-duplicate','repo',repeat('a',40),repeat('f',64),'2099-04-01Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','dup',
    '3a77b293fc55c3270529365805f403c62aec34bd2c929671970573a0fe625607',repeat('c',64),v_d1||v_d1,false);
  if v_result->>'status'<>'rejected' or v_result#>>'{failure,code}'<>'duplicate_pair' then
    raise exception 'D FAILED: duplicate pair %',v_result;
  end if;

  -- A property-only duplicate across chunks is a guarded collision, not a raw unique violation.
  v_bad:=plm.begin_opa_capture('ZZTEST-null-pair','repo',repeat('a',40),repeat('0',64),'2099-04-02Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','property-only-1',
    '52b7d9e41ab1ec0a4a1f1fa36da42ef573dd44d058d4d88e71f9063adaf08525',repeat('c',64),v_property_only,false);
  if v_result->>'status'<>'loaded' then raise exception 'D2 FAILED: property-only first chunk %',v_result; end if;
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','property-only-2',
    '52b7d9e41ab1ec0a4a1f1fa36da42ef573dd44d058d4d88e71f9063adaf08525',repeat('c',64),v_property_only,false);
  if v_result->>'status'<>'rejected' or v_result#>>'{failure,code}'<>'pair_collision' then
    raise exception 'D2 FAILED: property-only collision was not guarded %',v_result;
  end if;

  -- A short final scope is rejected by its count/hash reconciliation.
  v_bad:=plm.begin_opa_capture('ZZTEST-short','repo',repeat('a',40),repeat('1',64),'2099-05-01Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','short',
    'a2a9f355791c754bebf946550c6e30b3a752111b468b69dc4153572c23d9ef7e',repeat('c',64),v_d1,true);
  if v_result->>'status'<>'rejected' or v_result#>>'{failure,code}'<>'scope_count_or_hash_mismatch' then
    raise exception 'E FAILED: short/hash-mismatch scope %',v_result;
  end if;

  -- A changed retry cannot overwrite the first immutable chunk.
  v_bad:=plm.begin_opa_capture('ZZTEST-changed','repo',repeat('a',40),repeat('2',64),'2099-06-01Z',v_scopes,v_totals,'ZZTEST');
  perform plm.load_opa_capture_chunk(v_bad,'disney_home_standard','same',
    'a2a9f355791c754bebf946550c6e30b3a752111b468b69dc4153572c23d9ef7e',repeat('c',64),v_d1,false);
  v_result:=plm.load_opa_capture_chunk(v_bad,'disney_home_standard','same',
    '81cd7ba540228e25d033c1745671e132fbad8305bfea6f7038610941669ccfbd',repeat('c',64),v_d2,false);
  if v_result->>'status'<>'rejected' or v_result#>>'{failure,code}'<>'changed_chunk_retry'
     or (select count(*) from plm.opa_property_character_capture where capture_id=v_bad)<>1 then
    raise exception 'F FAILED: changed retry %',v_result;
  end if;

  -- Finalization with no finished scopes is terminally non-authoritative.
  v_bad:=plm.begin_opa_capture('ZZTEST-incomplete','repo',repeat('a',40),repeat('3',64),'2099-07-01Z',v_scopes,v_totals,'ZZTEST');
  v_result:=plm.finalize_opa_capture(v_bad);
  if v_result->>'status'<>'rejected' or v_result#>>'{failure,code}'<>'incomplete_scope_coverage' then
    raise exception 'G FAILED: incomplete finalize %',v_result;
  end if;

  -- The newer rejected root cannot replace or mix with the exact latest complete root.
  select * into v_inventory from api.source_capture_inventory_exact('opa_property_character_capture');
  if v_inventory.latest_complete_row_count<>4 or v_inventory.latest_complete_status<>'complete'
     or v_inventory.count_basis<>'latest_complete' then
    raise exception 'H1 FAILED: exact inventory mixed a partial root: %',row_to_json(v_inventory);
  end if;
  select * into v_inventory from api.source_capture_inventory_exact('opa_capture_scope');
  if v_inventory.latest_complete_row_count<>2 then
    raise exception 'H2 FAILED: scope inventory mixed roots: %',row_to_json(v_inventory);
  end if;
  select * into v_inventory from api.source_capture_inventory_exact('opa_property');
  if v_inventory.count_basis<>'current_snapshot' then
    raise exception 'H3 FAILED: mutable OPA entity basis changed: %',row_to_json(v_inventory);
  end if;

  -- Browser-safe inventory stays fixed-width metadata: no capture identity, hashes,
  -- source paths, authentication evidence, or licensed row fields can appear.
    if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema='api' and table_name='source_capture_inventory') is distinct from array[
        'source_system','table_name','row_count','carries_resolution','table_comment',
        'retained_row_count','latest_complete_row_count','count_basis','latest_complete_status','count_note'] then
    raise exception 'I1 FAILED: bounded inventory column contract changed';
  end if;
  if pg_get_viewdef('api.source_capture_inventory'::regclass,true) ilike any(array[
      '%source_manifest_sha256%','%authentication_evidence%','%property_name%','%character_name%']) then
    raise exception 'I2 FAILED: bounded inventory exposes private evidence';
  end if;
  if has_table_privilege('authenticated','plm.opa_capture','SELECT')
     or has_table_privilege('authenticated','plm.opa_capture_scope','SELECT')
     or has_table_privilege('authenticated','plm.opa_property_character_capture','SELECT') then
    raise exception 'I3 FAILED: browser can read private OPA evidence tables';
  end if;
end;
$$;

rollback;
