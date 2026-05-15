CREATE OR REPLACE FUNCTION count_pdf_backfill_remaining()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT count(*)
  FROM assets a
  WHERE a.file_type = 'pdf'
    AND a.is_deleted = false
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$$;

GRANT EXECUTE ON FUNCTION count_pdf_backfill_remaining() TO service_role;
