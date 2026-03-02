
-- Drop the old monolithic function
DROP FUNCTION IF EXISTS public.refresh_style_group_stats();

-- Function 1: Update counts + latest_file_date (fast aggregate, no LATERAL)
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
  UPDATE public.style_groups sg
  SET
    asset_count = COALESCE(agg.asset_count, 0),
    latest_file_date = agg.latest_file_date,
    updated_at = now()
  FROM (
    SELECT
      a.style_group_id,
      COUNT(*)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
    GROUP BY a.style_group_id
  ) agg
  WHERE sg.id = agg.style_group_id;
$$;

-- Function 2: Update primary_asset_id for a BATCH of groups (chunked via ID range)
CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
  WITH picked AS (
    SELECT
      sg.id AS style_group_id,
      pa.id AS primary_asset_id,
      pa.asset_type::text AS primary_asset_type
    FROM public.style_groups sg
    LEFT JOIN LATERAL (
      SELECT a.id, a.asset_type
      FROM public.assets a
      WHERE a.style_group_id = sg.id
        AND a.is_deleted = false
      ORDER BY
        CASE
          WHEN lower(a.filename) LIKE '%mockup%' AND a.thumbnail_url IS NOT NULL AND a.thumbnail_error IS NULL THEN 1
          WHEN lower(a.filename) LIKE '%art%' AND a.thumbnail_url IS NOT NULL AND a.thumbnail_error IS NULL THEN 2
          WHEN lower(a.filename) NOT LIKE '%mockup%' AND lower(a.filename) NOT LIKE '%art%' AND lower(a.filename) NOT LIKE '%packaging%'
               AND a.thumbnail_url IS NOT NULL AND a.thumbnail_error IS NULL THEN 3
          WHEN lower(a.filename) LIKE '%packaging%' AND a.thumbnail_url IS NOT NULL AND a.thumbnail_error IS NULL THEN 4
          WHEN lower(a.filename) LIKE '%mockup%' THEN 5
          WHEN lower(a.filename) LIKE '%art%' THEN 6
          WHEN lower(a.filename) NOT LIKE '%mockup%' AND lower(a.filename) NOT LIKE '%art%' AND lower(a.filename) NOT LIKE '%packaging%' THEN 7
          WHEN lower(a.filename) LIKE '%packaging%' THEN 8
          ELSE 9
        END,
        a.created_at ASC
      LIMIT 1
    ) pa ON true
    WHERE sg.id = ANY(p_group_ids)
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      updated_at = now()
    FROM picked
    WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;
