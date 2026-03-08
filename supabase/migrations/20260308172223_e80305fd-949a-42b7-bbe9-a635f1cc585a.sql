
CREATE OR REPLACE FUNCTION public.sync_designer_to_style_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_conflict boolean := false;
  v_designer text;
  v_tech_designer text;
  v_freelancer text;
  v_designers text[];
  v_tech_designers text[];
  v_freelancers text[];
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT
    array_agg(DISTINCT a.designer_name) FILTER (WHERE a.designer_name IS NOT NULL),
    array_agg(DISTINCT a.technical_designer_name) FILTER (WHERE a.technical_designer_name IS NOT NULL),
    array_agg(DISTINCT a.freelancer_name) FILTER (WHERE a.freelancer_name IS NOT NULL)
  INTO v_designers, v_tech_designers, v_freelancers
  FROM public.assets a
  WHERE a.style_group_id = v_group_id AND a.is_deleted = false;

  v_designer := v_designers[1];
  v_tech_designer := v_tech_designers[1];
  v_freelancer := v_freelancers[1];

  IF array_length(v_designers, 1) > 1
     OR array_length(v_tech_designers, 1) > 1
     OR array_length(v_freelancers, 1) > 1 THEN
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
$function$;
