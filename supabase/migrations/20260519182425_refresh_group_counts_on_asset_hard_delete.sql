CREATE OR REPLACE FUNCTION public.refresh_group_on_asset_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.style_group_id IS NOT NULL THEN
    PERFORM refresh_style_group_counts_batch(ARRAY[OLD.style_group_id]);
    PERFORM refresh_style_group_primaries(ARRAY[OLD.style_group_id]);
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_refresh_group_on_asset_hard_delete
AFTER DELETE ON public.assets
FOR EACH ROW
EXECUTE FUNCTION public.refresh_group_on_asset_hard_delete();
