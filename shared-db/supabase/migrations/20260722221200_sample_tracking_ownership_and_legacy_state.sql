-- Sample Tracking quantity rollout: durable box ownership and explicit legacy state.
BEGIN;

ALTER TABLE dflow.sample_box
  ADD COLUMN IF NOT EXISTS owner_factory_id_fk integer,
  ADD COLUMN IF NOT EXISTS ownership_state text NOT NULL DEFAULT 'unassigned';

ALTER TABLE dflow.sample
  ADD COLUMN IF NOT EXISTS quantity_migration_state text NOT NULL DEFAULT 'unknown';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='dflow.sample_box'::regclass AND conname='sample_box_ownership_state_check') THEN
    ALTER TABLE dflow.sample_box ADD CONSTRAINT sample_box_ownership_state_check
      CHECK (ownership_state IN ('owned','internal','ambiguous','unassigned'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='dflow.sample'::regclass AND conname='sample_quantity_migration_state_check') THEN
    ALTER TABLE dflow.sample ADD CONSTRAINT sample_quantity_migration_state_check
      CHECK (quantity_migration_state IN ('unknown','known','reconciled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='dflow.sample_box'::regclass AND conname='sample_box_owner_factory_fkey') THEN
    ALTER TABLE dflow.sample_box ADD CONSTRAINT sample_box_owner_factory_fkey
      FOREIGN KEY (owner_factory_id_fk) REFERENCES dflow.vendor(vendor_id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sample_box_owner_factory_idx ON dflow.sample_box(owner_factory_id_fk);
CREATE INDEX IF NOT EXISTS sample_quantity_migration_state_idx ON dflow.sample(quantity_migration_state);

-- Existing boxes are empty in both environments at inventory time. Never infer an
-- owner for later ambiguous legacy data; the service must stamp owned/internal.
UPDATE dflow.sample_box SET ownership_state='owned'
WHERE owner_factory_id_fk IS NOT NULL AND ownership_state='unassigned';

COMMIT;
