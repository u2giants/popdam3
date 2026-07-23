-- Enforce one current box-membership row per (sample, box) in the dflow runtime.
--
-- Why: designflow-tracking treats dflow.sample_shipment_item as CURRENT box
-- membership. Its factory->NYC authorization proof (sample.model.js
-- proveFactoryToNyc) reads a single membership for (sample_id_fk, box_id_fk,
-- leg_type) and its own comment states:
--   "A future DB unique constraint on (sample_id_fk, box_id_fk) will make
--    membership unambiguous; until then persisted row existence is the proof."
-- The application already runs a transaction-wrapped existence check and treats
-- retries idempotently, but two concurrent transactions can both observe no row
-- and both insert. The database constraint is the definitive safeguard
-- (fix_sample_tracking_schema.md sections 3.3 and 5.1).
--
-- Safety: standard SQL UNIQUE treats NULLs as distinct, so this constrains only
-- rows that are actually in a box (box_id_fk NOT NULL); a membership with no box
-- yet is unaffected. box_id_fk is intentionally left NULLable to preserve the
-- existing app contract (a shipment item may be created before a box is
-- assigned).
--
-- Verified before authoring (read-only, 2026-07-22): zero duplicate
-- (sample_id_fk, box_id_fk) groups exist on preview or production, and the
-- restored dflow table starts empty. The guard below is defence-in-depth: if a
-- duplicate ever exists at apply time it ABORTS loudly with a count rather than
-- letting Postgres emit a bare constraint error or silently skipping the
-- constraint. Per the plan, duplicates must be audited and reconciled by a
-- separate approved migration -- never a blind row-number delete -- before this
-- constraint can be added.

BEGIN;

DO $$
DECLARE
  v_dupe_groups integer;
BEGIN
  SELECT count(*) INTO v_dupe_groups
  FROM (
    SELECT 1
    FROM dflow.sample_shipment_item
    WHERE box_id_fk IS NOT NULL
    GROUP BY sample_id_fk, box_id_fk
    HAVING count(*) > 1
  ) AS d;

  IF v_dupe_groups > 0 THEN
    RAISE EXCEPTION
      'Refusing to add UNIQUE(sample_id_fk, box_id_fk): % duplicate membership group(s) found in dflow.sample_shipment_item. Run the duplicate audit and reconcile with an approved migration before adding this constraint.',
      v_dupe_groups;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'dflow.sample_shipment_item'::regclass
      AND conname = 'sample_shipment_item_sample_box_uniq'
  ) THEN
    ALTER TABLE dflow.sample_shipment_item
      ADD CONSTRAINT sample_shipment_item_sample_box_uniq
      UNIQUE (sample_id_fk, box_id_fk);
  END IF;
END $$;

COMMIT;
