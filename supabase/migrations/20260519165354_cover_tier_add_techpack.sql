-- Add tech pack as tier 4 (above generic, above packaging).
-- "tech pack" / "techpack" / "tech_pack" all match.
-- Old tiers 4-9 shift to 5-10 to make room; column default updated.
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  fn        text    := lower(NEW.filename);
  base_name text    := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34   boolean := (base_name LIKE '%3-4%');
  is_mockup    boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art       boolean := (fn LIKE '%art%');
  is_techpack  boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg       boolean := (fn LIKE '%packaging%');
BEGIN
  IF    is_photo34                                                              THEN NEW.primary_sort_tier :=  1;
  ELSIF is_mockup   AND has_thumb                                               THEN NEW.primary_sort_tier :=  2;
  ELSIF is_art      AND has_thumb                                               THEN NEW.primary_sort_tier :=  3;
  ELSIF is_techpack AND has_thumb                                               THEN NEW.primary_sort_tier :=  4;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg
        AND has_thumb                                                           THEN NEW.primary_sort_tier :=  5;
  ELSIF is_pkg      AND has_thumb                                               THEN NEW.primary_sort_tier :=  6;
  ELSIF is_mockup                                                               THEN NEW.primary_sort_tier :=  7;
  ELSIF is_art                                                                  THEN NEW.primary_sort_tier :=  8;
  ELSIF is_techpack                                                             THEN NEW.primary_sort_tier :=  9;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg         THEN NEW.primary_sort_tier := 10;
  ELSE                                                                               NEW.primary_sort_tier := 11;
  END IF;
  RETURN NEW;
END; $$;

-- Update column default (generic-no-thumb is now tier 10)
ALTER TABLE public.assets ALTER COLUMN primary_sort_tier SET DEFAULT 10;

-- Backfill tier for tech pack files
UPDATE public.assets
SET primary_sort_tier =
  CASE WHEN thumbnail_url IS NOT NULL AND thumbnail_error IS NULL THEN 4 ELSE 9 END
WHERE (lower(filename) LIKE '%tech pack%'
    OR lower(filename) LIKE '%techpack%'
    OR lower(filename) LIKE '%tech_pack%')
  AND is_deleted = false;
