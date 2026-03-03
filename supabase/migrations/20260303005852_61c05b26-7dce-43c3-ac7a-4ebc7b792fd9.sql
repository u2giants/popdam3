
-- Replace global refresh_style_group_counts with a batched version
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $$
  WITH agg AS (
    SELECT
      a.style_group_id,
      COUNT(*)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id = ANY(p_group_ids)
    GROUP BY a.style_group_id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count = COALESCE(agg.asset_count, 0),
      latest_file_date = agg.latest_file_date,
      updated_at = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;
