-- =====================================================================================
-- Peanuts (Tenovos) landing contract tests -- migration 20260819125713, issue #1217,
-- claim #1231.
--
-- HOW TO RUN
--   Against a throwaway or preview database, as the migration owner:
--       \i supabase/tests/peanuts_landing_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves no row
--   behind. Every negative test runs inside a plpgsql block with a SPECIFIC exception
--   handler and asserts that the expected error ACTUALLY FIRED, naming WHICH constraint
--   fired. A test that merely fails to observe an error proves nothing, and a test that
--   would stay green with its constraint deleted is itself a defect.
--
--   There is deliberately NO `exception when others` anywhere in this file. A broad
--   handler passes on a typo in the test itself, which is the failure mode these
--   contracts exist to prevent.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one Peanuts art program, style guide, character,
--   initiative, holiday, animation title, asset type, file name, title, keyword, era or
--   portal URL appears here. The fixtures use obviously fake tokens (ZZTEST-*,
--   example.invalid) chosen so a real row could never be mistaken for one of them.
--
-- WHY SECTIONS B-E INSERT THE CAPTURE ROW DIRECTLY
--   service_role holds SELECT only on plm.peanuts_capture; the write path is the
--   begin/finalize pair. These tests run as the table OWNER, which can still insert, so
--   sections B-E can exercise a TABLE constraint in isolation without routing through a
--   function that would refuse the row earlier for a different reason -- which would
--   prove the function, not the constraint. Section B proves service_role itself cannot
--   insert here, and section F exercises the functions on their own terms.
--
-- WHAT IT ASSERTS
--   A. The 19 tables exist, RLS is enabled on every one, and each carries exactly 2 read
--      policies. No media column. No art-program-to-character table, in any form.
--   B. Append-only privilege separation genuinely DENIES update, delete AND truncate --
--      proven by executing them as service_role, not merely by reading a grant table --
--      while INSERT on the 18 snapshot tables still works and INSERT on the capture root
--      does not.
--   C. The capture publication gate: every clause of the completion rule is falsified
--      one at a time, so no clause can be deleted without a test going red, plus the
--      zero-media scope guard and the completion rule's own arithmetic.
--   D. Identity, shape and vocabulary contracts, each pinned to a NAMED constraint.
--   E. The declared/derived separation: relationship_truth cannot be anything but
--      'derived', the derived tables cannot carry a zero support count, and the asset
--      relationship graph refuses a self-edge.
--   F. plm.begin_peanuts_capture and plm.finalize_peanuts_capture: security posture,
--      idempotency, and every unusable count shape refused BY NAME at begin AND again at
--      the publication gate, which re-reads the STORED object. Includes the three live
--      sibling defects: a JSON null (a SKIPPED check), a numeric-looking STRING whose
--      value MATCHES the true row count (a silent WRONG ANSWER), and a fraction or an
--      oversized value (a raw cast error that wedges the capture).
--   G. api.source_capture_inventory classifies plm.peanuts_*, and EVERY pre-existing
--      source, the row-per-table count and the ten output columns are unchanged.
--   H. The wedge class, and the guards that previously had no failing test: hostile
--      finalize_ arguments are RECORDED rather than raised, the asset arithmetic reports
--      instead of overflowing an integer, a count written 1.0 still publishes, the
--      extra-key sweep applies sign/integrality/range and not only type, and
--      begin_peanuts_capture's EXECUTE lockdown is asserted.
-- =====================================================================================

begin;

-- =====================================================================================
-- A. OBJECTS, RLS, POLICIES, AND THE TWO REFUSALS
-- =====================================================================================
do $$
declare
  v_name text;
  v_n    integer;
  v_fail integer := 0;
  v_tables text[] := array[
    'peanuts_capture','peanuts_art_program','peanuts_style_guide','peanuts_character',
    'peanuts_animation_title','peanuts_holiday','peanuts_initiative','peanuts_asset_type',
    'peanuts_licensing_status','peanuts_metadata_field','peanuts_asset',
    'peanuts_asset_art_program','peanuts_asset_character','peanuts_asset_animation_title',
    'peanuts_asset_holiday','peanuts_asset_keyword','peanuts_asset_relationship',
    'peanuts_style_guide_character','peanuts_style_guide_art_program'
  ];
begin
  if array_length(v_tables, 1) <> 19 then
    raise exception 'A FAILED: the test itself names % tables, not 19',
      array_length(v_tables, 1);
  end if;

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

  -- Nothing outside the claim may have appeared under this prefix.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'plm' and table_name like 'peanuts\_%' and table_type = 'BASE TABLE';
  if v_n <> 19 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm holds % peanuts tables, expected exactly 19', v_n;
  end if;

  -- THE REFUSED RELATIONSHIP. The art-program field is multi-select, so pairing art
  -- programs with characters off one asset asserts something the licensor never said.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and table_name like '%art\_program%' and table_name like '%character%';
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % art-program-to-character table(s) exist; that link is refused',
      v_n;
  end if;

  -- No media column may ever exist on the asset table.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name = 'peanuts_asset'
     and (column_name in ('bytes','media','content','blob','base64','file_bytes')
          or data_type = 'bytea');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.peanuts_asset carries % media-bearing column(s)', v_n;
  end if;

  -- Style guide must be nullable: most assets in this portal carry none.
  if (select is_nullable from information_schema.columns
       where table_schema = 'plm' and table_name = 'peanuts_asset'
         and column_name = 'style_guide_key') is distinct from 'YES' then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.peanuts_asset.style_guide_key is not nullable';
  end if;

  -- The publication date is free text in this portal and must stay text.
  if (select data_type from information_schema.columns
       where table_schema = 'plm' and table_name = 'peanuts_asset'
         and column_name = 'publication_date_text') is distinct from 'text' then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.peanuts_asset.publication_date_text is not text';
  end if;

  -- Every vocabulary table must record BOTH the internal field name and the UI label.
  -- Losing either one is how the label/name mismatch becomes permanent.
  foreach v_name in array array[
    'peanuts_art_program','peanuts_style_guide','peanuts_character',
    'peanuts_animation_title','peanuts_holiday','peanuts_initiative',
    'peanuts_asset_type','peanuts_licensing_status'] loop
    select count(*) into v_n from information_schema.columns
     where table_schema = 'plm' and table_name = v_name
       and column_name in ('source_field_name','source_field_label','value_key',
                           'value_label','source_value_id','asset_count');
    if v_n <> 6 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% is missing vocabulary columns (found % of 6)', v_name, v_n;
    end if;
  end loop;

  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
  raise notice 'A passed: 19 tables, RLS, 38 policies, no media, no art-program/character link';
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
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee in ('service_role','authenticated','anon','PUBLIC')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    raise exception 'B FAILED: % write grant(s) exist on plm.peanuts_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_n <> 19 then
    raise exception 'B FAILED: expected 19 service_role SELECT grants, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_n <> 18 then
    raise exception 'B FAILED: expected 18 service_role INSERT grants, found %', v_n;
  end if;

  if has_table_privilege('service_role','plm.peanuts_capture','INSERT') then
    raise exception 'B FAILED: plm.peanuts_capture is directly insertable by service_role';
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'B FAILED: anon holds % grant(s) on plm.peanuts_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_n <> 19 then
    raise exception 'B FAILED: expected 19 authenticated SELECT grants, found %', v_n;
  end if;

  raise notice 'B (catalog) passed';
end;
$$;

-- The behavioural half of B. A grant table can be read wrongly; an actual UPDATE cannot.
do $$
declare
  v_cap      uuid;
  v_denied   integer := 0;
  v_expected integer := 11;
  v_t        text;
  -- A representative spread across the structural classes: the vocabulary table whose
  -- single-select flag is pinned, the high-volume asset table, a declared link table, the
  -- declared hierarchy, and a derived table.
  v_spread text[] := array[
    'peanuts_style_guide','peanuts_asset','peanuts_asset_character',
    'peanuts_asset_relationship','peanuts_style_guide_character'
  ];
begin
  insert into plm.peanuts_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, api_endpoint, source_customer_id, source_captured_at,
    expected_counts, raw_summary, created_by,
    portal_reported_asset_total, assets_captured, assets_unreachable)
  values ('ZZTEST-peanuts-B', 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
          'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
          '2099-01-01Z', '{"assets":1}'::jsonb, '{}'::jsonb, 'ZZTEST', 0, 0, 0)
  returning id into v_cap;

  insert into plm.peanuts_art_program (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-program-a', 'ZZTEST Program A', 'zztest_internal_name',
          'ZZTEST Label', true, 0, '{}');

  execute 'set local role service_role';

  -- The loader may still INSERT into a snapshot table: a revoke that overshot would break
  -- the load silently.
  begin
    insert into plm.peanuts_art_program (
      capture_id, value_key, value_label, source_field_name, source_field_label,
      is_multi_select, asset_count, raw)
    values (v_cap, 'zztest-program-b', 'ZZTEST Program B', 'zztest_internal_name',
            'ZZTEST Label', true, 3, '{}');
  exception when insufficient_privilege then
    execute 'reset role';
    raise exception
      'B FAILED: service_role cannot INSERT a snapshot row; the revoke overshot';
  end;

  begin
    update plm.peanuts_art_program set value_label = 'ZZTEST mutated'
     where capture_id = v_cap;
    raise warning 'B FAIL: service_role UPDATE on plm.peanuts_art_program SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    delete from plm.peanuts_art_program where capture_id = v_cap;
    raise warning 'B FAIL: service_role DELETE on plm.peanuts_art_program SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- TRUNCATE is a distinct privilege from DELETE. An append-only snapshot that revokes
  -- DELETE but leaves TRUNCATE reachable can still be emptied in one statement.
  begin
    truncate table plm.peanuts_art_program;
    raise warning 'B FAIL: service_role TRUNCATE on plm.peanuts_art_program SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- The capture root: no INSERT, no UPDATE, no TRUNCATE, ever.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable)
    values ('ZZTEST-peanuts-B-direct', 'ZZTEST-repo', repeat('b', 40), repeat('b', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', 0, 0, 0);
    raise warning 'B FAIL: service_role INSERT into plm.peanuts_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    update plm.peanuts_capture set status = 'complete' where id = v_cap;
    raise warning 'B FAIL: service_role UPDATE on plm.peanuts_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    truncate table plm.peanuts_capture;
    raise warning 'B FAIL: service_role TRUNCATE on plm.peanuts_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- UPDATE / DELETE / TRUNCATE denied across the representative spread. The privilege
  -- check happens before any row is touched, so an empty table proves the grant exactly
  -- as a populated one does.
  foreach v_t in array v_spread loop
    begin
      execute format('update plm.%I set capture_id = capture_id', v_t);
      raise warning 'B FAIL: service_role UPDATE on plm.% SUCCEEDED', v_t;
    exception when insufficient_privilege then v_denied := v_denied + 1;
    end;
  end loop;

  execute 'reset role';

  if v_denied <> v_expected then
    raise exception 'B FAILED: % of % write attempts were denied', v_denied, v_expected;
  end if;
  raise notice 'B (behaviour) passed: % write attempts denied', v_denied;
end;
$$;


-- =====================================================================================
-- C. THE PUBLICATION GATE. Every clause falsified one at a time.
--
-- The point of this section is that no clause of
-- peanuts_capture_complete_requirements_chk can be deleted without a test going red.
-- Each block below satisfies EVERY clause except the one under test.
-- =====================================================================================
do $$
declare
  v_con    text;
  v_raised integer := 0;
  v_want   integer := 5;
begin
  -- C1. A capture that never partitioned around the 10,000-row paging wall.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable,
      deep_paging_partitioned, vocabularies_loaded_from_source)
    values ('ZZTEST-peanuts-C1', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            10, 8, 2, false, true);
    raise warning 'C FAIL: an un-partitioned capture published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_requirements_chk' then
      raise exception 'C1 FAILED: expected peanuts_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C2. A capture whose vocabularies came from distinct() over assets rather than from
  -- the vocabulary API. This is the clause that protects the hundreds of vocabulary
  -- values no asset uses.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable,
      deep_paging_partitioned, vocabularies_loaded_from_source)
    values ('ZZTEST-peanuts-C2', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            10, 8, 2, true, false);
    raise warning 'C FAIL: a vocabulary-shortcut capture published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_requirements_chk' then
      raise exception 'C2 FAILED: expected peanuts_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C3. THE SHORTFALL CLAUSE. assets_unreachable = 0 while the capture sits below the
  -- portal's own total is exactly the silent-truncation shape this landing exists to
  -- refuse.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable,
      deep_paging_partitioned, vocabularies_loaded_from_source)
    values ('ZZTEST-peanuts-C3', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            10, 8, 0, true, true);
    raise warning 'C FAIL: a short capture with zero unreachable assets published';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_requirements_chk' then
      raise exception 'C3 FAILED: expected peanuts_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C4. A capture carrying validation errors.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable,
      deep_paging_partitioned, vocabularies_loaded_from_source, error_summary)
    values ('ZZTEST-peanuts-C4', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            10, 8, 2, true, true, '["ZZTEST-error"]'::jsonb);
    raise warning 'C FAIL: a capture carrying validation errors published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_requirements_chk' then
      raise exception 'C4 FAILED: expected peanuts_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C5. status and load_completed_at must agree in BOTH directions. A completion time on
  -- a still-loading capture is the mirror-image lie and has its own constraint.
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable)
    values ('ZZTEST-peanuts-C5', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'loading', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            10, 8, 2);
    raise warning 'C FAIL: a loading capture carried a completion time';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_time_chk' then
      raise exception 'C5 FAILED: expected peanuts_capture_complete_time_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_raised <> v_want then
    raise exception 'C FAILED: % of % gate clauses refused their bad row', v_raised, v_want;
  end if;

  -- And the positive case: a capture that satisfies every clause DOES publish. Without
  -- this, a constraint that rejected everything would still pass C1-C5.
  insert into plm.peanuts_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, api_endpoint, source_customer_id, source_captured_at,
    load_completed_at, status, expected_counts, raw_summary, created_by,
    portal_reported_asset_total, assets_captured, assets_unreachable,
    deep_paging_partitioned, vocabularies_loaded_from_source, relationship_graph_walked)
  values ('ZZTEST-peanuts-C-ok', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
          'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
          '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
          10, 8, 2, true, true, true);

  raise notice 'C passed: every publication-gate clause is independently falsifiable';
end;
$$;


-- C6. THE ZERO-MEDIA SCOPE GUARD. Storing Peanuts media bytes is out of scope, and the
-- column is CONSTRAINED to zero rather than merely defaulted -- a default is advice, a
-- CHECK is a rule. Until this block existed the whole media-guard family was untested.
--
-- C6b asserts the media clause of the completion CHECK STRUCTURALLY, by reading the
-- constraint definition. That clause is unreachable by an insert while
-- peanuts_capture_media_zero_chk stands -- the hard-zero CHECK fires first -- so a
-- behavioural test for it cannot exist without dropping the very constraint that makes
-- the schema safe. It is defence in depth, and the honest way to pin defence in depth is
-- to assert that it is still there.
do $$
declare
  v_con   text;
  v_def   text;
  -- An explicit fired flag, NOT a bare `raise warning` on the success path. A warning
  -- does not fail a psql run, so a block that only warns when the bad row is ACCEPTED
  -- stays green when the constraint is simply deleted -- which is exactly what the
  -- mutation run caught in this block before this flag existed.
  v_fired boolean := false;
begin
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable, media_downloaded)
    values ('ZZTEST-peanuts-C6', 'ZZTEST-repo', repeat('6', 40), repeat('6', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', 0, 0, 0, 1);
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_media_zero_chk' then
      raise exception 'C6 FAILED: expected peanuts_capture_media_zero_chk, % fired', v_con;
    end if;
    v_fired := true;
  end;
  if not v_fired then
    raise exception
      'C6 FAILED: a capture claiming downloaded media was ACCEPTED; the zero-media scope guard is gone';
  end if;

  -- C6b. The clause is still inside the completion rule.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conname = 'peanuts_capture_complete_requirements_chk'
     and conrelid = 'plm.peanuts_capture'::regclass;
  if v_def is null then
    raise exception 'C6b FAILED: peanuts_capture_complete_requirements_chk does not exist';
  end if;
  if position('media_downloaded = 0' in v_def) = 0 then
    raise exception
      'C6b FAILED: the completion rule no longer requires zero media: %', v_def;
  end if;

  raise notice 'C6 passed: media is constrained to zero, and the completion rule still says so';
end;
$$;


-- C7. THE COMPLETION-RULE ARITHMETIC MUST NOT OVERFLOW EITHER.
-- The function's copy of this arithmetic was fixed in review round two; this pins the
-- TABLE's copy. Uncast, these two `integer` columns raise a raw `integer out of range`
-- and the caller never sees the named constraint that was supposed to refuse the row.
do $$
declare
  v_con   text;
  v_fired boolean := false;
begin
  begin
    insert into plm.peanuts_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, api_endpoint, source_customer_id, source_captured_at,
      load_completed_at, status, expected_counts, raw_summary, created_by,
      portal_reported_asset_total, assets_captured, assets_unreachable,
      deep_paging_partitioned, vocabularies_loaded_from_source)
    values ('ZZTEST-peanuts-C7', 'ZZTEST-repo', repeat('7', 40), repeat('7', 64),
            'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
            '2099-01-01Z', '2099-01-02Z', 'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST',
            2147483647, 2147483647, 1, true, true);
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_capture_complete_requirements_chk' then
      raise exception
        'C7 FAILED: expected peanuts_capture_complete_requirements_chk, % fired', v_con;
    end if;
    v_fired := true;
  end;
  if not v_fired then
    raise exception
      'C7 FAILED: an arithmetically impossible complete capture was ACCEPTED';
  end if;
  raise notice 'C7 passed: the completion rule refuses by name instead of overflowing';
end;
$$;


-- =====================================================================================
-- D. IDENTITY, SHAPE AND VOCABULARY CONTRACTS. Each pinned to a NAMED constraint.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_con    text;
  v_raised integer := 0;
  v_want   integer := 8;
begin
  insert into plm.peanuts_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, api_endpoint, source_customer_id, source_captured_at,
    expected_counts, raw_summary, created_by,
    portal_reported_asset_total, assets_captured, assets_unreachable)
  values ('ZZTEST-peanuts-D', 'ZZTEST-repo', repeat('d', 40), repeat('d', 64),
          'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
          '2099-01-01Z', '{"assets":1}'::jsonb, '{}'::jsonb, 'ZZTEST', 0, 0, 0)
  returning id into v_cap;

  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-a', 'ZZTEST Guide A', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 0, '{}');

  insert into plm.peanuts_character (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-character-a', 'ZZTEST Character A', 'zztest_character_field',
          'ZZTEST Character Label', true, 0, '{}');

  insert into plm.peanuts_asset (
    capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-OBJ-1', 'zztest-file-one.ext', '{}');

  -- D1. A vocabulary value used by ZERO assets is legal and meaningful. This is the whole
  -- reason asset_count is >= 0 rather than > 0, and it is asserted positively: the two
  -- inserts above already used asset_count = 0 and must have succeeded.
  if not exists (select 1 from plm.peanuts_style_guide
                  where capture_id = v_cap and asset_count = 0) then
    raise exception 'D1 FAILED: a zero-usage vocabulary value was not stored';
  end if;

  -- D2. But a NEGATIVE count is nonsense.
  begin
    insert into plm.peanuts_style_guide (
      capture_id, value_key, value_label, source_field_name, source_field_label,
      is_multi_select, asset_count, raw)
    values (v_cap, 'zztest-guide-neg', 'ZZTEST Guide Neg', 'zztest_guide_field',
            'ZZTEST Guide Label', false, -1, '{}');
    raise warning 'D FAIL: a negative asset_count was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_style_guide_asset_count_nonneg_chk' then
      raise exception 'D2 FAILED: expected peanuts_style_guide_asset_count_nonneg_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D3. The style-guide axis is SINGLE-select, and that fact is load-bearing for both
  -- derived tables. A multi-select style-guide row must be refused outright.
  begin
    insert into plm.peanuts_style_guide (
      capture_id, value_key, value_label, source_field_name, source_field_label,
      is_multi_select, asset_count, raw)
    values (v_cap, 'zztest-guide-multi', 'ZZTEST Guide Multi', 'zztest_guide_field',
            'ZZTEST Guide Label', true, 0, '{}');
    raise warning 'D FAIL: a multi-select style-guide vocabulary row was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_style_guide_single_select_chk' then
      raise exception 'D3 FAILED: expected peanuts_style_guide_single_select_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D4. A blank text identifier is never an identifier.
  begin
    insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
    values (v_cap, '   ', 'zztest-file-blank.ext', '{}');
    raise warning 'D FAIL: a blank source_object_id was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_object_id_nonblank_chk' then
      raise exception 'D4 FAILED: expected peanuts_asset_object_id_nonblank_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D5. raw must be a JSON object, not an array or a scalar.
  begin
    insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
    values (v_cap, 'ZZTEST-OBJ-RAW', 'zztest-file-raw.ext', '[]');
    raise warning 'D FAIL: a non-object raw payload was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_raw_obj_chk' then
      raise exception 'D5 FAILED: expected peanuts_asset_raw_obj_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D6. file_ext is lowercased and dot-free, so one extension cannot land three ways.
  begin
    insert into plm.peanuts_asset (capture_id, source_object_id, file_name, file_ext, raw)
    values (v_cap, 'ZZTEST-OBJ-EXT', 'zztest-file-ext.ext', '.EXT', '{}');
    raise warning 'D FAIL: an uppercase dotted file_ext was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_file_ext_shape_chk' then
      raise exception 'D6 FAILED: expected peanuts_asset_file_ext_shape_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D7. FILENAME IS NOT IDENTITY. Two assets with the same filename and different object
  -- ids must BOTH land -- a unique index on the filename would silently drop one.
  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-OBJ-2', 'zztest-file-one.ext', '{}');
  if (select count(*) from plm.peanuts_asset
       where capture_id = v_cap and lower(file_name) = 'zztest-file-one.ext') <> 2 then
    raise exception 'D7 FAILED: a duplicate filename did not land; filename is being treated as identity';
  end if;

  -- D8. But the licensor's own object id IS identity, and repeats within one capture.
  begin
    insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
    values (v_cap, 'ZZTEST-OBJ-1', 'zztest-file-other.ext', '{}');
    raise warning 'D FAIL: a duplicate source_object_id was accepted';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_pkey' then
      raise exception 'D8 FAILED: expected peanuts_asset_pkey, % fired (%)', v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D9. An asset may carry NO style guide. Most of this portal's assets do not, and a
  -- schema that made this column mandatory would drop them.
  if (select count(*) from plm.peanuts_asset
       where capture_id = v_cap and style_guide_key is null) < 1 then
    raise exception 'D9 FAILED: an asset with no style guide was not stored';
  end if;

  -- D10. A style-guide key that is not in the vocabulary is a dangling reference.
  begin
    insert into plm.peanuts_asset (
      capture_id, source_object_id, file_name, style_guide_key, raw)
    values (v_cap, 'ZZTEST-OBJ-FK', 'zztest-file-fk.ext', 'zztest-guide-absent', '{}');
    raise warning 'D FAIL: an unknown style_guide_key was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_style_guide_fkey' then
      raise exception 'D10 FAILED: expected peanuts_asset_style_guide_fkey, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D11. The field dictionary must be unique in the LABEL direction too. Two internal
  -- names claiming one UI label is precisely the confusion this table exists to prevent.
  insert into plm.peanuts_metadata_field (
    capture_id, source_field_name, source_field_label, source_definition_id,
    is_multi_select, is_facetable, field_type, raw)
  values (v_cap, 'zztest_internal_one', 'ZZTEST Field Label', 'zztest-def-1',
          false, true, 'zztest_type', '{}');
  begin
    insert into plm.peanuts_metadata_field (
      capture_id, source_field_name, source_field_label, source_definition_id,
      is_multi_select, is_facetable, field_type, raw)
    values (v_cap, 'zztest_internal_two', 'ZZTEST Field Label', 'zztest-def-2',
            false, true, 'zztest_type', '{}');
    raise warning 'D FAIL: two internal field names shared one UI label';
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_metadata_field_label_uk' then
      raise exception 'D11 FAILED: expected peanuts_metadata_field_label_uk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D12. A keyword link needs no vocabulary row -- the keyword vocabulary is open. This
  -- is asserted positively, because a foreign key added here later would reject real rows.
  insert into plm.peanuts_asset_keyword (
    capture_id, source_object_id, keyword_key, keyword_label, raw)
  values (v_cap, 'ZZTEST-OBJ-1', 'zztest-keyword-a', 'ZZTEST Keyword A', '{}');
  if not exists (select 1 from plm.peanuts_asset_keyword
                  where capture_id = v_cap and keyword_key = 'zztest-keyword-a') then
    raise exception 'D12 FAILED: an open-vocabulary keyword did not land';
  end if;

  if v_raised <> v_want then
    raise exception 'D FAILED: % of % negative cases fired their named constraint',
      v_raised, v_want;
  end if;
  raise notice 'D passed: % named-constraint refusals plus the positive cases', v_raised;
end;
$$;


-- =====================================================================================
-- E. DECLARED vs DERIVED, AND THE HIERARCHY.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_con    text;
  v_raised integer := 0;
  v_want   integer := 5;
begin
  insert into plm.peanuts_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, api_endpoint, source_customer_id, source_captured_at,
    expected_counts, raw_summary, created_by,
    portal_reported_asset_total, assets_captured, assets_unreachable)
  values ('ZZTEST-peanuts-E', 'ZZTEST-repo', repeat('e', 40), repeat('e', 64),
          'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
          '2099-01-01Z', '{"assets":2}'::jsonb, '{}'::jsonb, 'ZZTEST', 0, 0, 0)
  returning id into v_cap;

  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-a', 'ZZTEST Guide A', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 2, '{}');

  insert into plm.peanuts_character (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-character-a', 'ZZTEST Character A', 'zztest_character_field',
          'ZZTEST Character Label', true, 2, '{}');

  insert into plm.peanuts_art_program (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values
    (v_cap, 'zztest-program-a', 'ZZTEST Program A', 'zztest_program_field',
     'ZZTEST Program Label', true, 2, '{}'),
    (v_cap, 'zztest-program-b', 'ZZTEST Program B', 'zztest_program_field',
     'ZZTEST Program Label', true, 1, '{}');

  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-PARENT', 'zztest-parent.ext', '{}'),
         (v_cap, 'ZZTEST-CHILD',  'zztest-child.ext',  '{}');

  -- E1. The declared hierarchy stores its link type VERBATIM. No CHECK may pin it to the
  -- values seen so far, so an unfamiliar edge must land rather than fail.
  insert into plm.peanuts_asset_relationship (
    capture_id, source_relationship_id, parent_object_id, child_object_id, link_type, raw)
  values (v_cap, 'ZZTEST-REL-1', 'ZZTEST-PARENT', 'ZZTEST-CHILD', 'zztest_unseen_link', '{}');
  if not exists (select 1 from plm.peanuts_asset_relationship
                  where capture_id = v_cap and link_type = 'zztest_unseen_link') then
    raise exception 'E1 FAILED: an unfamiliar link_type did not land verbatim';
  end if;

  -- E2. An asset cannot be its own parent.
  begin
    insert into plm.peanuts_asset_relationship (
      capture_id, source_relationship_id, parent_object_id, child_object_id, link_type, raw)
    values (v_cap, 'ZZTEST-REL-SELF', 'ZZTEST-PARENT', 'ZZTEST-PARENT', 'zztest_link', '{}');
    raise warning 'E FAIL: a self-referencing relationship was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_relationship_not_self_chk' then
      raise exception 'E2 FAILED: expected peanuts_asset_relationship_not_self_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E3. Both endpoints must be assets in the same capture.
  begin
    insert into plm.peanuts_asset_relationship (
      capture_id, source_relationship_id, parent_object_id, child_object_id, link_type, raw)
    values (v_cap, 'ZZTEST-REL-DANGLE', 'ZZTEST-ABSENT', 'ZZTEST-CHILD', 'zztest_link', '{}');
    raise warning 'E FAIL: a relationship with an unknown parent was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_asset_relationship_parent_fkey' then
      raise exception 'E3 FAILED: expected peanuts_asset_relationship_parent_fkey, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E4. A derived row may not claim to be fact. relationship_truth is CONSTRAINED, not
  -- defaulted, so no later writer can quietly promote these rows.
  begin
    insert into plm.peanuts_style_guide_character (
      capture_id, style_guide_key, character_key, asset_count, relationship_truth,
      derivation_note)
    values (v_cap, 'zztest-guide-a', 'zztest-character-a', 2, 'declared', 'ZZTEST note');
    raise warning 'E FAIL: a derived style-guide/character row claimed to be declared';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_style_guide_character_truth_chk' then
      raise exception 'E4 FAILED: expected peanuts_style_guide_character_truth_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E5. Same pin on the art-programme derivation.
  begin
    insert into plm.peanuts_style_guide_art_program (
      capture_id, style_guide_key, art_program_key, asset_count, relationship_truth,
      derivation_note)
    values (v_cap, 'zztest-guide-a', 'zztest-program-a', 2, 'declared', 'ZZTEST note');
    raise warning 'E FAIL: a derived style-guide/art-program row claimed to be declared';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_style_guide_art_program_truth_chk' then
      raise exception 'E5 FAILED: expected peanuts_style_guide_art_program_truth_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E6. A derived edge with no supporting asset has nothing behind it.
  begin
    insert into plm.peanuts_style_guide_character (
      capture_id, style_guide_key, character_key, asset_count, relationship_truth,
      derivation_note)
    values (v_cap, 'zztest-guide-a', 'zztest-character-a', 0, 'derived', 'ZZTEST note');
    raise warning 'E FAIL: a derived row with zero supporting assets was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'peanuts_style_guide_character_asset_count_pos_chk' then
      raise exception
        'E6 FAILED: expected peanuts_style_guide_character_asset_count_pos_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_raised <> v_want then
    raise exception 'E FAILED: % of % negative cases fired their named constraint',
      v_raised, v_want;
  end if;

  -- E7. THE MANY-TO-MANY REQUIREMENT, asserted positively. One style guide under TWO art
  -- programmes must land. A one-programme-per-guide model would reject the second row,
  -- and it would be wrong on data this project already holds.
  insert into plm.peanuts_style_guide_art_program (
    capture_id, style_guide_key, art_program_key, asset_count, relationship_truth,
    derivation_note)
  values (v_cap, 'zztest-guide-a', 'zztest-program-a', 2, 'derived',
          'ZZTEST derivation: co-occurrence on assets; style guide is single-select'),
         (v_cap, 'zztest-guide-a', 'zztest-program-b', 1, 'derived',
          'ZZTEST derivation: co-occurrence on assets; style guide is single-select');
  if (select count(*) from plm.peanuts_style_guide_art_program
       where capture_id = v_cap and style_guide_key = 'zztest-guide-a') <> 2 then
    raise exception 'E7 FAILED: one style guide could not carry two art programmes';
  end if;

  -- E8. The derived character edge lands when it is honestly labelled.
  insert into plm.peanuts_style_guide_character (
    capture_id, style_guide_key, character_key, asset_count, relationship_truth,
    derivation_note)
  values (v_cap, 'zztest-guide-a', 'zztest-character-a', 2, 'derived',
          'ZZTEST derivation: assets carrying both; style guide is single-select so no '
          'pairing is invented');
  if not exists (select 1 from plm.peanuts_style_guide_character
                  where capture_id = v_cap and relationship_truth = 'derived') then
    raise exception 'E8 FAILED: a correctly labelled derived row did not land';
  end if;

  raise notice 'E passed: declared stays verbatim, derived stays derived, many-to-many holds';
end;
$$;


-- =====================================================================================
-- F. THE CAPTURE FUNCTIONS.
--
-- F1 covers existence and the security posture; F2 falsifies every shape of a bad count
-- at begin_; F3 falsifies the same shapes again at the PUBLICATION GATE, reaching the
-- stored object the way an owner UPDATE would -- because begin_ having run is not
-- evidence that the stored value is still sound.
--
-- The three shapes that were live defects in the sibling landings each get their own
-- named case: F3a (JSON null -> a SKIPPED check), F3b (numeric-looking STRING whose value
-- MATCHES the true row count -> a silent WRONG ANSWER), F3c/F3d (fraction and oversized
-- value -> a raw cast error that wedges the capture).
--
-- Every handler here is `when raise_exception` or a specific class. There is no
-- `when others` in this file.
-- =====================================================================================
do $$
declare
  v_n integer;
begin
  foreach v_n in array array[1] loop end loop;  -- no-op, keeps the declare block honest

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm'
     and p.proname in ('begin_peanuts_capture','finalize_peanuts_capture');
  if v_n <> 2 then
    raise exception 'F1 FAILED: expected 2 peanuts capture functions, found %', v_n;
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm'
     and p.proname in ('begin_peanuts_capture','finalize_peanuts_capture')
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig, '{}'::text[]), ',') like '%search_path%';
  if v_n <> 2 then
    raise exception
      'F1 FAILED: both functions must be security definer with a pinned search_path (% of 2)',
      v_n;
  end if;

  if has_function_privilege('anon',
       'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'F1 FAILED: finalize_peanuts_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role',
       'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'F1 FAILED: service_role cannot execute finalize_peanuts_capture';
  end if;

  raise notice 'F1 passed: both functions exist, are security definer, service_role only';
end;
$$;

-- F2. begin_peanuts_capture refuses every unusable count shape, and is idempotent.
do $$
declare
  v_a      uuid;
  v_b      uuid;
  v_raised integer := 0;
  v_want   integer := 10;
  v_msg    text;
begin
  v_a := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F2', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST',
    0, 0, 0, true, true, true);

  -- Idempotent: the identical call resumes the same capture, it does not create a second.
  v_b := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F2', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST',
    0, 0, 0, true, true, true);
  if v_a is distinct from v_b then
    raise exception 'F2 FAILED: an identical begin_ call created a second capture';
  end if;
  if (select count(*) from plm.peanuts_capture
       where capture_key = 'ZZTEST-peanuts-F2') <> 1 then
    raise exception 'F2 FAILED: more than one capture row exists for one capture_key';
  end if;

  -- Same key, different bytes, is a contradiction rather than a resume.
  begin
    perform plm.begin_peanuts_capture(
      'ZZTEST-peanuts-F2', 'ZZTEST-repo', repeat('f', 40), repeat('e', 64),
      'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
      '2099-01-01Z'::timestamptz, '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST',
      0, 0, 0, true, true, true);
    raise warning 'F2 FAIL: a same-key capture with a different manifest hash was accepted';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if position('DIFFERENT source manifest hash' in v_msg) = 0 then
      raise exception 'F2 FAILED: wrong refusal for a changed manifest hash: %', v_msg;
    end if;
    v_raised := v_raised + 1;
  end;

  -- Every unusable expected_counts shape, one at a time. A JSON null and a
  -- numeric-looking string must BOTH be refused by the TYPE test.
  declare
    v_bad  jsonb[] := array[
      '{"assets":null}'::jsonb,     -- #1219: presence test says supplied, compares to nothing
      '{"assets":"12"}'::jsonb,     -- the silent wrong answer: casts and compares cleanly
      '{"assets":true}'::jsonb,
      '{"assets":[1]}'::jsonb,
      '{"assets":{"n":1}}'::jsonb,
      '{"assets":-1}'::jsonb,
      '{"assets":1.5}'::jsonb,
      -- Past bigint. begin_ must refuse this BY NAME rather than leave it to finalize_:
      -- a named early refusal is the difference between a loader told at the start and
      -- one that discovers it after a full crawl.
      '{"assets":99999999999999999999999}'::jsonb,
      -- The ONLY check anywhere on a manifest claiming downloaded media. finalize_'s
      -- extra-key sweep would accept {"media_downloaded": 5} as a perfectly well-formed
      -- extra key -- it is a non-negative integer in range -- so if this branch goes, a
      -- manifest that admits to downloading media loads without a word.
      '{"assets":0,"media_downloaded":1}'::jsonb
    ];
    v_i    integer;
  begin
    for v_i in 1 .. array_length(v_bad, 1) loop
      begin
        perform plm.begin_peanuts_capture(
          'ZZTEST-peanuts-F2-bad-' || v_i, 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
          'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
          '2099-01-01Z'::timestamptz, v_bad[v_i], '{}'::jsonb, 'ZZTEST',
          0, 0, 0, true, true, true);
        raise warning 'F2 FAIL: begin_ accepted an unusable expected_counts: %', v_bad[v_i];
      exception when raise_exception then
        get stacked diagnostics v_msg = message_text;
        -- A NAMED refusal, never a raw cast error. `invalid input syntax` here would mean
        -- the type test ran too late, which is defect #1221/#1222.
        if position('begin_peanuts_capture:' in v_msg) = 0
           or position('invalid input syntax' in v_msg) > 0 then
          raise exception 'F2 FAILED: unusable count % gave the wrong error: %',
            v_bad[v_i], v_msg;
        end if;
        v_raised := v_raised + 1;
      end;
    end loop;
  end;

  if v_raised <> v_want then
    raise exception 'F2 FAILED: % of % bad inputs were refused by name', v_raised, v_want;
  end if;

  -- And the shape that MUST be accepted: an integral JSON number written 1.0. Refusing
  -- this, or crashing on it, is defect #1221.
  perform plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F2-onepointzero', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, '{"assets":1.0}'::jsonb, '{}'::jsonb, 'ZZTEST',
    0, 0, 0, true, true, true);

  -- A manifest that declares ZERO media is fine; only a nonzero claim is refused.
  perform plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F2-zeromedia', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, '{"assets":0,"media_downloaded":0}'::jsonb,
    '{}'::jsonb, 'ZZTEST', 0, 0, 0, true, true, true);

  raise notice 'F2 passed: % named refusals, idempotency holds, 1.0 still accepted', v_raised;
end;
$$;

-- F3. The PUBLICATION GATE re-validates the STORED object. Each case writes the bad value
-- straight into the column, exactly as an owner UPDATE would, so begin_ having run is
-- irrelevant. Every one of them must end with the capture REJECTED and NOT complete.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_obs    jsonb;
  v_cases  jsonb[] := array[
    '{"assets":null}'::jsonb,
    '{"assets":"1"}'::jsonb,
    '{"assets":1.5}'::jsonb,
    '{"assets":99999999999999999999999}'::jsonb
  ];
  v_names  text[] := array['F3a json-null','F3b numeric string that MATCHES',
                           'F3c fraction','F3d out of bigint range'];
  v_i      integer;
begin
  for v_i in 1 .. array_length(v_cases, 1) loop
    v_cap := plm.begin_peanuts_capture(
      'ZZTEST-peanuts-F3-' || v_i, 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
      'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
      '2099-01-01Z'::timestamptz, '{"assets":1}'::jsonb, '{}'::jsonb, 'ZZTEST',
      1, 1, 0, true, true, true);

    -- Exactly ONE asset row, so that in case F3b the string "1" is NUMERICALLY CORRECT.
    -- A fixture using "999" would be caught by the mismatch and would prove nothing about
    -- the type rule.
    insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
    values (v_cap, 'ZZTEST-OBJ-F3', 'zztest-f3.ext', '{}');
    insert into plm.peanuts_style_guide (
      capture_id, value_key, value_label, source_field_name, source_field_label,
      is_multi_select, asset_count, raw)
    values (v_cap, 'zztest-guide-unused', 'ZZTEST Unused Guide', 'zztest_guide_field',
            'ZZTEST Guide Label', false, 0, '{}');

    -- Reach the stored column directly. This is the owner-UPDATE path that begin_ cannot
    -- police, and it is the entire reason the gate re-validates.
    update plm.peanuts_capture set expected_counts = v_cases[v_i] where id = v_cap;

    -- finalize_ must not crash: a raw cast error here would wedge the capture in
    -- 'loading' with no recorded reason, which is defect #1221/#1222.
    perform plm.finalize_peanuts_capture(
      v_cap,
      jsonb_build_object(
        'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
        'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
        'metadata_fields',0,'assets',1,'asset_art_programs',0,'asset_characters',0,
        'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
        'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
      '[]'::jsonb);

    select status, error_summary into v_status, v_err
      from plm.peanuts_capture where id = v_cap;

    if v_status <> 'rejected' then
      raise exception '% FAILED: capture is %, expected rejected -- the count check was SKIPPED',
        v_names[v_i], v_status;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_err) e
       where e ->> 'entity' = 'assets'
         and e ->> 'code' in ('expected_count_not_a_number',
                              'expected_count_not_a_nonnegative_integer',
                              'expected_count_out_of_range')) then
      raise exception '% FAILED: rejected, but not for the count: %', v_names[v_i], v_err;
    end if;
    -- The evidence must SURVIVE. A `raise exception` on rejection would have rolled the
    -- rejection row back and left the capture in 'loading'.
    if jsonb_array_length(v_err) = 0 then
      raise exception '% FAILED: the rejection persisted no error evidence', v_names[v_i];
    end if;
  end loop;

  -- F3e. THE HAPPY PATH. Without this, a gate that rejected everything would pass F3a-d.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F3-ok', 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',1,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '{}'::jsonb, 'ZZTEST', 3, 1, 2, true, true, true);
  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-OBJ-OK', 'zztest-ok.ext', '{}');
  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-unused', 'ZZTEST Unused Guide', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 0, '{}');
  perform plm.finalize_peanuts_capture(
    v_cap,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',1,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '[]'::jsonb);
  select status, observed_counts into v_status, v_obs
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception 'F3e FAILED: a fully consistent capture did not publish (status %)',
      v_status;
  end if;
  if (v_obs ->> 'assets') <> '1' then
    raise exception 'F3e FAILED: observed counts came from somewhere other than the tables: %',
      v_obs;
  end if;

  -- F3f. Idempotent finalize on an already-complete capture.
  perform plm.finalize_peanuts_capture(v_cap, '{}'::jsonb, '[]'::jsonb);
  select status into v_status from plm.peanuts_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception 'F3f FAILED: re-finalizing a complete capture changed it to %', v_status;
  end if;

  -- F3g. THE PAGING-WALL ARITHMETIC at the gate. A capture claiming nothing unreachable
  -- while sitting below the portal total must be rejected, not published.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F3-short', 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz,
    jsonb_build_object(
      'art_programs',0,'style_guides',0,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '{}'::jsonb, 'ZZTEST', 9, 0, 0, true, true, true);
  perform plm.finalize_peanuts_capture(
    v_cap,
    jsonb_build_object(
      'art_programs',0,'style_guides',0,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '[]'::jsonb);
  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected'
     or not exists (select 1 from jsonb_array_elements(v_err) e
                     where e ->> 'code' = 'asset_total_arithmetic_mismatch') then
    raise exception 'F3g FAILED: a short capture with zero unreachable assets was not rejected (% / %)',
      v_status, v_err;
  end if;

  -- F3h. THE VOCABULARY-SHORTCUT DETECTOR. A style-guide vocabulary in which every value
  -- is used by an asset is the signature of distinct()-over-assets, which silently
  -- discards the unused values.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-F3-shortcut', 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '{}'::jsonb, 'ZZTEST', 0, 0, 0, true, true, true);
  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-used', 'ZZTEST Used Guide', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 7, '{}');
  perform plm.finalize_peanuts_capture(
    v_cap,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '[]'::jsonb);
  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected'
     or not exists (select 1 from jsonb_array_elements(v_err) e
                     where e ->> 'code' = 'vocabulary_shows_no_unused_values') then
    raise exception 'F3h FAILED: a shortcut-shaped vocabulary was not detected (% / %)',
      v_status, v_err;
  end if;

  raise notice 'F3 passed: the gate re-validates the stored object, publishes only a clean capture';
end;
$$;


-- =====================================================================================
-- G. api.source_capture_inventory -- EXTENDED, NOT REWRITTEN.
--
-- The point of this section is that the view still answers exactly as before for every
-- PRE-EXISTING source, and additionally classifies plm.peanuts_*.
-- =====================================================================================
do $$
declare
  r        record;
  v_before integer;
  v_cap    uuid;
  v_i      integer;
  v_want   text;
  v_got    text;
  -- THE ONE PLACE A NEW LANDING SCHEMA TOUCHES THIS BLOCK. Prefix -> source_system, in
  -- the order api.source_capture_inventory tests them (dcp/opa first; first match wins).
  -- Written independently of the view on purpose: that is what makes this a regression
  -- test rather than a tautology.
  v_map text[][] := array[
    ['dcp\_%',     'disney'],
    ['opa\_%',     'disney'],
    ['pmt\_%',     'paramount'],
    ['nbcu\_%',    'nbcu'],
    ['wb\_%',      'warner'],
    ['erp\_%',     'coldlion'],
    ['sega\_%',    'sega'],
    ['peanuts\_%', 'peanuts'],
    -- 2026-08-19: added by the author of #1239 / #1240 with migration 20260819151536,
    -- which classified the 11 plm.wildbrain_* tables the WildBrain landing never
    -- registered in the view. This block failed first, naming this array. One row, and
    -- nothing else in this file changed.
    ['wildbrain\_%', 'wildbrain'],
    ['sesame\_%',    'sesame']
  ];
begin
  -- Every pre-existing source keeps its classification. If a Peanuts branch had been
  -- inserted above one of these instead of beside it, this goes red.
  select count(*) into v_before from api.source_capture_inventory
   where source_system = 'peanuts';
  if v_before <> 19 then
    raise exception 'G FAILED: % peanuts tables classified, expected 19', v_before;
  end if;

  -- EVERY plm table, against the classification rule restated here independently. Walking
  -- only sega_ would let a slip over NBCU, Disney, Paramount, Warner or Coldlion through:
  -- the Peanuts branch was inserted into a `case`, and a `case` is order-sensitive, so the
  -- regression has to cover the arms this change sits next to as well as its own.
  -- Resolved from v_map, declared above -- the SAME single-map structure now used by F1
  -- in supabase/tests/sega_landing_contracts.sql, so the two files agree on the rule and
  -- a new landing schema adds one row to each rather than editing a `case` in both.
  for r in select c.relname
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'plm' and c.relkind = 'r'
  loop
    v_want := 'other';
    for v_i in 1 .. array_length(v_map, 1) loop
      if r.relname like v_map[v_i][1] then
        v_want := v_map[v_i][2];
        exit;
      end if;
    end loop;

    v_got := (select source_system from api.source_capture_inventory
               where table_name = r.relname);
    if v_got is distinct from v_want then
      if v_want = 'other' and v_got is distinct from 'other' then
        raise exception
          'G FAILED: plm.% is classified as ''%'' but v_map in this block does not know its prefix. If you are landing a new source, add one row to v_map above -- do not delete this check.',
          r.relname, v_got;
      end if;
      raise exception 'G FAILED: plm.% classifies as %, expected %',
        r.relname, v_got, v_want;
    end if;
  end loop;

  -- And every plm base table still appears exactly once. A view edit that dropped rows
  -- would otherwise pass the loop above, which only checks the rows that ARE there.
  if (select count(*) from api.source_capture_inventory)
     <> (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'plm' and c.relkind = 'r') then
    raise exception 'G FAILED: the view no longer reports one row per plm table';
  end if;

  -- The ten output columns keep their names and order, so SELECT * consumers do not shift.
  if (select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns
       where table_schema = 'api' and table_name = 'source_capture_inventory')
     <> 'source_system,table_name,row_count,carries_resolution,table_comment,'
        || 'retained_row_count,latest_complete_row_count,count_basis,'
        || 'latest_complete_status,count_note' then
    raise exception 'G FAILED: the view output columns changed shape';
  end if;

  -- With no complete Peanuts capture, latest-complete is NULL -- "unknown", never zero.
  select * into r from api.source_capture_inventory where table_name = 'peanuts_asset';
  if r.count_basis <> 'latest_complete' then
    raise exception 'G FAILED: peanuts_asset count_basis is %, expected latest_complete',
      r.count_basis;
  end if;

  -- Now publish one capture and check the count follows it.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-G', 'ZZTEST-repo', repeat('9', 40), repeat('9', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-06-01Z'::timestamptz,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',2,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '{}'::jsonb, 'ZZTEST', 5, 2, 3, true, true, true);
  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-G-1', 'zztest-g-one.ext', '{}'),
         (v_cap, 'ZZTEST-G-2', 'zztest-g-two.ext', '{}');
  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-unused', 'ZZTEST Unused Guide', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 0, '{}');
  perform plm.finalize_peanuts_capture(
    v_cap,
    jsonb_build_object(
      'art_programs',0,'style_guides',1,'characters',0,'animation_titles',0,
      'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
      'metadata_fields',0,'assets',2,'asset_art_programs',0,'asset_characters',0,
      'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
      'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0),
    '[]'::jsonb);

  select * into r from api.source_capture_inventory where table_name = 'peanuts_capture';
  if r.latest_complete_row_count <> 1 or r.count_basis <> 'latest_complete' then
    raise exception 'G FAILED: peanuts_capture reports % / %',
      r.latest_complete_row_count, r.count_basis;
  end if;

  select * into r from api.source_capture_inventory where table_name = 'peanuts_asset';
  if r.latest_complete_row_count <> 2 then
    raise exception 'G FAILED: peanuts_asset latest-complete count is %, expected 2',
      r.latest_complete_row_count;
  end if;
  if r.count_note not like 'Latest complete Peanuts capture%' then
    raise exception 'G FAILED: the peanuts count note is wrong: %', r.count_note;
  end if;
  if r.row_count is distinct from r.retained_row_count then
    raise exception 'G FAILED: the row_count compatibility alias broke';
  end if;

  -- A peanuts table this fixture never wrote reports ZERO for the current capture, not
  -- NULL: NULL means "cannot be derived", and for a capture-scoped table it can be.
  select * into r from api.source_capture_inventory where table_name = 'peanuts_asset_keyword';
  if r.latest_complete_row_count is distinct from 0::bigint then
    raise exception 'G FAILED: peanuts_asset_keyword latest-complete count is %, expected 0',
      r.latest_complete_row_count;
  end if;

  -- Retained counts still include the rejected attempts from section F.
  select * into r from api.source_capture_inventory where table_name = 'peanuts_capture';
  if r.retained_row_count <= 1 then
    raise exception 'G FAILED: retained count is %, expected the rejected attempts too',
      r.retained_row_count;
  end if;

  raise notice 'G passed: peanuts classified, pre-existing sources and column shape unchanged';
end;
$$;


-- =====================================================================================
-- H. THE WEDGE CLASS, AND THE GUARDS THAT PREVIOUSLY HAD NO FAILING TEST.
--
-- Every case here was added after review: each one is a shape where finalize_ could abort
-- BEFORE writing the rejection row, or a guard whose removal left the suite green. A
-- guard with no test that fails when you delete it is not a guard, so each block below
-- names the mutation it is the counter-test for.
-- =====================================================================================

-- H1. HOSTILE ARGUMENTS MUST BE RECORDED, NOT RAISED.
-- Counter-test for: moving the p_observed_counts / p_error_summary validation back above
-- the row lock, or restoring `raise exception` there. Either way the capture is left in
-- 'loading' with no recorded reason and a retry dies identically -- a WEDGE.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_i      integer;
  v_obs_bad jsonb[] := array['[]'::jsonb, '"twelve"'::jsonb, null::jsonb];
  v_names  text[]   := array['H1a jsonb array','H1b jsonb string','H1c SQL null'];
begin
  for v_i in 1 .. 3 loop
    v_cap := plm.begin_peanuts_capture(
      'ZZTEST-peanuts-H1-' || v_i, 'ZZTEST-repo', repeat('b', 40), repeat('b', 64),
      'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
      '2099-01-01Z'::timestamptz, '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST',
      0, 0, 0, true, true, true);

    perform plm.finalize_peanuts_capture(v_cap, v_obs_bad[v_i], '[]'::jsonb);

    select status, error_summary into v_status, v_err
      from plm.peanuts_capture where id = v_cap;
    if v_status <> 'rejected' then
      raise exception
        '% FAILED: capture is %, expected rejected -- an unusable argument WEDGED it in loading',
        v_names[v_i], v_status;
    end if;
    if not exists (select 1 from jsonb_array_elements(v_err) e
                    where e ->> 'code' = 'observed_counts_not_an_object') then
      raise exception '% FAILED: rejected without naming the reason: %', v_names[v_i], v_err;
    end if;
  end loop;

  -- H1d. The other argument, transposed the way a loader actually gets it wrong.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H1d', 'ZZTEST-repo', repeat('b', 40), repeat('b', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST',
    0, 0, 0, true, true, true);
  perform plm.finalize_peanuts_capture(v_cap, '{}'::jsonb, '{}'::jsonb);
  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected'
     or not exists (select 1 from jsonb_array_elements(v_err) e
                     where e ->> 'code' = 'error_summary_not_an_array') then
    raise exception 'H1d FAILED: a non-array p_error_summary was not recorded (% / %)',
      v_status, v_err;
  end if;

  raise notice 'H1 passed: an unusable argument is recorded evidence, never a wedge';
end;
$$;

-- H2. THE ARITHMETIC MUST NOT OVERFLOW BEFORE IT CAN REPORT.
-- Counter-test for: dropping the ::bigint casts in the
-- assets_captured + assets_unreachable comparison. The three columns are `integer`, so
-- the bare sum raises `integer out of range` BEFORE the rejection UPDATE -- wedging the
-- capture with no recorded reason, which is the very thing this branch reports.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_counts jsonb := jsonb_build_object(
    'art_programs',0,'style_guides',0,'characters',0,'animation_titles',0,
    'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
    'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
    'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
    'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0);
begin
  -- Both values pass begin_'s `>= 0` guard; their SUM does not fit in an integer.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H2', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, v_counts, '{}'::jsonb, 'ZZTEST',
    2147483647, 2147483647, 1, true, true, true);

  perform plm.finalize_peanuts_capture(v_cap, v_counts, '[]'::jsonb);

  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'H2 FAILED: capture is %, expected rejected', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'asset_total_arithmetic_mismatch') then
    raise exception 'H2 FAILED: rejected, but the arithmetic mismatch was not recorded: %',
      v_err;
  end if;
  -- The claimed capture size disagrees with the rows too, and must be recorded alongside
  -- rather than instead.
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'assets_captured_disagrees_with_rows') then
    raise exception 'H2 FAILED: the row-count disagreement was not recorded: %', v_err;
  end if;

  raise notice 'H2 passed: the asset arithmetic reports instead of overflowing';
end;
$$;

-- H3. AN INTEGRAL COUNT WRITTEN 1.0 MUST PUBLISH.
-- Counter-test for: replacing ((x ->> key)::numeric)::bigint with (x ->> key)::bigint.
-- `->>` renders the JSON number as TEXT, so '1.0'::bigint raises invalid-input-syntax and
-- wedges the capture. This is the defect that bit the NBCU and WildBrain/Sega authors
-- (#1221/#1222); until this block existed, reverting the numeric hop left the suite GREEN.
--
-- The fixture uses 1.0 in BOTH the stored expected_counts and the reported counts,
-- because the two assignment sites are separate code and a test that exercises only one
-- of them leaves the other reopenable.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_obs    jsonb;
  v_counts jsonb := jsonb_build_object(
    'art_programs',0,'style_guides',1.0::numeric,'characters',0,'animation_titles',0,
    'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
    'metadata_fields',0,'assets',1.0::numeric,'asset_art_programs',0,'asset_characters',0,
    'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
    'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0);
begin
  -- Prove the fixture is actually the shape under test: a JSON number that renders with a
  -- decimal point. If a future edit makes this emit plain `1`, the test would silently
  -- stop testing anything.
  if (v_counts ->> 'assets') <> '1.0' then
    raise exception 'H3 FAILED: the fixture is not 1.0, it is % -- the test proves nothing',
      v_counts ->> 'assets';
  end if;
  if jsonb_typeof(v_counts -> 'assets') <> 'number' then
    raise exception 'H3 FAILED: the fixture is not a JSON number';
  end if;

  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H3', 'ZZTEST-repo', repeat('d', 40), repeat('d', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, v_counts, '{}'::jsonb, 'ZZTEST',
    4, 1, 3, true, true, true);
  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-H3-1', 'zztest-h3.ext', '{}');
  insert into plm.peanuts_style_guide (
    capture_id, value_key, value_label, source_field_name, source_field_label,
    is_multi_select, asset_count, raw)
  values (v_cap, 'zztest-guide-unused', 'ZZTEST Unused Guide', 'zztest_guide_field',
          'ZZTEST Guide Label', false, 0, '{}');

  -- Same 1.0-bearing object as the REPORTED counts, exercising the second assignment site.
  perform plm.finalize_peanuts_capture(v_cap, v_counts, '[]'::jsonb);

  select status, observed_counts into v_status, v_obs
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception
      'H3 FAILED: a capture whose counts are written 1.0 did not publish (status %) -- the raw ::bigint cast is back',
      v_status;
  end if;
  if (v_obs ->> 'assets') <> '1' then
    raise exception 'H3 FAILED: observed counts are wrong: %', v_obs;
  end if;

  raise notice 'H3 passed: 1.0 publishes; the numeric hop is exercised on both sites';
end;
$$;

-- H4. THE EXTRA-KEY SWEEP APPLIES THE FULL RULE, NOT A TYPE TEST ALONE.
-- Counter-test for: reverting the sweep to `where ... jsonb_typeof(e.value) <> 'number'`.
-- A negative, fractional or oversized value under a key outside the eighteen entities
-- then passes, while the comment above it claims every key is covered.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_counts jsonb := jsonb_build_object(
    'art_programs',0,'style_guides',0,'characters',0,'animation_titles',0,
    'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
    'metadata_fields',0,'assets',0,'asset_art_programs',0,'asset_characters',0,
    'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
    'asset_relationships',0,'style_guide_characters',0,'style_guide_art_programs',0);
begin
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H4', 'ZZTEST-repo', repeat('e', 40), repeat('e', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, v_counts, '{}'::jsonb, 'ZZTEST',
    0, 0, 0, true, true, true);

  -- Plant the extra keys the way an owner UPDATE would: begin_ already refused them, so
  -- only the gate's own re-validation can catch this.
  update plm.peanuts_capture
     set expected_counts = v_counts
                           || jsonb_build_object('zztest_extra_negative', -1)
                           || jsonb_build_object('zztest_extra_fraction', 1.5::numeric)
   where id = v_cap;

  perform plm.finalize_peanuts_capture(
    v_cap,
    v_counts || jsonb_build_object('zztest_extra_reported', -2),
    '[]'::jsonb);

  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'H4 FAILED: capture is %, expected rejected', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'entity' = 'zztest_extra_negative'
                    and e ->> 'code' = 'expected_count_not_a_nonnegative_integer') then
    raise exception 'H4 FAILED: a NEGATIVE extra expected key was not caught: %', v_err;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'entity' = 'zztest_extra_fraction'
                    and e ->> 'code' = 'expected_count_not_a_nonnegative_integer') then
    raise exception 'H4 FAILED: a FRACTIONAL extra expected key was not caught: %', v_err;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'entity' = 'zztest_extra_reported'
                    and e ->> 'code' = 'reported_count_not_a_nonnegative_integer') then
    raise exception 'H4 FAILED: a NEGATIVE extra reported key was not caught: %', v_err;
  end if;

  raise notice 'H4 passed: extra keys get type, sign, integrality and range';
end;
$$;

-- H5. begin_peanuts_capture IS LOCKED DOWN TOO.
-- Counter-test for: a default privilege leaking EXECUTE on the INSERT path to the capture
-- root. F1 asserted this for finalize_ only, which left begin_ unwatched.
do $$
declare
  v_sig text :=
    'plm.begin_peanuts_capture(text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,integer,integer,integer,boolean,boolean,boolean,text)';
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE')
     or has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception 'H5 FAILED: begin_peanuts_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
    raise exception 'H5 FAILED: service_role cannot execute begin_peanuts_capture';
  end if;
  if has_function_privilege('public', v_sig, 'EXECUTE') then
    raise exception 'H5 FAILED: begin_peanuts_capture is still executable by PUBLIC';
  end if;
  raise notice 'H5 passed: begin_peanuts_capture is service_role only';
end;
$$;

-- H6. THE RELATIONSHIP-WALK CONTRADICTION, AND THE NON-BLOCKER BESIDE IT.
-- Counter-test for: deleting the relationship_rows_without_graph_walk branch. Until this
-- block existed that branch had no test at all -- it was reported as covered when it was
-- not.
--
-- Both halves matter. relationship_graph_walked = false is deliberately NOT a publication
-- blocker (the schema contract's completion rule does not list it), so a test that only
-- checked the rejection could be "fixed" by making the flag mandatory, which would refuse
-- legitimate captures. H6b pins the non-blocker half.
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_counts jsonb := jsonb_build_object(
    'art_programs',0,'style_guides',0,'characters',0,'animation_titles',0,
    'holidays',0,'initiatives',0,'asset_types',0,'licensing_statuses',0,
    'metadata_fields',0,'assets',2,'asset_art_programs',0,'asset_characters',0,
    'asset_animation_titles',0,'asset_holidays',0,'asset_keywords',0,
    'asset_relationships',1,'style_guide_characters',0,'style_guide_art_programs',0);
begin
  -- H6a. Relationship rows present while the flag says the walk never ran.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H6a', 'ZZTEST-repo', repeat('7', 40), repeat('7', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz, v_counts, '{}'::jsonb, 'ZZTEST',
    2, 2, 0, true, true, false);
  insert into plm.peanuts_asset (capture_id, source_object_id, file_name, raw)
  values (v_cap, 'ZZTEST-H6-P', 'zztest-h6-parent.ext', '{}'),
         (v_cap, 'ZZTEST-H6-C', 'zztest-h6-child.ext', '{}');
  insert into plm.peanuts_asset_relationship (
    capture_id, source_relationship_id, parent_object_id, child_object_id, link_type, raw)
  values (v_cap, 'ZZTEST-H6-REL', 'ZZTEST-H6-P', 'ZZTEST-H6-C', 'zztest_link', '{}');

  perform plm.finalize_peanuts_capture(v_cap, v_counts, '[]'::jsonb);

  select status, error_summary into v_status, v_err
    from plm.peanuts_capture where id = v_cap;
  if v_status <> 'rejected'
     or not exists (select 1 from jsonb_array_elements(v_err) e
                     where e ->> 'code' = 'relationship_rows_without_graph_walk') then
    raise exception
      'H6a FAILED: relationship rows with no graph walk were not caught (% / %)',
      v_status, v_err;
  end if;

  -- H6b. The same unwalked flag with NO relationship rows still publishes. A partial walk
  -- must be VISIBLE, not fatal.
  v_cap := plm.begin_peanuts_capture(
    'ZZTEST-peanuts-H6b', 'ZZTEST-repo', repeat('7', 40), repeat('7', 64),
    'https://example.invalid', 'https://api.example.invalid', 'ZZTEST-customer',
    '2099-01-01Z'::timestamptz,
    v_counts || jsonb_build_object('assets', 0, 'asset_relationships', 0),
    '{}'::jsonb, 'ZZTEST', 0, 0, 0, true, true, false);
  perform plm.finalize_peanuts_capture(
    v_cap, v_counts || jsonb_build_object('assets', 0, 'asset_relationships', 0),
    '[]'::jsonb);
  select status into v_status from plm.peanuts_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception
      'H6b FAILED: an unwalked relationship graph with no rows blocked publication (status %) -- it is not a blocker by contract',
      v_status;
  end if;

  raise notice 'H6 passed: the walk contradiction is caught; the flag alone is not a blocker';
end;
$$;

rollback;
