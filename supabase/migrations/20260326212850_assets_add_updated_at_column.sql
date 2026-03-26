-- The 2026-03-23 migration (assets_updated_at_trigger) added a trigger that sets
-- NEW.updated_at = now() on every UPDATE, but forgot to add the column.
-- This caused every asset UPDATE to fail with "record NEW has no field updated_at"
-- for 3 days, breaking scan ingestion, thumbnail updates, and all other writes.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
