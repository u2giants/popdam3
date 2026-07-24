-- Redefine dflow.sample_shipment_line.route_leg to the explicit, business-approved
-- location-to-location set. Every route is an explicit From -> To (no relative
-- "inbound/outbound" and no vague "return"/"direct_to_customer").
--
-- Approved set (Albert, 2026-07-23):
--   factory_to_ningbo, factory_to_nyc, factory_to_customer,
--   ningbo_to_nyc, ningbo_to_customer,
--   nyc_to_ningbo, nyc_to_factory, nyc_to_customer
--
-- Notes:
--   * factory_to_customer, ningbo_to_customer, nyc_to_ningbo are NEW.
--   * direct_to_customer and return are REMOVED. nyc_to_ningbo / nyc_to_factory
--     are NOT returns -- they carry USA-bought reference samples (quality /
--     construction reference / new-product ideas) forward from New York.
--   * nyc_to_customer is added so the canonical 4->4->3->1 scenario (New York
--     delivers the final piece) is representable.
--
-- Safe: sample_shipment_line is a newly introduced table with no production data
-- that uses the retired tokens (verified empty before authoring). The migration
-- aborts loudly if any existing row holds a value outside the new set rather than
-- silently dropping the guard.

BEGIN;

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM dflow.sample_shipment_line
  WHERE route_leg NOT IN (
    'factory_to_ningbo','factory_to_nyc','factory_to_customer',
    'ningbo_to_nyc','ningbo_to_customer',
    'nyc_to_ningbo','nyc_to_factory','nyc_to_customer'
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Refusing to retighten route_leg: % existing row(s) hold a value outside the new approved set. Reconcile them first.',
      v_bad;
  END IF;
END $$;

ALTER TABLE dflow.sample_shipment_line
  DROP CONSTRAINT IF EXISTS sample_shipment_line_route_leg_check;

ALTER TABLE dflow.sample_shipment_line
  ADD CONSTRAINT sample_shipment_line_route_leg_check
  CHECK (route_leg IN (
    'factory_to_ningbo','factory_to_nyc','factory_to_customer',
    'ningbo_to_nyc','ningbo_to_customer',
    'nyc_to_ningbo','nyc_to_factory','nyc_to_customer'
  ));

COMMIT;
