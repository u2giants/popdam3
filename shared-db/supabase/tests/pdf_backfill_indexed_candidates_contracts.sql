-- #3282 behavioral contracts: ephemeral database only; fixtures roll back.
BEGIN;
DO $$
DECLARE
  ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  before_count bigint := public.count_pdf_backfill_remaining();
  actual uuid[];
  expected uuid[];
BEGIN
  -- Compare truth values, including NULLs and uppercase filename extensions,
  -- independently of the production columns' NOT NULL constraints.
  IF EXISTS (
    SELECT 1 FROM (VALUES (NULL::public.file_type), ('pdf'::public.file_type), ('ai'::public.file_type)) t(ft)
    CROSS JOIN (VALUES (NULL::text), (''), ('LICENSING SHEET.PDF'), ('ordinary.pdf'), ('tech_pack.pdf')) n(fn)
    WHERE public.is_style_guide_source_pdf(t.ft::text,n.fn)
      IS DISTINCT FROM (t.ft='pdf'::public.file_type AND public.is_style_guide_source_pdf('pdf',n.fn))
  ) THEN RAISE EXCEPTION 'typed predicate changes NULL or filename semantics'; END IF;
  INSERT INTO public.assets(id,filename,relative_path,file_type,quick_hash,modified_at,is_deleted,thumbnail_url)
  SELECT ids[n], names[n], 'ZZ3282/' || ids[n], types[n]::public.file_type,
         ids[n]::text, now(), n=5, CASE WHEN n=2 THEN 'fixture-thumbnail' END
  FROM (SELECT ARRAY['Licensing Sheet.pdf','TECHPACK.pdf','ordinary.pdf','license_sheet.ai','tech pack deleted.pdf','license sheet completed.pdf','tech_pack.pdf'] names,
               ARRAY['pdf','pdf','pdf','ai','pdf','pdf','pdf'] types) f,
       generate_series(1,7) n;
  INSERT INTO public.pdf_text_samples(asset_id,filename,relative_path,extraction_method) VALUES(ids[6],'license sheet completed.pdf','ZZ3282/completed.pdf','pdf_text');
  IF public.count_pdf_backfill_remaining() <> before_count + 3 THEN
    RAISE EXCEPTION 'claim eligibility changed';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO actual FROM public.claim_pdf_backfill_batch(NULL) WHERE id=ANY(ids);
  SELECT array_agg(id ORDER BY id) INTO expected FROM unnest(ARRAY[ids[1],ids[2],ids[7]]) id;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'wrong eligible fixture set'; END IF;
  IF EXISTS(SELECT 1 FROM public.claim_pdf_backfill_batch(NULL) WHERE id=ids[1] AND NOT needs_thumbnail)
    OR EXISTS(SELECT 1 FROM public.claim_pdf_backfill_batch(NULL) WHERE id=ids[2] AND needs_thumbnail)
    THEN RAISE EXCEPTION 'thumbnail flags changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.claim_pdf_backfill_batch(0)) THEN RAISE EXCEPTION 'zero limit changed'; END IF;
  IF (SELECT count(*) FROM public.claim_pdf_backfill_batch(1)) <> 1 THEN RAISE EXCEPTION 'one limit changed'; END IF;
  SELECT array_agg(id ORDER BY id) INTO actual FROM public.claim_pdf_backfill_batch(25);
  SELECT array_agg(id ORDER BY id) INTO expected FROM (
    SELECT a.id FROM public.assets a WHERE a.is_deleted=false
      AND public.is_style_guide_source_pdf(a.file_type::text,a.filename)
      AND NOT EXISTS(SELECT 1 FROM public.pdf_text_samples p WHERE p.asset_id=a.id)
    ORDER BY a.id LIMIT 25
  ) original;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'original query order or eligibility differs'; END IF;
  IF public.count_pdf_backfill_remaining() <> (SELECT count(*) FROM public.claim_pdf_backfill_batch(NULL))
    THEN RAISE EXCEPTION 'claim/count disagree'; END IF;
  BEGIN
    PERFORM * FROM public.claim_pdf_backfill_batch(-1);
    RAISE EXCEPTION 'negative limit accepted';
  EXCEPTION WHEN invalid_row_count_in_limit_clause THEN NULL;
  END;
END;
$$;
ROLLBACK;
