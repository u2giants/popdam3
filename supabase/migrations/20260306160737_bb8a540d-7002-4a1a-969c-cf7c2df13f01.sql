
-- Step 1: Add primary_sort_tier column
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS primary_sort_tier smallint NOT NULL DEFAULT 7;

-- Step 2: Create composite index for fast primary selection
CREATE INDEX IF NOT EXISTS idx_assets_primary_sort_tier
  ON public.assets (style_group_id, primary_sort_tier, created_at)
  WHERE is_deleted = false;

-- Step 3: Create trigger function to compute tier at write time
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  fn text := lower(NEW.filename);
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art boolean := (fn LIKE '%art%');
  is_pkg boolean := (fn LIKE '%packaging%');
BEGIN
  IF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 1;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 5;
  ELSIF is_art THEN NEW.primary_sort_tier := 6;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg THEN NEW.primary_sort_tier := 7;
  ELSE NEW.primary_sort_tier := 8;
  END IF;
  RETURN NEW;
END; $$;

-- Step 4: Create trigger
CREATE TRIGGER trg_compute_primary_sort_tier
  BEFORE INSERT OR UPDATE OF filename, thumbnail_url, thumbnail_error
  ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_primary_sort_tier();

-- Step 5: Rewrite refresh_style_group_primaries to use indexed column
CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '30s' AS $$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id,
      a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;
