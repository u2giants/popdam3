-- Read-only expectation sample for #4858. Raw rows stay inside this query;
-- only opaque IDs and numeric expectations are returned to the proof runner.
with migration as (
  select exists (select 1 from supabase_migrations.schema_migrations where version='20261027010036') applied
), order_lines as (
  select po.id order_id,po.production_order_number,pol.id order_line_id,pol.source_id,
         pol.sku,pol.quantity_ordered,pol.case_pack direct_case_pack,pol.order_type,
         pol.metadata->>'master_item_no' master_item_no,
         pol.metadata->>'component_source_hash' component_hash
  from plm.production_order po join plm.production_order_line pol on pol.production_order_id=po.id
  where po.source_system='coldlion' and not (pol.metadata ? 'order_list_source')
    and po.voided_at is null and pol.voided_at is null
    and lower(coalesce(pol.order_type,'')) not like '%sample%'
), source_lines as (
  select s.*,split_part(s.source_id,':',3)::bigint sales_order_no,
         split_part(s.source_id,':',5)::integer sales_order_line_no
  from order_lines s
  where s.source_id ~ '^coldlion:so:[0-9]+:line:[0-9]+:component:[0-9]+$'
), component_versions as (
  select s.order_id,s.production_order_number,s.order_line_id,s.source_id,s.sku,
         s.quantity_ordered,s.sales_order_no,s.sales_order_line_no,s.master_item_no,
         l.company_code,l.division_code,c.quantity component_pack,c.order_qty
  from source_lines s
  join coldlion.intake_order_line l on l.sales_order_no=s.sales_order_no
    and l.sales_order_line_no=s.sales_order_line_no and l.master_item_no=s.master_item_no
  join coldlion.intake_order_component c on c.line_id=l.id
    and c.component_source_hash=s.component_hash
    and coalesce(nullif(btrim(c.sub_item_no),''),l.master_item_no)=s.sku
  where s.sales_order_line_no=0
), resolved_components as (
  -- Collapse versions only when company, division, quantity and ordered units agree.
  select order_id,production_order_number,order_line_id,source_id,sku,quantity_ordered,
         sales_order_no,sales_order_line_no,master_item_no,
         min(component_pack) component_pack,min(order_qty) source_order_qty,
         count(distinct company_code) company_versions,count(distinct division_code) division_versions,
         count(distinct component_pack) pack_versions,count(distinct order_qty) unit_versions
  from component_versions
  group by order_id,production_order_number,order_line_id,source_id,sku,quantity_ordered,
           sales_order_no,sales_order_line_no,master_item_no
), line_expectations as (
  select s.order_id,s.production_order_number,s.order_line_id,
         case when sl.sales_order_line_no=0 then r.component_pack else s.direct_case_pack end case_pack,
         case when sl.sales_order_line_no=0 then s.quantity_ordered/nullif(r.component_pack,0)
              when s.direct_case_pack>0 then s.quantity_ordered/s.direct_case_pack end cases_reported,
         case when sl.sales_order_line_no=0 then concat_ws(':',sl.sales_order_no,sl.sales_order_line_no,sl.master_item_no) end group_key,
         coalesce(sl.sales_order_line_no=0,false) is_assortment,
         (sl.order_line_id is not null and r.order_line_id is not null
          and r.company_versions=1 and r.division_versions=1 and r.pack_versions=1 and r.unit_versions=1
          and r.component_pack>0 and r.source_order_qty=s.quantity_ordered) source_consistent,
         (sl.order_line_id is not null and sl.sales_order_line_no<>0
          and s.direct_case_pack>0 and s.quantity_ordered is not null) direct_consistent
  from order_lines s
  left join source_lines sl on sl.order_line_id=s.order_line_id
  left join resolved_components r on r.order_line_id=s.order_line_id
), group_quality as (
  select order_id,group_key,count(distinct cases_reported) carton_counts
  from line_expectations where is_assortment group by order_id,group_key
), order_quality as (
  select order_id,production_order_number,
         count(*) filter(where is_assortment) assortment_count,
         count(*) filter(where (is_assortment and not coalesce(source_consistent,false))
                           or (not is_assortment and not coalesce(direct_consistent,false))) unknown_count,
         count(*) filter(where cases_reported is null or case_pack is null) null_count,
         count(distinct group_key) filter(where is_assortment) groups_count,
         (select count(*) from group_quality g where g.order_id=e.order_id and g.carton_counts<>1) inconsistent_group_count
  from line_expectations e group by order_id,production_order_number
), chosen as (
  select e.* from line_expectations e join order_quality q using(order_id,production_order_number)
  where q.assortment_count>0 and q.unknown_count=0 and q.null_count=0 and q.inconsistent_group_count=0
), totals as (
  select order_id,sum(cases_reported) order_cases from (
    select order_id,coalesce(group_key,order_line_id::text) physical_group,max(cases_reported) cases_reported
    from chosen group by order_id,coalesce(group_key,order_line_id::text)
  ) g group by order_id
), limited_orders as (
  select c.order_id,c.production_order_number from chosen c
  join order_quality q using(order_id,production_order_number)
  group by c.order_id,c.production_order_number,q.groups_count order by c.order_id limit 3
)
select json_build_object(
  'migration_applied',(select applied from migration),
  'orders',case when (select applied from migration) then coalesce((
    select json_agg(json_build_object('order_id',c.order_id,'production_order_number',c.production_order_number,
      'order_line_id',c.order_line_id,'case_pack',c.case_pack,'cases_reported',c.cases_reported,
      'group_key',c.group_key,'order_cases',t.order_cases) order by c.order_id,c.order_line_id)
    from chosen c join limited_orders lo using(order_id,production_order_number) join totals t using(order_id)
  ),'[]'::json) else '[]'::json end
) proof;
