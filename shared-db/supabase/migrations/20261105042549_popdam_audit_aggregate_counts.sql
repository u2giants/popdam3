-- Read-only aggregate interfaces for existing DAM screens, retaining app access.
begin;
create or replace function public.get_dam_asset_taxonomy_counts()
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '8s'
as $$
declare result jsonb;
begin
  perform public.require_dam_access();
  with base as materialized (select licensor_id, property_id from public.assets where not is_deleted),
  licensors as (select licensor_id, count(*) n from base where licensor_id is not null group by licensor_id),
  properties as (select property_id, count(*) n from base where property_id is not null group by property_id)
  select jsonb_build_object('licensors',coalesce((select jsonb_object_agg(licensor_id,n) from licensors),'{}'::jsonb),
    'properties',coalesce((select jsonb_object_agg(property_id,n) from properties),'{}'::jsonb)) into result;
  return result;
end $$;
create or replace function public.get_dam_order_list_status_counts()
returns jsonb language plpgsql stable security invoker set search_path = '' set statement_timeout = '8s'
as $$
declare result jsonb;
begin
  perform public.require_dam_access();
  select jsonb_build_object('total',count(*),'linked',count(*) filter(where item_id is not null),
    'ambiguous',count(*) filter(where master_data_match_status='ambiguous'),
    'unmatched',count(*) filter(where item_id is null and master_data_match_status not in ('not_applicable','ambiguous')))
  into result from api.dam_order_list;
  return result;
end $$;
create or replace function public.get_dam_style_group_asset_count(
  p_filters jsonb default '{}'::jsonb, p_min_date timestamptz default '2020-01-01',
  p_search_ids uuid[] default null, p_fallback_terms text[] default null)
returns bigint language plpgsql stable security definer set search_path = '' set statement_timeout = '8s'
as $$
declare result bigint; f jsonb := coalesce(p_filters,'{}'::jsonb);
begin
  perform public.require_dam_access();
  select coalesce(sum(g.asset_count),0) into result from public.style_groups g
  where (g.latest_file_date>=p_min_date or (g.latest_file_date is null and g.asset_count>0))
  and (p_search_ids is null or g.id=any(p_search_ids))
  and (p_fallback_terms is null or exists(select 1 from unnest(p_fallback_terms) term
    cross join unnest(array[g.sku,g.cover_description,g.folder_path,g.licensor_name,g.property_name,g.product_category,g.customer,g.program]) value
    where value ilike '%'||term||'%'))
  and (coalesce(jsonb_array_length(f->'stage'),0)=0 or g.stage in (select jsonb_array_elements_text(f->'stage')))
  and (nullif(f->>'customer','') is null or g.customer_id=(f->>'customer')::uuid)
  and (nullif(f->>'program','') is null or g.program=f->>'program')
  and (f->>'isLicensed' is null or g.is_licensed=(f->>'isLicensed')::boolean)
  and (coalesce(jsonb_array_length(f->'workflowStatus'),0)=0 or g.workflow_status::text in (select jsonb_array_elements_text(f->'workflowStatus')))
  and (nullif(f->>'licensorId','') is null or g.licensor_id=(f->>'licensorId')::uuid)
  and (nullif(f->>'propertyId','') is null or g.property_id=(f->>'propertyId')::uuid)
  and (coalesce(jsonb_array_length(f->'assetType'),0)=0 or g.primary_asset_type::text in (select jsonb_array_elements_text(f->'assetType')))
  and (coalesce(jsonb_array_length(f->'fileStatus'),0)=0 or exists(select 1 from jsonb_array_elements_text(f->'fileStatus') status where
    case status when 'has_preview' then g.primary_thumbnail_url is not null
      when 'no_preview_renderable' then g.primary_thumbnail_url is null and g.primary_thumbnail_error is null
      when 'no_pdf_compat' then g.primary_thumbnail_url is null and g.primary_thumbnail_error='no_pdf_compat'
      when 'no_preview_unsupported' then g.primary_thumbnail_url is null and g.primary_thumbnail_error is not null and g.primary_thumbnail_error<>'no_pdf_compat'
      else false end))
  and (not exists(select 1 from jsonb_array_elements_text(coalesce(f->'productCategory','[]'::jsonb)) c where c in ('Wall','Tabletop','Clock','Storage','Workspace','Floor','Garden'))
    or g.product_category in (select jsonb_array_elements_text(f->'productCategory'))
    or (f->'productCategory' ? 'Wall' and (g.folder_path ilike '%WALL ART%' or g.folder_path ilike '%3FZ%')));
  return result;
end $$;
revoke all on function public.get_dam_asset_taxonomy_counts() from public,anon;
revoke all on function public.get_dam_order_list_status_counts() from public,anon;
revoke all on function public.get_dam_style_group_asset_count(jsonb,timestamptz,uuid[],text[]) from public,anon;
grant execute on function public.get_dam_asset_taxonomy_counts() to authenticated,service_role;
grant execute on function public.get_dam_order_list_status_counts() to authenticated,service_role;
grant execute on function public.get_dam_style_group_asset_count(jsonb,timestamptz,uuid[],text[]) to authenticated,service_role;
commit;
