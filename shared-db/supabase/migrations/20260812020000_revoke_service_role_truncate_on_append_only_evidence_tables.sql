-- =====================================================================================
-- service_role TRUNCATE removal on four evidence/decision tables: three append-only
-- (plm.coldlion_promotion_audit, plm.coldlion_promotion_quarantine,
-- dam.popsg_property_resolution) plus core.property_alias, whose TRUNCATE removal is
-- defense in depth (no append-only trigger to bypass). See WHAT DEFECT THIS CORRECTS below.
--
-- Migration: 20260812020000_revoke_service_role_truncate_on_append_only_evidence_tables.sql
-- Claim:     issue #822 (batch B3 TRUNCATE-forward fix).
--
-- THIS IS A FORWARD FIX, NOT AN EDIT. The Supabase ledger keys on the 14-digit VERSION
-- alone, so editing the creating migrations (20260729230000 / 20260731150000) would never
-- re-run them; it would only desynchronise file from ledger while changing nothing in any
-- database that has seen them. Fix forward with a new migration.
-- =====================================================================================
-- WHAT DEFECT THIS CORRECTS
-- =====================================================================================
-- Four tables created inside atomic batch B3 were over-granted `grant all` (including
-- TRUNCATE) to service_role. Three of them are APPEND-ONLY evidence / decision state,
-- enforced by BEFORE UPDATE OR DELETE FOR EACH ROW triggers:
--
--   plm.coldlion_promotion_audit       created by 20260729230000; grant all -> service_role
--   plm.coldlion_promotion_quarantine  created by 20260729230000; grant all -> service_role
--   dam.popsg_property_resolution      created by 20260731150000; grant all -> service_role
--
-- The fourth is a different kind of protected state:
--
--   core.property_alias                created by 20260731150000; grant all -> service_role
--
-- core.property_alias is CONTROLLED SHARED ALIAS TRUTH, not an append-only table. Its
-- writes are intended to go through public.promote_property_alias_batch(), and it does NOT
-- carry a general append-only BEFORE UPDATE OR DELETE trigger. It is revoked here for
-- DEFENSE IN DEPTH -- removing TRUNCATE from a role that has no legitimate use for it --
-- not because a row trigger would otherwise be bypassed.
--
-- `grant all` is the eight PostgreSQL table bits a,r,w,d,D,x,t,m. The dangerous one is
-- D = TRUNCATE: **TRUNCATE DOES NOT FIRE ROW TRIGGERS**. For the three append-only
-- tables every immutability guarantee is built on a BEFORE UPDATE OR DELETE FOR EACH ROW
-- trigger, so a service_role TRUNCATE bypasses all of them -- executed by the exact role
-- the importers and promotion runners run as. That is the same defect class 20260810180000
-- closed for the 39 plm landing tables, now applied to those three append-only tables;
-- core.property_alias is revoked alongside them so the whole B3 grant family is narrowed
-- to one posture even though it has no such trigger to bypass.
--
-- This migration removes TRUNCATE and the three DDL-adjacent bits that have no legitimate
-- use for a data role -- REFERENCES, TRIGGER, MAINTAIN -- and KEEPS the DML bits the
-- original `grant all` was there to provide: INSERT, SELECT, UPDATE, DELETE (arwd). For
-- the three append-only tables, the UPDATE/DELETE semantics continue to be enforced by the
-- existing row triggers (which DO fire for those operations); this migration removes only
-- the one bit that bypasses them and the three DDL bits no importer needs. It deliberately
-- does NOT narrow further, and it deliberately applies the SAME revoke to core.property_alias
-- too: matching the 20260810180000 standard keeps one posture for the whole B3 grant family
-- (the "TRUNCATE-bypasses-triggers" defect class for the three append-only tables, plus
-- defense in depth for core.property_alias) rather than a per-table patchwork that is
-- harder to prove and easier to get wrong. (The writes themselves happen through SECURITY
-- DEFINER functions running as their owner; the `grant all` to service_role is the
-- legitimate operational DML surface for the role, minus the bypass/DDL bits.)
-- =====================================================================================
-- CO-PRESENCE WITH BATCH B3 -- why this file is an ATOMIC_BATCHES B3 member
-- =====================================================================================
-- All four tables are created by B3 members (20260729230000 and 20260731150000), which
-- grant service_role the full eight bits at CREATE TABLE time. This version (20260812020000)
-- sorts AFTER every B3 member, so it revokes once the over-grant exists. To make it
-- impossible to promote B3 without this fix, scripts/production_migration_guard.py lists
-- 20260812020000 in the B3 ATOMIC_BATCHES member set: any allowlist that carries a B3
-- member must carry this one too (unless it is already applied on production). That rule
-- is ledger-aware and resume-safe -- the recovery allowlist of 20260812020000 ALONE is
-- legal once the rest of B3 has landed, because validate_candidates refuses to re-list
-- already-applied versions. Without this co-presence, B3 could ship leaving service_role
-- one TRUNCATE away from silently wiping protected evidence/decision state.
-- =====================================================================================
-- ORDERING / RISK
-- =====================================================================================
-- Each table is handled all-or-nothing from a catalog read: 0 of 4 tables -> skip loudly
-- (the B3 creates have not run; nothing to revoke); 4 of 4 -> revoke and assert at full
-- strength; 1-3 -> raise (a partially created family is corruption). The atomic
-- co-presence above means the production lane cannot produce the "created but unfixed"
-- state; the catalog check here is the second line of defence, not the first. SCHEMA
-- ONLY. NO DATA.
-- =====================================================================================


-- =====================================================================================
-- SECTION 1 -- revoke the TRUNCATE bypass and the DDL-adjacent bits from service_role.
-- =====================================================================================
do $$
declare
  t text;
  v_tables text[] := array[
    'plm.coldlion_promotion_audit',
    'plm.coldlion_promotion_quarantine',
    'core.property_alias',
    'dam.popsg_property_resolution'
  ];
  v_present int;
begin
  select count(*) into v_present
    from unnest(v_tables) tbl
   where to_regclass(tbl) is not null;

  if v_present = 0 then
    raise warning
      'TRUNCATE revoke SKIPPED: none of the four append-only tables exist yet. The B3 '
      'creates (20260729230000 / 20260731150000) have not run here, so there is nothing '
      'to revoke. Outside the B3 apply this is expected; the atomic co-presence rule in '
      'scripts/production_migration_guard.py otherwise ships this file with B3.';
    return;
  end if;

  if v_present <> 4 then
    raise exception
      'TRUNCATE revoke FAILED: % of 4 append-only tables exist. A partially created '
      'family is corruption, not an ordering choice. Refusing to revoke a subset.',
      v_present;
  end if;

  foreach t in array v_tables loop
    -- %s is safe here: v_tables is a hardcoded literal array, never external input.
    -- TRUNCATE is re-listed for idempotence even though it is the headline bit: revoking
    -- an absent privilege is a no-op, and this keeps the statement correct on a database
    -- where some other fix has already narrowed these grants.
    execute format(
      'revoke truncate, references, trigger, maintain on %s from service_role', t);
    -- Defensive parity with the plm landing tables (20260810180000): public and anon hold
    -- nothing on these four evidence/decision tables. These are no-ops where the creating
    -- migration already revoked them; they make the assertion below robustly true everywhere.
    -- authenticated KEEPS its explicit SELECT (admin read) -- `from public`/`from anon`
    -- never touches an explicit grant to authenticated.
    execute format('revoke all on %s from public', t);
    execute format('revoke all on %s from anon', t);
  end loop;
  raise notice 'TRUNCATE revoke: applied to all four append-only tables';
end;
$$;


-- =====================================================================================
-- SECTION 2 -- ASSERT THE OUTCOME: final ACL state and behaviour, all four tables.
--
-- "It applied successfully" proves nothing: a revoke that did nothing looks identical in
-- a migration log to one that worked. has_table_privilege('service_role', table, P)
-- reports the EFFECTIVE privilege -- whether service_role can actually perform the
-- operation -- so these checks are a behaviour test of the ACL, not merely a catalog
-- read. Mirrors 20260810180000 section D1. No auth.role() check is used: inside a
-- migration auth.role() is NULL, so any `auth.role() = 'service_role'` guard would be
-- inert decoration.
-- =====================================================================================
do $$
declare
  t text;
  p text;
  v_bad     int := 0;
  v_present int;
  v_public  int;
  v_tables text[] := array[
    'plm.coldlion_promotion_audit',
    'plm.coldlion_promotion_quarantine',
    'core.property_alias',
    'dam.popsg_property_resolution'
  ];
begin
  -- Re-confirm the family contract before asserting. 0 is legal ONLY because section 1
  -- then did nothing; it is reported loudly. Any other count is a partial family.
  select count(*) into v_present
    from unnest(v_tables) tbl
   where to_regclass(tbl) is not null;
  if v_present = 0 then
    raise warning
      'ACL assert SKIPPED: none of the four tables exist, so there is no ACL to assert. '
      'This is the prevention path (section 1 skipped too).';
    return;
  end if;
  if v_present <> 4 then
    raise exception 'ACL assert FAILED: % of 4 tables exist -- partial family', v_present;
  end if;

  foreach t in array v_tables loop
    -- service_role must NO LONGER hold the TRUNCATE bypass or the DDL-adjacent bits.
    foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL: service_role still holds % on %', p, t;
      end if;
    end loop;

    -- service_role must STILL hold the DML bits -- proves this did not over-revoke and
    -- that the write paths can still write/read (the append-only workflows on the three
    -- trigger-protected tables; public.promote_property_alias_batch() on core.property_alias).
    foreach p in array array['INSERT','SELECT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', t, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL: service_role LOST % on % -- over-revoked', p, t;
      end if;
    end loop;
  end loop;

  -- public/anon hold nothing on these evidence/decision tables (defensive parity).
  select count(*) into v_public
    from information_schema.role_table_grants g
   where (g.table_schema || '.' || g.table_name) = any(v_tables)
     and lower(g.grantee) in ('anon', 'public');
  if v_public <> 0 then
    v_bad := v_bad + 1;
    raise warning 'FAIL: anon/PUBLIC hold % grant(s) on the four tables', v_public;
  end if;

  if v_bad <> 0 then
    raise exception
      'ACL assert FAILED with % privilege violation(s) -- see the warnings above', v_bad;
  end if;
  raise notice
    'ACL assert OK: service_role holds arwd (no Dxtm) on all four append-only tables; '
    'anon/PUBLIC hold nothing';
end;
$$;
