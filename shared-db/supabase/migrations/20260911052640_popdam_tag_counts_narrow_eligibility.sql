-- #2501 forward repair: count/facet eligibility must not fetch wide asset rows.
-- Thumbnail presence partitions are exhaustive and disjoint. The non-null arm
-- needs no URL payload; the null arm checks the unchanged configurable date.
-- Dynamic optional filters remain in place and may deliberately require heap
-- access. No authorization, RLS, exact counts or eight-second ceiling changes.
-- derived-from: 20260911045353, 20260904121037

-- Ordinary transactional builds preserve the governed atomic lane. Refuse
-- lock contention promptly; each build has a bounded execution budget. These
-- migration-local limits do not alter the eight-second API function settings.
set local lock_timeout='2s';
set local statement_timeout='30s';

-- The unchanged tag RLS policy proves an asset is visible through EXISTS(id).
-- Neither thumbnail-partitioned index alone covers that broader predicate.
create index idx_assets_tag_rls_visible_ids on public.assets(id)
  where is_deleted=false;
create index idx_assets_tag_visible_facets on public.assets(id)
  include(file_type,status,workflow_status,stage,is_licensed)
  where is_deleted=false and thumbnail_url is not null;
create index idx_assets_tag_pending_facets on public.assets(id)
  include(file_type,status,workflow_status,stage,is_licensed,modified_at,file_created_at)
  where is_deleted=false and thumbnail_url is null;

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql stable security invoker
as $$
  select a.* from (
    -- Simple tag requests have no optional wide-column reads even in a generic plan.
    select a.*
    from (select distinct e.asset_id from public.asset_effective_tags e
          where e.tag = p_filters ->> 'tagFilter') t
    join public.assets a on a.id=t.asset_id
    where nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb
      and a.is_deleted=false
      and a.thumbnail_url is not null
      and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
      and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
      and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
      and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    union all
    select a.*
    from (select distinct e.asset_id from public.asset_effective_tags e
          where e.tag = p_filters ->> 'tagFilter') t
    join public.assets a on a.id=t.asset_id
    where nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb
      and a.is_deleted=false
      and a.thumbnail_url is null
      and (a.modified_at >= (select public.assets_thumbnail_min_date())
        or a.file_created_at >= (select public.assets_thumbnail_min_date()))
      and (jsonb_array_length(coalesce(p_filters -> 'fileType','[]')) = 0 or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType')))
      and (jsonb_array_length(coalesce(p_filters -> 'status','[]')) = 0 or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status')))
      and (jsonb_array_length(coalesce(p_filters -> 'workflowStatus','[]')) = 0 or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus')))
      and (jsonb_array_length(coalesce(p_filters -> 'stage','[]')) = 0 or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage')))
      and ((p_filters ->> 'isLicensed') is null or a.is_licensed = (p_filters ->> 'isLicensed')::boolean)
    union all
    -- Preserve the full existing filter path for every other request.
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
  where not coalesce((nullif(p_filters ->> 'tagFilter', '') is not null and (coalesce(p_filters, '{}'::jsonb) - array['tagFilter','fileType','status','workflowStatus','stage','isLicensed']::text[]) = '{}'::jsonb), false)
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
    and (nullif(p_filters ->> 'program','') is null or a.program = p_filters ->> 'program')
  ) a where public.require_dam_access()
$$;

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
      and a.thumbnail_url is not null
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
    -- Arm 1T pending: no identity filter, tag filter present. Driving from
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
      and a.thumbnail_url is null
      and (a.modified_at >= b.thumbnail_min_date or a.file_created_at >= b.thumbnail_min_date)
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
