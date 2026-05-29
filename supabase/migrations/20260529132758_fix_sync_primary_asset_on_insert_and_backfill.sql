
-- Fix trigger function to also handle INSERT (previously only caught UPDATE thumbnail-appears case)
CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.style_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Case 1: Group has no primary — assign when asset has a thumbnail.
  -- Covers INSERT (asset indexed with thumbnail already set) and
  -- UPDATE where thumbnail just appeared (OLD.thumbnail_url IS NULL).
  IF NEW.thumbnail_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.thumbnail_url IS NULL)
  THEN
    UPDATE public.style_groups sg
    SET primary_asset_id        = NEW.id,
        primary_asset_type      = NEW.asset_type::text,
        primary_thumbnail_url   = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at              = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id IS NULL;
  END IF;

  -- Case 2: This asset IS already the primary — keep cached fields in sync.
  UPDATE public.style_groups sg
  SET primary_thumbnail_url   = NEW.thumbnail_url,
      primary_thumbnail_error = NEW.thumbnail_error,
      updated_at              = now()
  WHERE sg.id = NEW.style_group_id
    AND sg.primary_asset_id = NEW.id
    AND (sg.primary_thumbnail_url  IS DISTINCT FROM NEW.thumbnail_url
         OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);

  RETURN NEW;
END;
$function$;

-- Also fire on INSERT (previously UPDATE only)
DROP TRIGGER IF EXISTS trg_sync_primary_on_thumbnail ON assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail
  AFTER INSERT OR UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION sync_primary_asset_on_thumbnail();

-- Backfill: pick best asset (by primary_sort_tier) for groups with no primary set
WITH best_asset AS (
  SELECT DISTINCT ON (a.style_group_id)
    a.style_group_id,
    a.id,
    a.asset_type,
    a.thumbnail_url,
    a.thumbnail_error
  FROM assets a
  JOIN style_groups sg ON sg.id = a.style_group_id
  WHERE sg.primary_asset_id IS NULL
    AND a.thumbnail_url IS NOT NULL
    AND (a.is_deleted IS NULL OR a.is_deleted = false)
  ORDER BY a.style_group_id, a.primary_sort_tier ASC NULLS LAST, a.filename ASC
)
UPDATE style_groups sg
SET primary_asset_id        = ba.id,
    primary_asset_type      = ba.asset_type::text,
    primary_thumbnail_url   = ba.thumbnail_url,
    primary_thumbnail_error = ba.thumbnail_error,
    updated_at              = now()
FROM best_asset ba
WHERE sg.id = ba.style_group_id;
