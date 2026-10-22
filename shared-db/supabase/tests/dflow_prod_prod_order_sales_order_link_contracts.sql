-- Contract tests for 20261022221940_dflow_prod_prod_order_sales_order_link.sql
-- (issue #3869, claim #4647). Self-contained begin/rollback.
--
-- A. Shape: view exists, security_invoker, reviewed column list.
-- B. ACL: designflow_prod_tracking_grants holds exactly SELECT on the view and on
--    both coldlion history tables; anon, authenticated and service_role hold
--    nothing on the view; the tracking runtime reaches the view, and the backend
--    runtime does wherever it holds the grants group (live production; the
--    from-empty replay database never grants it that membership).
-- C. RLS: one SELECT policy named coldlion_history_tracking_read on each coldlion
--    history table, scoped to designflow_prod_tracking_grants.
-- D. Index: unique valid prod_order_header_id_uidx on dflow_prod."ProdOrderHeader"(id).

begin;

do $a$
begin
  if not exists (
    select 1 from pg_class c
    where c.oid = to_regclass('dflow_prod.v_prod_order_sales_order_link')
      and c.relkind = 'v'
      and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then raise exception 'A1 view missing or not security_invoker'; end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
        from pg_attribute a
       where a.attrelid = 'dflow_prod.v_prod_order_sales_order_link'::regclass
         and a.attnum > 0 and not a.attisdropped)
     is distinct from 'prod_order_header_id:integer,company_code:character varying,prod_order_no:character varying,prod_reference_no:character varying,sales_order_no:bigint,link_sources:text[],source_count:integer,latest_fetched_at:timestamp with time zone,sales_order_start_date:date,sales_order_start_date_max:date,sales_order_cancel_date:date,sales_order_start_date_ever_changed:boolean'
  then raise exception 'A2 view column list differs'; end if;
end
$a$;

do $b$
declare v_acl text;
begin
  select string_agg(privilege_type, ',' order by privilege_type) into v_acl
  from aclexplode((select relacl from pg_class where oid = 'dflow_prod.v_prod_order_sales_order_link'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  if v_acl is distinct from 'SELECT' then raise exception 'B1 view ACL for grants group is %', v_acl; end if;

  select string_agg(privilege_type, ',' order by privilege_type) into v_acl
  from aclexplode((select relacl from pg_class where oid = 'coldlion.order_history_line'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  if v_acl is distinct from 'SELECT' then raise exception 'B2 order_history_line ACL for grants group is %', v_acl; end if;

  select string_agg(privilege_type, ',' order by privilege_type) into v_acl
  from aclexplode((select relacl from pg_class where oid = 'coldlion.prod_history_line'::regclass))
  where grantee = 'designflow_prod_tracking_grants'::regrole;
  if v_acl is distinct from 'SELECT' then raise exception 'B3 prod_history_line ACL for grants group is %', v_acl; end if;

  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
             join pg_roles r on r.oid = a.grantee
             where c.oid = 'dflow_prod.v_prod_order_sales_order_link'::regclass
               and r.rolname in ('anon', 'authenticated', 'service_role'))
  then raise exception 'B4 a client role holds a privilege on the view'; end if;

  if not has_table_privilege('designflow_prod_tracking_runtime', 'dflow_prod.v_prod_order_sales_order_link', 'select')
  then raise exception 'B5 the tracking runtime cannot select the view'; end if;
  if pg_has_role('designflow_prod_backend_runtime', 'designflow_prod_tracking_grants', 'member')
     and not has_table_privilege('designflow_prod_backend_runtime', 'dflow_prod.v_prod_order_sales_order_link', 'select')
  then raise exception 'B5b backend runtime is in the grants group but cannot select the view'; end if;
end
$b$;

do $c$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'order_history_line'
                   and policyname = 'coldlion_history_tracking_read'
                   and cmd = 'SELECT' and roles = array['designflow_prod_tracking_grants']::name[])
  then raise exception 'C1 order_history_line policy missing'; end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'coldlion' and tablename = 'prod_history_line'
                   and policyname = 'coldlion_history_tracking_read'
                   and cmd = 'SELECT' and roles = array['designflow_prod_tracking_grants']::name[])
  then raise exception 'C2 prod_history_line policy missing'; end if;
end
$c$;

do $d$
begin
  if not exists (
    select 1 from pg_index i
    join pg_attribute at on at.attrelid = i.indrelid and at.attnum = i.indkey[0]
    where i.indexrelid = 'dflow_prod.prod_order_header_id_uidx'::regclass
      and i.indrelid = 'dflow_prod."ProdOrderHeader"'::regclass
      and i.indisunique and i.indisvalid and i.indpred is null and i.indnkeyatts = 1
      and at.attname = 'id')
  then raise exception 'D1 unique id index missing or wrong shape'; end if;
end
$d$;

rollback;
