-- Allow a shipment intent line to ORIGINATE from an office inventory bucket, so
-- stock resting in "Ningbo Ofc Inventory" / "NY Ofc Inventory" can be added to a
-- new box later.
--
-- Why this is needed (found by regression test 2026-07-23):
--   The confirmed office-inventory rule (migration 20260723230000) parks an
--   office's leftover pieces at terminal/{office}_office_inventory so they leave
--   the main tracking flow while staying conserved. Those pieces must remain
--   usable -- the business requirement is that you can add a sample to a box FROM
--   inventory, not that inventory is a one-way trap.
--
--   The movement layer already supports this correctly: dflow.sample_movement_guard
--   exempts ONLY terminal sources 'created' / 'receipt_overage' /
--   'reconciled_opening' from the balance check, so a withdrawal out of an
--   *_office_inventory bucket is fully balance-checked (you can take what is
--   there and no more).
--
--   The INTENT layer blocked it: dflow.sample_shipment_line restricted
--   origin_location_type to ('factory','office','customer'), and every in_transit
--   movement requires a shipment_line_id (CHECK in 20260722221400). So packing
--   from inventory failed with:
--     new row for relation "sample_shipment_line" violates check constraint
--     "sample_shipment_line_origin_location_type_check"
--
-- Scope of this change (deliberately narrow):
--   * ORIGIN may additionally be 'terminal' ONLY when the id is an office
--     inventory bucket (ends in '_office_inventory'). Arbitrary terminal origins
--     such as 'delivered', 'disposed', 'lost' or 'created' remain rejected, so
--     this cannot become a backdoor for minting or for "un-delivering" stock.
--   * DESTINATION is intentionally left unchanged ('factory','office','customer').
--     Nothing ships INTO an inventory bucket via an intent line -- pieces arrive
--     there only through the automatic office-inventory trigger.
--
-- Additive and reversible: it only widens an existing CHECK. To revert, restore
-- the three-value CHECK in a new timestamped migration.

BEGIN;

ALTER TABLE dflow.sample_shipment_line
  DROP CONSTRAINT IF EXISTS sample_shipment_line_origin_location_type_check;

ALTER TABLE dflow.sample_shipment_line
  ADD CONSTRAINT sample_shipment_line_origin_location_type_check
  CHECK (
    origin_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text])
    OR (
      origin_location_type = 'terminal'::text
      AND origin_location_id LIKE '%\_office\_inventory'
    )
  );

COMMENT ON CONSTRAINT sample_shipment_line_origin_location_type_check
  ON dflow.sample_shipment_line IS
  'Shipment intent may originate at a physical location, or at an office '
  'inventory bucket (terminal/*_office_inventory) so parked stock can be added '
  'to a later box. Other terminal states (delivered/disposed/lost/created) are '
  'not valid shipment origins.';

COMMIT;
