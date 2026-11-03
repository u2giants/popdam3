-- derived-from: 20261103142609
-- Owner decision 2026-11-03: "sheet designer names should replace existing ones".
-- A usable sheet value overwrites assets.designer_name / technical_designer_name.
-- A blank or junk reading never erases. The first-seen values are kept for undo.

CREATE TABLE IF NOT EXISTS public.asset_designer_sheet_backup (
  asset_id uuid PRIMARY KEY,
  designer_name text,
  technical_designer_name text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.asset_designer_sheet_backup IS
  'First-seen asset designer values before a licensing sheet replaced them. Undo source; safe to retire once the change is accepted.';
ALTER TABLE public.asset_designer_sheet_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_designer_sheet_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.asset_designer_sheet_backup TO service_role;

CREATE OR REPLACE FUNCTION public.apply_sheet_designers(p_asset_id uuid, p_creative text, p_technical text, OUT c integer, OUT t integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_creative text := NULLIF(btrim(p_creative), '');
  v_technical text := NULLIF(btrim(p_technical), '');
  v_cur public.assets%ROWTYPE;
BEGIN
  c := 0; t := 0;
  -- Second line of defence behind the parser's own checks.
  IF lower(v_creative) = 'null' OR v_creative !~ '[[:alpha:]]{2}' THEN v_creative := NULL; END IF;
  IF lower(v_technical) = 'null' OR v_technical !~ '[[:alpha:]]{2}' THEN v_technical := NULL; END IF;

  SELECT * INTO v_cur FROM public.assets a WHERE a.id = p_asset_id;
  IF NOT FOUND OR NOT public.is_style_guide_source_pdf(v_cur.file_type::text, v_cur.filename) THEN RETURN; END IF;

  IF v_creative IS NOT NULL AND v_cur.designer_name IS DISTINCT FROM v_creative THEN c := 1; END IF;
  IF v_technical IS NOT NULL AND v_cur.technical_designer_name IS DISTINCT FROM v_technical THEN t := 1; END IF;
  IF c = 0 AND t = 0 THEN RETURN; END IF;

  INSERT INTO public.asset_designer_sheet_backup (asset_id, designer_name, technical_designer_name)
  VALUES (p_asset_id, v_cur.designer_name, v_cur.technical_designer_name)
  ON CONFLICT (asset_id) DO NOTHING;

  UPDATE public.assets a SET
    designer_name = CASE WHEN c = 1 THEN v_creative ELSE a.designer_name END,
    technical_designer_name = CASE WHEN t = 1 THEN v_technical ELSE a.technical_designer_name END
  WHERE a.id = p_asset_id;
END;
$function$;

-- Files the rescan already processed. Call repeatedly until it returns examined = 0.
CREATE OR REPLACE FUNCTION public.backfill_pdf_sheet_designers(p_after uuid, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  r record;
  v_c int; v_t int;
  v_examined int := 0; v_creative int := 0; v_technical int := 0;
  v_last uuid := p_after;
BEGIN
  FOR r IN
    SELECT p.asset_id, p.extracted_fields f
    FROM public.pdf_text_samples p
    WHERE p.indra_rescan_outcome = 'replaced'
      AND p.extracted_fields IS NOT NULL
      AND (p_after IS NULL OR p.asset_id > p_after)
    ORDER BY p.asset_id
    LIMIT p_limit
  LOOP
    SELECT c, t INTO v_c, v_t FROM public.apply_sheet_designers(
      r.asset_id, r.f->>'creative_designer', r.f->>'technical_designer');
    v_creative := v_creative + v_c;
    v_technical := v_technical + v_t;
    v_examined := v_examined + 1;
    v_last := r.asset_id;
  END LOOP;
  RETURN jsonb_build_object('examined', v_examined, 'creative_changed', v_creative, 'technical_changed', v_technical, 'last_asset_id', v_last);
END;
$function$;

-- Same as 20261103142609 except designer writes go through apply_sheet_designers.
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
  v_creative int := 0; v_technical int := 0; v_files int := 0; v_n int; v_m int;
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

    SELECT c, t INTO v_n, v_m FROM public.apply_sheet_designers(
      r.asset_id, r.e->'fields'->>'creative_designer', r.e->'fields'->>'technical_designer');
    v_creative := v_creative + v_n;
    v_technical := v_technical + v_m;

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


REVOKE ALL ON FUNCTION public.apply_sheet_designers(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_pdf_sheet_designers(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sheet_designers(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_pdf_sheet_designers(uuid, integer) TO service_role;
