
CREATE OR REPLACE FUNCTION public.reconcile_style_group_stats_batch(
  p_cursor uuid DEFAULT NULL,
  p_batch_size int DEFAULT 200,
  p_sub text DEFAULT 'counts'
)
RETURNS TABLE(next_cursor uuid, processed int, sub text, done boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_last_id uuid;
  v_done boolean;
BEGIN
  -- Fetch batch of style_group IDs using keyset pagination
  SELECT array_agg(sg.id ORDER BY sg.id), count(*)::int
  INTO v_ids, v_count
  FROM (
    SELECT sg2.id
    FROM style_groups sg2
    WHERE (p_cursor IS NULL OR sg2.id > p_cursor)
    ORDER BY sg2.id
    LIMIT p_batch_size
  ) sg;

  v_done := (v_count < p_batch_size);

  IF v_count = 0 THEN
    -- No more groups in this sub-stage
    IF p_sub = 'counts' THEN
      -- Signal transition to primaries
      RETURN QUERY SELECT NULL::uuid, 0, 'counts_done'::text, false;
    ELSE
      -- Primaries done = fully complete
      RETURN QUERY SELECT NULL::uuid, 0, 'complete'::text, true;
    END IF;
    RETURN;
  END IF;

  v_last_id := v_ids[array_length(v_ids, 1)];

  IF p_sub = 'counts' THEN
    -- Refresh counts + latest_file_date for this batch
    PERFORM refresh_style_group_counts_batch(v_ids);

    IF v_done THEN
      -- Counts exhausted → signal transition
      RETURN QUERY SELECT v_last_id, v_count, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT v_last_id, v_count, 'counts'::text, false;
    END IF;

  ELSIF p_sub = 'primaries' THEN
    -- Refresh primary asset selection for this batch
    PERFORM refresh_style_group_primaries(v_ids);

    RETURN QUERY SELECT v_last_id, v_count, p_sub, v_done;

  ELSE
    RAISE EXCEPTION 'Unknown sub-stage: %', p_sub;
  END IF;
END;
$$;
