-- Issue #1502: align Flow 1 factory-return shipment validation with the
-- canonical application and shipment location vocabulary. The comparison is
-- intentionally exact: `Ningbo` is accepted and the legacy lowercase spelling
-- remains rejected.

CREATE OR REPLACE FUNCTION dflow.validate_sample_movement_shipment_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_line dflow.sample_shipment_line;
  v_visit dflow.sample_factory_visit;
  v_outbound_line dflow.sample_shipment_line;
  v_workflow_type text;
BEGIN
  IF NEW.shipment_line_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sample_shipment_line:' || NEW.shipment_line_id::text,0));
  SELECT * INTO v_line FROM dflow.sample_shipment_line
  WHERE shipment_line_id=NEW.shipment_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment line % does not exist',NEW.shipment_line_id USING ERRCODE='23503';
  END IF;
  IF NEW.sample_id_fk IS DISTINCT FROM v_line.sample_id_fk
     OR NEW.box_id_fk IS DISTINCT FROM v_line.box_id_fk
     OR NEW.sample_shipment_id IS DISTINCT FROM v_line.sample_shipment_id THEN
    RAISE EXCEPTION 'Movement identity does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL
     AND NEW.lifecycle_action = 'return'
     AND NEW.from_location_type = 'in_transit'
     AND NEW.to_location_type = 'in_transit' THEN
    SELECT v.* INTO v_visit
    FROM dflow.sample_factory_visit v
    WHERE v.sample_id_fk = NEW.sample_id_fk
      AND v.state = 'shipped'
      AND v.outbound_shipment_id::text = NEW.from_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transit return has no matching shipped factory visit for sample %',NEW.sample_id_fk
        USING ERRCODE='23514';
    END IF;

    SELECT workflow_type INTO v_workflow_type
    FROM dflow.sample_workflow WHERE sample_id_fk=NEW.sample_id_fk;
    IF v_workflow_type IS DISTINCT FROM 'nyo_purchased_factory_reference' THEN
      RAISE EXCEPTION 'Transit return requires a Flow 1 sample' USING ERRCODE='23514';
    END IF;

    SELECT * INTO v_outbound_line
    FROM dflow.sample_shipment_line
    WHERE sample_shipment_id=v_visit.outbound_shipment_id
      AND sample_id_fk=NEW.sample_id_fk;
    IF NOT FOUND
       OR v_outbound_line.destination_location_type IS DISTINCT FROM 'factory'
       OR v_outbound_line.destination_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.origin_location_type IS DISTINCT FROM 'factory'
       OR v_line.origin_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.destination_location_type IS DISTINCT FROM 'office'
       OR v_line.destination_location_id IS DISTINCT FROM 'Ningbo'
       OR NEW.to_location_id IS DISTINCT FROM v_line.sample_shipment_id::text
       OR NEW.from_location_id = NEW.to_location_id THEN
      RAISE EXCEPTION 'Transit return shipment does not match factory visit %',v_visit.sample_factory_visit_id
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL AND NOT (
    (NEW.from_location_type IS NOT DISTINCT FROM v_line.origin_location_type
      AND NEW.from_location_id IS NOT DISTINCT FROM v_line.origin_location_id
      AND NEW.to_location_type='in_transit')
    OR
    (NEW.from_location_type='in_transit'
      AND NEW.to_location_type IS NOT DISTINCT FROM v_line.destination_location_type
      AND NEW.to_location_id IS NOT DISTINCT FROM v_line.destination_location_id)
  ) THEN
    RAISE EXCEPTION 'Movement route does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
