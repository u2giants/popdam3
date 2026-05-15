-- Remove parse_pdf_files_used loop from bulk insert RPC.
-- The sample flow just needs to store results fast. Files-used parsing
-- is handled by the backfill worker (TypeScript, per-batch, no timeout risk).
-- Root cause: SET LOCAL statement_timeout is ignored by PostgREST's connection-level timeout.
CREATE OR REPLACE FUNCTION bulk_insert_pdf_text_samples(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  -- Suppress the per-row trigger for this transaction
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  -- Clear existing sample rows (WHERE clause required by pg_safeupdate)
  DELETE FROM pdf_text_samples WHERE id IS NOT NULL;

  -- Insert all rows at once
  INSERT INTO pdf_text_samples (
    asset_id, filename, relative_path, extraction_method,
    extracted_text, page_count, char_count, extraction_error,
    thumbnail_url, sampled_at
  )
  SELECT
    NULLIF(elem->>'asset_id', '')::uuid,
    elem->>'filename',
    elem->>'relative_path',
    elem->>'extraction_method',
    NULLIF(elem->>'extracted_text', ''),
    (elem->>'page_count')::int,
    COALESCE((elem->>'char_count')::int, 0),
    NULLIF(elem->>'extraction_error', ''),
    NULLIF(elem->>'thumbnail_url', ''),
    now()
  FROM jsonb_array_elements(p_rows) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_insert_pdf_text_samples(jsonb) TO service_role;
