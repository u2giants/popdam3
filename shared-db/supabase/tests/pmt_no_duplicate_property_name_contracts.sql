-- =====================================================================================
-- Paramount duplicate property-name contracts -- migration 20260814193351, issue #964,
-- plan_pmt-duplicate-name-columns.md.
--
-- THIS FILE ASSERTS THE INTERIM (PRE-DROP) STATE. It ships in the SAME change as
-- 20260814193351 and BEFORE the plan's Step 6 drop migration, so it asserts:
--   * both deprecated columns still EXIST but are nullable, unwritten and commented;
--   * plm.load_pmt_capture_chunk no longer writes either copy (behaviourally);
--   * the property name is reachable by join from both tables;
--   * no OTHER pmt_* table reintroduces a property-name column.
-- When the Step 6 drop migration lands, its PR MUST update this file: sections A and D
-- switch to asserting the columns do not exist, and section D's two-column allowlist is
-- deleted. Until then the allowlist below names EXACTLY the two deprecated columns and
-- nothing else may match.
--
-- WHY THE DROP HAS NOT HAPPENED. Plan Step 1 (duplicate attribute vs. genuinely distinct
-- fact -- e.g. is pmt_property_capture_log.property_name the search string the portal
-- displayed?) turns on the private capture builder in u2giants/licensor-source-data and
-- per-capture sampling, which the authoring session could not read. Dropping or renaming
-- waits for that evidence; see the plan's STATUS table.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqmsyel (or the CI ephemeral database) as the migration
--   owner (the Supabase CLI's linked connection, or a psql / node-pg session running as
--   postgres / supabase_admin -- plm.pmt_loader_privilege_ok rejects every other
--   session_user, by design):
--       \i supabase/tests/pmt_no_duplicate_property_name_contracts.sql
--
--   RUN EACH `do $$` BLOCK AS A SEPARATE STATEMENT. Submitting the whole file as one
--   multi-statement batch through the transaction pooler (port 6543) wraps every block
--   in one implicit transaction and stalls -- observed on this database family
--   2026-08-09. psql's \i does the right thing; a programmatic runner must split on the
--   `do $$` boundaries.
--
--   NOTE for preview: section C opens a synthetic capture via plm.begin_pmt_capture,
--   which REFUSES to run while any real capture is loading or validating. If a real
--   Paramount capture is in flight, run this file after it finishes. That refusal is the
--   loader's own guard, not a defect in this file.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one Paramount title, property, character,
--   collection, brand, franchise, asset ID, filename or relationship row appears here.
--   The fixtures use ZZTEST-* tokens and example.invalid so a real row could never be
--   mistaken for one of them. Source IDs are invented numeric strings ('99001',
--   '99002') because every plm.pmt_* source id is TEXT pinned ^[0-9]+$ by CHECK since
--   20260811030000.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   Every assertion checks an OBJECT or a BEHAVIOUR. None of them reads
--   supabase_migrations.schema_migrations. "It applied" is not accepted as evidence that
--   anything happened.
--
--   The function-body assertions deliberately do NOT use a bare '%property_name%' match:
--   the pmt_property entity branch legitimately writes property_name, and a naive match
--   false-positives on it. The precise shapes are the two DUPLICATE-writing spots the
--   migration removed -- see section B.
--
-- SIDE EFFECTS
--   Creates and then DELETES one synthetic capture_kind='test' capture and its rows
--   (section C). It writes nothing to core.*, dam.* or any other schema.
--
-- LAST RUN: (fill in after the preview rehearsal)
-- =====================================================================================


-- =====================================================================================
-- A. INTERIM DEPRECATION STATE. Both columns exist, are nullable, carry the deprecation
--    comment, keep their btrim CHECKs (they still hold for non-null values), and the
--    index that invited lookups against the copy is gone.
-- =====================================================================================
do $$
declare
  r record;
  v_text text;
  v_n integer;
  v_pass integer := 0; v_fail integer := 0;
begin
  raise notice '=== A. INTERIM DEPRECATION STATE ===';

  for r in
    select table_name, column_name from (values
      ('pmt_authorized_title_property', 'paramount_property_name'),
      ('pmt_property_capture_log',      'property_name')
    ) as v(table_name, column_name)
  loop
    select c.is_nullable into v_text
    from information_schema.columns c
    where c.table_schema = 'plm' and c.table_name = r.table_name and c.column_name = r.column_name;
    if v_text = 'YES' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; raise warning 'FAIL %.% missing or still NOT NULL', r.table_name, r.column_name;
    end if;

    select col_description(format('plm.%I', r.table_name)::regclass, a.attnum) into v_text
    from pg_attribute a
    where a.attrelid = format('plm.%I', r.table_name)::regclass
      and a.attname = r.column_name and not a.attisdropped;
    if v_text ilike 'DEPRECATED%20260814193351%duplicate of plm.pmt_property.property_name%'
    then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; raise warning 'FAIL %.% deprecation comment missing or malformed', r.table_name, r.column_name;
    end if;
  end loop;

  -- The btrim CHECKs survive the deprecation; they drop with the column in Step 6.
  select count(*) into v_n from pg_constraint
  where conrelid = 'plm.pmt_authorized_title_property'::regclass
    and conname = 'pmt_authorized_title_property_name_chk';
  if v_n = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise warning 'FAIL pmt_authorized_title_property_name_chk missing'; end if;

  select count(*) into v_n from pg_constraint
  where conrelid = 'plm.pmt_property_capture_log'::regclass
    and conname = 'pmt_pcl_name_chk';
  if v_n = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise warning 'FAIL pmt_pcl_name_chk missing'; end if;

  -- The index on the copy is gone: nothing should be encouraged to look the name up there.
  select count(*) into v_n from pg_indexes
  where schemaname = 'plm' and indexname = 'idx_pmt_atp_name';
  if v_n = 0 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise warning 'FAIL idx_pmt_atp_name still exists'; end if;

  raise notice 'A: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'A FAILED (%)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- B. THE LIVE LOADER FUNCTION WRITES NEITHER COPY. PL/pgSQL resolves INSERT-list column
--    references at CALL time, so a stale body that still names a column "compiles" and
--    then breaks the next capture. The two DUPLICATE-writing shapes must be absent, and
--    the entity branch's LEGITIMATE property_name write -- the single place the name is
--    stored from now on -- must still be there, along with the security posture.
-- =====================================================================================
do $$
declare
  d      text := pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc);
  d_norm text := regexp_replace(pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc),
                                '[[:space:]]+', ' ', 'g');
  d_low  text := lower(pg_get_functiondef('plm.load_pmt_capture_chunk'::regproc));
  v_search_path_config text;
begin
  raise notice '=== B. LIVE load_pmt_capture_chunk BODY ===';

  if position('paramount_property_name' in d) <> 0 then
    raise exception 'B FAILED: the live body still names paramount_property_name';
  end if;

  -- 'property_name, reported_asset_count' occurs ONLY in the old capture-log INSERT
  -- list. The entity branch writes 'property_name, is_licensed_selection' and must keep
  -- it -- that adjacency is asserted present further down.
  if position('property_name, reported_asset_count' in d_norm) <> 0 then
    raise exception 'B FAILED: the live body still has the capture-log duplicate-name INSERT shape';
  end if;

  if position('property_name, is_licensed_selection' in d_norm) = 0 then
    raise exception 'B FAILED: the entity branch lost its legitimate property_name write';
  end if;

  if position('r->>''property_name''' in d_norm) = 0 then
    raise exception 'B FAILED: the entity branch no longer selects r->>''property_name''';
  end if;

  -- Security posture preserved from the live 20260811030000 body.
  if position('security definer' in d_low) = 0 then
    raise exception 'B FAILED: SECURITY DEFINER lost';
  end if;

  -- pg_get_functiondef normalizes SET syntax and quoting, so inspect the catalog's
  -- stored per-function setting instead of matching rendered SQL text.
  select cfg into v_search_path_config
  from pg_proc p
  cross join lateral unnest(p.proconfig) as cfg
  where p.oid = 'plm.load_pmt_capture_chunk'::regproc
    and cfg like 'search_path=%';

  if regexp_replace(coalesce(v_search_path_config, ''), '[[:space:]"]+', '', 'g')
       <> 'search_path=plm,core,public,extensions' then
    raise exception 'B FAILED: pinned search_path lost';
  end if;
  if position('not (p_target = any (c_targets))' in d) = 0 then
    raise exception 'B FAILED: fixed allow-list guard lost';
  end if;

  raise notice 'B: live body free of both duplicate-name writes; posture intact';
end;
$$;


-- =====================================================================================
-- C. BEHAVIOUR. Payloads WITHOUT either name key load cleanly; both copies land NULL;
--    the property name is reachable from BOTH tables by the join that replaces them.
--    This is the database-side half of the omission the client loader's tests pin.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_n integer;
  v_name text;
begin
  raise notice '=== C. NAME-FREE PAYLOADS LOAD; THE JOIN REPLACES THE COPIES ===';

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('1', 40),
    repeat('2', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_no_duplicate_property_name_contracts: synthetic capture, deleted at the end');

  -- The entity first: the ONE place a property name is written.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_property', $json$[
    {"property_source_id": "99001", "property_name": "ZZTEST Property One",
     "is_licensed_selection": true},
    {"property_source_id": "99002", "property_name": "ZZTEST Property Two",
     "is_licensed_selection": false}
  ]$json$);
  if v_n <> 2 then raise exception 'C FAILED: expected 2 property rows, got %', v_n; end if;

  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_authorized_title', $json$[
    {"authorized_title_key": "ZZTEST-AT-1", "authorized_title_name": "ZZTEST Title One",
     "capture_status": "captured", "resolved_property_count": 1,
     "unique_asset_count": 2, "full_metadata_count": 2, "notes": ""}
  ]$json$);
  if v_n <> 1 then raise exception 'C FAILED: expected 1 authorized title row, got %', v_n; end if;

  -- Both arrays below DELIBERATELY carry NO paramount_property_name / property_name key.
  -- That is the exact shape tools/sync-paramount-creative-library.mjs has serialized
  -- since 20260814193351: an absent key makes the DB-side r->>''...'' read NULL.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_authorized_title_property', $json$[
    {"authorized_title_key": "ZZTEST-AT-1", "property_source_id": "99001",
     "reported_asset_count": 2, "mapping_status": "mapped", "notes": ""}
  ]$json$);
  if v_n <> 1 then raise exception 'C FAILED: expected 1 title-property row, got %', v_n; end if;

  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_property_capture_log', $json$[
    {"property_source_id": "99001", "reported_asset_count": 2, "captured_asset_count": 2,
     "page_count": 1, "complete": true, "failure_message": null}
  ]$json$);
  if v_n <> 1 then raise exception 'C FAILED: expected 1 capture-log row, got %', v_n; end if;

  -- The copies land NULL ...
  select count(*) into v_n from plm.pmt_authorized_title_property
   where capture_id = v_cap and paramount_property_name is null;
  if v_n <> 1 then
    raise exception 'C FAILED: % atp rows with NULL paramount_property_name (expected 1)', v_n;
  end if;

  select count(*) into v_n from plm.pmt_property_capture_log
   where capture_id = v_cap and property_name is null;
  if v_n <> 1 then
    raise exception 'C FAILED: % capture-log rows with NULL property_name (expected 1)', v_n;
  end if;

  -- ... and the replacement path works: the name is one join away through the
  -- capture-scoped foreign keys.
  select p.property_name into v_name
  from plm.pmt_authorized_title_property a
  join plm.pmt_property p
    on p.capture_id = a.capture_id and p.property_source_id = a.property_source_id
  where a.capture_id = v_cap and a.property_source_id = '99001';
  if v_name is distinct from 'ZZTEST Property One' then
    raise exception 'C FAILED: atp join returned %', coalesce(v_name, '<null>');
  end if;

  select p.property_name into v_name
  from plm.pmt_property_capture_log l
  join plm.pmt_property p
    on p.capture_id = l.capture_id and p.property_source_id = l.property_source_id
  where l.capture_id = v_cap and l.property_source_id = '99001';
  if v_name is distinct from 'ZZTEST Property One' then
    raise exception 'C FAILED: capture-log join returned %', coalesce(v_name, '<null>');
  end if;

  -- Cleanup. The capture is still 'loading', so the immutability triggers allow this,
  -- and children are removed before their FK parents.
  delete from plm.pmt_authorized_title_property where capture_id = v_cap;
  delete from plm.pmt_property_capture_log      where capture_id = v_cap;
  delete from plm.pmt_authorized_title          where capture_id = v_cap;
  delete from plm.pmt_property                  where capture_id = v_cap;
  delete from plm.pmt_capture_expectation       where capture_id = v_cap;
  delete from plm.pmt_capture                   where capture_id = v_cap;

  raise notice 'C: name-free payloads load; copies land NULL; the joins return the entity name';
end;
$$;


-- =====================================================================================
-- D. REINTRODUCTION GUARD. No plm.pmt_* table other than pmt_property may carry a column
--    named property_name or %_property_name. This is what stops the defect coming back
--    with the next table someone adds.
--
--    INTERIM ALLOWLIST: the two columns deprecated by 20260814193351 still exist and are
--    the ONLY permitted matches. The Step 6 drop migration's PR must delete both allowlist
--    entries so the assertion becomes total.
-- =====================================================================================
do $$
declare
  r record; v_fail integer := 0; v_allowed integer := 0;
begin
  raise notice '=== D. NO pmt_* TABLE REINTRODUCES A PROPERTY-NAME COLUMN ===';

  for r in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'plm'
      and table_name like 'pmt\_%' escape '\'
      and table_name <> 'pmt_property'
      and (column_name = 'property_name'
           or column_name like '%\_property\_name' escape '\')
  loop
    if (r.table_name = 'pmt_authorized_title_property'
        and r.column_name = 'paramount_property_name')
    or (r.table_name = 'pmt_property_capture_log'
        and r.column_name = 'property_name') then
      v_allowed := v_allowed + 1;  -- the deprecated pair, pending the Step 6 drop
    else
      v_fail := v_fail + 1;
      raise warning 'FAIL property-name column outside pmt_property: %.%', r.table_name, r.column_name;
    end if;
  end loop;

  if v_allowed <> 2 then
    raise exception 'D FAILED: expected exactly the 2 deprecated columns in the allowlist, matched %',
      v_allowed;
  end if;

  if v_fail > 0 then raise exception 'D FAILED (%) reintroduced name column(s)', v_fail; end if;

  raise notice 'D: only the 2 deprecated columns remain; nothing else carries a property name';
end;
$$;


-- =====================================================================================
-- E. NO READER IN THE LIVE CATALOG REFERENCES THE COPIES. The repository grep covers the
--    tree; this covers databases, which can hold objects the tree no longer shows. A bare
--    '%property_name%' function scan is deliberately NOT used for the capture-log column:
--    the loader's pmt_property entity branch legitimately writes property_name, and such
--    a scan false-positives on it. The adjacency shape from section B is the precise
--    detector for the duplicate-write pattern.
-- =====================================================================================
do $$
declare
  r record; v_fail integer := 0;
begin
  raise notice '=== E. NO LIVE READER OF EITHER COPY ===';

  for r in
    with eligible_functions as materialized (
      select p.oid, p.proname, n.nspname as schema_name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f', 'w')
    )
    select schema_name, proname
    from eligible_functions
    where pg_get_functiondef(oid) ilike '%paramount_property_name%'
       or position('property_name, reported_asset_count'
                   in regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) <> 0
  loop
    v_fail := v_fail + 1;
    raise warning 'FAIL function still reads/writes a copy: %.%', r.schema_name, r.proname;
  end loop;

  for r in
    select schemaname, viewname from pg_views
    where definition ilike '%paramount_property_name%'
       or position('property_name, reported_asset_count'
                   in regexp_replace(definition, '[[:space:]]+', ' ', 'g')) <> 0
  loop
    v_fail := v_fail + 1;
    raise warning 'FAIL view still reads a copy: %.%', r.schemaname, r.viewname;
  end loop;

  if v_fail > 0 then raise exception 'E FAILED (%) live reader(s)', v_fail; end if;
  raise notice 'E: no function or view references either copy';
end;
$$;
