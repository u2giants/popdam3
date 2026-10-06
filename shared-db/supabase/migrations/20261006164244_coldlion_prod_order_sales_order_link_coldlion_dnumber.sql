-- derived-from: 20261002224215
-- Issue #3869 (third change), claim #3969: plm.v_prod_order_sales_order_link now
-- matches on ColdLion's own numbers, never on DesignFlow's typed PO reference.
--
-- Owner decision (Albert Hazan, in chat, 2026-10-06, verbatim): "yes, switch
-- matching to ColdLion's numbers" and "yes, MOD010 and MOD011 are the same
-- customer: Burlington."
--
-- Why: plm."ProdOrderHeader"."prodReferenceNo" carries typos (PO 24136 says D3513;
-- ColdLion production history says D3515, Hobby Lobby; also POs 22083, 23372,
-- 22591, 22946). D-numbers are not reused, and one production PO has one customer.
--
-- Rule now:
--   1. prod_history_line pairs (prod_order_no, sales_order_no <> 0) are
--      authoritative and link as they stand.
--   2. Only for a PO with NO such pair: ColdLion's own D-number(s) for that PO
--      (coldlion.prod_history_line.prod_reference_no, never PLM prodReferenceNo)
--      match coldlion.order_history_line.prod_reference_no, same company, same
--      customer. No date guard: D-numbers are not reused (owner fact), so none is
--      needed. A PO with a direct pair still shows order_history_line in
--      link_sources when that sales order's lines carry the PO's ColdLion D-number
--      (corroboration only; it adds no pair).
--   3. The PO customer is ColdLion's: the single customer production history
--      records for the PO (a PO whose history names several customers takes no
--      fallback pairs). Customer codes are compared trimmed, with MOD011 read as
--      MOD010 (Burlington). No existing alias mechanism covers ColdLion customer
--      codes (core.customer_alias holds names; plm.erp_customer is empty on the
--      sandbox), so that one pair is the only alias, written in the view.
--   4. The legacy PLM header salesOrderNo is kept only when the sales-order
--      customer equals ColdLion's PO customer, else PLM "customerCode" when
--      ColdLion has no production history for the PO.
-- Column list, access model and the reference index are unchanged.

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
    ('coldlion.prod_history_line',   'prod_reference_no', 'text'),
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
    raise exception '#3969 self-check: target shape differs; missing or mistyped: %', missing;
  end if;
  -- One row per header id requires a valid unique index on id (20260917022233).
  if not exists (
    select 1 from pg_index i
    join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indrelid = 'plm."ProdOrderHeader"'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indnkeyatts = 1 and i.indpred is null and at.attname = 'id'
  ) then
    raise exception '#3969 self-check: plm."ProdOrderHeader".id has no valid unique index';
  end if;
  if not exists (select 1 from pg_class c
                 where c.oid = to_regclass('plm.v_prod_order_sales_order_link') and c.relkind = 'v') then
    raise exception '#3969 self-check: base view from 20261002135053 is missing or not a view';
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
    raise exception '#3969 self-check: no valid index leads with coldlion.order_history_line.sales_order_no';
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
    raise exception '#3969 self-check: no valid index leads with coldlion.prod_history_line prod_order_no';
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
    case when btrim(poh."salesOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."salesOrderNo")::bigint end             as header_sales_order_no,
    nullif(btrim(poh."customerCode"), '')                       as plm_customer_code
  from plm."ProdOrderHeader" poh
),
-- ColdLion production-history rows of each PLM PO, customer alias applied.
ph as (
  select h.id, p.sales_order_no, p.fetched_at,
         nullif(lower(btrim(p.prod_reference_no)), '') as reference_key,
         coalesce(a.canonical_code, nullif(btrim(p.customer_code), '')) as customer_code
  from h
  join coldlion.prod_history_line p
    on p.prod_order_no = h.prod_order_no_num
   and p.company_code = h.company_code
  left join cust_alias a on a.customer_code = btrim(p.customer_code)
),
-- One row per PO with ColdLion production history; customer_code only when the
-- history names exactly one customer.
po_customer as (
  select ph.id,
         case when count(distinct ph.customer_code) = 1 then min(ph.customer_code) end as customer_code
  from ph
  group by ph.id
),
po_reference as (
  select distinct ph.id, ph.reference_key from ph where ph.reference_key is not null
),
direct as (
  select ph.id, ph.sales_order_no, max(ph.fetched_at) as fetched_at
  from ph
  where ph.sales_order_no is not null and ph.sales_order_no <> 0
  group by ph.id, ph.sales_order_no
),
reference_match as (
  select r.id, o.sales_order_no, max(o.fetched_at) as fetched_at
  from po_reference r
  join h on h.id = r.id
  join po_customer pc on pc.id = r.id and pc.customer_code is not null
  join coldlion.order_history_line o
    on lower(btrim(o.prod_reference_no)) = r.reference_key
   and btrim(o.prod_reference_no) <> ''
   and o.company_code = h.company_code
  left join cust_alias a on a.customer_code = btrim(o.customer_code)
  where o.sales_order_no is not null and o.sales_order_no <> 0
    and coalesce(a.canonical_code, btrim(o.customer_code)) = pc.customer_code
  group by r.id, o.sales_order_no
),
-- Customer of each sales order (legacy header path only): its order lines, else
-- production history when ColdLion has no order lines for it.
so_customer as (
  select o.company_code, o.sales_order_no, coalesce(a.canonical_code, btrim(o.customer_code)) as customer_code
  from coldlion.order_history_line o
  left join cust_alias a on a.customer_code = btrim(o.customer_code)
  group by 1, 2, 3
  union
  select p.company_code, p.sales_order_no, coalesce(a.canonical_code, btrim(p.customer_code))
  from coldlion.prod_history_line p
  left join cust_alias a on a.customer_code = btrim(p.customer_code)
  where p.sales_order_no is not null and p.sales_order_no <> 0
    and not exists (select 1 from coldlion.order_history_line o2
                    where o2.sales_order_no = p.sales_order_no
                      and o2.company_code = p.company_code)
  group by 1, 2, 3
),
pairs as (
  select d.id, d.sales_order_no, 'prod_history_line'::text as link_source, d.fetched_at
  from direct d
  union all
  select m.id, m.sales_order_no, 'order_history_line'::text, m.fetched_at
  from reference_match m
  left join (select distinct d.id from direct d) dp on dp.id = m.id
  left join direct ds on ds.id = m.id and ds.sales_order_no = m.sales_order_no
  where dp.id is null or ds.id is not null
  union all
  select h.id, h.header_sales_order_no, 'prod_order_header'::text, null::timestamptz
  from h
  left join po_customer pc on pc.id = h.id
  left join cust_alias a on a.customer_code = h.plm_customer_code
  join so_customer sc
    on sc.company_code = h.company_code
   and sc.sales_order_no = h.header_sales_order_no
   and sc.customer_code = case when pc.id is null then coalesce(a.canonical_code, h.plm_customer_code)
                               else pc.customer_code end
  where h.header_sales_order_no is not null and h.header_sales_order_no <> 0
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
  'Issue #3869 (claim #3969). Production order to ColdLion customer sales order, many-to-many, on ColdLion''s own numbers. Sources: prod_history_line (explicit sales order on the PO; authoritative); order_history_line (only for a PO with no explicit pair, or as corroboration of one: the PO''s ColdLion D-number, from prod_history_line.prod_reference_no, on sales-order lines of the same customer; PLM prodReferenceNo is never used); legacy PLM header salesOrderNo (only when its sales-order customer is the PO customer). PO customer = the single customer ColdLion production history records for the PO; MOD011 is read as MOD010 (Burlington, owner decision 2026-10-06). link_sources/source_count name the asserting sources. latest_fetched_at is the newest ColdLion fetch asserting the pair (null when only the header does). sales_order_start_date is the customer promise date (owner ruling 2026-10-02); start/cancel dates come from the newest ColdLion fetch of the sales order; sales_order_start_date_ever_changed flags an older fetch with a different start date.';

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
    raise exception '#3969 post-check: view missing or not security_invoker';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'plm.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3969 post-check: view column list differs from the reviewed shape';
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
    raise exception '#3969 post-check: reference index from 20261002135053 missing, invalid, or changed';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception '#3969 post-check: view is readable by a non-owner API role';
  end if;
end $$;
