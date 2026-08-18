-- Transactional proof for the owner-authorized Release A reconciliation.
BEGIN;

DO $$
DECLARE
  v_present integer;
  v_missing text[];
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version IN ('20260814130000','20260814193402','20260818024441')) <> 3 THEN
    RAISE EXCEPTION 'Release A reconciliation ledger is incomplete';
  END IF;

  SELECT array_agg(name ORDER BY name) INTO v_missing
  FROM (VALUES
    ('dflow.sample_creation_batch'),('dflow.sample_workflow'),
    ('dflow.sample_path_revision'),('dflow.sample_inventory')
  ) AS expected(name)
  WHERE to_regclass(expected.name) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Release A reconciliation relations are incomplete: %',v_missing;
  END IF;

  IF (SELECT count(DISTINCT p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='dflow' AND p.proname IN (
        'validate_sample_path_revision','require_sample_path_revision',
        'apply_sample_path_revision','reject_sample_path_revision_mutation',
        'validate_sample_shipment_line_header')) <> 5 THEN
    RAISE EXCEPTION 'Release A reconciliation functions are incomplete';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'sample_path_revision_validate','sample_workflow_path_revision_required',
        'sample_path_revision_apply','sample_path_revision_immutable',
        'sample_shipment_line_header_route')) <> 5 THEN
    RAISE EXCEPTION 'Release A reconciliation triggers are incomplete';
  END IF;
  IF to_regclass('dflow.sample_workflow_queue_idx') IS NULL
     OR to_regclass('dflow.sample_movement_inventory_idx') IS NULL THEN
    RAISE EXCEPTION 'Release A reconciliation indexes are incomplete';
  END IF;
  IF (SELECT count(*) FROM dflow.sample_carrier WHERE is_active) <> 4
     OR (SELECT count(*) FROM dflow.sample_carrier
         WHERE is_active AND carrier_code IN ('ups','fedex','dhl','usps')) <> 4 THEN
    RAISE EXCEPTION 'Release A carrier seed contract is incomplete';
  END IF;
  IF has_table_privilege('anon','dflow.sample_creation_batch','SELECT')
     OR has_table_privilege('authenticated','dflow.sample_workflow','SELECT')
     OR has_table_privilege('authenticated','dflow.sample_path_revision','SELECT')
     OR has_table_privilege('authenticated','dflow.sample_inventory','SELECT') THEN
    RAISE EXCEPTION 'Release A reconciliation exposed a direct relation privilege';
  END IF;

END $$;

ROLLBACK;

-- Run the real migration against an exact 2-of-3 state. Its own guard must
-- abort the transaction; psql continues only so this test can prove rollback.
BEGIN;
DROP TABLE dflow.sample_path_revision CASCADE;
\set ON_ERROR_STOP off
\ir ../migrations/20260818024441_sample_tracking_release_a_catalog_reconciliation.sql
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('dflow.sample_path_revision') IS NULL THEN
    RAISE EXCEPTION 'Release A mixed-state refusal did not restore the dropped table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='sample_path_revision_validate' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Release A mixed-state refusal did not restore the dropped trigger';
  END IF;
END $$;

-- Run the real migration against the repairable 0-of-3 preview shape. This is
-- a throwaway CI database; committing the fixture drop lets the migration's
-- own BEGIN/COMMIT execute exactly as it will in the governed preview lane.
BEGIN;
DROP TABLE dflow.sample_path_revision CASCADE;
DROP TABLE dflow.sample_workflow CASCADE;
DROP TABLE dflow.sample_creation_batch CASCADE;
COMMIT;

\ir ../migrations/20260818024441_sample_tracking_release_a_catalog_reconciliation.sql

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_missing
  FROM (VALUES
    ('dflow.sample_creation_batch'),('dflow.sample_workflow'),
    ('dflow.sample_path_revision'),('dflow.sample_inventory')
  ) AS expected(name)
  WHERE to_regclass(expected.name) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Release A 0-of-3 repair did not recreate relations: %',v_missing;
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'sample_path_revision_validate','sample_workflow_path_revision_required',
        'sample_path_revision_apply','sample_path_revision_immutable',
        'sample_shipment_line_header_route')) <> 5 THEN
    RAISE EXCEPTION 'Release A 0-of-3 repair did not recreate triggers';
  END IF;
END $$;
