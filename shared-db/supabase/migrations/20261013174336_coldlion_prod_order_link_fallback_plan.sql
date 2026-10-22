-- derived-from: 20261009170724
-- Issue #3869, generation 11. PERFORMANCE ONLY: same output, same rule, same columns.
--
-- Regression (DesignFlow sandbox, 2026-10-13 1:37 PM EDT): select * from
-- plm.v_prod_order_sales_order_link took 54-65 s (about 0.6 s on 2026-10-02), so the
-- Production Tracking grid timed out (BFF 502 after 30 s). EXPLAIN ANALYZE showed the
-- generation 7 D-number fallback (reference_match) joining every sales-order line to
-- every production PO of the same company and only then applying the created-time
-- window: 117,266,241 intermediate rows, 104,320,310 removed by the window filter.
-- The planner chose that because it under-estimated the CTE row counts; no missing
-- index was involved (both base tables are read once by sequential/index scan).
--
-- Fix: a materialized ref_candidate CTE resolves each PO's (D-number, company,
-- single customer, created time) first, and so_lines is joined on all three equality
-- keys before the window is applied. Every other CTE is byte-identical to 20261009170724.
-- Rehearsal on sandbox (read-only, 2026-10-13): new body 0.75-0.88 s, 6,138 rows;
-- EXCEPT ALL against the live view is 0 rows in both directions.

do $$
begin
  if not exists (select 1 from pg_class c
                 where c.oid = to_regclass('plm.v_prod_order_sales_order_link') and c.relkind = 'v') then
    raise exception '#3869/20261013174336 self-check: plm.v_prod_order_sales_order_link is missing or not a view';
  end if;
  if not exists (select 1 from pg_attribute a
                 where a.attrelid = to_regclass('coldlion.order_history_line')
                   and a.attname = 'created_time' and not a.attisdropped) then
    raise exception '#3869/20261013174336 self-check: coldlion.order_history_line.created_time missing (20261009170724 not applied)';
  end if;
end $$;

create or replace view plm.v_prod_order_sales_order_link
with (security_invoker = true) as
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
  from plm."ProdOrderHeader" poh
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
-- Sales-order lines with normalised keys. One row per (sales order, key, customer).
so_lines as (
  select o.company_code, o.sales_order_no,
         nullif(ltrim(upper(btrim(o.po_number)), '0'), '')                as customer_po_key,
         nullif(lower(btrim(o.prod_reference_no)), '')                    as reference_key,
         coalesce(a.canonical_code, nullif(btrim(o.customer_code), ''))  as customer_code,
         max(o.fetched_at)                                                as fetched_at
  from coldlion.order_history_line o
  left join cust_alias a on a.customer_code = btrim(o.customer_code)
  where o.sales_order_no is not null and o.sales_order_no <> 0
  group by 1, 2, 3, 4, 5
),
-- When each sales order was entered in ColdLion.
so_created as (
  select o.company_code, o.sales_order_no, min(o.created_time) as so_created_at
  from coldlion.order_history_line o
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
-- created-time window is applied only to matching pairs.
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
  on sd.sales_order_no = l.sales_order_no and sd.company_code = l.company_code;

comment on view plm.v_prod_order_sales_order_link is
  'Issue #3869 (generation 7). Production order to ColdLion customer sales order, many-to-many, matched on the CUSTOMER PURCHASE ORDER NUMBER, never on a sales-order number (owner rule, Albert Hazan, 2026-10-09). Primary: coldlion.prod_history_line.cust_po_number = coldlion.order_history_line.po_number (trimmed, upper-cased, leading zeros stripped), same company and customer (MOD011 read as MOD010, Burlington). Fallback, only for a PO with no customer-PO pair: the PO''s ColdLion D-number (prod_history_line.prod_reference_no) on same-customer sales-order lines entered in ColdLion (order_history_line.created_time) from 60 days before to 300 days after the PO was created (plm.ProdOrderHeader.createdTime, else prodOrderDate end of day). link_sources: customer_po / prod_reference_no. sales_order_no is the identity of the matched sales order. sales_order_start_date is the customer promise date (owner ruling 2026-10-02) from the newest ColdLion fetch.';

revoke all on plm.v_prod_order_sales_order_link from public, anon, authenticated, service_role;

-- POST-CHECKS: catalog only ------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c
    where c.oid = to_regclass('plm.v_prod_order_sales_order_link')
      and c.relkind = 'v'
      and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then
    raise exception '#3869/20261013174336 post-check: view missing or not security_invoker';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'plm.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3869/20261013174336 post-check: view column list differs from the reviewed shape';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869/20261013174336 post-check: view is readable by a non-owner API role';
  end if;
end $$;
