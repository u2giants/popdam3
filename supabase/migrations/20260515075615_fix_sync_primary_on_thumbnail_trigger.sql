-- Fix sync_primary_asset_on_thumbnail trigger.
--
-- Old Case 1 was: fire when any asset gets its first thumbnail AND the group's
-- current primary has no thumbnail. This raced against refresh_style_group_primaries
-- (sort-tier-based), overwriting primary_asset_id with whichever asset rendered first,
-- leaving primary_asset_id and primary_thumbnail_url pointing to different assets.
--
-- New Case 1: only fire when primary_asset_id IS NULL (group truly has no primary).
-- If a primary exists but lacks a thumbnail, refresh_style_group_primaries handles it.
CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.style_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Case 1: Group has no primary at all — assign this asset as primary when it gets its first thumbnail.
  IF NEW.thumbnail_url IS NOT NULL AND OLD.thumbnail_url IS NULL THEN
    UPDATE public.style_groups sg
    SET primary_asset_id        = NEW.id,
        primary_asset_type      = NEW.asset_type::text,
        primary_thumbnail_url   = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at              = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id IS NULL;
  END IF;

  -- Case 2: This asset IS already the primary — keep cached thumbnail fields in sync.
  UPDATE public.style_groups sg
  SET primary_thumbnail_url   = NEW.thumbnail_url,
      primary_thumbnail_error = NEW.thumbnail_error,
      updated_at              = now()
  WHERE sg.id = NEW.style_group_id
    AND sg.primary_asset_id = NEW.id
    AND (sg.primary_thumbnail_url IS DISTINCT FROM NEW.thumbnail_url
         OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);

  RETURN NEW;
END;
$$;
