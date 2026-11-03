-- derived-from: 20260515110538, 20260923173715
-- Indra OCR rescan of every PopDAM PDF, with field extraction. Additive only.
-- Existing text is copied to pdf_text_samples_backup, in the same transaction,
-- before a rescan replaces it. Empty or near-empty OCR never replaces text.

ALTER TABLE public.pdf_text_samples
  ADD COLUMN IF NOT EXISTS ocr_engine text,
  ADD COLUMN IF NOT EXISTS extracted_fields jsonb,
  ADD COLUMN IF NOT EXISTS indra_rescan_at timestamptz,
  ADD COLUMN IF NOT EXISTS indra_rescan_outcome text,
  ADD COLUMN IF NOT EXISTS indra_rescan_error text;

COMMENT ON COLUMN public.pdf_text_samples.ocr_engine IS
  'Engine that produced extracted_text: indra, tesseract, ai_vision or embedded. NULL only on rows written before this column existed.';
COMMENT ON COLUMN public.pdf_text_samples.extracted_fields IS
  'Fields parsed from the sheet text by the PopDAM agent-api parser. Blank fields are JSON null.';
COMMENT ON COLUMN public.pdf_text_samples.indra_rescan_outcome IS
  'replaced, kept_existing (OCR empty, under 100 characters against 100 or more stored, or under a quarter of 500 or more stored) or failed (file unreadable; stored text kept).';

CREATE TABLE IF NOT EXISTS public.pdf_text_samples_backup (
  asset_id uuid PRIMARY KEY,
  filename text,
  relative_path text,
  extraction_method text,
  extracted_text text,
  page_count integer,
  char_count integer,
  extraction_error text,
  thumbnail_url text,
  sampled_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pdf_text_samples_backup IS
  'First-seen copy of pdf_text_samples rows, taken before the Indra rescan replaced them. Restore source; safe to retire after the rescan is accepted.';
ALTER TABLE public.pdf_text_samples_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdf_text_samples_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.pdf_text_samples_backup TO service_role;

CREATE INDEX IF NOT EXISTS idx_assets_pdf_rescan_candidates
  ON public.assets (id)
  WHERE is_deleted = false AND file_type = 'pdf'::public.file_type;

-- Same body as 20260515110538 plus ocr_engine.
CREATE OR REPLACE FUNCTION public.bulk_insert_pdf_text_samples(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  INSERT INTO pdf_text_samples (
    asset_id, filename, relative_path, extraction_method,
    extracted_text, page_count, char_count, extraction_error,
    thumbnail_url, sampled_at, ocr_engine
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
    now(),
    NULLIF(elem->>'ocr_engine', '')
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
    sampled_at        = EXCLUDED.sampled_at,
    ocr_engine        = EXCLUDED.ocr_engine;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Licensing sheets and tech packs first, then every other PDF.
-- Non-locking: PDF_BACKFILL routing gives the rescan to one agent.
CREATE OR REPLACE FUNCTION public.claim_pdf_rescan_batch(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN QUERY
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL)
  ORDER BY a.id LIMIT p_limit;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL)
  ORDER BY a.id LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_pdf_rescan_remaining()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT count(*)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND NOT EXISTS (SELECT 1 FROM public.pdf_text_samples p
                    WHERE p.asset_id = a.id AND p.indra_rescan_at IS NOT NULL);
$function$;

-- Row shape: asset_id, filename, relative_path, extracted_text, page_count,
-- thumbnail_url, error, fields { creative_designer, technical_designer, files_used[] ... }.
-- Designer columns are filled only when blank; sheet/asset differences stay visible
-- by comparing extracted_fields with the assets row.
CREATE OR REPLACE FUNCTION public.commit_pdf_rescan_batch(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  r record;
  v_old public.pdf_text_samples%ROWTYPE;
  v_text text;
  v_len int;
  v_old_len int;
  v_replace boolean;
  v_outcome text;
  v_replaced int := 0; v_kept int := 0; v_failed int := 0;
  v_creative int := 0; v_technical int := 0; v_files int := 0; v_n int;
  v_sku text; v_ftype text; v_fname text; v_file text;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  FOR r IN
    SELECT (e->>'asset_id')::uuid AS asset_id, e FROM jsonb_array_elements(p_rows) e
  LOOP
    v_old := NULL;
    SELECT * INTO v_old FROM public.pdf_text_samples p WHERE p.asset_id = r.asset_id;

    IF v_old.asset_id IS NOT NULL THEN
      INSERT INTO public.pdf_text_samples_backup (
        asset_id, filename, relative_path, extraction_method, extracted_text,
        page_count, char_count, extraction_error, thumbnail_url, sampled_at)
      VALUES (v_old.asset_id, v_old.filename, v_old.relative_path, v_old.extraction_method,
        v_old.extracted_text, v_old.page_count, v_old.char_count, v_old.extraction_error,
        v_old.thumbnail_url, v_old.sampled_at)
      ON CONFLICT (asset_id) DO NOTHING;
    END IF;

    v_text := NULLIF(btrim(r.e->>'extracted_text'), '');
    v_len := COALESCE(length(v_text), 0);
    v_old_len := COALESCE(length(v_old.extracted_text), 0);
    v_replace := v_len > 0 AND NOT (
      (v_len < 100 AND v_old_len >= 100) OR (v_old_len >= 500 AND v_len < v_old_len / 4));
    v_outcome := CASE WHEN v_replace THEN 'replaced'
                      WHEN NULLIF(r.e->>'error', '') IS NOT NULL THEN 'failed'
                      ELSE 'kept_existing' END;

    IF v_old.asset_id IS NULL THEN
      INSERT INTO public.pdf_text_samples (
        asset_id, filename, relative_path, extraction_method, extracted_text, page_count,
        char_count, extraction_error, thumbnail_url, sampled_at, ocr_engine, extracted_fields,
        indra_rescan_at, indra_rescan_outcome, indra_rescan_error)
      VALUES (r.asset_id, r.e->>'filename', r.e->>'relative_path',
        CASE WHEN v_replace THEN 'ocr_text' ELSE 'failed' END,
        CASE WHEN v_replace THEN v_text END, NULLIF(r.e->>'page_count', '')::int,
        CASE WHEN v_replace THEN v_len ELSE 0 END, NULLIF(r.e->>'error', ''),
        NULLIF(r.e->>'thumbnail_url', ''), now(), CASE WHEN v_replace THEN 'indra' END,
        CASE WHEN v_replace THEN r.e->'fields' END,
        now(), v_outcome, NULLIF(r.e->>'error', ''));
    ELSIF v_replace THEN
      UPDATE public.pdf_text_samples p SET
        filename = COALESCE(NULLIF(r.e->>'filename', ''), p.filename),
        relative_path = COALESCE(NULLIF(r.e->>'relative_path', ''), p.relative_path),
        extraction_method = 'ocr_text',
        extracted_text = v_text,
        page_count = COALESCE(NULLIF(r.e->>'page_count', '')::int, p.page_count),
        char_count = v_len,
        extraction_error = NULL,
        thumbnail_url = COALESCE(NULLIF(r.e->>'thumbnail_url', ''), p.thumbnail_url),
        sampled_at = now(),
        ocr_engine = 'indra',
        extracted_fields = r.e->'fields',
        indra_rescan_at = now(),
        indra_rescan_outcome = v_outcome,
        indra_rescan_error = NULL
      WHERE p.asset_id = r.asset_id;
    ELSE
      -- Stored text is untouched, so the search-document trigger does not fire.
      UPDATE public.pdf_text_samples p SET
        indra_rescan_at = now(),
        indra_rescan_outcome = v_outcome,
        indra_rescan_error = NULLIF(r.e->>'error', '')
      WHERE p.asset_id = r.asset_id;
    END IF;

    IF v_outcome = 'replaced' THEN v_replaced := v_replaced + 1;
    ELSIF v_outcome = 'failed' THEN v_failed := v_failed + 1;
    ELSE v_kept := v_kept + 1; END IF;

    CONTINUE WHEN NOT v_replace;

    SELECT a.sku, a.file_type::text, a.filename INTO v_sku, v_ftype, v_fname
    FROM public.assets a WHERE a.id = r.asset_id;
    CONTINUE WHEN NOT public.is_style_guide_source_pdf(v_ftype, v_fname);

    UPDATE public.assets a SET designer_name = r.e->'fields'->>'creative_designer'
    WHERE a.id = r.asset_id AND NULLIF(btrim(a.designer_name), '') IS NULL
      AND NULLIF(btrim(r.e->'fields'->>'creative_designer'), '') IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_creative := v_creative + v_n;

    UPDATE public.assets a SET technical_designer_name = r.e->'fields'->>'technical_designer'
    WHERE a.id = r.asset_id AND NULLIF(btrim(a.technical_designer_name), '') IS NULL
      AND NULLIF(btrim(r.e->'fields'->>'technical_designer'), '') IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_technical := v_technical + v_n;

    IF NULLIF(btrim(v_sku), '') IS NOT NULL
       AND jsonb_typeof(r.e->'fields'->'files_used') = 'array' THEN
      FOR v_file IN SELECT jsonb_array_elements_text(r.e->'fields'->'files_used') LOOP
        CONTINUE WHEN NOT public.is_plausible_source_file_name(v_file);
        INSERT INTO public.sku_files_used (sku, file_name, source)
        VALUES (v_sku, v_file, 'pdf_text')
        ON CONFLICT (sku, file_name) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT; v_files := v_files + v_n;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('replaced', v_replaced, 'kept_existing', v_kept, 'failed', v_failed,
    'designers_filled', v_creative, 'technical_designers_filled', v_technical, 'files_used_added', v_files);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pdf_rescan_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_pdf_rescan_remaining() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_pdf_rescan_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pdf_rescan_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_pdf_rescan_remaining() TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_pdf_rescan_batch(jsonb) TO service_role;
