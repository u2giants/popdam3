-- requeue_all_failed_sg_jobs: bulk-reset all failed render queue entries to pending.
-- Uses SECURITY DEFINER so it runs as the function owner (bypassing RLS), avoiding
-- per-row policy evaluation on 30,000+ rows that blows the statement timeout.
CREATE OR REPLACE FUNCTION public.requeue_all_failed_sg_jobs()
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
    status       = 'pending',
    error_message = NULL,
    completed_at  = NULL,
    claimed_at    = NULL,
    claimed_by    = NULL
  WHERE status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_all_failed_sg_jobs() TO authenticated;
