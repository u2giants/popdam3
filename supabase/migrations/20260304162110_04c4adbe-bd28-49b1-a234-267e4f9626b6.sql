CREATE OR REPLACE FUNCTION public.clear_style_group_batch(
  p_last_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 200
)
RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_start_id uuid := COALESCE(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_cleared integer;
  v_last uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 1;
  END IF;

  WITH batch AS (
    SELECT a.id
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
      AND a.id > v_start_id
    ORDER BY a.id ASC
    LIMIT p_batch_size
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM batch b
    WHERE a.id = b.id
    RETURNING a.id
  )
  SELECT COUNT(*)::integer,
         (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1)
  INTO v_cleared, v_last
  FROM upd;

  RETURN QUERY SELECT
    COALESCE(v_cleared, 0),
    v_last,
    COALESCE(v_cleared, 0) = p_batch_size;
END;
$$;