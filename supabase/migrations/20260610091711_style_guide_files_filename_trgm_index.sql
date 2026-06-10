-- Trigram index to support fuzzy matching of OCR-noisy "files used" names against the
-- ~214k-row style-guide library. exact normalize_for_sg_match() misses OCR typos like
-- "Rock_graphics_14v" vs the real "Rock_graphics_14.ai". Also speeds future fuzzy resolves.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_style_guide_files_filename_trgm
  ON public.style_guide_files USING gin (lower(filename) gin_trgm_ops);
