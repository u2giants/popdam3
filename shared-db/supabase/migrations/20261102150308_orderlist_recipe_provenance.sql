-- #5407 / PopDAM #638: preserve exact recipe provenance after consolidation.
-- derived-from: 20261027155655
begin;

create or replace function public.get_dam_order_assortment_quantities(p_line_ids uuid[])
returns table(order_line_id uuid, assortment_sku_quantity numeric, quantity_source text)
language plpgsql stable security definer
set search_path = pg_catalog
as $$
begin
  -- OrderList is deliberately readable by every authenticated staff member.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_line_ids is null or cardinality(p_line_ids) > 1500
     or array_position(p_line_ids, null::uuid) is not null then
    raise exception 'Provide at most 1500 non-null OrderList line IDs' using errcode = '22023';
  end if;
  return query
  with lines as materialized (
    select l.id as order_line_id, l.assortment_id,
      case when r.metadata->'orderlist_source_correction'->>'version'='1'
          and r.metadata->'orderlist_source_correction'->>'source_id'=r.source_id
          and r.metadata->'orderlist_source_correction'->>'canonical_sku'=l.sku
          and r.metadata->'orderlist_source_correction'->>'canonical_customer_po' is not distinct from l.customer_po_number
          and r.metadata->'orderlist_source_correction'->>'original_sku'=r.metadata->>'sub_item_no'
          and nullif(btrim(r.metadata->'orderlist_source_correction'->>'evidence_ref'),'') is not null
        then r.metadata->'orderlist_source_correction'->>'original_sku' else l.sku end as sku,
      r.metadata->'orderlist_source_correction' as source_correction,
      r.source_id as coldlion_source_id,
      coalesce(nullif(l.metadata->>'component_source_hash',''),
        case when l.metadata->'coldlion_linked_from'->>'source_id'=r.source_id
          and l.metadata->'coldlion_linked_from'->>'sku'=l.sku
          and l.metadata->'coldlion_linked_from'->>'assortment_id'=l.assortment_id
          then l.metadata#>>'{coldlion_linked_from,metadata,component_source_hash}' end) as component_hash,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
        then split_part(r.source_id, ':', 3)::bigint end as so_number,
      case when r.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
        then split_part(r.source_id, ':', 5)::integer end as so_line
    from plm.production_order_line l
    left join plm.production_order_line_source_ref r on r.production_order_line_id = l.id
      and r.source_system = 'coldlion' and r.is_primary
    where l.id = any(p_line_ids)
  ), order_recipe as materialized (
    select l.order_line_id,
      case when count(*) = count(c.quantity) and count(distinct c.quantity) = 1
        and min(c.quantity) > 0 then min(c.quantity) end as qty
    from lines l
    join coldlion.intake_order_line h on h.company_code = 'EDGEHOME'
      and h.sales_order_no = l.so_number and h.sales_order_line_no = l.so_line
      and h.master_item_no = l.assortment_id
      and (l.source_correction is null or l.source_correction->>'canonical_sku'=l.sku
        or (l.source_correction->>'original_sku'=l.sku
          and l.source_correction->>'original_customer_po' is not distinct from h.po_number))
    join coldlion.intake_order_component c on c.line_id = h.id
      and c.sub_item_no = l.sku and c.component_source_hash = l.component_hash
    group by l.order_line_id
  ), catalog_items as materialized (
    -- The source index orders division before item number. Scan the company
    -- once instead of repeating a partial-index scan for every requested SKU.
    select i.item_no, i.company_code, i.division_code, i.pre_pack_code
    from coldlion.item_detail i
    where i.company_code = 'EDGEHOME' and nullif(btrim(i.pre_pack_code), '') is not null
  ), heads as materialized (
    -- Resolve the whole manifest first. Multiple pack codes or divisions abstain,
    -- even when just one of those recipes happens to contain the requested SKU.
    select distinct i.item_no, i.company_code, i.division_code, i.pre_pack_code
    from catalog_items i
    where i.item_no in (select l.assortment_id from lines l where l.coldlion_source_id is null)
  ), unique_heads as materialized (
    select h.item_no, min(h.company_code) as company_code,
      min(h.division_code) as division_code, min(h.pre_pack_code) as pre_pack_code
    from heads h group by h.item_no having count(*) = 1
  ), catalog_recipe as materialized (
    select l.order_line_id,
      case when count(*) = 1 and min(p.quantity) > 0
        and bool_and(nullif(btrim(p.detail_prepack), '') is null)
        then min(p.quantity)::numeric end as qty
    from lines l
    join unique_heads h on h.item_no = l.assortment_id
    join coldlion.prepack_detail p on p.company_code = h.company_code
      and p.prepack_code = h.pre_pack_code and p.division_code = h.division_code
      and p.item_no = l.sku
    where l.coldlion_source_id is null
    group by l.order_line_id
  )
  select l.order_line_id,
    case when l.coldlion_source_id is not null then r.qty else c.qty end,
    case when l.coldlion_source_id is not null and r.qty is not null then 'order_recipe'
      when l.coldlion_source_id is null and c.qty is not null then 'current_recipe' end
  from lines l
  left join order_recipe r on r.order_line_id = l.order_line_id
  left join catalog_recipe c on c.order_line_id = l.order_line_id;
end;
$$;

revoke all on function public.get_dam_order_assortment_quantities(uuid[]) from public, anon;
grant execute on function public.get_dam_order_assortment_quantities(uuid[]) to authenticated;
comment on function public.get_dam_order_assortment_quantities(uuid[]) is
  'OrderList pieces per SKU in one assortment, bounded to 1500 exact line IDs. Order recipe is bound to primary ColdLion source and saved component hash, including its exact preserved source-line preimage. An explicit source-ref correction may resolve the raw component SKU only while its canonical SKU/PO and original source PO remain bound. Otherwise a unique current catalog recipe is explicitly identified. Missing, conflicting, nested or nonpositive quantities remain NULL. No total-quantity division or raw-table access. #5407 / PopDAM #638.';

commit;
