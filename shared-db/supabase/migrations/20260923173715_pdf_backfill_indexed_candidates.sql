-- derived-from: 20260610070731, 20260813020000
-- #3282: retain the licensing-PDF contract while exposing the enum equality
-- and indexing only eligible candidates. No queue rows or privileges change.
-- Constant text avoids an enum-to-text cast in the immutable index predicate.
CREATE INDEX idx_assets_licensing_pdf_backfill_candidates
  ON public.assets (id)
  WHERE is_deleted = false
    AND file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', filename);

CREATE OR REPLACE FUNCTION public.claim_pdf_backfill_batch(p_limit integer DEFAULT 25)
RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT a.id, a.filename, a.relative_path, (a.thumbnail_url IS NULL)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM public.pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.count_pdf_backfill_remaining()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT count(*)
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.file_type = 'pdf'::public.file_type
    AND public.is_style_guide_source_pdf('pdf', a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM public.pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$function$;
