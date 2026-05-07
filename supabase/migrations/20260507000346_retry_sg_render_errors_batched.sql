CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(
  p_file_ids uuid[] DEFAULT NULL,
  p_limit    int    DEFAULT 500
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids   uuid[];
  v_queued int;
BEGIN
  -- When called with explicit IDs, ignore p_limit (retrying specific files is always bounded).
  -- When called with no IDs, process at most p_limit files per call so each batch
  -- completes quickly and the client can loop until done.
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM (
    SELECT id
    FROM public.style_guide_files
    WHERE is_active
      AND thumbnail_url IS NULL
      AND thumbnail_error IS NOT NULL
      AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND (p_file_ids IS NULL OR id = ANY(p_file_ids))
    LIMIT CASE WHEN p_file_ids IS NULL THEN p_limit ELSE NULL END
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$$;
