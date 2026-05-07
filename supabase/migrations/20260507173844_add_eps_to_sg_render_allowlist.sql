-- Add eps to the style guide render queue allowlist and preview stats function.
-- Previously only: pdf, ai, psd, jpg, jpeg, png, tif, tiff
-- 23,242 active EPS files were never queued because of the missing extension.

CREATE OR REPLACE FUNCTION public.queue_sg_render_jobs_by_ids(p_file_ids uuid[])
RETURNS integer
LANGUAGE sql
AS $function$
  WITH inserted AS (
    INSERT INTO public.style_guide_render_queue (style_guide_file_id)
    SELECT t.id
    FROM unnest(p_file_ids) AS t(id)
    JOIN public.style_guide_files f ON f.id = t.id
    WHERE f.thumbnail_url IS NULL
      AND f.thumbnail_error IS NULL
      AND lower(f.file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps')
      AND NOT EXISTS (
        SELECT 1 FROM public.style_guide_render_queue q
        WHERE q.style_guide_file_id = t.id
          AND q.status IN ('pending', 'claimed')
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$function$;

CREATE OR REPLACE FUNCTION public.get_sg_preview_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH file_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active)                                                                                                                                                      AS total_active,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NOT NULL)                                                                                                                        AS has_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps'))       AS renderable_no_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps'))   AS render_errored,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND lower(file_extension) NOT IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'eps'))                               AS unsupported
    FROM public.style_guide_files
  ),
  queue_stats AS (
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'claimed')) AS queued_now
    FROM public.style_guide_render_queue
  )
  SELECT json_build_object(
    'total_active',          fs.total_active,
    'has_preview',           fs.has_preview,
    'renderable_no_preview', fs.renderable_no_preview,
    'render_errored',        fs.render_errored,
    'unsupported',           fs.unsupported,
    'queued_now',            qs.queued_now
  )
  FROM file_stats fs, queue_stats qs;
$function$;
