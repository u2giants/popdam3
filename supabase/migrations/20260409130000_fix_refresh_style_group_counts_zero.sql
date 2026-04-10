-- Fix refresh_style_group_counts_batch not zeroing out empty groups.
-- The previous implementation aggregated FROM assets (inner join), so any group
-- with zero non-deleted assets was absent from `agg` and the UPDATE skipped it —
-- leaving a stale asset_count forever. This affects both Reconcile and the
-- finalize_stats stage of Rebuild Style Groups.
-- Fix: drive the aggregate from style_groups LEFT JOIN assets so that groups
-- with no active assets are included with asset_count = 0.

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count = agg.asset_count,
      latest_file_date = agg.latest_file_date,
      updated_at = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;
