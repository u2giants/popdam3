-- #4529 / PopDAM #97: re-land of the reviewed DAM search repair as one added
-- migration so the single-source automatic promotion can apply it.
-- Same 8-arg search_dam_documents signature. Drops the unused
-- search_dam_document_counts helper.
-- derived-from: 20261020230556
-- SUPERSEDES (never promote these after this version): 20261021063716 and
-- 20261021152741. Neither reached production. This file's SQL is identical to
-- 20261021152741 on main (PRs #4543/#4555, reviewed APPROVE); only this header
-- differs. It drops and recreates every object it writes.
--
-- What 20261021063716 got wrong, and what this migration does instead:
--   * It capped FTS candidates at 1000-8000 rows ordered by UUID before
--     ranking. Here EVERY keyword and semantic candidate is ranked first,
--     with no cap before ranking.
--   * Exact-ID rows could fall outside that cap. Here a title equal to the
--     query (case-, separator- and file-extension-insensitive) ranks 1.0,
--     above every other keyword tier, over the complete match set.
--   * Pages past the cap came back empty with has_more=false. Here the page
--     is the first offset+limit visible documents in rank order, found by a
--     rank-ordered probe that is independent of any bound, and has_more is
--     exact (the probe reads one document past the page).
--
-- Relevance (keyword_rank), computed from short display columns only:
--   1.00 title equals the query      0.30 path contains the query
--   0.60 title contains the query    0.20 customer/program contains it
--   0.45 title matches the FTS query 0.10 match only in the wider text
--   plus up to 0.09 for title tightness (query length / title length).
-- search_tsv is never projected or ranked (ts_rank_cd over it cost 9.7s for
-- spider-man's 23,968 matches on production, 2026-10-21).
--
-- Totals contract (CHANGED from 20261020230556 fix 6, explicitly):
--   total_count and facets are computed from a rank-ordered visibility probe
--   of at most summary_probe_limit (1000) assets. When every visible
--   candidate fits inside that probe, total_count and facets are EXACT and
--   facets.totalExact = true, facets.totalKind = 'exact'. Otherwise they are
--   an exact count over the probed prefix and therefore a LOWER BOUND:
--   facets.totalExact = false, facets.totalKind = 'lower_bound', and
--   total_count >= offset + rows returned (+1 when has_more). Consumers must
--   show a lower-bound total as "N+" (popdam3#97 follow-up before hybrid
--   mode is activated; keyword mode does not read these totals).
--   Why: an exact visibility pass over 20k-50k high-DF keys reads ~20k random
--   rows of the ~2 GB assets heap (6.8-16s measured cold on production), so
--   exact totals and an 8s page cannot both hold for these queries.
--
-- Measured on production (qsllyeztdwjgirsysgai, 2026-10-21, read-only,
-- generic plan of this exact body via PREPARE + EXPLAIN ANALYZE, live load):
--   spider-man       2.2s total; 24,022 candidates ranked; page_documents
--                    Limit stopped at 21 rows in 0.6ms; visible_assets Limit
--                    stopped at 1,001 rows (of ~42k candidate assets).
--   stitch           1.8s total; 17,759 ranked; page Limit 21 rows in 0.4ms.
--   wall-art-canvas  9.7-11.2s total (still over 8s): 49,816 ranked; 3.9s is
--                    the pre-existing trigram substring leg over 4 synonym
--                    patterns (0 rows), ~5s ranking 2 normalized queries.
--   The probes are early-stopping by plan: Limit -> Nested Loop over the
--   rank-sorted candidates, never a full visibility pass.
--
-- Unchanged: hyphen-normalized AND-only tsqueries and the pinned indexable
-- scan, LIKE escaping and the alphanumeric substring guard, semantic leg
-- (gte-small/384 predicate, floor before blend, 50k cap, * 0.35 blend),
-- visibility predicate, summary envelope (null-entity row), 8s timeout,
-- grants. No SEARCH_MODE change. No PopSG object is touched.

drop function if exists public.search_assets_full_text(text,int); -- recreated below
drop function if exists public.search_style_groups_full_text(text,int); -- recreated below
drop function if exists public.search_dam_document_counts(text,jsonb,text[],extensions.vector(384),real); -- retired (no consumer)

create or replace function public.search_dam_documents(
  p_query text, p_filters jsonb, p_limit int, p_offset int,
  p_document_types text[] default null,
  p_query_embedding extensions.vector(384) default null,
  p_min_rank real default 0,
  p_min_semantic_score real default null
)
returns table(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid,
  keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)
language sql stable security definer
set search_path = public, extensions
set statement_timeout = '8s'
as $$
  with params as materialized (
    select nullif(trim(p_query),'') query_text,
      greatest(1,least(coalesce(p_limit,100),20000)) page_limit,
      greatest(coalesce(p_offset,0),0) page_offset,
      greatest(coalesce(p_min_rank,0),0)::real min_rank,
      case when p_min_semantic_score is null then null
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score,
      case when p_query_embedding is null then false else true end has_embedding,
      -- summary probe bound (assets, rank order); see header "Totals contract"
      1000 summary_probe_limit
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
      '%' || replace(replace(replace(q.query_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' like_pattern,
      (length(q.query_text) >= 3 and q.query_text ~ '[[:alnum:]]{3,}') allow_substring
    from params p cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
      and websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g'))::text <> ''
  ), distinct_queries as materialized (
    select distinct q.query_text, q.tsq, q.allow_substring, q.like_pattern,
      btrim(lower(regexp_replace(btrim(q.query_text), '[-_/[:space:]]+', ' ', 'g'))) normalized_query
    from queries q
  ), rank_queries as materialized (
    -- Ranking needs one row per normalized query: hyphen and space variants
    -- of the same words share a tsquery and a title key.
    select q.normalized_query, q.tsq,
      coalesce(array_agg(distinct q.like_pattern) filter (where q.allow_substring), '{}'::text[]) like_patterns
    from distinct_queries q
    group by q.normalized_query, q.tsq
  ), full_text_matches as materialized (
    -- Keys and short display columns only: search_tsv is never projected, so
    -- the TOASTed vector is not detoasted for ranking (ts_rank_cd over it cost
    -- 9.7s for spider-man's 23,968 matches on production, 2026-10-21).
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program
    from public.dam_search_documents d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select q.tsq from queries q))
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program
    from distinct_queries q
    join public.dam_search_documents d on q.allow_substring and
      (d.title ilike q.like_pattern or d.path ilike q.like_pattern
       or d.customer ilike q.like_pattern or d.program ilike q.like_pattern)
    where (p_document_types is null or d.document_type = any(p_document_types))
  ), substring_keys as materialized (
    select distinct s.document_type, s.entity_id from substring_matches s
  ), keyword_matches as materialized (
    -- The COMPLETE keyword match set (FTS + substring), never truncated.
    -- in_substring marks rows whose title/path/customer/program contains a
    -- query; only those can earn a substring tier, so only they pay ILIKE.
    select f.document_type,f.entity_id,f.asset_id,f.style_group_id,f.title,f.path,f.customer,f.program,
      (f.document_type, f.entity_id) in (select x.document_type, x.entity_id from substring_keys x) in_substring
    from full_text_matches f
    union all
    select distinct on (s.document_type, s.entity_id)
      s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.title,s.path,s.customer,s.program,
      true
    from substring_matches s
    where not exists (
      select 1 from full_text_matches f
      where f.document_type = s.document_type and f.entity_id = s.entity_id)
  ), keyword_candidates as materialized (
    -- Relevance for EVERY keyword match, before any page slice or bound:
    --   1.00 title equals the query (exact identifier; case/separator-insensitive)
    --   0.60 title contains the query
    --   0.45 title matches the full-text query
    --   0.30 path contains the query
    --   0.20 customer/program contains the query
    --   0.10 match only in the wider indexed text
    -- plus up to 0.09 for title tightness (query length / title length).
    -- Computed from short display columns only (never search_tsv).
    select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
      max(
        case
          when k.title_key = q.normalized_query then 1.0
          when k.in_substring and k.title ilike any(q.like_patterns) then 0.6
          when k.title_tsv @@ q.tsq then 0.45
          when k.in_substring and k.path ilike any(q.like_patterns) then 0.3
          when k.in_substring and (k.customer ilike any(q.like_patterns) or k.program ilike any(q.like_patterns)) then 0.2
          else 0.1
        end
        + 0.09 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
      )::real keyword_rank
    from (
      select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.title,m.path,m.customer,m.program,m.in_substring,
        -- title without a trailing file extension, case/separator-folded
        btrim(lower(regexp_replace(regexp_replace(btrim(coalesce(m.title,'')), '\.[[:alnum:]]{1,5}$', ''), '[-_/[:space:]]+', ' ', 'g'))) title_key,
        to_tsvector('simple', regexp_replace(coalesce(m.title,''), '[-_/]+', ' ', 'g')) title_tsv
      from keyword_matches m
    ) k
    cross join rank_queries q
    group by k.document_type,k.entity_id,k.asset_id,k.style_group_id
  ), semantic_candidates as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'gte-small'
      and extensions.vector_dims(d.embedding) = 384
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (p.min_semantic_score is null
        or greatest(0,1-(d.embedding <=> p_query_embedding)) >= p.min_semantic_score)
    order by d.embedding <=> p_query_embedding, d.entity_id
    limit 50000
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
  ), ordered_candidates as materialized (
    -- Every candidate ranked BEFORE any visibility probe or bound.
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      row_number() over (order by c.rank desc, c.document_type, c.entity_id) rn
    from candidate_ranks c
  ), candidate_asset_ids as not materialized (
    -- Expanded LAZILY in rank order inside each probe below: a Style Group's
    -- member assets are read only when the probe reaches that document.
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, x.id, c.rn
    from (select * from ordered_candidates order by rn) c
    join lateral (
      select c.asset_id id where c.document_type='asset' and c.asset_id is not null
      union all
      select m.id from public.assets m
      where c.document_type='style_group' and c.style_group_id is not null
        and m.style_group_id=c.style_group_id and not m.is_deleted
    ) x on true
  ), visibility_params as materialized (
    select coalesce(p_filters,'{}'::jsonb)-'search' f,
      public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    -- Summary probe: visible assets in rank order, stopping after
    -- summary_probe_limit rows (an ordered nested-loop probe, never a full
    -- visibility pass over a 20k-50k key set: the assets heap is ~2 GB and
    -- each cold probe is a random read).
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where not a.is_deleted
      and (a.modified_at >= v.thumbnail_min_date or a.file_created_at >= v.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v.f->>'licensorId','') is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end=(v.f->>'licensorId')::uuid)
      and (nullif(v.f->>'propertyId','') is null or case when a.style_group_id is null then a.property_id else sg.property_id end=(v.f->>'propertyId')::uuid)
      and (nullif(v.f->>'customerId','') is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end=(v.f->>'customerId')::uuid)
      and (nullif(v.f->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=a.id and e.tag=v.f->>'tagFilter'))
      and (jsonb_array_length(coalesce(v.f->'fileType','[]'))=0 or a.file_type::text in(select jsonb_array_elements_text(v.f->'fileType')))
      and (jsonb_array_length(coalesce(v.f->'contentType','[]'))=0 or a.content_type in(select jsonb_array_elements_text(v.f->'contentType')))
      and (jsonb_array_length(coalesce(v.f->'productMaterial','[]'))=0 or a.product_material && array(select jsonb_array_elements_text(v.f->'productMaterial')))
      and (jsonb_array_length(coalesce(v.f->'status','[]'))=0 or a.status::text in(select jsonb_array_elements_text(v.f->'status')))
      and (jsonb_array_length(coalesce(v.f->'workflowStatus','[]'))=0 or a.workflow_status::text in(select jsonb_array_elements_text(v.f->'workflowStatus')))
      and (jsonb_array_length(coalesce(v.f->'stage','[]'))=0 or a.stage in(select jsonb_array_elements_text(v.f->'stage')))
      and ((v.f->>'isLicensed') is null or a.is_licensed=(v.f->>'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(v.f->'assetType','[]'))=0 or a.asset_type::text in(select jsonb_array_elements_text(v.f->'assetType')))
      and (jsonb_array_length(coalesce(v.f->'artSource','[]'))=0 or a.art_source::text in(select jsonb_array_elements_text(v.f->'artSource')))
      and (jsonb_array_length(coalesce(v.f->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(v.f->'fileStatus') fs where
        (fs='has_preview' and a.thumbnail_url is not null) or
        (fs='no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs='no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error='no_pdf_compat') or
        (fs='no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error='no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v.f->'productCategory','[]'))=0 or a.product_category in(select jsonb_array_elements_text(v.f->'productCategory')) or
        ('Wall' in(select jsonb_array_elements_text(v.f->'productCategory')) and (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v.f->>'customer','') is null or a.customer=v.f->>'customer')
      and (nullif(v.f->>'program','') is null or a.program=v.f->>'program')
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), page_documents as materialized (
    -- Page probe: the first offset+limit+1 VISIBLE documents in rank order.
    -- Independent of the summary bound, so every offset pages correctly and
    -- has_more is exact.
    select distinct on (c.rn) c.document_type,c.entity_id,c.asset_id,c.style_group_id,
      c.keyword_rank,c.semantic_rank,c.rank,c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where not a.is_deleted
      and (a.modified_at >= v.thumbnail_min_date or a.file_created_at >= v.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v.f->>'licensorId','') is null or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end=(v.f->>'licensorId')::uuid)
      and (nullif(v.f->>'propertyId','') is null or case when a.style_group_id is null then a.property_id else sg.property_id end=(v.f->>'propertyId')::uuid)
      and (nullif(v.f->>'customerId','') is null or case when a.style_group_id is null then a.customer_id else sg.customer_id end=(v.f->>'customerId')::uuid)
      and (nullif(v.f->>'tagFilter','') is null or exists(select 1 from public.asset_effective_tags e where e.asset_id=a.id and e.tag=v.f->>'tagFilter'))
      and (jsonb_array_length(coalesce(v.f->'fileType','[]'))=0 or a.file_type::text in(select jsonb_array_elements_text(v.f->'fileType')))
      and (jsonb_array_length(coalesce(v.f->'contentType','[]'))=0 or a.content_type in(select jsonb_array_elements_text(v.f->'contentType')))
      and (jsonb_array_length(coalesce(v.f->'productMaterial','[]'))=0 or a.product_material && array(select jsonb_array_elements_text(v.f->'productMaterial')))
      and (jsonb_array_length(coalesce(v.f->'status','[]'))=0 or a.status::text in(select jsonb_array_elements_text(v.f->'status')))
      and (jsonb_array_length(coalesce(v.f->'workflowStatus','[]'))=0 or a.workflow_status::text in(select jsonb_array_elements_text(v.f->'workflowStatus')))
      and (jsonb_array_length(coalesce(v.f->'stage','[]'))=0 or a.stage in(select jsonb_array_elements_text(v.f->'stage')))
      and ((v.f->>'isLicensed') is null or a.is_licensed=(v.f->>'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(v.f->'assetType','[]'))=0 or a.asset_type::text in(select jsonb_array_elements_text(v.f->'assetType')))
      and (jsonb_array_length(coalesce(v.f->'artSource','[]'))=0 or a.art_source::text in(select jsonb_array_elements_text(v.f->'artSource')))
      and (jsonb_array_length(coalesce(v.f->'fileStatus','[]'))=0 or exists(select 1 from jsonb_array_elements_text(v.f->'fileStatus') fs where
        (fs='has_preview' and a.thumbnail_url is not null) or
        (fs='no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs='no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error='no_pdf_compat') or
        (fs='no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error='no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v.f->'productCategory','[]'))=0 or a.product_category in(select jsonb_array_elements_text(v.f->'productCategory')) or
        ('Wall' in(select jsonb_array_elements_text(v.f->'productCategory')) and (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v.f->>'customer','') is null or a.customer=v.f->>'customer')
      and (nullif(v.f->>'program','') is null or a.program=v.f->>'program')
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), probe_state as materialized (
    select count(*) > (select summary_probe_limit from params) truncated
    from visible_assets
  ), summary_assets as materialized (
    -- When truncated, drop the boundary document (it may be partially probed).
    select a.document_type,a.entity_id,a.asset_id,a.style_group_id,a.keyword_rank,a.semantic_rank,a.rank,
      a.id,a.asset_style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed,a.rn
    from visible_assets a
    where not (select truncated from probe_state)
       or a.rn < (select max(x.rn) from visible_assets x)
  ), ranked_documents as materialized (
    select distinct a.document_type, a.entity_id, a.asset_id, a.style_group_id,
      a.keyword_rank, a.semantic_rank, a.rank
    from summary_assets a
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from summary_assets a
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), summary as materialized (
    select
      case when (select truncated from probe_state)
        then greatest(count(*), (select visible_through_page from page_state))
        else count(*) end total_count,
      jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true)),
      'totalExact',not (select truncated from probe_state),
      'totalKind',case when (select truncated from probe_state) then 'lower_bound' else 'exact' end
    ) facets from ranked_documents
  ), page as materialized (
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$$;

revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) to authenticated, service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) is 'DAM-entitled ranked search. Every keyword (FTS + substring) and semantic candidate is ranked before any bound; exact title matches rank 1.0. The page is the first offset+limit visible documents in rank order (rank-ordered probe) and has_more is exact. total_count/facets are exact when facets.totalExact is true; otherwise they cover a rank-ordered probe of 1000 assets and total_count is a lower bound (facets.totalKind = lower_bound). Summary envelope always returned (null-entity row on empty/out-of-range). Semantic leg model/dims-checked, floor before blend.';

create or replace function public.search_assets_full_text(p_query text, p_limit int default 10000)
returns table(asset_id uuid, style_group_id uuid, rank real)
language sql stable security definer set search_path=public set statement_timeout='8s'
as $$
  select d.asset_id,d.style_group_id,d.rank
  from public.search_dam_documents(p_query,'{}'::jsonb,p_limit,0,array['asset']::text[],null,0) d
  where d.asset_id is not null;
$$;

comment on function public.search_assets_full_text(text,int) is
  'Top p_limit visible DAM assets for a keyword query, in search_dam_documents rank order.';

-- One search_dam_documents pass over both document types: a group ranks by
-- its own document or 0.8 x its best visible member asset, whichever is
-- higher, on one relevance scale. The pass reads the top 4 x p_limit
-- documents in rank order (at most 20000), so every group whose best
-- document is within that prefix gets its exact rank.
create or replace function public.search_style_groups_full_text(p_query text, p_limit int default 10000)
returns table(style_group_id uuid, rank real)
language sql stable security definer set search_path=public set statement_timeout='8s'
as $$
  with ranked as materialized (
    select d.* from public.search_dam_documents(
      p_query,'{}'::jsonb,
      least(20000, greatest(1, least(coalesce(p_limit, 10000), 20000)) * 4),0,
      null::text[],null,0
    ) d
    where d.entity_id is not null
  ), direct_groups as (
    select d.style_group_id, max(d.rank) rank from ranked d
    where d.document_type = 'style_group' and d.style_group_id is not null
    group by d.style_group_id
  ), asset_groups as (
    select d.style_group_id,max(d.rank)*0.8 rank from ranked d
    where d.document_type = 'asset' and d.style_group_id is not null
    group by d.style_group_id
  ), combined as (
    select style_group_id, rank from direct_groups
    union all
    select style_group_id, rank from asset_groups
  )
  select c.style_group_id, max(c.rank)::real rank
  from combined c
  group by c.style_group_id
  order by 2 desc, 1
  limit greatest(1, least(coalesce(p_limit, 10000), 20000));
$$;

comment on function public.search_style_groups_full_text(text,int) is
  'Top p_limit Style Groups for a keyword query: max(own document rank, 0.8 x best member asset rank) from one search_dam_documents pass.';

revoke all on function public.search_assets_full_text(text,int) from public, anon;
grant execute on function public.search_assets_full_text(text,int) to authenticated, service_role;
revoke all on function public.search_style_groups_full_text(text,int) from public, anon;
grant execute on function public.search_style_groups_full_text(text,int) to authenticated, service_role;
