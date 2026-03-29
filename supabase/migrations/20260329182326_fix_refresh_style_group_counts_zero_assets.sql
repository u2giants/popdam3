-- Fix refresh_style_group_counts to also zero out groups that have lost all their assets.
-- The old version used INNER JOIN semantics (FROM ... WHERE sg.id = agg.style_group_id),
-- which meant groups with 0 assets were never updated and kept their stale count forever.
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  UPDATE public.style_groups sg
  SET
    asset_count = COALESCE(agg.asset_count, 0),
    latest_file_date = agg.latest_file_date,
    updated_at = now()
  FROM (
    SELECT
      sg2.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg2
    LEFT JOIN public.assets a
      ON a.style_group_id = sg2.id
      AND a.is_deleted = false
    GROUP BY sg2.id
  ) agg
  WHERE sg.id = agg.style_group_id;
$function$;

-- Fix the batch version with the same LEFT JOIN approach so zeroing also works per-batch.
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  WITH agg AS (
    SELECT
      sg2.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg2
    LEFT JOIN public.assets a
      ON a.style_group_id = sg2.id
      AND a.is_deleted = false
    WHERE sg2.id = ANY(p_group_ids)
    GROUP BY sg2.id
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
$function$;

-- Immediately repair all stale counts using the fixed function.
SELECT public.refresh_style_group_counts();
