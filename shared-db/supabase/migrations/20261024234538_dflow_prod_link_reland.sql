-- derived-from: none
-- Issue #3869, generation 14 (production re-land).
--
-- Re-land of the merged pair 20261022221940 + 20261023014911 as ONE idempotent
-- version. Both authoring heads (PR #4648 eaeb970f, PR #4673 b20da395e) carry
-- durable governed-review refusals that are permanent per head and cannot be
-- superseded there (check-exact-head-approval refuses both; the production-risk
-- packet also accepts only one source PR own migrations, which a two-source
-- pair can never satisfy). The designed answer to a durable refusal is a
-- successor change at a fresh head - the same route PR #4673 took for the
-- #4648 refusal - so this file re-lands the same effect, idempotent on both
-- targets.
--
-- The blocking finding of the last refusal (muse slot 3, 2026-10-23 19:31Z:
-- scripts/proofs/2873-catalog.sql then forbade the coldlion access) is answered
-- on main: the 2873 contract now records matrix_entries 470 with the narrow
-- #3869 ColdLion exception (schema USAGE plus SELECT on the two history tables
-- and the view, for designflow_prod_tracking_grants only).
--
-- Idempotency: preview already carries 20261022221940 and 20261023014911
-- applied, so every statement here is guarded (index IF NOT EXISTS, view
-- CREATE OR REPLACE, policies behind pg_policies existence checks, grants and
-- revokes naturally idempotent); on production nothing exists yet and this
-- creates it. Those two historical versions stay unapplied on production
-- forever and must never enter a production allowlist.
--
-- Access model, matching rules and rollback: see the header of
-- 20261024234538 (byte-identical view body and comments; only the policy
-- guards differ, taking the idempotent form from 20261024234538).
set lock_timeout = '5s';
set statement_timeout = '2min';

-- SELF-CHECKS -------------------------------------------------------------------
do $$
declare
  missing text;
begin
  if to_regnamespace('dflow_prod') is null then
    raise exception '#3869/20261024234538 self-check: schema dflow_prod is missing';
  end if;
  if to_regclass('dflow_prod."ProdOrderHeader"') is null then
    raise exception '#3869/20261024234538 self-check: dflow_prod."ProdOrderHeader" is missing';
  end if;
  select string_agg(want.col || ' ' || want.typ, ', ')
    into missing
  from (values
    ('id',              'integer'),
    ('prodOrderNo',     'character varying'),
    ('prodReferenceNo', 'character varying'),
    ('companyCode',     'character varying'),
    ('prodOrderDate',   'character varying'),
    ('createdTime',     'timestamp with time zone')
  ) as want(col, typ)
  where not exists (
    select 1 from pg_attribute a
      where a.attrelid = 'dflow_prod."ProdOrderHeader"'::regclass
        and a.attname = want.col and not a.attisdropped and a.attnum > 0
        and format_type(a.atttypid, a.atttypmod) = want.typ
  );
  if missing is not null then
    raise exception '#3869/20261024234538 self-check: dflow_prod."ProdOrderHeader" shape differs; missing or mistyped: %', missing;
  end if;
  if not exists (select 1 from pg_attribute a
                 where a.attrelid = 'coldlion.order_history_line'::regclass
                   and a.attname = 'created_time' and not a.attisdropped) then
    raise exception '#3869/20261024234538 self-check: coldlion.order_history_line.created_time missing (20261013111713 not applied)';
  end if;
  -- Supporting access paths, both verified live on production 2026-10-22:
  -- an index leading with order_history_line.sales_order_no, one leading with
  -- prod_history_line prod_order_no or (company_code, prod_order_no).
  if not exists (
    select 1 from pg_index i join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indrelid = 'coldlion.order_history_line'::regclass
      and i.indisvalid and i.indisready and i.indislive and i.indpred is null
      and i.indexprs is null
      and (select c.relam from pg_class c where c.oid = i.indexrelid) = (select oid from pg_am where amname = 'btree')
      and at.attname = 'sales_order_no'
  ) then
    raise exception '#3869/20261024234538 self-check: no valid index leads with coldlion.order_history_line.sales_order_no';
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
    raise exception '#3869/20261024234538 self-check: no valid index leads with coldlion.prod_history_line prod_order_no';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_grants' and not rolcanlogin) then
    raise exception '#3869/20261024234538 self-check: designflow_prod_tracking_grants missing or login-enabled';
  end if;
  if not exists (select 1 from pg_auth_members m
                 join pg_roles g on g.oid = m.roleid
                 join pg_roles b on b.oid = m.member
                 where g.rolname = 'designflow_prod_tracking_grants'
                   and b.rolname in ('designflow_prod_tracking_runtime', 'designflow_prod_backend_runtime')) then
    raise exception '#3869/20261024234538 self-check: no production runtime inherits designflow_prod_tracking_grants';
  end if;
end $$;

-- One row per header id (the view's grouping contract).
create unique index if not exists prod_order_header_id_uidx
  on dflow_prod."ProdOrderHeader" (id);

create or replace view dflow_prod.v_prod_order_sales_order_link
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
  from dflow_prod."ProdOrderHeader" poh
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
  on sd.sales_order_no = l.sales_order_no and sd.company_code = l.company_code;

comment on view dflow_prod.v_prod_order_sales_order_link is
  'Issue #3869 (generation 12, production twin of the sandbox generation 11 view). Production order to ColdLion customer sales order, many-to-many, matched on the CUSTOMER PURCHASE ORDER NUMBER, never on a sales-order number (owner rule, Albert Hazan, 2026-10-09). Primary: coldlion.prod_history_line.cust_po_number = coldlion.order_history_line.po_number (trimmed, upper-cased, leading zeros stripped), same company and customer (MOD011 read as MOD010, Burlington). Fallback, only for a PO with no customer-PO pair: the PO''s ColdLion D-number (prod_history_line.prod_reference_no) on same-customer sales-order lines entered in ColdLion (order_history_line.created_time) from 60 days before to 300 days after the PO was created (dflow_prod.ProdOrderHeader.createdTime, else prodOrderDate end of day). link_sources: customer_po / prod_reference_no. sales_order_no is the identity of the matched sales order. sales_order_start_date is the customer promise date (owner ruling 2026-10-02) from the newest ColdLion fetch.';

revoke all on dflow_prod.v_prod_order_sales_order_link from public, anon, authenticated, service_role;

-- Runtime access ----------------------------------------------------------------
grant usage on schema coldlion to designflow_prod_tracking_grants;
grant select on table coldlion.order_history_line, coldlion.prod_history_line to designflow_prod_tracking_grants;
grant select on table dflow_prod.v_prod_order_sales_order_link to designflow_prod_tracking_grants;

-- Policy guards (idempotent form from 20261024234538; Postgres has no CREATE POLICY IF NOT EXISTS).
do $p1$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'order_history_line'
                   and policyname = 'coldlion_history_tracking_read') then
    create policy coldlion_history_tracking_read on coldlion.order_history_line
      for select to designflow_prod_tracking_grants using (true);
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'prod_history_line'
                   and policyname = 'coldlion_history_tracking_read') then
    create policy coldlion_history_tracking_read on coldlion.prod_history_line
      for select to designflow_prod_tracking_grants using (true);
  end if;
end
$p1$;

-- POST-CHECKS ---------------------------------------------------------------------
do $$
declare
  v_acl_view  text;
  v_acl_ohl   text;
  v_acl_phl   text;
begin
  if not exists (
    select 1 from pg_class c
    where c.oid = to_regclass('dflow_prod.v_prod_order_sales_order_link')
      and c.relkind = 'v'
      and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then
    raise exception '#3869/20261024234538 post-check: view missing or not security_invoker';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'dflow_prod.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean' then
    raise exception '#3869/20261024234538 post-check: view column list differs from the reviewed shape';
  end if;
  -- Group ACL is SELECT only, everywhere it was just granted.
  select string_agg(privilege_type, ',' order by privilege_type)
    into v_acl_ohl
  from aclexplode((select relacl from pg_class where oid = 'coldlion.order_history_line'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  select string_agg(privilege_type, ',' order by privilege_type)
    into v_acl_phl
  from aclexplode((select relacl from pg_class where oid = 'coldlion.prod_history_line'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  select string_agg(privilege_type, ',' order by privilege_type)
    into v_acl_view
  from aclexplode((select relacl from pg_class where oid = 'dflow_prod.v_prod_order_sales_order_link'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  if v_acl_ohl is distinct from 'SELECT' or v_acl_phl is distinct from 'SELECT' or v_acl_view is distinct from 'SELECT' then
    raise exception '#3869/20261024234538 post-check: tracking grants ACL differs (ohl=%, phl=%, view=%)', v_acl_ohl, v_acl_phl, v_acl_view;
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'order_history_line'
                   and policyname = 'coldlion_history_tracking_read'
                   and cmd = 'SELECT' and roles = array['designflow_prod_tracking_grants']::name[])
     or not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'prod_history_line'
                   and policyname = 'coldlion_history_tracking_read'
                   and cmd = 'SELECT' and roles = array['designflow_prod_tracking_grants']::name[]) then
    raise exception '#3869/20261024234538 post-check: a coldlion_history_tracking_read SELECT policy is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'coldlion.order_history_line'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'coldlion.prod_history_line'::regclass) then
    raise exception '#3869/20261024234538 post-check: RLS is not enabled on both coldlion history tables (policies would be inert)';
  end if;
  if has_table_privilege('anon', 'dflow_prod.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'dflow_prod.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'dflow_prod.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869/20261024234538 post-check: view is readable by a non-owner API role';
  end if;
  if not has_table_privilege('designflow_prod_tracking_runtime', 'dflow_prod.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869/20261024234538 post-check: the tracking runtime cannot select the view';
  end if;
  -- popcre-tracking-prod still connects as designflow_prod_backend_runtime (live
  -- production grants it the group; the from-empty replay database does not), so
  -- assert the service login wherever its membership exists (review M1).
  if pg_has_role('designflow_prod_backend_runtime', 'designflow_prod_tracking_grants', 'member')
     and not has_table_privilege('designflow_prod_backend_runtime', 'dflow_prod.v_prod_order_sales_order_link', 'select') then
    raise exception '#3869/20261024234538 post-check: backend runtime is in the grants group but cannot select the view';
  end if;
  if not exists (select 1 from pg_index i
                 join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
                 where i.indrelid = 'dflow_prod."ProdOrderHeader"'::regclass
                   and i.indisunique and i.indisvalid and i.indpred is null and i.indnkeyatts = 1
                   and i.indexrelid = 'dflow_prod.prod_order_header_id_uidx'::regclass
                   and at.attname = 'id') then
    raise exception '#3869/20261024234538 post-check: unique index prod_order_header_id_uidx missing, invalid, or not on id';
  end if;
end $$;

-- Runtime row visibility (grants AND RLS through the security_invoker view) is
-- proven post-apply on production, where the data lives; a data-independent
-- rehearsal database cannot distinguish an RLS denial from an empty table.
-- Additional hardening assertions from 20261024234538 (schema USAGE, relkind, timestamptz).
do $checks$
begin
  -- L2: the group must hold USAGE on schema coldlion.
  if not has_schema_privilege('designflow_prod_tracking_grants', 'coldlion', 'usage') then
    raise exception '#3869/20261024234538 post-check: designflow_prod_tracking_grants lacks USAGE on schema coldlion';
  end if;
  -- L5: the header relation must be an ordinary table.
  if (select relkind from pg_class where oid = 'dflow_prod."ProdOrderHeader"'::regclass) is distinct from 'r' then
    raise exception '#3869/20261024234538 post-check: dflow_prod."ProdOrderHeader" is not an ordinary table';
  end if;
  -- L5: created_time must be exactly timestamptz (the view compares it as one).
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
       where a.attrelid = 'coldlion.order_history_line'::regclass
         and a.attname = 'created_time' and not a.attisdropped) is distinct from 'timestamp with time zone' then
    raise exception '#3869/20261024234538 post-check: coldlion.order_history_line.created_time is not timestamptz';
  end if;
  -- The companion migration's objects must all be present (this file may only
  -- run after 20261024234538 on any target).
  if to_regclass('dflow_prod.v_prod_order_sales_order_link') is null then
    raise exception '#3869/20261024234538 post-check: dflow_prod.v_prod_order_sales_order_link is missing (20261024234538 not applied)';
  end if;
end
$checks$;
