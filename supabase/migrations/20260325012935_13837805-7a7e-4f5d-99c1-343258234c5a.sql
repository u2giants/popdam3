-- 1. Add 'pdf' to file_type enum
ALTER TYPE public.file_type ADD VALUE IF NOT EXISTS 'pdf';

-- 2. Add pdf_page2_url column to assets table
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS pdf_page2_url text;

-- 3. Update compute_primary_sort_tier trigger to handle tech packs (tier 0)
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  fn text := lower(NEW.filename);
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_techpack boolean := (fn LIKE '%tech pack%' OR fn LIKE '%tech_pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech-pack%');
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art boolean := (fn LIKE '%art%');
  is_pkg boolean := (fn LIKE '%packaging%');
BEGIN
  IF is_techpack AND has_thumb THEN NEW.primary_sort_tier := 0;
  ELSIF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 1;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg AND NOT is_techpack AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_techpack THEN NEW.primary_sort_tier := 5;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 6;
  ELSIF is_art THEN NEW.primary_sort_tier := 7;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg AND NOT is_techpack THEN NEW.primary_sort_tier := 8;
  ELSE NEW.primary_sort_tier := 9;
  END IF;
  RETURN NEW;
END; $function$;