-- Read-only source expectation sample for shared-db #4858.
-- Only aggregate expectations and opaque application IDs leave the database.
with migration as (
  select exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261027010036'
  ) as applied
), source_lines as (
  select po.id order_id, po.production_order_number, pol.id order_line_id,
         pol.quantity_ordered, pol.metadata,
         lr.source_id coldlion_source_id,
         pol.metadata->>'line_source_hash' line_hash,
         pol.metadata->>'component_source_hash' component_hash,
         split_part(lr.source_id, ':', 3) sales_order_no,
         split_part(lr.source_id, ':', 5) sales_order_line_no
  from plm.production_order po
  join plm.production_order_line pol on pol.production_order_id = po.id
  join plm.production_order_line_source_ref lr
    on lr.production_order_line_id = pol.id and lr.source_system = 'coldlion'
  where po.source_system = 'coldlion'
    and not (pol.metadata ? 'order_list_source')
    and lr.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
), matched as (
  select s.*, c.quantity component_pack, c.order_qty, o.assortment_parent_key,
         o.case_pack viewer_case_pack,
         o.quantity_ordered viewer_quantity,
         o.cases_reported viewer_cases
  from source_lines s
  join coldlion.intake_order_line l
    on l.sales_order_no = s.sales_order_no::bigint
   and l.sales_order_line_no = s.sales_order_line_no::integer
   and l.line_source_hash = s.line_hash
  join coldlion.intake_order_component c
    on c.line_id = l.id and c.component_source_hash = s.component_hash
  join api.dam_order_list o on o.order_line_id = s.order_line_id
  where c.quantity > 0 and c.order_qty > 0
), classified as (
  select *, quantity_ordered / component_pack as expected_cases
  from matched
), good as (
  select * from classified
  where order_qty % component_pack = 0
    and order_qty = quantity_ordered
    and viewer_case_pack = component_pack
    and viewer_quantity = order_qty
    and viewer_cases = expected_cases
), chosen as (
  select order_id, production_order_number, order_line_id,
         component_pack case_pack, expected_cases cases_reported,
         assortment_parent_key group_key,
         expected_cases order_cases
  from good
), limited_orders as (
  select order_id, production_order_number
  from chosen
  group by order_id, production_order_number
  having bool_or(group_key is not null)
  order by order_id limit 3
)
select json_build_object(
  'migration_applied', (select applied from migration),
  'orders', case when (select applied from migration) then coalesce((
    select json_agg(json_build_object(
      'order_id', c.order_id, 'production_order_number', c.production_order_number,
      'order_line_id', c.order_line_id, 'case_pack', c.case_pack,
      'cases_reported', c.cases_reported, 'group_key', c.group_key,
      'order_cases', c.order_cases
    ) order by c.order_id, c.order_line_id)
    from chosen c join limited_orders lo using (order_id, production_order_number)
  ), '[]'::json) else '[]'::json end
) proof;
