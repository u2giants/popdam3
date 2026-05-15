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
    (a.thumbnail_url IS NULL) AS needs_thumbnail
  FROM assets a
  WHERE a.file_type = 'pdf'
    AND a.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION claim_pdf_backfill_batch(int) TO service_role;
