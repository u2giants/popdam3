-- Extend PDF text backfill to also cover .ai files (which embed PDF streams when saved with
-- "Create PDF Compatible File" enabled; those without that option emit a sentinel string
-- that the ai_sentinel_cleanup job uses to identify and remove them).
-- .ai files are never thumbnailed during backfill (needs_thumbnail forced false) because
-- sentinel files will be deleted and we don't want to waste render jobs on them.

CREATE OR REPLACE FUNCTION claim_pdf_backfill_batch(p_limit int DEFAULT 25)
RETURNS TABLE (
  id              uuid,
  filename        text,
  relative_path   text,
  needs_thumbnail boolean
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    -- Never thumbnail .ai files during backfill; sentinel ones will be deleted.
    (a.thumbnail_url IS NULL AND a.file_type = 'pdf') AS needs_thumbnail
  FROM assets a
  WHERE a.file_type IN ('pdf', 'ai')
    AND a.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.file_type, a.id
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION count_pdf_backfill_remaining()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)
  FROM assets a
  WHERE a.file_type IN ('pdf', 'ai')
    AND a.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$$;

GRANT EXECUTE ON FUNCTION claim_pdf_backfill_batch(int) TO service_role;
GRANT EXECUTE ON FUNCTION count_pdf_backfill_remaining() TO service_role;
