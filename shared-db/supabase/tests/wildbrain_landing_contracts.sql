-- =====================================================================================
-- WildBrain DAM landing -- contract tests.
--
-- Covers migration 20260819014639_wildbrain_dam_source_landing.sql
-- Issue u2giants/shared-db #1197, claim #1209.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Not one WildBrain property, era, character, guide,
--   keyword, asset, file name or portal URL appears here. Every fixture token starts
--   with ZZTEST- or ends in .invalid, chosen so that a real row could never be mistaken
--   for one of them and so a grep for them finds only test scaffolding.
--
-- HOW IT IS RUN
--   .github/workflows/database-contract-tests.yml executes every supabase/tests/*.sql
--   against a THROWAWAY local Supabase stack, wrapped in a single
--   `begin; ... \ir <file>; rollback;` transaction. Nothing here survives the run, and
--   nothing here may be pointed at preview or production.
--
--   Because the whole file is ONE transaction, every test that expects a statement to
--   FAIL wraps it in a plpgsql `begin ... exception` block, which is an implicit
--   savepoint. A bare failing statement would abort the enclosing transaction and every
--   later section would be skipped -- which would look like a pass.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   Every assertion checks an OBJECT or a BEHAVIOUR, and every "this must be rejected"
--   test asserts that the rejection ACTUALLY HAPPENED -- a `v_rejected := true` flag set
--   inside the exception handler and then asserted -- rather than merely running a
--   statement and not looking. A test that passes through an unasserted condition is a
--   defect, not a test.
--
--   AND EVERY REJECTION IS PINNED TO THE THING THAT DID THE REJECTING -- a constraint
--   NAME from `get stacked diagnostics ... = constraint_name`, or, for a function that
--   raises, `when raise_exception` plus a match on the message. A bare
--   `when check_violation` / `when unique_violation` / `when foreign_key_violation` /
--   `when others` passes when ANY constraint on the row fires, or when the statement has
--   a typo, so it stays green after the constraint under test is deleted. That is not a
--   weaker test; it is a test of nothing, and a green CI line saying otherwise is worse
--   than no test at all.
--
--   Section B is the one to read first. Immutability in this design is delivered by
--   GRANTS, not by a trigger and not by RLS -- service_role carries BYPASSRLS, so an
--   RLS-only guard would admit every write. B inspects the catalog AND then actually
--   becomes service_role and tries to UPDATE and DELETE.
--
-- SIDE EFFECTS
--   Creates synthetic captures and rows in plm.wildbrain_*. Writes NOTHING to core.*,
--   dam.* or any canonical table, and section H asserts exactly that.
-- =====================================================================================


-- =====================================================================================
-- A. OBJECT EXISTENCE -- 11 tables and 2 functions, read from the catalog. No views.
-- =====================================================================================
do $$
declare
  v_name text; v_pass integer := 0; v_fail integer := 0; v_n integer;
begin
  raise notice '=== A. OBJECT EXISTENCE ===';
  foreach v_name in array array[
    'plm.wildbrain_capture','plm.wildbrain_era','plm.wildbrain_creative_group',
    'plm.wildbrain_asset_category','plm.wildbrain_asset_nature','plm.wildbrain_character',
    'plm.wildbrain_asset','plm.wildbrain_asset_character','plm.wildbrain_guide',
    'plm.wildbrain_guide_alias','plm.wildbrain_asset_guide'
  ] loop
    if to_regclass(v_name) is null then
      v_fail := v_fail + 1; raise warning 'FAIL table missing: %', v_name;
    else v_pass := v_pass + 1; end if;
  end loop;

  foreach v_name in array array['begin_wildbrain_capture','finalize_wildbrain_capture'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'plm' and p.proname = v_name;
    if v_n <> 1 then
      v_fail := v_fail + 1;
      raise warning 'FAIL function missing or overloaded: plm.% (found %)', v_name, v_n;
    else v_pass := v_pass + 1; end if;
  end loop;

  -- Release 1 ships NO view and NOTHING in api. Licensed portal metadata and file names
  -- do not get a read surface without an explicit access decision.
  select count(*) into v_n from pg_class c
   where c.relname like 'wildbrain%' and c.relkind in ('v','m');
  if v_n <> 0 then
    v_fail := v_fail + 1; raise warning 'FAIL % wildbrain view(s) exist; release 1 ships none', v_n;
  else v_pass := v_pass + 1; end if;

  -- Both functions must be security definer with a pinned search_path.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm'
     and p.proname in ('begin_wildbrain_capture','finalize_wildbrain_capture')
     and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                  where c like 'search\_path=%');
  if v_n <> 2 then
    v_fail := v_fail + 1;
    raise warning 'FAIL expected 2 security-definer functions with a pinned search_path, found %', v_n;
  else v_pass := v_pass + 1; end if;

  -- NO MEDIA COLUMN may exist anywhere in this family.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and (column_name ~ '(media_bytes|base64|download_path|file_path|local_path|blob)');
  if v_n <> 0 then
    v_fail := v_fail + 1; raise warning 'FAIL % media/download column(s) exist', v_n;
  else v_pass := v_pass + 1; end if;

  -- ALL THREE RECONSTRUCTED TABLES CARRY THE PIN. The migration header says every one of
  -- them does, and a reader identifies portal-declared tables by the ABSENCE of this
  -- column -- so an unpinned alias table would read as portal vocabulary.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm'
     and table_name in ('wildbrain_guide','wildbrain_guide_alias','wildbrain_asset_guide')
     and column_name = 'relationship_truth';
  if v_n <> 3 then
    v_fail := v_fail + 1;
    raise warning 'FAIL expected relationship_truth on all 3 reconstructed tables, found %', v_n;
  else v_pass := v_pass + 1; end if;

  select count(*) into v_n from pg_constraint
   where conrelid in ('plm.wildbrain_guide'::regclass, 'plm.wildbrain_guide_alias'::regclass,
                      'plm.wildbrain_asset_guide'::regclass)
     and contype = 'c'
     and conname in ('wildbrain_guide_truth_chk','wildbrain_guide_alias_truth_chk',
                     'wildbrain_asset_guide_truth_chk');
  if v_n <> 3 then
    v_fail := v_fail + 1;
    raise warning 'FAIL expected 3 relationship_truth CHECK pins on the reconstructed tables, found %', v_n;
  else v_pass := v_pass + 1; end if;

  -- ONE ROOT PER CAPTURE is a partial unique INDEX, not a table constraint -- Postgres
  -- cannot put a WHERE clause on one -- so it is asserted from pg_index, not pg_constraint.
  select count(*) into v_n from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'wildbrain_era_one_root_per_capture_uk'
     and i.indisunique and i.indpred is not null;
  if v_n <> 1 then
    v_fail := v_fail + 1;
    raise warning 'FAIL the one-root-per-capture partial unique index is missing (found %)', v_n;
  else v_pass := v_pass + 1; end if;

  raise notice 'A: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then raise exception 'A FAILED (% failures)', v_fail; end if;
end;
$$;


-- =====================================================================================
-- A2. FIXTURE -- capture ZZTEST-A. Probed by sections C, D and E.
--     Everything below is invented. The two characters deliberately share a normalized
--     label and differ only by id, which is the exact collision this schema must accept.
-- =====================================================================================
do $$
declare
  v_cap uuid;
begin
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:A',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('a', 40),
    p_source_manifest_sha256 => repeat('b', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-01-01 00:00:00+00',
    p_expected_counts        => '{"eras":2}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true,
    p_reported_total         => 1
  );

  insert into plm.wildbrain_era
    (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
  values
    (v_cap, 'ZZTEST-ERA-ROOT', null, 'ZZTEST Era Root', 'zztest era root', true, '{}'::jsonb),
    (v_cap, 'ZZTEST-ERA-CHILD', 'ZZTEST-ERA-ROOT', 'ZZTEST Era Child', 'zztest era child', false, '{}'::jsonb);

  insert into plm.wildbrain_creative_group
    (capture_id, creative_group_source_id, creative_group_label, normalized_creative_group_label, raw)
  values (v_cap, 'ZZTEST-CG-1', 'ZZTEST Creative Group', 'zztest creative group', '{}'::jsonb);

  insert into plm.wildbrain_asset_category
    (capture_id, asset_category_source_id, asset_category_label, normalized_asset_category_label, raw)
  values (v_cap, 'ZZTEST-CAT-1', 'ZZTEST Category', 'zztest category', '{}'::jsonb);

  insert into plm.wildbrain_asset_nature
    (capture_id, asset_nature_source_id, asset_nature_label, media_type, raw)
  values (v_cap, 'ZZTEST-NAT-1', 'ZZTEST Nature', 'application/zztest', '{}'::jsonb);

  -- Two ids, ONE normalized label. This must be accepted.
  insert into plm.wildbrain_character
    (capture_id, character_source_id, character_label, normalized_character_label,
     in_source_dictionary, raw)
  values
    (v_cap, '900001', 'ZZTEST Character', 'zztest character', true,  '{}'::jsonb),
    (v_cap, '900002', 'zztest character', 'zztest character', false, '{}'::jsonb);

  insert into plm.wildbrain_asset
    (capture_id, asset_source_id, asset_uuid, asset_name, original_file_name, era_source_id,
     creative_group_source_id, asset_category_source_id, asset_nature_source_id,
     universe_label, raw_keyword_text, file_size_bytes, page_count, source_hash, raw)
  values
    (v_cap, 'ZZTEST-ASSET-1', 'zztest-uuid-0001', 'ZZTEST Asset One', 'zztest-asset-one.invalid',
     'ZZTEST-ERA-CHILD', 'ZZTEST-CG-1', 'ZZTEST-CAT-1', 'ZZTEST-NAT-1',
     'ZZTEST Universe', 'zztest guide alpha, zztest status word', 1024, 2,
     repeat('c', 64), '{}'::jsonb);

  insert into plm.wildbrain_asset_character
    (capture_id, asset_source_id, character_source_id, raw)
  values
    (v_cap, 'ZZTEST-ASSET-1', '900001', '{}'::jsonb),
    (v_cap, 'ZZTEST-ASSET-1', '900002', '{}'::jsonb);

  insert into plm.wildbrain_guide
    (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
  values (v_cap, 'zztest guide alpha', 'ZZTEST Guide Alpha', 'zztest guide alpha',
          'zztest-rules-v1', '{}'::jsonb);

  insert into plm.wildbrain_guide_alias
    (capture_id, guide_key, alias_label, asset_count, raw)
  values
    (v_cap, 'zztest guide alpha', 'ZZTEST Guide Alpha', 1, '{}'::jsonb),
    (v_cap, 'zztest guide alpha', 'zztest guide ALPHA', 1, '{}'::jsonb);

  insert into plm.wildbrain_asset_guide
    (capture_id, asset_source_id, guide_key, alias_label, raw)
  values (v_cap, 'ZZTEST-ASSET-1', 'zztest guide alpha', 'ZZTEST Guide Alpha', '{}'::jsonb);

  -- A second, deliberately EMPTY capture. Section C4 needs a real capture id that is not
  -- capture A, so that the only constraint a cross-capture parent link can violate is the
  -- composite era self-FK -- not the capture FK, which would make the test prove the
  -- wrong thing.
  perform plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:A2',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('a', 40),
    p_source_manifest_sha256 => repeat('c', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-01-02 00:00:00+00',
    p_expected_counts        => '{"eras":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );

  raise notice 'A2: fixture captures ZZTEST-A and ZZTEST-A2 built (%).', v_cap;
end;
$$;


-- =====================================================================================
-- B. IMMUTABILITY IS PRIVILEGE SEPARATION. Catalog first, then actual behaviour.
--
--    The catalog half is what would have caught the NBCU defect where a `grant select,
--    insert` was a silent no-op against a role that schema default privileges had
--    already handed everything. The behavioural half proves the catalog is not lying.
-- =====================================================================================
do $$
declare
  v_n integer; v_fail integer := 0;
begin
  raise notice '=== B1. PRIVILEGE CATALOG ===';

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee = 'service_role' and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'FAIL service_role holds % UPDATE/DELETE/TRUNCATE grant(s) on wildbrain tables', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_n <> 11 then
    v_fail := v_fail + 1; raise warning 'FAIL expected 11 SELECT grants, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_n <> 10 then
    v_fail := v_fail + 1; raise warning 'FAIL expected 10 INSERT grants, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name = 'wildbrain_capture'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_n <> 0 then
    v_fail := v_fail + 1; raise warning 'FAIL plm.wildbrain_capture is directly insertable';
  end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then
    v_fail := v_fail + 1;
    raise warning 'FAIL % grant(s) to anon/authenticated/PUBLIC survive', v_n;
  end if;

  -- RLS enabled on all eleven, and one read policy each.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname like 'wildbrain\_%' and c.relkind = 'r' and c.relrowsecurity;
  if v_n <> 11 then
    v_fail := v_fail + 1; raise warning 'FAIL expected RLS enabled on 11 tables, found %', v_n;
  end if;

  -- NO TRIGGER may be doing this job. If one appears, someone replaced an inspectable
  -- guarantee with one that can silently never fire.
  select count(*) into v_n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname like 'wildbrain\_%' and not t.tgisinternal;
  if v_n <> 0 then
    v_fail := v_fail + 1; raise warning 'FAIL % user trigger(s) exist on wildbrain tables', v_n;
  end if;

  if v_fail > 0 then raise exception 'B1 FAILED (% failures)', v_fail; end if;
  raise notice 'B1: privilege catalog is correct.';
end;
$$;

do $$
declare
  v_cap uuid;
  v_update_denied boolean := false;
  v_delete_denied boolean := false;
  v_capture_insert_denied boolean := false;
  v_capture_update_denied boolean := false;
  v_snapshot_insert_ok boolean := false;
begin
  raise notice '=== B2. PRIVILEGE BEHAVIOUR (actually become service_role) ===';
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:A';

  set local role service_role;

  begin
    update plm.wildbrain_asset set asset_name = 'ZZTEST Mutated' where capture_id = v_cap;
    -- Reaching here means a landed snapshot row was mutated. That is the whole guarantee.
  exception when insufficient_privilege then
    v_update_denied := true;
  end;

  begin
    delete from plm.wildbrain_asset_character where capture_id = v_cap;
  exception when insufficient_privilege then
    v_delete_denied := true;
  end;

  begin
    insert into plm.wildbrain_capture
      (capture_key, source_repository, source_commit_sha, source_manifest_sha256,
       portal_base_url, source_captured_at, expected_counts, raw_summary, created_by)
    values ('zztest-wildbrain:BYPASS', 'u2giants/zztest-fixture', repeat('d', 40),
            repeat('e', 64), 'https://zztest.example.invalid/',
            timestamptz '2026-01-02 00:00:00+00', '{}'::jsonb, '{}'::jsonb, 'zztest');
  exception when insufficient_privilege then
    v_capture_insert_denied := true;
  end;

  begin
    update plm.wildbrain_capture set status = 'complete' where id = v_cap;
  exception when insufficient_privilege then
    v_capture_update_denied := true;
  end;

  -- The loader must still be able to APPEND. A revoke that overshot into INSERT would
  -- break the load, so prove it did not.
  begin
    insert into plm.wildbrain_asset_nature
      (capture_id, asset_nature_source_id, asset_nature_label, raw)
    values (v_cap, 'ZZTEST-NAT-2', 'ZZTEST Nature Two', '{}'::jsonb);
    v_snapshot_insert_ok := true;
  exception when insufficient_privilege then
    v_snapshot_insert_ok := false;
  end;

  reset role;

  if not v_update_denied then
    raise exception 'B2 FAILED: service_role UPDATED a landed snapshot row -- the append-only guarantee is inert';
  end if;
  if not v_delete_denied then
    raise exception 'B2 FAILED: service_role DELETED a landed snapshot row';
  end if;
  if not v_capture_insert_denied then
    raise exception 'B2 FAILED: service_role inserted a capture directly, bypassing begin_wildbrain_capture';
  end if;
  if not v_capture_update_denied then
    raise exception 'B2 FAILED: service_role updated a capture directly, bypassing finalize_wildbrain_capture';
  end if;
  if not v_snapshot_insert_ok then
    raise exception 'B2 FAILED: service_role cannot INSERT into a snapshot table -- the loader is broken';
  end if;

  raise notice 'B2: service_role can append and read, and cannot update, delete, or write a capture.';
end;
$$;


-- =====================================================================================
-- C. ERA HIERARCHY. The declared property axis.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_cap2 uuid;
  v_self_parent_rejected boolean := false;
  v_is_root_rejected     boolean := false;
  v_orphan_rejected      boolean := false;
  v_cross_capture_rejected boolean := false;
  v_second_root_rejected boolean := false;
  v_msg text;
begin
  raise notice '=== C. ERA HIERARCHY ===';
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:A';

  -- C1. An era may not parent itself.
  begin
    insert into plm.wildbrain_era
      (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
    values (v_cap, 'ZZTEST-ERA-SELF', 'ZZTEST-ERA-SELF', 'ZZTEST Era Self', 'zztest era self', false, '{}'::jsonb);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_era_not_self_parent_chk' then v_self_parent_rejected := true; end if;
  end;

  -- C2. is_root must agree with the parent link. A root that claims a parent, or a child
  -- that claims to be root, is a contradiction and must not land.
  begin
    insert into plm.wildbrain_era
      (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
    values (v_cap, 'ZZTEST-ERA-LIAR', 'ZZTEST-ERA-ROOT', 'ZZTEST Era Liar', 'zztest era liar', true, '{}'::jsonb);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_era_root_matches_parent_chk' then v_is_root_rejected := true; end if;
  end;

  -- C3. A parent that does not resolve inside the capture. The FK is DEFERRABLE INITIALLY
  -- DEFERRED, so the violation surfaces when constraints are made immediate -- which is
  -- what commit does. Forcing it here proves the constraint is real and not merely
  -- postponed forever.
  begin
    insert into plm.wildbrain_era
      (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
    values (v_cap, 'ZZTEST-ERA-ORPHAN', 'ZZTEST-ERA-NOT-THERE', 'ZZTEST Era Orphan',
            'zztest era orphan', false, '{}'::jsonb);
    set constraints all immediate;
  exception when foreign_key_violation then
    -- Pinned to the constraint by NAME. A bare `when foreign_key_violation` would also be
    -- satisfied by the capture FK firing, which would prove nothing about the era parent
    -- link, and would stay green if this constraint were deleted.
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_era_parent_fk' then v_orphan_rejected := true; end if;
  end;
  set constraints all deferred;

  -- C4. An era may not parent an era from a DIFFERENT capture: the FK is composite on
  -- (capture_id, parent_era_source_id), so a cross-snapshot parent is impossible.
  select id into strict v_cap2 from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:A2';
  begin
    insert into plm.wildbrain_era
      (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
    values (v_cap2, 'ZZTEST-ERA-FOREIGN', 'ZZTEST-ERA-ROOT', 'ZZTEST Era Foreign',
            'zztest era foreign', false, '{}'::jsonb);
    set constraints all immediate;
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_era_parent_fk' then v_cross_capture_rejected := true; end if;
  end;
  set constraints all deferred;

  -- C4b. A SECOND ROOT MUST NOT LAND. Capture A already has ZZTEST-ERA-ROOT. Nothing else
  -- in this schema stops a second one: it has a null parent, so the self-parent CHECK,
  -- the is_root CHECK and the composite FK all pass, and it adds one to the era count
  -- that expected_counts would simply be written to match. Two roots means two trees --
  -- either an unlicensed one leaked into the crawl or a parent link was lost.
  begin
    insert into plm.wildbrain_era
      (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
    values (v_cap, 'ZZTEST-ERA-ROOT-2', null, 'ZZTEST Era Root Two', 'zztest era root two',
            true, '{}'::jsonb);
  exception when unique_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_era_one_root_per_capture_uk' then v_second_root_rejected := true; end if;
  end;

  if not v_self_parent_rejected then raise exception 'C1 FAILED: an era was allowed to parent itself'; end if;
  if not v_is_root_rejected then raise exception 'C2 FAILED: is_root was allowed to disagree with the parent link'; end if;
  if not v_orphan_rejected then raise exception 'C3 FAILED: an era with an unresolved parent was accepted, or a DIFFERENT foreign key fired -- wildbrain_era_parent_fk was not what refused it'; end if;
  if not v_cross_capture_rejected then raise exception 'C4 FAILED: an era referenced a parent in another capture, or a DIFFERENT foreign key fired'; end if;
  if not v_second_root_rejected then raise exception 'C4b FAILED: a SECOND root era landed in a capture -- wildbrain_era_one_root_per_capture_uk did not refuse it'; end if;

  -- C5. And the VALID shape must still be accepted -- a rejection test proves nothing if
  -- the constraint rejects everything.
  insert into plm.wildbrain_era
    (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
  values (v_cap, 'ZZTEST-ERA-GRANDCHILD', 'ZZTEST-ERA-CHILD', 'ZZTEST Era Grandchild',
          'zztest era grandchild', false, '{}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;

  raise notice 'C: era hierarchy holds (self-parent, is_root, orphan, cross-capture and second root all rejected BY NAME; valid child accepted).';
end;
$$;


-- =====================================================================================
-- D. DEDUPLICATION AND UNIQUENESS.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_n integer;
  v_dup_guide_label_rejected boolean := false;
  v_bad_guide_key_rejected   boolean := false;
  v_zero_alias_rejected      boolean := false;
  v_unknown_alias_rejected   boolean := false;
  v_dup_asset_uuid_rejected  boolean := false;
  v_declared_alias_rejected  boolean := false;
  v_msg text;
begin
  raise notice '=== D. DEDUPLICATION AND UNIQUENESS ===';
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:A';

  -- D1. The asset-character primary key IS the deduplication: an asset listing the same
  -- character twice collapses to ONE row, and the loader's `on conflict do nothing`
  -- retry-safety must not add a second.
  insert into plm.wildbrain_asset_character (capture_id, asset_source_id, character_source_id, raw)
  values (v_cap, 'ZZTEST-ASSET-1', '900001', '{"repeat":true}'::jsonb)
  on conflict do nothing;
  select count(*) into v_n from plm.wildbrain_asset_character
   where capture_id = v_cap and asset_source_id = 'ZZTEST-ASSET-1' and character_source_id = '900001';
  if v_n <> 1 then
    raise exception 'D1 FAILED: expected exactly 1 asset-character row after a repeat insert, found %', v_n;
  end if;

  -- D2. THE CASE-VARIANT COLLAPSE. This is the licensor defect the schema exists to
  -- absorb: the same guide typed with different capitalisation. Because guide_key is
  -- pinned to the normalization of the label, a case variant derives the SAME key and
  -- collides on the primary key -- which is the deduplication actually happening, not a
  -- rule written down somewhere and hoped for.
  --
  -- NOTE FOR ANYONE EXTENDING THIS: the unique constraint on normalized_guide_label
  -- cannot be reached by a row that also satisfies the key-derivation check -- equal
  -- normalized labels always derive equal keys, so the primary key fires first. Its value
  -- is as a second, independent lock, so its existence is asserted from the catalog below
  -- rather than provoked with a row that could never legally exist.
  begin
    insert into plm.wildbrain_guide
      (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
    values (v_cap, 'zztest guide alpha', 'ZZTEST GUIDE ALPHA', 'ZZTEST Guide Alpha',
            'zztest-rules-v1', '{}'::jsonb);
  exception when unique_violation then
    -- Pinned by name: the collapse happens on the PRIMARY KEY, because the case variant
    -- derives the same guide_key. A bare `when unique_violation` would also be satisfied
    -- by the normalized-label unique constraint firing, which is a different guarantee.
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_guide_pkey' then v_dup_guide_label_rejected := true; end if;
  end;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'plm.wildbrain_guide'::regclass
       and conname = 'wildbrain_guide_normalized_label_uk'
       and contype = 'u'
  ) then
    raise exception 'D2 FAILED: the unique constraint on normalized_guide_label is missing';
  end if;

  -- D3. THE DEDUPLICATION RULE ITSELF. guide_key must be the case-folded,
  -- whitespace-collapsed, quote-stripped form of its own normalized label. A loader with
  -- a drifted normalizer would otherwise land two rows that should have been one, and
  -- nothing would say so.
  begin
    insert into plm.wildbrain_guide
      (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
    values (v_cap, 'ZZTEST  Guide "Beta"', 'ZZTEST Guide Beta', 'ZZTEST  Guide "Beta"',
            'zztest-rules-v1', '{}'::jsonb);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_guide_key_derivation_chk' then v_bad_guide_key_rejected := true; end if;
  end;

  -- D3b. ... and the CORRECTLY normalized form of that same messy label is accepted.
  -- Quote-stripped, whitespace-collapsed, case-folded.
  insert into plm.wildbrain_guide
    (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
  values (v_cap, 'zztest guide beta', 'ZZTEST Guide Beta', 'ZZTEST  Guide "Beta"',
          'zztest-rules-v1', '{}'::jsonb);
  select count(*) into v_n from plm.wildbrain_guide
   where capture_id = v_cap and guide_key = 'zztest guide beta';
  if v_n <> 1 then
    raise exception 'D3b FAILED: the correctly normalized guide key was not accepted';
  end if;

  -- D4. An alias no asset used is not evidence of anything.
  begin
    insert into plm.wildbrain_guide_alias (capture_id, guide_key, alias_label, asset_count, raw)
    values (v_cap, 'zztest guide alpha', 'ZZTEST Guide Alpha Unused', 0, '{}'::jsonb);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_guide_alias_count_pos_chk' then v_zero_alias_rejected := true; end if;
  end;

  -- D5. An asset-to-guide row must cite a KNOWN spelling of its guide. This is what keeps
  -- the per-asset evidence honest after the deduplication.
  begin
    insert into plm.wildbrain_asset_guide
      (capture_id, asset_source_id, guide_key, alias_label, raw)
    values (v_cap, 'ZZTEST-ASSET-1', 'zztest guide beta', 'ZZTEST Spelling Nobody Used', '{}'::jsonb);
  exception when foreign_key_violation then
    -- Pinned: this row also touches the asset FK and the guide FK, and either of those
    -- firing would satisfy a bare handler while proving nothing about the alias binding.
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_asset_guide_alias_fk' then v_unknown_alias_rejected := true; end if;
  end;

  -- D5b. AN ALIAS ROW IS RECONSTRUCTED, NEVER PORTAL VOCABULARY. This table has the same
  -- shape as a portal dictionary, so the pin is the only thing that says otherwise.
  begin
    insert into plm.wildbrain_guide_alias
      (capture_id, guide_key, alias_label, asset_count, relationship_truth, raw)
    values (v_cap, 'zztest guide alpha', 'ZZTEST Guide Alpha Declared', 1, 'declared', '{}'::jsonb);
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_guide_alias_truth_chk' then v_declared_alias_rejected := true; end if;
  end;

  -- D6. asset_uuid is unique within a capture.
  begin
    insert into plm.wildbrain_asset
      (capture_id, asset_source_id, asset_uuid, asset_name, era_source_id,
       universe_label, source_hash, raw)
    values (v_cap, 'ZZTEST-ASSET-2', 'zztest-uuid-0001', 'ZZTEST Asset Two', 'ZZTEST-ERA-CHILD',
            'ZZTEST Universe', repeat('f', 64), '{}'::jsonb);
  exception when unique_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_asset_uuid_uk' then v_dup_asset_uuid_rejected := true; end if;
  end;

  if not v_dup_guide_label_rejected then raise exception 'D2 FAILED: a case variant of an existing guide landed as a SECOND guide instead of collapsing on wildbrain_guide_pkey'; end if;
  if not v_bad_guide_key_rejected then raise exception 'D3 FAILED: a guide_key that is not the normalization of its label was accepted'; end if;
  if not v_zero_alias_rejected then raise exception 'D4 FAILED: a guide alias with asset_count 0 was accepted'; end if;
  if not v_unknown_alias_rejected then raise exception 'D5 FAILED: an asset-guide row cited an unknown alias, or a DIFFERENT foreign key fired -- wildbrain_asset_guide_alias_fk was not what refused it'; end if;
  if not v_declared_alias_rejected then raise exception 'D5b FAILED: a guide alias was allowed to claim relationship_truth = declared -- reconstructed alias rows would be indistinguishable from portal vocabulary'; end if;
  if not v_dup_asset_uuid_rejected then raise exception 'D6 FAILED: a duplicate asset_uuid was accepted'; end if;

  raise notice 'D: deduplication and uniqueness hold, each rejection pinned to its named constraint.';
end;
$$;


-- =====================================================================================
-- E. CHARACTER IDENTITY IS THE NUMERIC ID. The tests that must PASS by accepting data
--    a stricter schema would have rejected.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_n integer;
  v_truth_rejected boolean := false;
  v_msg text;
begin
  raise notice '=== E. CHARACTER IDENTITY ===';
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:A';

  -- E1. Two ids, one normalized label -- already landed in the fixture. Assert it, and
  -- assert that no unique constraint or unique index on the normalized label exists,
  -- because a future session "tidying up" would break a valid capture.
  select count(*) into v_n from plm.wildbrain_character
   where capture_id = v_cap and normalized_character_label = 'zztest character';
  if v_n <> 2 then
    raise exception 'E1 FAILED: expected 2 characters sharing one normalized label, found %', v_n;
  end if;

  select count(*) into v_n
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'plm' and c.relname = 'wildbrain_character' and i.indisunique
     and (select bool_or(a.attname = 'normalized_character_label')
            from pg_attribute a
           where a.attrelid = c.oid and a.attnum = any (i.indkey));
  if v_n <> 0 then
    raise exception
      'E1 FAILED: a unique index covers wildbrain_character.normalized_character_label -- '
      'that rejects a valid capture, because the portal issues distinct ids to name-twins';
  end if;

  -- E2. AN ASSET CHARACTER THAT IS NOT IN THE PORTAL'S DICTIONARY MUST BE ACCEPTED.
  -- This is the single most important "must pass" test in the file: a constraint
  -- requiring every asset character to resolve against the dictionary would reject a
  -- capture that is entirely valid, and 9 of this capture's characters are in exactly
  -- that position.
  select count(*) into v_n
    from plm.wildbrain_asset_character ac
    join plm.wildbrain_character c
      on c.capture_id = ac.capture_id and c.character_source_id = ac.character_source_id
   where ac.capture_id = v_cap and c.in_source_dictionary = false;
  if v_n <> 1 then
    raise exception
      'E2 FAILED: expected 1 asset-character link to a character outside the portal dictionary, found %', v_n;
  end if;

  -- E3. The declared table may never be reused for something we inferred.
  begin
    insert into plm.wildbrain_asset_character
      (capture_id, asset_source_id, character_source_id, relationship_truth, raw)
    values (v_cap, 'ZZTEST-ASSET-1', '900003', 'inferred', '{}'::jsonb);
  exception
    when check_violation then
      -- Pinned: this row has several CHECKs on it, and only ONE of them is the guarantee
      -- under test.
      get stacked diagnostics v_msg = constraint_name;
      if v_msg = 'wildbrain_asset_character_truth_chk' then v_truth_rejected := true; end if;
    when foreign_key_violation then
      raise exception 'E3 INCONCLUSIVE: the FK fired before the relationship_truth check could';
  end;
  if not v_truth_rejected then
    raise exception 'E3 FAILED: an inferred link was stored in the portal-declared table, or a DIFFERENT check fired -- wildbrain_asset_character_truth_chk was not what refused it';
  end if;

  raise notice 'E: character identity is the numeric id; out-of-dictionary characters are accepted.';
end;
$$;


-- =====================================================================================
-- F. THE PUBLICATION GATE. Each capture below isolates ONE failure mode.
-- =====================================================================================

-- F1. A clean capture completes -- INCLUDING one whose characters are not all in the
--     portal's dictionary. If this ever starts failing, the gate has grown a rule that
--     rejects valid licensor data.
do $$
declare
  v_cap uuid;
  v_status text;
  v_obs jsonb;
begin
  raise notice '=== F1. CLEAN CAPTURE COMPLETES ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:B',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('1', 40),
    p_source_manifest_sha256 => repeat('2', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-02-01 00:00:00+00',
    p_expected_counts        => '{"eras":1,"creative_groups":0,"asset_categories":0,
                                  "asset_natures":0,"characters":1,"assets":1,
                                  "asset_characters":1,"guides":1,"guide_aliases":1,
                                  "asset_guides":1}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true,
    p_reported_total         => 1
  );

  insert into plm.wildbrain_era
    (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
  values (v_cap, 'ZZTEST-ERA-ROOT', null, 'ZZTEST Era Root', 'zztest era root', true, '{}'::jsonb);

  -- in_source_dictionary = false ON PURPOSE. This must not block completion.
  insert into plm.wildbrain_character
    (capture_id, character_source_id, character_label, normalized_character_label,
     in_source_dictionary, raw)
  values (v_cap, '900101', 'ZZTEST Ghost Character', 'zztest ghost character', false, '{}'::jsonb);

  insert into plm.wildbrain_asset
    (capture_id, asset_source_id, asset_uuid, asset_name, era_source_id,
     universe_label, raw_keyword_text, source_hash, raw)
  values (v_cap, 'ZZTEST-ASSET-B1', 'zztest-uuid-b001', 'ZZTEST Asset B1', 'ZZTEST-ERA-ROOT',
          'ZZTEST Universe', 'zztest guide gamma', repeat('3', 64), '{}'::jsonb);

  insert into plm.wildbrain_asset_character (capture_id, asset_source_id, character_source_id, raw)
  values (v_cap, 'ZZTEST-ASSET-B1', '900101', '{}'::jsonb);

  insert into plm.wildbrain_guide
    (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
  values (v_cap, 'zztest guide gamma', 'ZZTEST Guide Gamma', 'zztest guide gamma',
          'zztest-rules-v1', '{}'::jsonb);
  insert into plm.wildbrain_guide_alias (capture_id, guide_key, alias_label, asset_count, raw)
  values (v_cap, 'zztest guide gamma', 'ZZTEST Guide Gamma', 1, '{}'::jsonb);
  insert into plm.wildbrain_asset_guide
    (capture_id, asset_source_id, guide_key, alias_label, raw)
  values (v_cap, 'ZZTEST-ASSET-B1', 'zztest guide gamma', 'ZZTEST Guide Gamma', '{}'::jsonb);

  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);

  select status, observed_counts into v_status, v_obs from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception 'F1 FAILED: a clean capture was not published (status %), errors: %',
      v_status, (select error_summary from plm.wildbrain_capture where id = v_cap);
  end if;
  if (v_obs ->> 'assets')::int <> 1 or (v_obs ->> 'guide_aliases')::int <> 1 then
    raise exception 'F1 FAILED: observed counts were not measured from the tables: %', v_obs;
  end if;
  if (v_obs ->> 'characters_not_in_source_dictionary')::int <> 1 then
    raise exception 'F1 FAILED: the out-of-dictionary character was not counted as evidence: %', v_obs;
  end if;
  if (select load_completed_at from plm.wildbrain_capture where id = v_cap) is null then
    raise exception 'F1 FAILED: a complete capture has no completion time';
  end if;

  -- Idempotent: a retry after a successful finalize is a no-op, not an error.
  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);
  select status into v_status from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'complete' then
    raise exception 'F1 FAILED: re-finalizing a complete capture changed its status to %', v_status;
  end if;

  raise notice 'F1: clean capture completed and re-finalizing is a no-op.';
end;
$$;

-- F2. pagination_verified = false must reject. The portal silently ignores offsets and
--     returns page one forever with HTTP 200, so an unverified pager means the capture
--     may be short with nothing anywhere saying so.
do $$
declare
  v_cap uuid;
  v_status text;
  v_err jsonb;
begin
  raise notice '=== F2. UNVERIFIED PAGINATION IS REJECTED ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:C',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('4', 40),
    p_source_manifest_sha256 => repeat('5', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-03-01 00:00:00+00',
    p_expected_counts        => '{"eras":0,"creative_groups":0,"asset_categories":0,
                                  "asset_natures":0,"characters":0,"assets":0,
                                  "asset_characters":0,"guides":0,"guide_aliases":0,
                                  "asset_guides":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => false
  );

  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);

  select status, error_summary into v_status, v_err from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'F2 FAILED: a capture with unverified pagination reached status %', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'pagination_not_verified') then
    raise exception 'F2 FAILED: the rejection did not name pagination_not_verified: %', v_err;
  end if;
  if (select load_completed_at from plm.wildbrain_capture where id = v_cap) is not null then
    raise exception 'F2 FAILED: a rejected capture carries a completion time';
  end if;

  raise notice 'F2: unverified pagination rejected, and the reason is persisted.';
end;
$$;

-- F3. A count that differs from the contract must reject, and loader-reported errors must
--     reject on their own.
do $$
declare
  v_cap uuid;
  v_status text;
  v_err jsonb;
begin
  raise notice '=== F3. COUNT DRIFT AND LOADER ERRORS ARE REJECTED ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:D',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('6', 40),
    p_source_manifest_sha256 => repeat('7', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-04-01 00:00:00+00',
    -- Says one era is expected; none is loaded. This is the shape a silently truncated
    -- capture has.
    p_expected_counts        => '{"eras":1,"creative_groups":0,"asset_categories":0,
                                  "asset_natures":0,"characters":0,"assets":0,
                                  "asset_characters":0,"guides":0,"guide_aliases":0,
                                  "asset_guides":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );

  perform plm.finalize_wildbrain_capture(
    v_cap, null, '[{"code":"zztest_loader_problem"}]'::jsonb);

  select status, error_summary into v_status, v_err from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'F3 FAILED: a short capture with loader errors reached status %', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e where e ->> 'code' = 'count_mismatch') then
    raise exception 'F3 FAILED: the rejection did not name count_mismatch: %', v_err;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'loader_reported_errors') then
    raise exception 'F3 FAILED: the rejection did not carry the loader''s own errors: %', v_err;
  end if;

  raise notice 'F3: count drift and loader-reported errors both reject.';
end;
$$;

-- F4. A missing expected-count key is a rejection, not a skipped check. A skipped check
--     is how a truncated capture passes.
do $$
declare
  v_cap uuid;
  v_status text;
  v_err jsonb;
begin
  raise notice '=== F4. A MISSING EXPECTED COUNT IS A REJECTION ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:E',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('8', 40),
    p_source_manifest_sha256 => repeat('9', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-05-01 00:00:00+00',
    p_expected_counts        => '{"eras":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );

  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);

  select status, error_summary into v_status, v_err from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'F4 FAILED: a capture missing nine expected-count keys reached status %', v_status;
  end if;
  if (select count(*) from jsonb_array_elements(v_err) e
       where e ->> 'code' = 'expected_count_missing') <> 9 then
    raise exception 'F4 FAILED: expected 9 expected_count_missing errors, got %', v_err;
  end if;

  raise notice 'F4: a missing expected-count key rejects, once per missing entity.';
end;
$$;

-- F5. A rejected capture is terminal evidence: it must not be re-openable, and a
--     complete capture must never be re-opened either.
do $$
declare
  v_cap uuid;
  v_reopen_refused boolean := false;
  v_same uuid;
  v_msg text;
begin
  raise notice '=== F5. TERMINAL AND COMPLETE CAPTURES ARE NOT RE-OPENED ===';
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:C';

  begin
    perform plm.begin_wildbrain_capture(
      p_capture_key            => 'zztest-wildbrain:C',
      p_source_repository      => 'u2giants/zztest-fixture',
      p_source_commit_sha      => repeat('4', 40),
      p_source_manifest_sha256 => repeat('5', 64),
      p_portal_base_url        => 'https://zztest.example.invalid/',
      p_source_captured_at     => timestamptz '2026-03-01 00:00:00+00',
      p_expected_counts        => '{"eras":0}'::jsonb,
      p_raw_summary            => '{"fixture":true}'::jsonb,
      p_created_by             => 'zztest',
      p_pagination_verified    => true
    );
  -- `when raise_exception` (SQLSTATE P0001), not `when others`, AND the message is
  -- matched: `when others` would also swallow a typo, an undefined function or a wrong
  -- argument type and report all of them as a passing test.
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%start a NEW capture rather than reusing it%' then
      v_reopen_refused := true;
    end if;
  end;
  if not v_reopen_refused then
    raise exception 'F5 FAILED: a rejected capture was re-opened, or it failed for some OTHER reason than the terminal-status refusal';
  end if;

  -- The complete one returns its own id, unchanged, and stays complete.
  select id into strict v_cap from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:B';
  v_same := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:B',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('1', 40),
    p_source_manifest_sha256 => repeat('2', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-02-01 00:00:00+00',
    p_expected_counts        => '{"eras":1}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );
  if v_same is distinct from v_cap then
    raise exception 'F5 FAILED: re-running an identical complete capture minted a NEW capture';
  end if;
  if (select status from plm.wildbrain_capture where id = v_cap) <> 'complete' then
    raise exception 'F5 FAILED: re-running an identical complete capture disturbed its status';
  end if;

  raise notice 'F5: terminal captures are not re-opened; an identical complete capture is idempotent.';
end;
$$;

-- F6. Same capture key, DIFFERENT source bytes, is a contradiction and must be refused --
--     appending different source data under an existing key makes the snapshot
--     unreconstructable.
do $$
declare
  v_manifest_refused boolean := false;
  v_commit_refused   boolean := false;
  v_msg text;
begin
  raise notice '=== F6. SAME KEY, DIFFERENT BYTES, IS REFUSED ===';
  begin
    perform plm.begin_wildbrain_capture(
      p_capture_key            => 'zztest-wildbrain:B',
      p_source_repository      => 'u2giants/zztest-fixture',
      p_source_commit_sha      => repeat('1', 40),
      p_source_manifest_sha256 => repeat('c', 64),   -- different manifest
      p_portal_base_url        => 'https://zztest.example.invalid/',
      p_source_captured_at     => timestamptz '2026-02-01 00:00:00+00',
      p_expected_counts        => '{"eras":1}'::jsonb,
      p_raw_summary            => '{"fixture":true}'::jsonb,
      p_created_by             => 'zztest');
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%DIFFERENT source manifest hash%' then v_manifest_refused := true; end if;
  end;

  begin
    perform plm.begin_wildbrain_capture(
      p_capture_key            => 'zztest-wildbrain:B',
      p_source_repository      => 'u2giants/zztest-fixture',
      p_source_commit_sha      => repeat('c', 40),   -- different commit
      p_source_manifest_sha256 => repeat('2', 64),
      p_portal_base_url        => 'https://zztest.example.invalid/',
      p_source_captured_at     => timestamptz '2026-02-01 00:00:00+00',
      p_expected_counts        => '{"eras":1}'::jsonb,
      p_raw_summary            => '{"fixture":true}'::jsonb,
      p_created_by             => 'zztest');
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%DIFFERENT source commit sha%' then v_commit_refused := true; end if;
  end;

  if not v_manifest_refused then raise exception 'F6 FAILED: a differing source manifest was accepted under an existing capture key, or the refusal was not the manifest-mismatch one'; end if;
  if not v_commit_refused then raise exception 'F6 FAILED: a differing source commit was accepted under an existing capture key, or the refusal was not the commit-mismatch one'; end if;
  raise notice 'F6: a same-key capture with different bytes is refused.';
end;
$$;

-- F7. begin_ validates its arguments loudly: SHA formats and the zero-media scope.
do $$
declare
  v_bad_sha boolean := false;
  v_bad_manifest boolean := false;
  v_media boolean := false;
  v_null_count boolean := false;
  v_neg_count boolean := false;
  v_msg text;
begin
  raise notice '=== F7. begin_ ARGUMENT VALIDATION ===';
  begin
    perform plm.begin_wildbrain_capture('zztest-wildbrain:F', 'u2giants/zztest-fixture',
      'NOTASHA', repeat('2', 64), 'https://zztest.example.invalid/',
      timestamptz '2026-06-01 00:00:00+00', '{"eras":0}'::jsonb, '{}'::jsonb, 'zztest');
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%source_commit_sha must be a 40-character lowercase hex sha%' then
      v_bad_sha := true;
    end if;
  end;

  begin
    perform plm.begin_wildbrain_capture('zztest-wildbrain:G', 'u2giants/zztest-fixture',
      repeat('1', 40), 'NOTAMANIFEST', 'https://zztest.example.invalid/',
      timestamptz '2026-06-01 00:00:00+00', '{"eras":0}'::jsonb, '{}'::jsonb, 'zztest');
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%source_manifest_sha256 must be a 64-character lowercase hex sha%' then
      v_bad_manifest := true;
    end if;
  end;

  begin
    perform plm.begin_wildbrain_capture('zztest-wildbrain:H', 'u2giants/zztest-fixture',
      repeat('1', 40), repeat('2', 64), 'https://zztest.example.invalid/',
      timestamptz '2026-06-01 00:00:00+00', '{"eras":0}'::jsonb, '{}'::jsonb, 'zztest',
      true, null, 1);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%media_downloaded must be 0%' then v_media := true; end if;
  end;

  -- F7d. A JSON `null` EXPECTED COUNT IS REFUSED AT THE DOOR. This is the exact object a
  -- loader builds from jsonb_build_object('assets', v_unset_count): the key is PRESENT,
  -- so a `?` test calls it supplied, while every comparison against it is SQL NULL and
  -- therefore never false -- a silently skipped count check, which is how the portal's
  -- ignored-offset pager gets a first page published as a whole capture.
  begin
    perform plm.begin_wildbrain_capture('zztest-wildbrain:NULLCOUNT', 'u2giants/zztest-fixture',
      repeat('1', 40), repeat('2', 64), 'https://zztest.example.invalid/',
      timestamptz '2026-06-01 00:00:00+00',
      '{"eras":0,"creative_groups":0,"asset_categories":0,"asset_natures":0,"characters":0,
        "assets":null,"asset_characters":0,"guides":0,"guide_aliases":0,
        "asset_guides":0}'::jsonb,
      '{}'::jsonb, 'zztest', true);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%expected_counts value must be a JSON number that is a non-negative integer%' then
      v_null_count := true;
    end if;
  end;
  if exists (select 1 from plm.wildbrain_capture where capture_key = 'zztest-wildbrain:NULLCOUNT') then
    raise exception 'F7d FAILED: a capture whose expected_counts carried a JSON null was created anyway';
  end if;

  -- F7e. ... and a fractional or negative expectation is not a count either.
  begin
    perform plm.begin_wildbrain_capture('zztest-wildbrain:NEGCOUNT', 'u2giants/zztest-fixture',
      repeat('1', 40), repeat('2', 64), 'https://zztest.example.invalid/',
      timestamptz '2026-06-01 00:00:00+00', '{"eras":-1}'::jsonb, '{}'::jsonb, 'zztest', true);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '%expected_counts value must be a JSON number that is a non-negative integer%' then
      v_neg_count := true;
    end if;
  end;

  if not v_bad_sha then raise exception 'F7 FAILED: a malformed source commit sha was accepted, or the refusal named something else'; end if;
  if not v_bad_manifest then raise exception 'F7 FAILED: a malformed manifest sha256 was accepted, or the refusal named something else'; end if;
  if not v_media then raise exception 'F7 FAILED: a nonzero media_downloaded was accepted, or the refusal named something else'; end if;
  if not v_null_count then raise exception 'F7d FAILED: begin_ accepted an expected_counts key whose value was JSON null -- that count would never be checked at the publication gate'; end if;
  if not v_neg_count then raise exception 'F7e FAILED: begin_ accepted a negative expected count'; end if;
  raise notice 'F7: begin_ rejects malformed shas, any media download, and a null or negative expected count -- each by its own named message.';
end;
$$;


-- F8. THE PUBLICATION GATE ITSELF MUST REFUSE A JSON-NULL EXPECTED COUNT, not merely
--     begin_. F7d proves the front door is shut; this proves the gate does not depend on
--     it. The null is injected by UPDATE, as the OWNER -- deliberately going round
--     begin_, because the whole point is that the gate re-reads the stored object rather
--     than trusting that validation ran when the row was created. Without this the ten
--     required keys are only nine: `?` says "assets" is supplied, v_want is SQL NULL,
--     `v_n <> NULL` is UNKNOWN, and the assets count is never compared to anything.
do $$
declare
  v_cap uuid;
  v_status text;
  v_err jsonb;
begin
  raise notice '=== F8. A JSON-NULL EXPECTED COUNT IS REJECTED AT THE GATE ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:N',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('b', 40),
    p_source_manifest_sha256 => repeat('d', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-07-01 00:00:00+00',
    p_expected_counts        => '{"eras":0,"creative_groups":0,"asset_categories":0,
                                  "asset_natures":0,"characters":0,"assets":0,
                                  "asset_characters":0,"guides":0,"guide_aliases":0,
                                  "asset_guides":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );

  -- Every other key stays a valid zero and matches reality, and pagination is verified,
  -- so `assets` is the ONLY thing standing between this capture and publication. If the
  -- null were treated as a supplied count, this capture would complete.
  update plm.wildbrain_capture
     set expected_counts = jsonb_set(expected_counts, '{assets}', 'null'::jsonb)
   where id = v_cap;

  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);

  select status, error_summary into v_status, v_err from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception
      'F8 FAILED: a capture whose expected assets count was JSON null reached status % -- the count was never checked', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'expected_count_not_a_number'
                    and e ->> 'entity' = 'assets') then
    raise exception
      'F8 FAILED: the rejection did not name expected_count_not_a_number for assets: %', v_err;
  end if;

  raise notice 'F8: a JSON-null expected count rejects at the gate, named by entity.';
end;
$$;

-- F9. AN ERA CYCLE MUST REJECT. A -> B -> A satisfies every constraint on the table: the
--     self-parent CHECK stops only A -> A, the composite FK only stops a parent in
--     another capture, is_root agrees with the (non-null) parent on both rows, and the
--     era count is 2 exactly as expected_counts says. Only the gate can see it.
do $$
declare
  v_cap uuid;
  v_status text;
  v_err jsonb;
begin
  raise notice '=== F9. AN ERA CYCLE IS REJECTED ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:O',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('e', 40),
    p_source_manifest_sha256 => repeat('e', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-08-01 00:00:00+00',
    p_expected_counts        => '{"eras":2,"creative_groups":0,"asset_categories":0,
                                  "asset_natures":0,"characters":0,"assets":0,
                                  "asset_characters":0,"guides":0,"guide_aliases":0,
                                  "asset_guides":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );

  -- Two eras that parent each other. The FK is DEFERRABLE INITIALLY DEFERRED, and both
  -- parents DO resolve -- in each other -- so making constraints immediate raises
  -- nothing. That is exactly the danger: the rows are perfectly legal.
  insert into plm.wildbrain_era
    (capture_id, era_source_id, parent_era_source_id, era_label, normalized_era_label, is_root, raw)
  values
    (v_cap, 'ZZTEST-ERA-LOOP-A', 'ZZTEST-ERA-LOOP-B', 'ZZTEST Era Loop A', 'zztest era loop a', false, '{}'::jsonb),
    (v_cap, 'ZZTEST-ERA-LOOP-B', 'ZZTEST-ERA-LOOP-A', 'ZZTEST Era Loop B', 'zztest era loop b', false, '{}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;

  perform plm.finalize_wildbrain_capture(v_cap, null, '[]'::jsonb);

  select status, error_summary into v_status, v_err from plm.wildbrain_capture where id = v_cap;
  if v_status <> 'rejected' then
    raise exception 'F9 FAILED: a capture containing an era cycle reached status %', v_status;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_err) e
                  where e ->> 'code' = 'era_cycle_or_unreachable') then
    raise exception 'F9 FAILED: the rejection did not name era_cycle_or_unreachable: %', v_err;
  end if;
  -- A cycle with no root also means no root at all, and that must be said separately --
  -- otherwise a future edit could satisfy one message while leaving the other shape open.
  if not exists (select 1 from jsonb_array_elements(v_err) e where e ->> 'code' = 'no_root_era') then
    raise exception 'F9 FAILED: a capture with eras but no root era was not named as such: %', v_err;
  end if;

  raise notice 'F9: an era cycle is refused by the gate; the walk terminates.';
end;
$$;

-- F10. RESUMING MUST NOT SILENTLY TURN THE PAGER PROOF OFF. p_pagination_verified
--      defaults to false, so a crash-and-retry that simply calls begin_ again with the
--      same identity arguments would otherwise clear a flag the scrape had already
--      proved, finalize would reject -- and a rejected capture_key can NEVER be reused,
--      so the same source bytes would need a brand-new key. The flag is sticky-true.
do $$
declare
  v_cap uuid;
  v_again uuid;
begin
  raise notice '=== F10. A RESUME CANNOT CLEAR pagination_verified ===';
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:P',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('f', 40),
    p_source_manifest_sha256 => repeat('f', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-09-01 00:00:00+00',
    p_expected_counts        => '{"eras":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true,
    p_reported_total         => 7
  );

  -- The retry: identical identity arguments, every optional argument left at its default.
  v_again := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:P',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('f', 40),
    p_source_manifest_sha256 => repeat('f', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-09-01 00:00:00+00',
    p_expected_counts        => '{"eras":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest'
  );

  if v_again is distinct from v_cap then
    raise exception 'F10 FAILED: a resume minted a NEW capture instead of returning the loading one';
  end if;
  if not (select pagination_verified from plm.wildbrain_capture where id = v_cap) then
    raise exception
      'F10 FAILED: a resume with the default argument CLEARED pagination_verified -- the capture key is now unusable and the same source bytes need a new one';
  end if;
  if (select reported_total from plm.wildbrain_capture where id = v_cap) <> 7 then
    raise exception 'F10 FAILED: a resume with the default argument erased reported_total';
  end if;

  raise notice 'F10: pagination_verified survives a resume that omits the argument.';
end;
$$;


-- =====================================================================================
-- G. CAPTURE-ROW INVARIANTS that no write path may bypass, tested as the OWNER -- i.e.
--    against the strongest possible attacker, one who is not stopped by the grants.
--
--    EVERY assertion here is pinned to a constraint NAME. Capture C -- the one section F2
--    rejected -- is deliberately NOT used: it already has pagination_verified = false and
--    a non-empty error_summary, so an UPDATE setting status = 'complete' violates THREE
--    checks at once and a handler that accepted any check_violation would stay green even
--    if the constraint under test were deleted outright. These tests use a capture that
--    satisfies every OTHER precondition, so exactly one constraint can possibly fire.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_no_time boolean := false;
  v_no_pagination boolean := false;
  v_with_errors boolean := false;
  v_truncated boolean := false;
  v_media boolean := false;
  v_msg text;
begin
  raise notice '=== G. CAPTURE-ROW INVARIANTS ===';
  -- A capture that is CLEAN in every respect except the one under test: pagination
  -- verified, error_summary empty, media and truncation zero, still `loading`. Every
  -- update below therefore has exactly ONE constraint it can violate, which is what makes
  -- the constraint name in the assertion meaningful.
  v_cap := plm.begin_wildbrain_capture(
    p_capture_key            => 'zztest-wildbrain:Q',
    p_source_repository      => 'u2giants/zztest-fixture',
    p_source_commit_sha      => repeat('0', 40),
    p_source_manifest_sha256 => repeat('0', 64),
    p_portal_base_url        => 'https://zztest.example.invalid/',
    p_source_captured_at     => timestamptz '2026-10-01 00:00:00+00',
    p_expected_counts        => '{"eras":0}'::jsonb,
    p_raw_summary            => '{"fixture":true}'::jsonb,
    p_created_by             => 'zztest',
    p_pagination_verified    => true
  );
  if (select pagination_verified from plm.wildbrain_capture where id = v_cap) is not true
     or (select error_summary from plm.wildbrain_capture where id = v_cap) <> '[]'::jsonb then
    raise exception
      'G SETUP FAILED: the fixture capture does not satisfy the other complete-status preconditions, so the tests below could pass on the wrong constraint';
  end if;

  -- G1. `complete` with no completion time. The row is otherwise publishable, so
  -- wildbrain_capture_complete_time_chk is the ONLY constraint that can refuse it --
  -- delete that constraint and this test goes red, which is the entire point.
  begin
    update plm.wildbrain_capture set status = 'complete', load_completed_at = null where id = v_cap;
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_capture_complete_time_chk' then v_no_time := true; end if;
  end;

  begin
    update plm.wildbrain_capture
       set status = 'complete', load_completed_at = now(), pagination_verified = false,
           error_summary = '[]'::jsonb
     where id = v_cap;
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_capture_complete_pagination_chk' then v_no_pagination := true; end if;
  end;

  begin
    update plm.wildbrain_capture
       set status = 'complete', load_completed_at = now(), pagination_verified = true,
           error_summary = '[{"code":"zztest"}]'::jsonb
     where id = v_cap;
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_capture_complete_no_errors_chk' then v_with_errors := true; end if;
  end;

  begin
    update plm.wildbrain_capture set truncated_child_lists = 1 where id = v_cap;
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_capture_truncated_zero_chk' then v_truncated := true; end if;
  end;

  begin
    update plm.wildbrain_capture set media_downloaded = 1 where id = v_cap;
  exception when check_violation then
    get stacked diagnostics v_msg = constraint_name;
    if v_msg = 'wildbrain_capture_media_zero_chk' then v_media := true; end if;
  end;

  if not v_no_time then raise exception 'G FAILED: a complete capture without a completion time was accepted, or a DIFFERENT constraint refused it -- wildbrain_capture_complete_time_chk was not what fired'; end if;
  if not v_no_pagination then raise exception 'G FAILED: a complete capture with unverified pagination was accepted, or wildbrain_capture_complete_pagination_chk was not what fired'; end if;
  if not v_with_errors then raise exception 'G FAILED: a complete capture with validation errors was accepted, or wildbrain_capture_complete_no_errors_chk was not what fired'; end if;
  if not v_truncated then raise exception 'G FAILED: a nonzero truncated_child_lists was accepted, or wildbrain_capture_truncated_zero_chk was not what fired'; end if;
  if not v_media then raise exception 'G FAILED: a nonzero media_downloaded was accepted, or wildbrain_capture_media_zero_chk was not what fired'; end if;

  raise notice 'G: the complete-status preconditions and the zero-media/zero-truncation scope hold, each pinned to its own named constraint.';
end;
$$;


-- =====================================================================================
-- H. THIS LANDING WRITES NOTHING CANONICAL. No reconciliation column, no core/dam FK.
-- =====================================================================================
do $$
declare
  v_n integer;
begin
  raise notice '=== H. NOTHING CANONICAL ===';

  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
   where n.nspname = 'plm' and t.relname like 'wildbrain\_%' and c.contype = 'f'
     and rn.nspname in ('core','dam','api','pim');
  if v_n <> 0 then
    raise exception 'H FAILED: % foreign key(s) from the wildbrain landing into a canonical schema', v_n;
  end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and (column_name like 'core\_%' or column_name like 'dam\_%'
          or column_name in ('resolution_status','resolved_at','resolved_by'));
  if v_n <> 0 then
    raise exception 'H FAILED: % reconciliation column(s) exist; this release resolves nothing', v_n;
  end if;

  raise notice 'H: the landing is self-contained -- nothing canonical is referenced or written.';
end;
$$;

do $$
begin
  raise notice '=== WILDBRAIN LANDING CONTRACT TESTS: ALL SECTIONS PASSED ===';
end;
$$;
