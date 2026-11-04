-- Automatic sheet tags: ephemeral database only; fixtures roll back.
BEGIN;
DO $$
DECLARE
  g uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  a uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  f text;
BEGIN
  INSERT INTO core.customer(name) VALUES ('ZZ Mart'), ('ZZ Mart Outlet'), ('100%');
  FOR i IN 1..4 LOOP
    INSERT INTO public.style_groups(id, sku, folder_path) VALUES (g[i], 'ZZTAG' || i, 'ZZTAG/' || i);
    INSERT INTO public.assets(id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted, style_group_id)
    VALUES (a[i], 'ZZ' || i || '.pdf', 'ZZTAG/' || i || '.pdf', 'pdf'::public.file_type, a[i]::text, now(), false, g[i]);
  END LOOP;

  FOR i IN 1..2 LOOP
    INSERT INTO public.pdf_text_samples(asset_id, filename, relative_path, extraction_method, extracted_fields)
    VALUES (a[i], 'ZZ.pdf', 'ZZ/' || i, 'test', '{"product_type":"zz test mat"}');
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.style_group_tags WHERE tag = 'zz test mat')
    THEN RAISE EXCEPTION 'value tagged before three styles'; END IF;

  INSERT INTO public.pdf_text_samples(asset_id, filename, relative_path, extraction_method, extracted_fields)
  VALUES (a[3], 'ZZ.pdf', 'ZZ/3', 'test', '{"product_type":"ZZ  Test Mat","packaging_type":"not a package","retailer":"ZZ Mart Outlet FW26"}');
  IF (SELECT count(*) FROM public.style_group_tags WHERE tag = 'zz test mat' AND source = 'pdf_sheet') <> 3
    THEN RAISE EXCEPTION 'third style did not tag all three'; END IF;
  IF EXISTS (SELECT 1 FROM public.style_group_tags WHERE tag = 'not a package')
    THEN RAISE EXCEPTION 'packaging value outside the allowed words was tagged'; END IF;
  SELECT tag INTO f FROM public.style_group_tags WHERE style_group_id = g[3] AND evidence ? 'sheet original customer';
  IF f IS DISTINCT FROM 'zz mart outlet' THEN RAISE EXCEPTION 'longest customer name not chosen: %', f; END IF;

  -- A wildcard in a customer name is literal; a value in use tags without a scan path.
  INSERT INTO public.pdf_text_samples(asset_id, filename, relative_path, extraction_method, extracted_fields)
  VALUES (a[4], 'ZZ.pdf', 'ZZ/4', 'test', '{"product_type":"zz test mat","retailer":"100 percent"}');
  IF NOT EXISTS (SELECT 1 FROM public.style_group_tags WHERE style_group_id = g[4] AND tag = 'zz test mat')
    THEN RAISE EXCEPTION 'in-use value not applied'; END IF;
  IF EXISTS (SELECT 1 FROM public.style_group_tags WHERE tag = '100%')
    THEN RAISE EXCEPTION 'customer name treated as a pattern'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples WHERE asset_id = a[4])
    THEN RAISE EXCEPTION 'sheet save lost'; END IF;
END $$;
ROLLBACK;
