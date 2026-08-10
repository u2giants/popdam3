-- =====================================================================================
-- plm privilege correction -- the PostgreSQL 17 MAINTAIN gap, and the schema-wide
-- default-privilege hole that keeps re-creating it.
--
-- Migration: 20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql
-- Issues:    #664 (39 landing tables keep privileges the revokes missed)
--            #649 (plm schema default privileges hand service_role ALL on every new table)
-- Claim:     #716. Version allocated by the orchestrator -- do not re-derive it.
--
-- THIS IS A FORWARD FIX, NOT AN EDIT. The Supabase ledger keys on the 14-digit VERSION
-- alone, so editing an earlier migration would never re-run it; it would only
-- desynchronise the file from the ledger while changing nothing in any database.
--
-- ------------------------------------------------------------------------------------
-- WHAT DEFECT THIS CORRECTS
-- ------------------------------------------------------------------------------------
-- PostgreSQL 17 added a new table privilege, MAINTAIN (aclitem bit `m`), covering
-- VACUUM, ANALYZE, CLUSTER, REFRESH MATERIALIZED VIEW, REINDEX and LOCK TABLE. This
-- database runs PostgreSQL 17.6, so `m` is real here. Two of the three landing-schema
-- revoke migrations were written against the pre-17 privilege list and are therefore
-- INCOMPLETE:
--
--   * 20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql
--       revokes only  truncate, trigger        on the 23 plm.pmt_*  tables
--       still leaves  references, maintain
--
--   * 20260810080000_nbcu_revoke_default_granted_write_privileges.sql
--       revokes only  update, delete, truncate on the 16 plm.nbcu_* tables
--       still leaves  references, trigger, maintain
--
--   * 20260810110000_warner_grants_rls_and_dam_order_list_invoker.sql is the CORRECT
--       reference pattern: it revokes update, delete, truncate, references, trigger,
--       maintain. This migration brings pmt_* and nbcu_* up to that standard.
--
-- 23 + 16 = the 39 tables of #664.
--
-- ------------------------------------------------------------------------------------
-- THE ROOT CAUSE (#649) -- and why per-table revokes will never end
-- ------------------------------------------------------------------------------------
-- 20260710135975_reconcile_service_role_grants.sql line 14 runs
--
--     alter default privileges in schema plm grant all on tables to service_role;
--
-- Read from the production catalog on 2026-08-10 (project qsllyeztdwjgirsysgai):
--
--     pg_default_acl -> nspname=plm, defaclrole=postgres, defaclobjtype='r',
--                       defaclacl={service_role=arwdDxtm/postgres}
--
-- a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN.
-- All eight, applied AUTOMATICALLY at CREATE TABLE time, before any GRANT in the
-- creating migration runs -- which is why those GRANT lines are silent no-ops and why
-- every new plm table is born over-privileged. Three separate workstreams hit this
-- independently and patched only their own tables, in three different postures. Nobody
-- changed the default, so the hole survived all three and will re-open on the next
-- plm table anyone creates.
--
-- The dangerous bit is TRUNCATE: **TRUNCATE DOES NOT FIRE ROW TRIGGERS**. Every
-- immutability guarantee in these landing schemas is built on BEFORE UPDATE OR DELETE
-- FOR EACH ROW triggers, so TRUNCATE bypasses all of them -- executed by the exact role
-- the importers run as. REFERENCES, TRIGGER and MAINTAIN are DDL-adjacent and have no
-- legitimate use for an importer role.
--
-- SECTION C therefore narrows the schema default itself to
--     insert, select, update, delete
-- and drops truncate, references, trigger, maintain. It is deliberately NOT narrowed
-- further: ordinary plm tables legitimately need service_role DML, and a default that
-- withheld it would break the next table's loader silently, trading one silent failure
-- for another.
--
-- ------------------------------------------------------------------------------------
-- RISK: NONE OF THESE OBJECTS EXIST ON PRODUCTION YET
-- ------------------------------------------------------------------------------------
-- Verified 2026-08-10 against production qsllyeztdwjgirsysgai: pg_class holds ZERO
-- plm.pmt_*, ZERO plm.nbcu_* and ZERO plm.wb_* tables. All of those migrations are
-- still unapplied. So this correction lands BEFORE the unwanted grant ever exists in
-- production -- provided it merges before batch B9. **THIS MUST MERGE BEFORE BATCH B9.**
--
-- THAT SENTENCE IS NOT LEFT AS A COMMENT TO BE OBEYED BY GOODWILL. A header comment
-- enforces nothing, and the concrete failure it invites is precise: B9 is dispatched
-- with allowlist 020000,070000,080000,090000 and NOT 180000, every gate passes, the 39
-- tables are created as service_role=arwdDxtm, the schema default stays open, and
-- #664/#649 go live. The same change that adds this file therefore adds co-presence
-- rules to scripts/production_migration_guard.py: 20260810020000 and 20260810070000
-- may not be promoted without 20260810180000. The lane refuses the batch instead.
-- Those rules are ONE-DIRECTIONAL, like every other rule in that file: this migration
-- ALONE remains a legal allowlist, so a run that dies between the create and the fix
-- can still be recovered without editing a safety guard under pressure.
--
-- ORDERING WITHIN THE APPLY: this version (20260810180000) sorts after 20260810080000,
-- 20260810090000 and 20260810110000, so the tables and their first-pass revokes exist
-- before sections A and B run. Because 180000-alone is legal, sections A, B and D1 are
-- written all-or-nothing PER FAMILY from a catalog read rather than assuming the tables
-- are there -- see the block comment on section A. Every 39-table reference in this file
-- goes through `execute format(...)`, which preflight_batch explicitly does not model
-- (production_migration_guard.py:358-360), so a missing create would otherwise have
-- surfaced as a mid-batch abort on production AFTER earlier files had committed. The
-- refusal belongs before the write, and the co-presence rules put it there.
--
-- SCHEMA ONLY. NO DATA. No licensor source row appears in this repository.
-- =====================================================================================


-- =====================================================================================
-- SECTION A -- plm.pmt_* (23 tables, issue #664).
--
-- Completes 20260810090000. service_role KEEPS insert, select, update, delete for the
-- reasons documented at 20260810090000:53-59 (the loader writes; validation and the api
-- views read; finalize/fail and reconciliation update; an in-flight ABANDONED or FAILED
-- capture must remain cleanable). It LOSES truncate, references, trigger, maintain.
-- truncate and trigger are re-listed for idempotence -- revoking an absent privilege is
-- a no-op, and it makes this statement correct on a database where 20260810090000 has
-- not run.
--
-- authenticated keeps SELECT (granted by 20260810020000:1147). public and anon get
-- nothing, re-asserted here for the same idempotence reason.
-- =====================================================================================
-- ------------------------------------------------------------------------------------
-- ALL-OR-NOTHING PER FAMILY. Read this before changing the shape below.
--
-- A `revoke ... on plm.pmt_capture` against a database where 20260810020000 has not run
-- raises 42P01 and aborts the batch MID-APPLY, after earlier files in the same batch
-- have already committed. That is a real, reachable state: this migration's version
-- sorts last, so an allowlist may legally contain it without the creates (the recovery
-- direction the production guard's co-presence rules deliberately keep open).
--
-- So each family is handled as a unit, from a catalog read:
--   * ALL present  -> revoke and assert, at FULL strength. Nothing is softened.
--   * ALL absent   -> skip, loudly. There is nothing to revoke, and section C has
--                     already ensured any table created later is born clean. This is
--                     the BETTER ordering, not a degraded one.
--   * PARTIAL      -> raise. A half-created family is corruption and must stop the run.
--
-- The co-presence rules added to scripts/production_migration_guard.py in this same
-- change mean the production lane can never promote 20260810020000 or 20260810070000
-- without this file, so the "created but unfixed" state cannot be produced by the lane
-- at all. This block is the second line of defence, not the first.
-- ------------------------------------------------------------------------------------
do $$
declare
  t text;
  v_tables text[] := array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override'
  ];
  v_present int;
begin
  select count(*) into v_present
    from unnest(v_tables) k
   where to_regclass(format('plm.%I', k)) is not null;

  if v_present = 0 then
    raise warning
      'SECTION A SKIPPED: none of the 23 plm.pmt_* tables exist. 20260810020000 has not '
      'been applied here. Nothing to revoke; section C has narrowed the schema default '
      'so they will be created clean. THIS IS EXPECTED when this migration runs ahead '
      'of the Paramount create, and is the outcome issues #664/#649 want.';
    return;
  end if;

  if v_present <> array_length(v_tables, 1) then
    raise exception
      'SECTION A FAILED: % of 23 plm.pmt_* tables exist. A partially created family is '
      'corruption, not an ordering choice. Refusing to revoke a subset.', v_present;
  end if;

  foreach t in array v_tables loop
    execute format(
      'revoke truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
  end loop;
  raise notice 'SECTION A: revoked on all 23 plm.pmt_* tables';
end;
$$;


-- =====================================================================================
-- SECTION B -- plm.nbcu_* (16 tables, issue #664).
--
-- Completes 20260810080000. That migration revoked update, delete, truncate and (on
-- nbcu_capture only) insert. It left references, trigger and maintain. service_role
-- KEEPS select on all 16 and insert on the 15 non-capture tables, exactly as
-- 20260810070000:1148-1150 grants them; nbcu_capture rows are minted only by the
-- security-definer plm.begin_nbcu_capture / plm.finalize_nbcu_capture.
--
-- public and anon are revoked for parity with the Paramount and Warner tables.
-- 20260810070000 grants nothing on these tables to authenticated, and revoking from
-- public cannot remove an explicit grant that does not exist.
-- =====================================================================================
-- Same all-or-nothing-per-family contract as section A. See the block comment there.
do $$
declare
  t text;
  v_tables text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'
  ];
  v_present int;
begin
  select count(*) into v_present
    from unnest(v_tables) k
   where to_regclass(format('plm.%I', k)) is not null;

  if v_present = 0 then
    raise warning
      'SECTION B SKIPPED: none of the 16 plm.nbcu_* tables exist. 20260810070000 has not '
      'been applied here. Nothing to revoke; section C has narrowed the schema default '
      'so they will be created clean.';
    return;
  end if;

  if v_present <> array_length(v_tables, 1) then
    raise exception
      'SECTION B FAILED: % of 16 plm.nbcu_* tables exist. A partially created family is '
      'corruption, not an ordering choice. Refusing to revoke a subset.', v_present;
  end if;

  foreach t in array v_tables loop
    execute format(
      'revoke update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
  end loop;
  raise notice 'SECTION B: revoked on all 16 plm.nbcu_* tables';
end;
$$;


-- =====================================================================================
-- SECTION C -- the root cause (issue #649). Narrow the plm schema default privilege.
--
-- `for role postgres` is stated EXPLICITLY rather than relying on current_user. A
-- default-privilege rule is keyed on (defaclrole, defaclnamespace, defaclobjtype); an
-- ALTER DEFAULT PRIVILEGES that omits `for role` silently targets the executing role's
-- own rule, so if this ever ran as anything other than postgres it would create a
-- second, empty rule and leave `service_role=arwdDxtm/postgres` untouched -- succeeding
-- loudly and fixing nothing. The catalog read above proves postgres is the owning role.
--
-- After this runs, a newly created plm table hands service_role a, r, w, d only.
-- Existing tables are UNAFFECTED by a default-privilege change -- which is why sections
-- A and B above exist, and why this section carries no risk of altering the behaviour
-- of anything already deployed.
-- =====================================================================================
alter default privileges for role postgres in schema plm
  revoke truncate, references, trigger, maintain on tables from service_role;


-- =====================================================================================
-- SECTION D -- assert the OUTCOME, in the migration.
--
-- "It applied successfully" proves nothing: a revoke that did nothing looks identical
-- in a migration log to one that worked. These blocks read the catalogs and raise, so
-- this file cannot fail the same silent way as the ones it corrects.
--
-- No authority / role check is used anywhere in this migration. Inside a migration
-- auth.role() is NULL, and the guard shape
--     if not ( ... or auth.role() = 'service_role' ) then raise
-- never fires when the role is NULL, so such a guard would be decoration. The checks
-- below are pure catalog assertions with no role dependency at all.
-- =====================================================================================

-- D1. The 39 tables: none of the four unwanted privileges may survive, and the
--     privileges each schema legitimately keeps must still be there.
do $$
declare
  t     text;
  p     text;
  v_bad int := 0;
  v_n   int;
  v_n_pmt  int;
  v_n_nbcu int;
  v_pmt  text[] := array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override'];
  v_nbcu text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'];
begin
  -- Family contract, identical to sections A and B: 39, or 23, or 16, or 0. Any other
  -- count is a partially created family and must stop the run. 0 is legal ONLY because
  -- sections A and B then did nothing; it is reported loudly and section D2 -- the
  -- root-cause assertion that matters most -- still runs unconditionally below.
  -- Counted PER FAMILY, never from a combined total: 16 could be 16-of-23 Paramount
  -- tables as easily as all 16 NBCU ones, and a combined count cannot tell them apart.
  select count(*) into v_n_pmt
    from unnest(v_pmt) k where to_regclass(format('plm.%I', k)) is not null;
  select count(*) into v_n_nbcu
    from unnest(v_nbcu) k where to_regclass(format('plm.%I', k)) is not null;

  if v_n_pmt not in (0, 23) then
    raise exception 'D1 FAILED: % of 23 plm.pmt_* tables exist -- partial family', v_n_pmt;
  end if;
  if v_n_nbcu not in (0, 16) then
    raise exception 'D1 FAILED: % of 16 plm.nbcu_* tables exist -- partial family', v_n_nbcu;
  end if;

  if v_n_pmt = 0 and v_n_nbcu = 0 then
    raise warning
      'D1 SKIPPED: no plm landing tables exist yet, so there is no table state to '
      'assert. This is the prevention path -- section D2 below is the assertion that '
      'proves #649 is closed, and it is NOT skipped.';
    return;
  end if;

  -- Assert only over families that actually exist -- at full strength, no softening.
  if v_n_pmt = 0 then
    v_pmt := array[]::text[];
  end if;
  if v_n_nbcu = 0 then
    v_nbcu := array[]::text[];
  end if;
  raise notice 'D1: asserting over % pmt and % nbcu table(s)', v_n_pmt, v_n_nbcu;

  foreach t in array (v_pmt || v_nbcu) loop
    foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role still holds % on plm.%', p, t;
      end if;
    end loop;

    if not has_table_privilege('service_role', format('plm.%I', t)::regclass, 'SELECT') then
      v_bad := v_bad + 1;
      raise warning 'FAIL service_role LOST SELECT on plm.% -- over-revoked', t;
    end if;
  end loop;

  -- nbcu additionally must not hold UPDATE/DELETE (20260810080000's posture).
  foreach t in array v_nbcu loop
    foreach p in array array['UPDATE','DELETE'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role still holds % on plm.%', p, t;
      end if;
    end loop;
  end loop;

  -- pmt must KEEP insert/update/delete -- proving this migration did not over-revoke.
  foreach t in array v_pmt loop
    foreach p in array array['INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role LOST % on plm.% -- over-revoked', p, t;
      end if;
    end loop;
  end loop;

  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name = any(v_pmt || v_nbcu)
     and grantee in ('anon', 'PUBLIC');
  if v_n <> 0 then
    v_bad := v_bad + 1;
    raise warning 'FAIL anon/PUBLIC hold % grant(s) on the plm landing tables', v_n;
  end if;

  if v_bad <> 0 then
    raise exception 'D1 FAILED with % privilege violation(s) -- see the warnings above', v_bad;
  end if;
end;
$$;

-- D2. The default privilege itself. Asserted from pg_default_acl by aclitem bits, so it
--     cannot go stale the way a hand-written privilege name list does.
do $$
declare
  v_acl text;
begin
  select d.defaclacl::text into v_acl
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'plm'
     and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole;

  if v_acl is null then
    raise exception
      'D2 FAILED: no pg_default_acl row for (postgres, plm, tables). Expected the rule '
      'created by 20260710135975 line 14, narrowed by section C.';
  end if;

  -- D=TRUNCATE, x=REFERENCES, t=TRIGGER, m=MAINTAIN must all be gone for service_role.
  if v_acl ~ 'service_role=[a-zA-Z]*[Dxtm]' then
    raise exception
      'D2 FAILED: plm default privileges still hand service_role a DDL/TRUNCATE bit: %. '
      'Section C did not take -- most likely it targeted the wrong defaclrole.', v_acl;
  end if;

  -- and a,r,w,d must remain, or the next plm table is born unusable by its loader.
  if v_acl !~ 'service_role=arwd' then
    raise exception
      'D2 FAILED: plm default privileges no longer grant service_role arwd: % '
      '-- section C over-revoked.', v_acl;
  end if;

  raise notice 'D2 OK: plm default privileges for tables are now %', v_acl;
end;
$$;
