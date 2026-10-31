-- #4529: high-DF search timeout contract tests (synthetic fixtures, disposable).
-- Covers: spider-man/stitch/wall-art-canvas under 8s, exact title ranked first,
-- consistent paging and exact has_more, exact vs lower-bound total flags,
-- no-match stays empty, signature identity, grants (#4529, 20261021152741).
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

-- 2. Exact identifier: a title equal to the query (extension, case and
--    separators ignored) ranks above every other keyword tier at position 1,
--    and title-substring hits fill the rest of the top 5 (#4529, 20261021152741).
do $$
declare
  v_exact uuid := '45310000-0000-4000-8000-000000000005';
  first_id uuid;
  first_rank real;
  top5_title_hits int;
begin
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, is_deleted)
  values (v_exact, 'zz4531spiderexact.psd', 'zz4531/zz4531spiderexact.psd', 'psd', 'zz4531spiderexact', now(), 'https://example.invalid/x.png', false)
  on conflict (id) do nothing;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, title, path, search_text)
  values ('asset', v_exact, v_exact, 'ZZ4531_Spider-Man.ai', 'zz4531/zz4531spiderexact.psd', 'zz4531 spider-man')
  on conflict (document_type, entity_id) do update
    set title = excluded.title, path = excluded.path, search_text = excluded.search_text;

  select entity_id, rank into first_id, first_rank
  from public.search_dam_documents('zz4531 spider-man', '{}'::jsonb, 5, 0)
  where entity_id is not null
  order by rank desc, document_type, entity_id
  limit 1;
  if first_id is distinct from v_exact or first_rank < 1.0 then
    raise exception 'exact title % not ranked first (got % at %)', v_exact, first_id, first_rank;
  end if;

  select count(*) into top5_title_hits
  from public.search_dam_documents('spider-man', '{}'::jsonb, 5, 0) r
  join public.dam_search_documents d on d.document_type = r.document_type and d.entity_id = r.entity_id
  where r.entity_id is not null and d.title ilike '%spider-man%';
  if top5_title_hits < 3 then
    raise exception 'spider-man top5 has only % title hits (fixtures seed 3)', top5_title_hits;
  end if;
end $$;

-- 3. Paging: consecutive pages equal one large page, has_more is exact, and a
--    page past the last row returns the summary envelope with has_more=false.
do $$
declare
  big uuid[];
  paged uuid[];
  last_more boolean;
  past_rows int;
  past_more boolean;
  n bigint;
begin
  select array_agg(entity_id order by rank desc, document_type, entity_id) into big
  from public.search_dam_documents('zz4531', '{}'::jsonb, 50, 0) where entity_id is not null;
  n := coalesce(array_length(big, 1), 0);
  if n < 5 then
    raise exception 'paging fixture too small: %', n;
  end if;
  select array_agg(entity_id order by pg, rank desc, document_type, entity_id) into paged
  from (
    select 1 pg, * from public.search_dam_documents('zz4531', '{}'::jsonb, 2, 0)
    union all select 2, * from public.search_dam_documents('zz4531', '{}'::jsonb, 2, 2)
    union all select 3, * from public.search_dam_documents('zz4531', '{}'::jsonb, 50, 4)
  ) x where entity_id is not null;
  if paged is distinct from big then
    raise exception 'paged results % differ from one page %', paged, big;
  end if;
  select bool_or(has_more) into last_more
  from public.search_dam_documents('zz4531', '{}'::jsonb, 2, (n - 2)::int);
  if last_more then
    raise exception 'has_more true on the last page';
  end if;
  select count(entity_id), bool_or(has_more) into past_rows, past_more
  from public.search_dam_documents('zz4531', '{}'::jsonb, 10, (n + 5)::int);
  if past_rows <> 0 or past_more then
    raise exception 'past-the-end page returned % rows, has_more %', past_rows, past_more;
  end if;
end $$;

-- 3b. Small result sets report exact totals and say so.
do $$
declare
  total bigint;
  f jsonb;
  filt_total bigint;
begin
  select min(total_count), (array_agg(facets))[1] into total, f
  from public.search_dam_documents('zz4531', '{}'::jsonb, 2, 0);
  if (f->>'totalExact')::boolean is not true or f->>'totalKind' <> 'exact' then
    raise exception 'small result set not flagged exact: %', f;
  end if;
  if total <> (select count(*) from public.search_dam_documents('zz4531', '{}'::jsonb, 1000, 0) where entity_id is not null) then
    raise exception 'exact total % does not equal the full result count', total;
  end if;
  select min(total_count) into filt_total
  from public.search_dam_documents('zz4531', '{"fileType":["psd"]}'::jsonb, 1, 0);
  if filt_total <> (select count(*) from public.search_dam_documents('zz4531', '{"fileType":["psd"]}'::jsonb, 1000, 0) where entity_id is not null) then
    raise exception 'filtered exact total % does not match its result count', filt_total;
  end if;
end $$;

-- 3c. Above the 1000-asset summary probe the total is EXACT (#5053: totals
--     are never lower bounds) and paging stays correct past the probe.
do $$
declare
  f jsonb;
  total bigint;
  more boolean;
  deep_rows int;
  deep_more boolean;
  deep_total bigint;
begin
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, is_deleted)
  select ('45350000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
    'zz4535lb-' || g || '.psd', 'zz4535lb/' || g || '.psd', 'psd', 'zz4535lb' || g, now(),
    'https://example.invalid/lb.png', false
  from generate_series(1, 2105) g
  on conflict (id) do nothing;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, title, path, search_text)
  select 'asset', ('45350000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
    ('45350000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
    'zz4535lb item ' || g, 'zz4535lb/' || g || '.psd', 'zz4535lb item'
  from generate_series(1, 2105) g
  on conflict (document_type, entity_id) do update
    set title = excluded.title, path = excluded.path, search_text = excluded.search_text;

  select min(total_count), bool_or(has_more), (array_agg(facets))[1] into total, more, f
  from public.search_dam_documents('zz4535lb', '{}'::jsonb, 20, 0);
  if (f->>'totalExact')::boolean is not true or f->>'totalKind' <> 'exact' then
    raise exception 'large result set not flagged exact: %', f;
  end if;
  -- #5053: past the probe the per-key facet counts would be lower bounds, so
  -- the same five keys must be present and BLANKED, never dropped or under-counted.
  if f->'fileType' is distinct from '{}'::jsonb or f->'status' is distinct from '{}'::jsonb
     or f->'workflowStatus' is distinct from '{}'::jsonb or f->'stage' is distinct from '{}'::jsonb
     or f->'isLicensed' is distinct from '{}'::jsonb then
    raise exception 'truncated facets must keep their keys blanked: %', f;
  end if;
  if not more or total <> 2105 then
    raise exception 'exact total % / has_more % inconsistent', total, more;
  end if;

  select count(entity_id), bool_or(has_more), min(total_count) into deep_rows, deep_more, deep_total
  from public.search_dam_documents('zz4535lb', '{}'::jsonb, 20, 2100);
  if deep_rows <> 5 or deep_more or deep_total <> 2105 then
    raise exception 'page past the probe: rows %, has_more %, total %', deep_rows, deep_more, deep_total;
  end if;

  delete from public.dam_search_documents where entity_id in (
    select ('45350000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 2105) g);
  delete from public.assets where id in (
    select ('45350000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 2105) g);
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
  -- 20261021152741 retired the unused counts helper; totals carry
  -- facets.totalExact instead.
  if to_regprocedure(
    'public.search_dam_document_counts(text,jsonb,text[],extensions.vector,real)'
  ) is not null then
    raise exception 'search_dam_document_counts should be retired';
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
    '45310000-0000-4000-8000-000000000004',
    '45310000-0000-4000-8000-000000000005');
  delete from public.assets where id in (
    '45310000-0000-4000-8000-000000000001',
    '45310000-0000-4000-8000-000000000002',
    '45310000-0000-4000-8000-000000000003',
    '45310000-0000-4000-8000-000000000004',
    '45310000-0000-4000-8000-000000000005');
end $$;
