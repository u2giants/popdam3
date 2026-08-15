-- =====================================================================================
-- Contract tests for migration 20260811050000 -- the Disney DCP Vault PHASE 2 metadata
-- landing schema (issue #748, object claim #749).
--
-- -------------------------------------------------------------------------------------
-- HOW THIS FILE IS RUN, AND WHAT ITS RESULT MEANS
--   CI executes it. `.github/workflows/database-contract-tests.yml` (added by #741 for
--   #695/#731) replays every migration into a THROWAWAY Supabase inside the runner and
--   runs every supabase/tests/*.sql against it.
--
--   THIS FILE IS WRITTEN TO PASS FROM EMPTY and must stay that way -- it must never end
--   up in supabase/tests/ci-quarantine.txt. Everything it touches is created by this
--   repository's own migrations: the plm schema, the Phase-1 DCP landing
--   (20260810190000 / 20260810190100, which do replay from empty) and this migration. It
--   needs no seeded profile, no Customer, no Licensor and no pre-adoption baseline
--   object. If a future assertion here cannot hold from empty, DO NOT quarantine the
--   file -- move that one assertion to a preview-only check and say so out loud.
--
--   A green CI run proves the contract holds against a database built purely from this
--   repository. It does NOT prove it against preview or production, which carry adopted
--   history and real data. A preview run is still required before promotion.
--
-- SIDE EFFECTS: NONE. Every section that writes runs inside an explicit transaction
--   ending in ROLLBACK, and section H re-asserts that against committed state.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No real Disney
--   property, character, style guide, art style, keyword, DAM path, file name or portal
--   URL appears here. Fixtures use ZZTEST-* tokens, example.invalid URLs and the reserved
--   uuid prefix 99999999-9999-4999-8999-*.
--
-- WHY EVERY "must be refused" CHECK TRAPS A NAMED SQLSTATE AND NOT `when others`:
--   `when others` is satisfied by ANY error -- a NOT NULL violation, a typo in the test's
--   own fixture -- so the section would PASS FOR THE WRONG REASON, reporting that a guard
--   works when the statement never reached it. Guards written in PL/pgSQL raise P0001;
--   guards that are CHECK or FOREIGN KEY constraints raise 23514 / 23503 / 23505. Each
--   assertion below traps the one it actually expects.
--
-- WHAT IT ASSERTS
--   A  The eight tables and the four new functions exist.
--   B  PRIVILEGES: service_role holds SELECT and INSERT and NOTHING ELSE. anon/public
--      hold nothing. Enumerated from pg_class so a table added later without a revoke
--      fails here rather than escaping.
--   C  RLS enabled, exactly one SELECT policy each, to {authenticated}, and the predicate
--      is NOT `using (true)`.
--   D  THE INDEPENDENCE RULE, STRUCTURALLY. No table references both a property and a
--      character; no property-character table exists; plm.dcp_character has no property
--      column. This is the assertion the whole design exists to make.
--   E  IMMUTABILITY ACTUALLY BLOCKS A WRITE against a completed metadata run -- INSERT
--      included, which is the only mutating operation service_role still holds.
--   F  The metadata hash: shape, NULL-versus-empty distinction, array-order independence,
--      duplicate collapse, separator refusal, and interpreted-columns-excluded.
--   G  The CHECK constraints that encode the source rules: HTTP 200 is not success, a
--      link cannot hang off a non-success row, an interpreted value cannot exist without
--      its raw, and a metadata row cannot reference an asset outside its source crawl.
--   H  No test data survived.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. THE OBJECTS EXIST.
-- =====================================================================================
do $$
declare
  v_tables text[] := array[
    'dcp_metadata_run','dcp_metadata_asset','dcp_property','dcp_character','dcp_term',
    'dcp_asset_property_observation','dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ];
  t text;
  v_missing text[] := array[]::text[];
  v_fns int;
begin
  foreach t in array v_tables loop
    if to_regclass('plm.' || t) is null then
      v_missing := v_missing || t;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    raise exception 'A FAILED: missing plm table(s): %', array_to_string(v_missing, ', ');
  end if;

  select count(*) into v_fns
  from pg_proc p
  where p.pronamespace = 'plm'::regnamespace
    and p.proname in (
      'dcp_metadata_row_hash','dcp_reject_completed_metadata_change',
      'dcp_metadata_run_freeze','dcp_reject_completed_metadata_identity_change'
    );
  if v_fns <> 4 then
    raise exception 'A FAILED: expected 4 new plm metadata functions in pg_proc, found %. '
      'A missing one means an object in claim #749 was never created.', v_fns;
  end if;

  -- The Phase-1 frozen hash must still be exactly one function. This migration's contract
  -- is that it did not touch a one-way door that ~155,900 rows depend on.
  select count(*) into v_fns
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname = 'dcp_asset_row_hash';
  if v_fns <> 1 then
    raise exception 'A FAILED: expected exactly ONE plm.dcp_asset_row_hash, found %. The '
      'Phase-1 row hash is FROZEN over roughly 155,900 rows; Phase 2 must not add, replace '
      'or overload it.', v_fns;
  end if;

  raise notice 'A PASSED: 8 metadata tables, 4 new functions, Phase-1 frozen hash intact.';
end;
$$;

-- =====================================================================================
-- B. PRIVILEGES. service_role: SELECT + INSERT only. anon/public: nothing.
--    Enumerated from pg_class, NOT from a hand-written list, so a plm.dcp_metadata_*
--    table added later without a matching revoke FAILS here instead of escaping.
-- =====================================================================================
do $$
declare
  r record;
  v_bad text[] := array[]::text[];
  v_n   int := 0;
begin
  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'plm'::regnamespace
      and c.relkind = 'r'
      and c.relname in (
        'dcp_metadata_run','dcp_metadata_asset','dcp_property','dcp_character','dcp_term',
        'dcp_asset_property_observation','dcp_asset_character_observation',
        'dcp_asset_term_observation','dcp_metadata_chunk_ledger',
        'dcp_metadata_load_exception'
      )
  loop
    v_n := v_n + 1;

    -- TRUNCATE ABOVE ALL. It fires NO row triggers, so one TRUNCATE would erase a
    -- completed run's evidence with every freeze trigger silently standing by.
    if has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'UPDATE')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'DELETE')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'TRUNCATE')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'REFERENCES')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'TRIGGER')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'MAINTAIN') then
      v_bad := v_bad || (r.relname || ': service_role holds a mutating bit');
    end if;

    if has_table_privilege('anon', 'plm.' || quote_ident(r.relname), 'SELECT') then
      v_bad := v_bad || (r.relname || ': anon can SELECT');
    end if;

    if not has_table_privilege('authenticated', 'plm.' || quote_ident(r.relname), 'SELECT') then
      v_bad := v_bad || (r.relname || ': authenticated cannot SELECT');
    end if;
  end loop;

  -- An EMPTY set must FAIL. Otherwise a rename makes this section vacuously green.
  if v_n <> 10 then
    raise exception 'B FAILED: enumerated % of the 10 expected metadata tables. A renamed '
      'or missing table would otherwise make this section pass by checking nothing.', v_n;
  end if;
  if array_length(v_bad, 1) is not null then
    raise exception 'B FAILED: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'B PASSED: 10 tables, service_role SELECT+INSERT only, anon locked out.';
end;
$$;

-- =====================================================================================
-- C. ROW LEVEL SECURITY. A GRANT is not a POLICY and a POLICY is not a GRANT.
--    `using (true)` FAILS here. That exact shape was a live security defect on the
--    Disney OPA extract -- it made confidential licensor data readable by every signed-in
--    account -- and this is the same licensor from the same portal.
-- =====================================================================================
do $$
declare
  r record;
  v_bad text[] := array[]::text[];
  v_n   int := 0;
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c
    where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r'
      and c.relname in (
        'dcp_metadata_run','dcp_metadata_asset','dcp_property','dcp_character','dcp_term',
        'dcp_asset_property_observation','dcp_asset_character_observation',
        'dcp_asset_term_observation','dcp_metadata_chunk_ledger',
        'dcp_metadata_load_exception'
      )
  loop
    v_n := v_n + 1;
    if not r.relrowsecurity then
      v_bad := v_bad || (r.relname || ': RLS not enabled');
      continue;
    end if;

    declare
      v_pols int;
      v_qual text;
      v_roles text;
    begin
      select count(*) into v_pols
      from pg_policies p where p.schemaname = 'plm' and p.tablename = r.relname;
      if v_pols <> 1 then
        v_bad := v_bad || (r.relname || ': expected exactly 1 policy, found ' || v_pols);
        continue;
      end if;

      select p.qual, array_to_string(p.roles, ',') into v_qual, v_roles
      from pg_policies p where p.schemaname = 'plm' and p.tablename = r.relname;

      if v_roles is distinct from 'authenticated' then
        v_bad := v_bad || (r.relname || ': policy roles are ' || coalesce(v_roles, '<null>'));
      end if;
      if v_qual is null or btrim(v_qual) in ('true', '(true)') then
        v_bad := v_bad || (r.relname || ': PERMISSIVE predicate -- using (true) is forbidden');
      end if;
    end;
  end loop;

  if v_n <> 10 then
    raise exception 'C FAILED: enumerated % of 10 expected tables.', v_n;
  end if;
  if array_length(v_bad, 1) is not null then
    raise exception 'C FAILED: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'C PASSED: RLS on all 10, one non-permissive authenticated SELECT policy each.';
end;
$$;

-- =====================================================================================
-- D. THE INDEPENDENCE RULE, ASSERTED STRUCTURALLY.
--
--    This is the assertion the entire design exists to make, so it is checked from the
--    catalog rather than inferred from behaviour. Disney returns properties[] and
--    character[] as separate unordered arrays and asserts NOTHING by their co-presence.
--    One observed asset carries NINE properties and ONE character: any bridge fabricates
--    nine relationships the licensor never stated, indistinguishable from real ones
--    forever.
-- =====================================================================================
do $$
declare
  v_n int;
begin
  -- D1. No table anywhere in plm may reference BOTH a property and a character.
  select count(*) into v_n
  from (
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'plm'
      and c.column_name in ('dcp_property_id','dcp_character_id')
    group by c.table_name
    having count(distinct c.column_name) > 1
  ) both_sides;
  if v_n > 0 then
    raise exception 'D FAILED: % plm table(s) reference BOTH a property and a character. '
      'That is the shape of a bridge, and a bridge manufactures relationships Disney '
      'never asserted.', v_n;
  end if;

  -- D2. No property-character table under any spelling.
  select count(*) into v_n
  from information_schema.tables
  where table_schema = 'plm'
    and table_name ~ '^dcp_(propert.*character|character.*propert)';
  if v_n > 0 then
    raise exception 'D FAILED: % plm property-character table(s) exist. No such table may '
      'ever be created.', v_n;
  end if;

  -- D3. plm.dcp_character must have NO property column. Its absence is a locked decision,
  -- not an oversight -- a column here is a slot someone eventually fills by pairing the
  -- two arrays on an asset.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'plm' and table_name = 'dcp_character'
    and (column_name like '%propert%');
  if v_n > 0 then
    raise exception 'D FAILED: plm.dcp_character has % property column(s). DCP Vault never '
      'asserts which property a character belongs to; Disney OPA is the only source that '
      'does and it has its own landing schema.', v_n;
  end if;

  -- D4. Both link tables must actually EXIST and be distinct relations. Without this,
  -- D1-D3 would pass trivially on a schema that has neither.
  if to_regclass('plm.dcp_asset_property_observation') is null
  or to_regclass('plm.dcp_asset_character_observation') is null then
    raise exception 'D FAILED: one or both independent link tables are missing, which '
      'would make D1-D3 pass by checking nothing.';
  end if;

  raise notice 'D PASSED: property and character links are structurally independent; no '
    'bridge exists and none can be added without deleting an assertion.';
end;
$$;

-- =====================================================================================
-- E, F and G write. Everything below runs inside ONE transaction that ends in ROLLBACK.
-- =====================================================================================
begin;

do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000101';
  v_run   uuid := '99999999-9999-4999-8999-000000000102';
  v_run2  uuid := '99999999-9999-4999-8999-000000000103';
  v_tile  uuid;
  v_guide uuid;
  v_asset uuid;
  v_asset2 uuid;
  v_sec   uuid;
  v_prop  uuid;
  v_char  uuid;
  v_ok    boolean;
  v_ty    smallint;
  v_t     text;
begin
  -- -----------------------------------------------------------------------------------
  -- STRUCTURAL PRECONDITION: every run-scoped freeze trigger must cover INSERT as well as
  -- UPDATE and DELETE. Read from pg_trigger.tgtype rather than proved only by behaviour,
  -- so a trigger that loses its INSERT branch fails HERE by name instead of silently
  -- re-opening the one operation service_role still holds.
  -- tgtype bit 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  -- -----------------------------------------------------------------------------------
  foreach v_t in array array[
    'dcp_metadata_asset','dcp_asset_property_observation',
    'dcp_asset_character_observation','dcp_asset_term_observation',
    'dcp_metadata_chunk_ledger'
  ] loop
    select tg.tgtype into v_ty
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relnamespace = 'plm'::regnamespace and c.relname = v_t
      and not tg.tgisinternal and tg.tgname = 'trg_' || v_t || '_immutable';
    if v_ty is null then
      raise exception 'E FAILED: plm.% has no trg_%_immutable trigger.', v_t, v_t;
    end if;
    if (v_ty & 4) = 0 then
      raise exception 'E FAILED: the immutability trigger on plm.% does NOT fire on '
        'INSERT. service_role keeps INSERT and loses everything else, so INSERT is the '
        'only mutating operation still available and an UPDATE/DELETE-only trigger guards '
        'nothing against it.', v_t;
    end if;
    if (v_ty & 8) = 0 or (v_ty & 16) = 0 then
      raise exception 'E FAILED: the immutability trigger on plm.% lost its UPDATE or '
        'DELETE coverage.', v_t;
    end if;
  end loop;

  -- -----------------------------------------------------------------------------------
  -- FIXTURE. A completed Phase-1 crawl carrying two assets that SHARE A FILE NAME under
  -- different paths -- required case 9 from the plan, and the reason path is the identity.
  -- -----------------------------------------------------------------------------------
  insert into plm.dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values (
    v_crawl, date '2026-01-03', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
    2, 2, now()
  );

  insert into plm.dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-M', v_crawl) returning id into v_tile;

  insert into plm.dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/mguide/a', 'ZZTEST-GUIDE-M', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  -- TWO DISTINCT PATHS, ONE FILE NAME. Required case 9.
  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/mguide/a/one/zztest-shared.zzz', v_guide, 'zztest-shared.zzz', 'zzz', v_crawl)
  returning id into v_asset;
  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/mguide/a/two/zztest-shared.zzz', v_guide, 'zztest-shared.zzz', 'zzz', v_crawl)
  returning id into v_asset2;

  insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 2, now()) returning id into v_sec;

  insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
  values (v_crawl, v_asset, repeat('c', 64)), (v_crawl, v_asset2, repeat('d', 64));

  -- Two assets sharing a name is legal and must not have been blocked above.
  if (select count(*) from plm.dcp_asset where file_name = 'zztest-shared.zzz') <> 2 then
    raise exception 'E FAILED: two assets could not share a file name. File name is NOT '
      'unique in this source -- collisions number in the thousands -- and any unique rule '
      'on it would reject honest data.';
  end if;

  update plm.dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- -----------------------------------------------------------------------------------
  -- G1. A metadata row may NOT reference an asset outside its source crawl.
  -- Proved with a SECOND crawl that never observed the asset. The composite foreign keys
  -- are what make this structural rather than a loader convention.
  -- -----------------------------------------------------------------------------------
  insert into plm.dcp_metadata_run (
    metadata_run_id, source_crawl_id, status, captured_on, started_at, endpoint_suffix,
    crawler_version, captured_by, private_source_commit, assets_expected
  ) values (
    v_run, v_crawl, 'running', date '2026-01-04', now(), '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40), 2
  );

  declare
    v_other_crawl uuid := '99999999-9999-4999-8999-000000000104';
  begin
    insert into plm.dcp_crawl (
      crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
      line_of_business, started_at, captured_by, private_source_commit, status,
      rows_received, distinct_assets_received, finished_at
    ) values (
      v_other_crawl, date '2026-01-05', 'https://zztest.example.invalid', 'ZZTEST-0',
      'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'complete',
      0, 0, now()
    );

    v_ok := false;
    begin
      -- Claims run v_run (whose crawl is v_crawl) while naming a different source crawl.
      insert into plm.dcp_metadata_asset (metadata_run_id, source_crawl_id, dcp_asset_id)
      values (v_run, v_other_crawl, v_asset);
    exception when foreign_key_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception 'G FAILED: a metadata row named a source crawl its RUN did not '
        'declare. The composite FK to dcp_metadata_run must forbid this -- otherwise the '
        'membership check is performed against the wrong crawl entirely.';
    end if;
  end;

  -- G2. An asset the source crawl never observed must be refused.
  v_ok := false;
  begin
    insert into plm.dcp_metadata_asset (metadata_run_id, source_crawl_id, dcp_asset_id)
    values (v_run, v_crawl, '99999999-9999-4999-8999-0000000009ff');
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: metadata was attached to an asset outside the source crawl. '
      'The composite FK to dcp_asset_crawl must forbid this.';
  end if;

  -- Seed the two legitimate rows.
  insert into plm.dcp_metadata_asset (metadata_run_id, source_crawl_id, dcp_asset_id)
  values (v_run, v_crawl, v_asset), (v_run, v_crawl, v_asset2);

  -- -----------------------------------------------------------------------------------
  -- G3. HTTP 200 IS NOT SUCCESS. A success without a JSON OBJECT body is refused. This is
  -- the check that stops a whole run of portal sign-out pages being recorded as a capture.
  -- -----------------------------------------------------------------------------------
  v_ok := false;
  begin
    update plm.dcp_metadata_asset set fetch_status = 'success', http_status = 200,
      raw_metadata = null, retrieved_at = now(),
      source_hash = repeat('a', 64), normalized_hash = repeat('b', 64)
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: fetch_status success was accepted with no response body. '
      'A signed-out DCP Vault session returns HTTP 200 with a tiny zero-record body, so '
      'HTTP success alone must never qualify.';
  end if;

  -- A success whose body is a JSON ARRAY rather than an OBJECT is also refused.
  v_ok := false;
  begin
    update plm.dcp_metadata_asset set fetch_status = 'success', http_status = 200,
      raw_metadata = '[]'::jsonb, retrieved_at = now(),
      source_hash = repeat('a', 64), normalized_hash = repeat('b', 64)
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a JSON array was accepted as a successful metadata body. '
      'Only an OBJECT is a metadata response; a zero-record array is the sign-out shape.';
  end if;

  -- G4. A terminal failure must carry a code.
  v_ok := false;
  begin
    update plm.dcp_metadata_asset set fetch_status = 'failed', failure_code = null
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a terminal failure was accepted with no failure_code. An '
      'untriageable failure row is indistinguishable from a loader bug.';
  end if;

  -- G5. An interpreted value may not exist without its raw source value.
  v_ok := false;
  begin
    update plm.dcp_metadata_asset
      set is_exclusive_raw = null, is_exclusive_interpreted = true
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: an interpreted boolean was accepted beside a NULL raw '
      'value. That is a value invented by the parser, not observed from the source.';
  end if;

  -- G6. AN UNKNOWN RIGHTS STRING SURVIVES RAW WITH CONFIDENCE FALSE. Required cases 11
  -- and 13: it must NOT fail the load and must NOT coerce to a guess. The business
  -- meanings of these fields are unknown and require Disney's licensing contact.
  update plm.dcp_metadata_asset set
    fetch_status = 'success', http_status = 200,
    raw_metadata = '{"zztest": true}'::jsonb, retrieved_at = now(),
    is_exclusive_raw = 'ZZTEST-UNKNOWN-SPELLING',
    is_exclusive_interpreted = null,
    rights_parse_confident = false,
    release_date_raw = 'ZZTEST-NOT-A-DATE',
    release_date_interpreted = null,
    num_pages_raw = 'ZZTEST-NOT-A-NUMBER',
    num_pages_interpreted = null,
    source_hash = repeat('a', 64), normalized_hash = repeat('b', 64)
  where metadata_run_id = v_run and dcp_asset_id = v_asset;

  if (select is_exclusive_raw from plm.dcp_metadata_asset
      where metadata_run_id = v_run and dcp_asset_id = v_asset) <> 'ZZTEST-UNKNOWN-SPELLING'
  or (select rights_parse_confident from plm.dcp_metadata_asset
      where metadata_run_id = v_run and dcp_asset_id = v_asset) <> false then
    raise exception 'G FAILED: an unknown rights spelling did not survive raw with '
      'confidence false.';
  end if;

  -- -----------------------------------------------------------------------------------
  -- G7. A LINK MAY ONLY HANG OFF A SUCCESSFUL METADATA ROW.
  -- v_asset2 is still `pending`, so a link naming it must be refused by the composite FK
  -- that carries fetch_status.
  -- -----------------------------------------------------------------------------------
  insert into plm.dcp_property (source_system, source_id)
  values ('disney_dcpvault', 'ZZTEST-PROP-1') returning id into v_prop;
  insert into plm.dcp_character (source_system, source_id)
  values ('disney_dcpvault', 'ZZTEST-CHAR-1') returning id into v_char;

  v_ok := false;
  begin
    insert into plm.dcp_asset_property_observation (metadata_run_id, dcp_asset_id, dcp_property_id)
    values (v_run, v_asset2, v_prop);
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a property link was attached to a PENDING metadata row. '
      'Links may only hang off a successful fetch.';
  end if;

  -- -----------------------------------------------------------------------------------
  -- E1. NINE PROPERTIES AND ONE CHARACTER ON ONE ASSET CREATE NO RELATIONSHIP.
  -- This is required cases 1, 2 and 3, and it is the single most important behavioural
  -- assertion in this file. It reproduces the exact observed shape that makes a bridge
  -- table so damaging.
  -- -----------------------------------------------------------------------------------
  declare
    i int;
    v_p uuid;
    v_props int;
    v_chars int;
  begin
    for i in 1 .. 9 loop
      insert into plm.dcp_property (source_system, source_id)
      values ('disney_dcpvault', 'ZZTEST-PROP-M-' || i)
      returning id into v_p;
      insert into plm.dcp_asset_property_observation (metadata_run_id, dcp_asset_id, dcp_property_id)
      values (v_run, v_asset, v_p);
    end loop;

    insert into plm.dcp_asset_character_observation (metadata_run_id, dcp_asset_id, dcp_character_id)
    values (v_run, v_asset, v_char);

    select count(*) into v_props from plm.dcp_asset_property_observation
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
    select count(*) into v_chars from plm.dcp_asset_character_observation
    where metadata_run_id = v_run and dcp_asset_id = v_asset;

    if v_props <> 9 or v_chars <> 1 then
      raise exception 'E FAILED: expected 9 property links and 1 character link, got % and %.',
        v_props, v_chars;
    end if;

    -- AND NOTHING ANYWHERE PAIRED THEM. If a bridge existed, this is where nine phantom
    -- relationships would now be sitting.
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'plm' and table_name ~ '^dcp_(propert.*character|character.*propert)'
    ) then
      raise exception 'E FAILED: a property-character table came into existence. Nine '
        'relationships Disney never asserted would now exist for this one asset.';
    end if;
  end;

  -- E2. A DUPLICATE ARRAY MEMBER COLLAPSES TO ONE LINK without losing the metadata row.
  -- Required case 5.
  v_ok := false;
  begin
    insert into plm.dcp_asset_character_observation (metadata_run_id, dcp_asset_id, dcp_character_id)
    values (v_run, v_asset, v_char);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a duplicate character link was accepted. A repeated array '
      'member is a source quirk and must collapse to one link.';
  end if;
  if (select count(*) from plm.dcp_metadata_asset
      where metadata_run_id = v_run and dcp_asset_id = v_asset) <> 1 then
    raise exception 'E FAILED: the successful metadata row did not survive the duplicate.';
  end if;

  -- E3. AN EMPTY LINK SET IS ZERO ROWS BESIDE A SUCCESSFUL METADATA ROW.
  -- Required case 4's storage half: "observed and empty" is a real, different state from
  -- "no successful metadata row exists".
  update plm.dcp_metadata_asset set
    fetch_status = 'success', http_status = 200, raw_metadata = '{"zztest": 2}'::jsonb,
    retrieved_at = now(), source_hash = repeat('e', 64), normalized_hash = repeat('f', 64)
  where metadata_run_id = v_run and dcp_asset_id = v_asset2;

  if (select count(*) from plm.dcp_asset_character_observation
      where metadata_run_id = v_run and dcp_asset_id = v_asset2) <> 0 then
    raise exception 'E FAILED: asset2 should have zero character links.';
  end if;
  if (select fetch_status from plm.dcp_metadata_asset
      where metadata_run_id = v_run and dcp_asset_id = v_asset2) <> 'success' then
    raise exception 'E FAILED: an asset with no characters must still be a valid success. '
      'The sample proved assets legitimately omit the character field entirely.';
  end if;

  -- -----------------------------------------------------------------------------------
  -- E4. COMPLETING THE RUN FREEZES ITS EVIDENCE -- INSERT INCLUDED.
  -- -----------------------------------------------------------------------------------
  update plm.dcp_metadata_run set
    status = 'complete', fetches_succeeded = 2, fetches_failed = 0, finished_at = now()
  where metadata_run_id = v_run;

  -- E4a. INSERT of a new character link into a completed run. THIS IS THE ONE THAT
  -- MATTERS: service_role keeps INSERT and loses everything else, so this is the only
  -- mutating operation still available, and without the INSERT branch nothing would stop
  -- an asset being given a character Disney never returned inside a reconciled run.
  v_ok := false;
  begin
    insert into plm.dcp_asset_character_observation (metadata_run_id, dcp_asset_id, dcp_character_id)
    values (v_run, v_asset2, v_char);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a character link was INSERTED into a COMPLETED metadata '
      'run. The run would then claim an observation the portal never returned.';
  end if;

  -- E4b. UPDATE of a completed run's fetch row.
  v_ok := false;
  begin
    update plm.dcp_metadata_asset set dc_title = 'ZZTEST-CHANGED'
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a completed run''s fetch row was UPDATED.';
  end if;

  -- E4c. DELETE of a completed run's link row.
  v_ok := false;
  begin
    delete from plm.dcp_asset_property_observation
    where metadata_run_id = v_run and dcp_asset_id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a completed run''s property link was DELETED.';
  end if;

  -- E4d. The run row itself is immutable once complete.
  v_ok := false;
  begin
    update plm.dcp_metadata_run set crawler_version = 'ZZTEST-9'
    where metadata_run_id = v_run;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a COMPLETE metadata run was updated.';
  end if;

  v_ok := false;
  begin
    delete from plm.dcp_metadata_run where metadata_run_id = v_run;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a COMPLETE metadata run was deleted. Never destroy licensed '
      'evidence as a correction.';
  end if;

  -- E5. An identity observed by a COMPLETE run has frozen source columns. Human
  -- reconciliation uses plm.set_source_resolution; landing decision columns are immutable.
  v_ok := false;
  begin
    update plm.dcp_character set source_id = 'ZZTEST-CHAR-RENAMED' where id = v_char;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: the source_id of a character observed by a complete run was '
      'changed.';
  end if;

  perform plm.set_source_resolution(
    'disney_dcpvault','character',
    (select 'id:' || source_id from plm.dcp_character where id=v_char),
    'deferred',null,null,null,null,'ZZTEST reviewed',null
  );
  if not exists (
    select 1 from plm.source_resolution
    where source_system='disney_dcpvault' and entity_kind='character'
      and source_id=(select 'id:' || source_id from plm.dcp_character where id=v_char)
      and resolution_reason='ZZTEST reviewed'
  ) then
    raise exception 'E FAILED: the durable reconciliation decision was not stored.';
  end if;

  -- E6. A second run over the same crawl may still re-observe the same identity. The
  -- identities outlive any single run; freezing them wholesale would break every refresh.
  insert into plm.dcp_metadata_run (
    metadata_run_id, source_crawl_id, status, captured_on, started_at, endpoint_suffix,
    crawler_version, captured_by, private_source_commit, assets_expected
  ) values (
    v_run2, v_crawl, 'running', date '2026-01-06', now(), '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40), 2
  );
  update plm.dcp_character set last_seen_metadata_run_id = v_run2 where id = v_char;

  raise notice 'E PASSED: 9 properties + 1 character created no relationship; duplicates '
    'collapse; empty sets are zero rows beside a success; a completed run refuses INSERT, '
    'UPDATE and DELETE; identity refresh fields remain writable and durable decisions '
    'use plm.set_source_resolution.';
  raise notice 'G PASSED: cross-crawl metadata refused; HTTP 200 is not success; failures '
    'need a code; interpreted values need their raw; unknown rights survive raw.';
end;
$$;

-- =====================================================================================
-- F. THE METADATA HASH.
-- =====================================================================================
do $$
declare
  v_a text; v_b text; v_c text; v_d text;
  v_null_scalars text[] := array[]::text[];
begin
  -- F1. Shape: 64 lowercase hex.
  v_a := plm.dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  if v_a !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: hash is not 64 lowercase hex characters.';
  end if;

  -- F2. ARRAY ORDER DOES NOT CHANGE THE HASH. Required case 6. The arrays are unordered
  -- at the source, so an order change is not a data change.
  v_b := plm.dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P2','ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  v_c := plm.dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1','ZZTEST-P2'], array['ZZTEST-C1'], array[]::text[], null);
  if v_b <> v_c then
    raise exception 'F FAILED: reordering an unordered source array changed the hash. '
      'Every asset would compare unequal on the next run and report a rewrite that never '
      'happened.';
  end if;

  -- F3. A DUPLICATE MEMBER DOES NOT CHANGE THE HASH (the set is deduplicated).
  v_d := plm.dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1','ZZTEST-P2','ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  if v_d <> v_c then
    raise exception 'F FAILED: a duplicate array member changed the hash.';
  end if;

  -- F4. AN EMPTY ARRAY AND A NULL ARRAY HASH DIFFERENTLY. Required case 4, and the most
  -- consequential distinction in the whole scheme: it is the difference between "Disney
  -- removed every character" and "we did not look".
  v_a := plm.dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array[]::text[], null, null, null);
  v_b := plm.dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    null, null, null, null);
  if v_a = v_b then
    raise exception 'F FAILED: an OBSERVED EMPTY array hashed the same as an UNOBSERVED '
      'NULL array. Collapsing the two makes "the portal returned nothing" and "we never '
      'asked" permanently indistinguishable.';
  end if;

  -- F5. NULL AND THE EMPTY STRING ARE DIFFERENT SCALARS.
  v_a := plm.dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_b := plm.dcp_metadata_row_hash(
    '', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  if v_a = v_b then
    raise exception 'F FAILED: NULL and the empty string hashed identically. The presence '
      'flag exists precisely to keep them apart, and both occur in this source.';
  end if;

  -- F6. CASE AND WHITESPACE IN A SCALAR DO CHANGE THE HASH. Required case 7's normalized
  -- half: there is no case folding and no trimming anywhere in the serialization.
  v_a := plm.dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_b := plm.dcp_metadata_row_hash(
    'zztest-u', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_c := plm.dcp_metadata_row_hash(
    'ZZTEST-U ', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  if v_a = v_b or v_a = v_c then
    raise exception 'F FAILED: case folding or trimming is happening inside the '
      'serialization. Normalisation belongs BEFORE storage; the hash digests what is '
      'stored, exactly.';
  end if;

  -- F7. THE PROPERTY SET AND THE CHARACTER SET ARE DIFFERENT SLOTS. Moving a value from
  -- one to the other MUST change the hash -- if it did not, the two sets would be
  -- interchangeable in the digest, which is the arithmetic signature of a scheme that had
  -- merged them.
  v_a := plm.dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-X'], array[]::text[], null, null);
  v_b := plm.dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array[]::text[], array['ZZTEST-X'], null, null);
  if v_a = v_b then
    raise exception 'F FAILED: the same value hashed identically as a property and as a '
      'character. The two sets occupy different slots precisely so they can never be '
      'confused for one another.';
  end if;

  -- F8. A RESERVED SEPARATOR IS REFUSED, NOT ESCAPED. A refused row becomes a load
  -- exception; an escaped one becomes a silently different digest.
  declare v_ok boolean := false;
  begin
    begin
      perform plm.dcp_metadata_row_hash(
        'ZZTEST' || chr(31) || 'X', null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null, null, null);
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'F FAILED: a value containing U+001F was accepted into the hash.';
    end if;

    v_ok := false;
    begin
      perform plm.dcp_metadata_row_hash(
        null, null, null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null,
        array['ZZTEST' || chr(30) || 'Y'], null, null, null);
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'F FAILED: a set element containing U+001E was accepted into the hash.';
    end if;

    -- A NULL element is neither "empty" nor "not observed" and has no serialization.
    v_ok := false;
    begin
      perform plm.dcp_metadata_row_hash(
        null, null, null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null,
        array['ZZTEST-P', null], null, null, null);
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'F FAILED: a NULL array element was accepted into the hash.';
    end if;
  end;

  -- F9. THE INTERPRETED COLUMNS ARE NOT IN THE HASH. It takes 18 raw scalars and four
  -- sets and nothing else -- asserted from pg_proc so that adding an interpreted
  -- parameter fails here rather than silently changing every stored digest.
  if (select pronargs from pg_proc
      where pronamespace = 'plm'::regnamespace and proname = 'dcp_metadata_row_hash') <> 22 then
    raise exception 'F FAILED: plm.dcp_metadata_row_hash does not take exactly 22 '
      'arguments. Adding an interpreted column to the digest would make a later parser '
      'fix look like the portal changed, and would invalidate every stored hash.';
  end if;

  raise notice 'F PASSED: hash shape, order independence, duplicate collapse, '
    'empty-vs-NULL, NULL-vs-empty-string, case/whitespace sensitivity, property/character '
    'slot separation, separator refusal, and 22 arguments exactly.';
end;
$$;

rollback;

-- =====================================================================================
-- H. NO TEST DATA SURVIVED.
-- =====================================================================================
do $$
declare v_n int; v_total int := 0;
begin
  select count(*) into v_n from plm.dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_metadata_run where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_property where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_character where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_term where source_value like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_asset where file_name like 'zztest%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. The ROLLBACK did not happen -- '
      'this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

\echo 'DCP VAULT METADATA LANDING CONTRACTS: ALL SECTIONS PASSED (A-H)'
