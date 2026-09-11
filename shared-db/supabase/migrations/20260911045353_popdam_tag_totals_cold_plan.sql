-- #2501: keep tag-filtered facets and exact list totals below the authenticated
-- viewer ceiling even when the relevant pages are cold.  The count entry points
-- request a value-sensitive plan for the existing private helper, while the
-- inlinable list function gives an unscoped tag its own index-leading arm.
-- derived-from: 20260903075635, 20260901142825

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql stable security invoker
as $$
  select a.*
  from (
    -- No identity or tag filter: preserve the simple active-assets path.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
      and nullif(p_filters ->> 'tagFilter', '') is null
    union all
    -- No identity filter and a tag filter: let (tag, asset_id) drive the plan.
    -- DISTINCT preserves EXISTS semantics when one asset has the tag at both
    -- asset and style-group scope.
    select a.*
    from (
      select distinct e.asset_id
      from public.asset_effective_tags e
      where nullif(p_filters ->> 'tagFilter', '') is not null
        and e.tag = p_filters ->> 'tagFilter'
    ) t
    join public.assets a on a.id = t.asset_id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is null
    union all
    -- Licensor is the leading key when supplied; property/customer still narrow.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is not null
      and a.style_group_id is null
      and a.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or a.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is not null
      and sg.licensor_id = (p_filters ->> 'licensorId')::uuid
      and (nullif(p_filters ->> 'propertyId', '') is null or sg.property_id = (p_filters ->> 'propertyId')::uuid)
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Property leads only when licensor is absent.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and a.style_group_id is null
      and a.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or a.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is not null
      and sg.property_id = (p_filters ->> 'propertyId')::uuid
      and (nullif(p_filters ->> 'customerId', '') is null or sg.customer_id = (p_filters ->> 'customerId')::uuid)
    union all
    -- Customer leads only when neither taxonomy key is supplied.
    select a.*
    from public.assets a
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and a.style_group_id is null
      and a.customer_id = (p_filters ->> 'customerId')::uuid
    union all
    select a.*
    from public.style_groups sg
    join public.assets a on a.style_group_id = sg.id
    where nullif(p_filters ->> 'licensorId', '') is null
      and nullif(p_filters ->> 'propertyId', '') is null
      and nullif(p_filters ->> 'customerId', '') is not null
      and sg.customer_id = (p_filters ->> 'customerId')::uuid
  ) a
  where public.require_dam_access()
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

revoke all on function public.filter_effective_assets(jsonb) from public, anon;
grant execute on function public.filter_effective_assets(jsonb) to authenticated, service_role;

create or replace function public.get_effective_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
set statement_timeout = '8s'
set plan_cache_mode = force_custom_plan
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
set plan_cache_mode = force_custom_plan
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

do $guard$
declare
  v_filter text := lower(regexp_replace(regexp_replace(
    pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure),
    E'--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  v_tag_arm text := 'select distinct e.asset_id from public.asset_effective_tags e where nullif(p_filters ->> ''tagfilter'', '''') is not null and e.tag = p_filters ->> ''tagfilter''';
  v_name text;
  v_config text[];
begin
  if position(v_tag_arm in v_filter) = 0
     or position('and nullif(p_filters ->> ''tagfilter'', '''') is null union all select a.* from (' in v_filter) = 0 then
    raise exception 'tag-filtered effective list lost its mutually exclusive index-leading arm';
  end if;
  if (length(v_filter) - length(replace(v_filter, 'union all', ''))) / length('union all') <> 7 then
    raise exception 'effective list must keep eight mutually exclusive identity/tag arms';
  end if;

  foreach v_name in array array['get_effective_filter_counts', 'get_filter_counts'] loop
    select p.proconfig into v_config
    from pg_proc p
    where p.oid = to_regprocedure(format('public.%I(jsonb)', v_name));
    if not ('statement_timeout=8s' = any(coalesce(v_config, '{}')))
       or not ('plan_cache_mode=force_custom_plan' = any(coalesce(v_config, '{}'))) then
      raise exception '% lost its viewer ceiling or custom-plan guard: %', v_name, v_config;
    end if;
  end loop;

  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_filter_counts(jsonb)','EXECUTE') then
    raise exception 'effective filter/count privileges changed';
  end if;
end;
$guard$;
