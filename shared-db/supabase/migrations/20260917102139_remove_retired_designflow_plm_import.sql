-- 20260917102139_remove_retired_designflow_plm_import.sql
-- issue: #2794 - Remove retired DesignFlow PLM sync and all runtime vestiges
-- derived-from: none
--
-- The declaration is `none` because this file DROPS an object; it does not
-- re-derive any body. scripts/migration_derivation.py requires each declared
-- base to be a bare 14-digit version (VERSION_RE), and declaration_required()
-- covers only `create or replace` whole-object replacements, which this is not.
-- `none` is the grammar's POSITIVE statement of independence, so the promotion
-- lane parses it instead of raising DerivationError. The prior text named
-- 20260817124545_licensing_write_authority_guard.sql (#1090 Step 1.0), which is
-- prose plus a filename: it passes check-sql.sh but would raise at production
-- classify time, after a preview apply has already frozen these bytes.
--
-- WHY THIS DROPS RATHER THAN ARCHIVES
-- ----------------------------------------------------------------------------
-- The repository default for retirement is ARCHIVE, never DROP. That default
-- protects DATA. plm.import_master_data(jsonb,jsonb) holds none: since
-- 20260817124545 its entire body is a single RAISE that refuses every call. It
-- owns no table, no rows, no history and no audit trail, so there is nothing to
-- move to the archive schema. Issue #2794 explicitly authorizes the removal
-- ("remove the DesignFlow PLM sync completely, including its vestiges") and
-- conditions it on proof of no remaining callers, recorded below.
--
-- PRODUCTION PROOF OF NO REMAINING READERS (project qsllyeztdwjgirsysgai)
--   - function body            : retirement RAISE only, no executable path
--   - proacl                   : postgres=X/postgres (EXECUTE revoked from
--                                public, anon, authenticated, service_role)
--   - referencing functions    : 0
--   - referencing views        : 0
--   - non-normal pg_depend rows: 0
--   - positive control         : 2  (the same predicate matches real bodies, so
--                                the zeros above are genuine absences and not a
--                                silently broken query)
--
-- WHAT THIS MIGRATION MUST NOT DISTURB (all verified present post-drop below)
--   plm.licensing_write_authorization, plm.licensing_write_guard_audit,
--   app.enforce_licensing_write_authority(), and the triggers
--   licensor_licensing_write_guard / property_licensing_write_guard.
-- No audit row, history row or lock is deleted by this migration.

begin;

-- Pre-drop guard. Refuses rather than removing anything unexpected.
do $guard$
declare
  v_oid oid;
  v_body text;
  v_hard_deps integer;
begin
  select p.oid, p.prosrc
    into v_oid, v_body
    from pg_proc p
   where p.oid = to_regprocedure('plm.import_master_data(jsonb,jsonb)');

  if v_oid is null then
    raise notice 'plm.import_master_data(jsonb,jsonb) already absent; nothing to do';
    return;
  end if;

  -- Only the retired stub may be dropped. A live body means someone replaced
  -- the importer after #1090 and this migration must not destroy it.
  if position('retired by #1090 Step 1.0' in v_body) = 0 then
    raise exception
      'refusing to drop plm.import_master_data: body is not the #1090 retirement stub';
  end if;

  -- Any non-normal dependency means another object is built on this function.
  select count(*)
    into v_hard_deps
    from pg_depend d
   where d.refobjid = v_oid
     and d.refclassid = 'pg_proc'::regclass
     and d.deptype <> 'n';

  if v_hard_deps > 0 then
    raise exception
      'refusing to drop plm.import_master_data: % non-normal dependent(s) exist', v_hard_deps;
  end if;
end
$guard$;

-- Deliberately NOT cascade: if anything unexpected depends on this, fail loudly.
drop function if exists plm.import_master_data(jsonb, jsonb);

-- Post-drop assertions: the importer is gone and the licensing write guard,
-- which is unrelated to the importer and must survive, is fully intact.
do $verify$
declare
  v_missing text;
begin
  if to_regprocedure('plm.import_master_data(jsonb,jsonb)') is not null then
    raise exception 'post-drop check failed: plm.import_master_data still present';
  end if;

  select string_agg(t.name, ', ')
    into v_missing
    from (values
      ('licensor_licensing_write_guard'),
      ('property_licensing_write_guard')
    ) as t(name)
   where not exists (
     select 1 from pg_trigger g
      where g.tgname = t.name
        and not g.tgisinternal
   );

  if v_missing is not null then
    raise exception 'post-drop check failed: licensing write guard trigger(s) missing: %', v_missing;
  end if;

  if to_regclass('plm.licensing_write_authorization') is null then
    raise exception 'post-drop check failed: plm.licensing_write_authorization missing';
  end if;

  if to_regclass('plm.licensing_write_guard_audit') is null then
    raise exception 'post-drop check failed: plm.licensing_write_guard_audit missing';
  end if;

  if to_regprocedure('app.enforce_licensing_write_authority()') is null then
    raise exception 'post-drop check failed: app.enforce_licensing_write_authority() missing';
  end if;
end
$verify$;

commit;
