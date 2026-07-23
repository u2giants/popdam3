-- Hardening found during preview consumer/concurrency verification.
BEGIN;

ALTER TABLE dflow.sample_movement
  ADD CONSTRAINT sample_movement_transit_box_identity_check
  CHECK ((from_location_type <> 'in_transit' OR from_location_id = box_id_fk::text)
     AND (to_location_type <> 'in_transit' OR to_location_id = box_id_fk::text)) NOT VALID;
ALTER TABLE dflow.sample_movement VALIDATE CONSTRAINT sample_movement_transit_box_identity_check;

ALTER TABLE dflow.sample_movement
  ADD CONSTRAINT sample_movement_discrepancy_details_check
  CHECK (discrepancy_code IS NULL OR btrim(COALESCE(discrepancy_details,'')) <> '') NOT VALID;
ALTER TABLE dflow.sample_movement VALIDATE CONSTRAINT sample_movement_discrepancy_details_check;

ALTER TABLE dflow.sample_import_row
  ADD CONSTRAINT sample_import_row_json_shapes_check
  CHECK (jsonb_typeof(normalized_values)='object'
     AND jsonb_typeof(validation_errors)='array'
     AND jsonb_typeof(validation_warnings)='array') NOT VALID;
ALTER TABLE dflow.sample_import_row VALIDATE CONSTRAINT sample_import_row_json_shapes_check;

COMMENT ON TABLE dflow.sample_movement IS 'Immutable sole authority for physical sample quantity; post through dflow.post_sample_movement.';
COMMENT ON TABLE dflow.sample_shipment_line IS 'Box/sample route intent; intended quantity is not proof of physical movement or receipt.';
COMMENT ON COLUMN dflow.sample.quantity_migration_state IS 'Legacy quantity confidence. Existing rows default unknown and must never be treated as quantity one.';

COMMIT;
