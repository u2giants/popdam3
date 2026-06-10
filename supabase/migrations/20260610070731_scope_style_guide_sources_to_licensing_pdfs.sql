-- Style Guide Sources (sku_files_used) must be derived ONLY from licensing-sheet /
-- tech-pack PDFs. Previously every PDF *and* every .ai file fed the "Files Used"
-- parser, and the AI-tagging vision path wrote rows from any tagged artwork. Per
-- product decision (2026-06-10): the only file that should be checked for style
-- guide asset/file names is a PDF whose name contains 'licensing sheet',
-- 'license sheet', 'tech pack', or 'techpack'. The .ai files carry the same data
-- but are far harder to extract, so they are dropped from this path.
--
-- This migration:
--   1. adds a shared predicate is_style_guide_source_pdf(file_type, filename)
--   2. adds a `source` provenance column and marks all pre-gating rows 'legacy_ungated'
--   3. scopes the PDF backfill claim + remaining-count to those PDFs only
--   4. gates parse_pdf_files_used() to those PDFs and stamps source='pdf_text'
--
-- The TS write paths (agent-api complete-pdf-backfill-batch JS parse, and ai-tag)
-- are gated to the same predicate in code, in the same commit.
--
-- Legacy rows are retained for manual double-checking and can be deleted once
-- verified:  DELETE FROM sku_files_used WHERE source = 'legacy_ungated';

-- 1. Shared predicate ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_style_guide_source_pdf(p_file_type text, p_filename text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_file_type = 'pdf' AND p_filename IS NOT NULL AND (
    p_filename ILIKE '%licensing sheet%' OR p_filename ILIKE '%licensing_sheet%' OR
    p_filename ILIKE '%license sheet%'   OR p_filename ILIKE '%license_sheet%'   OR
    p_filename ILIKE '%tech pack%'       OR p_filename ILIKE '%tech_pack%'       OR
    p_filename ILIKE '%techpack%'
  );
$function$;

-- 2. Provenance column --------------------------------------------------------
ALTER TABLE public.sku_files_used ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.sku_files_used.source IS
  'Provenance: pdf_text = parsed from a licensing/tech-pack PDF; ai_tag = AI vision of a '
  'licensing/tech-pack PDF; legacy_ungated = created before 2026-06-10 gating from any asset. '
  'Delete legacy rows once verified: DELETE FROM sku_files_used WHERE source = ''legacy_ungated''.';

UPDATE public.sku_files_used SET source = 'legacy_ungated' WHERE source IS NULL;

-- 3. Scope the backfill claim + count to licensing/tech-pack PDFs only ---------
CREATE OR REPLACE FUNCTION public.claim_pdf_backfill_batch(p_limit integer DEFAULT 25)
RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    (a.thumbnail_url IS NULL) AS needs_thumbnail
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.count_pdf_backfill_remaining()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT COUNT(*)
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$function$;

-- 4. Gate parse_pdf_files_used() + stamp provenance ---------------------------
CREATE OR REPLACE FUNCTION public.parse_pdf_files_used(p_asset_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sku     text;
  v_ftype   text;
  v_fname   text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
BEGIN
  SELECT sku, file_type::text, filename INTO v_sku, v_ftype, v_fname FROM assets WHERE id = p_asset_id;
  IF v_sku IS NULL OR v_sku = '' THEN RETURN 0; END IF;

  -- Style Guide Sources are parsed ONLY from licensing-sheet / tech-pack PDFs.
  IF NOT public.is_style_guide_source_pdf(v_ftype, v_fname) THEN RETURN 0; END IF;

  SELECT extracted_text INTO v_text
  FROM pdf_text_samples
  WHERE asset_id = p_asset_id AND extracted_text IS NOT NULL
  ORDER BY sampled_at DESC LIMIT 1;
  IF v_text IS NULL THEN RETURN 0; END IF;

  v_lines := string_to_array(v_text, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_trimmed := trim(v_line);

    IF v_trimmed ~* '^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:' THEN
      v_in_sect := true;
      v_inline := trim(regexp_replace(v_trimmed, '(?i)^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:\s*', ''));
      IF v_inline <> '' THEN
        FOREACH v_entry IN ARRAY string_to_array(v_inline, ',') LOOP
          v_entry := trim(v_entry);
          IF v_entry <> '' AND length(v_entry) >= 2 AND NOT v_entry ~ '^\d+$' THEN
            INSERT INTO sku_files_used (sku, file_name, source)
            VALUES (v_sku, v_entry, 'pdf_text')
            ON CONFLICT (sku, file_name) DO NOTHING;
            v_count := v_count + 1;
          END IF;
        END LOOP;
        v_in_sect := false;
      END IF;
      CONTINUE;
    END IF;

    IF v_in_sect THEN
      IF v_trimmed = '' OR v_trimmed ~ '^\S[^:]*:\s*$' THEN
        v_in_sect := false;
        CONTINUE;
      END IF;
      IF v_trimmed ~ '^\d+$' OR length(v_trimmed) < 2 THEN CONTINUE; END IF;
      INSERT INTO sku_files_used (sku, file_name, source)
      VALUES (v_sku, v_trimmed, 'pdf_text')
      ON CONFLICT (sku, file_name) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
