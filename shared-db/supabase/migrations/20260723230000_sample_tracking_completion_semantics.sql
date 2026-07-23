-- Sample Tracking completion-semantics repair (additive, idempotent).
--
-- Fixes two Critical defects in dflow.sample_global_status that were verified
-- live against production (qsllyeztdwjgirsysgai) on 2026-07-23:
--
--   Defect A (zero-movement false-complete):
--     A sample with quantity_migration_state <> 'unknown' and ZERO movement
--     rows has no in_transit balance and no open stop work, so the prior view
--     fell through to 'complete' despite no custody history. Such a sample
--     must not be 'complete'.
--
--   Defect B (closeout masks remaining balance):
--     sample_open_stop_work suppresses any location that has a matching
--     closed closeout with a high enough movement_watermark. A stop that is
--     CLOSED while still holding a positive non-terminal balance then
--     disappears from open work, and global_status fell through to
--     'complete' while physical pieces remain. Global completion must not be
--     reachable while ANY non-terminal physical balance remains, independent
--     of closeouts. Closeouts govern LOCAL handling-work done only
--     (fix_sample_tracking_schema.md §1: "not globally complete until no
--     piece remains in transit or otherwise unresolved"; §4 decision 8;
--     §5.6).
--
-- sample_open_stop_work is intentionally left unchanged as the local
-- "handling work still open" read model. Global completion is no longer
-- derived solely from that view.
--
-- ============================================================================
-- CONFIRMED PRODUCT RULE (plan §15 Q4 — answered 2026-07-23)
-- ============================================================================
-- Product confirmed on 2026-07-23 (replaces the prior conservative open-Q4
-- interpretation that treated customer-held as outstanding):
--
--   1. Each office has its OWN inventory bucket.
--        Ningbo leftovers  → terminal location_id 'ningbo_office_inventory'
--                            (label e.g. "Ningbo Ofc Inventory")
--        New York leftovers → terminal location_id 'nyc_office_inventory'
--                            (label e.g. "NY Ofc Inventory")
--
--   2. AUTOMATICALLY, with no extra user step: the moment some pieces ship
--      ONWARD out of an office (to in_transit heading elsewhere, or directly
--      to the customer), whatever quantity REMAINS at that office is moved
--      into that office's inventory bucket and EXITS the main tracking flow.
--      Implemented as AFTER INSERT trigger
--      dflow.sample_movement_auto_office_inventory (see below) so every
--      caller is covered — the consumer app cannot be trusted to do it, and
--      silent omission would leave false outstanding balances.
--
--   3. Pieces delivered to the customer are DONE (resolved / out of the
--      tracking flow). Positive 'customer' balance does NOT block complete.
--
--   4. Office inventory pieces remain fully conserved and auditable in the
--      ledger — they are a terminal disposition, not a deletion.
--
-- Resolved location types for global completion:
--   * terminal  — including *_office_inventory buckets (resolved)
--   * customer  — delivered / held by customer (resolved)
-- Unresolved (still block complete):
--   * factory   — un-dispositioned remainder at factory
--   * office    — un-dispositioned remainder still sitting at an office
--                 (real outstanding work until shipped onward or moved to
--                 inventory by the auto trigger)
--   * in_transit — surfaces as derived_status 'in_transit'
--
-- Canonical four-piece end state under this rule:
--   factory makes 4 → Ningbo receives 4, keeps 1, ships 3
--                 → NY receives 3, keeps 2, ships 1 to customer
--   end balances = terminal/ningbo_office_inventory 1,
--                  terminal/nyc_office_inventory 2,
--                  customer 1, in_transit 0
--   derived_status = 'complete' (all four conserved and resolved).
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW dflow.sample_global_status AS
SELECT
  s.sample_id_pk,
  CASE
    -- Legacy samples with no proven quantity stay explicitly unknown.
    WHEN s.quantity_migration_state = 'unknown' THEN 'legacy_unknown'

    -- Defect A: known/reconciled sample with no custody history is not complete.
    WHEN NOT EXISTS (
      SELECT 1
      FROM dflow.sample_movement m
      WHERE m.sample_id_fk = s.sample_id_pk
    ) THEN 'uninitialized'

    -- In-transit pieces always block completion and surface as in_transit.
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk = s.sample_id_pk
        AND b.location_type = 'in_transit'
        AND b.quantity > 0
    ) THEN 'in_transit'

    -- Defect B + confirmed §15 Q4: non-terminal physical balances at factory
    -- or office always block global completion, independent of local stop
    -- closeouts. 'terminal' and 'customer' are resolved and never listed here.
    -- An un-dispositioned remainder still sitting at an office is real
    -- outstanding work until it is shipped onward (auto-inventory trigger
    -- then moves the remainder) or otherwise dispositioned.
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk = s.sample_id_pk
        AND b.quantity > 0
        AND b.location_type IN ('factory', 'office')
    ) THEN 'outstanding'

    -- Local handling work still open at factory/office only.
    -- sample_open_stop_work (live, unchanged) also lists 'customer' rows with
    -- positive balance and no closeout. Customer is confirmed RESOLVED
    -- (2026-07-23), so customer open-stop rows must not block global complete.
    -- Filter here rather than altering the open_stop_work view (that view
    -- remains the local "work still open" read model for the UI).
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_open_stop_work o
      WHERE o.sample_id_fk = s.sample_id_pk
        AND o.location_type IN ('factory', 'office')
    ) THEN 'outstanding'

    -- All units resolved (terminal incl. office-inventory, and/or customer)
    -- with no unresolved factory/office remainder and no open local stop work.
    ELSE 'complete'
  END AS derived_status
FROM dflow.sample s;

-- Preserve the fail-closed browser grants from the original read-model migration.
REVOKE ALL ON dflow.sample_global_status FROM anon, authenticated;

COMMENT ON VIEW dflow.sample_global_status IS
  'Derived global sample completion. Authority is movement balances, not '
  'legacy sample.status. Plan §15 Q4 CONFIRMED 2026-07-23: terminal (incl. '
  '*_office_inventory) and customer are resolved; factory/office block complete; '
  'in_transit surfaces as in_transit. Office remainder auto-moves to that '
  'office''s inventory bucket on onward shipment (see auto-office-inventory trigger).';

-- ============================================================================
-- AUTOMATIC OFFICE-INVENTORY on onward shipment out of an office
-- ============================================================================
-- Rule (product confirmed 2026-07-23): when pieces ship ONWARD out of an
-- office (office → in_transit, or office → customer), any quantity that
-- REMAINS at that office is immediately moved into that office's inventory
-- bucket (terminal / {office_id}_office_inventory) and exits the main
-- tracking flow. Pieces stay conserved and auditable in the ledger.
--
-- Why a database trigger (not app logic):
--   Guaranteed for EVERY caller of dflow.sample_movement / post_sample_movement.
--   The consumer app cannot be trusted to remember this step; a silent miss
--   would leave false office balances and wrong global status. No silent
--   failure — the rule lives with the conservation authority.
--
-- Recursion guard (natural):
--   Fires only when from=office AND to IN (in_transit, customer). The auto
--   movement is office → terminal, so it never re-fires this trigger.
--
-- Trigger ordering vs conservation guard:
--   dflow.sample_movement_guard is BEFORE INSERT (applied migration
--   20260722221400). This function is AFTER INSERT, so:
--     1) the onward ship/deliver row is already visible in sample_movement;
--     2) remaining office balance is computed AFTER that row is applied;
--     3) the auto INSERT of exactly that remaining quantity then passes
--        sample_movement_guard (it cannot overdraw: balance == quantity).
--   Naming is unrelated to BEFORE/AFTER ordering in Postgres; AFTER INSERT
--   is the semantic choice so the remainder calculation includes NEW.
--
-- How to disable if product changes its mind:
--   DROP TRIGGER IF EXISTS sample_movement_auto_office_inventory_trigger
--     ON dflow.sample_movement;
--   (Optionally also DROP FUNCTION dflow.sample_movement_auto_office_inventory().)
--   Do not invent a new lifecycle_action — 'retain' is already in the live CHECK.
-- ============================================================================

CREATE OR REPLACE FUNCTION dflow.sample_movement_auto_office_inventory()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining bigint;
  v_to_id text;
  v_to_label text;
  v_idem text;
BEGIN
  -- Only onward shipments out of an office (not movements into terminal).
  IF NEW.from_location_type IS DISTINCT FROM 'office' THEN
    RETURN NEW;
  END IF;
  IF NEW.to_location_type IS DISTINCT FROM 'in_transit'
     AND NEW.to_location_type IS DISTINCT FROM 'customer' THEN
    RETURN NEW;
  END IF;

  -- Remaining office balance AFTER the inserted onward movement is applied.
  SELECT COALESCE(b.quantity, 0)
  INTO v_remaining
  FROM dflow.sample_balance_by_location b
  WHERE b.sample_id_fk = NEW.sample_id_fk
    AND b.location_type = 'office'
    AND b.location_id = NEW.from_location_id;

  v_remaining := COALESCE(v_remaining, 0);

  IF v_remaining <= 0 THEN
    RETURN NEW;
  END IF;

  -- Per-office inventory bucket (terminal disposition, not a deletion).
  v_to_id := NEW.from_location_id || '_office_inventory';
  v_to_label := CASE lower(NEW.from_location_id)
    WHEN 'ningbo' THEN 'Ningbo Ofc Inventory'
    WHEN 'nyc' THEN 'NY Ofc Inventory'
    WHEN 'ny' THEN 'NY Ofc Inventory'
    WHEN 'new_york' THEN 'NY Ofc Inventory'
    ELSE initcap(replace(NEW.from_location_id, '_', ' ')) || ' Ofc Inventory'
  END;

  -- Deterministic unique idempotency per source movement
  -- (UNIQUE (sample_id_fk, idempotency_key) on live table).
  v_idem := 'auto-ofc-inv-' || NEW.movement_id::text;

  -- Direct INSERT (not post_sample_movement) so we control every CHECK-facing
  -- column. sample_movement_guard still runs as BEFORE INSERT on this row.
  -- box_id_fk / shipment_line_id stay NULL: this is not a transit movement
  -- (live CHECK only requires them when either side is in_transit).
  -- lifecycle_action 'retain' is in the live CHECK list — do not invent values.
  INSERT INTO dflow.sample_movement (
    sample_id_fk,
    quantity,
    from_location_type,
    from_location_id,
    from_location_label,
    to_location_type,
    to_location_id,
    to_location_label,
    box_id_fk,
    shipment_line_id,
    lifecycle_action,
    actor_user,
    actor_role,
    actor_factory_id,
    idempotency_key,
    request_hash
  ) VALUES (
    NEW.sample_id_fk,
    v_remaining::integer,
    'office',
    NEW.from_location_id,
    NEW.from_location_label,
    'terminal',
    v_to_id,
    v_to_label,
    NULL,
    NULL,
    'retain',
    NEW.actor_user,
    NEW.actor_role,
    NEW.actor_factory_id,
    v_idem,
    v_idem
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sample_movement_auto_office_inventory_trigger
  ON dflow.sample_movement;

CREATE TRIGGER sample_movement_auto_office_inventory_trigger
  AFTER INSERT ON dflow.sample_movement
  FOR EACH ROW
  EXECUTE FUNCTION dflow.sample_movement_auto_office_inventory();

-- Fail-closed: browser roles must not call the trigger function directly.
REVOKE ALL ON FUNCTION dflow.sample_movement_auto_office_inventory()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION dflow.sample_movement_auto_office_inventory() IS
  'AFTER INSERT on sample_movement: when an office ships onward (to in_transit '
  'or customer), auto-moves any remaining office balance into terminal '
  '{office_id}_office_inventory with lifecycle_action=retain. Product rule '
  'confirmed 2026-07-23. Disable with DROP TRIGGER '
  'sample_movement_auto_office_inventory_trigger ON dflow.sample_movement.';

-- ============================================================================
-- OPTIONAL defence-in-depth (OMITTED)
-- ============================================================================
-- Recommendation: a BEFORE INSERT trigger on dflow.sample_stop_closeout that
-- refuses state='closed' while the same (sample, location_type, location_id)
-- still has a positive balance would match the tracking app's current
-- "balance == 0 before closeout" UI guard.
--
-- Why it is NOT shipped here:
--   1. Local closeout may still coexist with temporary office balance before
--      an onward ship (Defect B fixture / local handling semantics).
--   2. Defect B is already fixed above at the global-completion layer.
--   3. After an onward ship the auto-inventory trigger zeros the office
--      balance, so the common path already ends at zero office balance.
--
-- If product later decides "closeout requires zero local balance" strictly,
-- add a clearly named trigger function in a NEW timestamped migration and
-- keep it easy to DROP. Do not edit this file once applied.
-- ============================================================================

COMMIT;
