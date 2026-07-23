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
--     disappears from open work, and global_status falls through to
--     'complete' while physical pieces remain. Global completion must not be
--     reachable while ANY non-terminal physical balance remains, independent
--     of closeouts. Closeouts govern LOCAL handling-work done only
--     (fix_sample_tracking_schema.md §1: "not globally complete until no
--     piece remains in transit or otherwise unresolved"; §4 decision 8;
--     §5.6).
--
-- sample_open_stop_work is intentionally left unchanged: it remains the local
-- "handling work still open" read model. Global completion is no longer
-- derived solely from that view.
--
-- ============================================================================
-- PRODUCT BOUNDARY — plan §15 Q4 is OPEN (do not silently re-decide later)
-- ============================================================================
-- Question: which retained / held dispositions count as globally "complete"
-- versus still "outstanding"?
--
-- Interpretation SHIPPED in this migration (conservative, plan-literal):
--   * Only balances in location_type = 'terminal' are treated as resolved
--     (created source sink, delivered, disposed, lost, returned, etc.).
--   * Any positive balance in 'in_transit', 'factory', or 'office' keeps the
--     sample 'outstanding' (or 'in_transit' when transit is present).
--   * Positive balance at 'customer' ALSO keeps the sample 'outstanding'
--     under the same conservative reading (customer-held is not terminal).
--   * Office-retained pieces therefore remain globally outstanding even when
--     the local stop is closed — matching the existing quantity-contract
--     expectation and plan §5.4 ("Retention is a balance at the physical
--     location plus local closeout; it is not a fake terminal movement
--     unless the business explicitly classifies the retained piece as
--     terminal").
--
-- How to flip the product decision later (ONE obvious place):
--   Edit the CASE branch labelled "§15 Q4 — customer-held balance" below.
--   To treat customer-held as globally complete, remove that branch (or make
--   its predicate always false). To treat office-retained as complete, remove
--   'office' from the non-terminal physical-balance branch above it — but
--   that would reverse plan §5.4 and the four-piece outstanding expectation,
--   so do not do it without explicit product sign-off.
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

    -- Defect B + plan §1/§5.4: non-terminal physical balances always block
    -- global completion, independent of local stop closeouts.
    -- 'factory' and 'office' are hard-coded unresolved (not Q4-flip targets
    -- without product sign-off). 'terminal' is never listed here.
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk = s.sample_id_pk
        AND b.quantity > 0
        AND b.location_type IN ('factory', 'office')
    ) THEN 'outstanding'

    -- =====================================================================
    -- §15 Q4 — customer-held balance (PRODUCT DECISION FLIP POINT)
    -- SHIPPED interpretation: customer-held counts as still outstanding
    -- (conservative / plan-literal: only 'terminal' is resolved).
    -- To treat customer-held as globally complete instead, delete this
    -- entire WHEN branch (or replace the predicate with FALSE).
    -- =====================================================================
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_balance_by_location b
      WHERE b.sample_id_fk = s.sample_id_pk
        AND b.quantity > 0
        AND b.location_type = 'customer'
    ) THEN 'outstanding'

    -- Local handling work still open (unchanged open_stop_work semantics).
    WHEN EXISTS (
      SELECT 1
      FROM dflow.sample_open_stop_work o
      WHERE o.sample_id_fk = s.sample_id_pk
    ) THEN 'outstanding'

    -- All units resolved to terminal locations (or fully conserved with no
    -- non-terminal remainder) and no open local stop work.
    ELSE 'complete'
  END AS derived_status
FROM dflow.sample s;

-- Preserve the fail-closed browser grants from the original read-model migration.
REVOKE ALL ON dflow.sample_global_status FROM anon, authenticated;

COMMENT ON VIEW dflow.sample_global_status IS
  'Derived global sample completion. Authority is movement balances, not '
  'legacy sample.status. Plan §15 Q4 shipped conservative: only terminal '
  'balances are resolved; factory/office/customer/in_transit block complete. '
  'Customer-held is the single flip point in the view definition.';

-- ============================================================================
-- OPTIONAL defence-in-depth (OMITTED)
-- ============================================================================
-- Recommendation: a BEFORE INSERT trigger on dflow.sample_stop_closeout that
-- refuses state='closed' while the same (sample, location_type, location_id)
-- still has a positive balance would match the tracking app's current
-- "balance == 0 before closeout" UI guard.
--
-- Why it is NOT shipped here:
--   1. Plan §5.4/§5.6 explicitly allow retention as a positive balance AT the
--      physical location PLUS a local closeout — the trigger would reject the
--      planned retain-and-close path.
--   2. Defect B is already fixed above at the global-completion layer; a
--      closeout that coexists with a retained office balance no longer makes
--      the sample look globally complete.
--   3. Adding the trigger would hard-code the app's current (and possibly
--      temporary) guard into the database without product confirmation.
--
-- If product later decides "closeout requires zero local balance" (i.e.
-- retention must move pieces to a terminal disposition first), add a clearly
-- named trigger function in a NEW timestamped migration and keep it easy to
-- DROP. Do not edit this file once applied.
-- ============================================================================

COMMIT;
