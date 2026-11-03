-- Indra PDF rescan behavioral contracts: ephemeral database only; fixtures roll back.
BEGIN;
DO $$
DECLARE
  good uuid := gen_random_uuid();
  shorter uuid := gen_random_uuid();
  missing uuid := gen_random_uuid();
  fresh uuid := gen_random_uuid();
  ordinary uuid := gen_random_uuid();
  filled uuid := gen_random_uuid();
  long_text text := repeat('stored sheet text ', 60);
  new_text text := repeat('indra sheet text ', 60);
  result jsonb;
  before_count bigint := public.count_pdf_rescan_remaining();
BEGIN
  INSERT INTO public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,is_deleted,sku,designer_name)
  SELECT i, n, 'ZZRESCAN/' || i, 'pdf'::public.file_type, i::text, now(), false, s, d
  FROM (VALUES
    (good,'ZZ tech pack.pdf','ZZRESCAN1',NULL),
    (shorter,'ZZ2 tech pack.pdf','ZZRESCAN2',NULL),
    (missing,'ZZ3 tech pack.pdf','ZZRESCAN3',NULL),
    (fresh,'ZZ4 tech pack.pdf','ZZRESCAN4',NULL),
    (ordinary,'ordinary.pdf','ZZRESCAN5',NULL),
    (filled,'ZZ6 tech pack.pdf','ZZRESCAN6','Existing Person')
  ) v(i,n,s,d);

  INSERT INTO public.pdf_text_samples(asset_id,filename,relative_path,extraction_method,extracted_text,char_count)
  SELECT i,'stored.pdf','ZZRESCAN/stored','pdf_text',long_text,length(long_text)
  FROM unnest(ARRAY[good,shorter,missing,ordinary,filled]) i;

  IF public.count_pdf_rescan_remaining() <> before_count + 6 THEN RAISE EXCEPTION 'count changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_pdf_rescan_batch(100000) c
    WHERE c.id = good
  ) THEN RAISE EXCEPTION 'pending file not claimable'; END IF;

  result := public.commit_pdf_rescan_batch(jsonb_build_array(
    jsonb_build_object('asset_id',good,'extracted_text',new_text,'page_count','',
      'fields',jsonb_build_object('creative_designer','ROBIN','technical_designer','KIM','files_used',jsonb_build_array('CC100001'))),
    jsonb_build_object('asset_id',shorter,'filename','s.pdf','relative_path','ZZRESCAN/s','extracted_text','tiny','fields','{}'::jsonb),
    jsonb_build_object('asset_id',missing,'filename','m.pdf','relative_path','ZZRESCAN/m','extracted_text',NULL,'error','ENOENT'),
    jsonb_build_object('asset_id',fresh,'filename','ZZ4 tech pack.pdf','relative_path','ZZRESCAN/f','extracted_text',new_text,'fields','{}'::jsonb),
    jsonb_build_object('asset_id',ordinary,'filename','ordinary.pdf','relative_path','ZZRESCAN/o','extracted_text',new_text,
      'fields',jsonb_build_object('creative_designer','NOT A SHEET')),
    jsonb_build_object('asset_id',filled,'filename','f.pdf','relative_path','ZZRESCAN/z','extracted_text',new_text,
      'fields',jsonb_build_object('creative_designer','ROBIN'))
  ));

  IF (result->>'replaced')::int <> 4 OR (result->>'kept_existing')::int <> 1 OR (result->>'failed')::int <> 1 THEN
    RAISE EXCEPTION 'outcome counts wrong: %', result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples WHERE asset_id=good AND extracted_text=btrim(new_text)
      AND ocr_engine='indra' AND extraction_method='ocr_text' AND filename='stored.pdf' AND relative_path='ZZRESCAN/stored')
    THEN RAISE EXCEPTION 'replacement or missing-key preservation wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples_backup WHERE asset_id=good AND extracted_text=long_text)
    THEN RAISE EXCEPTION 'backup not taken'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples WHERE asset_id=shorter AND extracted_text=long_text
      AND ocr_engine IS NULL AND indra_rescan_outcome='kept_existing' AND indra_rescan_at IS NOT NULL)
    THEN RAISE EXCEPTION 'short OCR replaced stored text'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples WHERE asset_id=missing AND extracted_text=long_text
      AND indra_rescan_outcome='failed' AND indra_rescan_error='ENOENT')
    THEN RAISE EXCEPTION 'failed file lost text'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pdf_text_samples WHERE asset_id=fresh AND ocr_engine='indra')
    THEN RAISE EXCEPTION 'unsampled file not inserted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id=good AND designer_name='ROBIN' AND technical_designer_name='KIM')
    THEN RAISE EXCEPTION 'blank designer not filled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id=filled AND designer_name='ROBIN')
    THEN RAISE EXCEPTION 'sheet designer did not replace existing value'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.asset_designer_sheet_backup WHERE asset_id=filled AND designer_name='Existing Person')
    THEN RAISE EXCEPTION 'old designer not kept'; END IF;
  -- Blank and junk readings never erase; a later reading keeps the first-seen undo copy.
  PERFORM public.apply_sheet_designers(filled, NULL, '  ');
  PERFORM public.apply_sheet_designers(filled, 'null', '12');
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id=filled AND designer_name='ROBIN' AND technical_designer_name IS NULL)
    THEN RAISE EXCEPTION 'blank or junk reading changed a designer'; END IF;
  PERFORM public.apply_sheet_designers(filled, 'SAM', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.asset_designer_sheet_backup WHERE asset_id=filled AND designer_name='Existing Person')
    THEN RAISE EXCEPTION 'undo copy overwritten'; END IF;
  -- Backfill from stored fields replaces a literal null text value.
  UPDATE public.assets SET designer_name='null' WHERE id=good;
  PERFORM public.backfill_pdf_sheet_designers(NULL, 100000);
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id=good AND designer_name='ROBIN')
    THEN RAISE EXCEPTION 'backfill did not replace literal null'; END IF;
  IF EXISTS (SELECT 1 FROM public.assets WHERE id=ordinary AND designer_name IS NOT NULL)
    THEN RAISE EXCEPTION 'non-sheet PDF wrote a designer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_files_used WHERE sku='ZZRESCAN1' AND file_name='CC100001')
    THEN RAISE EXCEPTION 'files used not added'; END IF;
  IF public.count_pdf_rescan_remaining() <> before_count THEN RAISE EXCEPTION 'queue did not drain'; END IF;
END $$;
ROLLBACK;
