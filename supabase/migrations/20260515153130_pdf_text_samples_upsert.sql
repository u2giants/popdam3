-- Add unique constraint on asset_id so per-asset upserts work.
-- NULLs remain unconstrained (multiple NULL asset_ids are allowed).
ALTER TABLE pdf_text_samples
  ADD CONSTRAINT pdf_text_samples_asset_id_unique UNIQUE (asset_id);

-- Replace full-replace RPC with upsert semantics so sentinel scan results
-- accumulate alongside regular sample runs instead of wiping each other out.
CREATE OR REPLACE FUNCTION bulk_insert_pdf_text_samples(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

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
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (asset_id) DO UPDATE SET
    filename          = EXCLUDED.filename,
    relative_path     = EXCLUDED.relative_path,
    extraction_method = EXCLUDED.extraction_method,
    extracted_text    = EXCLUDED.extracted_text,
    page_count        = EXCLUDED.page_count,
    char_count        = EXCLUDED.char_count,
    extraction_error  = EXCLUDED.extraction_error,
    thumbnail_url     = EXCLUDED.thumbnail_url,
    sampled_at        = EXCLUDED.sampled_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_insert_pdf_text_samples(jsonb) TO service_role;
