-- #2151: give the tag facet count an index-leading arm of its own.
-- #2138 left the tag facet at 0-of-8 and ~8.1s while the identity facet, in
-- this very same function, returned in ~0.5s. The barrier story from the row
-- half does not transfer: this helper is plpgsql, is never inlined, and both
-- the fast and the slow call share the identical `matched as materialized`
-- CTE. What differs is which arm runs. Arm 2 is led by an equality on
-- licensor_id, which an index can serve even under the generic plan PostgREST
-- gets for a bound argument. Arm 1 expressed the tag as
-- `(tagFilter is null or exists (...))`, and a disjunction is not a semi-join:
-- the tag relation can never drive it, and because the OR references a.id the
-- covering facet index is dropped too. Measured on production with
-- EXPLAIN (generic_plan) on 2026-09-03: the old arm-1 shape costs 485,903 and
-- scans every live asset even for `front view`, which matches only 155 tag
-- rows out of 2,045,705 -- proof the tag never leads.
--
-- The fix applies the same discipline the identity half used: stop asking one
-- arm to serve two access paths, and give the selective predicate its own
-- mutually exclusive arm whose guard is Var-free so the planner turns it into
-- a one-time filter. Same generic plan, new shape: 932 for the tag arm on an
-- Index Only Scan of asset_effective_tags_tag_asset_idx, with the no-tag arm
-- still on its idx_assets_facet_counts index-only path.
-- derived-from: 20260902042548

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
    -- Arm 1: no identity filter and no tag filter. Scanning public.assets
    -- directly keeps the covering facet index available as an index-only
    -- scan; routing this case through the identity candidates forces a
    -- whole-table self-join instead. The tag predicate is gone from this arm
    -- because it is unreachable here, and leaving it as a disjunction is what
    -- cost the index-only path.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from public.assets a
    cross join bounds b
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
      and nullif(v_base_filters ->> 'tagFilter', '') is null
      and a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
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
    union all
    -- Arm 1T: no identity filter, tag filter present. Driving from
    -- public.asset_effective_tags makes the tag an index condition instead of
    -- one side of an OR, so the arm reads only the rows carrying that tag and
    -- then looks each asset up by primary key. DISTINCT is required, not
    -- decorative: the projection is keyed (asset_id, tag, scope), so one asset
    -- may legitimately carry the same tag at both 'asset' and 'style_group'
    -- scope and would otherwise be counted twice. The EXISTS this replaces
    -- deduplicated implicitly.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from (
      select distinct e.asset_id
      from public.asset_effective_tags e
      where nullif(v_base_filters ->> 'tagFilter','') is not null
        and e.tag = v_base_filters ->> 'tagFilter'
    ) t
    join public.assets a on a.id = t.asset_id
    cross join bounds b
    where nullif(v_base_filters ->> 'licensorId', '') is null
      and nullif(v_base_filters ->> 'propertyId', '') is null
      and nullif(v_base_filters ->> 'customerId', '') is null
      and nullif(v_base_filters ->> 'tagFilter', '') is not null
      and a.is_deleted = false
      and (a.modified_at >= b.thumbnail_min_date
        or a.file_created_at >= b.thumbnail_min_date or a.thumbnail_url is not null)
      and (nullif(v_base_filters ->> 'search','') is null or a.filename ilike '%' || (v_base_filters ->> 'search') || '%')
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
    union all
    -- Arm 2: an identity filter is present. The UNION candidate ids are the
    -- index-leading path, so join them back for the remaining predicates.
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from identity_asset_ids i
    join public.assets a on a.id = i.id
    cross join bounds b
    where (nullif(v_base_filters ->> 'licensorId', '') is not null
        or nullif(v_base_filters ->> 'propertyId', '') is not null
        or nullif(v_base_filters ->> 'customerId', '') is not null)
      and a.is_deleted = false
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

comment on function public.get_effective_filter_counts_unchecked_1703(jsonb) is
  'Shared DAM facet count implementation: index-only scan when neither an identity nor a tag filter is supplied, a tag-led arm when a tag filter is, and index-leading UNION identity candidates when an identity filter is.';

do $guard$
declare
  v_def text := pg_get_functiondef(
    'public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure);
  -- Whitespace is folded before anything is inspected so every pin below is a
  -- contiguous piece of real syntax in its real position, not a substring that
  -- happens to occur somewhere. Comments are NOT stripped here: two of the
  -- pins below are deliberately the arm comments, which the previous guard
  -- already relied on, and stripping them would silently disarm those.
  v_helper text := lower(regexp_replace(v_def, '\s+', ' ', 'g'));
  v_pin text;
  v_arms int;
begin
  -- Everything 20260902042548 pinned still holds.
  if position('left join public.style_groups' in v_helper) > 0
     or position('identity_asset_ids as' in v_helper) = 0
     or position('select a.*' in v_helper) > 0 then
    raise exception 'effective count helper lost its narrow index-leading shape';
  end if;
  if position('-- arm 1: no identity filter' in v_helper) = 0 then
    raise exception 'unfiltered facet counts no longer scan public.assets directly';
  end if;
  if position('-- arm 2: an identity filter is present' in v_helper) = 0
     or position('from identity_asset_ids i' in v_helper) = 0 then
    raise exception 'identity-filtered facet counts no longer use the UNION candidates';
  end if;

  -- #2151. Three matched arms now, joined by two UNION ALLs, on top of the five
  -- inside identity_asset_ids: seven in total. Counting them is what stops a
  -- later edit from deleting the tag arm while every substring below still
  -- appears somewhere else in the body.
  v_arms := (length(v_helper) - length(replace(v_helper, 'union all', '')))
              / length('union all');
  if v_arms <> 7 then
    raise exception 'facet count helper must keep five identity arms and three matched arms (seven UNION ALLs), found %', v_arms;
  end if;

  foreach v_pin in array array[
    -- The tag arm exists, is entered only when a tag is supplied, and is led by
    -- an equality on asset_effective_tags.tag so the (tag, asset_id) index can
    -- serve it under the generic plan a bound argument produces.
    '-- arm 1t: no identity filter, tag filter present',
    'from ( select distinct e.asset_id from public.asset_effective_tags e where nullif(v_base_filters ->> ''tagfilter'','''') is not null and e.tag = v_base_filters ->> ''tagfilter'' ) t join public.assets a on a.id = t.asset_id',
    -- DISTINCT is a correctness pin, not a performance one: (asset_id, tag,
    -- scope) is the projection key, so the same asset can carry one tag at two
    -- scopes and would be counted twice without it.
    'select distinct e.asset_id',
    -- Arm 1 must stay mutually exclusive with the tag arm. Without this guard
    -- both arms would match a tag-filtered call and every count would double.
    'and nullif(v_base_filters ->> ''customerid'', '''') is null and nullif(v_base_filters ->> ''tagfilter'', '''') is null and a.is_deleted = false',
    'and nullif(v_base_filters ->> ''customerid'', '''') is null and nullif(v_base_filters ->> ''tagfilter'', '''') is not null and a.is_deleted = false'
  ] loop
    if position(v_pin in v_helper) = 0 then
      raise exception 'facet count helper lost a pinned tag-arm property: %', v_pin;
    end if;
  end loop;

  -- The identity arm keeps enforcing the tag as an EXISTS: it is already led by
  -- an index there, and rewriting it would be a change nothing has measured.
  if position('and (nullif(v_base_filters ->> ''tagfilter'','''') is null or exists ( select 1 from public.asset_effective_tags e where e.asset_id = a.id and e.tag = v_base_filters ->> ''tagfilter''))' in v_helper) = 0 then
    raise exception 'identity-filtered facet counts lost their tag predicate';
  end if;

  -- The facet contract is unchanged.
  foreach v_pin in array array[
    '__includeownfacets2054', 'contenttype', 'productmaterial',
    'filestatus', 'productcategory', 'tagfilter', 'search',
    'assettype', 'artsource', 'program', 'customer'
  ] loop
    if position(v_pin in v_helper) = 0 then
      raise exception 'effective count helper lost a pinned facet contract: %', v_pin;
    end if;
  end loop;

  if position('get_effective_filter_counts_unchecked_1703' in
       pg_get_functiondef('public.get_filter_counts(jsonb)'::regprocedure)) = 0
     or position('get_effective_filter_counts_unchecked_1703' in
       pg_get_functiondef('public.get_effective_filter_counts(jsonb)'::regprocedure)) = 0 then
    raise exception 'filter count entry points no longer share the implementation';
  end if;
  if has_function_privilege('anon',
       'public.get_effective_filter_counts_unchecked_1703(jsonb)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_effective_filter_counts_unchecked_1703(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_filter_counts(jsonb)','EXECUTE') then
    raise exception 'effective count privileges changed';
  end if;
end;
$guard$;
