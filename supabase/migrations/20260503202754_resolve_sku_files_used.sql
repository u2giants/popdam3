-- FK from sku_files_used to style_guide_files (nullable — populated by resolution)
ALTER TABLE sku_files_used
  ADD COLUMN style_guide_file_id uuid REFERENCES public.style_guide_files(id) ON DELETE SET NULL;

CREATE INDEX ON sku_files_used(style_guide_file_id) WHERE style_guide_file_id IS NOT NULL;

-- Normalize helper: strip file extension, lowercase, remove non-alphanumeric
CREATE OR REPLACE FUNCTION normalize_for_sg_match(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(p, '\.[^.]+$', ''), '[^a-z0-9]', '', 'g'))
$$;

-- Batch-resolve unmatched rows against style_guide_files; returns count resolved
CREATE OR REPLACE FUNCTION resolve_sku_files_used()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  UPDATE sku_files_used u
  SET style_guide_file_id = (
    SELECT s.id
    FROM style_guide_files s
    WHERE s.is_active = true
      AND normalize_for_sg_match(s.filename) = normalize_for_sg_match(u.file_name)
    ORDER BY s.modified_at DESC NULLS LAST
    LIMIT 1
  )
  WHERE style_guide_file_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Auto-resolve on insert (BEFORE so we set the FK before the row is written)
CREATE OR REPLACE FUNCTION trg_fn_resolve_sku_file_used()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.style_guide_file_id IS NULL THEN
    SELECT id INTO NEW.style_guide_file_id
    FROM style_guide_files
    WHERE is_active = true
      AND normalize_for_sg_match(filename) = normalize_for_sg_match(NEW.file_name)
    ORDER BY modified_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_resolve_sku_file_used
BEFORE INSERT ON sku_files_used
FOR EACH ROW EXECUTE FUNCTION trg_fn_resolve_sku_file_used();

-- Backfill any rows that already exist
SELECT resolve_sku_files_used();
