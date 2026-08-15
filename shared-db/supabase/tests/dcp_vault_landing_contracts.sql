-- =====================================================================================
-- Contract tests for migrations 20260810190000 and 20260810190100 -- the Disney DCP Vault
-- source landing schema and its chunked loader protocol (issue #665).
--
-- -------------------------------------------------------------------------------------
-- CI DOES NOT RUN THIS FILE. STATED PLAINLY SO NOBODY ASSUMES OTHERWISE.
-- Nothing in .github/workflows executes supabase/tests/ (issue #695). A green pull request
-- is NOT evidence that any assertion below ever ran. This file is evidence only when a
-- human runs it and pastes the output. Do not cite "tests exist" as verification.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as a SUPERUSER connection (the migration
--   owner -- `postgres`), on the SESSION pooler port 5432, NOT the transaction pooler
--   port 6543:
--       Connect with psql as the migration owner. Build the URL from its PARTS rather
--       than pasting a user-at-host string: the PII forward guard reads that shape as
--       an email address and fails the pull request (AGENTS.md section 6.14).
--         scheme  postgresql://
--         user    postgres.rjyboqwcdzcocqgmsyel
--         host    aws-0-us-east-1.pooler.supabase.com
--         port    5432          <- SESSION pooler. NOT 6543.
--         db      postgres      params: sslmode=require
--       then, with that URL in DCP_TEST_URL:
--         psql "$DCP_TEST_URL" -v ON_ERROR_STOP=1 -f supabase/tests/dcp_vault_landing_contracts.sql
--   On port 6543 the transaction pooler wraps the whole batch in one implicit transaction
--   and stalls -- observed on this database 2026-08-09.
--
-- WHY EVERY "must be refused" CHECK TRAPS sqlstate 'P0001' AND NOT `when others`:
--   `when others` is satisfied by ANY error. A NOT NULL violation, a unique violation, a
--   foreign-key violation or a typo in the test's own fixture would all set the flag and
--   the section would PASS FOR THE WRONG REASON -- reporting that a guard works when the
--   statement never reached it. Every guard in these two migrations raises with
--   `using errcode = 'P0001'`, so that is what is trapped. A refusal from anything else
--   now propagates and fails the run, which is the correct outcome.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No real Disney tile
--   slug, property, franchise, style guide, region, DAM path, file name or portal URL
--   appears here. Fixtures use ZZTEST-* tokens, example.invalid URLs and the reserved uuid
--   prefix 99999999-9999-4999-8999-*.
--
-- SIDE EFFECTS: NONE. Every section that writes runs inside an explicit transaction that
--   ends in ROLLBACK, and section H re-asserts that against the committed state afterwards.
--
-- WHAT IT ASSERTS. Every assertion targets the OBJECT and its BEHAVIOUR -- to_regclass,
--   pg_trigger, pg_policy, has_table_privilege, and real statements that must be refused.
--   NOT ONE assertion reads a migration ledger row: a ledger row proves a file ran, never
--   that it did what it claimed. Every count check is written so that an EMPTY set FAILS.
--     A  The ten tables and the fourteen functions exist (to_regclass / pg_proc).
--     B  PRIVILEGES: service_role holds SELECT and INSERT and NOTHING ELSE -- no UPDATE,
--        DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. anon and public hold nothing.
--        The table list is ENUMERATED FROM pg_class, so a plm.dcp_* table added later
--        without a matching revoke FAILS here rather than escaping the check.
--     C  RLS: enabled on every table, exactly one SELECT policy each, to {authenticated},
--        and THE PREDICATE IS NOT PERMISSIVE -- `using (true)` fails. That shape was a
--        live security defect on the Disney OPA extract; this is the same licensor.
--     D  THE NULL-ROLE CASE: plm.dcp_loader_privilege_ok returns FALSE for NULL/NULL and
--        for empty strings, and TRUE only on a positive match. This is the exact condition
--        that holds inside a migration.
--     E  IMMUTABILITY ACTUALLY BLOCKS A WRITE. Not "the trigger exists" -- real INSERT,
--        UPDATE and DELETE statements against a completed crawl are executed and must all
--        raise. E6 is the INSERT case specifically: section 7 revokes UPDATE, DELETE and
--        TRUNCATE from service_role but KEEPS INSERT, so INSERT is the only mutating
--        operation still available and therefore the one worth proving. E7 covers the
--        deliberate dcp_load_exception carve-out (resolution columns stay writable, source
--        fields do not). E8 reads back the STORED waived_at written by
--        plm.close_dcp_crawl_gap and asserts it is exactly 12:00:00 UTC.
--     F  The frozen row hash: shape, NULL-versus-empty distinction, tile-order
--        independence, empty-array-versus-NULL distinction, and separator refusal.
--     G  The America/New_York date trap: a midday-UTC waiver reads as the SAME calendar
--        date in both UTC and America/New_York; a midnight-UTC one does not.
--     H  No test data survived.
--
-- LAST RUN: NOT YET RUN against preview. This file is authored with the migrations and has
--   not been executed, because this session authors migrations and does not apply them.
--   Whoever applies 20260810190000 and 20260810190100 to preview must run this file and
--   record the result here.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. THE OBJECTS EXIST.
-- =====================================================================================
do $$
declare
  v_tables text[] := array[
    'dcp_crawl','dcp_portal_tile','dcp_style_guide','dcp_asset','dcp_crawl_section',
    'dcp_crawl_gap','dcp_asset_crawl','dcp_asset_tile_observation','dcp_load_exception',
    'dcp_chunk_ledger'
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
      'dcp_loader_privilege_ok','dcp_asset_row_hash','dcp_reject_completed_crawl_change',
      'dcp_load_exception_freeze',
      'dcp_reject_completed_source_field_change','dcp_crawl_freeze','begin_dcp_crawl',
      'open_dcp_crawl_section','close_dcp_crawl_section','load_dcp_asset_chunk',
      'record_dcp_crawl_gap','close_dcp_crawl_gap','finalize_dcp_crawl','fail_dcp_crawl'
    );
  if v_fns <> 14 then
    raise exception 'A FAILED: expected 14 plm.dcp_* / DCP loader functions in pg_proc, '
      'found %. A missing one means an object in the claim was never created.', v_fns;
  end if;

  raise notice 'A PASSED: 10 tables and 14 functions present.';
end;
$$;

-- =====================================================================================
-- B. PRIVILEGES. service_role: SELECT + INSERT and NOTHING ELSE. anon/public: nothing.
--
-- UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN all arrive FREE from the
-- plm schema default privilege (20260710135975:14) at CREATE TABLE time -- verified live
-- on 2026-08-10 as service_role=arwdDxtm on BOTH projects. Section 7 of 20260810190000
-- revokes them. TRUNCATE matters most: it fires NO row trigger, so one TRUNCATE would
-- erase a completed crawl's evidence without a single immutability trigger running.
--
-- The table list is READ FROM pg_class, not hard-coded, so a plm.dcp_* table added by a
-- later migration without a matching revoke FAILS here. The known names are then asserted
-- PRESENT, so a rename cannot silently shrink the coverage to zero and pass vacuously.
-- =====================================================================================
do $$
declare
  v_known text[] := array[
    'dcp_crawl','dcp_portal_tile','dcp_style_guide','dcp_asset','dcp_crawl_section',
    'dcp_crawl_gap','dcp_asset_crawl','dcp_asset_tile_observation','dcp_load_exception',
    'dcp_chunk_ledger'
  ];
  v_tables text[];
  v_forbidden text[] := array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
  t text;
  p text;
  v_bad int := 0;
  v_missing text[];
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace
    and c.relkind = 'r'
    and c.relname like 'dcp\_%';

  if v_tables is null or array_length(v_tables, 1) is null then
    raise exception 'B FAILED: pg_class returned NO plm.dcp_* tables. The enumeration is '
      'broken or the tables are gone -- this test would otherwise pass vacuously.';
  end if;

  select array_agg(k) into v_missing
  from unnest(v_known) k where not (k = any(v_tables));
  if v_missing is not null then
    raise exception 'B FAILED: expected plm.dcp_* table(s) absent from pg_class: %',
      array_to_string(v_missing, ', ');
  end if;

  foreach t in array v_tables loop
    -- MAINTAIN is PostgreSQL 17 and this server is 17.6, so it is asserted
    -- unconditionally here. On an older server has_table_privilege would raise on it --
    -- which is the correct outcome, not something to defend against: this schema is not
    -- supported on a server where MAINTAIN cannot be revoked.
    foreach p in array v_forbidden loop
      if has_table_privilege('service_role', 'plm.' || t, p) then
        raise warning 'B: service_role still holds % on plm.%', p, t;
        v_bad := v_bad + 1;
      end if;
    end loop;

    if not has_table_privilege('service_role', 'plm.' || t, 'SELECT') then
      raise warning 'B: service_role LOST SELECT on plm.% -- the loader cannot verify '
        'its own work', t;
      v_bad := v_bad + 1;
    end if;

    -- The CHUNK LEDGERS are written only by SECURITY DEFINER functions and deliberately
    -- grant service_role no INSERT; every landing table keeps it.
    --
    -- dcp_metadata_chunk_ledger (migration 20260811060000, the Phase-2 loader) was added
    -- to this carve-out because this section enumerates plm.dcp_* FROM pg_class rather
    -- than from a fixed list -- which is the design working exactly as intended. A new DCP
    -- table appeared and this assertion caught it on the first CI run rather than letting
    -- it escape. It belongs here for the same reason its Phase-1 sibling does: its rows
    -- are written solely by definer functions, so granting service_role INSERT would hand
    -- out a privilege nothing uses and let a ledger row be forged outside the loader.
    if t not in ('dcp_chunk_ledger', 'dcp_metadata_chunk_ledger')
       and not has_table_privilege('service_role', 'plm.' || t, 'INSERT') then
      raise warning 'B: service_role LOST INSERT on plm.%', t;
      v_bad := v_bad + 1;
    end if;

    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('anon', 'plm.' || t, p) then
        raise warning 'B: anon holds % on plm.% -- confidential licensor data', p, t;
        v_bad := v_bad + 1;
      end if;
    end loop;
  end loop;

  if v_bad > 0 then
    raise exception 'B FAILED: % privilege violation(s) across % plm.dcp_* tables.',
      v_bad, array_length(v_tables, 1);
  end if;
  raise notice 'B PASSED: % tables, service_role SELECT/INSERT only, anon nothing.',
    array_length(v_tables, 1);
end;
$$;

-- =====================================================================================
-- C. RLS. Enabled, exactly one SELECT policy per table, to authenticated, NOT PERMISSIVE.
--
-- `using (true)` IS THE DEFECT THIS SECTION EXISTS FOR. It shipped live on the Disney OPA
-- extract and made confidential licensor data readable by EVERY signed-in account. This is
-- the same licensor's data from a second portal, so the check is explicit: the predicate
-- must not be `true`, and it must be BYTE-IDENTICAL across all ten tables, so one table
-- cannot quietly carry a weaker gate than its neighbours.
-- =====================================================================================
do $$
declare
  t text;
  v_tables text[];
  v_qual text;
  v_first text;
  v_n int;
  v_cmd char;
  v_roles name[];
  v_bad int := 0;
begin
  select array_agg(c.relname order by c.relname) into v_tables
  from pg_class c
  where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r'
    and c.relname like 'dcp\_%';

  if v_tables is null then
    raise exception 'C FAILED: no plm.dcp_* tables found -- vacuous pass prevented.';
  end if;

  foreach t in array v_tables loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('plm.' || t)::regclass) then
      raise warning 'C: RLS is NOT ENABLED on plm.%', t;
      v_bad := v_bad + 1;
      continue;
    end if;

    select count(*) into v_n from pg_policy pol
    where pol.polrelid = ('plm.' || t)::regclass;
    if v_n <> 1 then
      raise warning 'C: plm.% has % policies, expected exactly 1', t, v_n;
      v_bad := v_bad + 1;
      continue;
    end if;

    select pol.polcmd, pol.polroles, pg_get_expr(pol.polqual, pol.polrelid)
      into v_cmd, v_roles, v_qual
    from pg_policy pol where pol.polrelid = ('plm.' || t)::regclass;

    if v_cmd <> 'r' then
      raise warning 'C: plm.% policy command is %, expected SELECT', t, v_cmd;
      v_bad := v_bad + 1;
    end if;

    if not exists (
      select 1 from unnest(v_roles) r where r::regrole::text = 'authenticated'
    ) or array_length(v_roles, 1) <> 1 then
      raise warning 'C: plm.% policy is not granted to exactly {authenticated}', t;
      v_bad := v_bad + 1;
    end if;

    -- THE POINT OF THIS SECTION.
    if v_qual is null or btrim(lower(v_qual)) in ('true', '(true)') then
      raise warning 'C: plm.% has a PERMISSIVE predicate (%). This is the OPA defect.',
        t, coalesce(v_qual, '<null>');
      v_bad := v_bad + 1;
      continue;
    end if;

    if v_first is null then
      v_first := v_qual;
    elsif v_qual <> v_first then
      raise warning 'C: plm.% predicate differs from the others -- one table carries a '
        'different read gate than its neighbours', t;
      v_bad := v_bad + 1;
    end if;
  end loop;

  if v_bad > 0 then
    raise exception 'C FAILED: % RLS violation(s).', v_bad;
  end if;
  raise notice 'C PASSED: % tables, RLS on, one non-permissive identical SELECT policy each.',
    array_length(v_tables, 1);
end;
$$;

-- =====================================================================================
-- D. THE NULL-ROLE CASE.
--
-- The forbidden shape `if not ( ... or auth.role() = 'service_role' )` never fires when
-- the role is NULL -- which is exactly what it is inside a migration -- because
-- `not NULL` is NULL and an IF over NULL does not run its body. The predicate is a
-- callable FUNCTION precisely so this case can be PROVED rather than asserted in a
-- comment; an anonymous DO block never lands in pg_proc and cannot be tested at all.
-- =====================================================================================
do $$
begin
  if plm.dcp_loader_privilege_ok(null, null) is not false then
    raise exception 'D FAILED: the NULL/NULL case did not return FALSE. This is the '
      'null-permissive trap: inside a migration both arguments are NULL, and a guard that '
      'does not return FALSE here is wide open while reading strict.';
  end if;
  if plm.dcp_loader_privilege_ok('', '') is not false then
    raise exception 'D FAILED: empty/empty did not return FALSE.';
  end if;
  if plm.dcp_loader_privilege_ok('  ', '  ') is not false then
    raise exception 'D FAILED: whitespace/whitespace did not return FALSE.';
  end if;
  if plm.dcp_loader_privilege_ok('authenticated', 'some_other_user') is not false then
    raise exception 'D FAILED: a non-matching identity did not return FALSE.';
  end if;
  if plm.dcp_loader_privilege_ok('anon', null) is not false then
    raise exception 'D FAILED: anon did not return FALSE.';
  end if;

  -- And it must still return TRUE on a real positive match, or it would be "secure" only
  -- by refusing everything, which is not a guard, it is an outage.
  if plm.dcp_loader_privilege_ok('service_role', null) is not true then
    raise exception 'D FAILED: service_role did not return TRUE.';
  end if;
  if plm.dcp_loader_privilege_ok(null, 'postgres') is not true then
    raise exception 'D FAILED: session_user postgres did not return TRUE.';
  end if;

  raise notice 'D PASSED: NULL, empty, whitespace and non-matching identities all FALSE; '
    'positive matches TRUE.';
end;
$$;

-- =====================================================================================
-- E. IMMUTABILITY ACTUALLY BLOCKS A WRITE.
--
-- "The trigger exists in pg_trigger" is not the assertion. A real UPDATE and a real DELETE
-- are executed against a COMPLETED crawl's evidence and must BOTH raise. If either
-- succeeds this section fails, whatever pg_trigger says.
--
-- The whole section runs in a transaction that ends in ROLLBACK.
-- =====================================================================================
begin;

do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000001';
  v_tile  uuid;
  v_guide uuid;
  v_asset uuid;
  v_sec   uuid;
  v_ok    boolean;
  v_trigs int;
  -- Declared out here because the row must be created BEFORE the crawl is completed, and
  -- is then read by E3b further down. See the comment at its INSERT.
  v_frozen_gap uuid;
begin
  -- Structural precondition, so a missing trigger fails HERE with a clear reason rather
  -- than as a confusing "the write succeeded" further down.
  select count(*) into v_trigs
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  where c.relnamespace = 'plm'::regnamespace
    and c.relname like 'dcp\_%'
    and not tg.tgisinternal;
  if v_trigs < 10 then
    raise exception 'E FAILED: only % non-internal triggers on plm.dcp_* tables; expected '
      'at least 10 (4 crawl-scoped + dcp_load_exception + 3 identity + the crawl freeze + '
      'the chunk ledger).', v_trigs;
  end if;

  -- STRUCTURAL: every crawl-scoped trigger must cover INSERT as well as UPDATE and DELETE.
  -- Read from pg_trigger.tgtype rather than proved only through behaviour, so a trigger
  -- that loses its INSERT branch fails HERE by name instead of silently re-opening the one
  -- operation section 7 still permits. tgtype bit 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  declare
    v_t  text;
    v_ty smallint;
  begin
    foreach v_t in array array[
      'dcp_crawl_section','dcp_crawl_gap','dcp_asset_crawl',
      'dcp_asset_tile_observation','dcp_load_exception','dcp_chunk_ledger'
    ] loop
      select tg.tgtype into v_ty
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where c.relnamespace = 'plm'::regnamespace and c.relname = v_t
        and not tg.tgisinternal
        and tg.tgname = 'trg_' || v_t || '_immutable';
      if v_ty is null then
        raise exception 'E FAILED: plm.% has no trg_%_immutable trigger.', v_t, v_t;
      end if;
      if (v_ty & 4) = 0 then
        raise exception 'E FAILED: the immutability trigger on plm.% does NOT fire on '
          'INSERT. Section 7 keeps INSERT for service_role, so INSERT is the only mutating '
          'operation still available and an UPDATE/DELETE-only trigger guards nothing '
          'against it.', v_t;
      end if;
      if (v_ty & 8) = 0 or (v_ty & 16) = 0 then
        raise exception 'E FAILED: the immutability trigger on plm.% lost its UPDATE or '
          'DELETE coverage.', v_t;
      end if;
    end loop;
  end;

  insert into plm.dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values (
    v_crawl, date '2026-01-02', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
    1, 1, now()
  );

  insert into plm.dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-A', v_crawl) returning id into v_tile;

  insert into plm.dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/guide/a', 'ZZTEST-GUIDE-A', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/guide/a/zztest-file.zzz', v_guide, 'zztest-file.zzz', 'zzz', v_crawl)
  returning id into v_asset;

  insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 1, now()) returning id into v_sec;

  insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
  values (v_crawl, v_asset, repeat('a', 64));

  insert into plm.dcp_asset_tile_observation (crawl_id, dcp_asset_id, portal_tile_id,
                                              listing_kind, crawl_section_id, link_evidence)
  values (v_crawl, v_asset, v_tile, 'asset', null, 'aggregated_row');

  -- The gap under the crawl that is ABOUT TO BE COMPLETED. It has to be created while the
  -- crawl is still `running`, because completing it freezes INSERT too.
  --
  -- IT USED TO BE CREATED AFTER, INSIDE E3 BELOW, AND THAT MADE THIS WHOLE FILE
  -- UNRUNNABLE. The comment there said "the triggers are BEFORE UPDATE OR DELETE and
  -- deliberately do not police inserts" -- which stopped being true when the INSERT branch
  -- was added, the hardening this file's own E6 calls THE HIGH FINDING and the structural
  -- check ~40 lines above asserts from pg_trigger.tgtype. So the file asserted in two
  -- places that INSERT is refused on a completed crawl and then, in between, relied on
  -- exactly that INSERT succeeding. The first execution of this file (2026-08-11, the CI
  -- run that #695/#731 added) died here with `INSERT on plm.dcp_crawl_gap is refused`.
  --
  -- Nothing is weakened by moving it: E3b below still UPDATEs this gap and still requires
  -- that UPDATE to be refused, which is the assertion E3 exists to make.
  insert into plm.dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
  values (v_sec, 0, 10, 'ZZTEST gap frozen') returning id into v_frozen_gap;

  -- Arm the guards.
  update plm.dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- E1. UPDATE of crawl-scoped evidence must be REFUSED.
  v_ok := false;
  begin
    update plm.dcp_asset_crawl set observed_row_hash = repeat('b', 64)
    where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E1 FAILED: an UPDATE of a COMPLETED crawl''s plm.dcp_asset_crawl row '
      'SUCCEEDED. The immutability guarantee is not real.';
  end if;

  -- E2. DELETE of crawl-scoped evidence must be REFUSED.
  v_ok := false;
  begin
    delete from plm.dcp_asset_tile_observation where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E2 FAILED: a DELETE of a COMPLETED crawl''s tile observations '
      'SUCCEEDED.';
  end if;

  -- E3. The gap table is the one attached table with NO crawl_id column. Its trigger has
  -- to resolve the crawl through its section; a naive `new.crawl_id` read would raise
  -- "record new has no field crawl_id" on EVERY write instead of only on a frozen one.
  -- Both halves are therefore proved: an OPEN crawl's gap accepts a write, and a
  -- COMPLETED crawl's gap refuses one.
  declare
    v_open_gap   uuid;
    v_open uuid := '99999999-9999-4999-8999-000000000002';
    v_osec uuid;
  begin
    insert into plm.dcp_crawl (
      crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
      line_of_business, started_at, captured_by, private_source_commit, status
    ) values (
      v_open, date '2026-01-03', 'https://zztest.example.invalid', 'ZZTEST-0',
      'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running'
    );
    insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
    values (v_open, v_tile, 'asset') returning id into v_osec;

    -- The gap under the OPEN crawl.
    insert into plm.dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
    values (v_osec, 0, 10, 'ZZTEST gap open') returning id into v_open_gap;

    -- v_frozen_gap -- the gap under the COMPLETED crawl's section -- was created ABOVE,
    -- while that crawl was still `running`. It cannot be created here: completing a crawl
    -- freezes INSERT as well as UPDATE and DELETE (E6). The UPDATE in E3b is what must be
    -- refused, and that assertion is unchanged.

    -- E3a. MUST SUCCEED. This is the half that catches the field-read bug: the gap table
    -- has NO crawl_id column, so a trigger that read new.crawl_id would raise "record new
    -- has no field crawl_id" HERE, on an ordinary open-crawl write, and the schema would
    -- be unusable rather than merely unguarded.
    update plm.dcp_crawl_gap set attempt_count = 2 where id = v_open_gap;
    if (select attempt_count from plm.dcp_crawl_gap where id = v_open_gap) <> 2 then
      raise exception 'E3a FAILED: the UPDATE of an OPEN crawl''s gap did not take effect.';
    end if;

    -- E3b. MUST BE REFUSED, resolved through the section to the completed crawl.
    v_ok := false;
    begin
      update plm.dcp_crawl_gap set attempt_count = 99 where id = v_frozen_gap;
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'E3b FAILED: a gap belonging to a COMPLETED crawl was UPDATED. The '
        'trigger did not resolve the crawl through crawl_section_id.';
    end if;
  end;

  -- E4. The completed crawl header itself may not be updated or deleted.
  v_ok := false;
  begin
    update plm.dcp_crawl set notes = 'ZZTEST tamper' where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E4 FAILED: a COMPLETED plm.dcp_crawl row was UPDATED.';
  end if;

  v_ok := false;
  begin
    delete from plm.dcp_crawl where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E4 FAILED: a COMPLETED plm.dcp_crawl row was DELETED -- which would '
      'also have cascaded away all of its evidence.';
  end if;

  -- E5. A stable identity observed by a completed crawl: SOURCE columns freeze, but
  -- last_seen_crawl_id must remain editable for refreshes. Human reconciliation now goes
  -- through plm.set_source_resolution; the landing decision columns are immutable.
  v_ok := false;
  begin
    update plm.dcp_asset set file_name = 'ZZTEST-renamed.zzz' where id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E5 FAILED: a SOURCE column of an asset observed by a COMPLETED crawl '
      'was changed. Every stored row hash was computed from those exact values.';
  end if;

  perform plm.set_source_resolution(
    'disney_dcpvault','style_guide',
    (select 'path:' || source_path from plm.dcp_style_guide where id=v_guide),
    'deferred',null,null,null,null,'ZZTEST reviewed',null
  );

  -- E6. THE HIGH FINDING, PROVED BEHAVIOURALLY. INSERT is the ONLY mutating operation
  -- section 7 still leaves to service_role, so it is the one that matters most. Each of
  -- these adds evidence to an ALREADY-COMPLETED crawl and must be refused. Before the
  -- INSERT branch existed, every one of them SUCCEEDED and the crawl silently gained a
  -- portal link, a membership row, a section, a gap or a chunk it never observed.
  v_ok := false;
  begin
    insert into plm.dcp_asset_tile_observation (crawl_id, dcp_asset_id, portal_tile_id,
                                                listing_kind, crawl_section_id, link_evidence)
    values (v_crawl, v_asset, v_tile, 'style_guide', null, 'aggregated_row');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a tile observation was INSERTED into a COMPLETED crawl. '
      'That crawl now claims a portal link it never observed, and "completed evidence is '
      'frozen" is false for the only operation service_role can still perform.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
    values (v_crawl, v_asset, repeat('c', 64));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a membership row was INSERTED into a COMPLETED crawl.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
    values (v_crawl, v_tile, 'style_guide');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a section was INSERTED into a COMPLETED crawl -- which '
      'would also have retroactively changed what that crawl claimed to attempt.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_chunk_ledger (crawl_id, chunk_number, chunk_sha256,
                                      rows_received, rows_landed, rows_rejected)
    values (v_crawl, 99, repeat('d', 64), 1, 1, 0);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a ledger row was INSERTED into a COMPLETED crawl, breaking '
      'the chunk reconciliation finalize already performed.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_load_exception (crawl_id, reason_code, reason)
    values (v_crawl, 'ZZTEST', 'ZZTEST after the fact');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a load exception was INSERTED into a COMPLETED crawl -- a '
      'finding that crawl never produced.';
  end if;

  -- E7. The dcp_load_exception carve-out, both halves. A warning recorded BEFORE
  -- completion must still be resolvable AFTER it (otherwise resolved_at and
  -- resolution_note are dead weight from the first completed crawl), while its source
  -- fields stay frozen.
  declare
    v_exc uuid;
    v_c2  uuid := '99999999-9999-4999-8999-000000000003';
  begin
    insert into plm.dcp_crawl (
      crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
      line_of_business, started_at, captured_by, private_source_commit, status,
      rows_received, distinct_assets_received, finished_at
    ) values (
      v_c2, date '2026-01-04', 'https://zztest.example.invalid', 'ZZTEST-0',
      'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
      1, 1, now()
    );
    insert into plm.dcp_load_exception (crawl_id, severity, reason_code, reason)
    values (v_c2, 'warning', 'ZZTEST', 'ZZTEST warning to triage later')
    returning id into v_exc;
    update plm.dcp_crawl set status = 'complete' where crawl_id = v_c2;

    -- MUST SUCCEED.
    update plm.dcp_load_exception
      set resolved_at = now(), resolution_note = 'ZZTEST triaged'
      where id = v_exc;
    if (select resolved_at from plm.dcp_load_exception where id = v_exc) is null then
      raise exception 'E7 FAILED: a warning on a COMPLETED crawl could not be resolved. '
        'The carve-out that makes resolved_at/resolution_note usable is missing.';
    end if;

    -- MUST BE REFUSED.
    v_ok := false;
    begin
      update plm.dcp_load_exception set reason = 'ZZTEST rewritten' where id = v_exc;
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'E7 FAILED: a SOURCE field of a load exception on a COMPLETED crawl '
        'was rewritten. Only resolved_at and resolution_note may change.';
    end if;
  end;

  raise notice 'E PASSED: completed-crawl evidence refuses INSERT, UPDATE and DELETE; the '
    'crawl header is frozen; source columns freeze; durable decisions use '
    'plm.set_source_resolution while exception workflow state stays editable.';
end;
$$;

rollback;

-- =====================================================================================
-- E8. THE STORED waived_at VALUE. Behaviour of plm.close_dcp_crawl_gap, not a property of
-- a literal.
--
-- THIS IS THE ASSERTION THE FIRST VERSION OF THIS FILE WAS MISSING. Section G below proves
-- that a midday-UTC timestamp reads as one calendar date in both zones -- which is true of
-- any midday-UTC literal and would pass no matter what the function stored. The original
-- function stored 20:00Z, and section G could not have noticed. So the stored value is
-- read back and asserted here, exactly as the function wrote it.
-- =====================================================================================
begin;

do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000004';
  v_tile  uuid;
  v_sec   uuid;
  v_gap   uuid;
  v_at    timestamptz;
  v_utc   text;
begin
  insert into plm.dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status
  ) values (
    v_crawl, date '2026-08-10', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running'
  );
  insert into plm.dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-W', v_crawl) returning id into v_tile;
  insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
  values (v_crawl, v_tile, 'asset') returning id into v_sec;
  insert into plm.dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
  values (v_sec, 0, 10, 'ZZTEST gap to waive') returning id into v_gap;

  -- A deliberately AWKWARD input time: late in the UTC day, so a wrong-direction
  -- conversion is guaranteed to land somewhere other than midday.
  perform plm.close_dcp_crawl_gap(v_gap, 'waived', 'ZZTEST waiver reason', 'ZZTEST-approver',
                                  timestamptz '2026-08-10 23:41:07+00');

  select waived_at into v_at from plm.dcp_crawl_gap where id = v_gap;
  if v_at is null then
    raise exception 'E8 FAILED: the waiver did not store a waived_at at all.';
  end if;

  v_utc := to_char(v_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS');
  if v_utc <> '2026-08-10 12:00:00' then
    raise exception 'E8 FAILED: waived_at stored as % UTC, expected 2026-08-10 12:00:00. '
      'The midday-UTC pin does not hold, so the margin to the UTC day boundary is not the '
      '12 hours every comment in the migration claims.', v_utc;
  end if;

  -- And the property that pin exists for, on the value the function ACTUALLY stored.
  if (v_at at time zone 'UTC')::date <> (v_at at time zone 'America/New_York')::date then
    raise exception 'E8 FAILED: the STORED waived_at reads as different calendar dates in '
      'UTC (%) and America/New_York (%).',
      (v_at at time zone 'UTC')::date, (v_at at time zone 'America/New_York')::date;
  end if;

  raise notice 'E8 PASSED: close_dcp_crawl_gap stored waived_at at exactly 12:00:00 UTC, '
    'one calendar date in both zones.';
end;
$$;

rollback;

-- =====================================================================================
-- F. THE FROZEN ROW HASH. Behaviour, not existence.
-- =====================================================================================
do $$
declare
  h1 text; h2 text; h3 text; h4 text; h5 text;
  v_ok boolean;
begin
  h1 := plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['b','a']);
  h2 := plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['a','b']);
  if h1 <> h2 then
    raise exception 'F FAILED: tile order changed the hash. The tile list must be sorted '
      'with COLLATE "C" before joining, or every crawl re-hashes unchanged data.';
  end if;
  if h1 !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: the hash is not 64 lowercase hex characters: %', h1;
  end if;

  -- Duplicated tiles must not change it either -- the slot is a SET.
  if plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['a','b','a']) <> h1 then
    raise exception 'F FAILED: a duplicated tile key changed the hash; slot 8 is a SET.';
  end if;

  -- NULL and empty string MUST hash differently. Both occur in this source: a blank
  -- folder subpath, and 88,125 files with no guide id.
  h3 := plm.dcp_asset_row_hash('s','/p','f','e', null, '/g','gid', array['a']);
  h4 := plm.dcp_asset_row_hash('s','/p','f','e', '',   '/g','gid', array['a']);
  if h3 = h4 then
    raise exception 'F FAILED: NULL and the empty string hash IDENTICALLY. The presence '
      'flag is missing, and two genuinely different observations are now indistinguishable.';
  end if;

  -- An empty tile array ("no tiles") and NULL ("not observed") are different facts.
  h5 := plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array[]::text[]);
  if h5 = plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid', null) then
    raise exception 'F FAILED: an empty tile array hashes the same as NULL. "No tiles" and '
      '"tiles not observed" are different observations.';
  end if;

  -- A reserved separator must be REFUSED, not silently absorbed.
  v_ok := false;
  begin
    perform plm.dcp_asset_row_hash('s','/p' || chr(31) || 'x','f','e','r','/g','gid',
                                   array['a']);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'F FAILED: a value containing U+001F was accepted. The serialization '
      'does not escape, so such a value would collide with a genuine slot boundary.';
  end if;

  v_ok := false;
  begin
    perform plm.dcp_asset_row_hash('s','/p','f','e','r','/g','gid',
                                   array['a' || chr(30) || 'b']);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'F FAILED: a tile key containing U+001E was accepted.';
  end if;

  raise notice 'F PASSED: hash shape, tile-order and duplicate independence, NULL vs '
    'empty, empty-array vs NULL, and separator refusal.';
end;
$$;

-- =====================================================================================
-- G. THE America/New_York DATE TRAP -- the PROPERTY, not the stored value.
--
-- READ THIS TOGETHER WITH E8. This section asserts a property of midday-UTC LITERALS and
-- would pass whatever plm.close_dcp_crawl_gap actually stored -- the first version of this
-- file had only this section, and the function was storing 20:00Z the whole time. E8 is
-- what proves the function; this is what proves the rule the function implements, plus a
-- control showing the trap is still real on this server.
-- ORIGINAL HEADING: THE America/New_York DATE TRAP.
--
-- The server runs America/New_York. A midnight-UTC approval timestamp read back through
-- ::date returns the PREVIOUS day locally, so two reports disagree about when a loss was
-- accepted. plm.close_dcp_crawl_gap pins waived_at to MIDDAY UTC. Both zones are asserted;
-- asserting only one would not have caught the bug in either direction.
-- =====================================================================================
do $$
declare
  v_midday   timestamptz := timestamptz '2026-03-15 12:00:00+00';
  v_midnight timestamptz := timestamptz '2026-03-15 00:00:00+00';
begin
  if (v_midday at time zone 'UTC')::date <> (v_midday at time zone 'America/New_York')::date then
    raise exception 'G FAILED: a MIDDAY-UTC timestamp read as different calendar dates in '
      'UTC (%) and America/New_York (%). The pinning rule does not hold on this server.',
      (v_midday at time zone 'UTC')::date,
      (v_midday at time zone 'America/New_York')::date;
  end if;

  -- The control. If this ever stops differing, the trap has gone away and the pinning
  -- rule can be revisited -- but until then it proves the test is measuring something.
  if (v_midnight at time zone 'UTC')::date = (v_midnight at time zone 'America/New_York')::date then
    raise exception 'G FAILED (control): a MIDNIGHT-UTC timestamp read as the SAME date in '
      'both zones. Either the server timezone changed or this test is no longer measuring '
      'the trap it was written for -- investigate before relaxing anything.';
  end if;

  raise notice 'G PASSED: midday UTC is one calendar date in both zones; midnight UTC is '
    'two (the control).';
end;
$$;

-- =====================================================================================
-- H. NO TEST DATA SURVIVED. Section E rolled back; this proves it against committed state.
-- =====================================================================================
do $$
declare v_n int; v_total int := 0;
begin
  select count(*) into v_n from plm.dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_portal_tile where source_key like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_style_guide where folder_name like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_asset where file_name like 'zztest%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. Section E''s ROLLBACK did not '
      'happen -- this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;
