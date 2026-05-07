-- Move staleness cleanup out of PostgREST PATCH (unreliable) into a DB function.
-- Called via db.rpc() at the end of complete-style-guide-crawl.
CREATE OR REPLACE FUNCTION public.deactivate_stale_sg_files(
  p_root_label text,
  p_run_id     uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE style_guide_files
  SET is_active = false
  WHERE root_label = p_root_label
    AND crawl_run_id != p_run_id
    AND is_active = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
