-- #2054: give effective identity filters real index-leading list/count paths.
-- Group identity remains authoritative for grouped assets; ungrouped assets use
-- their own identity. Mutually exclusive UNION arms choose the first populated
-- identity key, so each filtered arm has a simple indexed equality on one table.
-- derived-from: 20260901130428, 20260831184547

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql stable security invoker
as $$
  with authorized as materialized (select public.require_dam_access() ok),
  identity_asset_ids as (
    -- No identity filter: preserve the simple active-assets path.
    select a.id
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
    union all
    -- Licensor is the leading key when supplied; property/customer still narrow.
    select a.id
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or a.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or sg.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Property leads only when licensor is absent.
    select a.id
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and sg.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Customer leads only when neither taxonomy key is supplied.
    select a.id
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (p_filters ->> 'customerId')::uuid
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and sg.customer_id = (p_filters ->> 'customerId')::uuid
  )
  select a.*
  from authorized
  cross join identity_asset_ids i
  join public.assets a on a.id = i.id
  where authorized.ok
    and a.is_deleted = false
    and (a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date() or a.thumbnail_url is not null)
    and (nullif(p_filters ->> 'search','') is null or a.filename ilike '%' || (p_filters ->> 'search') || '%')
    and (nullif(p_filters ->> 'tagFilter','') is null or exists (
      select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = p_filters ->> 'tagFilter'))
    and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
    and (jsonb_array_length(coalesce(p_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(p_filters -> 'contentType')))
    and (jsonb_array_length(coalesce(p_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(p_filters -> 'productMaterial')))
    and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
    and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
    and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
    and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    and (jsonb_array_length(coalesce(p_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType')))
    and (jsonb_array_length(coalesce(p_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource')))
    and (jsonb_array_length(coalesce(p_filters -> 'fileStatus','[]')) = 0 or exists (
      select 1 from jsonb_array_elements_text(p_filters -> 'fileStatus') fs where
        (fs = 'has_preview' and a.thumbnail_url is not null) or
        (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
        (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
        (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
    and (jsonb_array_length(coalesce(p_filters -> 'productCategory','[]')) = 0 or
      a.product_category in (select jsonb_array_elements_text(p_filters -> 'productCategory')) or
      ('Wall' in (select jsonb_array_elements_text(p_filters -> 'productCategory')) and
        (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
    and (nullif(p_filters ->> 'customer','') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program','') is null or a.program = p_filters ->> 'program');
$$;

alter function public.filter_effective_assets(jsonb) security invoker;
alter function public.filter_effective_assets(jsonb) reset all;
revoke all on function public.filter_effective_assets(jsonb) from public, anon;
grant execute on function public.filter_effective_assets(jsonb) to authenticated, service_role;

create or replace function public.get_effective_filter_counts_unchecked_1703(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_include_own_facets boolean := coalesce(
    (p_filters ->> '__includeOwnFacets2054')::boolean, false
  );
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb) - '__includeOwnFacets2054';
  v_base_filters jsonb;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_stages text[];
  v_is_licensed boolean;
  v_result jsonb;
begin
  -- Legacy facet contract: total applies every filter, while each of these five
  -- facet maps excludes its own selection and applies the other four.
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
  ), identity_asset_ids as (
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
    union all
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (v_base_filters ->> 'licensorId')::uuid
      and (nullif(v_base_filters ->> 'propertyId', '') is null or a.property_id = (v_base_filters ->> 'propertyId')::uuid)
      and (nullif(v_base_filters ->> 'customerId', '') is null or a.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (v_base_filters ->> 'licensorId')::uuid
      and (nullif(v_base_filters ->> 'propertyId', '') is null or sg.property_id = (v_base_filters ->> 'propertyId')::uuid)
      and (nullif(v_base_filters ->> 'customerId', '') is null or sg.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (v_base_filters ->> 'propertyId')::uuid
      and (nullif(v_base_filters ->> 'customerId', '') is null or a.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is not null
      and sg.property_id = (v_base_filters ->> 'propertyId')::uuid
      and (nullif(v_base_filters ->> 'customerId', '') is null or sg.customer_id = (v_base_filters ->> 'customerId')::uuid)
    union all
    select a.id
    from public.assets a
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (v_base_filters ->> 'customerId')::uuid
    union all
    select a.id
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is not null
      and sg.customer_id = (v_base_filters ->> 'customerId')::uuid
  ), matched as materialized (
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from identity_asset_ids i
    join public.assets a on a.id = i.id
    cross join bounds b
    where a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
      and (nullif(v_base_filters ->> 'tagFilter','') is null or exists (
        select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = v_base_filters ->> 'tagFilter'))
      and (jsonb_array_length(coalesce(v_base_filters -> 'contentType','[]')) = 0 or a.content_type in (select jsonb_array_elements_text(v_base_filters -> 'contentType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productMaterial','[]')) = 0 or a.product_material && array(select jsonb_array_elements_text(v_base_filters -> 'productMaterial')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'assetType','[]')) = 0 or a.asset_type::text in (select jsonb_array_elements_text(v_base_filters -> 'assetType')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'artSource','[]')) = 0 or a.art_source::text in (select jsonb_array_elements_text(v_base_filters -> 'artSource')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'fileStatus','[]')) = 0 or exists (
        select 1 from jsonb_array_elements_text(v_base_filters -> 'fileStatus') fs where
          (fs = 'has_preview' and a.thumbnail_url is not null) or
          (fs = 'no_preview_renderable' and a.thumbnail_url is null and a.thumbnail_error is null) or
          (fs = 'no_pdf_compat' and a.thumbnail_url is null and a.thumbnail_error = 'no_pdf_compat') or
          (fs = 'no_preview_unsupported' and a.thumbnail_url is null and a.thumbnail_error = 'no_preview_or_render_failed')))
      and (jsonb_array_length(coalesce(v_base_filters -> 'productCategory','[]')) = 0 or
        a.product_category in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) or
        ('Wall' in (select jsonb_array_elements_text(v_base_filters -> 'productCategory')) and
          (a.relative_path ilike '%WALL ART%' or a.relative_path ilike '%3FZ%')))
      and (nullif(v_base_filters ->> 'customer','') is null or a.customer = v_base_filters ->> 'customer')
      and (nullif(v_base_filters ->> 'program','') is null or a.program = v_base_filters ->> 'program')
  )
  select jsonb_build_object(
    'total', (select count(*) from matched where
      (v_file_types is null or file_type::text = any(v_file_types)) and
      (v_statuses is null or status::text = any(v_statuses)) and
      (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
      (v_stages is null or stage = any(v_stages)) and
      (v_is_licensed is null or is_licensed = v_is_licensed)),
    'fileType', coalesce((select jsonb_object_agg(file_type::text, cnt) from (
      select file_type, count(*) cnt from matched where
        (v_include_own_facets is false or v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by file_type) s), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status::text, cnt) from (
      select status, count(*) cnt from matched where
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_include_own_facets is false or v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by status) s), '{}'::jsonb),
    'workflowStatus', coalesce((select jsonb_object_agg(workflow_status::text, cnt) from (
      select workflow_status, count(*) cnt from matched where workflow_status is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_include_own_facets is false or v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by workflow_status) s), '{}'::jsonb),
    'stage', coalesce((select jsonb_object_agg(stage, cnt) from (
      select stage, count(*) cnt from matched where stage is not null and
        (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_include_own_facets is false or v_stages is null or stage = any(v_stages)) and
        (v_is_licensed is null or is_licensed = v_is_licensed) group by stage) s), '{}'::jsonb),
    'isLicensed', (select jsonb_build_object(
      'true', coalesce(sum(case when is_licensed is true then 1 else 0 end), 0),
      'false', coalesce(sum(case when is_licensed is not true then 1 else 0 end), 0))
      from matched where (v_file_types is null or file_type::text = any(v_file_types)) and
        (v_statuses is null or status::text = any(v_statuses)) and
        (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and
        (v_stages is null or stage = any(v_stages)) and
        (v_include_own_facets is false or v_is_licensed is null or is_licensed = v_is_licensed))
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_effective_filter_counts_unchecked_1703(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.get_effective_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
set statement_timeout = '8s'
as $$
begin
  perform public.require_dam_access();
  return public.get_effective_filter_counts_unchecked_1703(
    jsonb_set(
      coalesce(p_filters, '{}'::jsonb) - '__includeOwnFacets2054',
      '{__includeOwnFacets2054}', 'true'::jsonb, true
    )
  );
end;
$$;

revoke all on function public.get_effective_filter_counts(jsonb) from public, anon;
grant execute on function public.get_effective_filter_counts(jsonb) to authenticated, service_role;

create or replace function public.get_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_result jsonb;
begin
  perform public.require_dam_access();
  v_result := public.get_effective_filter_counts_unchecked_1703(
    v_filters - '__includeOwnFacets2054'
  );
  if v_filters = '{}'::jsonb then
    return v_result - 'total';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_filter_counts(jsonb) from public, anon;
grant execute on function public.get_filter_counts(jsonb) to authenticated, service_role;

comment on function public.filter_effective_assets(jsonb) is
  'DAM-entitled effective asset filter with group-winning identity and index-leading UNION identity candidates.';
comment on function public.get_effective_filter_counts(jsonb) is
  'Exact effective list total and facet counts over the same group-winning filter contract.';

do $$
declare
  v_filter text := pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure);
  v_helper text := pg_get_functiondef('public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure);
  v_legacy text := pg_get_functiondef('public.get_filter_counts(jsonb)'::regprocedure);
begin
  if position('left join public.style_groups' in lower(v_filter)) > 0
     or position('identity_asset_ids as' in lower(v_filter)) = 0
     or position('union all' in lower(v_filter)) = 0
     or position('a.licensor_id = ' in lower(v_filter)) = 0
     or position('sg.licensor_id = ' in lower(v_filter)) = 0
     or position('a.property_id = ' in lower(v_filter)) = 0
     or position('sg.property_id = ' in lower(v_filter)) = 0
     or position('a.customer_id = ' in lower(v_filter)) = 0
     or position('sg.customer_id = ' in lower(v_filter)) = 0 then
    raise exception 'effective identity predicates lost index-leading UNION arms';
  end if;
  if position('left join public.style_groups' in lower(v_helper)) > 0
     or position('identity_asset_ids as' in lower(v_helper)) = 0
     or position('contentType' in v_helper) = 0
     or position('productMaterial' in v_helper) = 0
     or position('fileStatus' in v_helper) = 0
     or position('productCategory' in v_helper) = 0
     or position('__includeOwnFacets2054' in v_helper) = 0 then
    raise exception 'effective count helper lost union, parity, or facet-mode contracts';
  end if;
  if position('get_effective_filter_counts_unchecked_1703' in v_legacy) = 0 then
    raise exception 'legacy filtered counts do not share the corrected effective count path';
  end if;
  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_filter_counts(jsonb)','EXECUTE') then
    raise exception 'effective filter/count privileges changed';
  end if;
end;
$$;
