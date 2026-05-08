-- Batch the requeue so each call stays within the proxy statement timeout.
-- Client loops calling with p_limit=500 until it returns 0.
CREATE OR REPLACE FUNCTION public.requeue_all_failed_sg_jobs(p_limit int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.style_guide_render_queue
  SET
    status        = 'pending',
    error_message = NULL,
    completed_at  = NULL,
    claimed_at    = NULL,
    claimed_by    = NULL
  WHERE id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE status = 'failed'
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
