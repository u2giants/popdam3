-- =============================================================================
-- PRODUCTION LANE CANARY  (issue #660 / #617)
--
-- WHAT THIS IS FOR, AND WHY IT IS DELIBERATELY BORING.
--
-- The production apply lane in `.github/workflows/shared-supabase-migrations.yml`
-- has never written to production. Not once. It was built, corrected twice, and
-- rehearsed, but the `db push` at the end of it has never executed against
-- qsllyeztdwjgirsysgai.
--
-- Four licensor features (Disney, Paramount, NBCU, Warner) are queued behind it.
-- Sending any of them through FIRST is a bad trade: if the run fails, you cannot
-- tell whether the LANE is broken or the MIGRATION is broken, and you find out
-- while a real feature is half-applied to a shared production database with no
-- undo. That confusion is not hypothetical -- this lane has already produced two
-- failures that looked like migration faults and were neither (a `$$`-inside-a-
-- comment lexer bug, and a prose-inside-a-string-literal lexer bug; see
-- `strip_sql` in scripts/production_migration_guard.py).
--
-- So this migration is customer #1. It exists to answer exactly one question --
-- "does the machinery work end to end?" -- and to answer it with a change whose
-- failure costs nothing and whose success is directly observable.
--
-- WHY A TABLE AND NOT A COMMENT. A comment leaves no queryable evidence, so a
-- successful run would be indistinguishable from a run that recorded a ledger
-- row without executing the SQL -- which is precisely the doubt issue #611 is
-- about. One row in one table is checkable:
--
--     select * from plm.production_lane_canary;   -- expect exactly 1 row
--
-- SAFETY PROPERTIES, each one intentional:
--   * Purely ADDITIVE. It creates one new table in an existing schema and
--     touches nothing that any app reads. AGENTS.md section 4 rule 3.
--   * No app reads it, no app writes it, nothing depends on it. Dropping it
--     later is a no-op for every consumer.
--   * RLS is ENABLED WITH NO POLICIES, **and the schema's default grant is
--     REVOKED**. Read the next paragraph before copying this file.
--   * `if not exists` so a re-run cannot fail.
--
-- ***** RLS ALONE IS NOT ENOUGH IN THIS SCHEMA. READ THIS. *****
--
-- An earlier draft of this header asserted that this table granted nothing to
-- any role, and relied on RLS-with-no-policies alone. That claim was FALSE, and
-- the reason is worth knowing because it will catch the next person too.
--
-- `20260710135975_reconcile_service_role_grants.sql` line 14 runs
--
--     alter default privileges in schema plm grant all on tables to service_role;
--
-- A default-privilege rule fires at CREATE TABLE, silently, with nothing in the
-- creating migration to hint at it. So EVERY new `plm.*` table is born with ALL
-- privileges already held by `service_role` -- and `service_role` BYPASSES RLS
-- in Supabase entirely. "RLS enabled, no policies" therefore locks out `anon`
-- and `authenticated` but does nothing whatsoever about `service_role`.
--
-- That is the exact defect `20260810080000`, `20260810090000` and the Warner
-- revoke work all exist to clean up, and it reappeared here in the one file
-- whose entire purpose is to be the safest possible change. The blast radius is
-- nil -- an empty table nothing reads -- but a false comment is what the next
-- author copies, which is why it is corrected rather than deleted.
--
-- The revoke below uses a bare `revoke all` rather than enumerating privilege
-- bits. Hand-enumeration misses `MAINTAIN` on PostgreSQL 17.6 and would need
-- editing on every future privilege addition; `all` cannot go stale.
--
-- DO NOT extend this table, do not add columns to it later, and do not build
-- anything on it. If you need a second canary, write a second migration.
-- =============================================================================

create table if not exists plm.production_lane_canary (
  id            bigint generated always as identity primary key,
  -- The lane that wrote the row. Recorded so a future reader can tell a real
  -- production apply from a hand-run statement.
  applied_by    text        not null default 'shared-supabase-migrations.yml production-apply',
  applied_at    timestamptz not null default now(),
  note          text        not null
);

comment on table plm.production_lane_canary is
  'No-op canary for the bounded production migration apply lane (issue #660). '
  'Written by migration 20260810140000 as the first change ever pushed through '
  'the production-apply job, so that a lane failure could never be confused '
  'with a licensor feature failure. No application reads or writes this table. '
  'Do not extend it and do not build on it.';

alter table plm.production_lane_canary enable row level security;

-- No policies, on purpose. See the header.

-- Undo the schema default grant that CREATE TABLE just applied, plus the three
-- browser-facing grantees for symmetry. `public` first: `anon` and
-- `authenticated` inherit from it, so revoking them without it leaves the
-- privilege reachable.
revoke all on plm.production_lane_canary from public;
revoke all on plm.production_lane_canary from anon;
revoke all on plm.production_lane_canary from authenticated;
revoke all on plm.production_lane_canary from service_role;

-- Assert the RESULT, not that the statements above ran. A revoke that silently
-- did nothing looks identical in a migration log to one that worked, and this
-- migration's whole job is to be trustworthy evidence.
--
-- Two checks on purpose. `aclexplode` is version-proof and needs no privilege
-- names, so it catches MAINTAIN on PG 17.6 and anything Postgres adds later.
-- `has_table_privilege` then names the seven universal bits explicitly, so a
-- failure says WHICH privilege survived instead of just "something did".
do $$
declare
  v_leftover text;
  v_priv     text;
  v_role     text;
begin
  select string_agg(distinct a.grantee::regrole::text || ':' || a.privilege_type, ', ')
    into v_leftover
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
   where c.oid = 'plm.production_lane_canary'::regclass
     and a.grantee::regrole::text in
         ('public', 'anon', 'authenticated', 'service_role');
  if v_leftover is not null then
    raise exception
      'production_lane_canary still grants % -- the revoke did not take. The '
      'plm schema default privileges (20260710135975) grant ALL to service_role '
      'at CREATE TABLE, and service_role bypasses RLS.', v_leftover;
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['select', 'insert', 'update', 'delete',
                                  'truncate', 'references', 'trigger'] loop
      if has_table_privilege(v_role, 'plm.production_lane_canary', v_priv) then
        raise exception 'production_lane_canary: % still holds %',
          v_role, v_priv;
      end if;
    end loop;
  end loop;
end $$;

insert into plm.production_lane_canary (note)
values (
  'Canary for the bounded production apply lane. If this row exists on '
  'qsllyeztdwjgirsysgai, the lane executed migration SQL against production '
  'and recorded its ledger row -- the machinery works. Issue #617/#660.'
);
