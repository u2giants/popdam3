-- Paramount TrackerPlus submission-vocabulary landing contracts for issue #2579,
-- migration 20260910155753.
--
-- PUBLIC TEST. Every label, key, repository, hash input and identifier below is
-- invented (ZZTEST / example.invalid). No licensed label, row, URL, contract or
-- raw evidence appears here, and none may ever be added.

begin;

do $$
declare
  v_n integer;
  v_capture uuid;
  v_capture_again uuid;
  v_second uuid;
  v_incomplete uuid;
  v_rows jsonb;
  v_manifest text;
  v_text text;
  v_result jsonb;
  v_refused boolean;
  v_def text;
  v_row record;
begin
  -- ------------------------------------------------------------------
  -- A. Structure: append-only landing shape, RLS, and no direct writes.
  -- ------------------------------------------------------------------
  if to_regclass('plm.pmt_trackerplus_submission_capture') is null
     or to_regclass('plm.pmt_trackerplus_submission_property') is null then
    raise exception 'A FAILED: the TrackerPlus landing tables are missing';
  end if;

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname like 'pmt\_trackerplus\_%'
     and c.relkind = 'r' and c.relrowsecurity;
  if v_n <> 2 then
    raise exception 'A FAILED: RLS enabled on % of 2 TrackerPlus tables', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'plm' and tablename like 'pmt\_trackerplus\_%';
  if v_n <> 2 then
    raise exception 'A FAILED: expected 2 staff-read policies, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'pmt\_trackerplus\_%'
     and grantee in ('PUBLIC', 'anon');
  if v_n <> 0 then
    raise exception 'A FAILED: % public or anon grant(s) survive on the landing tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'pmt\_trackerplus\_%'
     and grantee in ('service_role', 'authenticated', 'anon', 'PUBLIC')
     and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE');
  if v_n <> 0 then
    raise exception 'A FAILED: % mutating grant(s) break the append-only contract', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'pmt\_trackerplus\_%'
     and grantee = 'authenticated' and privilege_type = 'INSERT';
  if v_n <> 0 then
    raise exception 'A FAILED: authenticated can insert directly, bypassing the loaders';
  end if;

  if has_function_privilege('anon',
       'plm.load_pmt_trackerplus_submission_capture_chunk(uuid,integer,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'plm.load_pmt_trackerplus_submission_capture_chunk(uuid,integer,jsonb)', 'EXECUTE') then
    raise exception 'A FAILED: the chunk loader is reachable outside service_role';
  end if;
  if not has_function_privilege('service_role',
       'plm.finalize_pmt_trackerplus_submission_capture(uuid)', 'EXECUTE') then
    raise exception 'A FAILED: service_role cannot finalize a capture';
  end if;

  -- ------------------------------------------------------------------
  -- B. Begin: idempotent on identical evidence, refused on different evidence.
  -- ------------------------------------------------------------------
  -- Every refusal below catches SQLSTATE 'P0001' ONLY -- the errcode the loader
  -- functions raise deliberately. A bare `when others` would also be satisfied by
  -- a missing function (42883), a bad argument, or any unrelated error, so the
  -- test would pass without the refusal ever happening.
  v_rows := jsonb_build_array(
    jsonb_build_object('exact_label', 'ZZTEST Property Alpha', 'ordinal', 0),
    jsonb_build_object('exact_label', 'ZZTEST Property Beta', 'ordinal', 1),
    jsonb_build_object('exact_label', 'ZZTEST Property Gamma', 'ordinal', 2));

  select encode(sha256(convert_to(
           coalesce(string_agg(s.k, chr(10) order by s.k), ''), 'UTF8')), 'hex')
    into v_manifest
    from (select encode(sha256(convert_to(e.value ->> 'exact_label', 'UTF8')), 'hex') as k
            from jsonb_array_elements(v_rows) e) s;

  v_capture := plm.begin_pmt_trackerplus_submission_capture(
    'ZZTEST-trackerplus-0001', 'example.invalid/zztest-source',
    repeat('a', 40), repeat('b', 64), timestamptz '2026-09-10 00:00:00+00',
    3, v_manifest, 'ZZTEST loader');

  v_capture_again := plm.begin_pmt_trackerplus_submission_capture(
    'ZZTEST-trackerplus-0001', 'example.invalid/zztest-source',
    repeat('a', 40), repeat('b', 64), timestamptz '2026-09-10 00:00:00+00',
    3, v_manifest, 'ZZTEST loader');
  if v_capture_again <> v_capture then
    raise exception 'B FAILED: re-declaring the same capture was not idempotent';
  end if;

  v_refused := false;
  begin
    perform plm.begin_pmt_trackerplus_submission_capture(
      'ZZTEST-trackerplus-0001', 'example.invalid/zztest-source',
      repeat('c', 40), repeat('b', 64), timestamptz '2026-09-10 00:00:00+00',
      3, v_manifest, 'ZZTEST loader');
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'B FAILED: a capture_key was reopened with different source evidence';
  end if;

  -- ------------------------------------------------------------------
  -- C. Chunk loading: idempotent repeat, refused change, refused duplicates,
  --    refused fabricated source IDs, refused empty labels.
  -- ------------------------------------------------------------------
  if plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 0, v_rows) <> 3 then
    raise exception 'C FAILED: the first chunk did not load three rows';
  end if;
  if plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 0, v_rows) <> 0 then
    raise exception 'C FAILED: a repeated identical chunk was not an idempotent no-op';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 0,
      jsonb_build_array(
        jsonb_build_object('exact_label', 'ZZTEST Property Delta', 'ordinal', 9)));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a changed chunk for an already loaded index was accepted';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 1,
      jsonb_build_array(
        jsonb_build_object('exact_label', 'ZZTEST Property Alpha', 'ordinal', 7)));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a duplicate exact-label local key was accepted';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 2,
      jsonb_build_array(jsonb_build_object(
        'exact_label', 'ZZTEST Property Epsilon', 'ordinal', 8,
        'property_source_id', 'ZZTEST-999')));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a fabricated portal source ID was accepted at the top level';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 3,
      jsonb_build_array(jsonb_build_object(
        'exact_label', 'ZZTEST Property Zeta', 'ordinal', 10,
        'raw', jsonb_build_object('portal_record_id', 'ZZTEST-1000'))));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a fabricated portal source ID was accepted inside raw';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 4,
      jsonb_build_array(jsonb_build_object('exact_label', '   ', 'ordinal', 11)));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a row without an exact label was accepted';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 5,
      jsonb_build_array(jsonb_build_object(
        'exact_label', 'ZZTEST Property Eta', 'ordinal', 12,
        'property_local_key', repeat('f', 64))));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'C FAILED: a local key that is not the exact-label SHA-256 was accepted';
  end if;

  -- ------------------------------------------------------------------
  -- D. Deterministic local identity, and no invented source ID anywhere.
  -- ------------------------------------------------------------------
  select count(*) into v_n from plm.pmt_trackerplus_submission_property p
   where p.capture_id = v_capture
     and p.property_local_key
         <> encode(sha256(convert_to(p.exact_label, 'UTF8')), 'hex');
  if v_n <> 0 then
    raise exception 'D FAILED: % row(s) carry a local key that is not the exact-label SHA-256', v_n;
  end if;
  select count(*) into v_n from plm.pmt_trackerplus_submission_property p
   where p.capture_id = v_capture and p.identity_method <> 'exact-label-sha256';
  if v_n <> 0 then
    raise exception 'D FAILED: % row(s) claim an identity method other than exact-label-sha256', v_n;
  end if;

  -- ------------------------------------------------------------------
  -- E. Finalize: a count or manifest mismatch rejects; a match completes;
  --    finalizing a complete capture is idempotent; a complete capture is
  --    closed to further rows.
  -- ------------------------------------------------------------------
  v_incomplete := plm.begin_pmt_trackerplus_submission_capture(
    'ZZTEST-trackerplus-0002', 'example.invalid/zztest-source',
    repeat('a', 40), repeat('b', 64), timestamptz '2026-09-09 00:00:00+00',
    5, repeat('d', 64), 'ZZTEST loader');
  perform plm.load_pmt_trackerplus_submission_capture_chunk(v_incomplete, 0,
    jsonb_build_array(
      jsonb_build_object('exact_label', 'ZZTEST Property Theta', 'ordinal', 0)));
  v_result := plm.finalize_pmt_trackerplus_submission_capture(v_incomplete);
  if v_result ->> 'status' <> 'rejected' then
    raise exception 'E FAILED: a short capture finalized as %', v_result ->> 'status';
  end if;
  select count(*) into v_n from plm.pmt_trackerplus_submission_capture
   where id = v_incomplete and status = 'rejected' and load_completed_at is null;
  if v_n <> 1 then
    raise exception 'E FAILED: the rejection was not durably recorded';
  end if;

  v_result := plm.finalize_pmt_trackerplus_submission_capture(v_capture);
  if v_result ->> 'status' <> 'complete' then
    raise exception 'E FAILED: a matching capture did not complete';
  end if;
  if plm.finalize_pmt_trackerplus_submission_capture(v_capture) ->> 'status' <> 'complete' then
    raise exception 'E FAILED: finalizing an already complete capture was not idempotent';
  end if;

  v_refused := false;
  begin
    perform plm.load_pmt_trackerplus_submission_capture_chunk(v_capture, 6,
      jsonb_build_array(
        jsonb_build_object('exact_label', 'ZZTEST Property Iota', 'ordinal', 20)));
  exception when sqlstate 'P0001' then v_refused := true;
  end;
  if not v_refused then
    raise exception 'E FAILED: a complete capture still accepted rows';
  end if;

  -- ------------------------------------------------------------------
  -- F. Latest-complete selection: separate captures are never combined, and a
  --    rejected capture is never treated as current vocabulary.
  -- ------------------------------------------------------------------
  v_rows := jsonb_build_array(
    jsonb_build_object('exact_label', 'ZZTEST Property Alpha', 'ordinal', 0),
    jsonb_build_object('exact_label', 'ZZTEST Property Kappa', 'ordinal', 1));
  select encode(sha256(convert_to(
           coalesce(string_agg(s.k, chr(10) order by s.k), ''), 'UTF8')), 'hex')
    into v_manifest
    from (select encode(sha256(convert_to(e.value ->> 'exact_label', 'UTF8')), 'hex') as k
            from jsonb_array_elements(v_rows) e) s;
  v_second := plm.begin_pmt_trackerplus_submission_capture(
    'ZZTEST-trackerplus-0003', 'example.invalid/zztest-source',
    repeat('a', 40), repeat('e', 64), timestamptz '2026-09-11 00:00:00+00',
    2, v_manifest, 'ZZTEST loader');
  perform plm.load_pmt_trackerplus_submission_capture_chunk(v_second, 0, v_rows);
  if plm.finalize_pmt_trackerplus_submission_capture(v_second) ->> 'status' <> 'complete' then
    raise exception 'F FAILED: the newer capture did not complete';
  end if;

  select id into v_capture_again from plm.pmt_trackerplus_submission_capture
   where status = 'complete'
   order by source_captured_at desc, load_completed_at desc, id desc
   limit 1;
  if v_capture_again <> v_second then
    raise exception 'F FAILED: the latest complete capture is not the newest one';
  end if;

  select i.latest_complete_row_count, i.count_basis, i.latest_complete_status
    into v_row
    from api.source_capture_inventory_exact('pmt_trackerplus_submission_property') i;
  if v_row.count_basis <> 'latest_complete' then
    raise exception 'F FAILED: TrackerPlus count_basis is %, expected latest_complete',
      v_row.count_basis;
  end if;
  if v_row.latest_complete_status <> 'complete' then
    raise exception 'F FAILED: TrackerPlus latest_complete_status is %',
      v_row.latest_complete_status;
  end if;
  -- Exactly the newest capture's two rows: not four, which is what combining the
  -- two complete captures would report, and not five, which is what counting the
  -- rejected capture as well would report.
  if v_row.latest_complete_row_count <> 2 then
    raise exception
      'F FAILED: latest-complete count is %, expected exactly the newest capture 2 rows',
      v_row.latest_complete_row_count;
  end if;

  -- ------------------------------------------------------------------
  -- G. Inventory classification: the new family, and the two post-inventory
  --    families the repair had to stop reporting as 'other'.
  -- ------------------------------------------------------------------
  select count(*) into v_n from api.source_capture_inventory
   where table_name like 'pmt\_trackerplus\_%' and source_system <> 'paramount';
  if v_n <> 0 then
    raise exception 'G FAILED: % TrackerPlus table(s) are not classified as paramount', v_n;
  end if;
  select count(*) into v_n from api.source_capture_inventory
   where (table_name like 'marvel\_%' or table_name like 'wwe\_%')
     and source_system = 'other';
  if v_n <> 0 then
    raise exception 'G FAILED: % marvel_/wwe_ table(s) remain classified as other', v_n;
  end if;

  -- The browser-safe view stays cheap: no row scan, counts intentionally NULL.
  select count(*) into v_n from api.source_capture_inventory
   where table_name like 'pmt\_trackerplus\_%'
     and (row_count is not null or retained_row_count is not null
          or latest_complete_row_count is not null);
  if v_n <> 0 then
    raise exception 'G FAILED: the browser-safe view is scanning TrackerPlus rows';
  end if;

  -- ------------------------------------------------------------------
  -- H. The RPC exposes four distinct business purposes and manufactures none.
  -- ------------------------------------------------------------------
  v_def := pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure);
  foreach v_text in array array[
    'plm.pmt_trackerplus_submission_property',
    'plm.pmt_property',
    'plm.coke_asset_property_option',
    'plm.wwe_property',
    'Submissions (TrackerPlus)',
    'Creative (Asset Library Property choices)'
  ] loop
    if position(v_text in v_def) = 0 then
      raise exception 'H FAILED: the RPC no longer references %', v_text;
    end if;
  end loop;
  if position('coke_approval_vocabulary_value' in v_def) <> 0
     or position('wwe_asset_property_inferred' in v_def) <> 0
     or position('wwe_character_property_inferred' in v_def) <> 0
     or position('wwe_style_guide_property_inferred' in v_def) <> 0 then
    raise exception
      'H FAILED: a Property vocabulary is being manufactured from inferred or secondary evidence';
  end if;
  -- Each new arm reads exactly one latest complete capture.
  foreach v_text in array array[
    'pmt_trackerplus_latest', 'coke_property_latest', 'wwe_submission_latest'
  ] loop
    if position(v_text in v_def) = 0 then
      raise exception 'H FAILED: the % latest-complete clock is missing', v_text;
    end if;
  end loop;
  -- The licensing-manager gate and the restricted envelope are untouched.
  if position('require_licensing_manager_access' in v_def) = 0 then
    raise exception 'H FAILED: the licensing-manager gate was lost';
  end if;
  if has_function_privilege('anon',
       'api.db_data_admin_scraped_properties(text,text,integer)', 'EXECUTE') then
    raise exception 'H FAILED: anon can execute the DB Data Admin RPC';
  end if;

  raise notice 'pmt_trackerplus_submission_landing_contracts: all checks passed';
end;
$$;

rollback;
