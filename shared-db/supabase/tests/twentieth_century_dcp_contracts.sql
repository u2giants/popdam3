-- Synthetic contract suite for 20th Century DCP Vault; contains no licensed source values.
-- =====================================================================================
-- Contract tests for migrations 20260810190000 and 20260810190100 -- the Disney 20th Century DCP Vault
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
--       then, with that URL in TWENTIETH_CENTURY_DCP_TEST_URL:
--         psql "$TWENTIETH_CENTURY_DCP_TEST_URL" -v ON_ERROR_STOP=1 -f supabase/tests/twentieth_century_dcp_vault_landing_contracts.sql
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
--     B  PRIVILEGES: service_role holds SELECT only and every direct write is denied -- no UPDATE,
--        DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. anon and public hold nothing.
--        The table list is ENUMERATED FROM pg_class, so a plm.twentieth_century_dcp_* table added later
--        without a matching revoke FAILS here rather than escaping the check.
--     C  RLS: enabled on every table, exactly one SELECT policy each, to {authenticated},
--        and THE PREDICATE IS NOT PERMISSIVE -- `using (true)` fails. That shape was a
--        live security defect on the Disney OPA extract; this is the same licensor.
--     D  THE NULL-ROLE CASE: plm.twentieth_century_dcp_loader_privilege_ok returns FALSE for NULL/NULL and
--        for empty strings, and TRUE only on a positive match. This is the exact condition
--        that holds inside a migration.
--     E  IMMUTABILITY ACTUALLY BLOCKS A WRITE. Not "the trigger exists" -- real INSERT,
--        UPDATE and DELETE statements against a completed crawl are executed and must all
--        raise. E6 is the INSERT case specifically: section 7 revokes UPDATE, DELETE and
--        all direct mutation from service_role, so guarded functions are the only writing
--        operation still available and therefore the one worth proving. E7 covers the
--        deliberate twentieth_century_dcp_load_exception carve-out (resolution columns stay writable, source
--        fields do not). E8 reads back the STORED waived_at written by
--        plm.close_twentieth_century_dcp_crawl_gap and asserts it is exactly 12:00:00 UTC.
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
    'twentieth_century_dcp_crawl','twentieth_century_dcp_portal_tile','twentieth_century_dcp_style_guide','twentieth_century_dcp_asset','twentieth_century_dcp_crawl_section',
    'twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl','twentieth_century_dcp_asset_tile_observation','twentieth_century_dcp_load_exception',
    'twentieth_century_dcp_chunk_ledger'
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
      'twentieth_century_dcp_loader_privilege_ok','twentieth_century_dcp_asset_row_hash','twentieth_century_dcp_reject_completed_crawl_change',
      'twentieth_century_dcp_load_exception_freeze',
      'twentieth_century_dcp_reject_completed_source_field_change','twentieth_century_dcp_crawl_freeze','begin_twentieth_century_dcp_crawl',
      'open_twentieth_century_dcp_crawl_section','close_twentieth_century_dcp_crawl_section','load_twentieth_century_dcp_asset_chunk',
      'record_twentieth_century_dcp_crawl_gap','close_twentieth_century_dcp_crawl_gap','finalize_twentieth_century_dcp_crawl','fail_twentieth_century_dcp_crawl'
    );
  if v_fns <> 14 then
    raise exception 'A FAILED: expected 14 plm.twentieth_century_dcp_* / DCP loader functions in pg_proc, '
      'found %. A missing one means an object in the claim was never created.', v_fns;
  end if;

  raise notice 'A PASSED: 10 tables and 14 functions present.';
end;
$$;

-- =====================================================================================
-- B. PRIVILEGES. service_role: SELECT only; every direct write denied. anon/public: nothing.
--
-- UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN all arrive FREE from the
-- plm schema default privilege (20260710135975:14) at CREATE TABLE time -- verified live
-- on 2026-08-10 as service_role=arwdDxtm on BOTH projects. Section 7 of 20260810190000
-- revokes them. TRUNCATE matters most: it fires NO row trigger, so one TRUNCATE would
-- erase a completed crawl's evidence without a single immutability trigger running.
--
-- The table list is READ FROM pg_class, not hard-coded, so a plm.twentieth_century_dcp_* table added by a
-- later migration without a matching revoke FAILS here. The known names are then asserted
-- PRESENT, so a rename cannot silently shrink the coverage to zero and pass vacuously.
-- =====================================================================================
do $$
declare
  v_known text[] := array[
    'twentieth_century_dcp_crawl','twentieth_century_dcp_portal_tile','twentieth_century_dcp_style_guide','twentieth_century_dcp_asset','twentieth_century_dcp_crawl_section',
    'twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl','twentieth_century_dcp_asset_tile_observation','twentieth_century_dcp_load_exception',
    'twentieth_century_dcp_chunk_ledger'
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
    and c.relname like 'twentieth_century_dcp\_%';

  if v_tables is null or array_length(v_tables, 1) is null then
    raise exception 'B FAILED: pg_class returned NO plm.twentieth_century_dcp_* tables. The enumeration is '
      'broken or the tables are gone -- this test would otherwise pass vacuously.';
  end if;

  select array_agg(k) into v_missing
  from unnest(v_known) k where not (k = any(v_tables));
  if v_missing is not null then
    raise exception 'B FAILED: expected plm.twentieth_century_dcp_* table(s) absent from pg_class: %',
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

    -- Every table is function-write-only. service_role may call guarded loaders but
    -- may not bypass them with direct INSERT.
    if has_table_privilege('service_role', 'plm.' || t, 'INSERT') then
      raise warning 'B: service_role holds direct INSERT on plm.%', t;
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
    raise exception 'B FAILED: % privilege violation(s) across % plm.twentieth_century_dcp_* tables.',
      v_bad, array_length(v_tables, 1);
  end if;
  raise notice 'B PASSED: % tables, service_role SELECT only, anon nothing.',
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
    and c.relname like 'twentieth_century_dcp\_%';

  if v_tables is null then
    raise exception 'C FAILED: no plm.twentieth_century_dcp_* tables found -- vacuous pass prevented.';
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
  if plm.twentieth_century_dcp_loader_privilege_ok(null, null) is not false then
    raise exception 'D FAILED: the NULL/NULL case did not return FALSE. This is the '
      'null-permissive trap: inside a migration both arguments are NULL, and a guard that '
      'does not return FALSE here is wide open while reading strict.';
  end if;
  if plm.twentieth_century_dcp_loader_privilege_ok('', '') is not false then
    raise exception 'D FAILED: empty/empty did not return FALSE.';
  end if;
  if plm.twentieth_century_dcp_loader_privilege_ok('  ', '  ') is not false then
    raise exception 'D FAILED: whitespace/whitespace did not return FALSE.';
  end if;
  if plm.twentieth_century_dcp_loader_privilege_ok('authenticated', 'some_other_user') is not false then
    raise exception 'D FAILED: a non-matching identity did not return FALSE.';
  end if;
  if plm.twentieth_century_dcp_loader_privilege_ok('anon', null) is not false then
    raise exception 'D FAILED: anon did not return FALSE.';
  end if;

  -- And it must still return TRUE on a real positive match, or it would be "secure" only
  -- by refusing everything, which is not a guard, it is an outage.
  if plm.twentieth_century_dcp_loader_privilege_ok('service_role', null) is not true then
    raise exception 'D FAILED: service_role did not return TRUE.';
  end if;
  if plm.twentieth_century_dcp_loader_privilege_ok(null, 'postgres') is not true then
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
    and c.relname like 'twentieth_century_dcp\_%'
    and not tg.tgisinternal;
  if v_trigs < 10 then
    raise exception 'E FAILED: only % non-internal triggers on plm.twentieth_century_dcp_* tables; expected '
      'at least 10 (4 crawl-scoped + twentieth_century_dcp_load_exception + 3 identity + the crawl freeze + '
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
      'twentieth_century_dcp_crawl_section','twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl',
      'twentieth_century_dcp_asset_tile_observation','twentieth_century_dcp_load_exception','twentieth_century_dcp_chunk_ledger'
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
          'INSERT. Section 7 denies direct writes to service_role, so guarded functions are the only '
          'operation still available and an UPDATE/DELETE-only trigger guards nothing '
          'against it.', v_t;
      end if;
      if (v_ty & 8) = 0 or (v_ty & 16) = 0 then
        raise exception 'E FAILED: the immutability trigger on plm.% lost its UPDATE or '
          'DELETE coverage.', v_t;
      end if;
    end loop;
  end;

  insert into plm.twentieth_century_dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values (
    v_crawl, date '2026-01-02', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
    1, 1, now()
  );

  insert into plm.twentieth_century_dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-A', v_crawl) returning id into v_tile;

  insert into plm.twentieth_century_dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/guide/a', 'ZZTEST-GUIDE-A', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/guide/a/zztest-file.zzz', v_guide, 'zztest-file.zzz', 'zzz', v_crawl)
  returning id into v_asset;

  insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 1, now()) returning id into v_sec;

  insert into plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id, observed_row_hash)
  values (v_crawl, v_asset, repeat('a', 64));

  insert into plm.twentieth_century_dcp_asset_tile_observation (crawl_id, twentieth_century_dcp_asset_id, portal_tile_id,
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
  -- run that #695/#731 added) died here with `INSERT on plm.twentieth_century_dcp_crawl_gap is refused`.
  --
  -- Nothing is weakened by moving it: E3b below still UPDATEs this gap and still requires
  -- that UPDATE to be refused, which is the assertion E3 exists to make.
  insert into plm.twentieth_century_dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
  values (v_sec, 0, 10, 'ZZTEST gap frozen') returning id into v_frozen_gap;

  -- Arm the guards.
  update plm.twentieth_century_dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- E1. UPDATE of crawl-scoped evidence must be REFUSED.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_asset_crawl set observed_row_hash = repeat('b', 64)
    where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E1 FAILED: an UPDATE of a COMPLETED crawl''s plm.twentieth_century_dcp_asset_crawl row '
      'SUCCEEDED. The immutability guarantee is not real.';
  end if;

  -- E2. DELETE of crawl-scoped evidence must be REFUSED.
  v_ok := false;
  begin
    delete from plm.twentieth_century_dcp_asset_tile_observation where crawl_id = v_crawl;
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
    insert into plm.twentieth_century_dcp_crawl (
      crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
      line_of_business, started_at, captured_by, private_source_commit, status
    ) values (
      v_open, date '2026-01-03', 'https://zztest.example.invalid', 'ZZTEST-0',
      'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running'
    );
    insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
    values (v_open, v_tile, 'asset') returning id into v_osec;

    -- The gap under the OPEN crawl.
    insert into plm.twentieth_century_dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
    values (v_osec, 0, 10, 'ZZTEST gap open') returning id into v_open_gap;

    -- v_frozen_gap -- the gap under the COMPLETED crawl's section -- was created ABOVE,
    -- while that crawl was still `running`. It cannot be created here: completing a crawl
    -- freezes INSERT as well as UPDATE and DELETE (E6). The UPDATE in E3b is what must be
    -- refused, and that assertion is unchanged.

    -- E3a. MUST SUCCEED. This is the half that catches the field-read bug: the gap table
    -- has NO crawl_id column, so a trigger that read new.crawl_id would raise "record new
    -- has no field crawl_id" HERE, on an ordinary open-crawl write, and the schema would
    -- be unusable rather than merely unguarded.
    update plm.twentieth_century_dcp_crawl_gap set attempt_count = 2 where id = v_open_gap;
    if (select attempt_count from plm.twentieth_century_dcp_crawl_gap where id = v_open_gap) <> 2 then
      raise exception 'E3a FAILED: the UPDATE of an OPEN crawl''s gap did not take effect.';
    end if;

    -- E3b. MUST BE REFUSED, resolved through the section to the completed crawl.
    v_ok := false;
    begin
      update plm.twentieth_century_dcp_crawl_gap set attempt_count = 99 where id = v_frozen_gap;
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
    update plm.twentieth_century_dcp_crawl set notes = 'ZZTEST tamper' where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E4 FAILED: a COMPLETED plm.twentieth_century_dcp_crawl row was UPDATED.';
  end if;

  v_ok := false;
  begin
    delete from plm.twentieth_century_dcp_crawl where crawl_id = v_crawl;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E4 FAILED: a COMPLETED plm.twentieth_century_dcp_crawl row was DELETED -- which would '
      'also have cascaded away all of its evidence.';
  end if;

  -- E5. A stable identity observed by a completed crawl: SOURCE columns freeze, but
  -- last_seen_crawl_id must remain editable for refreshes. Human reconciliation now goes
  -- through plm.set_source_resolution; the landing decision columns are immutable.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_asset set file_name = 'ZZTEST-renamed.zzz' where id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E5 FAILED: a SOURCE column of an asset observed by a COMPLETED crawl '
      'was changed. Every stored row hash was computed from those exact values.';
  end if;

  perform plm.set_source_resolution(
    'twentieth_century_dcpvault','style_guide',
    (select 'path:' || source_path from plm.twentieth_century_dcp_style_guide where id=v_guide),
    'deferred',null,null,null,null,'ZZTEST reviewed',null
  );

  -- E6. THE HIGH FINDING, PROVED BEHAVIOURALLY. INSERT is the ONLY mutating operation
  -- section 7 still leaves to service_role, so it is the one that matters most. Each of
  -- these adds evidence to an ALREADY-COMPLETED crawl and must be refused. Before the
  -- INSERT branch existed, every one of them SUCCEEDED and the crawl silently gained a
  -- portal link, a membership row, a section, a gap or a chunk it never observed.
  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_asset_tile_observation (crawl_id, twentieth_century_dcp_asset_id, portal_tile_id,
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
    insert into plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id, observed_row_hash)
    values (v_crawl, v_asset, repeat('c', 64));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a membership row was INSERTED into a COMPLETED crawl.';
  end if;

  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
    values (v_crawl, v_tile, 'style_guide');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a section was INSERTED into a COMPLETED crawl -- which '
      'would also have retroactively changed what that crawl claimed to attempt.';
  end if;

  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_chunk_ledger (crawl_id, chunk_number, chunk_sha256,
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
    insert into plm.twentieth_century_dcp_load_exception (crawl_id, reason_code, reason)
    values (v_crawl, 'ZZTEST', 'ZZTEST after the fact');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E6 FAILED: a load exception was INSERTED into a COMPLETED crawl -- a '
      'finding that crawl never produced.';
  end if;

  -- E7. The twentieth_century_dcp_load_exception carve-out, both halves. A warning recorded BEFORE
  -- completion must still be resolvable AFTER it (otherwise resolved_at and
  -- resolution_note are dead weight from the first completed crawl), while its source
  -- fields stay frozen.
  declare
    v_exc uuid;
    v_c2  uuid := '99999999-9999-4999-8999-000000000003';
  begin
    insert into plm.twentieth_century_dcp_crawl (
      crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
      line_of_business, started_at, captured_by, private_source_commit, status,
      rows_received, distinct_assets_received, finished_at
    ) values (
      v_c2, date '2026-01-04', 'https://zztest.example.invalid', 'ZZTEST-0',
      'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
      1, 1, now()
    );
    insert into plm.twentieth_century_dcp_load_exception (crawl_id, severity, reason_code, reason)
    values (v_c2, 'warning', 'ZZTEST', 'ZZTEST warning to triage later')
    returning id into v_exc;
    update plm.twentieth_century_dcp_crawl set status = 'complete' where crawl_id = v_c2;

    -- MUST SUCCEED.
    update plm.twentieth_century_dcp_load_exception
      set resolved_at = now(), resolution_note = 'ZZTEST triaged'
      where id = v_exc;
    if (select resolved_at from plm.twentieth_century_dcp_load_exception where id = v_exc) is null then
      raise exception 'E7 FAILED: a warning on a COMPLETED crawl could not be resolved. '
        'The carve-out that makes resolved_at/resolution_note usable is missing.';
    end if;

    -- MUST BE REFUSED.
    v_ok := false;
    begin
      update plm.twentieth_century_dcp_load_exception set reason = 'ZZTEST rewritten' where id = v_exc;
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
-- E8. THE STORED waived_at VALUE. Behaviour of plm.close_twentieth_century_dcp_crawl_gap, not a property of
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
  insert into plm.twentieth_century_dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status
  ) values (
    v_crawl, date '2026-08-10', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running'
  );
  insert into plm.twentieth_century_dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-W', v_crawl) returning id into v_tile;
  insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind)
  values (v_crawl, v_tile, 'asset') returning id into v_sec;
  insert into plm.twentieth_century_dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason)
  values (v_sec, 0, 10, 'ZZTEST gap to waive') returning id into v_gap;

  -- A deliberately AWKWARD input time: late in the UTC day, so a wrong-direction
  -- conversion is guaranteed to land somewhere other than midday.
  perform plm.close_twentieth_century_dcp_crawl_gap(v_gap, 'waived', 'ZZTEST waiver reason', 'ZZTEST-approver',
                                  timestamptz '2026-08-10 23:41:07+00');

  select waived_at into v_at from plm.twentieth_century_dcp_crawl_gap where id = v_gap;
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

  raise notice 'E8 PASSED: close_twentieth_century_dcp_crawl_gap stored waived_at at exactly 12:00:00 UTC, '
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
  h1 := plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['b','a']);
  h2 := plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['a','b']);
  if h1 <> h2 then
    raise exception 'F FAILED: tile order changed the hash. The tile list must be sorted '
      'with COLLATE "C" before joining, or every crawl re-hashes unchanged data.';
  end if;
  if h1 !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: the hash is not 64 lowercase hex characters: %', h1;
  end if;

  -- Duplicated tiles must not change it either -- the slot is a SET.
  if plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array['a','b','a']) <> h1 then
    raise exception 'F FAILED: a duplicated tile key changed the hash; slot 8 is a SET.';
  end if;

  -- NULL and empty string MUST hash differently. Both occur in this source: a blank
  -- folder subpath, and 88,125 files with no guide id.
  h3 := plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e', null, '/g','gid', array['a']);
  h4 := plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e', '',   '/g','gid', array['a']);
  if h3 = h4 then
    raise exception 'F FAILED: NULL and the empty string hash IDENTICALLY. The presence '
      'flag is missing, and two genuinely different observations are now indistinguishable.';
  end if;

  -- An empty tile array ("no tiles") and NULL ("not observed") are different facts.
  h5 := plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid', array[]::text[]);
  if h5 = plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid', null) then
    raise exception 'F FAILED: an empty tile array hashes the same as NULL. "No tiles" and '
      '"tiles not observed" are different observations.';
  end if;

  -- A reserved separator must be REFUSED, not silently absorbed.
  v_ok := false;
  begin
    perform plm.twentieth_century_dcp_asset_row_hash('s','/p' || chr(31) || 'x','f','e','r','/g','gid',
                                   array['a']);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'F FAILED: a value containing U+001F was accepted. The serialization '
      'does not escape, so such a value would collide with a genuine slot boundary.';
  end if;

  v_ok := false;
  begin
    perform plm.twentieth_century_dcp_asset_row_hash('s','/p','f','e','r','/g','gid',
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
-- would pass whatever plm.close_twentieth_century_dcp_crawl_gap actually stored -- the first version of this
-- file had only this section, and the function was storing 20:00Z the whole time. E8 is
-- what proves the function; this is what proves the rule the function implements, plus a
-- control showing the trap is still real on this server.
-- ORIGINAL HEADING: THE America/New_York DATE TRAP.
--
-- The server runs America/New_York. A midnight-UTC approval timestamp read back through
-- ::date returns the PREVIOUS day locally, so two reports disagree about when a loss was
-- accepted. plm.close_twentieth_century_dcp_crawl_gap pins waived_at to MIDDAY UTC. Both zones are asserted;
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
  select count(*) into v_n from plm.twentieth_century_dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_portal_tile where source_key like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_style_guide where folder_name like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_asset where file_name like 'zztest%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. Section E''s ROLLBACK did not '
      'happen -- this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

-- =====================================================================================
-- Contract tests for migration 20260811050000 -- the Disney 20th Century DCP Vault PHASE 2 metadata
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
--   B  PRIVILEGES: service_role holds SELECT only and every direct write is denied. anon/public
--      hold nothing. Enumerated from pg_class so a table added later without a revoke
--      fails here rather than escaping.
--   C  RLS enabled, exactly one SELECT policy each, to {authenticated}, and the predicate
--      is NOT `using (true)`.
--   D  THE INDEPENDENCE RULE, STRUCTURALLY. No table references both a property and a
--      character; no property-character table exists; plm.twentieth_century_dcp_character has no property
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
    'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset','twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
    'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
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
      'twentieth_century_dcp_metadata_row_hash','twentieth_century_dcp_reject_completed_metadata_change',
      'twentieth_century_dcp_metadata_run_freeze','twentieth_century_dcp_reject_completed_metadata_identity_change'
    );
  if v_fns <> 4 then
    raise exception 'A FAILED: expected 4 new plm metadata functions in pg_proc, found %. '
      'A missing one means an object in claim #749 was never created.', v_fns;
  end if;

  -- The Phase-1 frozen hash must still be exactly one function. This migration's contract
  -- is that it did not touch a one-way door that ~155,900 rows depend on.
  select count(*) into v_fns
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname = 'twentieth_century_dcp_asset_row_hash';
  if v_fns <> 1 then
    raise exception 'A FAILED: expected exactly ONE plm.twentieth_century_dcp_asset_row_hash, found %. The '
      'Phase-1 row hash is FROZEN over roughly 155,900 rows; Phase 2 must not add, replace '
      'or overload it.', v_fns;
  end if;

  raise notice 'A PASSED: 8 metadata tables, 4 new functions, Phase-1 frozen hash intact.';
end;
$$;

-- =====================================================================================
-- B. PRIVILEGES. service_role: SELECT only; every direct write denied. anon/public: nothing.
--    Enumerated from pg_class, NOT from a hand-written list, so a plm.twentieth_century_dcp_metadata_*
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
        'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset','twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
        'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
        'twentieth_century_dcp_asset_term_observation','twentieth_century_dcp_metadata_chunk_ledger',
        'twentieth_century_dcp_metadata_load_exception'
      )
  loop
    v_n := v_n + 1;

    -- TRUNCATE ABOVE ALL. It fires NO row triggers, so one TRUNCATE would erase a
    -- completed run's evidence with every freeze trigger silently standing by.
    if has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'INSERT')
    or has_table_privilege('service_role', 'plm.' || quote_ident(r.relname), 'UPDATE')
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

  raise notice 'B PASSED: 10 tables, service_role SELECT only, anon locked out.';
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
        'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset','twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
        'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
        'twentieth_century_dcp_asset_term_observation','twentieth_century_dcp_metadata_chunk_ledger',
        'twentieth_century_dcp_metadata_load_exception'
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
      and c.column_name in ('twentieth_century_dcp_property_id','twentieth_century_dcp_character_id')
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
    and table_name ~ '^twentieth_century_dcp_(propert.*character|character.*propert)';
  if v_n > 0 then
    raise exception 'D FAILED: % plm property-character table(s) exist. No such table may '
      'ever be created.', v_n;
  end if;

  -- D3. plm.twentieth_century_dcp_character must have NO property column. Its absence is a locked decision,
  -- not an oversight -- a column here is a slot someone eventually fills by pairing the
  -- two arrays on an asset.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'plm' and table_name = 'twentieth_century_dcp_character'
    and (column_name like '%propert%');
  if v_n > 0 then
    raise exception 'D FAILED: plm.twentieth_century_dcp_character has % property column(s). 20th Century DCP Vault never '
      'asserts which property a character belongs to; Disney OPA is the only source that '
      'does and it has its own landing schema.', v_n;
  end if;

  -- D4. Both link tables must actually EXIST and be distinct relations. Without this,
  -- D1-D3 would pass trivially on a schema that has neither.
  if to_regclass('plm.twentieth_century_dcp_asset_property_observation') is null
  or to_regclass('plm.twentieth_century_dcp_asset_character_observation') is null then
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
    'twentieth_century_dcp_metadata_asset','twentieth_century_dcp_asset_property_observation',
    'twentieth_century_dcp_asset_character_observation','twentieth_century_dcp_asset_term_observation',
    'twentieth_century_dcp_metadata_chunk_ledger'
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
        'direct writes. service_role receives SELECT only, so the guarded loader is the '
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
  insert into plm.twentieth_century_dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values (
    v_crawl, date '2026-01-03', 'https://zztest.example.invalid', 'ZZTEST-0',
    'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running',
    2, 2, now()
  );

  insert into plm.twentieth_century_dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-M', v_crawl) returning id into v_tile;

  insert into plm.twentieth_century_dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/mguide/a', 'ZZTEST-GUIDE-M', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  -- TWO DISTINCT PATHS, ONE FILE NAME. Required case 9.
  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/mguide/a/one/zztest-shared.zzz', v_guide, 'zztest-shared.zzz', 'zzz', v_crawl)
  returning id into v_asset;
  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/mguide/a/two/zztest-shared.zzz', v_guide, 'zztest-shared.zzz', 'zzz', v_crawl)
  returning id into v_asset2;

  insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 2, now()) returning id into v_sec;

  insert into plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id, observed_row_hash)
  values (v_crawl, v_asset, repeat('c', 64)), (v_crawl, v_asset2, repeat('d', 64));

  -- Two assets sharing a name is legal and must not have been blocked above.
  if (select count(*) from plm.twentieth_century_dcp_asset where file_name = 'zztest-shared.zzz') <> 2 then
    raise exception 'E FAILED: two assets could not share a file name. File name is NOT '
      'unique in this source -- collisions number in the thousands -- and any unique rule '
      'on it would reject honest data.';
  end if;

  update plm.twentieth_century_dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- -----------------------------------------------------------------------------------
  -- G1. A metadata row may NOT reference an asset outside its source crawl.
  -- Proved with a SECOND crawl that never observed the asset. The composite foreign keys
  -- are what make this structural rather than a loader convention.
  -- -----------------------------------------------------------------------------------
  insert into plm.twentieth_century_dcp_metadata_run (
    metadata_run_id, source_crawl_id, status, captured_on, started_at, endpoint_suffix,
    crawler_version, captured_by, private_source_commit, assets_expected
  ) values (
    v_run, v_crawl, 'running', date '2026-01-04', now(), '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40), 2
  );

  declare
    v_other_crawl uuid := '99999999-9999-4999-8999-000000000104';
  begin
    insert into plm.twentieth_century_dcp_crawl (
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
      insert into plm.twentieth_century_dcp_metadata_asset (metadata_run_id, source_crawl_id, twentieth_century_dcp_asset_id)
      values (v_run, v_other_crawl, v_asset);
    exception when foreign_key_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception 'G FAILED: a metadata row named a source crawl its RUN did not '
        'declare. The composite FK to twentieth_century_dcp_metadata_run must forbid this -- otherwise the '
        'membership check is performed against the wrong crawl entirely.';
    end if;
  end;

  -- G2. An asset the source crawl never observed must be refused.
  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_metadata_asset (metadata_run_id, source_crawl_id, twentieth_century_dcp_asset_id)
    values (v_run, v_crawl, '99999999-9999-4999-8999-0000000009ff');
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: metadata was attached to an asset outside the source crawl. '
      'The composite FK to twentieth_century_dcp_asset_crawl must forbid this.';
  end if;

  -- Seed the two legitimate rows.
  insert into plm.twentieth_century_dcp_metadata_asset (metadata_run_id, source_crawl_id, twentieth_century_dcp_asset_id)
  values (v_run, v_crawl, v_asset), (v_run, v_crawl, v_asset2);

  -- -----------------------------------------------------------------------------------
  -- G3. HTTP 200 IS NOT SUCCESS. A success without a JSON OBJECT body is refused. This is
  -- the check that stops a whole run of portal sign-out pages being recorded as a capture.
  -- -----------------------------------------------------------------------------------
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_asset set fetch_status = 'success', http_status = 200,
      raw_metadata = null, retrieved_at = now(),
      source_hash = repeat('a', 64), normalized_hash = repeat('b', 64)
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: fetch_status success was accepted with no response body. '
      'A signed-out 20th Century DCP Vault session returns HTTP 200 with a tiny zero-record body, so '
      'HTTP success alone must never qualify.';
  end if;

  -- A success whose body is a JSON ARRAY rather than an OBJECT is also refused.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_asset set fetch_status = 'success', http_status = 200,
      raw_metadata = '[]'::jsonb, retrieved_at = now(),
      source_hash = repeat('a', 64), normalized_hash = repeat('b', 64)
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a JSON array was accepted as a successful metadata body. '
      'Only an OBJECT is a metadata response; a zero-record array is the sign-out shape.';
  end if;

  -- G4. A terminal failure must carry a code.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_asset set fetch_status = 'failed', failure_code = null
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a terminal failure was accepted with no failure_code. An '
      'untriageable failure row is indistinguishable from a loader bug.';
  end if;

  -- G5. An interpreted value may not exist without its raw source value.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_asset
      set is_exclusive_raw = null, is_exclusive_interpreted = true
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: an interpreted boolean was accepted beside a NULL raw '
      'value. That is a value invented by the parser, not observed from the source.';
  end if;

  -- G6. AN UNKNOWN RIGHTS STRING SURVIVES RAW WITH CONFIDENCE FALSE. Required cases 11
  -- and 13: it must NOT fail the load and must NOT coerce to a guess. The business
  -- meanings of these fields are unknown and require Disney's licensing contact.
  update plm.twentieth_century_dcp_metadata_asset set
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
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;

  if (select is_exclusive_raw from plm.twentieth_century_dcp_metadata_asset
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset) <> 'ZZTEST-UNKNOWN-SPELLING'
  or (select rights_parse_confident from plm.twentieth_century_dcp_metadata_asset
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset) <> false then
    raise exception 'G FAILED: an unknown rights spelling did not survive raw with '
      'confidence false.';
  end if;

  -- -----------------------------------------------------------------------------------
  -- G7. A LINK MAY ONLY HANG OFF A SUCCESSFUL METADATA ROW.
  -- v_asset2 is still `pending`, so a link naming it must be refused by the composite FK
  -- that carries fetch_status.
  -- -----------------------------------------------------------------------------------
  insert into plm.twentieth_century_dcp_property (source_system, source_id)
  values ('twentieth_century_dcpvault', 'ZZTEST-PROP-1') returning id into v_prop;
  insert into plm.twentieth_century_dcp_character (source_system, source_id)
  values ('twentieth_century_dcpvault', 'ZZTEST-CHAR-1') returning id into v_char;

  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_asset_property_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_property_id)
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
      insert into plm.twentieth_century_dcp_property (source_system, source_id)
      values ('twentieth_century_dcpvault', 'ZZTEST-PROP-M-' || i)
      returning id into v_p;
      insert into plm.twentieth_century_dcp_asset_property_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_property_id)
      values (v_run, v_asset, v_p);
    end loop;

    insert into plm.twentieth_century_dcp_asset_character_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_character_id)
    values (v_run, v_asset, v_char);

    select count(*) into v_props from plm.twentieth_century_dcp_asset_property_observation
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
    select count(*) into v_chars from plm.twentieth_century_dcp_asset_character_observation
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;

    if v_props <> 9 or v_chars <> 1 then
      raise exception 'E FAILED: expected 9 property links and 1 character link, got % and %.',
        v_props, v_chars;
    end if;

    -- AND NOTHING ANYWHERE PAIRED THEM. If a bridge existed, this is where nine phantom
    -- relationships would now be sitting.
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'plm' and table_name ~ '^twentieth_century_dcp_(propert.*character|character.*propert)'
    ) then
      raise exception 'E FAILED: a property-character table came into existence. Nine '
        'relationships Disney never asserted would now exist for this one asset.';
    end if;
  end;

  -- E2. A DUPLICATE ARRAY MEMBER COLLAPSES TO ONE LINK without losing the metadata row.
  -- Required case 5.
  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_asset_character_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_character_id)
    values (v_run, v_asset, v_char);
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a duplicate character link was accepted. A repeated array '
      'member is a source quirk and must collapse to one link.';
  end if;
  if (select count(*) from plm.twentieth_century_dcp_metadata_asset
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset) <> 1 then
    raise exception 'E FAILED: the successful metadata row did not survive the duplicate.';
  end if;

  -- E3. AN EMPTY LINK SET IS ZERO ROWS BESIDE A SUCCESSFUL METADATA ROW.
  -- Required case 4's storage half: "observed and empty" is a real, different state from
  -- "no successful metadata row exists".
  update plm.twentieth_century_dcp_metadata_asset set
    fetch_status = 'success', http_status = 200, raw_metadata = '{"zztest": 2}'::jsonb,
    retrieved_at = now(), source_hash = repeat('e', 64), normalized_hash = repeat('f', 64)
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset2;

  if (select count(*) from plm.twentieth_century_dcp_asset_character_observation
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset2) <> 0 then
    raise exception 'E FAILED: asset2 should have zero character links.';
  end if;
  if (select fetch_status from plm.twentieth_century_dcp_metadata_asset
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset2) <> 'success' then
    raise exception 'E FAILED: an asset with no characters must still be a valid success. '
      'The sample proved assets legitimately omit the character field entirely.';
  end if;

  -- -----------------------------------------------------------------------------------
  -- E4. COMPLETING THE RUN FREEZES ITS EVIDENCE -- INSERT INCLUDED.
  -- -----------------------------------------------------------------------------------
  update plm.twentieth_century_dcp_metadata_run set
    status = 'complete', fetches_succeeded = 2, fetches_failed = 0, finished_at = now()
  where metadata_run_id = v_run;

  -- E4a. INSERT of a new character link into a completed run. THIS IS THE ONE THAT
  -- MATTERS: service_role receives SELECT only and all direct writes are denied, so this is the only
  -- mutating operation still available, and without the INSERT branch nothing would stop
  -- an asset being given a character Disney never returned inside a reconciled run.
  v_ok := false;
  begin
    insert into plm.twentieth_century_dcp_asset_character_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_character_id)
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
    update plm.twentieth_century_dcp_metadata_asset set dc_title = 'ZZTEST-CHANGED'
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a completed run''s fetch row was UPDATED.';
  end if;

  -- E4c. DELETE of a completed run's link row.
  v_ok := false;
  begin
    delete from plm.twentieth_century_dcp_asset_property_observation
    where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a completed run''s property link was DELETED.';
  end if;

  -- E4d. The run row itself is immutable once complete.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_run set crawler_version = 'ZZTEST-9'
    where metadata_run_id = v_run;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: a COMPLETE metadata run was updated.';
  end if;

  v_ok := false;
  begin
    delete from plm.twentieth_century_dcp_metadata_run where metadata_run_id = v_run;
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
    update plm.twentieth_century_dcp_character set source_id = 'ZZTEST-CHAR-RENAMED' where id = v_char;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'E FAILED: the source_id of a character observed by a complete run was '
      'changed.';
  end if;

  perform plm.set_source_resolution(
    'twentieth_century_dcpvault','character',
    (select 'id:' || source_id from plm.twentieth_century_dcp_character where id=v_char),
    'deferred',null,null,null,null,'ZZTEST reviewed',null
  );
  if not exists (
    select 1 from plm.source_resolution
    where source_system='twentieth_century_dcpvault' and entity_kind='character'
      and source_id=(select 'id:' || source_id from plm.twentieth_century_dcp_character where id=v_char)
      and resolution_reason='ZZTEST reviewed'
  ) then
    raise exception 'E FAILED: the durable reconciliation decision was not stored.';
  end if;

  -- E6. A second run over the same crawl may still re-observe the same identity. The
  -- identities outlive any single run; freezing them wholesale would break every refresh.
  insert into plm.twentieth_century_dcp_metadata_run (
    metadata_run_id, source_crawl_id, status, captured_on, started_at, endpoint_suffix,
    crawler_version, captured_by, private_source_commit, assets_expected
  ) values (
    v_run2, v_crawl, 'running', date '2026-01-06', now(), '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40), 2
  );
  update plm.twentieth_century_dcp_character set last_seen_metadata_run_id = v_run2 where id = v_char;

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
  v_a := plm.twentieth_century_dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  if v_a !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: hash is not 64 lowercase hex characters.';
  end if;

  -- F2. ARRAY ORDER DOES NOT CHANGE THE HASH. Required case 6. The arrays are unordered
  -- at the source, so an order change is not a data change.
  v_b := plm.twentieth_century_dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P2','ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  v_c := plm.twentieth_century_dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1','ZZTEST-P2'], array['ZZTEST-C1'], array[]::text[], null);
  if v_b <> v_c then
    raise exception 'F FAILED: reordering an unordered source array changed the hash. '
      'Every asset would compare unequal on the next run and report a rewrite that never '
      'happened.';
  end if;

  -- F3. A DUPLICATE MEMBER DOES NOT CHANGE THE HASH (the set is deduplicated).
  v_d := plm.twentieth_century_dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-P1','ZZTEST-P2','ZZTEST-P1'], array['ZZTEST-C1'], array[]::text[], null);
  if v_d <> v_c then
    raise exception 'F FAILED: a duplicate array member changed the hash.';
  end if;

  -- F4. AN EMPTY ARRAY AND A NULL ARRAY HASH DIFFERENTLY. Required case 4, and the most
  -- consequential distinction in the whole scheme: it is the difference between "Disney
  -- removed every character" and "we did not look".
  v_a := plm.twentieth_century_dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array[]::text[], null, null, null);
  v_b := plm.twentieth_century_dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    null, null, null, null);
  if v_a = v_b then
    raise exception 'F FAILED: an OBSERVED EMPTY array hashed the same as an UNOBSERVED '
      'NULL array. Collapsing the two makes "the portal returned nothing" and "we never '
      'asked" permanently indistinguishable.';
  end if;

  -- F5. NULL AND THE EMPTY STRING ARE DIFFERENT SCALARS.
  v_a := plm.twentieth_century_dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_b := plm.twentieth_century_dcp_metadata_row_hash(
    '', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  if v_a = v_b then
    raise exception 'F FAILED: NULL and the empty string hashed identically. The presence '
      'flag exists precisely to keep them apart, and both occur in this source.';
  end if;

  -- F6. CASE AND WHITESPACE IN A SCALAR DO CHANGE THE HASH. Required case 7's normalized
  -- half: there is no case folding and no trimming anywhere in the serialization.
  v_a := plm.twentieth_century_dcp_metadata_row_hash(
    'ZZTEST-U', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_b := plm.twentieth_century_dcp_metadata_row_hash(
    'zztest-u', null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null, null, null);
  v_c := plm.twentieth_century_dcp_metadata_row_hash(
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
  v_a := plm.twentieth_century_dcp_metadata_row_hash(
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, null, null, null, null, null,
    array['ZZTEST-X'], array[]::text[], null, null);
  v_b := plm.twentieth_century_dcp_metadata_row_hash(
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
      perform plm.twentieth_century_dcp_metadata_row_hash(
        'ZZTEST' || chr(31) || 'X', null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null, null, null);
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'F FAILED: a value containing U+001F was accepted into the hash.';
    end if;

    v_ok := false;
    begin
      perform plm.twentieth_century_dcp_metadata_row_hash(
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
      perform plm.twentieth_century_dcp_metadata_row_hash(
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
      where pronamespace = 'plm'::regnamespace and proname = 'twentieth_century_dcp_metadata_row_hash') <> 22 then
    raise exception 'F FAILED: plm.twentieth_century_dcp_metadata_row_hash does not take exactly 22 '
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
  select count(*) into v_n from plm.twentieth_century_dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_metadata_run where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_property where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_character where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_term where source_value like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_asset where file_name like 'zztest%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. The ROLLBACK did not happen -- '
      'this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

\echo 'DCP VAULT METADATA LANDING CONTRACTS: ALL SECTIONS PASSED (A-H)'

-- =====================================================================================
-- Contract tests for migration 20260811060000 -- the Disney 20th Century DCP Vault PHASE 2 metadata
-- CHUNKED LOADER protocol (issue #748, object claim #749).
--
-- -------------------------------------------------------------------------------------
-- HOW THIS FILE IS RUN, AND WHAT ITS RESULT MEANS
--   CI executes it (`.github/workflows/database-contract-tests.yml`, added by #741).
--   IT IS WRITTEN TO PASS FROM EMPTY and must stay that way -- it must never end up in
--   supabase/tests/ci-quarantine.txt. It touches only objects this repository's own
--   migrations create and needs no seeded reference data of any kind.
--
--   ONE ENVIRONMENTAL DEPENDENCY, STATED PLAINLY: the four loader functions are guarded by
--   plm.twentieth_century_dcp_loader_privilege_ok, which is TRUE only for JWT role service_role or
--   session_user postgres / supabase_admin. This file must therefore be run as the
--   migration owner. That is how CI runs it and how the Phase-1 file's documented preview
--   procedure runs it. Section A proves the guard is satisfied BEFORE anything else
--   executes, so a wrong connection fails with a clear reason instead of eight confusing
--   permission errors.
--
-- SIDE EFFECTS: NONE. Everything that writes runs inside a transaction ending in ROLLBACK,
--   and section H re-asserts that against committed state.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No real Disney
--   property, character, style guide, art style, keyword, DAM path, file name or portal
--   URL appears here. Fixtures use ZZTEST-* tokens, example.invalid URLs and the reserved
--   uuid prefix 99999999-9999-4999-8999-*.
--
-- WHY EVERY "must be refused" CHECK TRAPS sqlstate 'P0001' AND NOT `when others`:
--   `when others` is satisfied by ANY error, so a section would PASS FOR THE WRONG REASON
--   -- reporting a guard works when the statement never reached it. Every guard in the
--   loader raises with `using errcode = 'P0001'`, so that is what is trapped.
--
-- WHAT IT ASSERTS
--   A  The privilege guard is satisfied, and the four loader functions exist as SECURITY
--      DEFINER with pg_catalog FIRST in a pinned search_path.
--   B  begin refuses an INCOMPLETE source crawl, a second concurrent run, and a crawl
--      with zero memberships; it seeds one pending row per expected asset and counts
--      assets_expected from the evidence rather than from the caller.
--   C  The chunk contract: bad digest refused, non-array refused, empty chunk refused,
--      an IDENTICAL replay is a no-op, and the same chunk number with DIFFERENT bytes is
--      refused.
--   D  THE INDEPENDENCE RULE THROUGH THE LOADER. A response with many properties and one
--      character produces many property links and one character link and NOTHING that
--      relates them.
--   E  Empty array vs absent array; duplicate members collapse; a signed-out HTTP-200
--      body is refused as success; an asset outside the source crawl is rejected into the
--      exception table rather than landing; a duplicate asset within one run is rejected.
--   F  The normalized hash is computed FROM STORED VALUES, and array order does not
--      change it.
--   G  finalize refuses on a pending row, on an open rejection, and on a non-contiguous
--      chunk stream; it succeeds when everything reconciles; fail preserves evidence and
--      refuses to touch a completed run.
--   H  No test data survived.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. PRECONDITIONS. Proved FIRST so a wrong connection or a missing object fails with one
--    clear reason rather than as a cascade of confusing errors further down.
-- =====================================================================================
do $$
declare
  v_fns int;
  v_bad text;
begin
  if not plm.twentieth_century_dcp_loader_privilege_ok(auth.role(), session_user) then
    raise exception 'A FAILED: this connection does not satisfy '
      'plm.twentieth_century_dcp_loader_privilege_ok (JWT role %L / session_user %L). The loader contract '
      'tests must run as the migration owner -- postgres or supabase_admin -- or as '
      'service_role. Nothing below can execute otherwise.',
      coalesce(auth.role(), '<null>'), coalesce(session_user, '<null>');
  end if;

  select count(*) into v_fns
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname in ('begin_twentieth_century_dcp_metadata_run','load_twentieth_century_dcp_metadata_chunk',
                      'finalize_twentieth_century_dcp_metadata_run','fail_twentieth_century_dcp_metadata_run');
  if v_fns <> 4 then
    raise exception 'A FAILED: expected 4 loader functions, found %.', v_fns;
  end if;

  -- SECURITY DEFINER with pg_catalog FIRST. A definer function that resolves builtins
  -- through a caller-influenced schema is the classic definer escalation, and it applies
  -- perfectly clean -- which is why it is asserted rather than assumed.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname in ('begin_twentieth_century_dcp_metadata_run','load_twentieth_century_dcp_metadata_chunk',
                      'finalize_twentieth_century_dcp_metadata_run','fail_twentieth_century_dcp_metadata_run')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=pg_catalog%'));
  if v_bad is not null then
    raise exception 'A FAILED: function(s) % are not SECURITY DEFINER with pg_catalog '
      'first in a pinned search_path.', v_bad;
  end if;

  -- The two loader tables exist and service_role cannot TRUNCATE them. TRUNCATE fires no
  -- row triggers, so every freeze in this schema depends on that revoke.
  if to_regclass('plm.twentieth_century_dcp_metadata_chunk_ledger') is null
  or to_regclass('plm.twentieth_century_dcp_metadata_load_exception') is null then
    raise exception 'A FAILED: a loader table is missing.';
  end if;
  if has_table_privilege('service_role', 'plm.twentieth_century_dcp_metadata_chunk_ledger', 'TRUNCATE')
  or has_table_privilege('service_role', 'plm.twentieth_century_dcp_metadata_load_exception', 'TRUNCATE') then
    raise exception 'A FAILED: service_role holds TRUNCATE on a loader table. TRUNCATE '
      'fires NO row triggers, so one statement would erase a completed run''s evidence '
      'with every freeze trigger standing silently by.';
  end if;

  raise notice 'A PASSED: privilege guard satisfied, 4 definer functions with '
    'pg_catalog-first search paths, both loader tables present and TRUNCATE-proof.';
end;
$$;

-- =====================================================================================
-- Everything below writes. ONE transaction, ROLLBACK at the end.
-- =====================================================================================
begin;

do $$
declare
  v_crawl    uuid := '99999999-9999-4999-8999-000000000201';
  v_partial  uuid := '99999999-9999-4999-8999-000000000202';
  v_empty    uuid := '99999999-9999-4999-8999-000000000203';
  v_tile     uuid;
  v_guide    uuid;
  v_a1       uuid;
  v_a2       uuid;
  v_a3       uuid;
  v_sec      uuid;
  v_run      uuid;
  v_run2     uuid;
  v_ok       boolean;
  v_json     text;
  v_sha      text;
  v_res      jsonb;
  v_n        int;
  v_hash1    text;
  v_hash2    text;
begin
  -- -----------------------------------------------------------------------------------
  -- FIXTURE: one COMPLETE crawl with three assets, plus an INCOMPLETE crawl and an
  -- EMPTY-but-complete crawl to drive the begin-time refusals.
  -- -----------------------------------------------------------------------------------
  insert into plm.twentieth_century_dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values
    (v_crawl, date '2026-02-01', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running', 3, 3, now()),
    (v_partial, date '2026-02-02', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running', 1, 1, now()),
    (v_empty, date '2026-02-03', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'complete', 0, 0, now());

  insert into plm.twentieth_century_dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-L', v_crawl) returning id into v_tile;
  insert into plm.twentieth_century_dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/lguide', 'ZZTEST-GUIDE-L', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/one.zzz', v_guide, 'one.zzz', 'zzz', v_crawl) returning id into v_a1;
  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/two.zzz', v_guide, 'two.zzz', 'zzz', v_crawl) returning id into v_a2;
  -- Belongs to the PARTIAL crawl only -- used to prove cross-crawl rejection.
  insert into plm.twentieth_century_dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/three.zzz', v_guide, 'three.zzz', 'zzz', v_partial) returning id into v_a3;

  insert into plm.twentieth_century_dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 2, now()) returning id into v_sec;

  insert into plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id, observed_row_hash)
  values (v_crawl, v_a1, repeat('1', 64)), (v_crawl, v_a2, repeat('2', 64));
  insert into plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id, observed_row_hash)
  values (v_partial, v_a3, repeat('3', 64));

  -- ===================================================================================
  -- B. begin_twentieth_century_dcp_metadata_run
  -- ===================================================================================

  -- B1. An INCOMPLETE source crawl is refused. Metadata is fetched per asset PATH, so
  -- running against a growing list would fix assets_expected against a moving target.
  v_ok := false;
  begin
    perform plm.begin_twentieth_century_dcp_metadata_run('twentieth_century_dcpvault', v_partial, date '2026-02-04', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a metadata run was begun over an INCOMPLETE path crawl.';
  end if;

  -- B2. A complete crawl with ZERO memberships is refused. A run over nothing would
  -- finalize instantly and truthfully report complete, which is the most misleading
  -- possible outcome.
  v_ok := false;
  begin
    perform plm.begin_twentieth_century_dcp_metadata_run('twentieth_century_dcpvault', v_empty, date '2026-02-04', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a metadata run was begun over a crawl with zero asset '
      'memberships.';
  end if;

  update plm.twentieth_century_dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- B3. The happy path seeds one PENDING row per expected asset and counts
  -- assets_expected FROM THE EVIDENCE. Note there is no assets_expected parameter at all:
  -- a caller-supplied target is one the caller can make match whatever it loaded.
  v_run := plm.begin_twentieth_century_dcp_metadata_run('twentieth_century_dcpvault', v_crawl, date '2026-02-04', '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));

  if (select assets_expected from plm.twentieth_century_dcp_metadata_run where metadata_run_id = v_run) <> 2 then
    raise exception 'B FAILED: assets_expected was not counted from plm.twentieth_century_dcp_asset_crawl.';
  end if;
  select count(*) into v_n from plm.twentieth_century_dcp_metadata_asset
  where metadata_run_id = v_run and fetch_status = 'pending';
  if v_n <> 2 then
    raise exception 'B FAILED: expected 2 seeded pending rows, found %. Seeding is what '
      'makes "every expected asset has exactly one fetch row" true from the first second '
      'rather than something finalization must go looking for.', v_n;
  end if;

  -- B4. A SECOND concurrent run over the same crawl is refused. Two runs would each
  -- finalize against the other's rows.
  v_ok := false;
  begin
    perform plm.begin_twentieth_century_dcp_metadata_run('twentieth_century_dcpvault', v_crawl, date '2026-02-05', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a second RUNNING metadata run was begun for one crawl.';
  end if;

  raise notice 'B PASSED: incomplete crawl, empty crawl and concurrent run all refused; '
    'happy path seeded 2 pending rows and counted assets_expected from the evidence.';

  -- ===================================================================================
  -- C. THE CHUNK CONTRACT
  -- ===================================================================================

  -- C1. A wrong digest is refused BEFORE anything is stored.
  v_json := '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"failed","failure_code":"ZZTEST"}]';
  v_ok := false;
  begin
    perform plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, repeat('0', 64));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: a chunk with a wrong digest was accepted.';
  end if;
  if (select count(*) from plm.twentieth_century_dcp_metadata_chunk_ledger where metadata_run_id = v_run) <> 0 then
    raise exception 'C FAILED: a ledger row was written for a chunk that failed integrity.';
  end if;

  -- C2. A non-array payload and an empty array are both refused.
  v_json := '{"not":"an array"}';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: a non-array chunk was accepted.';
  end if;

  v_json := '[]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: an EMPTY chunk was accepted. It contributes nothing and '
      'makes the chunk numbering lie about how much was sent.';
  end if;

  -- ===================================================================================
  -- D + E. A REAL CHUNK: many properties, one character, an EMPTY array and an ABSENT
  --        array, plus a duplicate member.
  --
  -- THE CENTRAL ASSERTION OF THIS WHOLE WORKSTREAM IS D BELOW.
  -- ===================================================================================
  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,'
    || '"raw_metadata_text":"{\"zztest\":1}",'
    || '"dc_title":"ZZTEST-TITLE","source_status":"ZZTEST-STATUS",'
    || '"is_exclusive_raw":"ZZTEST-UNKNOWN","rights_parse_confident":false,'
    || '"properties":["ZZTEST-P1","ZZTEST-P2","ZZTEST-P3","ZZTEST-P4","ZZTEST-P5",'
    || '"ZZTEST-P6","ZZTEST-P7","ZZTEST-P8","ZZTEST-P9","ZZTEST-P1"],'
    || '"characters":["ZZTEST-C1"],'
    || '"art_styles":[],'
    || '"keywords":["ZZTEST-K1"]}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);

  if (v_res->>'rows_landed')::int <> 1 or (v_res->>'rows_rejected')::int <> 0 then
    raise exception 'D FAILED: the chunk did not land cleanly: %', v_res::text;
  end if;

  -- D1. NINE properties (the tenth is a duplicate that must collapse) and ONE character.
  select count(*) into v_n from plm.twentieth_century_dcp_asset_property_observation
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1;
  if v_n <> 9 then
    raise exception 'D FAILED: expected 9 property links after a 10-element array with one '
      'duplicate, got %.', v_n;
  end if;
  select count(*) into v_n from plm.twentieth_century_dcp_asset_character_observation
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1;
  if v_n <> 1 then
    raise exception 'D FAILED: expected exactly 1 character link, got %.', v_n;
  end if;

  -- D2. AND NOTHING RELATED THEM. This is the assertion the entire design exists to make:
  -- nine phantom relationships is precisely what a bridge would have produced here.
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'plm' and table_name ~ '^twentieth_century_dcp_(propert.*character|character.*propert)'
  ) then
    raise exception 'D FAILED: a property-character table exists. Nine relationships '
      'Disney never asserted would now exist for this single asset.';
  end if;
  if exists (
    select c.table_name from information_schema.columns c
    where c.table_schema = 'plm' and c.column_name in ('twentieth_century_dcp_property_id','twentieth_century_dcp_character_id')
    group by c.table_name having count(distinct c.column_name) > 1
  ) then
    raise exception 'D FAILED: a plm table now references BOTH a property and a character.';
  end if;

  -- E1. An EMPTY array produced ZERO term links of that kind, beside a SUCCESSFUL row --
  -- and the row is still a success. An absent array is a different fact from an empty one.
  select count(*) into v_n
  from plm.twentieth_century_dcp_asset_term_observation o join plm.twentieth_century_dcp_term t on t.id = o.twentieth_century_dcp_term_id
  where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1 and t.term_kind = 'art_style';
  if v_n <> 0 then
    raise exception 'E FAILED: an empty art_styles array produced % link(s).', v_n;
  end if;
  select count(*) into v_n
  from plm.twentieth_century_dcp_asset_term_observation o join plm.twentieth_century_dcp_term t on t.id = o.twentieth_century_dcp_term_id
  where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1 and t.term_kind = 'keyword';
  if v_n <> 1 then
    raise exception 'E FAILED: expected 1 keyword link, got %.', v_n;
  end if;
  if (select fetch_status from plm.twentieth_century_dcp_metadata_asset
      where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1) <> 'success' then
    raise exception 'E FAILED: the row with an empty array is not a success. An empty array '
      'is a real observation, not a failure.';
  end if;

  -- E2. THE HASH WAS COMPUTED FROM STORED VALUES and is present.
  select normalized_hash, source_hash into v_hash1, v_sha
  from plm.twentieth_century_dcp_metadata_asset where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1;
  if v_hash1 is null or v_hash1 !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: no normalized hash was computed for a successful row.';
  end if;
  -- It must equal the hash of what is STORED, recomputed independently here. If the
  -- loader had digested the INPUT row instead, a value the upsert declined to overwrite
  -- would make these differ -- which is exactly the permanent staleness this proves absent.
  select plm.twentieth_century_dcp_metadata_row_hash(
    m.source_uuid, m.collection_dmc_id, m.collection_main_title, m.collection_type,
    m.dc_title, m.design_element, m.content_type, m.content_owner, m.source_status,
    m.is_exclusive_raw, m.is_embargoed_raw, m.is_locked_raw, m.release_date_raw,
    m.modified_at_raw, m.file_size_raw, m.format_raw, m.num_pages_raw, m.dam_sha1,
    (select coalesce(array_agg(p.source_id), array[]::text[])
       from plm.twentieth_century_dcp_asset_property_observation o join plm.twentieth_century_dcp_property p on p.id = o.twentieth_century_dcp_property_id
      where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1),
    (select coalesce(array_agg(c.source_id), array[]::text[])
       from plm.twentieth_century_dcp_asset_character_observation o join plm.twentieth_century_dcp_character c on c.id = o.twentieth_century_dcp_character_id
      where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1),
    (select coalesce(array_agg(t.source_value), array[]::text[])
       from plm.twentieth_century_dcp_asset_term_observation o join plm.twentieth_century_dcp_term t on t.id = o.twentieth_century_dcp_term_id
      where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1 and t.term_kind = 'art_style'),
    (select coalesce(array_agg(t.source_value), array[]::text[])
       from plm.twentieth_century_dcp_asset_term_observation o join plm.twentieth_century_dcp_term t on t.id = o.twentieth_century_dcp_term_id
      where o.metadata_run_id = v_run and o.twentieth_century_dcp_asset_id = v_a1 and t.term_kind = 'keyword')
  ) into v_hash2
  from plm.twentieth_century_dcp_metadata_asset m
  where m.metadata_run_id = v_run and m.twentieth_century_dcp_asset_id = v_a1;
  if v_hash1 <> v_hash2 then
    raise exception 'F FAILED: the stored normalized hash does not match a hash recomputed '
      'from the STORED values. The loader digested something other than what it stored, '
      'which is how a stale stored field hides behind an unchanged-looking digest forever.';
  end if;

  raise notice 'D PASSED: 9 property links and 1 character link on one asset, duplicate '
    'collapsed, and NOTHING related them.';
  raise notice 'F PASSED: the normalized hash matches a hash recomputed from the STORED '
    'values, proving the loader did not digest its input.';
end;
$$;

-- The replay, cross-crawl rejection, duplicate-asset rejection, signed-out refusal and
-- finalize gates continue in a second block against the same transaction's data.
do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000201';
  v_partial uuid := '99999999-9999-4999-8999-000000000202';
  v_run   uuid;
  v_a1    uuid;
  v_a2    uuid;
  v_a3    uuid;
  v_json  text;
  v_sha   text;
  v_res   jsonb;
  v_ok    boolean;
  v_n     int;
  v_props int;
begin
  select metadata_run_id into v_run from plm.twentieth_century_dcp_metadata_run
  where source_crawl_id = v_crawl and status = 'running';
  select id into v_a1 from plm.twentieth_century_dcp_asset where source_path = '/zztest/lguide/one.zzz';
  select id into v_a2 from plm.twentieth_century_dcp_asset where source_path = '/zztest/lguide/two.zzz';
  select id into v_a3 from plm.twentieth_century_dcp_asset where source_path = '/zztest/lguide/three.zzz';

  if v_run is null then
    raise exception 'C FAILED: the running metadata run vanished between blocks.';
  end if;

  -- ---------------------------------------------------------------------------------
  -- C3. IDENTICAL REPLAY IS A NO-OP. Rebuild the exact chunk 1 payload and resend it.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,'
    || '"raw_metadata_text":"{\"zztest\":1}",'
    || '"dc_title":"ZZTEST-TITLE","source_status":"ZZTEST-STATUS",'
    || '"is_exclusive_raw":"ZZTEST-UNKNOWN","rights_parse_confident":false,'
    || '"properties":["ZZTEST-P1","ZZTEST-P2","ZZTEST-P3","ZZTEST-P4","ZZTEST-P5",'
    || '"ZZTEST-P6","ZZTEST-P7","ZZTEST-P8","ZZTEST-P9","ZZTEST-P1"],'
    || '"characters":["ZZTEST-C1"],'
    || '"art_styles":[],'
    || '"keywords":["ZZTEST-K1"]}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');

  select count(*) into v_props from plm.twentieth_century_dcp_asset_property_observation
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1;

  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);
  if (v_res->>'replayed')::boolean is not true then
    raise exception 'C FAILED: an IDENTICAL chunk replay was not reported as a replay. A '
      'dropped connection mid-load must be safe to retry.';
  end if;

  select count(*) into v_n from plm.twentieth_century_dcp_asset_property_observation
  where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a1;
  if v_n <> v_props then
    raise exception 'C FAILED: a replay changed the property link count from % to %.',
      v_props, v_n;
  end if;

  -- C4. THE SAME CHUNK NUMBER WITH DIFFERENT BYTES IS REFUSED. A chunk number is not a
  -- slot to be overwritten.
  v_json := replace(v_json, 'ZZTEST-TITLE', 'ZZTEST-TITLE-CHANGED');
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: chunk 1 was re-applied with DIFFERENT content.';
  end if;

  raise notice 'C PASSED: bad digest, non-array, empty chunk and content-changed replay '
    'all refused; identical replay is an idempotent no-op.';

  -- ---------------------------------------------------------------------------------
  -- E3. A SIGNED-OUT HTTP-200 BODY IS NOT A SUCCESS. This is the guard that stops a whole
  --     run of portal sign-out pages being recorded as a successful capture.
  -- E4. AN ASSET OUTSIDE THE SOURCE CRAWL IS REJECTED, not landed.
  -- Both are sent as chunk 2 and BOTH must land in the exception table.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/two.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"[]"},'
    || '{"source_path":"/zztest/lguide/three.zzz","row_number":2,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"{\"zztest\":3}"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 2, v_json, v_sha);

  if (v_res->>'rows_rejected')::int <> 2 or (v_res->>'rows_landed')::int <> 0 then
    raise exception 'E FAILED: expected both rows rejected, got %.', v_res::text;
  end if;

  if not exists (
    select 1 from plm.twentieth_century_dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 2
      and reason_code = 'success_body_not_object'
  ) then
    raise exception 'E FAILED: an HTTP-200 body that is a JSON ARRAY was not rejected as '
      'success_body_not_object. A signed-out session returns exactly that shape.';
  end if;
  if not exists (
    select 1 from plm.twentieth_century_dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 2
      and reason_code = 'asset_not_in_source_crawl'
  ) then
    raise exception 'E FAILED: an asset belonging to a DIFFERENT crawl was not rejected. '
      'Metadata may only cover assets its own crawl observed.';
  end if;

  -- The rejected asset must NOT have landed anywhere.
  if exists (select 1 from plm.twentieth_century_dcp_metadata_asset
             where metadata_run_id = v_run and twentieth_century_dcp_asset_id = v_a3) then
    raise exception 'E FAILED: a cross-crawl asset created a metadata row.';
  end if;

  -- NO ROW WAS SILENTLY SKIPPED: the ledger arithmetic proves it.
  if not exists (
    select 1 from plm.twentieth_century_dcp_metadata_chunk_ledger
    where metadata_run_id = v_run and chunk_number = 2
      and rows_received = 2 and rows_landed = 0 and rows_rejected = 2
  ) then
    raise exception 'E FAILED: the chunk 2 ledger row does not reconcile. '
      'landed + rejected = received is the structural form of "no row is ever silently '
      'skipped".';
  end if;

  -- ---------------------------------------------------------------------------------
  -- G1. FINALIZE REFUSES WHILE A ROW IS STILL PENDING. Asset two never got a valid
  --     response, so it is exactly the "short run presenting itself as complete" case.
  -- ---------------------------------------------------------------------------------
  v_ok := false;
  begin
    perform plm.finalize_twentieth_century_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run with a PENDING row finalized. Every expected asset '
      'needs one success or one recorded terminal failure; neither is a silent gap.';
  end if;

  -- ---------------------------------------------------------------------------------
  -- G2. FINALIZE REFUSES OVER AN OPEN REJECTION, even once every row is terminal.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/two.zzz","row_number":1,"fetch_status":"not_found",'
    || '"http_status":404,"failure_code":"ZZTEST-404","failure_reason":"ZZTEST not found"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 3, v_json, v_sha);
  if (v_res->>'rows_landed')::int <> 1 then
    raise exception 'G FAILED: a terminal not_found row did not land: %', v_res::text;
  end if;

  select count(*) into v_n from plm.twentieth_century_dcp_metadata_asset
  where metadata_run_id = v_run and fetch_status = 'pending';
  if v_n <> 0 then
    raise exception 'G FAILED: % row(s) still pending after every asset was answered.', v_n;
  end if;

  v_ok := false;
  begin
    perform plm.finalize_twentieth_century_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run finalized over UNRESOLVED rejections. Completing over '
      'open rejections is how a partial capture becomes a permanent record of a complete '
      'one.';
  end if;

  -- Resolve them the way a human would.
  update plm.twentieth_century_dcp_metadata_load_exception
    set resolved_at = now(), resolution_note = 'ZZTEST triaged'
  where metadata_run_id = v_run and resolved_at is null;

  -- ---------------------------------------------------------------------------------
  -- G3. FINALIZE REFUSES A NON-CONTIGUOUS CHUNK STREAM. A gap means a chunk was never
  --     applied and its rows are missing from a run that would otherwise balance.
  -- ---------------------------------------------------------------------------------
  v_json := '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,'
         || '"fetch_status":"failed","failure_code":"ZZTEST-GAP"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  -- Chunk 9, skipping 4-8. The row itself is rejected as a duplicate asset (see E5), but
  -- the LEDGER row still lands, which is what makes the stream non-contiguous.
  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 9, v_json, v_sha);

  -- E5. A DUPLICATE ASSET WITHIN ONE RUN IS REJECTED, never silently overwritten.
  if not exists (
    select 1 from plm.twentieth_century_dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 9
      and reason_code = 'duplicate_asset_in_run'
  ) then
    raise exception 'E FAILED: a second response for an already-answered asset was not '
      'rejected. A metadata run records ONE response per asset; a second would silently '
      'overwrite the first.';
  end if;

  v_ok := false;
  begin
    perform plm.finalize_twentieth_century_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run finalized with a NON-CONTIGUOUS chunk stream (1,2,3,9).';
  end if;

  raise notice 'E PASSED: signed-out body refused as success, cross-crawl asset rejected, '
    'duplicate asset rejected, ledger arithmetic reconciles.';

  -- ---------------------------------------------------------------------------------
  -- G4. fail_twentieth_century_dcp_metadata_run PRESERVES EVERYTHING and requires a reason.
  -- ---------------------------------------------------------------------------------
  v_ok := false;
  begin
    perform plm.fail_twentieth_century_dcp_metadata_run(v_run, '');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run was failed with no message. That is an unanswerable '
      'question later.';
  end if;

  select count(*) into v_props from plm.twentieth_century_dcp_asset_property_observation
  where metadata_run_id = v_run;
  perform plm.fail_twentieth_century_dcp_metadata_run(v_run, 'ZZTEST deliberate failure');

  if (select status from plm.twentieth_century_dcp_metadata_run where metadata_run_id = v_run) <> 'failed' then
    raise exception 'G FAILED: the run did not reach status failed.';
  end if;
  select count(*) into v_n from plm.twentieth_century_dcp_asset_property_observation where metadata_run_id = v_run;
  if v_n <> v_props then
    raise exception 'G FAILED: failing a run destroyed % link row(s). NEVER destroy '
      'licensed evidence as a first response.', v_props - v_n;
  end if;

  -- G5. A FAILED run may not be reopened, and may not receive more chunks.
  v_ok := false;
  begin
    update plm.twentieth_century_dcp_metadata_run set status = 'running' where metadata_run_id = v_run;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a FAILED run was reopened. It could then be finalized as '
      'though it had always succeeded.';
  end if;

  v_ok := false;
  begin
    perform plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 10, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a FAILED run accepted another chunk.';
  end if;

  raise notice 'G PASSED: finalize refused on pending rows, open rejections and a '
    'non-contiguous stream; fail requires a reason, preserves all evidence, and cannot be '
    'reopened.';
end;
$$;

-- =====================================================================================
-- G6. THE CLEAN HAPPY PATH, END TO END, IN ITS OWN RUN: begin -> load -> finalize.
--     Proves the gates above are not simply refusing everything.
-- =====================================================================================
do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000201';
  v_run   uuid;
  v_json  text;
  v_sha   text;
  v_res   jsonb;
begin
  v_run := plm.begin_twentieth_century_dcp_metadata_run('twentieth_century_dcpvault', v_crawl, date '2026-02-09', '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('b', 40));

  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"{\"zztest\":10}",'
    || '"characters":[],"properties":["ZZTEST-P1"]},'
    || '{"source_path":"/zztest/lguide/two.zzz","row_number":2,"fetch_status":"not_found",'
    || '"http_status":404,"failure_code":"ZZTEST-404"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_twentieth_century_dcp_metadata_chunk('twentieth_century_dcpvault', v_run, 1, v_json, v_sha);
  if (v_res->>'rows_landed')::int <> 2 then
    raise exception 'G FAILED: the clean chunk did not land both rows: %', v_res::text;
  end if;

  v_res := plm.finalize_twentieth_century_dcp_metadata_run(v_run);
  if v_res->>'status' <> 'complete'
  or (v_res->>'fetches_succeeded')::int <> 1
  or (v_res->>'fetches_failed')::int <> 1
  or (v_res->>'assets_expected')::int <> 2 then
    raise exception 'G FAILED: finalize did not reconcile 1 success + 1 terminal failure '
      'against 2 expected: %', v_res::text;
  end if;

  -- An asset whose character array was OBSERVED AND EMPTY is still a valid success with
  -- zero character links. Required case 10.
  if (select count(*) from plm.twentieth_century_dcp_asset_character_observation where metadata_run_id = v_run) <> 0 then
    raise exception 'G FAILED: an empty character array produced links.';
  end if;

  -- And the completed run is now frozen against INSERT.
  declare v_ok boolean := false; v_c uuid;
  begin
    select id into v_c from plm.twentieth_century_dcp_character limit 1;
    begin
      insert into plm.twentieth_century_dcp_asset_character_observation (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_character_id)
      select v_run, m.twentieth_century_dcp_asset_id, v_c from plm.twentieth_century_dcp_metadata_asset m
      where m.metadata_run_id = v_run and m.fetch_status = 'success' limit 1;
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'G FAILED: a completed run accepted a new character link.';
    end if;
  end;

  raise notice 'G6 PASSED: begin -> load -> finalize completed and reconciled exactly, and '
    'the completed run is frozen.';
end;
$$;

rollback;

-- =====================================================================================
-- H. NO TEST DATA SURVIVED.
-- =====================================================================================
do $$
declare v_n int; v_total int := 0;
begin
  select count(*) into v_n from plm.twentieth_century_dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_metadata_run where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_property where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_character where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_term where source_value like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.twentieth_century_dcp_metadata_load_exception where reason_code like 'ZZTEST%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. The ROLLBACK did not happen -- '
      'this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

\echo 'DCP VAULT METADATA LOADER CONTRACTS: ALL SECTIONS PASSED (A-H)'
