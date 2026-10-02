-- Issue #3869: production-PO <-> customer sales-order link for DesignFlow
-- production tracking (popcre/designflow-tracking plan step 7).
--
-- ColdLion relates production orders (POs) to sales orders (SOs) many-to-many,
-- through two ColdLion feeds plus a legacy header column:
--   1. coldlion.prod_history_line.sales_order_no        keyed by company + PO number
--   2. coldlion.order_history_line.prod_reference_no    keyed by company + PO reference (e.g. D-number)
--   3. plm."ProdOrderHeader"."salesOrderNo"              legacy, mostly '0'
-- Both feeds come from the same ERP, so agreement between them is consistency,
-- not independent corroboration.
--
-- prod_history_line is append-only per (company, PO, line, stage, version). The
-- view reads every retained version and stage, and exposes latest_fetched_at
-- (newest ColdLion fetch time, fetched_at, among the rows asserting the pair;
-- not source_observed_at, which the older line shape lacks) so a consumer can
-- tell a current pair from one only seen in an older fetch.
--
-- Owner ruling (Albert's chat, 2026-10-02, via Yuchen): the ColdLion sales-order
-- START date is the customer promise. The view exposes it per pair, taken from
-- the newest ColdLion fetch of that sales order, and flags when any retained
-- fetch carried a different start date.
--
-- PO references are compared trimmed and case-insensitively on both sides; the
-- expression index uses exactly that expression.
--
-- Access paths: the reference join uses the new expression index; the PO-number
-- join (company_code, prod_order_no) uses the leading columns of the
-- prod_history_line identity/partition index (current shape) or its
-- prod_order_no-leading unique index (older shape); the sales-order date lookup
-- uses the sales_order_no-leading identity index of order_history_line in both
-- shapes. Company matching is plain equality so those indexes stay usable.
--
-- The view deliberately uses only columns present in BOTH the current ColdLion
-- line shape (20260905105038 / 20260905142150) and the older landing shape
-- (20260825023430) still present on the DesignFlow sandbox. The self-check
-- enforces exactly that column set; the link semantics (PO number, PO reference,
-- sales order, company, fetch time, dates) are identical in both shapes.
--
-- Access model matches sibling plm tracking objects
-- (20260917022233_plm_prod_order_milestone_schedule.sql): the DesignFlow API
-- connects as the table owner (postgres on the sandbox); no browser or
-- service-role access, asserted by the post-check.
-- Additive and read-only; no existing object is altered.

-- SELF-CHECKS: fail the migration if the target differs ----------------------
do $$
declare
  missing text;
begin
  select string_agg(want.rel || '.' || want.col || ' ' || want.typ, ', ')
    into missing
  from (values
    ('plm."ProdOrderHeader"',        'id',                'integer'),
    ('plm."ProdOrderHeader"',        'companyCode',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodOrderNo',       'character varying'),
    ('plm."ProdOrderHeader"',        'prodReferenceNo',   'character varying'),
    ('plm."ProdOrderHeader"',        'salesOrderNo',      'character varying'),
    ('coldlion.prod_history_line',   'company_code',      'text'),
    ('coldlion.prod_history_line',   'prod_order_no',     'bigint'),
    ('coldlion.prod_history_line',   'sales_order_no',    'bigint'),
    ('coldlion.prod_history_line',   'fetched_at',        'timestamp with time zone'),
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

  -- The view emits one row per header id; that requires a valid unique index on id.
  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'plm."ProdOrderHeader"'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indnkeyatts = 1 and i.indpred is null
      and a.attname = 'id'
  ) then
    raise exception '#3869 self-check: plm."ProdOrderHeader".id has no valid unique index';
  end if;

  -- An existing same-name index must be exactly this one, never a different one.
  -- An INVALID copy of exactly this definition (left by an interrupted build) is
  -- dropped here so the create below rebuilds it; any other definition refuses.
  if to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx') is not null then
    if not exists (
      select 1 from pg_index i
      where i.indexrelid = to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx')
        and i.indrelid = 'coldlion.order_history_line'::regclass
        and not i.indisunique and i.indnkeyatts = 1
        and pg_get_indexdef(i.indexrelid, 1, true) = 'lower(btrim(prod_reference_no))'
        and regexp_replace(pg_get_expr(i.indpred, i.indrelid, true), '\s|::text|^\(+|\)+$', '', 'g') = 'btrim(prod_reference_no)<>'''''
    ) then
      raise exception '#3869 self-check: same-name index exists with a different definition: %',
        pg_get_indexdef(to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx'));
    end if;
    if not (select i.indisvalid from pg_index i
            where i.indexrelid = to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx')) then
      drop index coldlion.order_history_line_prod_reference_no_lower_idx;
    end if;
  end if;
end $$;

create index if not exists order_history_line_prod_reference_no_lower_idx
  on coldlion.order_history_line (lower(btrim(prod_reference_no)))
  where btrim(prod_reference_no) <> '';

create or replace view plm.v_prod_order_sales_order_link
with (security_invoker = true) as
with h as (
  select
    poh.id,
    poh."companyCode"     as company_code,
    poh."prodOrderNo"     as prod_order_no,
    poh."prodReferenceNo" as prod_reference_no,
    case when btrim(poh."prodOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."prodOrderNo")::bigint end              as prod_order_no_num,
    nullif(lower(btrim(poh."prodReferenceNo")), '')             as prod_reference_key,
    case when btrim(poh."salesOrderNo") ~ '^[0-9]{1,18}$'
         then btrim(poh."salesOrderNo")::bigint end             as header_sales_order_no
  from plm."ProdOrderHeader" poh
),
pairs as (
  select h.id, h.company_code, h.prod_order_no, h.prod_reference_no,
         p.sales_order_no, 'prod_history_line'::text as link_source, p.fetched_at
  from h
  join coldlion.prod_history_line p
    on p.prod_order_no = h.prod_order_no_num
   and p.company_code = h.company_code
  where p.sales_order_no is not null and p.sales_order_no <> 0
  union all
  select h.id, h.company_code, h.prod_order_no, h.prod_reference_no,
         o.sales_order_no, 'order_history_line'::text, o.fetched_at
  from h
  join coldlion.order_history_line o
    on lower(btrim(o.prod_reference_no)) = h.prod_reference_key
   and btrim(o.prod_reference_no) <> ''
   and o.company_code = h.company_code
  where o.sales_order_no is not null and o.sales_order_no <> 0
  union all
  select h.id, h.company_code, h.prod_order_no, h.prod_reference_no,
         h.header_sales_order_no, 'prod_order_header'::text, null::timestamptz
  from h
  where h.header_sales_order_no is not null and h.header_sales_order_no <> 0
),
linked as (
  select
    pr.id, pr.company_code, pr.prod_order_no, pr.prod_reference_no, pr.sales_order_no,
    array_agg(distinct pr.link_source order by pr.link_source) as link_sources,
    count(distinct pr.link_source)::int                        as source_count,
    max(pr.fetched_at)                                         as latest_fetched_at
  from pairs pr
  group by pr.id, pr.company_code, pr.prod_order_no, pr.prod_reference_no, pr.sales_order_no
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
  'Issue #3869. Production order to ColdLion customer sales order, many-to-many, across all retained ColdLion versions and stages; one row per (header id, sales order). link_sources names which source(s) assert the pair (both ColdLion feeds come from one ERP, so agreement is consistency, not independent proof); latest_fetched_at is the newest ColdLion fetch asserting it (null when only the legacy header asserts the pair). sales_order_start_date is the customer promise date (owner ruling 2026-10-02); sales_order_start_date_max differs only if ColdLion lines disagree; sales_order_cancel_date is the earliest cancel date across the lines of the newest fetch. All three dates come from the newest ColdLion fetch of the sales order; sales_order_start_date_ever_changed is true when an older retained fetch carried a start date not present in the newest fetch. Pairs are company-scoped with plain equality, so a row with no company never links (the DesignFlow sandbox has none). source_count counts the legacy PLM header as a source, so 2 may mean one ColdLion feed plus the header.';

revoke all on plm.v_prod_order_sales_order_link from public, anon, authenticated, service_role;

-- POST-CHECKS: catalog only, no data read inside the apply transaction --------
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
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('coldlion.order_history_line_prod_reference_no_lower_idx')
      and i.indrelid = 'coldlion.order_history_line'::regclass
      and i.indisvalid and i.indisready and i.indislive and i.indnkeyatts = 1
      and pg_get_indexdef(i.indexrelid, 1, true) = 'lower(btrim(prod_reference_no))'
      and regexp_replace(pg_get_expr(i.indpred, i.indrelid, true), '\s|::text|^\(+|\)+$', '', 'g') = 'btrim(prod_reference_no)<>'''''
  ) then
    raise exception '#3869 post-check: expression index missing, invalid, or wrong definition';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'plm.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3869 post-check: view column list differs from the reviewed shape';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869 post-check: view is readable by a non-owner API role';
  end if;
end $$;
