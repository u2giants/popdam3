-- derived-from: 20261103171536
-- Junk OCR readings ("BATTERY BOX", "MOCK UP") replaced real designers. A sheet value now
-- changes an asset only when each person in it has a known first name. Others stay in
-- pdf_text_samples.extracted_fields; add the name here and rerun the backfill to apply them.

CREATE TABLE IF NOT EXISTS public.known_designer_first_name (
  first_name text PRIMARY KEY CHECK (first_name = upper(first_name))
);
ALTER TABLE public.known_designer_first_name ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.known_designer_first_name FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.known_designer_first_name TO service_role;

INSERT INTO public.known_designer_first_name (first_name) VALUES
('SARBANI'),
('ALBERT'),
('ELIZABETH'),
('ALEJANDRA'),
('DERRICK'),
('ERICA'),
('LUIS'),
('ANGELICA'),
('PETER'),
('MALACHI'),
('JAMES'),
('MARCEL'),
('DEBORAH'),
('LINA'),
('DANILO'),
('MARCELA'),
('BECKETT'),
('MARTINA'),
('GINA'),
('JON'),
('JEN'),
('ZARIT'),
('AMY'),
('KYLE'),
('TANISHA'),
('JENNIFER'),
('JESSICA'),
('JUAN'),
('DESTINY'),
('MAURICIO'),
('MIKE'),
('RANDI'),
('CLAUDIA'),
('RODRIGO'),
('SEJ'),
('ERIKA'),
('JULIE'),
('MARZ'),
('VIOLETTE'),
('ISAAC'),
('TRISHA'),
('NIMESH'),
('CATALINA'),
('LEO'),
('STEVEN'),
('KEVIN'),
('KHIM'),
('MARIA'),
('STEVE'),
('NICOLE'),
('GUS'),
('SCOTT'),
('RICARDO'),
('GABY'),
('BRITTANY'),
('ADAM'),
('ALYESE'),
('RYAN'),
('CATHARINE'),
('LEONARD'),
('SHIRA'),
('SYDNEE'),
('MARK'),
('RITA'),
('SERGIO'),
('EMILY'),
('MICHELLE'),
('THEO'),
('ANDRE'),
('TIFFANY'),
('LIZ'),
('TRICIA'),
('JULIA'),
('ANGELA'),
('KELLY'),
('DEVON'),
('VISHAL'),
('ANNABELLE'),
('CHLOE'),
('KSENIA'),
('NICK'),
('PAULO'),
('ANNA'),
('OSCAR'),
('NATHALIE'),
('KIM'),
('MUKESH'),
('MARCELLA'),
('VIE'),
('ANGIE'),
('ANYELA')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_known_designer_value(p_value text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(bool_and(EXISTS (
    SELECT 1 FROM public.known_designer_first_name k
    WHERE k.first_name = upper(split_part(btrim(part), ' ', 1))
  )), false)
  FROM regexp_split_to_table(p_value, '[/,&]') part;
$function$;

CREATE OR REPLACE FUNCTION public.apply_sheet_designers(p_asset_id uuid, p_creative text, p_technical text, OUT c integer, OUT t integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_creative text := NULLIF(btrim(p_creative), '');
  v_technical text := NULLIF(btrim(p_technical), '');
  v_cur public.assets%ROWTYPE;
BEGIN
  c := 0; t := 0;
  IF NOT public.is_known_designer_value(v_creative) THEN v_creative := NULL; END IF;
  IF NOT public.is_known_designer_value(v_technical) THEN v_technical := NULL; END IF;

  SELECT * INTO v_cur FROM public.assets a WHERE a.id = p_asset_id;
  IF NOT FOUND OR NOT public.is_style_guide_source_pdf(v_cur.file_type::text, v_cur.filename) THEN RETURN; END IF;

  IF v_creative IS NOT NULL AND v_cur.designer_name IS DISTINCT FROM v_creative THEN c := 1; END IF;
  IF v_technical IS NOT NULL AND v_cur.technical_designer_name IS DISTINCT FROM v_technical THEN t := 1; END IF;
  IF c = 0 AND t = 0 THEN RETURN; END IF;

  INSERT INTO public.asset_designer_sheet_backup (asset_id, designer_name, technical_designer_name)
  VALUES (p_asset_id, v_cur.designer_name, v_cur.technical_designer_name)
  ON CONFLICT (asset_id) DO NOTHING;

  UPDATE public.assets a SET
    designer_name = CASE WHEN c = 1 THEN v_creative ELSE a.designer_name END,
    technical_designer_name = CASE WHEN t = 1 THEN v_technical ELSE a.technical_designer_name END
  WHERE a.id = p_asset_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_known_designer_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_known_designer_value(text) TO service_role;
