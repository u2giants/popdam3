CREATE OR REPLACE FUNCTION get_sg_preview_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH file_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active)                                                                                                             AS total_active,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NOT NULL)                                                                               AS has_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd'))     AS renderable_no_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd')) AS render_errored,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND lower(file_extension) NOT IN ('pdf', 'ai', 'psd'))                             AS unsupported
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

GRANT EXECUTE ON FUNCTION get_sg_preview_stats() TO authenticated;
