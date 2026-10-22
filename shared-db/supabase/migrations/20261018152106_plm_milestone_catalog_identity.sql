-- #4379, author claim #4380: additive milestone identity (phase A).
-- derived-from: none
-- Keep the old global name key until all deployed writers support partial keys.
-- Historical catalog IDs deliberately have no live-row FK: deleting a catalog
-- list must retain completion and notification history, even for equal names.
BEGIN;

ALTER TABLE plm.prod_order_milestone_schedule
  ADD COLUMN stage_id integer NULL CHECK (stage_id > 0);

COMMENT ON COLUMN plm.prod_order_milestone_schedule.stage_id IS
  'Immutable catalog stage identity when present; NULL for legacy snapshots. Historical IDs survive catalog deletion, so intentionally no live-row FK. No name-based backfill.';

CREATE UNIQUE INDEX prod_order_milestone_schedule_catalog_stage_key
  ON plm.prod_order_milestone_schedule (prod_order_header_id, stage_id, sku)
  WHERE stage_id IS NOT NULL;

CREATE UNIQUE INDEX prod_order_milestone_schedule_legacy_name_key
  ON plm.prod_order_milestone_schedule (prod_order_header_id, stage_name, sku)
  WHERE stage_id IS NULL;

-- The existing prod_order_milestone_schedule_upsert_key remains untouched.
COMMIT;
