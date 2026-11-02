-- OrderList source Vendor IDs and unique current workflow, #5393 / claim #5396.
-- derived-from: 20261009073649
begin;

create or replace function dam.orderlist_product_facts(p_item_id uuid, p_catalog text)
returns table(facts jsonb) language sql stable security invoker rows 1 begin atomic
  with exact_links as materialized (
    select b.id as bridge_id, b.style_tracker_row_id as tracker_id
    from plm.style_tracker_item_bridge b
    where b.plm_item_id=p_item_id and (p_catalog is null or b.tracker_type=p_catalog)
  ), fallback_links as materialized (
    select b.id as bridge_id, s.id as tracker_id
    from plm.item target
    join public.style_tracker_rows s
      on lower(btrim(s.sku))=lower(btrim(coalesce(nullif(btrim(target.style_number),''),nullif(btrim(target.item_number),''))))
      and s.tracker_type=p_catalog
    join plm.style_tracker_item_bridge b on b.style_tracker_row_id=s.id and b.tracker_type=p_catalog
    join plm.item linked on linked.id=b.plm_item_id
    where target.id=p_item_id and target.source_system='coldlion' and linked.source_system='coldlion'
      and p_catalog in ('licensed','generic')
      and nullif(btrim(target.raw->>'companyCode'),'') is not null
      and btrim(linked.raw->>'companyCode')=btrim(target.raw->>'companyCode')
      and not exists(select 1 from exact_links)
  ), links as (
    select bridge_id, tracker_id, false as is_fallback from exact_links
    union all select bridge_id, tracker_id, true from fallback_links
  ), candidates as (
    select b.id as bridge_id, s.id as tracker_id, s.tracker_type, links.is_fallback,
      pg_catalog.jsonb_build_object(
        'license_status', case when s.tracker_type = 'generic' then 'Generic Item'
          when s.tracker_type='licensed' then dam.orderlist_license_status(s.row_data, s.discontinued) else s.license_status end,
        'licensor', s.licensor, 'customer', s.customer,
        'default_vendor', s.default_vendor,
        'sample_vendor', case when s.row_data ? 'sample_vendor' then s.row_data->>'sample_vendor' else s.row_data->>case when s.tracker_type='licensed' then 'U' else 'S' end end,
        'test_report', dam.orderlist_parse_boolean(case when s.row_data ? 'test_report' then s.row_data->>'test_report' else s.row_data->>case when s.tracker_type='licensed' then 'AI' else 'AE' end end),
        'professional_photos', dam.orderlist_parse_boolean(case when s.row_data ? 'professional_photos' then s.row_data->>'professional_photos' else s.row_data->>case when s.tracker_type='licensed' then 'AH' else 'AD' end end),
        'contractual_sample_reorder', case when s.tracker_type='licensed' then dam.orderlist_parse_boolean(case when s.row_data ? 'contractual_samples_reorder' then s.row_data->>'contractual_samples_reorder' else s.row_data->>'AO' end) else null end
      ) as facts
    from links
    join plm.style_tracker_item_bridge b on b.id=links.bridge_id
    join public.style_tracker_rows s on s.id=links.tracker_id
  ), summary as (
    select pg_catalog.count(*) as row_count, pg_catalog.count(distinct facts) as distinct_facts,
      pg_catalog.bool_or(is_fallback) and pg_catalog.count(distinct tracker_id)>1 as fallback_ambiguous,
      (pg_catalog.array_agg(facts))[1] as facts,
      case when pg_catalog.count(*)=1 then (pg_catalog.array_agg(bridge_id))[1] end as bridge_id,
      case when pg_catalog.count(*)=1 then (pg_catalog.array_agg(tracker_id))[1] end as tracker_id,
      case when pg_catalog.count(distinct tracker_type)=1 then pg_catalog.min(tracker_type) end as tracker_type
    from candidates
  ) select case when distinct_facts=1 and not fallback_ambiguous then facts else '{}'::jsonb end || pg_catalog.jsonb_build_object(
      'source', case when row_count=0 then 'unavailable' when distinct_facts>1 or fallback_ambiguous then 'ambiguous' else 'master_data' end,
      'bridge_id', bridge_id, 'tracker_id', tracker_id, 'tracker_type', tracker_type
    ) from summary;
end;

create or replace function public.get_dam_order_vendor_ids(p_line_ids uuid[])
returns table(order_line_id uuid, vendor_code text)
language plpgsql stable security definer set search_path=pg_catalog
as $vendor$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_line_ids is null or cardinality(p_line_ids)>1500 or array_position(p_line_ids,null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode='22023';
  end if;
  return query
  with lines as materialized (
    select l.id,l.sku,l.assortment_id,r.source_id,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}(:component:[1-9][0-9]{0,9})?$'
        then split_part(r.source_id,':',3)::bigint end as so,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}(:component:[1-9][0-9]{0,9})?$'
        then split_part(r.source_id,':',5)::integer end as ln
    from plm.production_order_line l
    left join plm.production_order_line_source_ref r on r.production_order_line_id=l.id and r.source_system='coldlion' and r.is_primary
    where l.id=any(p_line_ids)
  ), intake_candidates as materialized (
    select l.*,h.company_code,h.prod_reference_no,h.master_item_no,run.started_at as seen_at,
      max(run.started_at) over(partition by l.id) as latest_run
    from lines l join coldlion.intake_order_line h on h.company_code='EDGEHOME'
      and h.sales_order_no=l.so and h.sales_order_line_no=l.ln
      and h.master_item_no=coalesce(nullif(l.assortment_id,''),l.sku)
    join coldlion.sync_run run on run.id=h.last_seen_run and run.started_at is not null
  ), intake as materialized (
    select i.id,min(i.sku) as sku,min(i.assortment_id) as assortment_id,min(i.so) as so,
      min(i.company_code) as company_code,min(i.master_item_no) as master_item_no,
      min(nullif(btrim(i.prod_reference_no),'')) as prod_reference_no
    from intake_candidates i where i.seen_at=i.latest_run
    group by i.id having count(*)=count(nullif(btrim(i.prod_reference_no),''))
      and count(distinct nullif(btrim(i.prod_reference_no),''))=1
  ), history as materialized (
    select p.company_code,p.sales_order_no,p.prod_reference_no,p.item_no,p.sub_item_no,p.component_id,p.vendor_code,p.line_id
    from plm.coldlion_prod_history p
    where p.company_code='EDGEHOME' and p.sales_order_no>0 and p.sales_order_no in(select i.so from intake i)
  ), codes as (
    select i.id,case when count(p.line_id)>0 and count(p.line_id)=count(nullif(btrim(p.vendor_code),''))
      and count(distinct nullif(btrim(p.vendor_code),''))=1 then min(nullif(btrim(p.vendor_code),'')) end as code
    from intake i left join history p on p.company_code=i.company_code and p.sales_order_no=i.so
      and nullif(btrim(p.prod_reference_no),'')=i.prod_reference_no and p.item_no=i.master_item_no
      and ((nullif(i.assortment_id,'') is null and (p.sub_item_no=i.sku or p.component_id is null))
        or (nullif(i.assortment_id,'') is not null and p.sub_item_no=i.sku))
    group by i.id
  ) select l.id,c.code from lines l left join codes c on c.id=l.id;
end;
$vendor$;
revoke all on function public.get_dam_order_vendor_ids(uuid[]) from public,anon;
grant execute on function public.get_dam_order_vendor_ids(uuid[]) to authenticated;
comment on function public.get_dam_order_vendor_ids(uuid[]) is
'OrderList Vendor ID from exact primary ColdLion SO/line and latest intake production reference, parent/component identity and unanimous nonblank production-history vendor code. At most 1500 exact line IDs. Missing/conflicting evidence stays NULL; identifiers remain text. #5393.';

commit;
