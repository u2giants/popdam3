-- Junction table: one row per (sku, file_name) pair
CREATE TABLE sku_files_used (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku        text NOT NULL,
  file_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku, file_name)
);
CREATE INDEX ON sku_files_used (sku);

-- RLS
ALTER TABLE sku_files_used ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON sku_files_used
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service role all" ON sku_files_used
  TO service_role USING (true) WITH CHECK (true);

-- Per-asset parsing function
CREATE OR REPLACE FUNCTION parse_pdf_files_used(p_asset_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_sku     text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
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

    -- Detect "Files Used", "Source Files", "Art Files", "Design Files" section headers
    IF v_trimmed ~* '^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:?\s*$' THEN
      v_in_sect := true;
      CONTINUE;
    END IF;

    IF v_in_sect THEN
      -- Stop at blank line or a new section header (text ending with colon)
      IF v_trimmed = '' OR v_trimmed ~ '^\S[^:]*:\s*$' THEN
        v_in_sect := false;
        CONTINUE;
      END IF;
      -- Skip pure numbers (page numbers) or single-char tokens
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

-- Backfill function: process all existing assets with text samples
CREATE OR REPLACE FUNCTION backfill_pdf_files_used()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_id    uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN (
    SELECT DISTINCT asset_id
    FROM pdf_text_samples
    WHERE asset_id IS NOT NULL
      AND extracted_text IS NOT NULL
      AND char_count > 100
  ) LOOP
    v_total := v_total + parse_pdf_files_used(v_id);
  END LOOP;
  RETURN v_total;
END;
$$;

-- Auto-trigger: parse whenever a new pdf_text_samples row is inserted
CREATE OR REPLACE FUNCTION trg_fn_parse_pdf_files_used()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_id IS NOT NULL AND NEW.extracted_text IS NOT NULL THEN
    PERFORM parse_pdf_files_used(NEW.asset_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pdf_text_samples_parse_files
AFTER INSERT ON pdf_text_samples
FOR EACH ROW EXECUTE FUNCTION trg_fn_parse_pdf_files_used();
