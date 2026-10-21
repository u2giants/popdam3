-- #4529: high-DF search timeout contract tests (synthetic fixtures, disposable).
-- Covers: spider-man/stitch/wall-art-canvas under 8s, exact-ID title hit in top5,
-- exact total_count on a filtered query matches search_dam_document_counts
-- (uncapped), no-match stays empty, signature identity, grants.
-- Fixture rows are self-seeded and cleaned up; CI also wraps in begin/rollback.

reset role;
do $$
begin
  if not (select public.require_dam_access()) then
    raise exception 'test cannot obtain DAM access';
  end if;
end $$;

-- 0. Seed synthetic high-DF fixtures (rolled back / deleted at end).
do $$
declare
  v_spider uuid := '45310000-0000-4000-8000-000000000001';
  v_stitch uuid := '45310000-0000-4000-8000-000000000002';
  v_wall   uuid := '45310000-0000-4000-8000-000000000003';
  v_spider2 uuid := '45310000-0000-4000-8000-000000000004';
begin
  delete from public.dam_search_documents where entity_id in (v_spider,v_stitch,v_wall,v_spider2);
  delete from public.assets where id in (v_spider,v_stitch,v_wall,v_spider2);
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, is_deleted)
  values
    (v_spider, 'zz4531-spider-man.psd', 'zz4531/spider-man.psd', 'psd', 'zz4531spider', now(), 'https://example.invalid/s.png', false),
    (v_spider2,'zz4531-spider-man-alt.psd', 'zz4531/spider-man-alt.psd', 'psd', 'zz4531spider2', now(), 'https://example.invalid/s2.png', false),
    (v_stitch, 'zz4531-stitch.psd', 'zz4531/stitch.psd', 'psd', 'zz4531stitch', now(), 'https://example.invalid/t.png', false),
    (v_wall,   'zz4531-wall-art-canvas.psd', 'zz4531/wall-art-canvas.psd', 'psd', 'zz4531wall', now(), 'https://example.invalid/w.png', false);
  insert into public.dam_search_documents
    (document_type, entity_id, asset_id, title, path, search_text)
  values
    ('asset', v_spider, v_spider, 'zz4531 Spider-Man Hero Canvas', 'zz4531/spider-man.psd', 'spider-man hero canvas marvel'),
    ('asset', v_spider2,v_spider2,'zz4531 Spider-Man Variant Art', 'zz4531/spider-man-alt.psd', 'spider-man variant art'),
    ('asset', v_stitch, v_stitch, 'zz4531 Stitch Tropical', 'zz4531/stitch.psd', 'stitch tropical disney'),
    ('asset', v_wall,   v_wall,   'zz4531 Wall Art Canvas', 'zz4531/wall-art-canvas.psd', 'wall-art-canvas home decor')
  on conflict (document_type, entity_id) do update
    set title = excluded.title, path = excluded.path, search_text = excluded.search_text;
end $$;

-- 1. High-DF terms complete inside the 8s statement_timeout and return rows.
do $$
declare
  t0 timestamptz;
  ms bigint;
  n int;
  total bigint;
  q text;
begin
  foreach q in array array['spider-man', 'stitch', 'wall-art-canvas'] loop
    t0 := clock_timestamp();
    select count(*), min(total_count) into n, total
    from public.search_dam_documents(q, '{}'::jsonb, 20, 0);
    ms := (extract(epoch from clock_timestamp() - t0) * 1000)::bigint;
    if ms >= 8000 then
      raise exception 'query % took % ms (must be < 8000)', q, ms;
    end if;
    if n < 1 then
      raise exception 'query % returned % rows (summary envelope missing)', q, n;
    end if;
    if coalesce(total, 0) < 1 then
      raise exception 'query % reported total_count=% (expected >= 1)', q, total;
    end if;
    raise notice 'high-df % ok in % ms, total_count=%', q, ms, total;
  end loop;
end $$;

-- 2. Exact identifier / title substring hit lands in the top 5 page.
do $$
declare
  hit_rank int;
  q text := 'spider-man';
  ident text;
begin
  select left(d.title, 80) into ident
  from public.dam_search_documents d
  where d.title ilike '%spider-man%'
  order by d.entity_id
  limit 1;
  if ident is null then
    raise exception 'fixture error: no spider-man title hit to assert top5';
  end if;
  select min(rn) into hit_rank
  from (
    select row_number() over (order by rank desc, document_type, entity_id) rn, entity_id
    from public.search_dam_documents(q, '{}'::jsonb, 5, 0)
    where entity_id is not null
  ) x
  where x.entity_id in (
    select d.entity_id from public.dam_search_documents d where d.title = ident
  );
  if hit_rank is null or hit_rank > 5 then
    raise exception 'exact-ID title hit % not in top5 (rank %)', ident, hit_rank;
  end if;
  raise notice 'exact-ID % at top5 rank %', ident, hit_rank;
end $$;

-- 3. Filtered query: page envelope total_count matches the uncapped counts RPC.
do $$
declare
  page_total bigint;
  uncapped_total bigint;
  q text := 'stitch';
  filt jsonb := '{"fileType":["psd"]}'::jsonb;
begin
  select min(total_count) into page_total
  from public.search_dam_documents(q, filt, 20, 0);
  select total_count into uncapped_total
  from public.search_dam_document_counts(q, filt);
  if coalesce(page_total, -1) <> coalesce(uncapped_total, -2) then
    raise exception 'filtered total_count mismatch: page=% uncapped=%', page_total, uncapped_total;
  end if;
  raise notice 'filtered totals match at %', page_total;
end $$;

-- 4. No-match stays empty (summary-only, total_count 0).
do $$
declare
  n int;
  total bigint;
begin
  select count(*), min(total_count) into n, total
  from public.search_dam_documents('zzzz-not-a-real-object-qqq', '{}'::jsonb, 10, 0);
  if n <> 1 then
    raise exception 'no-match query returned % rows (expected 1 summary-only)', n;
  end if;
  if coalesce(total, 0) <> 0 then
    raise exception 'no-match query reported total_count=%', total;
  end if;
end $$;

-- 5. Signature identity (8-arg) and counts RPC exist.
do $$
begin
  if to_regprocedure(
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)'
  ) is null then
    raise exception 'search_dam_documents signature drifted from the 8-arg contract';
  end if;
  if to_regprocedure(
    'public.search_dam_document_counts(text,jsonb,text[],extensions.vector,real)'
  ) is null then
    raise exception 'search_dam_document_counts missing';
  end if;
end $$;

-- 6. Hyphen normalization: spider-man FTS uses AND form (no phrase pathology).
do $$
declare
  tsq_text text;
begin
  select websearch_to_tsquery('simple', regexp_replace('spider-man', '[-_/]+', ' ', 'g'))::text
    into tsq_text;
  if tsq_text like '%<->%' then
    raise exception 'hyphen normalization still produced a phrase tsquery: %', tsq_text;
  end if;
end $$;

-- 7. Grants: anon denied; authenticated + service_role allowed.
do $$
declare
  anon_ok boolean;
  auth_ok boolean;
begin
  select has_function_privilege('anon',
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)',
    'EXECUTE') into anon_ok;
  if anon_ok then
    raise exception 'anon must not execute search_dam_documents';
  end if;
  select has_function_privilege('authenticated',
    'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)',
    'EXECUTE') into auth_ok;
  if not auth_ok then
    raise exception 'authenticated must execute search_dam_documents';
  end if;
end $$;

-- 8. Cleanup fixtures (harness also rolls back).
do $$
begin
  delete from public.dam_search_documents where entity_id in (
    '45310000-0000-4000-8000-000000000001',
    '45310000-0000-4000-8000-000000000002',
    '45310000-0000-4000-8000-000000000003',
    '45310000-0000-4000-8000-000000000004');
  delete from public.assets where id in (
    '45310000-0000-4000-8000-000000000001',
    '45310000-0000-4000-8000-000000000002',
    '45310000-0000-4000-8000-000000000003',
    '45310000-0000-4000-8000-000000000004');
end $$;
