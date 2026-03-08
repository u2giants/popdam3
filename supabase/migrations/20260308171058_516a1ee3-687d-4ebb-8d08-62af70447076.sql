
-- Add cover_description to assets and style_groups
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS cover_description text;

ALTER TABLE public.style_groups
  ADD COLUMN IF NOT EXISTS cover_description text;

-- Trigger: roll up cover_description from primary asset to style group
CREATE OR REPLACE FUNCTION public.sync_cover_description_to_style_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group_id uuid;
  v_desc text;
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  -- Use cover_description from the group's primary asset, or fallback to first non-null in group
  SELECT COALESCE(
    (SELECT a.cover_description FROM public.assets a
     JOIN public.style_groups sg ON sg.primary_asset_id = a.id
     WHERE sg.id = v_group_id AND a.cover_description IS NOT NULL),
    (SELECT a.cover_description FROM public.assets a
     WHERE a.style_group_id = v_group_id AND a.is_deleted = false AND a.cover_description IS NOT NULL
     LIMIT 1)
  ) INTO v_desc;

  UPDATE public.style_groups
  SET cover_description = v_desc, updated_at = now()
  WHERE id = v_group_id AND (cover_description IS DISTINCT FROM v_desc);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cover_description_to_style_group ON public.assets;
CREATE TRIGGER trg_sync_cover_description_to_style_group
  AFTER INSERT OR UPDATE OF cover_description, style_group_id
  ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_cover_description_to_style_group();
