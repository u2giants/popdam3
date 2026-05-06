-- Expand queue to accept native image types (was: pdf/ai/psd only)
CREATE OR REPLACE FUNCTION public.queue_sg_render_jobs_by_ids(p_file_ids uuid[])
RETURNS int
LANGUAGE sql
AS $$
  WITH inserted AS (
    INSERT INTO public.style_guide_render_queue (style_guide_file_id)
    SELECT t.id
    FROM unnest(p_file_ids) AS t(id)
    JOIN public.style_guide_files f ON f.id = t.id
    WHERE f.thumbnail_url IS NULL
      AND f.thumbnail_error IS NULL
      AND lower(f.file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND NOT EXISTS (
        SELECT 1 FROM public.style_guide_render_queue q
        WHERE q.style_guide_file_id = t.id
          AND q.status IN ('pending', 'claimed')
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

-- Update preview stats to classify image types as renderable (not unsupported)
CREATE OR REPLACE FUNCTION get_sg_preview_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH file_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active)                                                                                                                                                      AS total_active,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NOT NULL)                                                                                                                        AS has_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))       AS renderable_no_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))   AS render_errored,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND lower(file_extension) NOT IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))                               AS unsupported
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
$$;

-- Retry errored files: clears thumbnail_error then re-queues them
-- Pass p_file_ids to retry specific files, or NULL to retry all
CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_queued int;
BEGIN
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM public.style_guide_files
  WHERE is_active
    AND thumbnail_url IS NULL
    AND thumbnail_error IS NOT NULL
    AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
    AND (p_file_ids IS NULL OR id = ANY(p_file_ids));

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_sg_render_errors(uuid[]) TO authenticated;

-- Queue all existing image files that are renderable but have never been queued
INSERT INTO public.style_guide_render_queue (style_guide_file_id)
SELECT f.id
FROM public.style_guide_files f
WHERE f.is_active
  AND f.thumbnail_url IS NULL
  AND f.thumbnail_error IS NULL
  AND lower(f.file_extension) IN ('jpg', 'jpeg', 'png', 'tif', 'tiff')
  AND NOT EXISTS (
    SELECT 1 FROM public.style_guide_render_queue q
    WHERE q.style_guide_file_id = f.id
      AND q.status IN ('pending', 'claimed')
  );
