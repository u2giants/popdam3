
CREATE OR REPLACE FUNCTION public.clear_style_group_batch(
  p_last_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 200
)
RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $$
DECLARE
  v_cleared integer;
  v_last uuid;
  v_total_in_batch integer;
BEGIN
  -- Find the batch of IDs to clear
  CREATE TEMP TABLE _clear_batch ON COMMIT DROP AS
    SELECT a.id
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
      AND (p_last_id IS NULL OR a.id > p_last_id)
    ORDER BY a.id ASC
    LIMIT p_batch_size;

  SELECT count(*) INTO v_total_in_batch FROM _clear_batch;

  IF v_total_in_batch = 0 THEN
    cleared_count := 0;
    last_id := p_last_id;
    has_more := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Perform the update using a join (no IN clause, no URL limit)
  UPDATE public.assets a
  SET style_group_id = NULL
  FROM _clear_batch b
  WHERE a.id = b.id;

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SELECT max(b.id) INTO v_last FROM _clear_batch b;

  cleared_count := v_cleared;
  last_id := v_last;
  has_more := v_total_in_batch >= p_batch_size;
  RETURN NEXT;
  RETURN;
END;
$$;
