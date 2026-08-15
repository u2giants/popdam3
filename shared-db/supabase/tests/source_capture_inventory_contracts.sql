-- Issue #969. Invented transaction fixtures only; no licensed source values.

begin;

do $$
declare
  v_cols text[];
  v_text text;
begin
  select array_agg(column_name order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'api' and table_name = 'source_capture_inventory';
  if v_cols is distinct from array[
    'source_system','table_name','row_count','carries_resolution','table_comment',
    'retained_row_count','latest_complete_row_count','count_basis',
    'latest_complete_status','count_note'
  ] then
    raise exception 'A FAILED: unexpected columns %', v_cols;
  end if;

  if has_table_privilege('anon', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('authenticated', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('service_role', 'api.source_capture_inventory', 'SELECT') then
    raise exception 'A FAILED: view read grants changed';
  end if;

  select obj_description('api.source_capture_inventory'::regclass, 'pg_class') into v_text;
  if v_text not ilike '%row_count remains a compatibility alias%'
     or v_text not ilike '%NULL means unavailable%'
     or v_text not ilike '%carries_resolution%' then
    raise exception 'A FAILED: view comment does not state the compatibility/count contract';
  end if;
end;
$$;

-- Two complete Paramount captures plus a later failed attempt. The failed rows remain
-- retained but can never become current coverage.
insert into plm.pmt_capture (
  capture_id,status,capture_kind,source_url,library_name,started_at,completed_at,captured_by,
  private_source_commit,manifest_sha256,portal_global_asset_count,licensed_title_count,
  licensed_property_selection_count,property_result_row_count,unique_asset_count,
  metadata_batch_count,failure_count,anomaly_count,validated_at,validation_passed,failure_message)
values
  ('97000000-0000-0000-0000-000000000001','complete','full','https://example.invalid','ZZTEST',
   '2099-01-01Z','2099-01-02Z','ZZTEST',repeat('1',40),repeat('1',64),0,0,0,0,0,0,0,0,
   '2099-01-02Z',true,null),
  ('97000000-0000-0000-0000-000000000002','complete','full','https://example.invalid','ZZTEST',
   '2099-02-01Z','2099-02-02Z','ZZTEST',repeat('2',40),repeat('2',64),0,0,0,0,0,0,0,0,
   '2099-02-02Z',true,null),
  ('97000000-0000-0000-0000-000000000003','failed','full','https://example.invalid','ZZTEST',
   '2099-03-01Z',null,'ZZTEST',repeat('3',40),repeat('3',64),0,0,0,0,0,0,1,0,
   null,null,'ZZTEST failed attempt');

insert into plm.pmt_property (capture_id,property_source_id,property_name,source_hash)
values
  ('97000000-0000-0000-0000-000000000001','97001','ZZTEST old',md5('old')),
  ('97000000-0000-0000-0000-000000000002','97002','ZZTEST current A',md5('new-a')),
  ('97000000-0000-0000-0000-000000000002','97003','ZZTEST current B',md5('new-b')),
  ('97000000-0000-0000-0000-000000000003','97004','ZZTEST failed A',md5('failed-a')),
  ('97000000-0000-0000-0000-000000000003','97005','ZZTEST failed B',md5('failed-b')),
  ('97000000-0000-0000-0000-000000000003','97006','ZZTEST failed C',md5('failed-c'));

-- Two complete NBCU captures plus a newer rejected attempt. The newest complete
-- wins, and the rejected rows remain retained only.
insert into plm.nbcu_capture (
  id,capture_key,source_repository,source_commit_sha,read_commit_sha,source_manifest_sha256,
  portal_base_url,source_captured_at,load_started_at,load_completed_at,status,expected_counts,
  observed_counts,raw_summary,created_by)
values
  ('96900000-0000-0000-0000-000000000000','ZZTEST-969-old-complete','ZZTEST',repeat('3',40),
   repeat('3',40),repeat('3',64),'https://example.invalid','2099-01-01Z','2099-01-01Z',
   '2099-01-02Z','complete','{}','{}','{}','ZZTEST'),
  ('96900000-0000-0000-0000-000000000001','ZZTEST-969-complete','ZZTEST',repeat('4',40),
   repeat('4',40),repeat('4',64),'https://example.invalid','2099-02-01Z','2099-02-01Z',
   '2099-02-02Z','complete','{}','{}','{}','ZZTEST'),
  ('96900000-0000-0000-0000-000000000002','ZZTEST-969-rejected','ZZTEST',repeat('5',40),
   repeat('5',40),repeat('5',64),'https://example.invalid','2099-03-01Z','2099-03-01Z',
   null,'rejected','{}','{}','{}','ZZTEST');

insert into plm.nbcu_property (
  capture_id,property_key,property_source_id,property_label,source_kind,source_url,
  source_captured_at,raw)
values
  ('96900000-0000-0000-0000-000000000000','source-id:96900','96900','ZZTEST old',
   'property','https://example.invalid','2099-01-01Z','{}'),
  ('96900000-0000-0000-0000-000000000001','source-id:96901','96901','ZZTEST current',
   'property','https://example.invalid','2099-02-01Z','{}'),
  ('96900000-0000-0000-0000-000000000002','source-id:96902','96902','ZZTEST rejected A',
   'property','https://example.invalid','2099-03-01Z','{}'),
  ('96900000-0000-0000-0000-000000000002','source-id:96903','96903','ZZTEST rejected B',
   'property','https://example.invalid','2099-03-01Z','{}');

do $$
declare
  r record;
begin
  for r in select * from api.source_capture_inventory loop
    if r.row_count is distinct from r.retained_row_count then
      raise exception 'B FAILED: row_count compatibility broke for %', r.table_name;
    end if;
  end loop;

  select * into r from api.source_capture_inventory where table_name = 'pmt_property';
  if r.latest_complete_row_count <> 2 or r.count_basis <> 'latest_complete'
     or r.latest_complete_status <> 'complete'
     or r.retained_row_count < 6 then
    raise exception 'B FAILED: Paramount latest/retained split wrong: %', row_to_json(r);
  end if;

  select * into r from api.source_capture_inventory where table_name = 'nbcu_property';
  if r.latest_complete_row_count <> 1 or r.count_basis <> 'latest_complete'
     or r.latest_complete_status <> 'complete'
     or r.retained_row_count < 4 then
    raise exception 'B FAILED: NBCU latest/retained split wrong: %', row_to_json(r);
  end if;

  select * into r from api.source_capture_inventory where table_name = 'opa_property_character';
  if r.count_basis <> 'current_snapshot'
     or r.latest_complete_row_count is distinct from r.retained_row_count
     or r.latest_complete_status is not null
     or r.count_note not ilike '%upserted OPA snapshot%' then
    raise exception 'B FAILED: OPA basis wrong: %', row_to_json(r);
  end if;

  select * into r from api.source_capture_inventory where table_name = 'dcp_style_guide';
  if r.count_basis <> 'retained_only' or r.latest_complete_row_count is not null
     or r.latest_complete_status is not null
     or r.count_note not ilike '%cannot be derived%'
     or r.count_note not ilike '%NULL is intentional%' then
    raise exception 'B FAILED: DCP unavailable-membership contract wrong: %', row_to_json(r);
  end if;

  for r in select * from api.source_capture_inventory
    where table_name in ('dcp_chunk_ledger','dcp_asset_tile_observation')
  loop
    if r.count_basis <> 'latest_complete'
       or r.latest_complete_row_count is not null
       or r.latest_complete_status is not null
       or r.count_note not ilike '%No complete DCP crawl exists%' then
      raise exception 'B FAILED: immutable DCP crawl membership mislabeled: %', row_to_json(r);
    end if;
  end loop;
end;
$$;

rollback;
