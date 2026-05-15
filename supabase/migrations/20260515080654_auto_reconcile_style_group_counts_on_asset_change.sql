-- 1. Update refresh_style_group_counts_batch to also clear primary fields when a group
--    reaches zero assets — prevents ghost groups with stale counts from appearing.
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
SET lock_timeout TO '0'
AS $function$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      -- Clear primary fields for empty groups so they disappear from the library
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

-- 2. Statement-level trigger function. For UPDATE it checks the transition tables to
--    only act when is_deleted or style_group_id actually changed (avoids running on
--    every thumbnail or tag update).
CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_on_asset_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM new_table
     WHERE style_group_id IS NOT NULL;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM old_table
     WHERE style_group_id IS NOT NULL;

  ELSE -- UPDATE: only care about rows where is_deleted or style_group_id actually changed
    SELECT array_agg(DISTINCT grp)
      INTO v_group_ids
      FROM (
        SELECT o.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND o.style_group_id IS NOT NULL
        UNION
        SELECT n.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND n.style_group_id IS NOT NULL
      ) t;
  END IF;

  IF v_group_ids IS NOT NULL AND array_length(v_group_ids, 1) > 0 THEN
    PERFORM public.refresh_style_group_counts_batch(v_group_ids);
  END IF;

  RETURN NULL;
END;
$$;

-- 3. Wire up the triggers (statement-level for efficiency).
DROP TRIGGER IF EXISTS trg_refresh_sg_counts_on_insert ON public.assets;
CREATE TRIGGER trg_refresh_sg_counts_on_insert
  AFTER INSERT ON public.assets
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_style_group_counts_on_asset_change();

-- UPDATE: no column filter here (transition tables + column list is not supported in PG),
-- the function filters internally on is_deleted / style_group_id changes.
DROP TRIGGER IF EXISTS trg_refresh_sg_counts_on_update ON public.assets;
CREATE TRIGGER trg_refresh_sg_counts_on_update
  AFTER UPDATE ON public.assets
  REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_style_group_counts_on_asset_change();

DROP TRIGGER IF EXISTS trg_refresh_sg_counts_on_delete ON public.assets;
CREATE TRIGGER trg_refresh_sg_counts_on_delete
  AFTER DELETE ON public.assets
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_style_group_counts_on_asset_change();
