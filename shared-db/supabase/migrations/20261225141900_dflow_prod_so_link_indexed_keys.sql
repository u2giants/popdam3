-- derived-from: 20261225140000
-- popcre/designflow-tracking#138 follow-up: the Tracking grid's sales-order anchor step
-- (dflow_prod.prod_order_sales_order_link(int[])) read all of coldlion.order_history_line
-- (~120k lines) on every page because its line filter was one OR of two key expressions,
-- which no index could serve (measured 0.6-2.6 s per 100-order page, 2026-11-26).
--
-- Change: two expression indexes on exactly those key expressions, and the function's
-- so_lines step finds line ids through one indexed probe per key kind (UNION), then
-- normalises as before. Matching rules, return type and every output are unchanged:
-- old and new bodies were compared read-only on production over all 5,975 rows for every
-- ProdOrderHeader id (EXCEPT ALL both ways: 0 / 0). Full history is kept on purpose: the
-- customer-PO match has no date window, so a cut-off could change anchors.
-- Additive: two indexes + CREATE OR REPLACE of one function with an identical signature.

create index if not exists coldlion_order_history_line_customer_po_key_idx
  on coldlion.order_history_line ((nullif(ltrim(upper(btrim(po_number)), '0'), '')));

create index if not exists coldlion_order_history_line_reference_key_idx
  on coldlion.order_history_line ((nullif(lower(btrim(prod_reference_no)), '')));

CREATE OR REPLACE FUNCTION dflow_prod.prod_order_sales_order_link(p_ids integer[])
 RETURNS SETOF dflow_prod.v_prod_order_sales_order_link
 LANGUAGE sql
 STABLE
AS $function$
with cust_alias(customer_code, canonical_code) as (
  values ('MOD011'::text, 'MOD010'::text)
),
h as (
  select
    poh.id,
    poh."companyCode"     as company_code,
    poh."prodOrderNo"     as prod_order_no,
    poh."prodReferenceNo" as prod_reference_no,
    case when btrim(poh."prodOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."prodOrderNo")::bigint end              as prod_order_no_num,
    coalesce(poh."createdTime",
             -- Guarded parse (as in 20261002224215): an invalid prodOrderDate never raises.
             case when btrim(poh."prodOrderDate") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                   and pg_input_is_valid(left(btrim(poh."prodOrderDate"), 10), 'date')
                  then ((left(btrim(poh."prodOrderDate"), 10)::date + 1)::timestamp at time zone 'UTC') end)
                                                                as po_created_at
  from dflow_prod."ProdOrderHeader" poh
  where poh.id = any(p_ids)
),
-- ColdLion production-history rows of each PLM PO, customer alias applied.
ph as (
  select h.id,
         nullif(lower(btrim(p.prod_reference_no)), '')                    as reference_key,
         nullif(ltrim(upper(btrim(p.cust_po_number)), '0'), '')          as customer_po_key,
         coalesce(a.canonical_code, nullif(btrim(p.customer_code), ''))  as customer_code,
         p.fetched_at
  from h
  join coldlion.prod_history_line p
    on p.prod_order_no = h.prod_order_no_num
   and p.company_code = h.company_code
  left join cust_alias a on a.customer_code = btrim(p.customer_code)
),
-- Customer of each PO: only when its history names exactly one customer.
po_customer as (
  select ph.id,
         case when count(distinct ph.customer_code) = 1 then min(ph.customer_code) end as customer_code
  from ph
  group by ph.id
),
po_reference as (
  select distinct ph.id, ph.reference_key from ph where ph.reference_key is not null
),
-- Sales-order lines whose join keys can meet this page's POs, found through the two
-- expression indexes (#138): one indexed probe per key kind, union of line ids. Same
-- set as the former single OR filter, without reading the whole history.
so_line_ids as (
  select o.id
  from coldlion.order_history_line o
  where nullif(ltrim(upper(btrim(o.po_number)), '0'), '') in
          (select ph.customer_po_key from ph where ph.customer_po_key is not null)
  union
  select o.id
  from coldlion.order_history_line o
  where nullif(lower(btrim(o.prod_reference_no)), '') in
          (select r.reference_key from po_reference r)
),
-- Sales-order lines with normalised keys. One row per (sales order, key, customer).
so_lines as (
  select o.company_code, o.sales_order_no,
         nullif(ltrim(upper(btrim(o.po_number)), '0'), '')                as customer_po_key,
         nullif(lower(btrim(o.prod_reference_no)), '')                    as reference_key,
         coalesce(a.canonical_code, nullif(btrim(o.customer_code), ''))  as customer_code,
         max(o.fetched_at)                                                as fetched_at
  from so_line_ids k
  join coldlion.order_history_line o on o.id = k.id
  left join cust_alias a on a.customer_code = btrim(o.customer_code)
  where o.sales_order_no is not null and o.sales_order_no <> 0
  group by 1, 2, 3, 4, 5
),
-- When each sales order was entered in ColdLion.
so_created as (
  select o.company_code, o.sales_order_no, min(o.created_time) as so_created_at
  from coldlion.order_history_line o
  -- by-ids: whole sales orders only, so min(created_time) is unchanged.
  where o.sales_order_no in (select s.sales_order_no from so_lines s)
  group by 1, 2
),
customer_po_match as (
  select ph.id, s.sales_order_no, max(greatest(ph.fetched_at, s.fetched_at)) as fetched_at
  from ph
  join h on h.id = ph.id
  join so_lines s
    on s.customer_po_key = ph.customer_po_key
   and s.company_code = h.company_code
   and s.customer_code = ph.customer_code
  where ph.customer_po_key is not null
  group by ph.id, s.sales_order_no
),
-- PO-side D-number candidates, resolved BEFORE touching sales-order lines, so the
-- join to so_lines runs on equality keys (reference, company, customer) and the
-- created-time window is applied only to matching pairs (generation 11 perf fix).
ref_candidate as materialized (
  select r.id, r.reference_key, h.company_code, h.po_created_at, pc.customer_code
  from po_reference r
  join h on h.id = r.id
  join po_customer pc on pc.id = r.id and pc.customer_code is not null
),
reference_match as (
  select rc.id, s.sales_order_no, max(s.fetched_at) as fetched_at
  from ref_candidate rc
  join so_lines s
    on s.reference_key = rc.reference_key
   and s.company_code = rc.company_code
   and s.customer_code = rc.customer_code
  left join so_created c
    on c.company_code = s.company_code and c.sales_order_no = s.sales_order_no
  where c.so_created_at <= rc.po_created_at + interval '300 days'
    and c.so_created_at >= rc.po_created_at - interval '60 days'
  group by rc.id, s.sales_order_no
),
pairs as (
  select m.id, m.sales_order_no, 'customer_po'::text as link_source, m.fetched_at
  from customer_po_match m
  union all
  -- D-number fallback: a PO with no customer-PO pair; or corroboration of a pair.
  select m.id, m.sales_order_no, 'prod_reference_no'::text, m.fetched_at
  from reference_match m
  left join (select distinct c.id from customer_po_match c) cp on cp.id = m.id
  left join customer_po_match cs on cs.id = m.id and cs.sales_order_no = m.sales_order_no
  where cp.id is null or cs.id is not null
),
  linked as (
  select
    h.id, h.company_code, h.prod_order_no, h.prod_reference_no, pr.sales_order_no,
    array_agg(distinct pr.link_source order by pr.link_source) as link_sources,
    count(distinct pr.link_source)::int                         as source_count,
    max(pr.fetched_at)                                          as latest_fetched_at
  from pairs pr
  join h on h.id = pr.id
  group by h.id, h.company_code, h.prod_order_no, h.prod_reference_no, pr.sales_order_no
),
so_rows as (
  select o.company_code, o.sales_order_no, o.start_date, o.cancel_date, o.fetched_at,
         max(o.fetched_at) over (partition by o.company_code, o.sales_order_no) as latest_fetch
  from coldlion.order_history_line o
  where o.sales_order_no in (select l.sales_order_no from linked l)
),
so_latest as (
  select r.*,
         min(r.start_date) filter (where r.fetched_at = r.latest_fetch)
           over (partition by r.company_code, r.sales_order_no) as latest_start_min,
         max(r.start_date) filter (where r.fetched_at = r.latest_fetch)
           over (partition by r.company_code, r.sales_order_no) as latest_start_max
  from so_rows r
),
so_dates as (
  select company_code, sales_order_no,
         min(latest_start_min)                                     as sales_order_start_date,
         min(latest_start_max)                                     as sales_order_start_date_max,
         min(cancel_date) filter (where fetched_at = latest_fetch) as sales_order_cancel_date,
         coalesce(bool_or(fetched_at < latest_fetch
                          and start_date is distinct from latest_start_min
                          and start_date is distinct from latest_start_max), false)
                                                                   as sales_order_start_date_ever_changed
  from so_latest
  group by company_code, sales_order_no
)
select
  l.id                as prod_order_header_id,
  l.company_code,
  l.prod_order_no,
  l.prod_reference_no,
  l.sales_order_no,
  l.link_sources,
  l.source_count,
  l.latest_fetched_at,
  sd.sales_order_start_date,
  sd.sales_order_start_date_max,
  sd.sales_order_cancel_date,
  coalesce(sd.sales_order_start_date_ever_changed, false) as sales_order_start_date_ever_changed
from linked l
left join so_dates sd
  on sd.sales_order_no = l.sales_order_no and sd.company_code = l.company_code
$function$;

analyze coldlion.order_history_line;
