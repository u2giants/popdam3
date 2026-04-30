CREATE OR REPLACE FUNCTION get_sg_render_queue_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'pending',   COUNT(*) FILTER (WHERE status = 'pending'),
    'claimed',   COUNT(*) FILTER (WHERE status = 'claimed'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed',    COUNT(*) FILTER (WHERE status = 'failed')
  )
  FROM style_guide_render_queue;
$$;

GRANT EXECUTE ON FUNCTION get_sg_render_queue_stats() TO authenticated;
