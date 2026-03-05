
CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Only act when thumbnail_url just became non-null
  IF NEW.thumbnail_url IS NULL OR NEW.style_group_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.thumbnail_url IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Update the group's primary_asset_id if it has no primary or its current primary has no thumbnail
  UPDATE public.style_groups sg
  SET primary_asset_id = NEW.id,
      primary_asset_type = NEW.asset_type::text,
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_primary_on_thumbnail ON public.assets;
CREATE TRIGGER trg_sync_primary_on_thumbnail
  AFTER UPDATE OF thumbnail_url ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_primary_asset_on_thumbnail();
