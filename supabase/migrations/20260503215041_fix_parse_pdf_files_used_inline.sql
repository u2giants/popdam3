-- Fix: handle "FILES USED: file1, file2" inline format (all on one line after the colon).
-- Original regex required the header to be on its own line ($), so it never matched.
CREATE OR REPLACE FUNCTION public.parse_pdf_files_used(p_asset_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_sku     text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
BEGIN
  SELECT sku INTO v_sku FROM assets WHERE id = p_asset_id;
  IF v_sku IS NULL OR v_sku = '' THEN RETURN 0; END IF;

  SELECT extracted_text INTO v_text
  FROM pdf_text_samples
  WHERE asset_id = p_asset_id AND extracted_text IS NOT NULL
  ORDER BY sampled_at DESC LIMIT 1;
  IF v_text IS NULL THEN RETURN 0; END IF;

  v_lines := string_to_array(v_text, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_trimmed := trim(v_line);

    -- Detect section header; capture any inline content after the colon
    IF v_trimmed ~* '^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:' THEN
      v_in_sect := true;
      v_inline := trim(regexp_replace(v_trimmed, '(?i)^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:\s*', ''));
      IF v_inline <> '' THEN
        -- Comma-separated entries on the same line
        FOREACH v_entry IN ARRAY string_to_array(v_inline, ',') LOOP
          v_entry := trim(v_entry);
          IF v_entry <> '' AND length(v_entry) >= 2 AND NOT v_entry ~ '^\d+$' THEN
            INSERT INTO sku_files_used (sku, file_name)
            VALUES (v_sku, v_entry)
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
      INSERT INTO sku_files_used (sku, file_name)
      VALUES (v_sku, v_trimmed)
      ON CONFLICT (sku, file_name) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
