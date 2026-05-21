CREATE OR REPLACE FUNCTION public.run_full_reconcile_style_group_stats()
RETURNS TABLE(counts_updated integer, primaries_updated integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_cursor         uuid := NULL;
  v_batch_ids      uuid[];
  v_batch_size     int  := 500;
  v_batch_count    int;
  v_counts_updated int  := 0;
  v_prim_updated   int  := 0;
BEGIN
  -- Phase 1: recompute asset_count for every group in one UPDATE+JOIN pass;
  --          also clears primary fields on groups that are now empty.
  WITH agg AS (
    SELECT
      sg.id                        AS style_group_id,
      COUNT(a.id)::integer         AS asset_count,
      MAX(a.modified_at)           AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id        END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type      END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url   END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_counts_updated FROM upd;

  -- Phase 2: re-pick primary asset for every group, batched to avoid huge arrays.
  LOOP
    SELECT array_agg(id ORDER BY id), COUNT(*)::int
    INTO v_batch_ids, v_batch_count
    FROM (
      SELECT id FROM public.style_groups
      WHERE (v_cursor IS NULL OR id > v_cursor)
      ORDER BY id
      LIMIT v_batch_size
    ) sub;

    EXIT WHEN v_batch_count = 0;

    PERFORM public.refresh_style_group_primaries(v_batch_ids);
    v_prim_updated := v_prim_updated + v_batch_count;
    v_cursor := v_batch_ids[array_length(v_batch_ids, 1)];

    EXIT WHEN v_batch_count < v_batch_size;
  END LOOP;

  RETURN QUERY SELECT v_counts_updated, v_prim_updated;
END;
$$;
