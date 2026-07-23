-- Stable read contracts derived only from immutable movement truth.
BEGIN;

CREATE OR REPLACE VIEW dflow.sample_balance_by_location AS
WITH legs AS (
  SELECT sample_id_fk,to_location_type location_type,to_location_id location_id,to_location_label location_label,quantity delta FROM dflow.sample_movement
  UNION ALL
  SELECT sample_id_fk,from_location_type,from_location_id,from_location_label,-quantity FROM dflow.sample_movement
)
SELECT sample_id_fk,location_type,location_id,max(location_label) location_label,sum(delta)::bigint quantity
FROM legs GROUP BY sample_id_fk,location_type,location_id HAVING sum(delta) <> 0;

CREATE OR REPLACE VIEW dflow.sample_in_transit AS
SELECT b.sample_id_fk,b.location_id::integer box_id_pk,b.quantity,
       bx.box_label,bx.tracking_number,bx.direction,bx.shipped_date
FROM dflow.sample_balance_by_location b
JOIN dflow.sample_box bx ON bx.box_id_pk=b.location_id::integer
WHERE b.location_type='in_transit' AND b.quantity>0 AND b.location_id ~ '^[0-9]+$';

CREATE OR REPLACE VIEW dflow.sample_receipt_discrepancy AS
SELECT sl.shipment_line_id,sl.sample_id_fk,sl.box_id_fk,sl.quantity_intended,
       COALESCE(sum(m.quantity) FILTER (WHERE m.lifecycle_action='receive'),0)::bigint quantity_received,
       sl.quantity_intended-COALESCE(sum(m.quantity) FILTER (WHERE m.lifecycle_action='receive'),0)::bigint variance
FROM dflow.sample_shipment_line sl LEFT JOIN dflow.sample_movement m ON m.shipment_line_id=sl.shipment_line_id
GROUP BY sl.shipment_line_id;

CREATE OR REPLACE VIEW dflow.sample_open_stop_work AS
SELECT b.* FROM dflow.sample_balance_by_location b
WHERE b.location_type IN ('factory','office','customer') AND b.quantity>0
AND NOT EXISTS (
  SELECT 1 FROM dflow.sample_stop_closeout c
  WHERE c.sample_id_fk=b.sample_id_fk AND c.location_type=b.location_type AND c.location_id=b.location_id
    AND c.state='closed' AND c.movement_watermark >= COALESCE((SELECT max(movement_id) FROM dflow.sample_movement m WHERE m.sample_id_fk=b.sample_id_fk),0)
);

CREATE OR REPLACE VIEW dflow.sample_global_status AS
SELECT s.sample_id_pk,
  CASE WHEN s.quantity_migration_state='unknown' THEN 'legacy_unknown'
       WHEN EXISTS (SELECT 1 FROM dflow.sample_balance_by_location b WHERE b.sample_id_fk=s.sample_id_pk AND b.location_type='in_transit' AND b.quantity>0) THEN 'in_transit'
       WHEN EXISTS (SELECT 1 FROM dflow.sample_open_stop_work o WHERE o.sample_id_fk=s.sample_id_pk) THEN 'outstanding'
       ELSE 'complete' END derived_status
FROM dflow.sample s;

REVOKE ALL ON dflow.sample_balance_by_location,dflow.sample_in_transit,dflow.sample_receipt_discrepancy,dflow.sample_open_stop_work,dflow.sample_global_status FROM anon,authenticated;

COMMIT;
