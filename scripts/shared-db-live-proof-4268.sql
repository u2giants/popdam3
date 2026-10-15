-- Read-only expectation sample for popcre/shared-db#4268.
-- Picks OrderList lines in three groups (exactly linked with one stamp, linked
-- with missing or conflicting stamps, not linked) and returns each line's raw
-- ColdLion stamps so the proof computes the New York date independently, plus
-- the raw ColdLion and reader privileges of the anon and authenticated roles.
with lines as (
  select distinct o.order_line_id, o.coldlion_source_id,
    case when o.coldlion_source_id ~ '^coldlion:so:[1-9][0-9]{0,17}:line:[0-9]{1,10}:component:[1-9][0-9]{0,9}$'
      then split_part(o.coldlion_source_id, ':', 3)::bigint end as so_number
  from api.dam_order_list o
), stamps as (
  select h.sales_order_no,
    count(*) as stamp_rows,
    count(h.created_time) as stamped_rows,
    array_agg(distinct h.created_time::text) filter (where h.created_time is not null) as distinct_stamps
  from coldlion.order_history_line h
  where h.company_code = 'EDGEHOME'
    and h.sales_order_no in (select so_number from lines where so_number is not null)
  group by h.sales_order_no
), classified as (
  select l.order_line_id, l.so_number, s.stamp_rows, s.stamped_rows, s.distinct_stamps,
    case
      when l.so_number is null then 'not_linked'
      when s.sales_order_no is null then 'missing'
      when s.stamped_rows = s.stamp_rows and cardinality(s.distinct_stamps) = 1 then 'single'
      else 'missing_or_conflicting'
    end as kind
  from lines l left join stamps s on s.sales_order_no = l.so_number
), ranked as (
  select c.*, row_number() over (partition by kind order by order_line_id) as rn from classified c
)
select json_build_object(
  'sample', (select coalesce(json_agg(json_build_object(
      'order_line_id', order_line_id, 'kind', kind, 'so_number', so_number,
      'stamp_rows', stamp_rows, 'stamped_rows', stamped_rows, 'distinct_stamps', distinct_stamps
    ) order by kind, rn), '[]'::json) from ranked where rn <= 25),
  'raw_access', json_build_object(
    'anon_select_order_history_line', has_table_privilege('anon', 'coldlion.order_history_line', 'SELECT'),
    'authenticated_select_order_history_line', has_table_privilege('authenticated', 'coldlion.order_history_line', 'SELECT'),
    'anon_usage_coldlion_schema', has_schema_privilege('anon', 'coldlion', 'USAGE'),
    'authenticated_usage_coldlion_schema', has_schema_privilege('authenticated', 'coldlion', 'USAGE'),
    'anon_execute_reader', has_function_privilege('anon', 'public.get_dam_order_sales_order_dates(uuid[])', 'EXECUTE'),
    'authenticated_execute_reader', has_function_privilege('authenticated', 'public.get_dam_order_sales_order_dates(uuid[])', 'EXECUTE')
  )
) as proof;
