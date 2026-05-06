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
  -- Disable statement timeout for this bulk operation; it may touch tens of thousands of rows.
  SET LOCAL statement_timeout = 0;

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
