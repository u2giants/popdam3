
-- Trigger: when designer fields change on an asset, sync to style group with conflict detection
CREATE OR REPLACE FUNCTION public.sync_designer_to_style_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group_id uuid;
  v_conflict boolean := false;
  v_designer text;
  v_tech_designer text;
  v_freelancer text;
  r record;
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  -- Gather distinct non-null designer names from all assets in the group
  SELECT
    array_agg(DISTINCT a.designer_name) FILTER (WHERE a.designer_name IS NOT NULL),
    array_agg(DISTINCT a.technical_designer_name) FILTER (WHERE a.technical_designer_name IS NOT NULL),
    array_agg(DISTINCT a.freelancer_name) FILTER (WHERE a.freelancer_name IS NOT NULL)
  INTO r
  FROM public.assets a
  WHERE a.style_group_id = v_group_id AND a.is_deleted = false;

  -- Pick the first non-null value for each field
  v_designer := (r.array_agg)[1];
  v_tech_designer := (r.array_agg_1)[1];
  v_freelancer := (r.array_agg_2)[1];

  -- Conflict = more than 1 distinct value for any designer field
  IF array_length((r.array_agg), 1) > 1
     OR array_length((r.array_agg_1), 1) > 1
     OR array_length((r.array_agg_2), 1) > 1 THEN
    v_conflict := true;
  END IF;

  UPDATE public.style_groups
  SET designer_name = v_designer,
      technical_designer_name = v_tech_designer,
      freelancer_name = v_freelancer,
      designer_conflict = v_conflict,
      updated_at = now()
  WHERE id = v_group_id;

  RETURN NEW;
END;
$$;

-- Attach to assets table
DROP TRIGGER IF EXISTS trg_sync_designer_to_style_group ON public.assets;
CREATE TRIGGER trg_sync_designer_to_style_group
  AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id
  ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_designer_to_style_group();
