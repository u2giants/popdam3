-- Issue #1115 / claim #1116.
-- Service-side, exact-only bulk relink for PopDAM OrderList lines.
-- This deliberately reuses the candidate rule enforced by link_dam_order_line:
-- trim + case-fold SKU within the line's licensed/generic catalog, count DISTINCT
-- bridged plm.item ids, and link only when that count is exactly one.

begin;

create or replace function public.relink_dam_order_lines_bulk(p_limit integer default null)
returns jsonb
language plpgsql
security definer
set search_path = plm, public, core, app, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_limit is not null and p_limit < 0 then
    raise exception 'relink_dam_order_lines_bulk: p_limit must be null or non-negative'
      using errcode = '22023';
  end if;

  with base as materialized (
    select l.id, l.master_data_match_status as prior_status,
           l.sku_normalized, l.source_style_type
    from plm.production_order_line l
    where l.item_id is null
      and l.master_data_match_status not in ('manual', 'not_applicable')
      and l.sku_normalized is not null
      and l.source_style_type is not null
    order by l.id
    limit p_limit
    for update of l skip locked
  ), candidates as materialized (
    select b.id, b.prior_status,
           count(distinct bridge.plm_item_id)::integer as candidate_count,
           (array_agg(distinct bridge.plm_item_id order by bridge.plm_item_id)
             filter (where bridge.plm_item_id is not null))[1] as candidate_item_id
    from base b
    left join public.style_tracker_rows r
      on nullif(btrim(lower(r.sku)), '') = b.sku_normalized
    left join plm.style_tracker_item_bridge bridge
      on bridge.style_tracker_row_id = r.id
     and bridge.tracker_type = b.source_style_type
     and bridge.plm_item_id is not null
    group by b.id, b.prior_status
  ), changed as (
    update plm.production_order_line l
       set item_id = c.candidate_item_id,
           master_data_match_status = 'matched',
           metadata = coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object(
             'last_relinked_by', 'system:bulk_order_relink',
             'last_relinked_at', now(),
             'link_candidate_item_count', c.candidate_count,
             'pre_bulk_relink_match_status', c.prior_status),
           updated_at = now()
      from candidates c
     where l.id = c.id
       and c.candidate_count = 1
       and l.item_id is null
       and l.master_data_match_status = c.prior_status
    returning l.id
  ), outcomes as (
    select c.id, c.prior_status,
           case when ch.id is not null then 'matched' else c.prior_status end as final_status,
           c.candidate_count,
           (ch.id is not null) as linked
    from candidates c
    left join changed ch on ch.id = c.id
  ), before_counts as (
    select coalesce(jsonb_object_agg(status, amount), '{}'::jsonb) as value
    from (select prior_status as status, count(*) as amount from outcomes group by prior_status) s
  ), after_counts as (
    select coalesce(jsonb_object_agg(status, amount), '{}'::jsonb) as value
    from (select final_status as status, count(*) as amount from outcomes group by final_status) s
  )
  select jsonb_build_object(
           'before', before_counts.value,
           'after', after_counts.value,
           'considered', (select count(*) from outcomes),
           'linked', (select count(*) from outcomes where linked),
           'ties_left', (select count(*) from outcomes where candidate_count > 1),
           'no_candidate', (select count(*) from outcomes where candidate_count = 0)
         )
    into v_result
  from before_counts cross join after_counts;

  return v_result;
end;
$$;

revoke all on function public.relink_dam_order_lines_bulk(integer) from public, anon, authenticated;
grant execute on function public.relink_dam_order_lines_bulk(integer) to service_role;

comment on function public.relink_dam_order_lines_bulk(integer) is
  'Counts-only, idempotent service RPC. Links only unlinked non-manual OrderList lines whose trim-and-case-folded SKU and tracker type resolve to exactly one distinct bridged plm.item. Preserves prior match status in metadata; never breaks ties or overwrites an existing item link.';

commit;
