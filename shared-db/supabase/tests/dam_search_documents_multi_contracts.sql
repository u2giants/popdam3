-- u2giants/popdam3#1430 Step 7: search_dam_documents_multi returns the EXACT deduplicated union of
-- its variants (disjoint, overlapping and nested sets), exact whole-group file totals, and pages
-- that tile the union with no skipped or repeated rows.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  ga uuid; gb uuid; gc uuid; gd uuid; n bigint; files bigint; ids uuid[]; p1 uuid[]; p2 uuid[];
  disjoint jsonb := '[{"query":"zq1430alpha"},{"query":"zq1430beta"}]';
  overlap jsonb := '[{"query":"zq1430alpha"},{"query":"zq1430shared"}]';
  nested jsonb := '[{"query":"zq1430shared"},{"query":"zq1430gamma"}]';
  r real;
begin
  -- ga: alpha+shared, gb: alpha, gc: beta+shared+gamma, gd: beta.  asset_count 1/2/4/8.
  insert into public.style_groups (sku, folder_path, asset_count) values ('ZQ1430A', '/zq1430/a', 1) returning id into ga;
  insert into public.style_groups (sku, folder_path, asset_count) values ('ZQ1430B', '/zq1430/b', 2) returning id into gb;
  insert into public.style_groups (sku, folder_path, asset_count) values ('ZQ1430C', '/zq1430/c', 4) returning id into gc;
  insert into public.style_groups (sku, folder_path, asset_count) values ('ZQ1430D', '/zq1430/d', 8) returning id into gd;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  values ('zq1430a.pdf','zq1430/a.pdf','pdf','zq1430a', now(), now(), 'https://example.invalid/a.png', ga),
         ('zq1430b.pdf','zq1430/b.pdf','pdf','zq1430b', now(), now(), 'https://example.invalid/b.png', gb),
         ('zq1430c.pdf','zq1430/c.pdf','pdf','zq1430c', now(), now(), 'https://example.invalid/c.png', gc),
         ('zq1430d.pdf','zq1430/d.pdf','pdf','zq1430d', now(), now(), 'https://example.invalid/d.png', gd);
  update public.style_groups set asset_count = 1 where id = ga;
  update public.style_groups set asset_count = 2 where id = gb;
  update public.style_groups set asset_count = 4 where id = gc;
  update public.style_groups set asset_count = 8 where id = gd;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  values ('style_group', ga, null, ga, 'zq1430alpha zq1430shared', '/lampstone/a'),
         ('style_group', gb, null, gb, 'zq1430alpha', '/lampstone/b'),
         ('style_group', gc, null, gc, 'zq1430beta zq1430shared zq1430gamma', '/lampstone/c'),
         ('style_group', gd, null, gd, 'zq1430beta', '/lampstone/d')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path;

  -- Disjoint: |A| + |B|, not max.
  select min(total_count), min(total_group_files), array_agg(entity_id) into n, files, ids
  from public.search_dam_documents_multi(disjoint, 50, 0, array['style_group']);
  if n <> 4 or files <> 15 or not ids @> array[ga,gb,gc,gd] then
    raise exception 'popdam3#1430 disjoint union: total % files % ids %', n, files, ids;
  end if;

  -- Overlapping: ga matched by both counts once (total 3, files 1+2+4).
  select min(total_count), min(total_group_files), array_agg(entity_id) into n, files, ids
  from public.search_dam_documents_multi(overlap, 50, 0, array['style_group']);
  if n <> 3 or files <> 7 or cardinality(ids) <> 3 then
    raise exception 'popdam3#1430 overlapping union: total % files % rows %', n, files, cardinality(ids);
  end if;
  -- The shared row keeps the better rank of the two variants.
  select rank into r from public.search_dam_documents_multi(overlap, 50, 0, array['style_group']) where entity_id = ga;
  if r < (select max(x.rank) from (
      select rank from public.search_dam_documents('zq1430alpha', '{}', 50, 0, array['style_group']) where entity_id = ga
      union all
      select rank from public.search_dam_documents('zq1430shared', '{}', 50, 0, array['style_group']) where entity_id = ga) x) then
    raise exception 'popdam3#1430 overlap lost the best rank';
  end if;

  -- Nested: gamma is inside shared; the union equals the superset, facets exact (not blank).
  select min(total_count), min(total_group_files) into n, files
  from public.search_dam_documents_multi(nested, 50, 0, array['style_group']);
  if n <> 2 or files <> 5 then raise exception 'popdam3#1430 nested union: total % files %', n, files; end if;
  if (select facets->>'fileType' from public.search_dam_documents_multi(nested, 50, 0, null) limit 1) = '{}' then
    raise exception 'popdam3#1430 nested union should carry the superset variant facets';
  end if;

  -- Paging: two pages of 2 tile the disjoint union exactly, has_more on page 1 only.
  select array_agg(entity_id) into p1 from public.search_dam_documents_multi(disjoint, 2, 0, array['style_group']);
  select array_agg(entity_id) into p2 from public.search_dam_documents_multi(disjoint, 2, 2, array['style_group']);
  if cardinality(p1) <> 2 or cardinality(p2) <> 2 or p1 && p2 or not (p1 || p2) @> array[ga,gb,gc,gd] then
    raise exception 'popdam3#1430 pages do not tile the union';
  end if;
  if not (select bool_and(has_more) from public.search_dam_documents_multi(disjoint, 2, 0, array['style_group']))
     or (select bool_or(has_more) from public.search_dam_documents_multi(disjoint, 2, 2, array['style_group'])) then
    raise exception 'popdam3#1430 has_more is not exact';
  end if;

  -- Invalid input is refused.
  begin
    perform public.search_dam_documents_multi('[]', 10, 0);
    raise exception 'popdam3#1430 empty variants accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$test$;

-- An authenticated caller without DAM access is refused.
do $test$
begin
  if has_function_privilege('anon', 'public.search_dam_documents_multi(jsonb,integer,integer,text[],real,real,real,real,boolean)', 'execute') then
    raise exception 'popdam3#1430 anon can execute search_dam_documents_multi';
  end if;
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000001430","role":"authenticated"}', true);
do $test$
begin
  perform public.search_dam_documents_multi('[{"query":"zq1430alpha"}]', 10, 0);
  raise exception 'popdam3#1430 caller without DAM access was not refused';
exception when insufficient_privilege then null;
end;
$test$;
reset role;
rollback;
