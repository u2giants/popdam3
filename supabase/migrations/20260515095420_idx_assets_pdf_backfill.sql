-- Partial index: efficiently find PDF assets for the backfill claim query
CREATE INDEX IF NOT EXISTS idx_assets_pdf_not_deleted
  ON assets(file_type, id)
  WHERE is_deleted = false;
