-- Broaden tier-1 "3-4 view" rule: drop the folder requirement and
-- match "3-4" anywhere in the base name (not just at the end).
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  fn        text    := lower(NEW.filename);
  base_name text    := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34 boolean := (base_name LIKE '%3-4%');
  is_mockup  boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art     boolean := (fn LIKE '%art%');
  is_pkg     boolean := (fn LIKE '%packaging%');
BEGIN
  IF    is_photo34                                          THEN NEW.primary_sort_tier := 1;
  ELSIF is_mockup AND has_thumb                             THEN NEW.primary_sort_tier := 2;
  ELSIF is_art    AND has_thumb                             THEN NEW.primary_sort_tier := 3;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg
        AND has_thumb                                       THEN NEW.primary_sort_tier := 4;
  ELSIF is_pkg    AND has_thumb                             THEN NEW.primary_sort_tier := 5;
  ELSIF is_mockup                                           THEN NEW.primary_sort_tier := 6;
  ELSIF is_art                                              THEN NEW.primary_sort_tier := 7;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg         THEN NEW.primary_sort_tier := 8;
  ELSE                                                           NEW.primary_sort_tier := 9;
  END IF;
  RETURN NEW;
END; $$;

-- Backfill: recalculate tiers for all assets whose filenames contain "3-4"
-- (trigger only fires on future inserts/updates, not existing rows)
UPDATE public.assets
SET primary_sort_tier = 1
WHERE lower(regexp_replace(filename, '\.[^.]+$', '')) LIKE '%3-4%'
  AND is_deleted = false;
