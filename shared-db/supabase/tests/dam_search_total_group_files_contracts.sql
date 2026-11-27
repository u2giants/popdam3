-- u2giants/popdam3#1430 Phase 1 Step 1 (claim popcre/shared-db#7163):
--   * p_include_facets = false returns the same ordered rows, ranks, total_count,
--     total_group_files and has_more as true, with facets = '{}'.
--   * total_group_files is the exact sum of style_groups.asset_count over every
--     visible matching style group (> 200 groups, and groups ranked past 200 under a
--     filter), on both the flag fast path and the per-document probe path.
--   * style-group-only named searches (asset sets skipped) equal the all-types rows.
--   * API roles without execute (anon) are refused.
begin;
set local search_path = pg_catalog, public, extensions;

create function pg_temp.t1430(p_q text, p_f jsonb, p_limit int, p_offset int, p_types text[], p_facets boolean)
returns jsonb language sql as $$
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_array(r.document_type, r.entity_id, r.rank, r.keyword_rank, r.semantic_rank)
              order by r.rank desc nulls last, r.document_type nulls last, r.entity_id nulls last)
              filter (where r.entity_id is not null), '[]'::jsonb),
    'total', min(r.total_count), 'group_files', min(r.total_group_files),
    'has_more', bool_and(r.has_more), 'facets', min(r.facets::text)::jsonb)
  from public.search_dam_documents(p_q, p_f, p_limit, p_offset, p_types, null, 0, null,
    p_include_facets => p_facets) r
$$;

do $test$
declare
  t jsonb; f jsonb; want bigint; want_lic bigint; q text := 'zq1430token';
  probe_f jsonb := '{"customer":""}'::jsonb; lic_f jsonb;
begin
  -- 230 visible groups; groups 1..5 and 221..230 hold .ai files (ranked past 200 when
  -- the title weight below orders them), plus 5 hidden groups that must not count.
  insert into public.style_groups (id, sku, folder_path)
  select md5('zq1430-g' || i)::uuid, 'ZQ1430G' || i, '/zq1430/' || i
  from generate_series(1, 235) i;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at,
                             thumbnail_url, style_group_id)
  select 'zq1430-' || i || '-' || j || '.pdf', 'zq1430/' || i || '/' || j || '.pdf',
         case when i <= 5 or i between 221 and 230 then 'ai' else 'pdf' end::public.file_type,
         'zq1430-' || i || '-' || j,
         case when i > 230 then '1990-01-01'::timestamptz else now() end,
         case when i > 230 then '1990-01-01'::timestamptz else now() end,
         case when i > 230 then null else 'https://example.invalid/g.png' end,
         md5('zq1430-g' || i)::uuid
  from generate_series(1, 235) i, generate_series(1, 1 + i % 4) j;
  update public.style_groups set asset_count = 1 + (substr(sku, 8)::int) % 4 + 10
  where sku like 'ZQ1430G%';
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  select 'style_group', md5('zq1430-g' || i)::uuid, null, md5('zq1430-g' || i)::uuid,
         q || repeat(' ' || q, case when i <= 200 then 1 else 0 end) || ' group ' || i, '/zq1430/' || i
  from generate_series(1, 235) i
  on conflict (document_type, entity_id) do update
    set asset_id = excluded.asset_id, style_group_id = excluded.style_group_id,
        title = excluded.title, path = excluded.path;

  select sum(asset_count) into want from public.style_groups
  where sku like 'ZQ1430G%' and substr(sku, 8)::int <= 230;
  select sum(asset_count) into want_lic from public.style_groups
  where sku like 'ZQ1430G%' and (substr(sku, 8)::int <= 5 or substr(sku, 8)::int between 221 and 230);
  lic_f := '{"fileType":["ai"]}'::jsonb;

  -- Fast path and probe path, > 200 groups, any page window.
  foreach f in array array['{}'::jsonb, probe_f] loop
    t := pg_temp.t1430(q, f, 25, 0, array['style_group'], true);
    if (t->>'total')::bigint <> 230 or (t->>'group_files')::bigint <> want then
      raise exception '#1430 groups total=% files=% (want 230 / %) filters=%', t->>'total', t->>'group_files', want, f;
    end if;
    if (pg_temp.t1430(q, f, 10, 215, array['style_group'], true)->>'group_files')::bigint <> want then
      raise exception '#1430 total_group_files depends on offset (filters=%)', f;
    end if;
    -- p_include_facets = false: identical except facets
    if pg_temp.t1430(q, f, 25, 0, array['style_group'], false) - 'facets'
       is distinct from t - 'facets'
       or pg_temp.t1430(q, f, 25, 0, array['style_group'], false)->'facets' <> '{}'::jsonb then
      raise exception '#1430 include_facets=false changed the result (filters=%)', f;
    end if;
  end loop;

  -- Filtered groups ranked past 200 are counted.
  t := pg_temp.t1430(q, lic_f, 5, 0, array['style_group'], false);
  if (t->>'total')::bigint <> 15 or (t->>'group_files')::bigint <> want_lic then
    raise exception '#1430 filtered total=% files=% (want 15 / %)', t->>'total', t->>'group_files', want_lic;
  end if;
  if t - 'facets' is distinct from pg_temp.t1430(q, lic_f, 5, 0, array['style_group'], true) - 'facets' then
    raise exception '#1430 include_facets=false changed the filtered result';
  end if;

  -- Asset-only searches report no group file total.
  if pg_temp.t1430(q, '{}', 5, 0, array['asset'], true)->'group_files' <> 'null'::jsonb then
    raise exception '#1430 asset-only search must return null total_group_files';
  end if;

  -- Facets still computed when requested on a small result.
  t := pg_temp.t1430(q, lic_f, 5, 0, null, true);
  if t->'facets'->>'totalExact' is distinct from 'true' then
    raise exception '#1430 facets missing when requested: %', t->'facets';
  end if;
end;
$test$;

-- Named character scope: style-group-only search skips asset sets, same rows.
do $test$
declare
  ch uuid; g uuid; a uuid; q text := 'zq1430named';
  only_groups jsonb; all_types jsonb;
begin
  insert into core.character (name) values ('Zq1430 Hero') returning id into ch;
  insert into public.style_groups (sku, folder_path) values ('ZQ1430N', '/zq1430n') returning id into g;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at,
                             thumbnail_url, style_group_id)
  values ('zq1430n.pdf', 'zq1430n/zq1430n.pdf', 'pdf', 'zq1430n', now(), now(), 'https://example.invalid/n.png', g)
  returning id into a;
  insert into public.style_groups (sku, folder_path) values ('ZQ1430M', '/zq1430m');
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  select 'style_group', sg.id, null, sg.id, q || ' group', sg.folder_path
  from public.style_groups sg where sg.sku in ('ZQ1430N', 'ZQ1430M')
  on conflict (document_type, entity_id) do update set title = excluded.title;

  only_groups := pg_temp.t1430(q, jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch)),
    10, 0, array['style_group'], true);
  select jsonb_agg(x) into all_types
  from jsonb_array_elements(pg_temp.t1430(q, jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch)),
    10, 0, null, true)->'rows') x where x->>0 = 'style_group';
  if coalesce(only_groups->'rows', '[]') is distinct from coalesce(all_types, '[]') then
    raise exception '#1430 group-only named scope differs: % vs %', only_groups->'rows', all_types;
  end if;
end;
$test$;

-- API role without execute is refused.
set local role anon;
do $test$
begin
  perform public.search_dam_documents('zq1430token', '{}'::jsonb, 5, 0, null, null, 0, null);
  raise exception '#1430 anon could execute search_dam_documents';
exception when insufficient_privilege then null;
end;
$test$;
reset role;

rollback;
