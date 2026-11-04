-- derived-from: 20261104212000
-- Fix forward on review finding #5580 (PopDAM #680). Customer names match literally and are
-- normalized. A value already in use needs no table scan, so a rescan stays linear.
-- Tags are additive by design: a sheet edit never removes a tag; undo is by source pdf_sheet.
-- PopDAM #680: a sheet's own fields become free style-level tags as sheets arrive
-- (owner: "new sheets should automatically get the free tags"). Same rules as the
-- Nov 4 load: source pdf_sheet; undo by deleting that source. A value joins only at
-- three styles, because rarer values are mostly scan debris. Never blocks a sheet save.
CREATE OR REPLACE FUNCTION public.apply_pdf_sheet_style_tags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group uuid;
  v_field text;
  v_tag text;
  v_customer text;
  v_retailer text;
BEGIN
  IF NEW.extracted_fields IS NULL THEN RETURN NEW; END IF;
  SELECT a.style_group_id INTO v_group FROM public.assets a
    WHERE a.id = NEW.asset_id AND a.is_deleted = false;
  IF v_group IS NULL THEN RETURN NEW; END IF;

  FOREACH v_field IN ARRAY ARRAY['product_type', 'packaging_type'] LOOP
    v_tag := lower(regexp_replace(btrim(NEW.extracted_fields ->> v_field), '\s+', ' ', 'g'));
    CONTINUE WHEN v_tag IS NULL OR length(v_tag) NOT BETWEEN 3 AND 40
      OR v_tag !~ '^[[:alpha:]][[:alnum:] &''./-]*$'
      OR v_tag ~ '(prop 65|tsca|warning|example|batter|view|close-up|front|included|^tbd$|&$)'
      OR v_tag = ANY (ARRAY['legal line on sewn-in','canvas packaged with','clock mechanism','clock m','to avoid scratching','try-me sticker','tower','reference picture','leg corners','pvc backing','packaged with protective cardboard','bottom right corner','please put this sticker next to','label','box'])
      OR (v_field = 'packaging_type' AND v_tag !~ '(corner|sticker|label|hang ?tag|j-?card|box|shrink|belly|header|swift|polybag|sleeve)')
      OR EXISTS (SELECT 1 FROM core.customer c WHERE v_tag = lower(btrim(c.name)) OR starts_with(v_tag, lower(btrim(c.name)) || ' '));

    -- A value already in use just applies here, with no scan.
    IF EXISTS (SELECT 1 FROM public.style_group_tags t WHERE t.tag = v_tag AND t.source = 'pdf_sheet') THEN
      INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
      VALUES (v_group, v_tag, CASE WHEN v_field = 'product_type' THEN 'product_type' ELSE 'other' END,
        'pdf_sheet', 'active', 1, jsonb_build_array('sheet ' || replace(v_field, '_type', '')))
      ON CONFLICT (style_group_id, tag) DO NOTHING;
      CONTINUE;
    END IF;

    -- Every style with this value, including this one, tagged once three exist.
    WITH matching AS (
      SELECT DISTINCT a.style_group_id AS g
      FROM public.pdf_text_samples s
      JOIN public.assets a ON a.id = s.asset_id AND a.is_deleted = false AND a.style_group_id IS NOT NULL
      WHERE lower(regexp_replace(btrim(s.extracted_fields ->> v_field), '\s+', ' ', 'g')) = v_tag
      UNION SELECT v_group
    )
    INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
    SELECT m.g, v_tag, CASE WHEN v_field = 'product_type' THEN 'product_type' ELSE 'other' END,
      'pdf_sheet', 'active', 1, jsonb_build_array('sheet ' || replace(v_field, '_type', ''))
    FROM matching m
    WHERE (SELECT count(*) FROM matching) >= 3
    ON CONFLICT (style_group_id, tag) DO NOTHING;
  END LOOP;

  v_retailer := lower(btrim(NEW.extracted_fields ->> 'retailer'));
  SELECT lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) INTO v_customer FROM core.customer c
    WHERE btrim(c.name) <> ''
      AND (v_retailer = lower(btrim(c.name)) OR starts_with(v_retailer, lower(btrim(c.name)) || ' '))
    ORDER BY length(btrim(c.name)) DESC LIMIT 1;
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.style_group_tags (style_group_id, tag, category, source, status, confidence, evidence)
    VALUES (v_group, v_customer, 'other', 'pdf_sheet', 'active', 1, '["sheet original customer"]'::jsonb)
    ON CONFLICT (style_group_id, tag) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_pdf_sheet_style_tags failed for %: %', NEW.asset_id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_pdf_sheet_style_tags() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pdf_text_samples_style_tags ON public.pdf_text_samples;
CREATE TRIGGER pdf_text_samples_style_tags
AFTER INSERT OR UPDATE OF extracted_fields ON public.pdf_text_samples
FOR EACH ROW EXECUTE FUNCTION public.apply_pdf_sheet_style_tags();
