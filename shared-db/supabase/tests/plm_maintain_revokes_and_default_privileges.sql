-- =====================================================================================
-- Contract tests for migration 20260810180000 -- the PostgreSQL 17 MAINTAIN revokes on
-- the 39 plm landing tables (#664) and the plm schema default-privilege hole (#649).
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, on the SESSION pooler port 5432, NOT the
--   transaction pooler port 6543.
--
--   The connection string is assembled from these parts rather than written out whole.
--   That is deliberate: a Supabase pooler username is shaped `postgres.<project-ref>`,
--   and joining it to the pooler host produces a `name@host` token that the repository's
--   PII forward guard correctly reads as an email address. It is a service hostname, not
--   a person, but the guard cannot know that and widening the guard to suit one comment
--   line is the wrong trade. So: build it, do not paste it.
--
--       scheme    postgresql://
--       user      postgres.rjyboqwcdzcocqgmsyel      <- the literal word postgres, a dot,
--                                                       then the preview project ref
--       separator the usual userinfo separator character
--       host      aws-0-us-east-1.pooler.supabase.com
--       port      5432                               <- SESSION pooler. NOT 6543.
--       database  /postgres
--       options   ?sslmode=require
--
--   Then run, with the string you just assembled:
--
--       psql "<connection string>" \
--            -v ON_ERROR_STOP=1 -f supabase/tests/plm_maintain_revokes_and_default_privileges.sql
--
--   Port 6543 is the transaction pooler: it wraps the whole batch in one implicit
--   transaction and stalls. Observed on this database 2026-08-09. Use 5432.
--
--   Section D creates and drops a throwaway table, so the connection must be able to
--   CREATE TABLE in plm -- i.e. the migration owner, `postgres`. Everything else is a
--   pure catalog read and needs no privilege at all.
--
--   PREVIEW ALREADY HAS ALL 39 LANDING TABLES (confirmed 2026-08-10). So a preview run
--   exercises sections A, B and C at FULL STRENGTH -- it does not take the "family
--   absent" skip path that migration 20260810180000 tolerates. If section A reports
--   fewer than 39 tables, something regressed; do not assume it is the ordering.
--
-- SIDE EFFECTS: NONE THAT SURVIVE. Section D runs inside an explicit transaction that
--   ends in ROLLBACK, so its probe table never commits. No other section writes.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No licensor
--   source row, id, filename or portal URL appears here.
--
-- WHAT IT ASSERTS
--   A  ABSENCE. On all 39 plm.pmt_*/plm.nbcu_* tables service_role holds none of
--      TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. MAINTAIN is real on this server
--      (PostgreSQL 17.6) and is the bit 20260810080000/20260810090000 predate.
--   B  NOT OVER-REVOKED. pmt keeps INSERT/SELECT/UPDATE/DELETE; nbcu keeps SELECT and
--      does NOT hold UPDATE/DELETE. anon and PUBLIC hold nothing.
--   C  DEFAULT PRIVILEGES. pg_default_acl for (postgres, plm, tables) is exactly
--      service_role=arwd -- the TRUNCATE/REFERENCES/TRIGGER/MAINTAIN bits are gone and
--      the DML bits remain.
--   D  BEHAVIOUR, not just catalog. A brand-new plm table created inside a rolled-back
--      transaction is born WITHOUT truncate/references/trigger/maintain for
--      service_role and WITH insert/select/update/delete. This is the assertion that
--      actually proves #649 is closed; C alone only proves a catalog row was edited.
--   E  NULL-ROLE GUARD. auth.role() is NULL on this connection, and the guard shape
--      `if not ( ... or auth.role() = 'service_role' )` evaluates to NULL and therefore
--      NEVER RAISES. Asserted explicitly so nobody re-introduces that shape here.
--
-- Every section enumerates its tables from pg_class as well as from a known list, so a
-- renamed or missing table FAILS instead of passing vacuously.
--
-- DELIBERATE ASYMMETRY WITH THE MIGRATION. Migration 20260810180000 tolerates a family
-- of tables being absent (it may legally be promoted alone, for recovery, and every one
-- of its 39 references is a dynamic `execute format(...)` that would otherwise abort a
-- batch mid-apply). THIS TEST DOES NOT. It is run after the landing migrations, against
-- preview, to prove the end state, so all 39 tables must be present and section A raises
-- if they are not. Do not "align" the two by softening this file -- the tolerance in the
-- migration exists for an apply-ordering reason that does not apply to a test run.
-- The production lane cannot produce the created-but-unfixed state anyway: the
-- co-presence rules in scripts/production_migration_guard.py refuse an allowlist that
-- promotes 20260810020000 or 20260810070000 without 20260810180000.
-- =====================================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_ver int := current_setting('server_version_num')::int;
begin
  if v_ver < 170000 then
    raise exception
      'PRECONDITION FAILED: this test asserts the MAINTAIN privilege, which exists only '
      'on PostgreSQL 17+. server_version_num = %', v_ver;
  end if;
  raise notice 'PRECONDITION OK: server_version_num = % (MAINTAIN exists)', v_ver;
end;
$$;


-- =====================================================================================
-- A + B. The 39 landing tables.
-- =====================================================================================
do $$
declare
  v_pmt  text[] := array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override',
    -- Added by 20260811030000 (PR #752, the lossless repeated-metadata table). It is a
    -- pmt landing table like every other name here, so it keeps service_role's documented
    -- INSERT/UPDATE/DELETE and must hold none of TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
    'pmt_asset_metadata_value'];
  v_nbcu text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'];
  v_found text[];
  v_missing text[];
  t     text;
  p     text;
  v_bad int := 0;
  v_n   int;
begin
  -- Enumerate from the catalog, so a table added later without a revoke is caught.
  select array_agg(relname order by relname) into v_found
    from pg_class
   where relnamespace = 'plm'::regnamespace and relkind = 'r'
     and (relname like 'pmt\_%' or relname like 'nbcu\_%');

  if v_found is null then
    raise exception
      'A FAILED: pg_class returned NO plm.pmt_*/plm.nbcu_* tables. This test would '
      'otherwise pass vacuously. Apply the landing migrations first.';
  end if;

  select array_agg(k) into v_missing
    from unnest(v_pmt || v_nbcu) k
   where not (k = any(v_found));
  if v_missing is not null then
    raise exception 'A FAILED: expected table(s) % absent from pg_class', v_missing;
  end if;

  raise notice 'A: enumerated % plm landing table(s) from pg_class', array_length(v_found, 1);

  -- A. ABSENCE of the four unwanted privileges, across everything enumerated.
  foreach t in array v_found loop
    foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'A FAIL: service_role still holds % on plm.%', p, t;
      end if;
    end loop;
  end loop;

  -- B. Not over-revoked: SELECT survives everywhere.
  foreach t in array v_found loop
    if not has_table_privilege('service_role', format('plm.%I', t)::regclass, 'SELECT') then
      v_bad := v_bad + 1;
      raise warning 'B FAIL: service_role LOST SELECT on plm.%', t;
    end if;
  end loop;

  -- B. pmt keeps its documented DML (20260810090000:53-59).
  foreach t in array v_pmt loop
    foreach p in array array['INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'B FAIL: service_role LOST % on plm.% (pmt keeps DML)', p, t;
      end if;
    end loop;
  end loop;

  -- B. nbcu is immutable-by-grant (20260810080000): no UPDATE, no DELETE anywhere,
  --    and no INSERT on nbcu_capture specifically.
  foreach t in array v_nbcu loop
    foreach p in array array['UPDATE','DELETE'] loop
      if has_table_privilege('service_role', format('plm.%I', t)::regclass, p) then
        v_bad := v_bad + 1;
        raise warning 'B FAIL: service_role holds % on plm.% (nbcu must not)', p, t;
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role', 'plm.nbcu_capture', 'INSERT') then
    v_bad := v_bad + 1;
    raise warning 'B FAIL: service_role holds INSERT on plm.nbcu_capture -- capture rows '
      'are minted only by plm.begin_nbcu_capture (security definer)';
  end if;

  -- B. anon and PUBLIC hold nothing at all.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name = any(v_found)
     and grantee in ('anon', 'PUBLIC');
  if v_n <> 0 then
    v_bad := v_bad + 1;
    raise warning 'B FAIL: anon/PUBLIC hold % grant(s) on the plm landing tables', v_n;
  end if;

  if v_bad <> 0 then
    raise exception 'A/B FAILED with % violation(s) -- see the warnings above', v_bad;
  end if;
  raise notice 'A/B OK';
end;
$$;


-- =====================================================================================
-- C. The default privilege itself (#649).
--
-- PRECONDITION, STATED BECAUSE AN EXACT-STRING ASSERTION DESERVES ONE. This section
-- asserts the ACL text EXACTLY -- `{service_role=arwd/postgres}` -- rather than testing
-- for the absence of bits. An exact assertion also catches a bit being ADDED by some
-- future migration, which a bits-absent check would miss, and it fails with the actual
-- string in the message so a mismatch is diagnosable in one read.
--
-- The pre-fix baseline was measured on BOTH projects on 2026-08-10 via the Supabase
-- Management API, precisely so this assertion could not fail for an environmental
-- reason and teach the next reader to distrust the file:
--     production qsllyeztdwjgirsysgai -> {service_role=arwdDxtm/postgres}, defaclrole postgres
--     preview    rjyboqwcdzcocqgmsyel -> {service_role=arwdDxtm/postgres}, defaclrole postgres
-- Identical, one row each. So preview is a faithful stand-in here.
--
-- IF THIS SECTION FAILS, read the string it prints before assuming the migration is
-- wrong. A THIRD role appearing in the ACL means some other migration granted on plm
-- defaults; that is a real finding and must not be "fixed" by loosening this assertion.
-- =====================================================================================
do $$
declare
  v_acl text;
  v_n   int;
begin
  select count(*) into v_n
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'plm' and d.defaclobjtype = 'r';
  if v_n <> 1 then
    raise exception
      'C FAILED: expected exactly 1 pg_default_acl table rule for plm, found %. More '
      'than one means an ALTER DEFAULT PRIVILEGES ran under the wrong defaclrole.', v_n;
  end if;

  select d.defaclacl::text into v_acl
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'plm' and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole;

  if v_acl is null then
    raise exception 'C FAILED: no pg_default_acl row for (postgres, plm, tables)';
  end if;

  if v_acl <> '{service_role=arwd/postgres}' then
    raise exception
      'C FAILED: plm default table privileges are % -- expected exactly '
      '{service_role=arwd/postgres} (a=insert r=select w=update d=delete; '
      'D=truncate x=references t=trigger m=maintain must all be absent)', v_acl;
  end if;
  raise notice 'C OK: plm default table privileges = %', v_acl;
end;
$$;


-- =====================================================================================
-- D. BEHAVIOUR. A brand-new plm table must be born without the DDL/TRUNCATE bits.
--    Rolled back -- the probe table never commits.
-- =====================================================================================
begin;

create table plm.zztest_default_privilege_probe_664 (id int primary key);

do $$
declare
  p     text;
  v_bad int := 0;
begin
  foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role', 'plm.zztest_default_privilege_probe_664', p) then
      v_bad := v_bad + 1;
      raise warning 'D FAIL: a NEW plm table is still born with % for service_role -- '
        'the schema default privilege hole (#649) is NOT closed', p;
    end if;
  end loop;

  foreach p in array array['INSERT','SELECT','UPDATE','DELETE'] loop
    if not has_table_privilege('service_role', 'plm.zztest_default_privilege_probe_664', p) then
      v_bad := v_bad + 1;
      raise warning 'D FAIL: a NEW plm table is born WITHOUT % for service_role -- '
        'the default was over-narrowed and the next loader will fail', p;
    end if;
  end loop;

  if v_bad <> 0 then
    raise exception 'D FAILED with % violation(s) -- see the warnings above', v_bad;
  end if;
  raise notice 'D OK: new plm tables are born service_role=arwd only';
end;
$$;

rollback;

-- Prove the rollback took, so this file leaves nothing behind.
do $$
begin
  if to_regclass('plm.zztest_default_privilege_probe_664') is not null then
    raise exception 'D FAILED: the probe table survived the ROLLBACK -- drop it manually';
  end if;
  raise notice 'D OK: probe table rolled back, no residue';
end;
$$;


-- =====================================================================================
-- E. The NULL-permissive guard trap, asserted rather than assumed.
--
--    Migration 20260810180000 deliberately contains NO auth.role() check. The reason is
--    that inside a migration auth.role() is NULL, so
--        if not ( <false> or auth.role() = 'service_role' ) then raise
--    evaluates NOT(NULL) = NULL, the IF does not take, and the guard NEVER FIRES. This
--    section demonstrates that on this very connection, so the next author cannot
--    "harden" the migration with a guard that is decoration.
-- =====================================================================================
do $$
declare
  v_role text;
  v_fired boolean := false;
begin
  begin
    v_role := auth.role();
  exception when others then
    v_role := null;   -- auth schema absent on a bare connection; NULL is the point
  end;

  if v_role is not null then
    raise exception
      'E FAILED: auth.role() returned % on this connection. This test asserts the NULL '
      'case; re-run it as the migration owner on a direct connection.', v_role;
  end if;

  -- The BAD guard shape. It must NOT fire.
  if not (false or v_role = 'service_role') then
    v_fired := true;
  end if;

  if v_fired then
    raise exception
      'E FAILED: the null-permissive guard fired with a NULL role. PostgreSQL three-'
      'valued logic changed; re-review every auth.role() guard in the repository.';
  end if;

  -- The CORRECT shape: require a NON-NULL role AND a positive match. It must reject.
  if v_role is not null and v_role = 'service_role' then
    raise exception 'E FAILED: the corrected guard accepted a NULL role';
  end if;

  raise notice 'E OK: null-permissive guard proven inert; corrected shape rejects NULL';
end;
$$;

\echo 'ALL SECTIONS PASSED: plm_maintain_revokes_and_default_privileges'
