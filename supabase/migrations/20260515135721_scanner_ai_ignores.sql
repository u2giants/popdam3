-- Permanent ignore list for .ai files the scanner should never ingest.
-- Populated at ingest time when:
--   1. A .pdf sibling with the same base name exists in the same directory, OR
--   2. The file contains the Adobe "saved without PDF Content" sentinel text.
-- The bridge agent loads this table at scan start and skips any matching path.
-- This table is permanent — it is the scanner's memory of files to ignore forever.
CREATE TABLE scanner_ai_ignores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relative_path text NOT NULL UNIQUE,
  reason        text NOT NULL, -- 'pdf_sibling' | 'no_pdf_compat'
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_scanner_ai_ignores_path ON scanner_ai_ignores(relative_path);

GRANT SELECT, INSERT ON scanner_ai_ignores TO service_role;
