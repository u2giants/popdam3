-- =====================================================================================
-- Sesame Workshop (NetX) landing contract tests -- migration 20260819212002, issue #1216,
-- claim #1271.
--
-- HOW TO RUN
--   Against a throwaway or preview database, as the migration owner:
--       \i supabase/tests/sesame_landing_contracts.sql
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
--   Every `raise warning` in this file sits behind a counter that is asserted at the end
--   of its block. A warning does NOT fail a psql run, so a block whose only reaction to a
--   bad outcome is a warning is green exactly when it should be red.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one brand, sub-brand, character, style guide, art
--   style, theme, category, asset, file name, title, keyword or portal URL from the real
--   source appears here. The fixtures use obviously fake tokens (ZZTEST-*,
--   example.invalid) chosen so a real row could never be mistaken for one of them.
--
-- WHY MOST SECTIONS INSERT THE CAPTURE ROW DIRECTLY
--   service_role holds SELECT only on plm.sesame_capture; the write path is the
--   begin/complete pair. These tests run as the table OWNER, which can still insert, so a
--   section can exercise a TABLE constraint in isolation without routing through a
--   function that would refuse the row earlier for a different reason -- which would
--   prove the function, not the constraint. Section B proves service_role itself cannot
--   insert there, and sections F-H exercise the functions on their own terms.
--
-- WHAT IT ASSERTS
--   A. The 19 tables exist, RLS is on every one, each carries exactly 2 read policies,
--      and both refusals hold: NO brand-to-character table in any form, and NO
--      denormalized multi-valued axis on plm.sesame_asset.
--   B. Append-only privilege separation genuinely DENIES update, delete AND truncate --
--      proven by executing them as service_role, not merely by reading a grant table --
--      while INSERT on the 18 snapshot tables still works and INSERT on the capture root
--      does not.
--   C. The capture publication gate: every clause of the completion rule falsified one at
--      a time, so no clause can be deleted without a test going red, plus the zero-media
--      scope guard.
--   D. Identity and shape contracts, each pinned to a NAMED constraint: the two field
--      generations cannot collapse, the tree cannot self-parent or cross captures, a
--      vocabulary row cannot claim zero assets, and the style-guide evidence columns
--      cannot drift apart.
--   E. The declared/derived separation: relationship_truth cannot be anything but
--      'derived' in the derived table nor anything but 'declared' in a declared one, and
--      a derived row cannot claim zero supporting assets.
--   F. plm.begin_sesame_capture: security posture, idempotency, contradiction refusal,
--      and every unusable count shape refused BY NAME.
--   G. plm.complete_sesame_capture: the publication gate re-read from the STORED object,
--      the categories-visited arithmetic, the multi-value parse evidence, and the four
--      sibling defect shapes -- a JSON null (a SKIPPED check), a numeric-looking STRING
--      whose value MATCHES the true row count (a silent WRONG ANSWER), a fraction and an
--      oversized value (raw cast errors that wedge the capture).
--   H. The wedge class: hostile complete_ arguments are RECORDED as a rejection rather
--      than raised, a count written 1.0 still publishes, and the extra-key sweep applies
--      sign and range and not only type.
--   H-B. The multi-value parse CLAIM is checked against the rows, and a genuinely
--      multi-valued capture still publishes.
--   H-C. The derivation's skip-list count is an EXACT census: zero, under-report and
--      over-report are each refused under their own error code, a truthful zero
--      publishes, and an empty derived table is still held to the count. Two earlier
--      drafts of that guard were wrong in different ways; both are reconstructed there
--      as mutants this section now kills.
--   I. plm.latest_sesame_capture() never returns a loading or rejected capture.
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
    'sesame_capture','sesame_brand','sesame_sub_brand','sesame_character',
    'sesame_art_style','sesame_asset_type','sesame_theme','sesame_style_guide',
    'sesame_category','sesame_asset','sesame_asset_category','sesame_asset_brand',
    'sesame_asset_sub_brand','sesame_asset_character','sesame_asset_style_guide',
    'sesame_asset_art_style','sesame_asset_asset_type','sesame_asset_theme',
    'sesame_style_guide_character'
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
   where table_schema = 'plm' and table_name like 'sesame\_%' and table_type = 'BASE TABLE';
  if v_n <> 19 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm holds % sesame tables, expected exactly 19', v_n;
  end if;

  -- THE REFUSED RELATIONSHIP. The portal never states which characters belong to which
  -- brand. Pairing those two independent fields off a shared asset is the Disney DCP
  -- Vault fabrication, and no table here may hold the result, derived or otherwise.
  select count(*) into v_n from information_schema.tables
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and table_name like '%brand%' and table_name like '%character%';
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % brand-to-character table(s) exist; that link is refused', v_n;
  end if;

  -- THE DENORMALIZATION REFUSAL. Every one of these axes is multi-valued in the source,
  -- so a column on the asset would be a lie on the thousands of assets carrying several.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name = 'sesame_asset'
     and (column_name like '%brand%' or column_name like '%character%'
          or column_name like '%style_guide%' or column_name like '%art_style%'
          or column_name like '%theme%' or column_name like '%asset_type%');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.sesame_asset carries % denormalized vocabulary column(s)',
      v_n;
  end if;

  -- No media column, no download path, ever.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name = 'sesame_asset'
     and (column_name in ('bytes','media','content','blob','base64','file_bytes',
                          'thumbnail','thumbnail_url','preview_url','download_path')
          or data_type = 'bytea');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.sesame_asset carries % media-bearing column(s)', v_n;
  end if;

  -- source_md5 must stay nullable: a handful of assets in this portal carry none.
  if (select is_nullable from information_schema.columns
       where table_schema = 'plm' and table_name = 'sesame_asset'
         and column_name = 'source_md5') is distinct from 'YES' then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: plm.sesame_asset.source_md5 is not nullable';
  end if;

  -- THE VOCABULARY FAMILY HAS NO SOURCE-ID COLUMN, ON PURPOSE. The portal issues none
  -- for these axes and a permanently NULL id column would read as a capture failure.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm'
     and table_name in ('sesame_brand','sesame_sub_brand','sesame_character',
                        'sesame_style_guide','sesame_art_style','sesame_asset_type',
                        'sesame_theme')
     and column_name in ('source_value_id','value_source_id','source_id');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % source-id column(s) on label-only vocabulary tables', v_n;
  end if;

  -- ...while the two axes that DO have portal identity must carry theirs.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm'
     and (   (table_name = 'sesame_category' and column_name = 'category_source_id')
          or (table_name = 'sesame_asset'    and column_name = 'asset_source_id'));
  if v_n <> 2 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: the two portal-identified axes are missing a source id (% of 2)',
      v_n;
  end if;

  -- Every vocabulary table must carry the full label-only column set.
  foreach v_name in array array[
    'sesame_brand','sesame_sub_brand','sesame_character','sesame_style_guide',
    'sesame_art_style','sesame_asset_type','sesame_theme'] loop
    select count(*) into v_n from information_schema.columns
     where table_schema = 'plm' and table_name = v_name
       and column_name in ('capture_id','value_key','value_label','field_generation',
                           'asset_count','raw');
    if v_n <> 6 then
      v_fail := v_fail + 1;
      raise warning 'A FAIL: plm.% is missing vocabulary columns (found % of 6)', v_name, v_n;
    end if;
  end loop;

  -- field_generation must be inside the PRIMARY KEY of every vocabulary table. Outside
  -- it, the two generations collapse by case folding and a winner is picked silently.
  select count(*) into v_n
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
   where n.nspname = 'plm'
     and t.relname in ('sesame_brand','sesame_sub_brand','sesame_character',
                       'sesame_style_guide','sesame_art_style','sesame_asset_type',
                       'sesame_theme')
     and i.indisprimary and a.attname = 'field_generation';
  if v_n <> 7 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: field_generation is in only % of 7 vocabulary primary keys', v_n;
  end if;

  -- The folder form and the field-value form of a style guide are DIFFERENT OBJECTS.
  -- A foreign key between them would assert a correspondence nobody has ruled on.
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class r on r.oid = c.confrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'plm' and t.relname = 'sesame_category' and c.contype = 'f'
     and r.relname = 'sesame_style_guide';
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning
      'A FAIL: plm.sesame_category has % foreign key(s) to plm.sesame_style_guide', v_n;
  end if;

  -- This release resolves NOTHING. A half-built reconciliation surface reads as
  -- "resolution exists and nothing resolved yet", which is worse than none at all.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and column_name in ('core_property_id','core_character_id','core_licensor_id',
                         'resolved_at','resolution_status');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % reconciliation column(s) shipped', v_n;
  end if;

  -- No trigger may exist on any of these tables. Immutability is privilege separation,
  -- and this database has been burned by a trigger guard that never fired.
  select count(*) into v_n
    from pg_trigger g join pg_class t on t.oid = g.tgrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'plm' and t.relname like 'sesame\_%' and not g.tgisinternal;
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: % user trigger(s) on sesame tables', v_n;
  end if;

  -- The three claimed functions exist, all three pin search_path, and the two write-path
  -- functions are security definer.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm'
     and p.proname in ('begin_sesame_capture','complete_sesame_capture',
                       'latest_sesame_capture');
  if v_n <> 3 then
    v_fail := v_fail + 1;
    raise warning 'A FAIL: found % of the 3 claimed functions', v_n;
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm'
     and p.proname in ('begin_sesame_capture','complete_sesame_capture',
                       'latest_sesame_capture')
     and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                  where c like 'search\_path=%');
  if v_n <> 3 then
    v_fail := v_fail + 1;
    raise warning
      'A FAIL: only % of 3 functions are security definer with a pinned search_path', v_n;
  end if;

  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
  raise notice
    'A passed: 19 tables, RLS, 38 policies, no brand/character link, no denormalized axis, no media, no triggers';
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
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and grantee in ('service_role','authenticated','anon','PUBLIC')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    raise exception 'B FAILED: % write grant(s) exist on plm.sesame_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_n <> 19 then
    raise exception 'B FAILED: expected 19 service_role SELECT grants, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_n <> 18 then
    raise exception 'B FAILED: expected 18 service_role INSERT grants, found %', v_n;
  end if;

  if has_table_privilege('service_role','plm.sesame_capture','INSERT') then
    raise exception 'B FAILED: plm.sesame_capture is directly insertable by service_role';
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sesame\_%' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'B FAILED: anon holds % grant(s) on plm.sesame_* tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sesame\_%'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_n <> 19 then
    raise exception 'B FAILED: expected 19 authenticated SELECT grants, found %', v_n;
  end if;

  -- The EXECUTE posture is half the immutability model and is invisible in the table
  -- grants. begin_ is the INSERT path to the capture root, so it matters at least as much
  -- as complete_.
  if has_function_privilege('anon',
       'plm.begin_sesame_capture(text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,text)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'plm.begin_sesame_capture(text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,text)',
       'EXECUTE') then
    raise exception 'B FAILED: begin_sesame_capture is executable outside service_role';
  end if;
  if has_function_privilege('anon',
       'plm.complete_sesame_capture(uuid,jsonb,integer,boolean,boolean,boolean,integer,jsonb)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'plm.complete_sesame_capture(uuid,jsonb,integer,boolean,boolean,boolean,integer,jsonb)',
       'EXECUTE') then
    raise exception 'B FAILED: complete_sesame_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role',
       'plm.begin_sesame_capture(text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,text)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'plm.complete_sesame_capture(uuid,jsonb,integer,boolean,boolean,boolean,integer,jsonb)',
       'EXECUTE') then
    raise exception 'B FAILED: service_role cannot execute its own write path';
  end if;
  if has_function_privilege('anon', 'plm.latest_sesame_capture()', 'EXECUTE') then
    raise exception 'B FAILED: latest_sesame_capture is executable by anon';
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
  v_warn     integer := 0;
  v_t        text;
  -- A representative spread across the structural classes: a label-only vocabulary, the
  -- declared tree, the high-volume asset table, a declared link table, and the one
  -- derived table.
  v_spread text[] := array[
    'sesame_brand','sesame_category','sesame_asset','sesame_asset_character',
    'sesame_style_guide_character'
  ];
begin
  insert into plm.sesame_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
    created_by)
  values ('ZZTEST-sesame-B', 'ZZTEST-repo', repeat('a', 40), repeat('a', 64),
          'https://example.invalid', 'zztest-slug', '2099-01-01Z',
          '{"assets":1}'::jsonb, '{}'::jsonb, 'ZZTEST')
  returning id into v_cap;

  insert into plm.sesame_brand (capture_id, value_key, value_label, field_generation,
                                asset_count, raw)
  values (v_cap, 'zztest-brand-a', 'ZZTEST Brand A', 'current', 1, '{}');

  execute 'set local role service_role';

  -- The loader may still INSERT into a snapshot table: a revoke that overshot would break
  -- the load silently.
  begin
    insert into plm.sesame_brand (capture_id, value_key, value_label, field_generation,
                                  asset_count, raw)
    values (v_cap, 'zztest-brand-b', 'ZZTEST Brand B', 'legacy', 3, '{}');
  exception when insufficient_privilege then
    execute 'reset role';
    raise exception
      'B FAILED: service_role cannot INSERT a snapshot row; the revoke overshot';
  end;

  begin
    update plm.sesame_brand set value_label = 'ZZTEST mutated' where capture_id = v_cap;
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role UPDATE on plm.sesame_brand SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    delete from plm.sesame_brand where capture_id = v_cap;
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role DELETE on plm.sesame_brand SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- TRUNCATE is a DISTINCT privilege from DELETE. An append-only snapshot that revokes
  -- DELETE but leaves TRUNCATE reachable can still be emptied in one statement.
  begin
    truncate table plm.sesame_brand;
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role TRUNCATE on plm.sesame_brand SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- The capture root: no INSERT, no UPDATE, no TRUNCATE, ever.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
      created_by)
    values ('ZZTEST-sesame-B-direct', 'ZZTEST-repo', repeat('b', 40), repeat('b', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z',
            '{}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role INSERT into plm.sesame_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    update plm.sesame_capture set status = 'complete' where id = v_cap;
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role UPDATE on plm.sesame_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    truncate table plm.sesame_capture;
    v_warn := v_warn + 1;
    raise warning 'B FAIL: service_role TRUNCATE on plm.sesame_capture SUCCEEDED';
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  -- UPDATE denied across the representative spread. The privilege check happens before
  -- any row is touched, so an empty table proves the grant exactly as a populated one does.
  foreach v_t in array v_spread loop
    begin
      execute format('update plm.%I set capture_id = capture_id', v_t);
      v_warn := v_warn + 1;
      raise warning 'B FAIL: service_role UPDATE on plm.% SUCCEEDED', v_t;
    exception when insufficient_privilege then v_denied := v_denied + 1;
    end;
  end loop;

  execute 'reset role';

  if v_warn > 0 then
    raise exception 'B FAILED: % write attempt(s) that must be denied SUCCEEDED', v_warn;
  end if;
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
-- sesame_capture_complete_requirements_chk can be deleted without a test going red. Each
-- block below satisfies EVERY clause except the one under test.
-- =====================================================================================
do $$
declare
  v_con    text;
  v_raised integer := 0;
  v_warn   integer := 0;
  v_want   integer := 6;
begin
  -- C1. A capture that never walked the category tree. This is the clause that catches
  -- the non-recursive-search trap: a top-folders-only crawl returns HTTP 200 and zero
  -- assets from every parent, so it looks entirely successful and is empty.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by,
      category_tree_walked, pagination_verified, multivalue_parse_verified)
    values ('ZZTEST-sesame-C1', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
            'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', false, true, true);
    v_warn := v_warn + 1;
    raise warning 'C FAIL: a capture that never walked the tree published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_complete_requirements_chk' then
      raise exception 'C1 FAILED: expected sesame_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C2. A capture that never verified pagination.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by,
      category_tree_walked, pagination_verified, multivalue_parse_verified)
    values ('ZZTEST-sesame-C2', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
            'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', true, false, true);
    v_warn := v_warn + 1;
    raise warning 'C FAIL: an unpaginated capture published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_complete_requirements_chk' then
      raise exception 'C2 FAILED: expected sesame_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C3. A capture that never proved its multi-value parse. The source delivers a
  -- multi-valued field as ONE CSV-quoted string; an unparsed pass-through is invisible in
  -- every row count.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by,
      category_tree_walked, pagination_verified, multivalue_parse_verified)
    values ('ZZTEST-sesame-C3', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
            'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', true, true, false);
    v_warn := v_warn + 1;
    raise warning 'C FAIL: an unverified multi-value parse published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_complete_requirements_chk' then
      raise exception 'C3 FAILED: expected sesame_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C4. A capture carrying validation errors may never publish, whatever the counts say.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by,
      category_tree_walked, pagination_verified, multivalue_parse_verified, error_summary)
    values ('ZZTEST-sesame-C4', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
            'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', true, true, true,
            '["ZZTEST-error"]'::jsonb);
    v_warn := v_warn + 1;
    raise warning 'C FAIL: a capture carrying validation errors published as complete';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_complete_requirements_chk' then
      raise exception 'C4 FAILED: expected sesame_capture_complete_requirements_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C5. status and load_completed_at must agree in BOTH directions. A completion time on
  -- a still-loading capture is the mirror-image lie and has its own constraint.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
      expected_counts, raw_summary, created_by)
    values ('ZZTEST-sesame-C5', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
            'loading', '{}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'C FAIL: a loading capture carried a completion time';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_complete_time_chk' then
      raise exception 'C5 FAILED: expected sesame_capture_complete_time_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  -- C6. THE ZERO-MEDIA SCOPE GUARD. Storing media bytes is out of scope, and the column
  -- is CONSTRAINED to zero rather than merely defaulted -- a default is advice, a CHECK is
  -- a rule. This constraint is also what makes the media clause of the completion CHECK,
  -- and the media_downloaded_nonzero branch of plm.complete_sesame_capture, unreachable;
  -- both are kept as defence in depth and are honestly reported as untested rather than
  -- listed as covered.
  begin
    insert into plm.sesame_capture (
      capture_key, source_repository, source_commit_sha, source_manifest_sha256,
      portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
      created_by, media_downloaded)
    values ('ZZTEST-sesame-C6', 'ZZTEST-repo', repeat('6', 40), repeat('6', 64),
            'https://example.invalid', 'zztest-slug', '2099-01-01Z',
            '{}'::jsonb, '{}'::jsonb, 'ZZTEST', 1);
    v_warn := v_warn + 1;
    raise warning 'C FAIL: a capture claiming a media download was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_capture_media_zero_chk' then
      raise exception 'C6 FAILED: expected sesame_capture_media_zero_chk, % fired (%)',
        v_con, sqlerrm;
    end if;
    v_raised := v_raised + 1;
  end;

  if v_warn > 0 then
    raise exception 'C FAILED: % bad capture row(s) were ACCEPTED', v_warn;
  end if;
  if v_raised <> v_want then
    raise exception 'C FAILED: % of % gate clauses refused their bad row', v_raised, v_want;
  end if;

  -- And the positive case: a capture that satisfies every clause DOES publish. Without
  -- this, a constraint that rejected everything would still pass C1-C6.
  insert into plm.sesame_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, portal_slug, source_captured_at, load_completed_at, status,
    expected_counts, raw_summary, created_by,
    category_tree_walked, pagination_verified, multivalue_parse_verified)
  values ('ZZTEST-sesame-C-ok', 'ZZTEST-repo', repeat('c', 40), repeat('c', 64),
          'https://example.invalid', 'zztest-slug', '2099-01-01Z', '2099-01-02Z',
          'complete', '{}'::jsonb, '{}'::jsonb, 'ZZTEST', true, true, true);

  raise notice 'C passed: every publication-gate clause is independently falsifiable';
end;
$$;


-- =====================================================================================
-- D. IDENTITY AND SHAPE, each pinned to a NAMED constraint.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_cap2   uuid;
  v_con    text;
  v_raised integer := 0;
  v_warn   integer := 0;
  v_want   integer := 8;
begin
  insert into plm.sesame_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
    created_by)
  values ('ZZTEST-sesame-D', 'ZZTEST-repo', repeat('d', 40), repeat('d', 64),
          'https://example.invalid', 'zztest-slug', '2099-01-01Z',
          '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST')
  returning id into v_cap;
  insert into plm.sesame_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
    created_by)
  values ('ZZTEST-sesame-D2', 'ZZTEST-repo', repeat('e', 40), repeat('e', 64),
          'https://example.invalid', 'zztest-slug', '2099-01-01Z',
          '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST')
  returning id into v_cap2;

  -- THE HEADLINE CONTRACT: the two field generations of ONE axis, whose labels case-fold
  -- onto each other, must BOTH survive. This is the single thing this schema exists to
  -- protect, so it is asserted positively rather than only by a refusal.
  insert into plm.sesame_character (capture_id, value_key, value_label, field_generation,
                                    asset_count, raw)
  values (v_cap, 'zztest-char-a', 'ZZTEST Char A', 'current', 5, '{}'),
         (v_cap, 'zztest-char-a', 'zztest char a', 'legacy',  7, '{}');
  if (select count(*) from plm.sesame_character
       where capture_id = v_cap and value_key = 'zztest-char-a') <> 2 then
    raise exception
      'D FAILED: the two field generations of one value COLLAPSED; that is the whole point of this schema';
  end if;

  -- D1. ...but the SAME generation twice is a genuine duplicate.
  begin
    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_cap, 'zztest-char-a', 'ZZTEST Char A again', 'current', 5, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a duplicate vocabulary value within one generation was accepted';
  exception when unique_violation then v_raised := v_raised + 1;
  end;

  -- D2. An unknown field generation is refused by name.
  begin
    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_cap, 'zztest-char-b', 'ZZTEST Char B', 'ZZTEST-unknown', 1, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: an unknown field_generation was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_character_generation_chk' then
      raise exception 'D2 FAILED: expected sesame_character_generation_chk, % fired', v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D3. A vocabulary value used by no asset cannot exist here: these vocabularies ARE the
  -- distinct values observed on the assets, because the choice-list API returns nothing.
  begin
    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_cap, 'zztest-char-c', 'ZZTEST Char C', 'current', 0, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a vocabulary value claiming zero assets was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_character_asset_count_positive_chk' then
      raise exception 'D3 FAILED: expected sesame_character_asset_count_positive_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D4. The style-guide axis has NO legacy twin, and the schema says so rather than
  -- leaving it to a comment.
  begin
    insert into plm.sesame_style_guide (capture_id, value_key, value_label,
                                        field_generation, asset_count, is_colon_nested, raw)
    values (v_cap, 'zztest-guide-x', 'ZZTEST Guide X', 'legacy', 1, false, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a legacy-generation style guide was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_style_guide_generation_chk' then
      raise exception 'D4 FAILED: expected sesame_style_guide_generation_chk, % fired', v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D5. The two style-guide EVIDENCE columns must agree. A nested label with no family
  -- recorded would quietly poison any future ruling made against that column.
  begin
    insert into plm.sesame_style_guide (capture_id, value_key, value_label,
                                        field_generation, asset_count, guide_family,
                                        is_colon_nested, raw)
    values (v_cap, 'zztest-guide-y', 'ZZTEST Guide Y', 'current', 1, null, true, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a nested style guide with no family recorded was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_style_guide_family_agrees_chk' then
      raise exception 'D5 FAILED: expected sesame_style_guide_family_agrees_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- The declared tree. Two roots and a child, inserted child-first on purpose: the
  -- self-referencing foreign key is DEFERRABLE INITIALLY DEFERRED precisely so a loader
  -- need not walk the tree twice to sort parents ahead of children.
  insert into plm.sesame_category (
    capture_id, category_source_id, parent_category_source_id, category_label,
    category_path, depth, in_licensee_portal, is_guide_level, child_count, raw)
  values (v_cap, 20, 10, 'ZZTEST Child',  '/zztest/child',  1, true,  true,  0, '{}'),
         (v_cap, 10, null, 'ZZTEST Root',  '/zztest',        0, true,  false, 1, '{}'),
         -- The out-of-portal node: it LANDS, flagged, because the tree cannot be resolved
         -- without it and its presence is the proof the scope limit was real.
         (v_cap, 30, null, 'ZZTEST Internal', '/zztest-internal', 0, false, false, 0, '{}');
  if (select count(*) from plm.sesame_category
       where capture_id = v_cap and not in_licensee_portal) <> 1 then
    raise exception 'D FAILED: the out-of-portal category did not land';
  end if;

  -- D6. A node may not be its own parent. The deferred foreign key would accept it.
  begin
    insert into plm.sesame_category (
      capture_id, category_source_id, parent_category_source_id, category_label,
      category_path, depth, in_licensee_portal, is_guide_level, child_count, raw)
    values (v_cap, 40, 40, 'ZZTEST Loop', '/zztest/loop', 1, true, false, 0, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a self-parenting category was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_category_not_self_parent_chk' then
      raise exception 'D6 FAILED: expected sesame_category_not_self_parent_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- D7. Two captures may hold the same portal path; one capture may not.
  insert into plm.sesame_category (
    capture_id, category_source_id, parent_category_source_id, category_label,
    category_path, depth, in_licensee_portal, is_guide_level, child_count, raw)
  values (v_cap2, 10, null, 'ZZTEST Root', '/zztest', 0, true, false, 0, '{}');
  begin
    insert into plm.sesame_category (
      capture_id, category_source_id, parent_category_source_id, category_label,
      category_path, depth, in_licensee_portal, is_guide_level, child_count, raw)
    values (v_cap, 50, null, 'ZZTEST Root Again', '/zztest', 0, true, false, 0, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a duplicate category path within one capture was accepted';
  exception when unique_violation then v_raised := v_raised + 1;
  end;

  -- D8. A link may never reach across captures. This is the guarantee that makes a
  -- capture a self-contained snapshot rather than a layer over its predecessors.
  insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
  values (v_cap, 100, 'ZZTEST Asset', 'zztest-hash', '{}');
  begin
    insert into plm.sesame_asset_category (
      capture_id, asset_source_id, category_source_id, raw)
    values (v_cap2, 100, 10, '{}');
    v_warn := v_warn + 1;
    raise warning 'D FAIL: a cross-capture asset-to-category link was accepted';
  exception when foreign_key_violation then v_raised := v_raised + 1;
  end;

  if v_warn > 0 then
    raise exception 'D FAILED: % bad row(s) were ACCEPTED', v_warn;
  end if;
  if v_raised <> v_want then
    raise exception 'D FAILED: % of % shape contracts refused their bad row',
      v_raised, v_want;
  end if;
  raise notice 'D passed: both generations survive, and every identity contract holds';
end;
$$;


-- =====================================================================================
-- E. THE DECLARED / DERIVED SEPARATION.
--
-- This is the section that keeps reconstructed data from ever being read as portal fact.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_con    text;
  v_raised integer := 0;
  v_warn   integer := 0;
  v_want   integer := 5;
begin
  insert into plm.sesame_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, portal_slug, source_captured_at, expected_counts, raw_summary,
    created_by)
  values ('ZZTEST-sesame-E', 'ZZTEST-repo', repeat('f', 40), repeat('f', 64),
          'https://example.invalid', 'zztest-slug', '2099-01-01Z',
          '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST')
  returning id into v_cap;

  insert into plm.sesame_character (capture_id, value_key, value_label, field_generation,
                                    asset_count, raw)
  values (v_cap, 'zztest-char', 'ZZTEST Char', 'current', 2, '{}'),
         (v_cap, 'zztest-char', 'zztest char', 'legacy',  2, '{}');
  insert into plm.sesame_style_guide (capture_id, value_key, value_label, field_generation,
                                      asset_count, is_colon_nested, raw)
  values (v_cap, 'zztest-guide', 'ZZTEST Guide', 'current', 2, false, '{}');
  insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
  values (v_cap, 200, 'ZZTEST Asset', 'zztest-hash', '{}');

  -- E1. A declared link table may hold nothing but 'declared'.
  begin
    insert into plm.sesame_asset_character (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal,
      relationship_truth, raw)
    values (v_cap, 200, 'zztest-char', 'current', 0, 'derived', '{}');
    v_warn := v_warn + 1;
    raise warning 'E FAIL: a derived row was accepted into a DECLARED link table';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_asset_character_declared_chk' then
      raise exception 'E1 FAILED: expected sesame_asset_character_declared_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- The declared links themselves, including the legacy generation, which must reach the
  -- legacy vocabulary row and only that one.
  insert into plm.sesame_asset_character (
    capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
  values (v_cap, 200, 'zztest-char', 'current', 0, '{}'),
         (v_cap, 200, 'zztest-char', 'legacy',  0, '{}');
  insert into plm.sesame_asset_style_guide (
    capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
  values (v_cap, 200, 'zztest-guide', 'current', 0, '{}');

  -- E2. A legacy link cannot point at a value that exists only in the current generation.
  -- The composite foreign key carries the generation through, so the two can never be
  -- crossed by accident.
  begin
    insert into plm.sesame_asset_style_guide (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_cap, 200, 'zztest-guide', 'legacy', 1, '{}');
    v_warn := v_warn + 1;
    raise warning 'E FAIL: a legacy link reached a current-generation vocabulary value';
  exception when foreign_key_violation then v_raised := v_raised + 1;
  end;

  -- E3. THE DERIVED TABLE MAY HOLD NOTHING BUT 'derived'. This is the line that stops a
  -- reconstruction being laundered into portal fact.
  begin
    insert into plm.sesame_style_guide_character (
      capture_id, guide_value_key, character_value_key, asset_count, relationship_truth,
      rule_version, raw)
    values (v_cap, 'zztest-guide', 'zztest-char', 3, 'declared', 'zztest-v1', '{}');
    v_warn := v_warn + 1;
    raise warning 'E FAIL: a DERIVED row was accepted as declared';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_style_guide_character_derived_chk' then
      raise exception 'E3 FAILED: expected sesame_style_guide_character_derived_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E4. And nothing but the ONE named derivation rule. A second rule needs a schema
  -- change, an issue and a reviewer.
  begin
    insert into plm.sesame_style_guide_character (
      capture_id, guide_value_key, character_value_key, asset_count, derivation_method,
      rule_version, raw)
    values (v_cap, 'zztest-guide', 'zztest-char', 3, 'ZZTEST-other-rule', 'zztest-v1', '{}');
    v_warn := v_warn + 1;
    raise warning 'E FAIL: an unnamed derivation method was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_style_guide_character_method_chk' then
      raise exception 'E4 FAILED: expected sesame_style_guide_character_method_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- E5. A derived row with no supporting assets is not evidence of anything.
  begin
    insert into plm.sesame_style_guide_character (
      capture_id, guide_value_key, character_value_key, asset_count, rule_version, raw)
    values (v_cap, 'zztest-guide', 'zztest-char', 0, 'zztest-v1', '{}');
    v_warn := v_warn + 1;
    raise warning 'E FAIL: a derived row with zero supporting assets was accepted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if coalesce(v_con, '') <> 'sesame_style_guide_character_support_chk' then
      raise exception 'E5 FAILED: expected sesame_style_guide_character_support_chk, % fired',
        v_con;
    end if;
    v_raised := v_raised + 1;
  end;

  -- The positive case: a well-formed derived row lands, and it reaches the CURRENT
  -- generation of both vocabularies.
  insert into plm.sesame_style_guide_character (
    capture_id, guide_value_key, character_value_key, asset_count, rule_version, raw)
  values (v_cap, 'zztest-guide', 'zztest-char', 3, 'zztest-v1', '{}');
  if (select count(*) from plm.sesame_style_guide_character
       where capture_id = v_cap and relationship_truth = 'derived'
         and derivation_method = 'single_guide_asset'
         and guide_field_generation = 'current'
         and character_field_generation = 'current') <> 1 then
    raise exception 'E FAILED: the well-formed derived row did not land as derived/current';
  end if;

  if v_warn > 0 then
    raise exception 'E FAILED: % bad row(s) were ACCEPTED', v_warn;
  end if;
  if v_raised <> v_want then
    raise exception 'E FAILED: % of % separation contracts refused their bad row',
      v_raised, v_want;
  end if;
  raise notice 'E passed: declared and derived cannot be confused for one another';
end;
$$;


-- =====================================================================================
-- F. plm.begin_sesame_capture
-- =====================================================================================
do $$
declare
  v_a      uuid;
  v_b      uuid;
  v_raised integer := 0;
  v_warn   integer := 0;
  v_want   integer := 8;
begin
  -- The happy path, and idempotency: the same call twice is the SAME capture, not two.
  v_a := plm.begin_sesame_capture(
    'ZZTEST-sesame-F', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST');
  v_b := plm.begin_sesame_capture(
    'ZZTEST-sesame-F', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST');
  if v_a is distinct from v_b then
    raise exception 'F FAILED: begin_sesame_capture is not idempotent (% vs %)', v_a, v_b;
  end if;

  -- F1. Same key, DIFFERENT manifest hash, is a contradiction, not a resume. Appending
  -- different source bytes under one capture key makes the snapshot unreconstructable.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F', 'ZZTEST-repo', repeat('1', 40), repeat('2', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a same-key capture with a DIFFERENT manifest hash was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F2. Same key, different source identity.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://other.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a same-key capture with a DIFFERENT portal was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F3. A malformed commit sha.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F3', 'ZZTEST-repo', 'ZZTESTNOTAHASH', repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":0}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a malformed commit sha was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F4. DEFECT (1): a JSON null count. A bare `? key` presence test reports it as
  -- supplied and every later comparison is UNKNOWN, so the count check is SKIPPED
  -- entirely and a truncated capture publishes. It must be refused HERE, by type.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F4', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":null}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a JSON NULL expected count was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F5. DEFECT (3): a numeric-looking STRING. The dangerous one -- it casts cleanly and
  -- compares equal, so it is a silent WRONG ANSWER rather than a crash.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F5', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":"0"}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a numeric-looking STRING expected count was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F6. A fractional count.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F6', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":1.5}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a fractional expected count was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F7. DEFECTS (2) and (4): an oversized count must be refused BY NAME here rather than
  -- reaching a `::bigint` later and raising a bare out-of-range that wedges the capture.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F7', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":92233720368547758070}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: an oversized expected count was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- F8. The zero-media scope, refused at the manifest.
  begin
    perform plm.begin_sesame_capture(
      'ZZTEST-sesame-F8', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      '{"assets":0,"media_downloaded":1}'::jsonb, '{}'::jsonb, 'ZZTEST');
    v_warn := v_warn + 1;
    raise warning 'F FAIL: a manifest claiming a media download was accepted';
  exception when raise_exception then v_raised := v_raised + 1;
  end;

  -- An integral count written 1.0 is a perfectly legal JSON number and MUST be accepted:
  -- it is `::bigint` that cannot read it, not the contract.
  perform plm.begin_sesame_capture(
    'ZZTEST-sesame-F-onepointzero', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    '{"assets":1.0}'::jsonb, '{}'::jsonb, 'ZZTEST');

  if v_warn > 0 then
    raise exception 'F FAILED: % unusable capture start(s) were ACCEPTED', v_warn;
  end if;
  if v_raised <> v_want then
    raise exception 'F FAILED: % of % bad starts were refused', v_raised, v_want;
  end if;
  raise notice 'F passed: begin_sesame_capture refuses every unusable start by name';
end;
$$;


-- =====================================================================================
-- G. plm.complete_sesame_capture -- THE PUBLICATION GATE.
--
-- Every block here asserts on the PERSISTED status and error codes, never on an exception:
-- the whole point of this function is that a rejection is RECORDED rather than raised, so
-- a test that expected an exception would be asserting the opposite of the contract.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_fail   integer := 0;
  v_full   jsonb;

begin
  v_full := jsonb_build_object(
    'categories',0,'brands',0,'sub_brands',0,'characters',0,'style_guides',0,
    'art_styles',0,'asset_types',0,'themes',0,'assets',0,'asset_categories',0,
    'asset_brands',0,'asset_sub_brands',0,'asset_characters',0,'asset_style_guides',0,
    'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
    'style_guide_characters',0);

  -- G1. THE HAPPY PATH. An empty but honest capture publishes.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G1', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status into v_status from plm.sesame_capture where id = v_cap;
  if v_status <> 'complete' then
    v_fail := v_fail + 1;
    raise warning 'G1 FAIL: an honest capture did not publish (status %)', v_status;
  end if;

  -- ...and completing it again is a no-op, not an error.
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status into v_status from plm.sesame_capture where id = v_cap;
  if v_status <> 'complete' then
    v_fail := v_fail + 1;
    raise warning 'G1 FAIL: a repeat completion changed the status to %', v_status;
  end if;

  -- ...and beginning it again HANDS BACK the finished capture untouched rather than
  -- raising or re-opening it. A loader that reruns after a successful publish is the
  -- ordinary case, not an error, and re-opening a published capture would let rows be
  -- appended to a snapshot that consumers already read as final.
  if plm.begin_sesame_capture(
       'ZZTEST-sesame-G1', 'ZZTEST-repo', repeat('1', 40), repeat('1', 64),
       'https://example.invalid', 'zztest-slug', '2099-01-01Z',
       v_full, '{}'::jsonb, 'ZZTEST') is distinct from v_cap then
    v_fail := v_fail + 1;
    raise warning 'G1 FAIL: re-beginning a COMPLETE capture did not hand back the same id';
  end if;
  select status into v_status from plm.sesame_capture where id = v_cap;
  if v_status <> 'complete' then
    v_fail := v_fail + 1;
    raise warning 'G1 FAIL: re-beginning a complete capture RE-OPENED it (status %)',
      v_status;
  end if;

  -- G2. THE CATEGORIES-VISITED ARITHMETIC. The flag alone is the loader's word; this is
  -- the number behind the word, and it is what catches "I walked some of the tree and set
  -- the flag anyway" -- the non-recursive-search trap.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G2', 'ZZTEST-repo', repeat('2', 40), repeat('2', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, v_full, 427, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"categories_visited_disagrees_with_rows"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning
      'G2 FAIL: a capture claiming more visited nodes than it loaded was not rejected (% / %)',
      v_status, v_err;
  end if;

  -- G3. A LOWERED FLAG IS RECORDED, NOT RAISED.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G3', 'ZZTEST-repo', repeat('3', 40), repeat('3', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, v_full, 0, false, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"category_tree_not_walked"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G3 FAIL: an unwalked tree was not recorded as a rejection (% / %)',
      v_status, v_err;
  end if;

  -- G4. DEFECT (1) AT THE GATE. An owner-level UPDATE can reach expected_counts without
  -- going through begin_, so the gate must re-read the STORED object and refuse a JSON
  -- null again. The count here would otherwise be SKIPPED -- the check never fires and a
  -- truncated capture publishes.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G4', 'ZZTEST-repo', repeat('4', 40), repeat('4', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full || '{"assets":null}'::jsonb where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_not_a_number","entity":"assets"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G4 FAIL: a JSON NULL stored count did not reject the capture (% / %)',
      v_status, v_err;
  end if;

  -- G5. DEFECT (3) AT THE GATE, THE MOST DANGEROUS SHAPE. The string "0" casts cleanly
  -- and its numeric value MATCHES the true row count, so a mismatch test would pass it
  -- and prove nothing. Only a TYPE test catches it.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G5', 'ZZTEST-repo', repeat('5', 40), repeat('5', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full || '{"assets":"0"}'::jsonb where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_not_a_number","entity":"assets"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning
      'G5 FAIL: a numeric-looking STRING whose value MATCHES the row count published (% / %)',
      v_status, v_err;
  end if;

  -- G6. DEFECTS (2) AND (4) AT THE GATE. An oversized stored count must become a NAMED
  -- error code. A raw `::bigint` here would raise, abort the function BEFORE the rejection
  -- row is written, and wedge the capture in 'loading' with no recorded reason.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G6', 'ZZTEST-repo', repeat('6', 40), repeat('6', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full || '{"assets":92233720368547758070}'::jsonb
   where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_out_of_range","entity":"assets"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G6 FAIL: an oversized stored count did not become a named error (% / %)',
      v_status, v_err;
  end if;

  -- G7. A MISSING KEY is not the same as a bad one, and must have its own code.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G7', 'ZZTEST-repo', repeat('7', 40), repeat('7', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full - 'assets' where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_missing","entity":"assets"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G7 FAIL: a missing expected count did not reject the capture (% / %)',
      v_status, v_err;
  end if;

  -- G8. THE THIRD FACT. The loader's OWN reported count must agree with the tables too.
  -- Checking only expected-versus-actual lets a loader that miscounted its own output
  -- pass while reporting a number that is simply wrong.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G8', 'ZZTEST-repo', repeat('8', 40), repeat('8', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(
    v_cap, v_full || '{"assets":9}'::jsonb, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"reported_count_mismatch","entity":"assets"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G8 FAIL: a wrong REPORTED count did not reject the capture (% / %)',
      v_status, v_err;
  end if;

  -- G9. Errors the loader itself reported are fatal. A capture that knows it failed may
  -- never publish, whatever the counts say.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-G9', 'ZZTEST-repo', repeat('9', 40), repeat('9', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(
    v_cap, v_full, 0, true, true, true, 0, '["ZZTEST-loader-error"]'::jsonb);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"loader_reported_errors"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'G9 FAIL: a self-reported loader failure published (% / %)',
      v_status, v_err;
  end if;

  if v_fail > 0 then raise exception 'G FAILED (% failures)', v_fail; end if;
  raise notice 'G passed: the publication gate refuses every unusable count shape by name';
end;
$$;


-- =====================================================================================
-- H. THE WEDGE CLASS, THE MULTI-VALUE EVIDENCE, AND THE EXTRA-KEY SWEEP.
--
-- A "wedge" is a capture left in 'loading' with NO recorded reason, because the gate
-- raised before it could write the rejection. Every block here proves a shape that used
-- to wedge now RECORDS instead.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_fail   integer := 0;
  v_full   jsonb;
begin
  v_full := jsonb_build_object(
    'categories',0,'brands',0,'sub_brands',0,'characters',0,'style_guides',0,
    'art_styles',0,'asset_types',0,'themes',0,'assets',0,'asset_categories',0,
    'asset_brands',0,'asset_sub_brands',0,'asset_characters',0,'asset_style_guides',0,
    'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
    'style_guide_characters',0);

  -- H1. A SQL NULL observed_counts. `jsonb_typeof(null)` is NULL, so a bare
  -- `jsonb_typeof(x) <> 'object'` is UNKNOWN and never fires; and raising instead would
  -- abort before the rejection row was written and wedge the capture.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H1', 'ZZTEST-repo', repeat('a', 40), repeat('1', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, null, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"observed_counts_not_an_object"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H1 FAIL: a NULL observed_counts WEDGED the capture (% / %)',
      v_status, v_err;
  end if;

  -- H2. A jsonb ARRAY where an object belongs. `?` and `->` against an array answer about
  -- the wrong thing rather than failing.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H2', 'ZZTEST-repo', repeat('b', 40), repeat('2', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, '[]'::jsonb, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"observed_counts_not_an_object"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H2 FAIL: an ARRAY observed_counts was not recorded (% / %)',
      v_status, v_err;
  end if;

  -- H3. A NULL VERIFICATION FLAG IS NOT FALSE. `if not p_flag` is UNKNOWN on a NULL and
  -- never fires -- the same never-false shape as the JSON null, in boolean clothing. It
  -- must be named, not silently treated as satisfied.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H3', 'ZZTEST-repo', repeat('c', 40), repeat('3', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, v_full, 0, null, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"verification_flag_is_null"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H3 FAIL: a NULL verification flag was treated as satisfied (% / %)',
      v_status, v_err;
  end if;

  -- H4. A NULL categories_visited.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H4', 'ZZTEST-repo', repeat('d', 40), repeat('4', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_cap, v_full, null, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"categories_visited_is_null"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H4 FAIL: a NULL categories_visited WEDGED the capture (% / %)',
      v_status, v_err;
  end if;

  -- H5. AN INTEGRAL COUNT WRITTEN 1.0 IS A LEGAL JSON NUMBER AND MUST PUBLISH. This is
  -- the positive half of defect (2): a raw `(x ->> key)::bigint` reads the TEXT '1.0' and
  -- raises `invalid input syntax`, wedging a capture that was entirely correct.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H5', 'ZZTEST-repo', repeat('e', 40), repeat('5', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  insert into plm.sesame_brand (capture_id, value_key, value_label, field_generation,
                                asset_count, raw)
  values (v_cap, 'zztest-brand', 'ZZTEST Brand', 'current', 1, '{}');
  update plm.sesame_capture
     set expected_counts = v_full || '{"brands":1.0}'::jsonb where id = v_cap;
  perform plm.complete_sesame_capture(
    v_cap, v_full || '{"brands":1.0}'::jsonb, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'complete' then
    v_fail := v_fail + 1;
    raise warning 'H5 FAIL: a count written 1.0 did not publish (% / %)', v_status, v_err;
  end if;

  -- H6. THE EXTRA-KEY SWEEP APPLIES SIGN AND RANGE, NOT ONLY TYPE. A key outside the
  -- eighteen entities cannot skip an entity count, so this is a truthfulness fix rather
  -- than a publication hole -- but a sweep whose comment claims every key is covered
  -- while it ignores -1 is how the next reader is misled.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H6', 'ZZTEST-repo', repeat('f', 40), repeat('6', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full || '{"zztest_extra_key":-1}'::jsonb where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_not_a_nonnegative_integer","entity":"zztest_extra_key"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H6 FAIL: a NEGATIVE value under an extra key was ignored (% / %)',
      v_status, v_err;
  end if;

  -- H7. ...and the same for an oversized value under an extra key.
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-H7', 'ZZTEST-repo', repeat('1', 39) || '0', repeat('7', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  update plm.sesame_capture
     set expected_counts = v_full || '{"zztest_extra_key":92233720368547758070}'::jsonb
   where id = v_cap;
  perform plm.complete_sesame_capture(v_cap, v_full, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"expected_count_out_of_range","entity":"zztest_extra_key"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning 'H7 FAIL: an OVERSIZED value under an extra key was ignored (% / %)',
      v_status, v_err;
  end if;

  if v_fail > 0 then raise exception 'H FAILED (% failures)', v_fail; end if;
  raise notice 'H passed: no argument shape wedges the gate, and 1.0 still publishes';
end;
$$;


-- =====================================================================================
-- H-B. THE MULTI-VALUE PARSE EVIDENCE.
--
-- multivalue_parse_verified is the loader's CLAIM. This is the evidence behind it. A
-- loader that never split the source's CSV-quoted strings produces exactly one value per
-- asset per axis -- a plausible-looking, entirely wrong capture that no row count reveals.
-- =====================================================================================
do $$
declare
  v_cap    uuid;
  v_status text;
  v_err    jsonb;
  v_fail   integer := 0;
  v_exp    jsonb;
begin
  -- A capture with two characters on ONE asset but exactly one value each: the signature
  -- of a parse that never happened.
  v_exp := jsonb_build_object(
    'categories',0,'brands',0,'sub_brands',0,'characters',2,'style_guides',0,
    'art_styles',0,'asset_types',0,'themes',0,'assets',2,'asset_categories',0,
    'asset_brands',0,'asset_sub_brands',0,'asset_characters',2,'asset_style_guides',0,
    'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
    'style_guide_characters',0);

  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-HB1', 'ZZTEST-repo', repeat('2', 40), repeat('8', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_exp, '{}'::jsonb, 'ZZTEST');
  insert into plm.sesame_character (capture_id, value_key, value_label, field_generation,
                                    asset_count, raw)
  values (v_cap, 'zztest-char-1', 'ZZTEST Char 1', 'current', 1, '{}'),
         (v_cap, 'zztest-char-2', 'ZZTEST Char 2', 'current', 1, '{}');
  insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
  values (v_cap, 1, 'ZZTEST Asset 1', 'zztest-hash-1', '{}'),
         (v_cap, 2, 'ZZTEST Asset 2', 'zztest-hash-2', '{}');
  insert into plm.sesame_asset_character (
    capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
  values (v_cap, 1, 'zztest-char-1', 'current', 0, '{}'),
         (v_cap, 2, 'zztest-char-2', 'current', 0, '{}');

  perform plm.complete_sesame_capture(v_cap, v_exp, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'rejected'
     or not (v_err @> '[{"code":"multivalue_parse_shows_no_multivalued_asset","entity":"asset_character"}]'::jsonb) then
    v_fail := v_fail + 1;
    raise warning
      'H-B FAIL: a capture with no multi-valued asset on a dense axis claimed a verified parse (% / %)',
      v_status, v_err;
  end if;

  -- The positive half: put BOTH characters on ONE asset and the same capture publishes.
  -- Without this, a guard that rejected everything would still pass the block above.
  v_exp := v_exp || '{"assets":1,"asset_characters":2}'::jsonb;
  v_cap := plm.begin_sesame_capture(
    'ZZTEST-sesame-HB2', 'ZZTEST-repo', repeat('3', 40), repeat('9', 64),
    'https://example.invalid', 'zztest-slug', '2099-01-01Z',
    v_exp, '{}'::jsonb, 'ZZTEST');
  insert into plm.sesame_character (capture_id, value_key, value_label, field_generation,
                                    asset_count, raw)
  values (v_cap, 'zztest-char-1', 'ZZTEST Char 1', 'current', 1, '{}'),
         (v_cap, 'zztest-char-2', 'ZZTEST Char 2', 'current', 1, '{}');
  insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
  values (v_cap, 1, 'ZZTEST Asset 1', 'zztest-hash-1', '{}');
  insert into plm.sesame_asset_character (
    capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
  values (v_cap, 1, 'zztest-char-1', 'current', 0, '{}'),
         (v_cap, 1, 'zztest-char-2', 'current', 1, '{}');
  perform plm.complete_sesame_capture(v_cap, v_exp, 0, true, true, true);
  select status, error_summary into v_status, v_err
    from plm.sesame_capture where id = v_cap;
  if v_status <> 'complete' then
    v_fail := v_fail + 1;
    raise warning 'H-B FAIL: a genuinely multi-valued capture did not publish (% / %)',
      v_status, v_err;
  end if;

  if v_fail > 0 then raise exception 'H-B FAILED (% failures)', v_fail; end if;
  raise notice 'H-B passed: the multi-value parse claim is checked against the rows';
end;
$$;


-- =====================================================================================
-- H-C. THE DERIVATION'S OWN HONESTY: AN EXACT CENSUS OF ITS SKIP LIST.
--
-- guide_character_rows_excluded is the count of character rows the derivation REFUSED to
-- attribute, because their asset carried several style guides and could not be split.
-- The evidence is computable from the rows: the current-generation character appearances
-- sitting on current-generation multi-guide assets. The gate requires the reported number
-- to EQUAL that count, and this section falsifies every way it can differ.
--
-- TWO EARLIER DRAFTS OF THIS GUARD WERE WRONG AND BOTH FAILURES ARE RECORDED HERE,
-- because between them they cover almost every way an audit guard goes bad.
--
--   DRAFT 1 never counted characters at all -- it only asked whether a multi-guide ASSET
--   existed. It therefore REFUSED A TRUTHFUL ZERO (thousands of assets in this source
--   carry no character, so a capture whose multi-guide assets are character-free excludes
--   nothing) while RUBBER-STAMPING any nonzero value. The fixture of the day proved it:
--   its multi-guide asset had no character rows and the passing call still reported 4, a
--   number computed from nothing.
--
--   DRAFT 2 rejected zero and rejected anything above the population, and accepted
--   EVERY INTEGER IN BETWEEN -- so a capture with a thousand excludable rows could report
--   ONE and publish. Its fixture could not have caught this: with an evidence count of 1,
--   the only integer between one and the truth IS the truth. A test suite that cannot
--   express the bug cannot find it, which is why the fixture below carries TWO excludable
--   rows and not one.
--
--   Draft 2 also defended itself with an argument this very fixture refutes: that a
--   loader counting distinct (guide, character) PAIRS would legitimately report a SMALLER
--   number. An unsplittable asset here carries two guides and one character -- appearance
--   count 1, pair count 2 -- so the pair count is LARGER, and the same suite already
--   demanded it be rejected as a fabrication. Both could not be true.
--
-- THE FIXTURE, and why each row is here. It is built once, in a loop, so the four arms
-- are byte-identical in content and differ ONLY in the number reported -- four hand-copied
-- fixtures that quietly drift apart is how a negative test stops testing what its
-- positive twin proves.
--   asset 1 -- ONE guide, TWO characters. Derivable. Its two characters also keep the
--              section-D multi-value evidence genuine, so these captures are refused by
--              the guard under test rather than by a different one.
--   asset 2 -- TWO guides, ONE character. Unsplittable: 1 excludable row.
--   asset 3 -- TWO guides, ONE character. Unsplittable: 1 more.
--   => the excludable population is 2, so 1 is an expressible under-report.
-- =====================================================================================
do $$
declare
  v_cap        uuid;
  v_status     text;
  v_err        jsonb;
  v_obs        jsonb;
  v_fail       integer := 0;
  v_exp        jsonb;
  v_excludable bigint;
  v_reported   integer;
  v_arm        text;
begin
  v_exp := jsonb_build_object(
    'categories',0,'brands',0,'sub_brands',0,'characters',2,'style_guides',2,
    'art_styles',0,'asset_types',0,'themes',0,'assets',3,'asset_categories',0,
    'asset_brands',0,'asset_sub_brands',0,'asset_characters',4,'asset_style_guides',5,
    'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
    'style_guide_characters',1);

  foreach v_arm in array array['zero','understated','true','excessive'] loop
    v_cap := plm.begin_sesame_capture(
      'ZZTEST-sesame-HC-' || v_arm, 'ZZTEST-repo', repeat('4', 40),
      md5('ZZTEST-sesame-HC-' || v_arm) || md5('ZZTEST-salt'),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      v_exp, '{}'::jsonb, 'ZZTEST');

    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_cap, 'zztest-char',   'ZZTEST Char',     'current', 2, '{}'),
           (v_cap, 'zztest-char-2', 'ZZTEST Char Two', 'current', 2, '{}');
    insert into plm.sesame_style_guide (capture_id, value_key, value_label,
                                        field_generation, asset_count, guide_family,
                                        is_colon_nested, raw)
    values (v_cap, 'zztest-guide-1', 'ZZTEST Guide 1',  'current', 3, null, false, '{}'),
           (v_cap, 'zztest-guide-2', 'ZZTEST Fam: Two', 'current', 2, 'ZZTEST Fam', true, '{}');
    insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
    values (v_cap, 1, 'ZZTEST Asset 1', 'zztest-hash-1', '{}'),
           (v_cap, 2, 'ZZTEST Asset 2', 'zztest-hash-2', '{}'),
           (v_cap, 3, 'ZZTEST Asset 3', 'zztest-hash-3', '{}');
    -- Asset 1 carries ONE guide; assets 2 and 3 carry TWO each.
    insert into plm.sesame_asset_style_guide (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_cap, 1, 'zztest-guide-1', 'current', 0, '{}'),
           (v_cap, 2, 'zztest-guide-1', 'current', 0, '{}'),
           (v_cap, 2, 'zztest-guide-2', 'current', 1, '{}'),
           (v_cap, 3, 'zztest-guide-1', 'current', 0, '{}'),
           (v_cap, 3, 'zztest-guide-2', 'current', 1, '{}');
    -- Asset 1 carries TWO characters (derivable); assets 2 and 3 carry ONE each, and
    -- those two rows are the entire excludable population.
    insert into plm.sesame_asset_character (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_cap, 1, 'zztest-char',   'current', 0, '{}'),
           (v_cap, 1, 'zztest-char-2', 'current', 1, '{}'),
           (v_cap, 2, 'zztest-char',   'current', 0, '{}'),
           (v_cap, 3, 'zztest-char-2', 'current', 0, '{}');
    insert into plm.sesame_style_guide_character (
      capture_id, guide_value_key, character_value_key, asset_count, rule_version, raw)
    values (v_cap, 'zztest-guide-1', 'zztest-char', 1, 'zztest-v1', '{}');

    -- COMPUTE the evidence from the fixture rather than asserting a literal. The test
    -- must not carry its own copy of the answer: if the fixture changes this follows it,
    -- and if the function's definition of the population disagrees with this one, the
    -- assertions below say so.
    select count(*) into v_excludable
      from plm.sesame_asset_character ac
     where ac.capture_id = v_cap and ac.field_generation = 'current'
       and exists (select 1 from plm.sesame_asset_style_guide sg
                    where sg.capture_id = ac.capture_id
                      and sg.asset_source_id = ac.asset_source_id
                      and sg.field_generation = 'current'
                    group by sg.asset_source_id having count(*) > 1);
    -- The fixture must leave ROOM for an under-report. With an excludable count of 1 the
    -- only integer strictly between zero and the truth does not exist, and the
    -- understated arm below would silently become a duplicate of the honest one -- which
    -- is exactly why draft 2's suite could not catch draft 2's bug.
    if v_excludable <> 2 then
      raise exception
        'H-C FAILED: the fixture itself is wrong -- % excludable character rows, expected 2; an under-report is not expressible below 2',
        v_excludable;
    end if;

    v_reported := case v_arm
                    when 'zero'        then 0
                    when 'understated' then (v_excludable - 1)::integer
                    when 'true'        then v_excludable::integer
                    when 'excessive'   then (v_excludable + 1)::integer
                  end;
    perform plm.complete_sesame_capture(
      v_cap, v_exp, 0, true, true, true, v_reported);
    select status, error_summary, observed_counts into v_status, v_err, v_obs
      from plm.sesame_capture where id = v_cap;

    if v_arm = 'true' then
      -- The honest capture publishes. Without this arm a guard that rejected everything
      -- would still pass the other three.
      if v_status <> 'complete' then
        v_fail := v_fail + 1;
        raise warning 'H-C FAIL (true): an exactly-counted derivation did not publish (% / %)',
          v_status, v_err;
      end if;
      if (select guide_character_rows_excluded from plm.sesame_capture where id = v_cap)
           is distinct from v_excludable::integer then
        v_fail := v_fail + 1;
        raise warning 'H-C FAIL (true): the exclusion count was not persisted on the capture';
      end if;
      -- The gate must also RECORD what it measured, not merely act on it: a reader
      -- auditing a published capture needs both numbers side by side.
      if (v_obs -> 'guide_character_rows_excludable') is distinct from to_jsonb(v_excludable)
         or (v_obs -> 'guide_character_rows_excluded_reported')
              is distinct from to_jsonb(v_excludable) then
        v_fail := v_fail + 1;
        raise warning
          'H-C FAIL (true): the evidence count was not recorded in observed_counts (%)', v_obs;
      end if;
    else
      -- Each wrong number is rejected under its OWN code, so the three failure causes
      -- stay distinguishable to an operator and a single mis-fired branch cannot pass by
      -- borrowing another branch's error.
      declare
        v_want text := case v_arm
                         when 'zero'        then 'guide_character_exclusions_not_counted'
                         when 'understated' then 'guide_character_exclusions_understate_evidence'
                         when 'excessive'   then 'guide_character_exclusions_exceed_evidence'
                       end;
      begin
        if v_status <> 'rejected'
           or not (v_err @> jsonb_build_array(jsonb_build_object('code', v_want))) then
          v_fail := v_fail + 1;
          raise warning
            'H-C FAIL (%): reported % against an evidence count of % -- expected rejection with %, got % / %',
            v_arm, v_reported, v_excludable, v_want, v_status, v_err;
        end if;
      end;
    end if;
  end loop;

  -- AND THE TRUTHFUL ZERO, on its own capture. Remove every excludable character row and
  -- the honest answer becomes 0 -- which draft 1 refused, forcing a loader to invent a
  -- number to publish at all. Thousands of assets in this source carry no character, so
  -- this is the ordinary case, not a corner.
  declare
    v_cap0 uuid;
    v_exp0 jsonb := jsonb_build_object(
      'categories',0,'brands',0,'sub_brands',0,'characters',2,'style_guides',2,
      'art_styles',0,'asset_types',0,'themes',0,'assets',2,'asset_categories',0,
      'asset_brands',0,'asset_sub_brands',0,'asset_characters',2,'asset_style_guides',3,
      'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
      'style_guide_characters',1);
  begin
    v_cap0 := plm.begin_sesame_capture(
      'ZZTEST-sesame-HC-truthful-zero', 'ZZTEST-repo', repeat('4', 40),
      md5('ZZTEST-sesame-HC-truthful-zero') || md5('ZZTEST-salt'),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      v_exp0, '{}'::jsonb, 'ZZTEST');
    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_cap0, 'zztest-char',   'ZZTEST Char',     'current', 1, '{}'),
           (v_cap0, 'zztest-char-2', 'ZZTEST Char Two', 'current', 1, '{}');
    insert into plm.sesame_style_guide (capture_id, value_key, value_label,
                                        field_generation, asset_count, guide_family,
                                        is_colon_nested, raw)
    values (v_cap0, 'zztest-guide-1', 'ZZTEST Guide 1',  'current', 2, null, false, '{}'),
           (v_cap0, 'zztest-guide-2', 'ZZTEST Fam: Two', 'current', 1, 'ZZTEST Fam', true, '{}');
    insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
    values (v_cap0, 1, 'ZZTEST Asset 1', 'zztest-hash-1', '{}'),
           (v_cap0, 2, 'ZZTEST Asset 2', 'zztest-hash-2', '{}');
    insert into plm.sesame_asset_style_guide (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_cap0, 1, 'zztest-guide-1', 'current', 0, '{}'),
           (v_cap0, 2, 'zztest-guide-1', 'current', 0, '{}'),
           (v_cap0, 2, 'zztest-guide-2', 'current', 1, '{}');
    -- The multi-guide asset carries NO character, so nothing was excluded.
    insert into plm.sesame_asset_character (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_cap0, 1, 'zztest-char',   'current', 0, '{}'),
           (v_cap0, 1, 'zztest-char-2', 'current', 1, '{}');
    insert into plm.sesame_style_guide_character (
      capture_id, guide_value_key, character_value_key, asset_count, rule_version, raw)
    values (v_cap0, 'zztest-guide-1', 'zztest-char', 1, 'zztest-v1', '{}');

    perform plm.complete_sesame_capture(v_cap0, v_exp0, 0, true, true, true, 0);
    select status, error_summary into v_status, v_err
      from plm.sesame_capture where id = v_cap0;
    if v_status <> 'complete' then
      v_fail := v_fail + 1;
      raise warning
        'H-C FAIL (truthful zero): a capture that genuinely excluded NOTHING was refused, so the guard can only be satisfied by inventing a number (% / %)',
        v_status, v_err;
    end if;
  end;

  -- AND THE EMPTY DERIVATION. A capture whose derivation produced NO rows at all, sitting
  -- on a real excludable population, must still be held to the census. Draft 2 carried a
  -- "derived rows exist" conjunct that let exactly this publish with a reported zero.
  declare
    v_capE uuid;
    v_expE jsonb := jsonb_build_object(
      'categories',0,'brands',0,'sub_brands',0,'characters',1,'style_guides',2,
      'art_styles',0,'asset_types',0,'themes',0,'assets',1,'asset_categories',0,
      'asset_brands',0,'asset_sub_brands',0,'asset_characters',1,'asset_style_guides',2,
      'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
      'style_guide_characters',0);
  begin
    v_capE := plm.begin_sesame_capture(
      'ZZTEST-sesame-HC-empty-derivation', 'ZZTEST-repo', repeat('4', 40),
      md5('ZZTEST-sesame-HC-empty-derivation') || md5('ZZTEST-salt'),
      'https://example.invalid', 'zztest-slug', '2099-01-01Z',
      v_expE, '{}'::jsonb, 'ZZTEST');
    insert into plm.sesame_character (capture_id, value_key, value_label,
                                      field_generation, asset_count, raw)
    values (v_capE, 'zztest-char', 'ZZTEST Char', 'current', 1, '{}');
    insert into plm.sesame_style_guide (capture_id, value_key, value_label,
                                        field_generation, asset_count, guide_family,
                                        is_colon_nested, raw)
    values (v_capE, 'zztest-guide-1', 'ZZTEST Guide 1',  'current', 1, null, false, '{}'),
           (v_capE, 'zztest-guide-2', 'ZZTEST Fam: Two', 'current', 1, 'ZZTEST Fam', true, '{}');
    -- ONE asset, TWO guides, ONE character: nothing is derivable and one row is
    -- excludable. The derived table is legitimately EMPTY.
    insert into plm.sesame_asset (capture_id, asset_source_id, asset_name, source_hash, raw)
    values (v_capE, 1, 'ZZTEST Asset 1', 'zztest-hash-1', '{}');
    insert into plm.sesame_asset_style_guide (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_capE, 1, 'zztest-guide-1', 'current', 0, '{}'),
           (v_capE, 1, 'zztest-guide-2', 'current', 1, '{}');
    insert into plm.sesame_asset_character (
      capture_id, asset_source_id, value_key, field_generation, value_ordinal, raw)
    values (v_capE, 1, 'zztest-char', 'current', 0, '{}');

    -- multivalue_parse_verified is passed FALSE here on purpose: this capture has one
    -- asset with one character, so the section-D character evidence cannot be satisfied
    -- and would mask the code under test. Lowering the flag is itself a rejection reason,
    -- so the assertion below checks for the exclusion code SPECIFICALLY rather than for
    -- rejection in general -- otherwise this block would pass for the wrong reason.
    perform plm.complete_sesame_capture(v_capE, v_expE, 0, true, true, false, 0);
    select status, error_summary into v_status, v_err
      from plm.sesame_capture where id = v_capE;
    if v_status <> 'rejected'
       or not (v_err @> '[{"code":"guide_character_exclusions_not_counted"}]'::jsonb) then
      v_fail := v_fail + 1;
      raise warning
        'H-C FAIL (empty derivation): an uncounted skip list published because the derived table happened to be empty (% / %)',
        v_status, v_err;
    end if;
  end;

  if v_fail > 0 then raise exception 'H-C FAILED (% failures)', v_fail; end if;
  raise notice
    'H-C passed: the exclusion count is an EXACT census -- zero, under-report and over-report all refused by their own code, a truthful zero publishes, and an empty derivation is still held to it';
end;
$$;


-- =====================================================================================
-- I. plm.latest_sesame_capture()
--
-- Every consumer reads through this instead of picking a capture by date. A rejected
-- capture is RETAINED on purpose, so it is sitting there with a plausible timestamp
-- waiting for a date picker to choose it.
-- =====================================================================================
do $$
declare
  v_ok       uuid;
  v_rejected uuid;
  v_loading  uuid;
  v_latest   uuid;
  v_full     jsonb;
begin
  v_full := jsonb_build_object(
    'categories',0,'brands',0,'sub_brands',0,'characters',0,'style_guides',0,
    'art_styles',0,'asset_types',0,'themes',0,'assets',0,'asset_categories',0,
    'asset_brands',0,'asset_sub_brands',0,'asset_characters',0,'asset_style_guides',0,
    'asset_art_styles',0,'asset_asset_types',0,'asset_themes',0,
    'style_guide_characters',0);

  -- An OLDER capture that published.
  v_ok := plm.begin_sesame_capture(
    'ZZTEST-sesame-I-ok', 'ZZTEST-repo', repeat('7', 40), repeat('c', 64),
    'https://example.invalid', 'zztest-slug', '2098-01-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_ok, v_full, 0, true, true, true);

  -- A NEWER capture that was rejected. A date picker would choose this one.
  v_rejected := plm.begin_sesame_capture(
    'ZZTEST-sesame-I-rej', 'ZZTEST-repo', repeat('8', 40), repeat('d', 64),
    'https://example.invalid', 'zztest-slug', '2099-06-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');
  perform plm.complete_sesame_capture(v_rejected, v_full, 0, false, true, true);

  -- And a NEWER one still in flight.
  v_loading := plm.begin_sesame_capture(
    'ZZTEST-sesame-I-loading', 'ZZTEST-repo', repeat('9', 40), repeat('e', 64),
    'https://example.invalid', 'zztest-slug', '2099-12-01Z',
    v_full, '{}'::jsonb, 'ZZTEST');

  v_latest := plm.latest_sesame_capture();
  if v_latest = v_rejected then
    raise exception 'I FAILED: latest_sesame_capture returned a REJECTED capture';
  end if;
  if v_latest = v_loading then
    raise exception 'I FAILED: latest_sesame_capture returned a LOADING capture';
  end if;
  if v_latest is null then
    raise exception 'I FAILED: latest_sesame_capture returned NULL while a complete capture exists';
  end if;
  if (select status from plm.sesame_capture where id = v_latest) <> 'complete' then
    raise exception 'I FAILED: latest_sesame_capture returned a non-complete capture';
  end if;

  raise notice 'I passed: only a complete capture can ever be read as current';
end;
$$;

rollback;
