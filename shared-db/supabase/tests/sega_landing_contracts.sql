-- =====================================================================================
-- Sega DSI landing contract tests -- migration 20260819015333, issue #1196, claim #1210.
--
-- HOW TO RUN
--   Against a throwaway or preview database, as the migration owner:
--       \i supabase/tests/sega_landing_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves no row
--   behind. Every negative test runs inside a plpgsql block with an exception handler and
--   asserts that the expected error ACTUALLY FIRED -- a test that merely fails to observe
--   an error proves nothing and is treated here as a defect.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one Sega property, catalog, character, style guide,
--   asset, file name, path, tag, licensor or portal URL appears here. The fixtures use
--   obviously fake tokens (ZZTEST-*, example.invalid) chosen so a real row could never be
--   mistaken for one of them, and so a grep for them finds only test scaffolding.
--
-- WHAT IT ASSERTS
--   A. The 12 tables, 2 functions, RLS and the 24 read policies exist.
--   B. Append-only privilege separation genuinely DENIES update, delete AND truncate,
--      proven by executing them as service_role across the capture root, plm.sega_property
--      and a five-table representative spread -- not merely by reading a grant table.
--   C. plm.begin_sega_capture idempotency, resume, and its refusals.
--   D. Every constraint that protects identity, the candidate/evidence separation, and
--      the direct/inferred separation. Each negative case asserts WHICH named constraint
--      fired, not merely that some constraint did.
--   E. plm.finalize_sega_capture completion preconditions, and that a rejection preserves
--      the previous complete capture -- including (E2N) that NO count check can ever be
--      SKIPPED: a JSON null, string, boolean, object, array, fraction or negative in an
--      expected or a loader-reported count is a NAMED rejection at begin AND again at the
--      publication gate, which re-reads the STORED object rather than trusting begin ran.
--   F. api.source_capture_inventory still classifies and counts every PRE-EXISTING source
--      exactly as it did before this migration, and classifies plm.sega_* as 'sega'.
-- =====================================================================================

begin;

-- =====================================================================================
-- A. OBJECTS, RLS AND POLICIES
-- =====================================================================================
do $$
declare
  v_name text;
  v_n    integer;
  v_fail integer := 0;
  v_tables text[] := array[
    'sega_capture','sega_property','sega_property_licensor','sega_catalog',
    'sega_style_guide_candidate','sega_character_candidate','sega_character_evidence',
    'sega_asset','sega_tag','sega_asset_catalog','sega_asset_tag','sega_asset_property'
  ];
begin
  foreach v_name in array v_tables loop
    if to_regclass('plm.' || v_name) is null then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: table missing: plm.%', v_name;
      continue;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('plm.' || v_name)::regclass) then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: RLS not enabled on plm.%', v_name;
    end if;
    select count(*) into v_n from pg_policies
     where schemaname = 'plm' and tablename = v_name;
    if v_n <> 2 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% has % policies, expected 2 (service read + plm read)',
        v_name, v_n;
    end if;
  end loop;

  foreach v_name in array array['begin_sega_capture','finalize_sega_capture'] loop
    select count(*) into v_n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'plm' and p.proname = v_name;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% missing or overloaded (found %)', v_name, v_n;
    end if;
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'plm' and p.proname = v_name
         and p.prosecdef
         and array_to_string(coalesce(p.proconfig, '{}'::text[]), ',') like '%search_path%'
    ) then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% is not security definer with a pinned search_path', v_name;
    end if;
  end loop;

  -- No media column may ever exist on the asset table.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name = 'sega_asset'
     and (column_name in ('bytes','media','content','blob','base64','file_bytes')
          or data_type = 'bytea');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.sega_asset carries % media-bearing column(s)', v_n;
  end if;

  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
  raise notice 'A passed: 12 tables, 2 functions, RLS and 24 policies present';
end;
$$;


-- =====================================================================================
-- B. PRIVILEGES -- the catalog, and then the behaviour it is supposed to produce.
-- =====================================================================================
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee in ('service_role','authenticated','anon','PUBLIC')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    raise exception 'B FAILED: % write grant(s) exist on plm.sega_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_n <> 12 then
    raise exception 'B FAILED: expected 12 service_role SELECT grants, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_n <> 11 then
    raise exception 'B FAILED: expected 11 service_role INSERT grants, found %', v_n;
  end if;

  if has_table_privilege('service_role','plm.sega_capture','INSERT') then
    raise exception 'B FAILED: plm.sega_capture is directly insertable by service_role';
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'B FAILED: anon holds % grant(s) on plm.sega_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_n <> 12 then
    raise exception 'B FAILED: expected 12 authenticated SELECT grants, found %', v_n;
  end if;

  if has_function_privilege('anon',
       'plm.finalize_sega_capture(uuid,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'plm.finalize_sega_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'B FAILED: finalize_sega_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role',
       'plm.finalize_sega_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'B FAILED: service_role cannot execute finalize_sega_capture';
  end if;

  raise notice 'B (catalog) passed';
end;
$$;

-- The behavioural half of B. A grant table can be read wrongly; an actual UPDATE cannot.
do $$
declare
  v_cap     uuid;
  v_denied  integer := 0;
  v_expected integer := 21;
  v_t       text;
  -- A REPRESENTATIVE SPREAD of the eleven snapshot tables, one per structural class, so
  -- the behavioural half is not proving the model on a single table:
  --   sega_catalog             -- the self-referencing tree
  --   sega_asset               -- the high-volume metadata table
  --   sega_character_evidence  -- the provenance-pinned evidence table
  --   sega_asset_property      -- the source-declared association table
  --   sega_tag                 -- the table guarded by a PARTIAL unique index
  -- plm.sega_property is exercised in full below with real rows, and the CATALOGUE half of
  -- this test already proves the grant state of all twelve tables. Repeating every table
  -- here would add rows to the suite, not evidence.
  v_spread text[] := array[
    'sega_catalog','sega_asset','sega_character_evidence','sega_asset_property','sega_tag'
  ];
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-sega-B:' || repeat('a', 40), 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
    'https://example.invalid', '2099-01-01Z'::timestamptz,
    '{"properties":1}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_cap, 'ZZTEST-P-1', 'ZZTEST property one', 'https://example.invalid',
          'ZZTESThash1', '{}'::jsonb);

  execute 'set local role service_role';

  -- The loader may still INSERT: a revoke that overshot would break the load silently.
  begin
    insert into plm.sega_property (
      capture_id, property_source_id, property_label, source_url, source_hash, raw)
    values (v_cap, 'ZZTEST-P-2', 'ZZTEST property two', 'https://example.invalid',
            'ZZTESThash2', '{}'::jsonb);
  exception when insufficient_privilege then
    execute 'reset role';
    raise exception 'B FAILED: service_role cannot INSERT a snapshot row; the revoke overshot';
  end;

  begin
    update plm.sega_property set property_label = 'ZZTEST mutated' where capture_id = v_cap;
    raise warning 'B FAIL: service_role UPDATE on plm.sega_property SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    delete from plm.sega_property where capture_id = v_cap;
    raise warning 'B FAIL: service_role DELETE on plm.sega_property SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    insert into plm.sega_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, source_captured_at, expected_counts, raw_summary, created_by)
    values ('ZZTEST-sega-B-direct', 'ZZTEST-repo', repeat('b', 40), repeat('b', 64),
            'https://example.invalid', '2099-01-01Z', '{}'::jsonb, '{}'::jsonb, 'ZZTEST');
    raise warning 'B FAIL: service_role INSERT into plm.sega_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    update plm.sega_capture set status = 'complete' where id = v_cap;
    raise warning 'B FAIL: service_role UPDATE on plm.sega_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- TRUNCATE is a distinct privilege from DELETE. An append-only snapshot that revokes
  -- DELETE but leaves TRUNCATE reachable can still be emptied in one statement, so the
  -- behavioural half has to prove TRUNCATE too -- on the capture root as well.
  begin
    truncate table plm.sega_property;
    raise warning 'B FAIL: service_role TRUNCATE on plm.sega_property SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    truncate table plm.sega_capture;
    raise warning 'B FAIL: service_role TRUNCATE on plm.sega_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- UPDATE / DELETE / TRUNCATE denied across the representative spread. The privilege
  -- check happens before any row is touched, so an empty table proves the grant exactly as
  -- a populated one does.
  foreach v_t in array v_spread loop
    begin
      execute format('update plm.%I set capture_id = capture_id', v_t);
      raise warning 'B FAIL: service_role UPDATE on plm.% SUCCEEDED', v_t;
    exception when insufficient_privilege then v_denied := v_denied + 1;
    end;
    begin
      execute format('delete from plm.%I', v_t);
      raise warning 'B FAIL: service_role DELETE on plm.% SUCCEEDED', v_t;
    exception when insufficient_privilege then v_denied := v_denied + 1;
    end;
    begin
      execute format('truncate table plm.%I', v_t);
      raise warning 'B FAIL: service_role TRUNCATE on plm.% SUCCEEDED', v_t;
    exception when insufficient_privilege then v_denied := v_denied + 1;
    end;
  end loop;

  execute 'reset role';

  if current_user <> session_user then
    raise exception 'B FAILED: role was not reset (still %)', current_user;
  end if;
  if v_denied <> v_expected then
    raise exception 'B FAILED: only % of % forbidden writes were denied', v_denied, v_expected;
  end if;

  -- The row the loader inserted is still exactly as it landed.
  if (select property_label from plm.sega_property
       where capture_id = v_cap and property_source_id = 'ZZTEST-P-1')
     <> 'ZZTEST property one' then
    raise exception 'B FAILED: a snapshot row was mutated';
  end if;

  raise notice 'B (behaviour) passed: % forbidden writes denied across the capture root, plm.sega_property and a five-table spread, TRUNCATE included; INSERT still allowed', v_denied;
end;
$$;


-- =====================================================================================
-- C. plm.begin_sega_capture -- idempotency, resume, and its refusals.
-- =====================================================================================
do $$
declare
  v_a      uuid;
  v_b      uuid;
  v_raised integer := 0;
begin
  v_a := plm.begin_sega_capture(
    'ZZTEST-sega-C:' || repeat('c', 40), 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
    'https://example.invalid', '2099-02-01Z'::timestamptz,
    '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  -- Retry with identical arguments must RESUME, never duplicate.
  v_b := plm.begin_sega_capture(
    'ZZTEST-sega-C:' || repeat('c', 40), 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
    'https://example.invalid', '2099-02-01Z'::timestamptz,
    '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
  if v_a <> v_b then
    raise exception 'C FAILED: retry created a second capture (% vs %)', v_a, v_b;
  end if;
  if (select count(*) from plm.sega_capture
       where capture_key = 'ZZTEST-sega-C:' || repeat('c', 40)) <> 1 then
    raise exception 'C FAILED: capture_key is not unique in practice';
  end if;

  -- Same key, different bytes, is a contradiction and must be refused.
  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C:' || repeat('c', 40), 'ZZTEST-repo', repeat('c', 40), repeat('d', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
    raise warning 'C FAIL: a conflicting manifest hash was accepted';
  exception when others then
    if sqlerrm not like '%DIFFERENT source manifest hash%' then
      raise warning 'C FAIL: wrong error for a conflicting manifest: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C:' || repeat('c', 40), 'ZZTEST-repo', repeat('e', 40), repeat('c', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
    raise warning 'C FAIL: a conflicting source commit was accepted';
  exception when others then
    if sqlerrm not like '%DIFFERENT source commit sha%' then
      raise warning 'C FAIL: wrong error for a conflicting commit: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  -- Same key, different scope/completeness flags, is also a contradiction.
  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C:' || repeat('c', 40), 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', true, true, true, true);
    raise warning 'C FAIL: conflicting scope flags were accepted';
  exception when others then
    if sqlerrm not like '%DIFFERENT scope/completeness flags%' then
      raise warning 'C FAIL: wrong error for conflicting flags: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  -- Malformed SHAs.
  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C-badsha', 'ZZTEST-repo', 'NOTASHA', repeat('c', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
    raise warning 'C FAIL: a malformed commit sha was accepted';
  exception when others then
    if sqlerrm not like '%40 lowercase hex%' then
      raise warning 'C FAIL: wrong error for a malformed commit sha: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C-badmanifest', 'ZZTEST-repo', repeat('c', 40), upper(repeat('c', 64)),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
    raise warning 'C FAIL: an uppercase manifest sha was accepted';
  exception when others then
    if sqlerrm not like '%64 lowercase hex%' then
      raise warning 'C FAIL: wrong error for a malformed manifest sha: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  -- Zero-media scope.
  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C-media', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{"properties":0,"media_downloaded":3}'::jsonb, '{}'::jsonb, 'ZZTEST',
      false, true, true, true);
    raise warning 'C FAIL: a capture claiming downloaded media was accepted';
  exception when others then
    if sqlerrm not like '%media_downloaded must be 0%' then
      raise warning 'C FAIL: wrong error for a media-bearing capture: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  -- An empty expected_counts object is not a contract.
  begin
    perform plm.begin_sega_capture(
      'ZZTEST-sega-C-empty', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
      'https://example.invalid', '2099-02-01Z'::timestamptz,
      '{}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);
    raise warning 'C FAIL: an empty expected_counts object was accepted';
  exception when others then
    if sqlerrm not like '%non-empty JSON object%' then
      raise warning 'C FAIL: wrong error for empty expected_counts: %', sqlerrm;
    else v_raised := v_raised + 1; end if;
  end;

  if v_raised <> 7 then
    raise exception 'C FAILED: only % of 7 refusals fired', v_raised;
  end if;
  raise notice 'C passed: idempotent resume plus 7 refusals';
end;
$$;


-- =====================================================================================
-- D. CONSTRAINTS -- identity, the candidate/evidence separation, and direct-vs-inferred.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_raised integer := 0;
  v_con    text;
  v_want   integer := 15;
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-sega-D:' || repeat('1', 40), 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', '2099-03-01Z'::timestamptz,
    '{"properties":1}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_cap, 'ZZTEST-P', 'ZZTEST property', 'https://example.invalid', 'h1', '{}');

  insert into plm.sega_catalog (
    capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
    hierarchy_path, hierarchy_depth, source_hash, raw)
  values (v_cap, 'ZZTEST-C1', null, 'ZZTEST root', '/zztest-root', 1, 'h2', '{}');

  insert into plm.sega_asset (
    capture_id, asset_source_id, file_name, source_hash, raw)
  values (v_cap, 'ZZTEST-A1', 'zztest-file-one.ext', 'h3', '{}');

  insert into plm.sega_character_candidate (
    capture_id, character_candidate_key, candidate_label, normalized_candidate_label,
    inference_method, rule_version, raw)
  values (v_cap, 'ZZTEST-CH1', 'ZZTEST Character', 'zztest character',
          'zztest_method_a', 'v1', '{}');

  -- 1. A blank text identifier is never an identifier.
  begin
    insert into plm.sega_property (
      capture_id, property_source_id, property_label, source_url, source_hash, raw)
    values (v_cap, '   ', 'ZZTEST blank id', 'https://example.invalid', 'h', '{}');
    raise warning 'D FAIL: a blank property_source_id was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_property_source_id_nonblank_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_property_source_id_nonblank_chk'
       and position('sega_property_source_id_nonblank_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_property_source_id_nonblank_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 2. raw must be a JSON object, not an array or a scalar.
  begin
    insert into plm.sega_property (
      capture_id, property_source_id, property_label, source_url, source_hash, raw)
    values (v_cap, 'ZZTEST-P-RAW', 'ZZTEST raw', 'https://example.invalid', 'h', '[]');
    raise warning 'D FAIL: a non-object raw payload was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_property_raw_obj_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_property_raw_obj_chk'
       and position('sega_property_raw_obj_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_property_raw_obj_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 3. Licensor ordinals start at 1.
  begin
    insert into plm.sega_property_licensor (
      capture_id, property_source_id, licensor_ordinal, licensor_label,
      normalized_licensor_label, raw)
    values (v_cap, 'ZZTEST-P', 0, 'ZZTEST Licensor', 'zztest licensor', '{}');
    raise warning 'D FAIL: licensor_ordinal 0 was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_property_licensor_ordinal_pos_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_property_licensor_ordinal_pos_chk'
       and position('sega_property_licensor_ordinal_pos_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_property_licensor_ordinal_pos_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 4. The same normalised licensor may not appear twice under a different ordinal.
  insert into plm.sega_property_licensor (
    capture_id, property_source_id, licensor_ordinal, licensor_label,
    normalized_licensor_label, raw)
  values (v_cap, 'ZZTEST-P', 1, 'ZZTEST Licensor', 'zztest licensor', '{}');
  begin
    insert into plm.sega_property_licensor (
      capture_id, property_source_id, licensor_ordinal, licensor_label,
      normalized_licensor_label, raw)
    values (v_cap, 'ZZTEST-P', 2, 'ZZTEST  Licensor', 'zztest licensor', '{}');
    raise warning 'D FAIL: a duplicate normalised licensor was accepted';
  exception when unique_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_property_licensor_normalized_uk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_property_licensor_normalized_uk'
       and position('sega_property_licensor_normalized_uk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_property_licensor_normalized_uk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 5. A catalog node may not be its own parent.
  begin
    insert into plm.sega_catalog (
      capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
      hierarchy_path, hierarchy_depth, source_hash, raw)
    values (v_cap, 'ZZTEST-C2', 'ZZTEST-C2', 'ZZTEST self', '/zztest-self', 2, 'h', '{}');
    raise warning 'D FAIL: a self-parenting catalog node was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_catalog_no_self_parent_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_catalog_no_self_parent_chk'
       and position('sega_catalog_no_self_parent_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_catalog_no_self_parent_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 6. hierarchy_path is unique within a capture; a repeated LEAF LABEL is not.
  begin
    insert into plm.sega_catalog (
      capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
      hierarchy_path, hierarchy_depth, source_hash, raw)
    values (v_cap, 'ZZTEST-C3', null, 'ZZTEST other', '/zztest-root', 1, 'h', '{}');
    raise warning 'D FAIL: a duplicate hierarchy_path was accepted';
  exception when unique_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_catalog_path_uk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_catalog_path_uk'
       and position('sega_catalog_path_uk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_catalog_path_uk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  insert into plm.sega_catalog (
    capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
    hierarchy_path, hierarchy_depth, source_hash, raw)
  values (v_cap, 'ZZTEST-C4', 'ZZTEST-C1', 'ZZTEST root', '/zztest-root/zztest-root', 2,
          'h', '{}');
  if (select count(*) from plm.sega_catalog
       where capture_id = v_cap and catalog_label = 'ZZTEST root') <> 2 then
    raise exception 'D FAILED: a repeated leaf label was rejected; the label is not identity';
  end if;

  -- 7. A style-guide candidate must carry a reviewed classification.
  begin
    insert into plm.sega_style_guide_candidate (
      capture_id, catalog_source_id, candidate_label, classification_type,
      evidence_value, rule_version, confidence, raw)
    values (v_cap, 'ZZTEST-C1', 'ZZTEST guide', 'zztest_not_a_classification',
            'ZZTEST evidence', 'v1', 0.9, '{}');
    raise warning 'D FAIL: an unknown classification_type was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_style_guide_candidate_classification_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_style_guide_candidate_classification_chk'
       and position('sega_style_guide_candidate_classification_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_style_guide_candidate_classification_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 8. Confidence is a probability.
  begin
    insert into plm.sega_style_guide_candidate (
      capture_id, catalog_source_id, candidate_label, classification_type,
      evidence_value, rule_version, confidence, raw)
    values (v_cap, 'ZZTEST-C1', 'ZZTEST guide', 'style_guide',
            'ZZTEST evidence', 'v1', 1.5, '{}');
    raise warning 'D FAIL: a confidence above 1 was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_style_guide_candidate_confidence_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_style_guide_candidate_confidence_chk'
       and position('sega_style_guide_candidate_confidence_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_style_guide_candidate_confidence_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  insert into plm.sega_style_guide_candidate (
    capture_id, catalog_source_id, candidate_label, classification_type,
    evidence_value, rule_version, confidence, raw)
  values (v_cap, 'ZZTEST-C1', 'ZZTEST guide', 'style_guide',
          'ZZTEST evidence', 'v1', 0.75, '{}');
  if (select evidence_type from plm.sega_style_guide_candidate
       where capture_id = v_cap and catalog_source_id = 'ZZTEST-C1')
     <> 'catalog_name_rule' then
    raise exception 'D FAILED: the derived-evidence default was not applied';
  end if;

  -- 9. A character candidate is keyed by method: the same normalised label reached by the
  --    same method twice is a duplicate.
  begin
    insert into plm.sega_character_candidate (
      capture_id, character_candidate_key, candidate_label, normalized_candidate_label,
      inference_method, rule_version, raw)
    values (v_cap, 'ZZTEST-CH1-DUP', 'ZZTEST Character', 'zztest character',
            'zztest_method_a', 'v1', '{}');
    raise warning 'D FAIL: a duplicate candidate label+method was accepted';
  exception when unique_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_character_candidate_normalized_uk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_character_candidate_normalized_uk'
       and position('sega_character_candidate_normalized_uk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_character_candidate_normalized_uk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- ... but the same label reached by a DIFFERENT method is legitimately a second row.
  insert into plm.sega_character_candidate (
    capture_id, character_candidate_key, candidate_label, normalized_candidate_label,
    inference_method, rule_version, raw)
  values (v_cap, 'ZZTEST-CH2', 'ZZTEST Character', 'zztest character',
          'zztest_method_b', 'v1', '{}');

  -- 10. Character evidence is ALWAYS inferred. There is no value that makes it declared.
  begin
    insert into plm.sega_character_evidence (
      capture_id, character_candidate_key, evidence_key, catalog_source_id,
      evidence_type, evidence_value, confidence, relationship_truth, raw)
    values (v_cap, 'ZZTEST-CH1', 'ZZTEST-E-DECLARED', 'ZZTEST-C1',
            'catalog_path', 'ZZTEST evidence', 0.5, 'declared', '{}');
    raise warning 'D FAIL: character evidence claimed to be source-declared';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_character_evidence_truth_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_character_evidence_truth_chk'
       and position('sega_character_evidence_truth_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_character_evidence_truth_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 11. Exactly one anchor: not both.
  begin
    insert into plm.sega_character_evidence (
      capture_id, character_candidate_key, evidence_key, catalog_source_id,
      asset_source_id, evidence_type, evidence_value, confidence, raw)
    values (v_cap, 'ZZTEST-CH1', 'ZZTEST-E-BOTH', 'ZZTEST-C1', 'ZZTEST-A1',
            'catalog_path', 'ZZTEST evidence', 0.5, '{}');
    raise warning 'D FAIL: character evidence with two anchors was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_character_evidence_exactly_one_anchor_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_character_evidence_exactly_one_anchor_chk'
       and position('sega_character_evidence_exactly_one_anchor_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_character_evidence_exactly_one_anchor_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 12. ... and not neither.
  begin
    insert into plm.sega_character_evidence (
      capture_id, character_candidate_key, evidence_key,
      evidence_type, evidence_value, confidence, raw)
    values (v_cap, 'ZZTEST-CH1', 'ZZTEST-E-NONE',
            'filename', 'ZZTEST evidence', 0.5, '{}');
    raise warning 'D FAIL: character evidence with no anchor was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_character_evidence_exactly_one_anchor_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_character_evidence_exactly_one_anchor_chk'
       and position('sega_character_evidence_exactly_one_anchor_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_character_evidence_exactly_one_anchor_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  insert into plm.sega_character_evidence (
    capture_id, character_candidate_key, evidence_key, catalog_source_id,
    evidence_type, evidence_value, confidence, raw)
  values (v_cap, 'ZZTEST-CH1', 'ZZTEST-E-1', 'ZZTEST-C1',
          'catalog_path', 'ZZTEST evidence', 0.5, '{}');
  if (select relationship_truth from plm.sega_character_evidence
       where capture_id = v_cap and evidence_key = 'ZZTEST-E-1') <> 'inferred' then
    raise exception 'D FAILED: evidence did not default to inferred';
  end if;

  -- 13. A DIRECT asset-to-property association may carry no other evidence type. This is
  --     the constraint that stops a catalog-containment guess being written as fact.
  begin
    insert into plm.sega_asset_property (
      capture_id, asset_source_id, property_source_id, evidence_type, raw)
    values (v_cap, 'ZZTEST-A1', 'ZZTEST-P', 'catalog_containment_inference', '{}');
    raise warning 'D FAIL: an inferred asset-to-property association was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_asset_property_evidence_type_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_asset_property_evidence_type_chk'
       and position('sega_asset_property_evidence_type_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_asset_property_evidence_type_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 14. Tag identity: a fallback tag may not carry a source ID.
  begin
    insert into plm.sega_tag (
      capture_id, tag_source_key, tag_source_id, tag_label, normalized_tag_label,
      identity_method, raw)
    values (v_cap, 'ZZTEST-T-BAD', 'ZZTEST-TAGID', 'ZZTEST Tag', 'zztest tag',
            'normalized_label_fallback', '{}');
    raise warning 'D FAIL: a fallback tag carrying a source ID was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_tag_identity_agreement_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_tag_identity_agreement_chk'
       and position('sega_tag_identity_agreement_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_tag_identity_agreement_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- 15. A style-guide CANDIDATE may not claim source-declared provenance. The Sega portal
  --     exposes no style-guide master record, so the only honest evidence_type is the
  --     derivation rule that produced the row. Without this the candidate status would rest
  --     on the table NAME alone.
  begin
    insert into plm.sega_style_guide_candidate (
      capture_id, catalog_source_id, candidate_label, classification_type,
      evidence_type, evidence_value, rule_version, confidence, raw)
    values (v_cap, 'ZZTEST-C4', 'ZZTEST guide', 'style_guide',
            'source_declared', 'ZZTEST evidence', 'v1', 0.9, '{}');
    raise warning 'D FAIL: a style-guide candidate claimed source-declared provenance';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_style_guide_candidate_evidence_type_chk'
       and position('sega_style_guide_candidate_evidence_type_chk' in sqlerrm) = 0 then
      raise exception
        'D FAILED: expected constraint sega_style_guide_candidate_evidence_type_chk, but % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_raised <> v_want then
    raise exception 'D FAILED: only % of % constraint refusals fired', v_raised, v_want;
  end if;
  raise notice 'D passed: % constraint refusals fired', v_raised;
end;
$$;

-- D2. Tag fallback deduplication, and the case it must NOT reject.
do $$
declare
  v_cap    uuid;
  v_raised integer := 0;
  v_con    text;
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-sega-D2:' || repeat('2', 40), 'ZZTEST-repo', repeat('2', 40), repeat('2', 64),
    'https://example.invalid', '2099-03-02Z'::timestamptz,
    '{"tags":3}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  insert into plm.sega_tag (
    capture_id, tag_source_key, tag_source_id, tag_label, normalized_tag_label,
    identity_method, raw)
  values (v_cap, 'ZZTEST-TK-1', null, 'ZZTEST Tag', 'zztest tag',
          'normalized_label_fallback', '{}');

  begin
    insert into plm.sega_tag (
      capture_id, tag_source_key, tag_source_id, tag_label, normalized_tag_label,
      identity_method, raw)
    values (v_cap, 'ZZTEST-TK-2', null, 'ZZTEST  tag', 'zztest tag',
            'normalized_label_fallback', '{}');
    raise warning 'D2 FAIL: a duplicate fallback tag label was accepted';
  exception when unique_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_tag_fallback_normalized_uk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_tag_fallback_normalized_uk'
       and position('sega_tag_fallback_normalized_uk' in sqlerrm) = 0 then
      raise exception
        'D2 FAILED: expected constraint sega_tag_fallback_normalized_uk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- Two tags that DO carry portal IDs may normalise identically. The partial unique index
  -- exists precisely so this stays legal.
  insert into plm.sega_tag (
    capture_id, tag_source_key, tag_source_id, tag_label, normalized_tag_label,
    identity_method, raw)
  values (v_cap, 'ZZTEST-TK-3', 'ZZTEST-ID-3', 'ZZTEST Tag', 'zztest tag',
          'source_id', '{}'),
         (v_cap, 'ZZTEST-TK-4', 'ZZTEST-ID-4', 'ZZTEST tag', 'zztest tag',
          'source_id', '{}');

  if (select count(*) from plm.sega_tag
       where capture_id = v_cap and normalized_tag_label = 'zztest tag') <> 3 then
    raise exception 'D2 FAILED: source-id tags sharing a normalised label were rejected';
  end if;
  if v_raised <> 1 then
    raise exception 'D2 FAILED: the fallback dedupe did not fire';
  end if;
  raise notice 'D2 passed: fallback tags deduplicate, source-id tags do not';
end;
$$;

-- D3. The deferrable catalog self-FK is DEFERRED, not absent.
do $$
declare
  v_cap    uuid;
  v_raised integer := 0;
begin
  v_cap := plm.begin_sega_capture(
    'ZZTEST-sega-D3:' || repeat('3', 40), 'ZZTEST-repo', repeat('3', 40), repeat('3', 64),
    'https://example.invalid', '2099-03-03Z'::timestamptz,
    '{"catalogs":2}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  -- Child before parent, inside one transaction: legal because the FK is deferred.
  insert into plm.sega_catalog (
    capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
    hierarchy_path, hierarchy_depth, source_hash, raw)
  values (v_cap, 'ZZTEST-D3-CHILD', 'ZZTEST-D3-ROOT', 'ZZTEST child',
          '/zztest-d3/child', 2, 'h', '{}');
  insert into plm.sega_catalog (
    capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
    hierarchy_path, hierarchy_depth, source_hash, raw)
  values (v_cap, 'ZZTEST-D3-ROOT', null, 'ZZTEST root', '/zztest-d3', 1, 'h', '{}');

  -- Deferred is not absent. Forcing the check with a parent that does not exist must fail.
  begin
    insert into plm.sega_catalog (
      capture_id, catalog_source_id, parent_catalog_source_id, catalog_label,
      hierarchy_path, hierarchy_depth, source_hash, raw)
    values (v_cap, 'ZZTEST-D3-ORPHAN', 'ZZTEST-D3-MISSING', 'ZZTEST orphan',
            '/zztest-d3/orphan', 2, 'h', '{}');
    set constraints all immediate;
    raise warning 'D3 FAIL: an unresolved catalog parent survived an immediate check';
  exception when foreign_key_violation then v_raised := v_raised + 1; end;

  set constraints all deferred;
  if v_raised <> 1 then
    raise exception 'D3 FAILED: the deferred self-FK is not enforced at all';
  end if;
  raise notice 'D3 passed: catalog self-FK is deferred but enforced';
end;
$$;


-- =====================================================================================
-- E. plm.finalize_sega_capture -- the publication gate.
-- =====================================================================================
do $$
declare
  v_good uuid;
  v_bad  uuid;
  v_cap  plm.sega_capture%rowtype;
begin
  -- ---- E1. HAPPY PATH.
  v_good := plm.begin_sega_capture(
    'ZZTEST-sega-E1:' || repeat('4', 40), 'ZZTEST-repo', repeat('4', 40), repeat('4', 64),
    'https://example.invalid', '2099-04-01Z'::timestamptz,
    ('{"properties":1,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb,
    '{}'::jsonb, 'ZZTEST', false, true, true, true);

  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_good, 'ZZTEST-E1-P', 'ZZTEST property', 'https://example.invalid', 'h', '{}');

  perform plm.finalize_sega_capture(
    v_good,
    ('{"properties":1,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb,
    '[]'::jsonb);

  select * into v_cap from plm.sega_capture where id = v_good;
  if v_cap.status <> 'complete' then
    raise exception 'E1 FAILED: a valid capture was not completed (status %, errors %)',
      v_cap.status, v_cap.error_summary;
  end if;
  if v_cap.load_completed_at is null then
    raise exception 'E1 FAILED: complete capture has no completion time';
  end if;
  if (v_cap.observed_counts ->> 'properties')::bigint <> 1 then
    raise exception 'E1 FAILED: observed_counts were not derived from the tables';
  end if;

  -- Re-finalizing a complete capture is a no-op, not an error.
  perform plm.finalize_sega_capture(v_good, '{}'::jsonb, '[]'::jsonb);
  if (select status from plm.sega_capture where id = v_good) <> 'complete' then
    raise exception 'E1 FAILED: re-finalizing a complete capture changed it';
  end if;

  raise notice 'E1 passed: a valid capture completes and re-finalize is idempotent';
end;
$$;

-- E2. Every rejection path, each proven separately, and each proven to leave the earlier
-- complete capture untouched and still current.
do $$
declare
  v_id     uuid;
  v_cap    plm.sega_capture%rowtype;
  v_full   jsonb :=
    ('{"properties":0,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
begin
  -- (a) LIMITED capture.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2a:' || repeat('5', 40), 'ZZTEST-repo', repeat('5', 40), repeat('5', 64),
    'https://example.invalid', '2099-05-01Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    true, true, true, true);
  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"capture_is_limited"}]'::jsonb) then
    raise exception 'E2a FAILED: a limited capture was not rejected with a reason (%, %)',
      v_cap.status, v_cap.error_summary;
  end if;
  if v_cap.load_completed_at is not null then
    raise exception 'E2a FAILED: a rejected capture carries a completion time';
  end if;

  -- (b) NON-TERMINAL paging, and incomplete IP associations.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2b:' || repeat('6', 40), 'ZZTEST-repo', repeat('6', 40), repeat('6', 64),
    'https://example.invalid', '2099-05-02Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    false, false, true, false);
  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"ip_paging_not_terminal"}]'::jsonb)
     or not (v_cap.error_summary @> '[{"code":"ip_associations_incomplete"}]'::jsonb) then
    raise exception 'E2b FAILED: non-terminal paging was not rejected: %', v_cap.error_summary;
  end if;

  -- (c) LOADER-REPORTED errors.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2c:' || repeat('7', 40), 'ZZTEST-repo', repeat('7', 40), repeat('7', 64),
    'https://example.invalid', '2099-05-03Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  perform plm.finalize_sega_capture(v_id, v_full, '[{"code":"zztest_loader_error"}]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"loader_reported_errors"}]'::jsonb) then
    raise exception 'E2c FAILED: loader-reported errors did not block publication: %',
      v_cap.error_summary;
  end if;

  -- (d) The source contract expected rows that never landed.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2d:' || repeat('8', 40), 'ZZTEST-repo', repeat('8', 40), repeat('8', 64),
    'https://example.invalid', '2099-05-04Z'::timestamptz,
    jsonb_set(v_full, '{properties}', '9'::jsonb), '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"count_mismatch","entity":"properties"}]'::jsonb) then
    raise exception 'E2d FAILED: an expected-count mismatch was not rejected: %',
      v_cap.error_summary;
  end if;

  -- (e) The LOADER's own claim disagrees with the tables.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2e:' || repeat('9', 40), 'ZZTEST-repo', repeat('9', 40), repeat('9', 64),
    'https://example.invalid', '2099-05-05Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  perform plm.finalize_sega_capture(v_id, jsonb_set(v_full, '{assets}', '5'::jsonb), '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"reported_count_mismatch","entity":"assets"}]'::jsonb) then
    raise exception 'E2e FAILED: a false loader count was accepted: %', v_cap.error_summary;
  end if;

  -- (f) An expected-count key missing from the contract entirely.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2f:' || repeat('a', 39) || 'b', 'ZZTEST-repo',
    repeat('a', 39) || 'b', repeat('a', 63) || 'b',
    'https://example.invalid', '2099-05-06Z'::timestamptz,
    (v_full - 'assets'), '{}'::jsonb, 'ZZTEST', false, true, true, true);
  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary @> '[{"code":"expected_count_missing","entity":"assets"}]'::jsonb) then
    raise exception 'E2f FAILED: a missing expected-count key was tolerated: %',
      v_cap.error_summary;
  end if;

  -- (g) A character candidate that no evidence supports.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2g:' || repeat('c', 39) || 'd', 'ZZTEST-repo',
    repeat('c', 39) || 'd', repeat('c', 63) || 'd',
    'https://example.invalid', '2099-05-07Z'::timestamptz,
    jsonb_set(v_full, '{character_candidates}', '1'::jsonb), '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  insert into plm.sega_character_candidate (
    capture_id, character_candidate_key, candidate_label, normalized_candidate_label,
    inference_method, rule_version, raw)
  values (v_id, 'ZZTEST-E2G-CH', 'ZZTEST Character', 'zztest character',
          'zztest_method', 'v1', '{}');
  perform plm.finalize_sega_capture(
    v_id, jsonb_set(v_full, '{character_candidates}', '1'::jsonb), '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary
             @> '[{"code":"character_candidate_without_evidence"}]'::jsonb) then
    raise exception 'E2g FAILED: an unsupported character candidate published: %',
      v_cap.error_summary;
  end if;

  -- Finalizing an already-rejected capture must refuse, not quietly retry.
  begin
    perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
    raise exception 'E2 FAILED: a rejected capture was re-finalized';
  exception when others then
    if sqlerrm not like '%is rejected, not loading%' then raise; end if;
  end;

  -- The earlier complete capture from E1 is untouched and is still the latest complete.
  if (select status from plm.sega_capture
       where capture_key = 'ZZTEST-sega-E1:' || repeat('4', 40)) <> 'complete' then
    raise exception 'E2 FAILED: a rejection disturbed the previous complete capture';
  end if;

  raise notice 'E2 passed: 7 rejection paths, each preserving the prior complete capture';
end;
$$;

-- E2N. THE PUBLICATION GATE MAY NEVER SKIP A COUNT CHECK.
--
-- A key present with JSON `null` is NOT a missing key. `expected_counts ? 'assets'` is TRUE
-- for {"assets": null}, so a `?`-only test calls the count supplied, while every comparison
-- against the resulting SQL NULL is UNKNOWN and therefore never false. The check would be
-- SKIPPED -- and a skipped count check is exactly how a failed or first-page-only asset
-- crawl becomes the current complete capture and is then reported as latest-complete by
-- api.source_capture_inventory. jsonb_build_object('assets', v_unset) produces that shape
-- with no error at all, so this is an ordinary loader bug, not an exotic one.
--
-- (i) begin_sega_capture refuses every non-number shape, each with a NAMED message.
do $$
declare
  v_raised integer := 0;
  v_shape  jsonb;
  v_shapes jsonb[] := array[
    'null'::jsonb,          -- the loader's unset-variable shape
    '"7"'::jsonb,           -- a string, which would also break a naive cast
    'true'::jsonb,          -- a boolean
    '{}'::jsonb,            -- an object
    '[]'::jsonb,            -- an array
    '1.5'::jsonb,           -- a number, but not a whole row count
    '-1'::jsonb             -- a number, but not a possible row count
  ];
  i integer;
begin
  for i in 1 .. array_length(v_shapes, 1) loop
    v_shape := v_shapes[i];
    begin
      perform plm.begin_sega_capture(
        'ZZTEST-sega-E2N' || i || ':' || repeat('1', 40), 'ZZTEST-repo',
        repeat('1', 40), repeat('1', 64), 'https://example.invalid',
        '2099-09-01Z'::timestamptz,
        jsonb_build_object('properties', 0) || jsonb_build_object('assets', v_shape),
        '{}'::jsonb, 'ZZTEST', false, true, true, true);
      raise warning 'E2N FAIL: begin accepted an expected_counts value of %', v_shape;
    exception when others then
      -- A NAMED refusal, not any error. A raw cast failure ("invalid input syntax for type
      -- numeric") would mean the type test did not run first, which is the trap a single
      -- `or`-ed predicate falls into: SQL does not promise to short-circuit `or`.
      if sqlerrm not like
         '%every expected_counts value must be a JSON number that is a non-negative integer%'
      then
        raise exception
          'E2N FAILED: expected_counts value % was refused, but not by name: %',
          v_shape, sqlerrm;
      end if;
      -- The five non-numeric shapes must be refused by the TYPE guard, whose message names
      -- the skipped-check consequence; the two numeric-but-wrong shapes by the range guard.
      if jsonb_typeof(v_shape) <> 'number'
         and sqlerrm not like '%would SKIP that count check%' then
        raise exception
          'E2N FAILED: the non-number shape % was refused by the range guard, not the type guard: %',
          v_shape, sqlerrm;
      end if;
      if jsonb_typeof(v_shape) = 'number'
         and sqlerrm like '%would SKIP that count check%' then
        raise exception
          'E2N FAILED: the numeric shape % was refused by the type guard, not the range guard: %',
          v_shape, sqlerrm;
      end if;
      v_raised := v_raised + 1;
    end;
  end loop;

  if v_raised <> array_length(v_shapes, 1) then
    raise exception 'E2N FAILED: only % of % bad expected_counts shapes were refused',
      v_raised, array_length(v_shapes, 1);
  end if;
  raise notice 'E2N (i) passed: % bad expected_counts shapes refused by name at begin',
    v_raised;
end;
$$;

-- (ii) finalize re-checks the STORED object rather than trusting that begin ran. An
--      owner-level UPDATE reaches plm.sega_capture.expected_counts without going through
--      begin_sega_capture at all, so the guard has to exist at BOTH ends. This is the exact
--      scenario the reviewer demonstrated: one property lands, ZERO assets land, every
--      publishable flag is set, the loader honestly reports "assets": 0, and the gate must
--      still refuse to publish.
do $$
declare
  v_id    uuid;
  v_cap   plm.sega_capture%rowtype;
  v_full  jsonb :=
    ('{"properties":1,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
  v_shape jsonb;
  v_code  text;
  v_shapes jsonb[]  := array['null'::jsonb, '"7"'::jsonb, '[]'::jsonb, '-1'::jsonb];
  v_codes  text[]   := array['expected_count_not_a_number','expected_count_not_a_number',
                             'expected_count_not_a_number',
                             'expected_count_not_a_nonnegative_integer'];
  i integer;
begin
  for i in 1 .. array_length(v_shapes, 1) loop
    v_shape := v_shapes[i];
    v_code  := v_codes[i];

    v_id := plm.begin_sega_capture(
      'ZZTEST-sega-E2Nii' || i || ':' || repeat('2', 40), 'ZZTEST-repo',
      repeat('2', 40), repeat('2', 64), 'https://example.invalid',
      '2099-09-02Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);

    insert into plm.sega_property (
      capture_id, property_source_id, property_label, source_url, source_hash, raw)
    values (v_id, 'ZZTEST-P-1', 'ZZTEST property one', 'https://example.invalid',
            'ZZTESThash1', '{}'::jsonb);

    -- Bypass the begin guard exactly as a privileged writer could.
    update plm.sega_capture
       set expected_counts = jsonb_set(expected_counts, '{assets}', v_shape)
     where id = v_id;

    -- The loader reports the truth: zero assets landed. Every flag is publishable. Only
    -- the stored expectation is unusable, and that alone must block publication.
    perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);

    select * into v_cap from plm.sega_capture where id = v_id;
    if v_cap.status <> 'rejected' then
      raise exception
        'E2Nii FAILED: a stored expected_counts.assets of % PUBLISHED as %; the count check was skipped',
        v_shape, v_cap.status;
    end if;
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object('code', v_code, 'entity', 'assets'))) then
      raise exception 'E2Nii FAILED: shape % was rejected, but not as %: %',
        v_shape, v_code, v_cap.error_summary;
    end if;
    if v_cap.load_completed_at is not null then
      raise exception 'E2Nii FAILED: a rejected capture carries a completion time';
    end if;
  end loop;

  raise notice
    'E2N (ii) passed: % unusable STORED expected counts each blocked publication by name',
    array_length(v_shapes, 1);
end;
$$;

-- (iii) The loader-REPORTED counts carry the identical trap and get the identical guard.
do $$
declare
  v_id    uuid;
  v_cap   plm.sega_capture%rowtype;
  v_full  jsonb :=
    ('{"properties":0,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
  v_shape jsonb;
  v_code  text;
  v_shapes jsonb[] := array['null'::jsonb, '"0"'::jsonb, 'true'::jsonb, '{}'::jsonb,
                            '0.5'::jsonb, '-1'::jsonb];
  v_codes  text[]  := array['reported_count_not_a_number','reported_count_not_a_number',
                            'reported_count_not_a_number','reported_count_not_a_number',
                            'reported_count_not_a_nonnegative_integer',
                            'reported_count_not_a_nonnegative_integer'];
  i integer;
begin
  for i in 1 .. array_length(v_shapes, 1) loop
    v_shape := v_shapes[i];
    v_code  := v_codes[i];

    v_id := plm.begin_sega_capture(
      'ZZTEST-sega-E2Niii' || i || ':' || repeat('3', 40), 'ZZTEST-repo',
      repeat('3', 40), repeat('3', 64), 'https://example.invalid',
      '2099-09-03Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);

    -- Everything else about this capture is publishable. Only the loader's claim about
    -- one entity is unusable -- and an unusable claim is not a passed check.
    perform plm.finalize_sega_capture(
      v_id, jsonb_set(v_full, '{assets}', v_shape), '[]'::jsonb);

    select * into v_cap from plm.sega_capture where id = v_id;
    if v_cap.status <> 'rejected' then
      raise exception
        'E2Niii FAILED: a reported assets count of % PUBLISHED as %; the check was skipped',
        v_shape, v_cap.status;
    end if;
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object('code', v_code, 'entity', 'assets'))) then
      raise exception 'E2Niii FAILED: reported shape % was rejected, but not as %: %',
        v_shape, v_code, v_cap.error_summary;
    end if;
  end loop;

  raise notice
    'E2N (iii) passed: % unusable loader-reported counts each blocked publication by name',
    array_length(v_shapes, 1);
end;
$$;

-- (iv) The whole-object sweep: a non-number under a key OUTSIDE the eleven entity names is
--      the same defect and must also be named, not ignored.
do $$
declare
  v_id   uuid;
  v_cap  plm.sega_capture%rowtype;
  v_full jsonb :=
    ('{"properties":0,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
begin
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2Niv:' || repeat('4', 40), 'ZZTEST-repo',
    repeat('4', 40), repeat('4', 64), 'https://example.invalid',
    '2099-09-04Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);

  update plm.sega_capture
     set expected_counts = expected_counts || '{"zztest_future_entity": null}'::jsonb
   where id = v_id;

  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);

  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'rejected'
     or not (v_cap.error_summary
             @> '[{"code":"expected_count_not_a_number","entity":"zztest_future_entity"}]'::jsonb)
  then
    raise exception
      'E2Niv FAILED: a non-number under an unrecognised expected_counts key was tolerated (% / %)',
      v_cap.status, v_cap.error_summary;
  end if;

  raise notice 'E2N (iv) passed: the sweep covers keys beyond the eleven entity names';
end;
$$;


-- (v) A WHOLE NUMBER THAT IS NOT A BIGINT LITERAL MUST BE REFUSED BY NAME -- IT MUST NOT
--     WEDGE THE CAPTURE. (issue #1222, the same defect as #1221 on the WildBrain gate.)
--
--     (ii) and (iii) above cover values the guards reject as the wrong TYPE or outside the
--     non-negative-integer RANGE. These are the values that pass BOTH and then die on the
--     cast, which is the opposite failure direction and operationally worse:
--
--       {"assets": 1.0}  -- a JSON number, and 1.0 = trunc(1.0), so both guards are
--                           satisfied. `->>` renders it as the TEXT '1.0', and
--                           '1.0'::bigint raises `invalid input syntax for type bigint`.
--       {"assets": 9223372036854775808} / 1e20 -- whole and non-negative, stored happily by
--                           begin_sega_capture, then `bigint out of range` at the cast.
--
--     A raise inside finalize aborts BEFORE the rejection row is written: error_summary is
--     never persisted, status never leaves 'loading', and a retry with the same stored JSON
--     dies identically. The capture is WEDGED and the operator sees a bare PostgreSQL cast
--     error instead of the named refusal this design promises. `1.0` is not exotic -- any
--     loader arithmetic that yields a numeric rather than an integer emits it.
--
--     There is NO exception handler in this block on purpose. On the pre-fix function the
--     first iteration raises and this test goes red at the raise, which is precisely the
--     behaviour under test. It asserts three things per shape: finalize did not raise, the
--     capture reached a TERMINAL status rather than staying in 'loading', and the refusal
--     is NAMED.
do $$
declare
  v_id     uuid;
  v_cap    plm.sega_capture%rowtype;
  v_full   jsonb :=
    ('{"properties":0,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
  v_shape  jsonb;
  v_code   text;
  v_shapes jsonb[] := array['1.0'::jsonb, '9223372036854775808'::jsonb, '1e20'::jsonb];
  -- 1.0 is a genuine, satisfiable claim of one asset, and zero assets landed, so its honest
  -- verdict is a mismatch. The two oversized values cannot be a row count at all. The two
  -- sides of the gate name their codes differently, so both lists are written out rather
  -- than derived from one another -- a derivation would silently accept a renamed code.
  v_codes  text[]  := array['count_mismatch',
                            'expected_count_out_of_range','expected_count_out_of_range'];
  v_rcodes text[]  := array['reported_count_mismatch',
                            'reported_count_out_of_range','reported_count_out_of_range'];
  i integer;
begin
  for i in 1 .. array_length(v_shapes, 1) loop
    v_shape := v_shapes[i];
    v_code  := v_codes[i];

    -- Through the FRONT DOOR. begin_sega_capture's guard is a numeric truncation test, so
    -- it accepts every one of these -- which is exactly why the gate has to survive them.
    v_id := plm.begin_sega_capture(
      'ZZTEST-sega-E2Nv' || i || ':' || repeat('5', 40), 'ZZTEST-repo',
      repeat('5', 40), repeat('5', 64), 'https://example.invalid',
      '2099-09-05Z'::timestamptz, jsonb_set(v_full, '{assets}', v_shape),
      '{}'::jsonb, 'ZZTEST', false, true, true, true);

    perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);

    select * into v_cap from plm.sega_capture where id = v_id;
    if v_cap.status = 'loading' then
      raise exception
        'E2Nv FAILED: an expected assets count of % left the capture WEDGED in loading',
        v_shape;
    end if;
    if v_cap.status <> 'rejected' then
      raise exception 'E2Nv FAILED: an expected assets count of % reached status %',
        v_shape, v_cap.status;
    end if;
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object('code', v_code, 'entity', 'assets'))) then
      raise exception 'E2Nv FAILED: expected shape % was rejected, but not as %: %',
        v_shape, v_code, v_cap.error_summary;
    end if;

    -- And the identical values on the loader-REPORTED side, which has its own cast.
    v_id := plm.begin_sega_capture(
      'ZZTEST-sega-E2Nvr' || i || ':' || repeat('6', 40), 'ZZTEST-repo',
      repeat('6', 40), repeat('6', 64), 'https://example.invalid',
      '2099-09-06Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);

    perform plm.finalize_sega_capture(
      v_id, jsonb_set(v_full, '{assets}', v_shape), '[]'::jsonb);

    select * into v_cap from plm.sega_capture where id = v_id;
    if v_cap.status = 'loading' then
      raise exception
        'E2Nv FAILED: a reported assets count of % left the capture WEDGED in loading',
        v_shape;
    end if;
    if v_cap.status <> 'rejected' then
      raise exception 'E2Nv FAILED: a reported assets count of % reached status %',
        v_shape, v_cap.status;
    end if;
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object(
                 'code', v_rcodes[i], 'entity', 'assets'))) then
      raise exception 'E2Nv FAILED: reported shape % was rejected, but not as %: %',
        v_shape, v_rcodes[i], v_cap.error_summary;
    end if;
  end loop;

  -- The ordinary path must still publish. Without this, a fix that broke every integer
  -- expectation would satisfy every assertion above while nothing could ever complete.
  -- DELIBERATELY THE OLDEST source_captured_at IN THIS FILE. This is the only capture the
  -- E2N sections COMPLETE, and api.source_capture_inventory reports the latest complete
  -- capture ordered by source_captured_at -- so a 2099-09 date here would quietly become
  -- "current" and section F2, which asserts its own newest complete capture, would fail on
  -- a fixture collision that has nothing to do with what it tests.
  v_id := plm.begin_sega_capture(
    'ZZTEST-sega-E2Nv-ok:' || repeat('7', 40), 'ZZTEST-repo',
    repeat('7', 40), repeat('7', 64), 'https://example.invalid',
    '2099-01-05Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);
  perform plm.finalize_sega_capture(v_id, v_full, '[]'::jsonb);
  select * into v_cap from plm.sega_capture where id = v_id;
  if v_cap.status <> 'complete' then
    raise exception
      'E2Nv FAILED: an ordinary integer expectation no longer publishes (status %, %)',
      v_cap.status, v_cap.error_summary;
  end if;

  raise notice
    'E2N (v) passed: float and oversized counts refuse by name on both sides; no capture is wedged';
end;
$$;

-- (vi) THE EXTRA-KEY SWEEP IS NOT TYPE-ONLY. A key outside the eleven entity names whose
--      value is -1, 1.5 or past bigint is a JSON NUMBER, so the old type-only sweep ignored
--      it. Neither shape can skip an entity count, so this was never a publication hole --
--      but the sweep's stated claim is that EVERY key outside the eleven is covered, and a
--      guard whose comment overstates what it does is how the next reader is misled. The
--      sweep now applies the identical type / non-negative-integer / range rule.
do $$
declare
  v_id     uuid;
  v_cap    plm.sega_capture%rowtype;
  v_full   jsonb :=
    ('{"properties":0,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
  v_shape  jsonb;
  v_code   text;
  v_shapes jsonb[] := array['-1'::jsonb, '1.5'::jsonb, '9223372036854775808'::jsonb];
  v_codes  text[]  := array['expected_count_not_a_nonnegative_integer',
                            'expected_count_not_a_nonnegative_integer',
                            'expected_count_out_of_range'];
  v_rcodes text[]  := array['reported_count_not_a_nonnegative_integer',
                            'reported_count_not_a_nonnegative_integer',
                            'reported_count_out_of_range'];
  i integer;
begin
  for i in 1 .. array_length(v_shapes, 1) loop
    v_shape := v_shapes[i];
    v_code  := v_codes[i];

    v_id := plm.begin_sega_capture(
      'ZZTEST-sega-E2Nvi' || i || ':' || repeat('8', 40), 'ZZTEST-repo',
      repeat('8', 40), repeat('8', 64), 'https://example.invalid',
      '2099-09-08Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST', false, true, true, true);

    -- begin_ only inspects the eleven entity keys, so the extra key is injected the way a
    -- future loader would supply it: by writing the stored object.
    update plm.sega_capture
       set expected_counts = expected_counts
                             || jsonb_build_object('zztest_future_entity', v_shape)
     where id = v_id;

    perform plm.finalize_sega_capture(
      v_id, v_full || jsonb_build_object('zztest_future_entity', v_shape), '[]'::jsonb);

    select * into v_cap from plm.sega_capture where id = v_id;
    if v_cap.status <> 'rejected' then
      raise exception
        'E2Nvi FAILED: an extra expected_counts key of % was tolerated (status %)',
        v_shape, v_cap.status;
    end if;
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object(
                 'code', v_code, 'entity', 'zztest_future_entity'))) then
      raise exception 'E2Nvi FAILED: extra expected key % was rejected, but not as %: %',
        v_shape, v_code, v_cap.error_summary;
    end if;
    -- The loader-reported side carries its own copy of the sweep and its own codes.
    if not (v_cap.error_summary
            @> jsonb_build_array(jsonb_build_object(
                 'code', v_rcodes[i], 'entity', 'zztest_future_entity'))) then
      raise exception 'E2Nvi FAILED: extra reported key % was rejected, but not as %: %',
        v_shape, v_rcodes[i], v_cap.error_summary;
    end if;
  end loop;

  raise notice
    'E2N (vi) passed: the extra-key sweep enforces the integer and range rule, not type alone';
end;
$$;

-- E3. The table itself refuses a hand-built 'complete' capture that breaks the rule, so
-- the guarantee does not depend on the function being the only writer.
do $$
declare
  v_raised integer := 0;
  v_con    text;
begin
  begin
    insert into plm.sega_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by,
      is_limited, ip_paging_terminal, asset_paging_terminal, ip_associations_complete)
    values ('ZZTEST-sega-E3-limited', 'ZZTEST-repo', repeat('e', 40), repeat('e', 64),
            'https://example.invalid', '2099-06-01Z', '2099-06-02Z', 'complete',
            '{}'::jsonb, '{}'::jsonb, 'ZZTEST', true, true, true, true);
    raise warning 'E3 FAIL: a limited capture was stored as complete';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_capture_complete_requirements_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_capture_complete_requirements_chk'
       and position('sega_capture_complete_requirements_chk' in sqlerrm) = 0 then
      raise exception
        'E3 FAILED: expected constraint sega_capture_complete_requirements_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  begin
    insert into plm.sega_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by, error_summary,
      is_limited, ip_paging_terminal, asset_paging_terminal, ip_associations_complete)
    values ('ZZTEST-sega-E3-errors', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
            'https://example.invalid', '2099-06-01Z', '2099-06-02Z', 'complete',
            '{}'::jsonb, '{}'::jsonb, 'ZZTEST', '[{"code":"zztest"}]'::jsonb,
            false, true, true, true);
    raise warning 'E3 FAIL: a capture carrying errors was stored as complete';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_capture_complete_requirements_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_capture_complete_requirements_chk'
       and position('sega_capture_complete_requirements_chk' in sqlerrm) = 0 then
      raise exception
        'E3 FAILED: expected constraint sega_capture_complete_requirements_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  begin
    insert into plm.sega_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, source_captured_at, status,
      expected_counts, raw_summary, created_by, media_downloaded)
    values ('ZZTEST-sega-E3-media', 'ZZTEST-repo', repeat('0', 40), repeat('0', 64),
            'https://example.invalid', '2099-06-01Z', 'loading',
            '{}'::jsonb, '{}'::jsonb, 'ZZTEST', 1);
    raise warning 'E3 FAIL: a media-bearing capture was accepted';
  exception when check_violation then
    -- Pin WHICH constraint fired. A bare exception class only proves that SOMETHING
    -- refused the row; it would stay green if a different constraint started catching
    -- this input and sega_capture_media_zero_chk were dropped.
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sega_capture_media_zero_chk'
       and position('sega_capture_media_zero_chk' in sqlerrm) = 0 then
      raise exception
        'E3 FAILED: expected constraint sega_capture_media_zero_chk, but % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_raised <> 3 then
    raise exception 'E3 FAILED: only % of 3 table-level refusals fired', v_raised;
  end if;
  raise notice 'E3 passed: the completion rule is enforced by the table, not only the function';
end;
$$;


-- =====================================================================================
-- F. api.source_capture_inventory -- extended, and PROVABLY not disturbed.
-- =====================================================================================
do $$
declare
  v_cols text[];
begin
  select array_agg(column_name order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'api' and table_name = 'source_capture_inventory';
  if v_cols is distinct from array[
    'source_system','table_name','row_count','carries_resolution','table_comment',
    'retained_row_count','latest_complete_row_count','count_basis',
    'latest_complete_status','count_note'
  ] then
    raise exception 'F FAILED: the view column list changed: %', v_cols;
  end if;

  if has_table_privilege('anon', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('authenticated', 'api.source_capture_inventory', 'SELECT')
     or not has_table_privilege('service_role', 'api.source_capture_inventory', 'SELECT') then
    raise exception 'F FAILED: the view read grants changed';
  end if;
  raise notice 'F (shape) passed';
end;
$$;

-- F1. EVERY pre-existing source keeps its exact classification. The comparison is against
-- the classifier as it stood BEFORE this migration, written out here, so this cannot pass
-- by agreeing with itself.
do $$
declare
  r record;
  v_prior text;
  v_fail  integer := 0;
  v_seen  integer := 0;
begin
  for r in
    select c.relname, v.source_system
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join api.source_capture_inventory v on v.table_name = c.relname
     where n.nspname = 'plm' and c.relkind = 'r'
  loop
    if r.source_system is null then
      v_fail := v_fail + 1;
      raise warning 'F1 FAIL: plm.% disappeared from the inventory', r.relname;
      continue;
    end if;
    if r.relname like 'sega\_%' then
      if r.source_system <> 'sega' then
        v_fail := v_fail + 1;
        raise warning 'F1 FAIL: plm.% classified as %, expected sega', r.relname, r.source_system;
      end if;
      continue;
    end if;
    v_seen := v_seen + 1;
    v_prior := case
      when r.relname like 'dcp\_%' or r.relname like 'opa\_%' then 'disney'
      when r.relname like 'pmt\_%' then 'paramount'
      when r.relname like 'nbcu\_%' then 'nbcu'
      when r.relname like 'wb\_%' then 'warner'
      when r.relname like 'erp\_%' then 'coldlion'
      else 'other'
    end;
    if r.source_system <> v_prior then
      v_fail := v_fail + 1;
      raise warning 'F1 FAIL: plm.% is now % but was %', r.relname, r.source_system, v_prior;
    end if;
  end loop;

  if v_seen = 0 then
    raise exception 'F1 FAILED: no pre-existing plm table was compared; the test is vacuous';
  end if;
  if (select count(*) from api.source_capture_inventory where source_system = 'sega') <> 12 then
    raise exception 'F1 FAILED: the inventory reports % sega tables, expected 12',
      (select count(*) from api.source_capture_inventory where source_system = 'sega');
  end if;
  if v_fail > 0 then
    raise exception 'F1 FAILED (% classification changes)', v_fail;
  end if;
  raise notice 'F1 passed: % pre-existing tables unchanged, 12 sega tables classified', v_seen;
end;
$$;

-- F2. The Sega latest-complete contract behaves exactly like the NBCU one: only the newest
-- COMPLETE capture counts, and rejected rows stay retained-only.
do $$
declare
  v_old  uuid;
  v_new  uuid;
  v_rej  uuid;
  r      record;
  v_full jsonb :=
    ('{"properties":1,"property_licensors":0,"catalogs":0,"style_guide_candidates":0,'
     || '"character_candidates":0,"character_evidence":0,"assets":0,"tags":0,'
     || '"asset_catalogs":0,"asset_tags":0,"asset_properties":0}')::jsonb;
begin
  v_old := plm.begin_sega_capture(
    'ZZTEST-sega-F-old:' || repeat('1', 40), 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', '2099-07-01Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_old, 'ZZTEST-F-OLD', 'ZZTEST old', 'https://example.invalid', 'h', '{}');
  perform plm.finalize_sega_capture(v_old, v_full, '[]'::jsonb);

  v_new := plm.begin_sega_capture(
    'ZZTEST-sega-F-new:' || repeat('2', 40), 'ZZTEST-repo', repeat('2', 40), repeat('2', 64),
    'https://example.invalid', '2099-08-01Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    false, true, true, true);
  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_new, 'ZZTEST-F-NEW', 'ZZTEST new', 'https://example.invalid', 'h', '{}');
  perform plm.finalize_sega_capture(v_new, v_full, '[]'::jsonb);

  -- A NEWER capture that failed validation must not become current.
  v_rej := plm.begin_sega_capture(
    'ZZTEST-sega-F-rej:' || repeat('3', 40), 'ZZTEST-repo', repeat('3', 40), repeat('3', 64),
    'https://example.invalid', '2099-09-01Z'::timestamptz, v_full, '{}'::jsonb, 'ZZTEST',
    true, true, true, true);
  insert into plm.sega_property (
    capture_id, property_source_id, property_label, source_url, source_hash, raw)
  values (v_rej, 'ZZTEST-F-REJ-1', 'ZZTEST rejected a', 'https://example.invalid', 'h', '{}'),
         (v_rej, 'ZZTEST-F-REJ-2', 'ZZTEST rejected b', 'https://example.invalid', 'h', '{}');
  perform plm.finalize_sega_capture(v_rej, v_full, '[]'::jsonb);
  if (select status from plm.sega_capture where id = v_rej) <> 'rejected' then
    raise exception 'F2 FAILED: the fixture rejection did not happen';
  end if;

  select * into r from api.source_capture_inventory where table_name = 'sega_property';
  if r.count_basis <> 'latest_complete' then
    raise exception 'F2 FAILED: sega_property count_basis is %', r.count_basis;
  end if;
  if r.latest_complete_status <> 'complete' then
    raise exception 'F2 FAILED: sega_property latest_complete_status is %',
      r.latest_complete_status;
  end if;
  if r.latest_complete_row_count <> 1 then
    raise exception 'F2 FAILED: latest-complete count is %, expected 1 (the newest complete capture only)',
      r.latest_complete_row_count;
  end if;
  if r.retained_row_count < 4 then
    raise exception 'F2 FAILED: retained count is %, expected at least 4', r.retained_row_count;
  end if;
  if r.row_count is distinct from r.retained_row_count then
    raise exception 'F2 FAILED: the row_count compatibility alias broke';
  end if;
  if r.count_note not like 'Latest complete Sega capture%' then
    raise exception 'F2 FAILED: the sega count note is wrong: %', r.count_note;
  end if;

  select * into r from api.source_capture_inventory where table_name = 'sega_capture';
  if r.latest_complete_row_count <> 1 or r.count_basis <> 'latest_complete' then
    raise exception 'F2 FAILED: sega_capture reports % / %',
      r.latest_complete_row_count, r.count_basis;
  end if;

  -- A sega table that this fixture never wrote still reports zero for the current capture,
  -- not NULL: NULL means "cannot be derived", and for a capture-scoped table it can be.
  select * into r from api.source_capture_inventory where table_name = 'sega_asset_tag';
  if r.latest_complete_row_count is distinct from 0::bigint then
    raise exception 'F2 FAILED: sega_asset_tag latest-complete count is %, expected 0',
      r.latest_complete_row_count;
  end if;

  raise notice 'F2 passed: only the newest complete Sega capture counts';
end;
$$;

rollback;
