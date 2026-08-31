-- #1703 forward 5: avoid wide-row materialization and redundant deduplication.
-- derived-from: 20260831093107

create or replace function public.get_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_result jsonb;
begin
  perform public.require_dam_access();
  v_result := public.get_effective_filter_counts_unchecked_1703(v_filters);
  -- The empty legacy response intentionally predates the effective API's
  -- explicit total. Preserve that public shape while using the faster helper.
  if v_filters = '{}'::jsonb then
    return v_result - 'total';
  end if;
  return v_result;
end;
$$;

-- Ordered replay may retain the pre-filtered overload when its deployment-only
-- predecessor was skipped. Keep that authorization bypass closed in both states.
drop function if exists public.search_dam_documents(
  text, integer, text[], extensions.vector
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
  with params as materialized (
    select nullif(trim(p_query), '') query_text,
      greatest(1, least(coalesce(p_limit, 100), 20000)) page_limit,
      greatest(coalesce(p_offset, 0), 0) page_offset,
      greatest(coalesce(p_min_rank, 0), 0)::real min_rank
    where public.require_dam_access()
  ), queries as materialized (
    select websearch_to_tsquery('simple', q.query_text) tsq,
      '%' || q.query_text || '%' like_pattern,
      length(q.query_text) >= 3 allow_substring
    from params p
    cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
  ), keyword_candidates as materialized (
    select d.document_type, d.entity_id, d.asset_id, d.style_group_id,
      greatest(ts_rank_cd(d.search_tsv, q.tsq), 0.01)::real keyword_rank
    from queries q
    join public.dam_search_documents d on d.search_tsv @@ q.tsq
    where p_document_types is null or d.document_type = any(p_document_types)
    union all
    select d.document_type, d.entity_id, d.asset_id, d.style_group_id,
      case when d.title ilike q.like_pattern then 0.04
           when d.path ilike q.like_pattern then 0.03
           when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02
           else 0.01 end::real keyword_rank
    from queries q
    join public.dam_search_documents d on q.allow_substring and (
      d.title ilike q.like_pattern or d.path ilike q.like_pattern
      or d.customer ilike q.like_pattern or d.program ilike q.like_pattern
    )
    where p_document_types is null or d.document_type = any(p_document_types)
  ), semantic_candidates as materialized (
    select d.document_type, d.entity_id, d.asset_id, d.style_group_id,
      greatest(0, 1 - (d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p_query_embedding is not null and d.embedding is not null
    where p_document_types is null or d.document_type = any(p_document_types)
    order by d.embedding <=> p_query_embedding
    limit 20000
  ), candidate_ranks as materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (
      select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
        k.keyword_rank,null::real semantic_rank from keyword_candidates k
      union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,
        null::real keyword_rank,s.semantic_rank from semantic_candidates s
    ) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)
      >= (select min_rank from params)
  ), candidate_asset_ids as materialized (
    select distinct c.asset_id id
    from candidate_ranks c
    where c.document_type = 'asset' and c.asset_id is not null
    union
    select distinct a.id
    from candidate_ranks c
    join public.assets a on a.style_group_id = c.style_group_id
      and a.is_deleted = false
    where c.document_type = 'style_group' and c.style_group_id is not null
  ), visible_assets as materialized (
    select f.id, f.style_group_id, f.file_type, f.status,
      f.workflow_status, f.stage, f.is_licensed
    from candidate_asset_ids c
    cross join lateral (
      select a.id, a.style_group_id, a.file_type, a.status,
        a.workflow_status, a.stage, a.is_licensed
      from public.filter_effective_assets(coalesce(p_filters, '{}'::jsonb) - 'search') a
      where a.id = c.id
    ) f
  ), visible_style_groups as materialized (
    select distinct a.style_group_id
    from visible_assets a
    where a.style_group_id is not null
  ), ranked_documents as materialized (
    select c.*
    from candidate_ranks c
    join visible_assets a on a.id = c.asset_id
    where c.document_type = 'asset'
    union
    select c.*
    from candidate_ranks c
    join visible_style_groups g on g.style_group_id = c.style_group_id
    where c.document_type = 'style_group'
  ), matched_assets as materialized (
    select a.* from visible_assets a
  ), summary as materialized (
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
  ), page as materialized (
    select r.* from ranked_documents r
    order by r.rank desc,r.document_type,r.entity_id
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

revoke all on function public.get_filter_counts(jsonb) from public, anon;
revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) from public, anon;
grant execute on function public.get_filter_counts(jsonb) to authenticated, service_role;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) to authenticated, service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) is
  'DAM-entitled ranked search: narrow candidate visibility drives exact totals, facets, and pagination.';
