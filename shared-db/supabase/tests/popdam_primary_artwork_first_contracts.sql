-- #5250 contracts: artwork beats document pages for style-group primary
-- selection, and the tier ladder keeps its other orderings intact.
-- All fixture values are synthetic and carry the ZZ5250 prefix.
begin;

do $$
declare
  v_group uuid := 'ffffffff-5250-4000-8000-000000000010';
  v_pdf_early uuid := 'ffffffff-5250-4000-8000-000000000001';
  v_psd_late uuid := 'ffffffff-5250-4000-8000-000000000002';
  v_pdf_nothumb uuid := 'ffffffff-5250-4000-8000-000000000003';
  v_mockup_nothumb uuid := 'ffffffff-5250-4000-8000-000000000004';
  v_primary uuid;
begin
  insert into public.style_groups(id, sku, folder_path)
  values (v_group, 'ZZ5250-' || txid_current(), 'ZZ5250/A');

  -- Neutral-named PDF created FIRST (would win the old tier-5 tie by
  -- created_at), neutral-named PSD created later: artwork must win.
  insert into public.assets(
    id, filename, relative_path, file_type, quick_hash, modified_at,
    style_group_id, is_deleted, thumbnail_url, thumbnail_error, created_at
  ) values
    (v_pdf_early, 'ZZ5250_sheet.pdf', 'ZZ5250/A/sheet.pdf', 'pdf',
      'zz5250-pdf-' || txid_current(), now(), v_group, false,
      'https://example.invalid/zz5250-pdf.jpg', null, now() - interval '9 days'),
    (v_psd_late, 'ZZ5250_design.psd', 'ZZ5250/A/design.psd', 'psd',
      'zz5250-psd-' || txid_current(), now(), v_group, false,
      'https://example.invalid/zz5250-psd.jpg', null, now());

  perform public.refresh_style_group_primaries(array[v_group]);

  select primary_asset_id into v_primary from public.style_groups where id = v_group;
  if v_primary is distinct from v_psd_late then
    raise exception 'ZZ5250: expected artwork PSD primary, got %', coalesce(v_primary::text, '<null>');
  end if;

  -- Tier numbers: neutral artwork+thumb = 5, neutral pdf+thumb = 7,
  -- pdf without thumbnail = 11 (below every renderable tier),
  -- mockup without thumbnail = 8 (renders above nothing-but-no-thumb tiers).
  if (select primary_sort_tier from public.assets where id = v_psd_late) <> 5 then
    raise exception 'ZZ5250: artwork-with-thumbnail tier expected 5';
  end if;
  if (select primary_sort_tier from public.assets where id = v_pdf_early) <> 7 then
    raise exception 'ZZ5250: pdf-with-thumbnail tier expected 7';
  end if;

  insert into public.assets(
    id, filename, relative_path, file_type, quick_hash, modified_at,
    style_group_id, is_deleted, thumbnail_url, thumbnail_error, created_at
  ) values
    (v_pdf_nothumb, 'ZZ5250_plain.pdf', 'ZZ5250/A/plain.pdf', 'pdf',
      'zz5250-pdfnt-' || txid_current(), now(), v_group, false, null, null, now()),
    (v_mockup_nothumb, 'ZZ5250_mockup.psd', 'ZZ5250/A/mockup.psd', 'psd',
      'zz5250-mkup-' || txid_current(), now(), v_group, false, null, null, now());

  if (select primary_sort_tier from public.assets where id = v_pdf_nothumb) <> 11 then
    raise exception 'ZZ5250: pdf-without-thumbnail tier expected 11';
  end if;
  if (select primary_sort_tier from public.assets where id = v_mockup_nothumb) <> 8 then
    raise exception 'ZZ5250: mockup-without-thumbnail tier expected 8';
  end if;

  -- A renderable PDF still beats a no-thumbnail mockup when it is the only
  -- rendered candidate: primary over the whole group must stay a
  -- thumbnail-bearing asset.
  perform public.refresh_style_group_primaries(array[v_group]);
  select primary_asset_id into v_primary from public.style_groups where id = v_group;
  if v_primary is distinct from v_psd_late then
    raise exception 'ZZ5250: primary changed unexpectedly after no-thumbnail inserts: %', coalesce(v_primary::text, '<null>');
  end if;
end $$;

rollback;

begin;

-- #5259 amendment: a file_type correction must recompute the tier (trigger
-- watches file_type), and artwork is the complement of 'pdf'.
do $$
declare
  v_group uuid := 'ffffffff-5259-4000-8000-000000000010';
  v_pdf uuid := 'ffffffff-5259-4000-8000-000000000001';
begin
  insert into public.style_groups(id, sku, folder_path)
  values (v_group, 'ZZ5259-' || txid_current(), 'ZZ5259/A');

  insert into public.assets(
    id, filename, relative_path, file_type, quick_hash, modified_at,
    style_group_id, is_deleted, thumbnail_url, thumbnail_error
  ) values
    (v_pdf, 'ZZ5259_sheet.pdf', 'ZZ5259/A/sheet.pdf', 'pdf',
      'zz5259-pdf-' || txid_current(), now(), v_group, false,
      'https://example.invalid/zz5259.jpg', null);

  if (select primary_sort_tier from public.assets where id = v_pdf) <> 7 then
    raise exception 'ZZ5259: pdf-with-thumbnail tier expected 7';
  end if;

  -- Correct the file type: the trigger must recompute pdf(7) -> artwork(5)
  -- without any filename or thumbnail change.
  update public.assets set file_type = 'psd' where id = v_pdf;
  if (select primary_sort_tier from public.assets where id = v_pdf) <> 5 then
    raise exception 'ZZ5259: file_type correction did not recompute the tier (trigger must watch file_type)';
  end if;

  perform public.refresh_style_group_primaries(array[v_group]);
  if (select primary_asset_id from public.style_groups where id = v_group) is distinct from v_pdf then
    raise exception 'ZZ5259: sole artwork asset expected as primary';
  end if;
end $$;

rollback;
