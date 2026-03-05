-- Add primary_thumbnail_url and primary_thumbnail_error to style_groups
-- These mirror the primary asset's thumbnail state for efficient filtering
ALTER TABLE public.style_groups
  ADD COLUMN IF NOT EXISTS primary_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS primary_thumbnail_error text;

-- Backfill from current primary assets
UPDATE public.style_groups sg
SET
  primary_thumbnail_url = a.thumbnail_url,
  primary_thumbnail_error = a.thumbnail_error
FROM public.assets a
WHERE sg.primary_asset_id = a.id;

-- Update the sync trigger to also sync thumbnail fields
CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- When thumbnail_url changes on any asset, sync to its style group if it's the primary
  IF NEW.style_group_id IS NOT NULL THEN
    -- Case 1: This asset just got a thumbnail and the group has no primary or a broken primary
    IF NEW.thumbnail_url IS NOT NULL AND (OLD.thumbnail_url IS NULL) THEN
      UPDATE public.style_groups sg
      SET primary_asset_id = NEW.id,
          primary_asset_type = NEW.asset_type::text,
          primary_thumbnail_url = NEW.thumbnail_url,
          primary_thumbnail_error = NEW.thumbnail_error,
          updated_at = now()
      WHERE sg.id = NEW.style_group_id
        AND (
          sg.primary_asset_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.assets a
            WHERE a.id = sg.primary_asset_id
              AND a.thumbnail_url IS NOT NULL
              AND a.is_deleted = false
          )
        );
    END IF;

    -- Case 2: This asset IS the primary — sync its thumbnail fields regardless
    UPDATE public.style_groups sg
    SET primary_thumbnail_url = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id = NEW.id
      AND (sg.primary_thumbnail_url IS DISTINCT FROM NEW.thumbnail_url
           OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);
  END IF;

  RETURN NEW;
END;
$$;

-- Also update refresh_style_group_primaries to sync thumbnail fields
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
      pa.asset_type::text AS primary_asset_type,
      pa.thumbnail_url AS primary_thumbnail_url,
      pa.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN LATERAL (
      SELECT a.id, a.asset_type, a.thumbnail_url, a.thumbnail_error
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
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked
    WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;