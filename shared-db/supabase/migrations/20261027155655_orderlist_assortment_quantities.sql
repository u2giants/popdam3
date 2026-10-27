-- #4855 / PopDAM #523: pieces of one SKU in one assortment, never ordered totals.
-- derived-from: none
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
    select l.id as order_line_id, l.assortment_id, l.sku, r.source_id as coldlion_source_id,
      l.metadata ->> 'component_source_hash' as component_hash,
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
  'OrderList pieces per SKU in one assortment, bounded to 1500 exact line IDs. Order recipe is bound to primary ColdLion source and saved component hash. Otherwise a unique current catalog recipe is explicitly identified. Missing, conflicting, nested or nonpositive quantities remain NULL. No total-quantity division or raw-table access. #4855 / PopDAM #523.';

commit;
