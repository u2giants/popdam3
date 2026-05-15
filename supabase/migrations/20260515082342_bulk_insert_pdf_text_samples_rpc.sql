-- Modified trigger: skip per-row parse when bulk RPC is in use
CREATE OR REPLACE FUNCTION trg_fn_parse_pdf_files_used()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow bulk-insert RPC to suppress this per-row trigger via session variable
  IF current_setting('app.skip_parse_pdf_trigger', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.asset_id IS NOT NULL AND NEW.extracted_text IS NOT NULL THEN
    PERFORM parse_pdf_files_used(NEW.asset_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Bulk insert RPC: clears old rows, inserts all new rows in one shot,
-- then calls parse_pdf_files_used once per unique asset_id.
CREATE OR REPLACE FUNCTION bulk_insert_pdf_text_samples(p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count  int;
  v_id     uuid;
BEGIN
  -- Suppress the per-row trigger for this transaction
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  -- Clear existing sample rows
  DELETE FROM pdf_text_samples;

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

  -- Now call parse once per unique asset_id (after all rows are visible)
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

GRANT EXECUTE ON FUNCTION bulk_insert_pdf_text_samples(jsonb) TO service_role;
