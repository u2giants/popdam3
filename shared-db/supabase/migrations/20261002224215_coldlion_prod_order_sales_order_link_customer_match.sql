-- derived-from: 20261002135053
-- Issue #3869 (second change): restrict plm.v_prod_order_sales_order_link to
-- sales orders of the SAME customer as the production order.
--
-- Diagnosis on the DesignFlow sandbox (2026-10-02 EDT): of 22,332 pairs from
-- 20261002135053, 18,976 came only from the order-line reference path
-- (order_history_line.prod_reference_no), and only 4,312 of those had
-- sales-order customer = PO customer. PO reference codes (D-numbers) recur across
-- customers and years (e.g. PO D3513, Hobby Lobby, linked to a Ross sales order).
-- Even with the customer required, reference matches reach years away; pairs that
-- production history confirms sit almost entirely within -120..+240 days of the
-- PO order date (2,756 of 2,795).
--
-- Rule now:
--   * the sales order's customer must equal the PO customer: plm."ProdOrderHeader"
--     ."customerCode", or, when that is blank (312 sandbox POs), the single
--     customer ColdLion production history records for that PO (sales-order
--     customer = its order-line customer, or the production-history customer when
--     ColdLion has no order lines for it). A PO with neither never links;
--   * an invalid or non-ISO "prodOrderDate" (none on the sandbox) never raises: it
--     only disables the reference path for that PO (pg_input_is_valid, PG 16+);
--   * reference-code pairs additionally need the sales-order start date within
--     -120..+240 days of the PO order date ("prodOrderDate", ISO text);
--   * production-history pairs (explicit sales_order_no) need the customer match only;
--   * the legacy header salesOrderNo is kept only when its customer matches too.
-- Customer codes are compared trimmed on both sides.
-- Assumptions, stated: PLM "companyCode" and ColdLion company_code share one code
-- space (both EDGEHOME on the sandbox), as do PLM "customerCode" and ColdLion
-- customer_code (probe: 60 POs where ColdLion's PO customer differs from PLM's).
-- A PO or ColdLion row with a NULL company never links. A sales order whose order
-- lines carry several customers links to a PO whose customer is any one of them.
-- The PO-number join may use either an index leading with prod_order_no (older
-- line shape) or one leading with (company_code, prod_order_no) (current shape);
-- both serve the prod_order_no equality, with company filtered on the fetched rows
-- in the older shape.
-- Column list, access model and the reference index are unchanged.
-- Measured on the sandbox: a full read of the view takes about 0.6 s (EXPLAIN
-- ANALYZE); so_customer is left unrestricted on purpose, because restricting it
-- to candidate sales orders made the plan about 40 times slower (27 s).

-- SELF-CHECKS ------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(want.rel || '.' || want.col || ' ' || want.typ, ', ')
    into missing
  from (values
    ('plm."ProdOrderHeader"',        'id',                'integer'),
    ('plm."ProdOrderHeader"',        'customerCode',      'character varying'),
    ('plm."ProdOrderHeader"',        'prodOrderDate',     'character varying'),
    ('plm."ProdOrderHeader"',        'companyCode',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodOrderNo',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodReferenceNo',   'character varying'),
    ('plm."ProdOrderHeader"',        'salesOrderNo',      'character varying'),
    ('coldlion.prod_history_line',   'customer_code',     'text'),
    ('coldlion.prod_history_line',   'company_code',      'text'),
    ('coldlion.prod_history_line',   'prod_order_no',     'bigint'),
    ('coldlion.prod_history_line',   'sales_order_no',    'bigint'),
    ('coldlion.prod_history_line',   'fetched_at',        'timestamp with time zone'),
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
    raise exception '#3869 self-check: target shape differs; missing or mistyped: %', missing;
  end if;
  -- One row per header id requires a valid unique index on id (20260917022233).
  if not exists (
    select 1 from pg_index i
    join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indrelid = 'plm."ProdOrderHeader"'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indnkeyatts = 1 and i.indpred is null and at.attname = 'id'
  ) then
    raise exception '#3869 self-check: plm."ProdOrderHeader".id has no valid unique index';
  end if;
  if not exists (select 1 from pg_class c
                 where c.oid = to_regclass('plm.v_prod_order_sales_order_link') and c.relkind = 'v') then
    raise exception '#3869 self-check: base view from 20261002135053 is missing or not a view';
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
    raise exception '#3869 self-check: no valid index leads with coldlion.order_history_line.sales_order_no';
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
    raise exception '#3869 self-check: no valid index leads with coldlion.prod_history_line prod_order_no';
  end if;
end $$;

create or replace view plm.v_prod_order_sales_order_link
with (security_invoker = true) as
with h as (
  select
    poh.id,
    poh."companyCode"     as company_code,
    coalesce(nullif(btrim(poh."customerCode"), ''),
             (select min(nullif(btrim(p0.customer_code), '')) from coldlion.prod_history_line p0
               where p0.prod_order_no = case when btrim(poh."prodOrderNo") ~ '^[0-9]{1,18}$'
                                             then btrim(poh."prodOrderNo")::bigint end
                 and p0.company_code = poh."companyCode"
               having count(distinct nullif(btrim(p0.customer_code), '')) = 1)) as customer_code,
    poh."prodOrderNo"     as prod_order_no,
    poh."prodReferenceNo" as prod_reference_no,
    case when btrim(poh."prodOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."prodOrderNo")::bigint end              as prod_order_no_num,
    nullif(lower(btrim(poh."prodReferenceNo")), '')             as prod_reference_key,
    case when btrim(poh."salesOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."salesOrderNo")::bigint end             as header_sales_order_no,
    case when btrim(poh."prodOrderDate") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_input_is_valid(btrim(poh."prodOrderDate"), 'date')
         then btrim(poh."prodOrderDate")::date end              as prod_order_date
  from plm."ProdOrderHeader" poh
),
-- Customer of each sales order: from its order lines; production history only
-- when ColdLion has no order lines for that sales order.
so_customer as (
  select o.company_code, o.sales_order_no, btrim(o.customer_code) as customer_code
  from coldlion.order_history_line o
  group by o.company_code, o.sales_order_no, btrim(o.customer_code)
  union
  select p.company_code, p.sales_order_no, btrim(p.customer_code)
  from coldlion.prod_history_line p
  where p.sales_order_no is not null and p.sales_order_no <> 0
    and not exists (select 1 from coldlion.order_history_line o2
                    where o2.sales_order_no = p.sales_order_no
                      and o2.company_code = p.company_code)
  group by p.company_code, p.sales_order_no, btrim(p.customer_code)
),
pairs as (
  select h.id, h.company_code, h.customer_code, h.prod_order_no, h.prod_reference_no,
         p.sales_order_no, 'prod_history_line'::text as link_source, p.fetched_at
  from h
  join coldlion.prod_history_line p
    on p.prod_order_no = h.prod_order_no_num
   and p.company_code = h.company_code
  where p.sales_order_no is not null and p.sales_order_no <> 0
  union all
  select h.id, h.company_code, h.customer_code, h.prod_order_no, h.prod_reference_no,
         o.sales_order_no, 'order_history_line'::text, o.fetched_at
  from h
  join coldlion.order_history_line o
    on lower(btrim(o.prod_reference_no)) = h.prod_reference_key
   and btrim(o.prod_reference_no) <> ''
   and o.company_code = h.company_code
   and btrim(o.customer_code) = h.customer_code
  where o.sales_order_no is not null and o.sales_order_no <> 0
    and h.prod_order_date is not null
    and o.start_date between h.prod_order_date - 120 and h.prod_order_date + 240
  union all
  select h.id, h.company_code, h.customer_code, h.prod_order_no, h.prod_reference_no,
         h.header_sales_order_no, 'prod_order_header'::text, null::timestamptz
  from h
  where h.header_sales_order_no is not null and h.header_sales_order_no <> 0
),
matched as (
  select pr.*
  from pairs pr
  where exists (select 1 from so_customer sc
                where sc.company_code = pr.company_code
                  and sc.sales_order_no = pr.sales_order_no
                  and sc.customer_code = pr.customer_code)
),
linked as (
  select
    m.id, m.company_code, m.prod_order_no, m.prod_reference_no, m.sales_order_no,
    array_agg(distinct m.link_source order by m.link_source) as link_sources,
    count(distinct m.link_source)::int                        as source_count,
    max(m.fetched_at)                                         as latest_fetched_at
  from matched m
  group by m.id, m.company_code, m.prod_order_no, m.prod_reference_no, m.sales_order_no
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
  'Issue #3869. Production order to ColdLion customer sales order of the SAME customer (PO customer = PLM customerCode, else the single customer ColdLion production history records for the PO; sales-order customer from its order lines, else production history), many-to-many. Sources: prod_history_line (explicit sales order on the PO), order_history_line (PO reference code on the sales-order line, only when the sales-order start date is within -120..+240 days of the PO order date), and the legacy PLM header salesOrderNo. link_sources/source_count name the asserting sources (source_count counts the legacy header too). latest_fetched_at is the newest ColdLion fetch asserting the pair (null when only the header does). sales_order_start_date is the customer promise date (owner ruling 2026-10-02); start/cancel dates come from the newest ColdLion fetch of the sales order; sales_order_start_date_ever_changed flags an older fetch with a different start date.';

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
    raise exception '#3869 post-check: view missing or not security_invoker';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'plm.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3869 post-check: view column list differs from the reviewed shape';
  end if;
  -- The reference path relies on the index created by 20261002135053.
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx')
      and i.indrelid = 'coldlion.order_history_line'::regclass
      and i.indisvalid and i.indisready and i.indislive and i.indnkeyatts = 1
      and pg_get_indexdef(i.indexrelid, 1, true) = 'lower(btrim(prod_reference_no))'
      and regexp_replace(pg_get_expr(i.indpred, i.indrelid, true), '\s|::text|^\(+|\)+$', '', 'g') = 'btrim(prod_reference_no)<>'''''
  ) then
    raise exception '#3869 post-check: reference index from 20261002135053 missing, invalid, or changed';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869 post-check: view is readable by a non-owner API role';
  end if;
end $$;
