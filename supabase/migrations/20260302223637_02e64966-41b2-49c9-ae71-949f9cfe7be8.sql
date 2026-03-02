-- Bulk assignment helper to avoid per-SKU update round trips during rebuild
CREATE OR REPLACE FUNCTION public.bulk_assign_style_groups(p_assignments jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      (x->>'asset_id')::uuid AS asset_id,
      (x->>'style_group_id')::uuid AS style_group_id
    FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS x
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = r.style_group_id
    FROM rows r
    WHERE a.id = r.asset_id
      AND a.is_deleted = false
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;

-- Optimized style-group stats finalization with primary asset selection.
-- Uses LATERAL for per-group prioritized primary asset pick.
CREATE OR REPLACE FUNCTION public.refresh_style_group_stats()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
  WITH agg AS (
    SELECT
      a.style_group_id,
      COUNT(*)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
    GROUP BY a.style_group_id
  ),
  picked AS (
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
  )
  UPDATE public.style_groups sg
  SET
    asset_count = COALESCE(agg.asset_count, 0),
    latest_file_date = agg.latest_file_date,
    primary_asset_id = picked.primary_asset_id,
    primary_asset_type = picked.primary_asset_type,
    updated_at = now()
  FROM picked
  LEFT JOIN agg ON agg.style_group_id = picked.style_group_id
  WHERE sg.id = picked.style_group_id;
$$;