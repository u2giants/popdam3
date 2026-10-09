-- derived-from: 20261006164244
-- Issue #3869, generation 7. Two changes, one transaction:
--
-- A. coldlion.order_history_line gains ColdLion's own entry/edit stamps:
--    created_time, created_user, mod_time, mod_user (nullable; additive).
--    Owner input (Albert Hazan, in chat, 2026-10-09, verbatim): "coldlion has now added
--    to the API a created date/time and modified date/time for when the sales order was
--    entered into the coldlion system." Earlier (verbatim): "I think we should be
--    comparing the date we received the sales order and the date we created or sent the
--    production PO." The loader lands them outside line_source_hash (an edit is not a new
--    line version); the vendor's zone-less wall clock is read as UTC, the convention
--    plm."ProdOrderHeader"."createdTime" already carries, so the two compare directly.
--    /prodHistory sends no createdTime (probed 2026-10-09); the production-PO created
--    time stays plm."ProdOrderHeader"."createdTime" (ColdLion /prodtracking createdTime).
--
-- B. plm.v_prod_order_sales_order_link matches on the CUSTOMER'S PURCHASE ORDER NUMBER.
--    Owner rule (Albert Hazan, in chat, 2026-10-09, verbatim): "so we should always be
--    using the customer's purchase order field and never sales order number. document
--    that and change it in the code". Recorded in
--    docs/business-rules/erp-orders-and-source-meaning.md.
--
-- Rule now:
--   1. PRIMARY: ColdLion production history's customer PO
--      (coldlion.prod_history_line.cust_po_number) equals the ColdLion sales-order
--      customer PO (coldlion.order_history_line.po_number), same company, same customer
--      (MOD011 read as MOD010, Burlington, owner decision 2026-10-06). Both sides are
--      compared trimmed, upper-cased and with leading zeros stripped (ColdLion pads
--      customer POs inconsistently; business rule 2026-09-17).
--   2. NO sales-order NUMBER is a match key anywhere: prod_history_line.sales_order_no
--      and plm."ProdOrderHeader"."salesOrderNo" are no longer read.
--   3. FALLBACK, only for a PO with no customer-PO pair: ColdLion's D-number for the PO
--      (prod_history_line.prod_reference_no) on same-customer sales-order lines, and only
--      when the sales order was ENTERED in ColdLion (earliest order_history_line
--      created_time) from 60 days before to 300 days after the production PO was created
--      (plm."ProdOrderHeader"."createdTime"; prodOrderDate end of day when that is
--      empty). A sales order with no entry time never takes a fallback pair.
--      Window evidence (DesignFlow sandbox, 2026-10-09, ColdLion stamps backfilled):
--      on 2,025 customer-PO pairs with both times, the sales order was entered a median
--      49 days AFTER the production PO was created (2.5th..97.5th percentile: 187 days
--      after .. 22 days before; extremes 348 after .. 247 before). The window
--      [60 days before, 300 days after] covers 99.4% of those pairs. Sales orders are
--      usually entered AFTER the PO is cut, so "entered on or before the PO" would have
--      covered under 10% and was not used.
--   4. link_sources names the asserting path: 'customer_po' or 'prod_reference_no'
--      (a customer-PO pair whose sales order also carries the PO's D-number lists both).
-- Output column list, types and access model are unchanged.

-- A. Columns ---------------------------------------------------------------------
alter table coldlion.order_history_line
  add column if not exists created_time timestamptz,
  add column if not exists created_user text,
  add column if not exists mod_time     timestamptz,
  add column if not exists mod_user     text;

comment on column coldlion.order_history_line.created_time is
  'ColdLion /orderHistory createdTime: when the sales order (line) was entered into ColdLion, i.e. when we received the sales order. Earliest across the line''s components. Vendor wall clock, zone-less, landed as UTC (same convention as plm."ProdOrderHeader"."createdTime"). Null on rows landed before 2026-10-09 until backfilled. Issue #3869.';
comment on column coldlion.order_history_line.created_user is
  'ColdLion /orderHistory createdUser, paired with created_time. Issue #3869.';
comment on column coldlion.order_history_line.mod_time is
  'ColdLion /orderHistory modTime: last change in ColdLion as of the fetch. Latest across components. Not part of line_source_hash. Same clock convention as created_time. Issue #3869.';
comment on column coldlion.order_history_line.mod_user is
  'ColdLion /orderHistory modUser, paired with mod_time. Issue #3869.';

-- SELF-CHECKS ------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(want.rel || '.' || want.col || ' ' || want.typ, ', ')
    into missing
  from (values
    ('plm."ProdOrderHeader"',        'id',                'integer'),
    ('plm."ProdOrderHeader"',        'prodOrderDate',     'character varying'),
    ('plm."ProdOrderHeader"',        'companyCode',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodOrderNo',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodReferenceNo',   'character varying'),
    ('plm."ProdOrderHeader"',        'createdTime',       'timestamp with time zone'),
    ('coldlion.prod_history_line',   'customer_code',     'text'),
    ('coldlion.prod_history_line',   'company_code',      'text'),
    ('coldlion.prod_history_line',   'prod_order_no',     'bigint'),
    ('coldlion.prod_history_line',   'prod_reference_no', 'text'),
    ('coldlion.prod_history_line',   'fetched_at',        'timestamp with time zone'),
    ('coldlion.prod_history_line',   'cust_po_number',    'text'),
    ('coldlion.order_history_line',  'po_number',         'text'),
    ('coldlion.order_history_line',  'created_time',      'timestamp with time zone'),
    ('coldlion.order_history_line',  'customer_code',     'text'),
    ('coldlion.order_history_line',  'company_code',      'text'),
    ('coldlion.order_history_line',  'sales_order_no',    'bigint'),
    ('coldlion.order_history_line',  'prod_reference_no', 'text'),
    ('coldlion.order_history_line',  'start_date',        'date'),
    ('coldlion.order_history_line',  'cancel_date',       'date'),
    ('coldlion.order_history_line',  'fetched_at',        'timestamp with time zone')
  ) as want(rel, col, typ)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass(want.rel)
      and a.attname = want.col and not a.attisdropped and a.attnum > 0
      and format_type(a.atttypid, a.atttypmod) = want.typ
  );
  if missing is not null then
    raise exception '#3869/20261009170724 self-check: target shape differs; missing or mistyped: %', missing;
  end if;
  -- One row per header id requires a valid unique index on id (20260917022233).
  if not exists (
    select 1 from pg_index i
    join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indrelid = 'plm."ProdOrderHeader"'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indnkeyatts = 1 and i.indpred is null and at.attname = 'id'
  ) then
    raise exception '#3869/20261009170724 self-check: plm."ProdOrderHeader".id has no valid unique index';
  end if;
  if not exists (select 1 from pg_class c
                 where c.oid = to_regclass('plm.v_prod_order_sales_order_link') and c.relkind = 'v') then
    raise exception '#3869/20261009170724 self-check: base view from 20261002135053 is missing or not a view';
  end if;
  -- Supporting access paths (both ColdLion line shapes): an index leading with
  -- order_history_line.sales_order_no, and one leading with prod_history_line
  -- prod_order_no or (company_code, prod_order_no).
  if not exists (
    select 1 from pg_index i join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indrelid = 'coldlion.order_history_line'::regclass
      and i.indisvalid and i.indisready and i.indislive and i.indpred is null
      and i.indexprs is null
      and (select c.relam from pg_class c where c.oid = i.indexrelid) = (select oid from pg_am where amname = 'btree')
      and at.attname = 'sales_order_no'
  ) then
    raise exception '#3869/20261009170724 self-check: no valid index leads with coldlion.order_history_line.sales_order_no';
  end if;
  if not exists (
    select 1 from pg_index i
    join pg_attribute a0 on a0.attrelid = i.indrelid and a0.attnum = i.indkey[0]
    left join pg_attribute a1 on a1.attrelid = i.indrelid and a1.attnum = i.indkey[1]
    where i.indrelid = 'coldlion.prod_history_line'::regclass
      and i.indisvalid and i.indisready and i.indislive and i.indpred is null
      and i.indexprs is null
      and (select c.relam from pg_class c where c.oid = i.indexrelid) = (select oid from pg_am where amname = 'btree')
      and (a0.attname = 'prod_order_no' or (a0.attname = 'company_code' and a1.attname = 'prod_order_no'))
  ) then
    raise exception '#3869/20261009170724 self-check: no valid index leads with coldlion.prod_history_line prod_order_no';
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
reference_match as (
  select r.id, s.sales_order_no, max(s.fetched_at) as fetched_at
  from po_reference r
  join h on h.id = r.id
  join po_customer pc on pc.id = r.id and pc.customer_code is not null
  join so_lines s
    on s.reference_key = r.reference_key
   and s.company_code = h.company_code
   and s.customer_code = pc.customer_code
  left join so_created c
    on c.company_code = s.company_code and c.sales_order_no = s.sales_order_no
  where c.so_created_at <= h.po_created_at + interval '300 days'
    and c.so_created_at >= h.po_created_at - interval '60 days'
  group by r.id, s.sales_order_no
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
    raise exception '#3869/20261009170724 post-check: view missing or not security_invoker';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'plm.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3869/20261009170724 post-check: view column list differs from the reviewed shape';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869/20261009170724 post-check: view is readable by a non-owner API role';
  end if;
end $$;
