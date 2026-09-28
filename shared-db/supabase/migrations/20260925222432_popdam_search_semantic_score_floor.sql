-- #3457: optional semantic-only score floor for PopDAM hybrid search.
-- Adds trailing p_min_semantic_score real default null (8-arg signature),
-- applies the floor only inside semantic_candidates before blend, drops the
-- old 7-arg signature, and re-grants execute to authenticated and service_role.
-- derived-from: 20260901130428

-- Drop SQL-language dependents before dropping the 7-arg overload; Postgres
-- records function-body call dependencies and a bare RESTRICT drop refuses.
drop function if exists public.search_assets_full_text(text,int);
drop function if exists public.search_style_groups_full_text(text,int);
drop function if exists public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real);

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
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score
    where public.require_dam_access()
  ), queries as materialized (
    select websearch_to_tsquery('simple',q.query_text) tsq,
      '%' || q.query_text || '%' like_pattern, length(q.query_text) >= 3 allow_substring
    from params p cross join public.expand_dam_search_queries(p.query_text) q where p.query_text is not null
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.search_tsv
    from public.dam_search_documents d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select q.tsq from queries q))
  ), keyword_candidates as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest((select max(ts_rank_cd(d.search_tsv, q.tsq)) from queries q where d.search_tsv @@ q.tsq),0.01)::real keyword_rank
    from full_text_matches d
    union all
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      case when d.title ilike q.like_pattern then 0.04 when d.path ilike q.like_pattern then 0.03
        when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02 else 0.01 end::real
    from queries q join public.dam_search_documents d on q.allow_substring and
      (d.title ilike q.like_pattern or d.path ilike q.like_pattern or d.customer ilike q.like_pattern or d.program ilike q.like_pattern)
    where p_document_types is null or d.document_type = any(p_document_types)
  ), semantic_candidates as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p join public.dam_search_documents d on p_query_embedding is not null and d.embedding is not null
    where (p_document_types is null or d.document_type = any(p_document_types))
      and (p.min_semantic_score is null
        or greatest(0,1-(d.embedding <=> p_query_embedding)) >= p.min_semantic_score)
    order by d.embedding <=> p_query_embedding limit 20000
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
  ), candidate_asset_ids as materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, c.asset_id id
    from candidate_ranks c where c.document_type='asset' and c.asset_id is not null
    union all
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, a.id
    from candidate_ranks c join public.assets a on a.style_group_id=c.style_group_id and not a.is_deleted
    where c.document_type='style_group' and c.style_group_id is not null
  ), visibility_params as materialized (
    select coalesce(p_filters,'{}'::jsonb)-'search' f,
      public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed
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
  ), ranked_documents as materialized (
    select distinct a.document_type, a.entity_id, a.asset_id, a.style_group_id,
      a.keyword_rank, a.semantic_rank, a.rank
    from visible_assets a
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from visible_assets a
  ), summary as materialized (
    select count(*) total_count,jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true))
    ) facets from ranked_documents
  ), page as materialized (
    select r.* from ranked_documents r order by r.rank desc,r.document_type,r.entity_id
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.*,s.total_count,s.total_count > (select page_offset+page_limit from params),s.facets
  from page p cross join summary s order by p.rank desc,p.document_type,p.entity_id;
$$;

revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) from public, anon;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) to authenticated, service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real,real) is
  'DAM-entitled ranked search with optional semantic-only score floor applied before blend; keyword hits below the floor survive with semantic_rank null.';

-- Recreate the two wrappers dropped above; their 7-arg calls rebind to the
-- 8-arg overload via the trailing default null.
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
  with queries as materialized (
    select websearch_to_tsquery('simple', q.query_text) tsq,
      '%' || q.query_text || '%' like_pattern,
      length(q.query_text) >= 3 allow_substring
    from public.expand_dam_search_queries(nullif(trim(p_query), '')) q
    where public.require_dam_access()
  ), direct_candidates as materialized (
    select d.style_group_id,
      greatest(ts_rank_cd(d.search_tsv, q.tsq), 0.01)::real rank
    from queries q
    join public.dam_search_documents d on d.search_tsv @@ q.tsq
    where d.document_type = 'style_group'
    union all
    select d.style_group_id,
      case when d.title ilike q.like_pattern then 0.04
           when d.path ilike q.like_pattern then 0.03
           when d.customer ilike q.like_pattern or d.program ilike q.like_pattern then 0.02
           else 0.01 end::real rank
    from queries q
    join public.dam_search_documents d on q.allow_substring and (
      d.title ilike q.like_pattern or d.path ilike q.like_pattern
      or d.customer ilike q.like_pattern or d.program ilike q.like_pattern
    )
    where d.document_type = 'style_group'
  ), direct_groups as (
    select d.style_group_id,max(d.rank)::real rank
    from direct_candidates d
    where d.style_group_id is not null
    group by d.style_group_id
  ), member_assets as materialized (
    select d.* from public.search_dam_documents(
      p_query,'{}'::jsonb,20000,0,array['asset']::text[],null,0
    ) d
  ), asset_groups as (
    select d.style_group_id,max(d.rank)*0.8 rank from member_assets d
    where d.style_group_id is not null
    group by d.style_group_id
  ), combined as (
    select style_group_id, rank from direct_groups
    union all
    select style_group_id, rank from asset_groups
  )
  select c.style_group_id, max(c.rank)::real rank
  from combined c
  where c.style_group_id is not null
  group by c.style_group_id
  order by max(c.rank) desc,c.style_group_id
  limit greatest(1,least(coalesce(p_limit,10000),20000));
$$;

revoke all on function public.search_assets_full_text(text,int) from public,anon;
revoke all on function public.search_style_groups_full_text(text,int) from public,anon;
grant execute on function public.search_assets_full_text(text,int) to authenticated,service_role;
grant execute on function public.search_style_groups_full_text(text,int) to authenticated,service_role;
