-- #1703 forward 6: keep entitlement at public entry points while removing it
-- from already-authorized row production, and join candidate keys in one pass.
-- derived-from: 20260831173841

-- Keep the public PostgREST filter inlinable so an outer LIMIT remains bounded.
-- Authorization is one materialized row; the proven predicates stay directly
-- in this invoker body, while the private helper remains for definer callers.
create or replace function public.filter_effective_assets(
  p_filters jsonb default '{}'::jsonb
)
returns setof public.assets
language sql
stable
security invoker
as $$
  with authorized as materialized (
    select public.require_dam_access() ok
  )
  select a.*
  from authorized
  cross join public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  where authorized.ok
    and a.is_deleted = false
    and (
      a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date()
      or a.thumbnail_url is not null
    )
    and (
      not (p_filters ? 'search')
      or nullif(p_filters ->> 'search', '') is null
      or a.filename ilike '%' || (p_filters ->> 'search') || '%'
    )
    and (
      not (p_filters ? 'licensorId')
      or nullif(p_filters ->> 'licensorId', '') is null
      or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end
           = (p_filters ->> 'licensorId')::uuid
    )
    and (
      not (p_filters ? 'propertyId')
      or nullif(p_filters ->> 'propertyId', '') is null
      or case when a.style_group_id is null then a.property_id else sg.property_id end
           = (p_filters ->> 'propertyId')::uuid
    )
    and (
      not (p_filters ? 'tagFilter')
      or nullif(p_filters ->> 'tagFilter', '') is null
      or exists (
        select 1 from public.asset_effective_tags e
        where e.asset_id = a.id and e.tag = p_filters ->> 'tagFilter'
      )
    )
    and (
      not (p_filters ? 'fileType')
      or jsonb_array_length(p_filters -> 'fileType') = 0
      or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType'))
    )
    and (
      not (p_filters ? 'status')
      or jsonb_array_length(p_filters -> 'status') = 0
      or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status'))
    )
    and (
      not (p_filters ? 'workflowStatus')
      or jsonb_array_length(p_filters -> 'workflowStatus') = 0
      or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus'))
    )
    and (
      not (p_filters ? 'stage')
      or jsonb_array_length(p_filters -> 'stage') = 0
      or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage'))
    )
    and (
      not (p_filters ? 'isLicensed')
      or (p_filters ->> 'isLicensed') is null
      or a.is_licensed = (p_filters ->> 'isLicensed')::boolean
    )
    and (
      not (p_filters ? 'assetType')
      or jsonb_array_length(p_filters -> 'assetType') = 0
      or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType'))
    )
    and (
      not (p_filters ? 'artSource')
      or jsonb_array_length(p_filters -> 'artSource') = 0
      or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource'))
    )
    and (nullif(p_filters ->> 'customer', '') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program', '') is null or a.program = p_filters ->> 'program');
$$;

-- CREATE OR REPLACE retains an older function's SET configuration. Normalize
-- both properties explicitly so an ordered replay from a configured predecessor
-- still produces the inlinable public contract.
alter function public.filter_effective_assets(jsonb) security invoker;
alter function public.filter_effective_assets(jsonb) reset all;

revoke all on function public.filter_effective_assets(jsonb) from public, anon;
grant execute on function public.filter_effective_assets(jsonb) to authenticated, service_role;

-- Counts need only the five facet columns. Keep the shared implementation
-- private and inline the effective predicates so neither public entry point
-- materializes the library-wide a.* filter result.
create or replace function public.get_effective_filter_counts_unchecked_1703(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_base_filters jsonb;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_stages text[];
  v_is_licensed boolean;
  v_result jsonb;
begin
  v_base_filters := v_filters
    - array['fileType', 'status', 'workflowStatus', 'stage', 'isLicensed']::text[];
  if v_filters ? 'fileType' and jsonb_array_length(v_filters -> 'fileType') > 0 then
    select array_agg(x) into v_file_types from jsonb_array_elements_text(v_filters -> 'fileType') x;
  end if;
  if v_filters ? 'status' and jsonb_array_length(v_filters -> 'status') > 0 then
    select array_agg(x) into v_statuses from jsonb_array_elements_text(v_filters -> 'status') x;
  end if;
  if v_filters ? 'workflowStatus' and jsonb_array_length(v_filters -> 'workflowStatus') > 0 then
    select array_agg(x) into v_workflow_statuses from jsonb_array_elements_text(v_filters -> 'workflowStatus') x;
  end if;
  if v_filters ? 'stage' and jsonb_array_length(v_filters -> 'stage') > 0 then
    select array_agg(x) into v_stages from jsonb_array_elements_text(v_filters -> 'stage') x;
  end if;
  if v_filters ? 'isLicensed' then
    v_is_licensed := (v_filters ->> 'isLicensed')::boolean;
  end if;

  with bounds as materialized (
    select public.assets_thumbnail_min_date() thumbnail_min_date
  ), base as materialized (
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from public.assets a
    cross join bounds b
    left join public.style_groups sg on sg.id = a.style_group_id
    where a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search', '') is null
        or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (nullif(v_base_filters ->> 'licensorId', '') is null
        or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end
          = (v_base_filters ->> 'licensorId')::uuid)
      and (nullif(v_base_filters ->> 'propertyId', '') is null
        or case when a.style_group_id is null then a.property_id else sg.property_id end
          = (v_base_filters ->> 'propertyId')::uuid)
      and (nullif(v_base_filters ->> 'tagFilter', '') is null or exists (
        select 1 from public.asset_effective_tags e
        where e.asset_id = a.id and e.tag = v_base_filters ->> 'tagFilter'))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType', '[]'::jsonb)) = 0
        or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource', '[]'::jsonb)) = 0
        or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (nullif(v_base_filters ->> 'customer', '') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program', '') is null or a.program = v_base_filters ->> 'program')
  )
  select jsonb_build_object(
    'total', (select count(*) from base where
      (v_file_types is null or file_type::text = any(v_file_types)) and
      (v_statuses is null or status::text = any(v_statuses)) and
      (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
      (v_stages is null or stage = any(v_stages)) and
      (v_is_licensed is null or is_licensed = v_is_licensed)),
    'fileType', coalesce((select jsonb_object_agg(file_type::text, cnt) from (
      select file_type, count(*) cnt from base where
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by file_type) s), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status::text, cnt) from (
      select status, count(*) cnt from base where
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by status) s), '{}'::jsonb),
    'workflowStatus', coalesce((select jsonb_object_agg(workflow_status::text, cnt) from (
      select workflow_status, count(*) cnt from base where workflow_status is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by workflow_status) s), '{}'::jsonb),
    'stage', coalesce((select jsonb_object_agg(stage, cnt) from (
      select stage, count(*) cnt from base where stage is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by stage) s), '{}'::jsonb),
    'isLicensed', (select jsonb_build_object(
      'true', coalesce(sum(case when is_licensed is true then 1 else 0 end), 0),
      'false', coalesce(sum(case when is_licensed is not true then 1 else 0 end), 0))
      from base where (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)))
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_effective_filter_counts_unchecked_1703(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.get_effective_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  perform public.require_dam_access();
  return public.get_effective_filter_counts_unchecked_1703(v_filters);
end;
$$;

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
  ), visibility_params as materialized (
    select coalesce(p_filters, '{}'::jsonb) - 'search' filters,
      public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    select a.id, a.style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    cross join visibility_params f
    left join public.style_groups sg on sg.id = a.style_group_id
    where a.is_deleted = false
      and (a.modified_at >= f.thumbnail_min_date
        or a.file_created_at >= f.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(f.filters ->> 'licensorId', '') is null
        or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end
          = (f.filters ->> 'licensorId')::uuid)
      and (nullif(f.filters ->> 'propertyId', '') is null
        or case when a.style_group_id is null then a.property_id else sg.property_id end
          = (f.filters ->> 'propertyId')::uuid)
      and (nullif(f.filters ->> 'tagFilter', '') is null or exists (
        select 1 from public.asset_effective_tags e
        where e.asset_id = a.id and e.tag = f.filters ->> 'tagFilter'))
      and (jsonb_array_length(coalesce(f.filters -> 'fileType', '[]'::jsonb)) = 0
        or a.file_type::text in (select jsonb_array_elements_text(f.filters -> 'fileType')))
      and (jsonb_array_length(coalesce(f.filters -> 'status', '[]'::jsonb)) = 0
        or a.status::text in (select jsonb_array_elements_text(f.filters -> 'status')))
      and (jsonb_array_length(coalesce(f.filters -> 'workflowStatus', '[]'::jsonb)) = 0
        or a.workflow_status::text in (select jsonb_array_elements_text(f.filters -> 'workflowStatus')))
      and (jsonb_array_length(coalesce(f.filters -> 'stage', '[]'::jsonb)) = 0
        or a.stage in (select jsonb_array_elements_text(f.filters -> 'stage')))
      and ((f.filters ->> 'isLicensed') is null
        or a.is_licensed = (f.filters ->> 'isLicensed')::boolean)
      and (jsonb_array_length(coalesce(f.filters -> 'assetType', '[]'::jsonb)) = 0
        or a.asset_type::text in (select jsonb_array_elements_text(f.filters -> 'assetType')))
      and (jsonb_array_length(coalesce(f.filters -> 'artSource', '[]'::jsonb)) = 0
        or a.art_source::text in (select jsonb_array_elements_text(f.filters -> 'artSource')))
      and (nullif(f.filters ->> 'customer', '') is null or a.customer = f.filters ->> 'customer')
      and (nullif(f.filters ->> 'program', '') is null or a.program = f.filters ->> 'program')
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
revoke all on function public.get_effective_filter_counts(jsonb) from public, anon;
revoke all on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) from public, anon;
grant execute on function public.get_filter_counts(jsonb) to authenticated, service_role;
grant execute on function public.get_effective_filter_counts(jsonb) to authenticated, service_role;
grant execute on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) to authenticated, service_role;

comment on function public.search_dam_documents(text,jsonb,int,int,text[],extensions.vector(384),real) is
  'DAM-entitled ranked search: one private keyed visibility pass drives exact totals, facets, and pagination.';
