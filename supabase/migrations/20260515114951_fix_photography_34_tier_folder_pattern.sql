-- Fix: "photography subfolder" means "professional photos" or "Prof Photos",
-- not "/photography/". Update trigger to use correct folder pattern.
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  fn        text    := lower(NEW.filename);
  rp        text    := lower(NEW.relative_path);
  base_name text    := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34 boolean := (
    (rp LIKE '%/professional photos/%' OR rp LIKE '%/prof photos/%')
    AND base_name LIKE '%3-4'
  );
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
