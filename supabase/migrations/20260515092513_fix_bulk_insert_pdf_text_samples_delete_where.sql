CREATE OR REPLACE FUNCTION bulk_insert_pdf_text_samples(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count  int;
  v_id     uuid;
BEGIN
  -- Suppress the per-row trigger for this transaction
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  -- pg_safeupdate requires a WHERE clause on DELETE
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

  -- Call parse once per unique asset_id after all rows are visible
  FOR v_id IN
    SELECT DISTINCT asset_id
    FROM pdf_text_samples
    WHERE asset_id IS NOT NULL AND extracted_text IS NOT NULL
  LOOP
    PERFORM parse_pdf_files_used(v_id);
  END LOOP;

  RETURN v_count;
END;
$$;
