-- popcre/shared-db#6011 / u2giants/popdam3#907: COMP / COMPVIEW / COMP-VIEW /
-- COMP_VIEW files rank as cover right after "3-4" and mockup files.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  g uuid;
  winner uuid;
  t record;
  got integer;
  a_comp uuid;
begin
  for t in
    select * from (values
      ('ZZ6011 3-4 front.psd',        'psd', true,  1),
      ('ZZ6011 mockup.psd',           'psd', true,  2),
      ('ZZ6011_COMP.psd',             'psd', true,  3),
      ('ZZ6011 COMPVIEW.jpg',         'jpg', true,  3),
      ('ZZ6011-COMP-VIEW.png',        'png', true,  3),
      ('ZZ6011_comp_view.ai',         'ai',  true,  3),
      ('ZZ6011 comp view art.psd',    'psd', true,  3),
      ('ZZ6011 art.psd',              'psd', true,  4),
      ('ZZ6011 techpack.pdf',         'pdf', true,  5),
      ('ZZ6011 complete.psd',         'psd', true,  6),
      ('ZZ6011 component.psd',        'psd', true,  6),
      ('ZZ6011 compare.psd',          'psd', true,  6),
      ('ZZ6011 packaging.psd',        'psd', true,  7),
      ('ZZ6011 sheet.pdf',            'pdf', true,  8),
      ('ZZ6011 mockup.psd',           'psd', false, 9),
      ('ZZ6011_COMP.psd',             'psd', false, 10),
      ('ZZ6011 art.psd',              'psd', false, 11),
      ('ZZ6011 techpack.pdf',         'pdf', false, 12),
      ('ZZ6011 plain.psd',            'psd', false, 13),
      ('ZZ6011 packaging.psd',        'psd', false, 14)
    ) v(fname, ftype, thumb, want)
  loop
    insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url)
      values (t.fname, 'zz6011/' || t.fname || gen_random_uuid()::text, t.ftype::public.file_type, gen_random_uuid()::text, now(),
              case when t.thumb then 'https://example.invalid/t.png' end)
      returning primary_sort_tier into got;
    if got is distinct from t.want then
      raise exception 'tier for % (thumb=%) = %, expected %', t.fname, t.thumb, got, t.want;
    end if;
  end loop;

  -- Group winner: comp beats art, loses to mockup.
  insert into public.style_groups (sku, folder_path) values ('ZZ6011G', '/zz6011/g') returning id into g;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, style_group_id)
    values ('ZZ6011G art.psd', 'zz6011/g/art.psd', 'psd', 'zz6011ga', now() - interval '1 day', 'https://example.invalid/a.png', g);
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, style_group_id)
    values ('ZZ6011G_COMP.psd', 'zz6011/g/comp.psd', 'psd', 'zz6011gc', now(), 'https://example.invalid/c.png', g)
    returning id into a_comp;
  perform public.refresh_style_group_primaries(array[g]);
  select primary_asset_id into winner from public.style_groups where id = g;
  if winner is distinct from a_comp then
    raise exception 'comp asset should be the group primary over art';
  end if;

  -- Former tie (both old tier 3): an older pure-art file and a newer
  -- "comp ... art" file. The comp file must now win.
  insert into public.style_groups (sku, folder_path) values ('ZZ6011H', '/zz6011/h') returning id into g;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, style_group_id, created_at)
    values ('ZZ6011H art.psd', 'zz6011/h/art.psd', 'psd', 'zz6011ha', now(), 'https://example.invalid/a.png', g, now() - interval '1 day');
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, style_group_id)
    values ('ZZ6011H comp art.psd', 'zz6011/h/comp-art.psd', 'psd', 'zz6011hc', now(), 'https://example.invalid/c.png', g)
    returning id into a_comp;
  perform public.refresh_style_group_primaries(array[g]);
  select primary_asset_id into winner from public.style_groups where id = g;
  if winner is distinct from a_comp then
    raise exception 'comp+art asset should beat an older pure-art asset';
  end if;

  if not exists (
    select 1 from pg_indexes
    where indexname = 'idx_assets_ai_tag_all_candidates' and indexdef like '%ARRAY[5, 9]%'
  ) then
    raise exception 'AI-tag candidate index must exclude tiers 5 and 9';
  end if;
end;
$test$;

rollback;
