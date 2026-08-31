-- Authorization-safe ranked DAM search. Filters and caller-visible assets are
-- resolved before ranking, totals, facets, and page boundaries.
-- derived-from: 20260714173500, 20260713221518
-- runtime-dependency: 20260830110517 (filter_effective_assets)

-- The former direct RPC has no filter/visibility arguments. Keeping it as an
-- overload would leave an authenticated bypass around the contract below.
drop function if exists public.search_dam_documents(
  text, int, text[], extensions.vector(384)
);

create or replace function public.search_dam_documents(
  p_query text,
  p_filters jsonb,
  p_limit int,
  p_offset int,
  p_document_types text[] default null,
  p_query_embedding extensions.vector(384) default null,
  p_min_rank real default 0
)
returns table(
  document_type text, entity_id uuid, asset_id uuid, style_group_id uuid,
  keyword_rank real, semantic_rank real, rank real,
  total_count bigint, has_more boolean, facets jsonb
)
language sql stable security definer
set search_path = public, extensions
set statement_timeout = '8s'
as $$
  with params as (
    select nullif(trim(p_query), '') query_text,
      greatest(1, least(coalesce(p_limit, 100), 20000)) page_limit,
      greatest(coalesce(p_offset, 0), 0) page_offset,
      greatest(coalesce(p_min_rank, 0), 0)::real min_rank
  ),
  visible_assets as materialized (
    select a.* from public.filter_effective_assets(coalesce(p_filters, '{}'::jsonb) - 'search') a
  ),
  queries as (
    select websearch_to_tsquery('simple', q.query_text) tsq,
      '%' || q.query_text || '%' like_pattern
    from params p
    cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
  ),
  eligible_documents as materialized (
    select d.*
    from public.dam_search_documents d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (
        (d.document_type = 'asset' and exists (select 1 from visible_assets a where a.id = d.asset_id))
        or (d.document_type = 'style_group' and exists (
          select 1 from visible_assets a where a.style_group_id = d.style_group_id
        ))
      )
  ),
  keyword_matches as (
    select d.document_type, d.entity_id, d.asset_id, d.style_group_id,
      greatest(ts_rank_cd(d.search_tsv, q.tsq), case
        when d.title ilike q.like_pattern then 0.04
        when d.path ilike q.like_pattern then 0.03
        when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02
        else 0.01 end)::real keyword_rank,
      null::real semantic_rank
    from eligible_documents d cross join queries q
    where d.search_tsv @@ q.tsq or d.title ilike q.like_pattern
       or d.path ilike q.like_pattern or d.customer ilike q.like_pattern
       or d.program ilike q.like_pattern
  ),
  semantic_matches as (
    select d.document_type, d.entity_id, d.asset_id, d.style_group_id,
      null::real keyword_rank,
      greatest(0, 1 - (d.embedding <=> p_query_embedding))::real semantic_rank
    from eligible_documents d
    where p_query_embedding is not null and d.embedding is not null
    order by d.embedding <=> p_query_embedding
    -- Match the largest supported page so semantic-only callers are not
    -- silently capped below the public page ceiling.
    limit 20000
  ),
  ranked_documents as materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select * from keyword_matches union all select * from semantic_matches) c
    group by c.document_type, c.entity_id, c.asset_id, c.style_group_id
    having (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)
      >= (select min_rank from params)
  ),
  matched_assets as materialized (
    select distinct a.*
    from visible_assets a
    join ranked_documents r on r.asset_id = a.id or r.style_group_id = a.style_group_id
  ),
  summary as (
    select count(*) total_count,
      jsonb_build_object(
        'fileType', coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1) x),'{}'::jsonb),
        'status', coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1) x),'{}'::jsonb),
        'workflowStatus', coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1) x),'{}'::jsonb),
        'stage', coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1) x),'{}'::jsonb),
        'isLicensed', jsonb_build_object(
          'true',(select count(*) from matched_assets where is_licensed is true),
          'false',(select count(*) from matched_assets where is_licensed is not true)
        )
      ) facets
    from ranked_documents
  ),
  page as (
    select r.* from ranked_documents r
    order by r.rank desc, r.document_type, r.entity_id
    offset (select page_offset from params)
    limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,
    p.keyword_rank,p.semantic_rank,p.rank,s.total_count,
    s.total_count > ((select page_offset + page_limit from params)) has_more,
    s.facets
  from page p cross join summary s
  order by p.rank desc,p.document_type,p.entity_id;
$$;

revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) to authenticated, service_role;

-- Legacy callers keep their result shape. Their candidates are now explicitly
-- intersected with the same effective asset boundary before they are returned.
create or replace function public.search_assets_full_text(p_query text, p_limit int default 10000)
returns table(asset_id uuid, style_group_id uuid, rank real)
language sql stable security definer set search_path=public set statement_timeout='8s'
as $$
  select d.asset_id,d.style_group_id,d.rank
  from public.search_dam_documents(p_query,'{}'::jsonb,p_limit,0,array['asset']::text[],null,0) d
  where d.asset_id is not null;
$$;

create or replace function public.search_style_groups_full_text(p_query text, p_limit int default 10000)
returns table(style_group_id uuid, rank real)
language sql stable security definer set search_path=public set statement_timeout='8s'
as $$
  with direct_groups as (
    select d.style_group_id,d.rank
    from public.search_dam_documents(p_query,'{}'::jsonb,p_limit,0,array['style_group']::text[],null,0) d
  ), asset_groups as (
    select d.style_group_id,max(d.rank)*0.8 rank
    from public.search_dam_documents(p_query,'{}'::jsonb,p_limit,0,array['asset']::text[],null,0) d
    where d.style_group_id is not null group by d.style_group_id
  )
  select x.style_group_id,max(x.rank)::real rank
  from (select * from direct_groups union all select * from asset_groups) x
  where x.style_group_id is not null group by x.style_group_id
  order by max(x.rank) desc,x.style_group_id limit greatest(1,least(coalesce(p_limit,10000),20000));
$$;

revoke all on function public.search_assets_full_text(text,int) from public,anon;
revoke all on function public.search_style_groups_full_text(text,int) from public,anon;
grant execute on function public.search_assets_full_text(text,int) to authenticated,service_role;
grant execute on function public.search_style_groups_full_text(text,int) to authenticated,service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) is
  'RLS-safe ranked DAM search: effective filters precede ranking/pagination; each row carries exact total, has_more, and search-scoped facets.';
