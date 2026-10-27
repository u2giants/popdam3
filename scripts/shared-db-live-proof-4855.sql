-- Read-only independent source expectations for #4855. Raw rows remain private; only aggregates enter the durable proof.
with fn as (
  select p.oid is not null as reader_exists
  from (select to_regprocedure('public.get_dam_order_assortment_quantities(uuid[])') oid) p
), lines as (
  select l.id order_line_id,l.assortment_id,l.sku,l.metadata->>'component_source_hash' component_hash,
         s.source_id coldlion_source_id,
         case when s.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
           then split_part(s.source_id,':',3)::bigint end so_no,
         case when s.source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,9}:component:[1-9][0-9]{0,9}$'
           then split_part(s.source_id,':',5)::integer end so_line
  from plm.production_order_line l
  left join plm.production_order_line_source_ref s on s.production_order_line_id=l.id
    and s.source_system='coldlion' and s.is_primary
  where l.assortment_id is not null and nullif(btrim(l.sku),'') is not null
), order_facts as (
  select l.order_line_id,
    case when count(*)=count(c.quantity) and count(distinct c.quantity)=1 and min(c.quantity)>0 then min(c.quantity)::numeric end qty,
    count(*) matches
  from lines l join coldlion.intake_order_line h on h.company_code='EDGEHOME'
    and h.sales_order_no=l.so_no and h.sales_order_line_no=l.so_line and h.master_item_no=l.assortment_id
  join coldlion.intake_order_component c on c.line_id=h.id and c.sub_item_no=l.sku
    and c.component_source_hash=l.component_hash
  where l.coldlion_source_id is not null
  group by l.order_line_id
), catalog_heads as (
  select h.*,count(*) over(partition by h.item_no) head_count
  from (select distinct i.item_no,i.company_code,i.division_code,i.pre_pack_code
    from coldlion.item_detail i where i.company_code='EDGEHOME' and nullif(btrim(i.pre_pack_code),'') is not null) h
), current_facts as (
  select l.order_line_id,
    case when count(*)=1 and min(p.quantity)>0 and bool_and(nullif(btrim(p.detail_prepack),'') is null)
      then min(p.quantity)::numeric end qty,
    count(*) matches
  from lines l join catalog_heads h on h.item_no=l.assortment_id and h.head_count=1
  join coldlion.prepack_detail p on p.company_code=h.company_code and p.division_code=h.division_code
    and p.prepack_code=h.pre_pack_code and p.item_no=l.sku
  where l.coldlion_source_id is null
  group by l.order_line_id
), facts as (
  select l.order_line_id,
    case when l.coldlion_source_id is not null then o.qty else c.qty end assortment_sku_quantity,
    case when l.coldlion_source_id is not null and o.qty is not null then 'order_recipe'
      when l.coldlion_source_id is null and c.qty is not null then 'current_recipe' end quantity_source,
    case when l.coldlion_source_id is not null then coalesce(o.matches,0) else coalesce(c.matches,0) end recipe_matches
  from lines l left join order_facts o using(order_line_id) left join current_facts c using(order_line_id)
), chosen as (
  (select * from facts where quantity_source='order_recipe' order by order_line_id limit 8)
  union all
  (select * from facts where quantity_source='current_recipe' order by order_line_id limit 8)
  union all
  (select * from facts where quantity_source is null order by (recipe_matches>1) desc,order_line_id limit 8)
)
select json_build_object(
  'reader_exists',(select reader_exists from fn),
  'sample',coalesce((select json_agg(json_build_object('order_line_id',order_line_id,
    'assortment_sku_quantity',assortment_sku_quantity,'quantity_source',quantity_source)) from chosen),'[]'::json)
) as proof;
