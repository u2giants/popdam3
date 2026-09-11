-- =====================================================================================
-- plm legacy privilege sweep -- revoke MAINTAIN, REFERENCES, TRIGGER and TRUNCATE from
-- service_role on the 37 pre-existing plm tables that 20260810180000 did not retro-fix.
--
-- Migration: 20260905042713_plm_legacy_service_role_privilege_revoke.sql
-- Issues:    #718 (32 -> 37 pre-existing plm tables still carry the unintended bits)
--            #649 (root cause: the plm schema default privilege hole -- already closed)
-- Claim:     #2379. Version allocated by the lane manager -- do not re-derive it.
-- derived-from: none
--
-- ------------------------------------------------------------------------------------
-- WHAT THIS CORRECTS
-- ------------------------------------------------------------------------------------
-- 20260710135975_reconcile_service_role_grants.sql ran
--     alter default privileges in schema plm grant all on tables to service_role;
-- so every plm table created while that rule stood was born holding all eight bits
-- (a=INSERT r=SELECT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN).
--
-- 20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql narrowed the
-- schema default to a,r,w,d and retro-fixed the 39 plm.pmt_* / plm.nbcu_* landing
-- tables of #664. A default-privilege change never touches tables that already exist,
-- so the tables created BEFORE it kept the four unwanted bits. This migration is that
-- retro-fix, for the remaining set.
--
-- ------------------------------------------------------------------------------------
-- WHY THE SET IS CLOSED AND DERIVABLE
-- ------------------------------------------------------------------------------------
-- The population is bounded above by the default-privilege fix: every plm table created
-- after 20260810180000 is born clean, and the live catalog confirms it -- the affected
-- tables are exactly the low-OID ones, and the plm tables created since the fix hold
-- none of the four bits. The set therefore cannot grow while the plm default stays
-- narrowed, which section C re-asserts.
--
-- Reproduce the population, read-only, on any target:
--
--     select c.relname
--       from pg_class c
--      where c.relnamespace = 'plm'::regnamespace and c.relkind = 'r'
--        and (has_table_privilege('service_role', c.oid, 'TRUNCATE')
--          or has_table_privilege('service_role', c.oid, 'MAINTAIN')
--          or has_table_privilege('service_role', c.oid, 'REFERENCES')
--          or has_table_privilege('service_role', c.oid, 'TRIGGER'))
--      order by 1;
--
-- CENSUS PROVENANCE (AGENTS.md 4.2 target proof, 2026-09-05)
-- The census below was re-run read-only against the PRODUCTION project ref
-- qsllyeztdwjgirsysgai (the only ref the read-only Supabase MCP server is pinned to;
-- supabase_migrations.schema_migrations there holds 595 rows, max version 20260905024139).
-- It returned exactly the 37 names listed in this file and no others.
--
-- Governed review round 3 (2026-09-05) raised plm.coldlion_promotion_audit and
-- plm.coldlion_promotion_quarantine, created with `grant all` by 20260729230000. They are
-- already cleaned by 20260812020000 (revoke of truncate on the append-only evidence tables),
-- which sorts AFTER 20260729230000, so no linear apply can leave them dirty. The production
-- census confirms neither table holds the four bits.
--
-- Governed review round 2 (2026-09-05) raised plm.opa_property_character as a possible
-- 38th member, on the reasoning that 20260807170000 created it while the schema default
-- was still GRANT ALL. The live catalog read above refutes that: on the shared database
-- the query returns exactly the 37 names listed below, and
-- has_table_privilege('service_role', 'plm.opa_property_character', 'TRUNCATE') is false.
-- That table was granted only select/insert/update/delete at creation and never held the
-- four bits, so it is correctly outside this population.
--
-- ------------------------------------------------------------------------------------
-- WHY IT IS SAFE -- THE OWNER DECISION BEHIND IT
-- ------------------------------------------------------------------------------------
-- These tables DO exist on production, so this is a live privilege change on a shared
-- production database, not a pre-emptive correction. The owner resolved item 2 of #718
-- from a repository-wide loader audit: no application or loader code issues TRUNCATE
-- against any of the 37 -- the only matches are isolated database tests. MAINTAIN,
-- REFERENCES and TRIGGER are DDL-adjacent and have no legitimate use for an importer
-- role. TRUNCATE is the dangerous one: it does not fire row triggers, so it bypasses
-- every trigger-based immutability guarantee in this schema.
--
-- service_role KEEPS insert, select, update and delete on all 37 -- these are ordinary
-- PLM application tables whose loaders need DML. authenticated KEEPS its SELECT grant.
-- Section D asserts BOTH directions, so an over-revoke fails the migration rather than
-- silently breaking a loader later.
--
-- SCHEMA ONLY. NO DATA. No licensor source row appears in this repository.
-- =====================================================================================


-- =====================================================================================
-- SECTION A -- vacuous-pass guard. Refuse to pass by doing nothing.
--
-- A revoke over an empty or shrunken table set applies cleanly and proves nothing. This
-- block therefore fails the migration if the 37 named tables are not all present. There
-- is no "some are missing, carry on" branch: every one of the 37 is created by a
-- migration in this repository, so on any database that has this file's predecessors
-- all 37 exist. A short count means the target is not the database this change was
-- written for, and the run must stop before it writes.
-- =====================================================================================
do $$
declare
  v_tables text[] := array[
    'item','item_detail','item_attachment','art_piece','production_order',
    'production_order_line','licensing_status','licensing_feedback','rfq_group',
    'rfq_item','rfq_vendor','reference_value','customer_import','licensor_import',
    'property_import','art_piece_item','erp_customer','erp_vendor','merch_group_header',
    'item_import_staging','item_import','item_import_unresolved',
    'item_taxonomy_disagreement','vendor_exclusion','vendor_quarantine','erp_licensor',
    'erp_property','taxonomy_resolution_review','taxonomy_parallel_observation',
    'taxonomy_sync_alert','taxonomy_circuit_breaker','taxonomy_circuit_breaker_event',
    'taxonomy_baseline_pin','taxonomy_baseline_activation','deployment_environment',
    'production_order_source_ref','production_order_line_source_ref'
  ];
  v_present int;
  v_missing text;
begin
  if array_length(v_tables, 1) <> 37 then
    raise exception
      'SECTION A FAILED: the table list holds % entries, expected 37. The population of '
      'issue #718 is a closed set and must not be edited without re-reading the catalog.',
      array_length(v_tables, 1);
  end if;

  select count(*) into v_present
    from unnest(v_tables) k
   where to_regclass(format('plm.%I', k)) is not null;

  if v_present <> 37 then
    select string_agg(k, ', ' order by k) into v_missing
      from unnest(v_tables) k
     where to_regclass(format('plm.%I', k)) is null;
    raise exception
      'SECTION A FAILED: only % of the 37 plm tables of issue #718 exist. Missing: %. '
      'Refusing to revoke a subset -- a partial sweep reports success while leaving the '
      'unintended privileges in place.', v_present, v_missing;
  end if;

  raise notice 'SECTION A OK: all 37 plm tables present; proceeding with the revokes.';
end;
$$;


-- =====================================================================================
-- SECTION B -- the revokes.
--
-- Written as 37 explicit statements rather than a dynamic loop so the change is
-- reviewable and so the promotion preflight can model the objects it touches. Revoking
-- a privilege that is already absent is a no-op, which makes this section idempotent
-- and correct on a database where some of the bits were already cleared.
-- =====================================================================================
revoke truncate, references, trigger, maintain on table plm.item from service_role;
revoke truncate, references, trigger, maintain on table plm.item_detail from service_role;
revoke truncate, references, trigger, maintain on table plm.item_attachment from service_role;
revoke truncate, references, trigger, maintain on table plm.art_piece from service_role;
revoke truncate, references, trigger, maintain on table plm.production_order from service_role;
revoke truncate, references, trigger, maintain on table plm.production_order_line from service_role;
revoke truncate, references, trigger, maintain on table plm.licensing_status from service_role;
revoke truncate, references, trigger, maintain on table plm.licensing_feedback from service_role;
revoke truncate, references, trigger, maintain on table plm.rfq_group from service_role;
revoke truncate, references, trigger, maintain on table plm.rfq_item from service_role;
revoke truncate, references, trigger, maintain on table plm.rfq_vendor from service_role;
revoke truncate, references, trigger, maintain on table plm.reference_value from service_role;
revoke truncate, references, trigger, maintain on table plm.customer_import from service_role;
revoke truncate, references, trigger, maintain on table plm.licensor_import from service_role;
revoke truncate, references, trigger, maintain on table plm.property_import from service_role;
revoke truncate, references, trigger, maintain on table plm.art_piece_item from service_role;
revoke truncate, references, trigger, maintain on table plm.erp_customer from service_role;
revoke truncate, references, trigger, maintain on table plm.erp_vendor from service_role;
revoke truncate, references, trigger, maintain on table plm.merch_group_header from service_role;
revoke truncate, references, trigger, maintain on table plm.item_import_staging from service_role;
revoke truncate, references, trigger, maintain on table plm.item_import from service_role;
revoke truncate, references, trigger, maintain on table plm.item_import_unresolved from service_role;
revoke truncate, references, trigger, maintain on table plm.item_taxonomy_disagreement from service_role;
revoke truncate, references, trigger, maintain on table plm.vendor_exclusion from service_role;
revoke truncate, references, trigger, maintain on table plm.vendor_quarantine from service_role;
revoke truncate, references, trigger, maintain on table plm.erp_licensor from service_role;
revoke truncate, references, trigger, maintain on table plm.erp_property from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_resolution_review from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_parallel_observation from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_sync_alert from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_circuit_breaker from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_circuit_breaker_event from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_baseline_pin from service_role;
revoke truncate, references, trigger, maintain on table plm.taxonomy_baseline_activation from service_role;
revoke truncate, references, trigger, maintain on table plm.deployment_environment from service_role;
revoke truncate, references, trigger, maintain on table plm.production_order_source_ref from service_role;
revoke truncate, references, trigger, maintain on table plm.production_order_line_source_ref from service_role;


-- =====================================================================================
-- SECTION C -- re-assert the root-cause fix (#649) is still in place.
--
-- If the plm schema default privilege were ever widened again, this sweep would be
-- undone by the next CREATE TABLE. Asserting it here means this migration cannot report
-- success on a database where the hole is open again.
-- =====================================================================================
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
      'SECTION C FAILED: no pg_default_acl row for (postgres, plm, tables). Expected the '
      'rule created by 20260710135975 and narrowed by 20260810180000.';
  end if;

  if v_acl ~ 'service_role=[a-zA-Z]*[Dxtm]' then
    raise exception
      'SECTION C FAILED: plm default privileges still hand service_role a DDL/TRUNCATE '
      'bit: %. The #649 fix has been undone; this sweep would be re-broken by the next '
      'plm table.', v_acl;
  end if;

  if v_acl !~ 'service_role=arwd' then
    raise exception
      'SECTION C FAILED: plm default privileges no longer grant service_role arwd: %. '
      'New plm tables would be born unusable by their loaders.', v_acl;
  end if;

  raise notice 'SECTION C OK: plm default privileges for tables are %', v_acl;
end;
$$;


-- =====================================================================================
-- SECTION D -- assert the OUTCOME, in the migration.
--
-- "It applied successfully" proves nothing: a revoke that did nothing is indistinguish-
-- able in a migration log from one that worked. This block reads the catalog and fails
-- in BOTH directions -- unwanted bits surviving, and wanted bits over-revoked.
-- =====================================================================================
do $$
declare
  t     text;
  p     text;
  v_bad int := 0;
  v_tables text[] := array[
    'item','item_detail','item_attachment','art_piece','production_order',
    'production_order_line','licensing_status','licensing_feedback','rfq_group',
    'rfq_item','rfq_vendor','reference_value','customer_import','licensor_import',
    'property_import','art_piece_item','erp_customer','erp_vendor','merch_group_header',
    'item_import_staging','item_import','item_import_unresolved',
    'item_taxonomy_disagreement','vendor_exclusion','vendor_quarantine','erp_licensor',
    'erp_property','taxonomy_resolution_review','taxonomy_parallel_observation',
    'taxonomy_sync_alert','taxonomy_circuit_breaker','taxonomy_circuit_breaker_event',
    'taxonomy_baseline_pin','taxonomy_baseline_activation','deployment_environment',
    'production_order_source_ref','production_order_line_source_ref'
  ];
begin
  foreach t in array v_tables loop
    foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role still holds % on plm.%', p, t;
      end if;
    end loop;

    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'FAIL service_role LOST % on plm.% -- over-revoked', p, t;
      end if;
    end loop;

    if not has_table_privilege('authenticated', format('plm.%I', t)::regclass, 'SELECT') then
      v_bad := v_bad + 1;
      raise warning 'FAIL authenticated LOST SELECT on plm.% -- over-revoked', t;
    end if;
  end loop;

  if v_bad <> 0 then
    raise exception
      'SECTION D FAILED with % privilege violation(s) -- see the warnings above', v_bad;
  end if;

  raise notice 'SECTION D OK: all 37 plm tables verified.';
end;
$$;
