-- =====================================================================================
-- THIS FILE PERMANENTLY DOES NOT BELONG IN THE FROM-EMPTY CI LANE. THIS IS A DECISION,
-- NOT A BACKLOG ITEM. (issue #754)
-- =====================================================================================
-- It is listed in supabase/tests/ci-quarantine.txt and it is expected to stay there.
--
-- Issue #754 supplied a captured pre-adoption baseline and a synthetic fixture seed so
-- that the contract tests could run against the ephemeral database in CI. Those fixed the
-- tests that were only missing OBJECTS or missing ROWS. This file is neither of those.
--
-- Sections A-D and H assert the state of SPECIFIC REAL TAXONOMY ROWS -- the COCO property
-- and the licensor it was ruled to belong to, identified by their actual production
-- identifiers. Only a deployed database that has actually taken the ruling holds them.
--
-- AND THEY CANNOT BE SEEDED. The CI fixture seed is synthetic by rule: no real licensor
-- or property name may be committed to this repository. A fixture built to satisfy this
-- file would have to carry the very rows the rule forbids -- and even if it did, the test
-- would then be checking rows the fixture had just written, which proves nothing about
-- whether the ruling actually landed.
--
-- SO IT IS NOT AN UNFINISHED JOB. It is run by hand against preview after the migration
-- is applied, before a production promotion, exactly as the header below describes.
-- =====================================================================================

-- Contract tests for 20260807030000_owner_ruling_coco_is_a_disney_license.sql
--
-- HOW TO RUN -- this file is psql-only and will NOT work through a generic SQL client.
--
--     psql "$DATABASE_URL" --set ON_ERROR_STOP=1 \
--       -f supabase/tests/owner_ruling_coco_is_a_disney_license_contracts.sql
--
-- Run it from the REPOSITORY ROOT, against a disposable database or preview, AFTER the
-- migration is applied. The whole file runs in one transaction and ends in ROLLBACK, so
-- nothing it does survives. Do not run it as a long-lived production session.
--
-- WHY psql SPECIFICALLY: the `\set` below uses psql's backtick substitution to read the REAL
-- migration file off disk into a variable. Sections E and F then execute THAT TEXT -- the
-- actual shipped migration, byte for byte -- against deliberately broken fixtures. There
-- is no second copy of the guard logic in this file, so these tests cannot drift away from
-- the migration they are testing. If the migration changes, these tests test the change.
--
-- WHAT IS AND IS NOT PROVEN HERE -- read this before trusting a green run.
--
--   * Sections A-D and H are STATE assertions. They read the database after the migration
--     has been applied and check the resulting rows. They prove the outcome.
--   * Sections E and F are BEHAVIOURAL. Each one re-executes the real migration text and
--     asserts what it does. Every case in Section E is a PAIR:
--         (1) a TRIGGERING fixture, where the migration MUST abort, and the specific
--             guard message is asserted -- not merely "something raised"; and
--         (2) a CONTROL fixture on the same code path, where the migration MUST NOT abort.
--     A guard that fires on everything would fail its control. A guard that fires on
--     nothing would fail its triggering case. A test that asserted neither -- which is
--     what an earlier revision of this file did -- passes vacuously and is worthless.
--   * Each case is wrapped in a REAL transactional SAVEPOINT and is rolled back to that
--     savepoint. PL/pgSQL cannot issue SAVEPOINT, so the savepoints are top-level psql
--     statements around each DO block. That is why the structure below looks the way it
--     does.
--
-- EXECUTION RECORD -- 2026-08-07, and what it does and does not prove.
--
-- This file WAS run end to end, twice, against a DISPOSABLE local PostgreSQL 18.4
-- database loaded with a minimal fixture that reproduces the real production UUIDs,
-- the (licensor_id, code) unique constraint, and the measured row counts (COCO under
-- ZZ; COCA COLA's own CCC/CCZ properties; 15 assets on COCO all carrying DISNEY).
-- Run once WITHOUT core.taxonomy_owner_ruling (mirroring production, where 20260802171000
-- is held) and once WITH it (mirroring preview). All cases passed in both; G skipped in
-- the first and passed in the second.
--
-- Each negative case was then MUTATION-TESTED -- the guard was neutralised in a copy of
-- the migration and the suite re-run, to prove the case can actually fail:
--   * name guard removed        -> E1 FAILED ("the migration COMPLETED against a row
--                                  named COCA COLA CLASSIC")
--   * unique-key guard removed  -> E2 FAILED ("aborted, but not on its own unique-key
--                                  precondition")
--   * parent guard removed      -> E3 FAILED ("COMPLETED and silently overwrote an
--                                  unexpected parent")
--   * auth.role() injected      -> E4 FAILED (the pg_proc version it replaced could NEVER
--                                  fail, which is why it was replaced)
--   * ruled_at re-stamped to midnight UTC
--                               -> G FAILED ("reads 2026-08-05 in America/New_York")
--
-- WHAT THIS DOES NOT PROVE. The fixture is NOT the production schema -- it contains only
-- the objects this migration touches. It exercises the migration's GUARD LOGIC, which is
-- what Sections E and F are for. Sections A-D, G and H are state assertions whose value
-- comes from running them against a REAL database (preview, or production after
-- promotion) where the full schema, RLS and the true row counts exist. Running this
-- against the disposable fixture is necessary evidence, not sufficient evidence.

\set ON_ERROR_STOP on

-- Read the REAL migration off disk. If this is empty, everything below is meaningless,
-- so it is checked immediately and loudly rather than silently testing an empty string.
\set migration_body `cat supabase/migrations/20260807030000_owner_ruling_coco_is_a_disney_license.sql`

begin;

set local search_path = public;

-- The migration text, and the four UUIDs the whole thing turns on. Matched by UUID and
-- never by code: property code 'CC' is COCO, but licensor code 'CC' is COCA COLA.
create temporary table t_mig (body text) on commit drop;
insert into t_mig values (:'migration_body');

create temporary table t_ids on commit drop as
select '5c03fc46-5a02-4da1-bcac-8969e74bbd8f'::uuid as coco_prop,
       '7d141a6f-e229-46a2-b3f5-0ba0c97dd820'::uuid as disney,
       '80276015-a751-4438-8c25-759c8dd005b2'::uuid as no_license,
       'c70e095c-2baf-404e-a2a3-c198a259a3e6'::uuid as coca_cola;

-- A helper that runs the REAL migration text and reports what happened, instead of
-- letting an exception abort the test run. Returns the error message, or NULL when the
-- migration completed without aborting.
--
-- The `exception when others` block is itself an implicit subtransaction, so a migration
-- that aborts leaves no partial write behind even before the enclosing savepoint rolls
-- back. `p_body` is a parameter rather than a read of t_mig so that a mutated variant can
-- be passed in.
create or replace function pg_temp.run_migration(p_body text)
returns text language plpgsql as $fn$
begin
  execute p_body;
  return null;
exception when others then
  return sqlerrm;
end;
$fn$;

-- Guard the guard: prove the file actually loaded and is the migration we think it is.
do $precheck$
declare v_body text; v_len integer;
begin
  select body into v_body from t_mig;
  v_len := coalesce(length(v_body), 0);

  if v_len = 0 then
    raise exception
      'PRECHECK FAILED: the migration file loaded as EMPTY. Run psql from the repository '
      'ROOT so that the relative path on the \set line resolves, and confirm the file '
      'supabase/migrations/20260807030000_owner_ruling_coco_is_a_disney_license.sql exists. '
      'Every behavioural test below would otherwise pass vacuously against an empty string.';
  end if;

  if position('Coco ruling aborted' in v_body) = 0 then
    raise exception
      'PRECHECK FAILED: the loaded file (% chars) contains no "Coco ruling aborted" text, '
      'so it is not the migration these tests target.', v_len;
  end if;

  raise notice 'PRECHECK ok: loaded the real migration, % chars.', v_len;
end;
$precheck$;

-- ===========================================================================
-- A. The ruling landed.
-- ===========================================================================
do $a$
declare i record; v_lic uuid; v_name text; v_code text;
begin
  select * into i from t_ids;
  select licensor_id, name, code into v_lic, v_name, v_code
  from core.property where id = i.coco_prop;

  if v_name is distinct from 'COCO' then
    raise exception 'A FAILED: core.property % is named %, expected COCO', i.coco_prop, v_name;
  end if;
  if v_code is distinct from 'CC' then
    raise exception 'A FAILED: COCO code is %, expected CC', v_code;
  end if;
  if v_lic is distinct from i.disney then
    raise exception
      'A FAILED: COCO is parented to %, expected DISNEY %. The owner ruling of 2026-08-06 '
      'is NOT applied on this database.', v_lic, i.disney;
  end if;
  raise notice 'A ok: COCO (CC) is parented to DISNEY (DY).';
end;
$a$;

-- ===========================================================================
-- B. The namespace trap was not tripped. Nothing Coca-Cola moved.
-- ===========================================================================
do $b$
declare i record; v_n integer; v_lic_name text;
begin
  select * into i from t_ids;

  select name into v_lic_name from core.licensor where id = i.coca_cola;
  if v_lic_name is distinct from 'COCA COLA' then
    raise exception 'B FAILED: licensor % is %, expected COCA COLA', i.coca_cola, v_lic_name;
  end if;

  select count(*) into v_n
  from core.property
  where code in ('CCC','CCZ') and licensor_id = i.coca_cola;
  if v_n <> 2 then
    raise exception
      'B FAILED: expected 2 Coca-Cola properties (CCC, CCZ) under licensor COCA COLA, found %. '
      'Something matched on the bare string CC and moved the wrong rows.', v_n;
  end if;

  select count(*) into v_n
  from core.property
  where licensor_id = i.disney and upper(name) like '%COCA%';
  if v_n <> 0 then
    raise exception
      'B FAILED: % property row(s) named like COCA COLA are parented to DISNEY. The '
      'CC property-code / CC licensor-code collision was tripped.', v_n;
  end if;
  raise notice 'B ok: COCA COLA licensor and its CCC/CCZ properties untouched.';
end;
$b$;

-- ===========================================================================
-- C. Blast radius. Measured with count(*) -- pg_stat_user_tables.n_live_tup is STALE on
--    this database and reports 0 for populated tables. Never use it here.
-- ===========================================================================
do $c$
declare i record; v_total integer; v_dy integer; v_disagree integer; v_sg integer; v_pim integer;
begin
  select * into i from t_ids;

  select count(*), count(*) filter (where a.licensor_id = i.disney)
    into v_total, v_dy
  from public.assets a where a.property_id = i.coco_prop;

  if v_total <> 15 then
    raise exception
      'C FAILED: expected 15 public.assets on property COCO, found %. Re-measure before '
      'trusting any document that quotes 15.', v_total;
  end if;
  if v_dy <> 15 then
    raise exception
      'C FAILED: only % of 15 COCO assets carry licensor_id = DISNEY; expected all 15.', v_dy;
  end if;

  select count(*) into v_disagree
  from public.assets a
  join core.property p on p.id = a.property_id
  where a.property_id = i.coco_prop
    and a.licensor_id is distinct from p.licensor_id;
  if v_disagree <> 0 then
    raise exception
      'C FAILED: % COCO asset(s) still disagree with their property''s licensor.', v_disagree;
  end if;

  select count(*) into v_sg from public.style_groups where property_id = i.coco_prop;
  select count(*) into v_pim from pim.product where property_id = i.coco_prop;
  if v_sg <> 0 or v_pim <> 0 then
    raise exception
      'C FAILED: expected 0 style_groups and 0 pim.product on COCO, found % and %. The '
      'blast radius is larger than this migration was scoped for.', v_sg, v_pim;
  end if;
  raise notice 'C ok: 15 assets, all DISNEY, all self-consistent; 0 style groups, 0 pim products.';
end;
$c$;

-- ===========================================================================
-- D. Reversibility -- the previous parent is recorded on the row itself.
-- ===========================================================================
do $d$
declare i record; v_prev text; v_warn text;
begin
  select * into i from t_ids;
  select metadata #>> '{owner_ruling,previous_licensor_id}',
         metadata #>> '{owner_ruling,durability_warning}'
    into v_prev, v_warn
  from core.property where id = i.coco_prop;

  if v_prev is distinct from i.no_license::text then
    raise exception
      'D FAILED: metadata.owner_ruling.previous_licensor_id is %, expected %. Reversal '
      'would require reading the migration file.', v_prev, i.no_license;
  end if;
  if v_warn is null or length(btrim(v_warn)) = 0 then
    raise exception
      'D FAILED: the durability warning is missing from the row metadata. A reader must '
      'be able to see that this curated parent reverts on the next PLM sync.';
  end if;
  raise notice 'D ok: previous licensor UUID and durability warning recorded on the row.';
end;
$d$;

-- ===========================================================================
-- E. BEHAVIOURAL. Every case re-executes the REAL migration text from t_mig.
--    Each is a PAIR: a triggering fixture that MUST abort with the specific guard
--    message, and a control fixture on the same path that MUST NOT abort.
--    Real savepoints; every fixture is rolled back.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- E1. The COCO / COCA COLA name guard.
--     Triggering: rename the row away from COCO -> migration must refuse.
--     Control:    leave the name as COCO, only move the parent back -> must succeed.
-- ---------------------------------------------------------------------------
savepoint e1;

do $e1$
declare i record; v_err text;
begin
  select * into i from t_ids;

  -- Put the row back under ZZ so the migration reaches the work, then break the NAME.
  update core.property set licensor_id = i.no_license, name = 'COCA COLA CLASSIC'
  where id = i.coco_prop;

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is null then
    raise exception
      'E1 FAILED (triggering): the migration COMPLETED against a row named '
      '"COCA COLA CLASSIC". The name guard did not fire, so a Coca-Cola row can be '
      're-parented under DISNEY. This is the exact licensing error the guard exists for.';
  end if;

  if position('not "COCO"' in v_err) = 0 then
    raise exception
      'E1 FAILED (triggering): the migration aborted, but NOT on the name guard. '
      'Got: %', v_err;
  end if;

  raise notice 'E1 ok (triggering): name guard fired. %', v_err;
end;
$e1$;

rollback to savepoint e1;

savepoint e1c;

do $e1c$
declare i record; v_err text; v_lic uuid;
begin
  select * into i from t_ids;

  -- CONTROL: identical path, but the name is correct. The migration must run to completion.
  update core.property set licensor_id = i.no_license where id = i.coco_prop;

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is not null then
    raise exception
      'E1 CONTROL FAILED: the migration aborted on a VALID fixture. The name guard (or '
      'another guard) is firing when it should not, which would make E1 pass for the '
      'wrong reason. Got: %', v_err;
  end if;

  select licensor_id into v_lic from core.property where id = i.coco_prop;
  if v_lic is distinct from i.disney then
    raise exception
      'E1 CONTROL FAILED: the migration reported success but COCO is parented to %, '
      'not DISNEY.', v_lic;
  end if;

  raise notice 'E1 ok (control): valid fixture re-parents cleanly to DISNEY.';
end;
$e1c$;

rollback to savepoint e1c;

-- ---------------------------------------------------------------------------
-- E2. The (licensor_id, code) unique-key guard.
--     Triggering: plant a competing (DISNEY, 'CC') property -> must refuse, and must
--                 refuse with its OWN message rather than a bare constraint violation.
--     Control:    remove the decoy -> must succeed.
-- ---------------------------------------------------------------------------
savepoint e2;

do $e2$
declare i record; v_err text;
begin
  select * into i from t_ids;

  update core.property set licensor_id = i.no_license where id = i.coco_prop;
  insert into core.property (licensor_id, name, code, status)
  values (i.disney, 'DECOY FOR E2', 'CC', 'active');

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is null then
    raise exception
      'E2 FAILED (triggering): the migration COMPLETED despite a competing (DISNEY, CC) '
      'property. It should have been impossible -- the unique key must have been violated '
      'or dropped.';
  end if;

  if position('already exists under DISNEY' in v_err) = 0 then
    raise exception
      'E2 FAILED (triggering): the migration aborted, but not on its own unique-key '
      'precondition. A bare property_licensor_id_code_key violation with no explanation '
      'is exactly what that precondition exists to prevent. Got: %', v_err;
  end if;

  raise notice 'E2 ok (triggering): unique-key precondition fired with its own message. %', v_err;
end;
$e2$;

rollback to savepoint e2;

savepoint e2c;

do $e2c$
declare i record; v_err text; v_n integer;
begin
  select * into i from t_ids;

  -- CONTROL: same path, no decoy planted.
  update core.property set licensor_id = i.no_license where id = i.coco_prop;

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is not null then
    raise exception
      'E2 CONTROL FAILED: the migration aborted with no competing property present. '
      'Got: %', v_err;
  end if;

  select count(*) into v_n from core.property where licensor_id = i.disney and code = 'CC';
  if v_n <> 1 then
    raise exception 'E2 CONTROL FAILED: expected exactly 1 (DISNEY, CC) property, found %.', v_n;
  end if;

  raise notice 'E2 ok (control): with no decoy the migration completes.';
end;
$e2c$;

rollback to savepoint e2c;

-- ---------------------------------------------------------------------------
-- E3. The unexpected-parent guard.
--     Triggering: park COCO under a THIRD licensor (COCA COLA) -> must refuse to
--                 overwrite a parent somebody else deliberately set.
--     Control:    park it under ZZ, the expected parent -> must succeed.
-- ---------------------------------------------------------------------------
savepoint e3;

do $e3$
declare i record; v_err text; v_lic uuid;
begin
  select * into i from t_ids;

  update core.property set licensor_id = i.coca_cola where id = i.coco_prop;

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is null then
    select licensor_id into v_lic from core.property where id = i.coco_prop;
    raise exception
      'E3 FAILED (triggering): the migration COMPLETED and silently overwrote an '
      'unexpected parent (COCO is now %). A third-party re-parent must stop this '
      'migration and require a human.', v_lic;
  end if;

  if position('neither DTR - NO LICENSE' in v_err) = 0 then
    raise exception
      'E3 FAILED (triggering): the migration aborted, but not on the unexpected-parent '
      'guard. Got: %', v_err;
  end if;

  raise notice 'E3 ok (triggering): unexpected-parent guard fired. %', v_err;
end;
$e3$;

rollback to savepoint e3;

savepoint e3c;

do $e3c$
declare i record; v_err text;
begin
  select * into i from t_ids;

  -- CONTROL: the EXPECTED prior parent. Proves E3 keys on "unexpected", not on "not DY".
  update core.property set licensor_id = i.no_license where id = i.coco_prop;

  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is not null then
    raise exception
      'E3 CONTROL FAILED: the migration aborted with COCO under its expected prior parent '
      'ZZ. The guard is too broad -- it would block the migration''s own happy path. '
      'Got: %', v_err;
  end if;

  raise notice 'E3 ok (control): the expected prior parent ZZ is accepted.';
end;
$e3c$;

rollback to savepoint e3c;

-- ---------------------------------------------------------------------------
-- E4. No null-permissive privilege guard in the migration.
--
--     REPLACES a vacuous test. An earlier revision queried pg_proc.prosrc for this
--     pattern. The migration is an anonymous DO block and NEVER lands in pg_proc, so that
--     query matched nothing and would have reported success even if the broken guard were
--     present. It tested nothing at all.
--
--     This version inspects the REAL migration TEXT, which is where the pattern would
--     actually live. The shape being banned --
--         if not ( ... or auth.role() = 'service_role' ) then raise ...
--     -- never fires inside a migration, because auth.role() is NULL there and
--     NULL = 'service_role' is NULL, not false. A guard that cannot fire is worse than no
--     guard, because it reads as protection.
-- ---------------------------------------------------------------------------
do $e4$
declare v_body text;
begin
  select body into v_body from t_mig;

  if position('auth.role()' in v_body) > 0 then
    raise exception
      'E4 FAILED: the migration text references auth.role(). Inside a migration auth.role() '
      'is NULL, so any comparison against it yields NULL and the guard never fires. '
      'Remove it, or replace it with a check that requires a NON-NULL role AND a positive '
      'match. Do not leave a check that reads as protection and is not.';
  end if;

  raise notice 'E4 ok: the migration text contains no auth.role() reference (checked against '
               'the real file, not pg_proc -- an anonymous DO block never appears in pg_proc).';
end;
$e4$;

-- ===========================================================================
-- F. Idempotence -- exercising the migration's OWN early-return path.
--    The row is already correct here (Section A proved it), so re-executing the real
--    migration must complete without error and must change nothing at all.
--    An earlier revision ran a simplified standalone UPDATE instead, which never reached
--    this path and therefore never tested idempotence.
-- ===========================================================================
savepoint f;

do $f$
declare
  i record; v_err text;
  v_lic_before uuid; v_lic_after uuid;
  v_upd_before timestamptz; v_upd_after timestamptz;
  v_meta_before jsonb; v_meta_after jsonb;
begin
  select * into i from t_ids;
  select licensor_id, updated_at, metadata into v_lic_before, v_upd_before, v_meta_before
  from core.property where id = i.coco_prop;

  if v_lic_before is distinct from i.disney then
    raise exception
      'F PRECONDITION FAILED: COCO is not already under DISNEY, so this is not the '
      'idempotence path. Apply the migration before running these tests.';
  end if;

  -- Re-execute the REAL migration against the already-correct row.
  v_err := pg_temp.run_migration((select body from t_mig));

  if v_err is not null then
    raise exception
      'F FAILED: re-running the migration on an already-correct row ABORTED. It must be '
      'safe to re-run. Got: %', v_err;
  end if;

  select licensor_id, updated_at, metadata into v_lic_after, v_upd_after, v_meta_after
  from core.property where id = i.coco_prop;

  if v_lic_after is distinct from v_lic_before then
    raise exception 'F FAILED: licensor_id changed on a re-run (% -> %).', v_lic_before, v_lic_after;
  end if;
  if v_upd_after is distinct from v_upd_before then
    raise exception
      'F FAILED: updated_at changed on a re-run (% -> %). The early-return path is not '
      'being taken -- the guarded UPDATE is still touching the row.', v_upd_before, v_upd_after;
  end if;
  if v_meta_after is distinct from v_meta_before then
    raise exception 'F FAILED: metadata changed on a re-run.';
  end if;

  raise notice
    'F ok: re-running the real migration on an already-correct row is a true no-op '
    '(licensor_id, updated_at and metadata all unchanged). Expect the migration''s '
    '"ALREADY APPLIED" NOTICE immediately above this line -- if it is absent, the '
    'early-return path was NOT taken and this result is not trustworthy.';
end;
$f$;

rollback to savepoint f;

-- ===========================================================================
-- G. Timezone. The ruling date must read 2026-08-06 in BOTH UTC and the server zone.
--    Skipped LOUDLY where core.taxonomy_owner_ruling has not been created --
--    20260802171000 is held from production by AGENTS.md 6.5, so this is expected there.
-- ===========================================================================
do $g$
declare i record; v_utc date; v_local date; v_n integer;
begin
  select * into i from t_ids;

  if to_regclass('core.taxonomy_owner_ruling') is null then
    raise notice
      'G SKIPPED: core.taxonomy_owner_ruling does not exist here (migration 20260802171000 '
      'is held from production by AGENTS.md 6.5). This is a SKIP, not a PASS.';
    return;
  end if;

  execute format(
    'select count(*), min((ruled_at at time zone %L)::date), min((ruled_at at time zone %L)::date)
       from core.taxonomy_owner_ruling
      where entity_table = ''property'' and entity_id = %L',
    'UTC', 'America/New_York', i.coco_prop)
  into v_n, v_utc, v_local;

  if v_n < 1 then
    raise exception 'G FAILED: no core.taxonomy_owner_ruling row recorded for COCO.';
  end if;
  if v_utc <> date '2026-08-06' then
    raise exception 'G FAILED: ruled_at reads % in UTC, expected 2026-08-06.', v_utc;
  end if;
  if v_local <> date '2026-08-06' then
    raise exception
      'G FAILED: ruled_at reads % in America/New_York, expected 2026-08-06. This is the '
      'midnight-UTC off-by-one-day trap: pin the timestamp to midday UTC.', v_local;
  end if;
  raise notice 'G ok: ruled_at reads 2026-08-06 in both UTC and America/New_York.';
end;
$g$;

-- ===========================================================================
-- H. The unique key is still in place and COCO does not collide under its new parent.
-- ===========================================================================
do $h$
declare i record; v_def text; v_n integer;
begin
  select * into i from t_ids;

  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'core.property'::regclass and conname = 'property_licensor_id_code_key';

  if v_def is null then
    raise exception
      'H FAILED: constraint property_licensor_id_code_key is gone from core.property. '
      'Property codes are only unique per licensor; without it, re-parenting is unsafe.';
  end if;

  select count(*) into v_n
  from core.property where licensor_id = i.disney and code = 'CC';
  if v_n <> 1 then
    raise exception 'H FAILED: expected exactly 1 (DISNEY, CC) property, found %.', v_n;
  end if;
  raise notice 'H ok: unique key intact; exactly one (DISNEY, CC) property. Def: %', v_def;
end;
$h$;

-- Nothing above is kept. Every fixture was rolled back to its savepoint already; this
-- discards the rest, including the temporary tables and pg_temp.run_migration.
rollback;
