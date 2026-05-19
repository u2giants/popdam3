CREATE OR REPLACE FUNCTION public.refresh_primary_on_asset_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only act when this asset is currently the group's primary
  IF NEW.style_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM style_groups
       WHERE id = NEW.style_group_id
         AND primary_asset_id = NEW.id
     )
  THEN
    PERFORM refresh_style_group_primaries(ARRAY[NEW.style_group_id]);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refresh_primary_on_asset_soft_delete
AFTER UPDATE OF is_deleted ON public.assets
FOR EACH ROW
WHEN (NEW.is_deleted = true AND OLD.is_deleted = false)
EXECUTE FUNCTION public.refresh_primary_on_asset_soft_delete();
