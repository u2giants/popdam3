-- Read-only expectation sample for #4858 (owner 2026-10-27: an assortment
-- component's Case Pack is the WHOLE carton's piece count). Raw rows stay inside
-- this query; only opaque IDs and numeric expectations are returned.
with migration as (
  select exists (select 1 from supabase_migrations.schema_migrations where version='20261027185328')
     and pg_get_viewdef('api.dam_order_list'::regclass,true) ~ 'jsonb_build_array\(''coldlion'''
     and pg_get_viewdef('api.dam_order_list'::regclass,true) ~ 'THEN NULL::numeric\s+ELSE\s+CASE\s+WHEN pol\.case_pack > 0'
     as applied
), order_lines as (
  select po.id order_id,po.production_order_number,pol.id order_line_id,pol.source_id,
         pol.sku,pol.quantity_ordered,pol.case_pack direct_case_pack,
         pol.assortment_component_ordinal is not null is_assortment,
         pol.metadata->>'master_item_no' master_item_no
  from plm.production_order po join plm.production_order_line pol on pol.production_order_id=po.id
  where po.source_system='coldlion'
    and not exists (select 1 from plm.production_order_line excluded
      where excluded.production_order_id=po.id and excluded.voided_at is null
        and (excluded.source_system is distinct from 'coldlion' or excluded.metadata ? 'order_list_source'))
    and po.voided_at is null and pol.voided_at is null
    and lower(coalesce(pol.order_type,'')) not like '%sample%'
), source_lines as (
  select s.*,split_part(s.source_id,':',3)::bigint sales_order_no,
         split_part(s.source_id,':',5)::integer sales_order_line_no
  from order_lines s
  where s.source_id ~ '^coldlion:so:[1-9][0-9]*:line:[0-9]+:component:[1-9][0-9]*$'
), parent_versions as (
  -- The latest ColdLion observation of each physical parent line, the same
  -- source the writer and the 2026-10-28 fill-in use.
  select s.order_line_id,l.prepack_qty,l.line_qty,l.line_cancelled_qty,
         rank() over (partition by s.order_line_id order by r.started_at desc nulls last,l.last_seen_run desc) rk
  from source_lines s
  join coldlion.intake_order_line l on l.sales_order_no=s.sales_order_no
    and l.sales_order_line_no=s.sales_order_line_no and l.master_item_no=s.master_item_no
  left join coldlion.sync_run r on r.id=l.last_seen_run
  where s.is_assortment
), parents as (
  select order_line_id,min(prepack_qty) carton_total,min(line_qty) line_qty,
         count(distinct prepack_qty)=1 and count(prepack_qty)=count(*)
           and count(distinct line_qty)=1 and count(line_qty)=count(*)
           and bool_and(coalesce(line_cancelled_qty,0)<line_qty) consistent
  from parent_versions where rk=1 group by order_line_id
), line_expectations as (
  select s.order_id,s.production_order_number,s.order_line_id,
         case when s.is_assortment then p.carton_total else s.direct_case_pack end case_pack,
         case when not s.is_assortment and s.direct_case_pack>0 then s.quantity_ordered/s.direct_case_pack end cases_reported,
         case when s.is_assortment then p.line_qty/nullif(p.carton_total,0) end parent_cases,
         case when s.is_assortment then concat_ws(':',sl.sales_order_no,sl.sales_order_line_no,sl.master_item_no) end group_key,
         s.is_assortment,
         (sl.order_line_id is not null and p.consistent and p.carton_total>0
          and p.line_qty>=p.carton_total and mod(p.line_qty,p.carton_total)=0
          and nullif(btrim(sl.master_item_no),'') is not null) source_consistent,
         (sl.order_line_id is not null and not s.is_assortment
          and s.direct_case_pack>0 and s.quantity_ordered>=s.direct_case_pack) direct_consistent
  from order_lines s
  left join source_lines sl on sl.order_line_id=s.order_line_id
  left join parents p on p.order_line_id=s.order_line_id
), order_quality as (
  select order_id,production_order_number,
         count(*) filter(where is_assortment) assortment_count,
         count(*) filter(where (is_assortment and not coalesce(source_consistent,false))
                           or (not is_assortment and not coalesce(direct_consistent,false))) unknown_count
  from line_expectations group by order_id,production_order_number
), chosen as (
  select e.* from line_expectations e join order_quality q using(order_id,production_order_number)
  where q.assortment_count>0 and q.unknown_count=0
), totals as (
  select order_id,sum(cartons) order_cases from (
    select order_id,coalesce(group_key,order_line_id::text) physical_group,
           max(coalesce(parent_cases,cases_reported)) cartons
    from chosen group by order_id,coalesce(group_key,order_line_id::text)
  ) g group by order_id
), limited_orders as (
  -- The two orders named in the owner's report first, then the lowest IDs.
  select order_id,production_order_number from (
    select distinct order_id,production_order_number,
           production_order_number in ('COLDLION-SO-7128124','COLDLION-SO-7128126') named
    from chosen) o
  order by named desc,order_id limit 4
)
select json_build_object(
  'migration_applied',(select applied from migration),
  'orders',case when (select applied from migration) then coalesce((
    select json_agg(json_build_object('order_id',c.order_id,'production_order_number',c.production_order_number,
      'order_line_id',c.order_line_id,'case_pack',c.case_pack,'cases_reported',c.cases_reported,
      'parent_cases',c.parent_cases,'group_key',c.group_key,'order_cases',t.order_cases) order by c.order_id,c.order_line_id)
    from chosen c join limited_orders lo using(order_id,production_order_number) join totals t using(order_id)
  ),'[]'::json) else '[]'::json end
) proof;
