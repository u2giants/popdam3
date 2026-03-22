-- Add prepack_code and prepack_codes fields to erp_items_current
ALTER TABLE erp_items_current
  ADD COLUMN IF NOT EXISTS prepack_code text,
  ADD COLUMN IF NOT EXISTS prepack_codes jsonb;
