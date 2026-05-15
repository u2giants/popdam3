CREATE OR REPLACE FUNCTION find_ai_pdf_duplicates()
RETURNS TABLE (
  id uuid,
  filename text,
  relative_path text,
  thumbnail_url text,
  style_group_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    a.thumbnail_url,
    a.style_group_id
  FROM assets a
  WHERE a.file_type = 'ai'
    AND a.is_deleted = false
    AND EXISTS (
      SELECT 1 FROM assets p
      WHERE p.file_type = 'pdf'
        AND p.is_deleted = false
        -- Same directory (everything before the last slash, or empty string for root)
        AND regexp_replace(p.relative_path, '/[^/]*$', '') = regexp_replace(a.relative_path, '/[^/]*$', '')
        -- Same base filename, case-insensitive (strip final extension)
        AND lower(regexp_replace(p.filename, '\.[^.]+$', '')) = lower(regexp_replace(a.filename, '\.[^.]+$', ''))
    )
  ORDER BY a.relative_path;
$$;

GRANT EXECUTE ON FUNCTION find_ai_pdf_duplicates() TO service_role;
