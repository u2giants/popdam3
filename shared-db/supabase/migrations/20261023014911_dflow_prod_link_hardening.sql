-- derived-from: 20261022221940
-- Issue #3869, hardening after the governed slot-2 REJECT (deepseek, 2026-10-23).
-- 20261022221940 is already applied on preview and merged to main, so its companion
-- fixes land here; production will promote both versions in one apply.
--
-- L2: the schema USAGE grant was never asserted. Asserted now (and re-granted).
-- L3: the two CREATE POLICY statements were not idempotent; guarded with a
--     pg_policies existence check (Postgres has no CREATE POLICY IF NOT EXISTS).
-- L5: exactness gaps — dflow_prod."ProdOrderHeader" is now required to be an
--     ordinary table (relkind r) and coldlion.order_history_line.created_time
--     to be exactly timestamptz.
-- L4 (operational, no code): the apply window must avoid the nightly loader's
--     locks; noted here for the promotion record, nothing to enforce in SQL.

set lock_timeout = '5s';
set statement_timeout = '2min';

grant usage on schema coldlion to designflow_prod_tracking_grants;

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

do $checks$
begin
  -- L2: the group must hold USAGE on schema coldlion.
  if not has_schema_privilege('designflow_prod_tracking_grants', 'coldlion', 'usage') then
    raise exception '#3869/20261023014911 post-check: designflow_prod_tracking_grants lacks USAGE on schema coldlion';
  end if;
  -- L5: the header relation must be an ordinary table.
  if (select relkind from pg_class where oid = 'dflow_prod."ProdOrderHeader"'::regclass) is distinct from 'r' then
    raise exception '#3869/20261023014911 post-check: dflow_prod."ProdOrderHeader" is not an ordinary table';
  end if;
  -- L5: created_time must be exactly timestamptz (the view compares it as one).
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
       where a.attrelid = 'coldlion.order_history_line'::regclass
         and a.attname = 'created_time' and not a.attisdropped) is distinct from 'timestamp with time zone' then
    raise exception '#3869/20261023014911 post-check: coldlion.order_history_line.created_time is not timestamptz';
  end if;
  -- The companion migration's objects must all be present (this file may only
  -- run after 20261022221940 on any target).
  if to_regclass('dflow_prod.v_prod_order_sales_order_link') is null then
    raise exception '#3869/20261023014911 post-check: dflow_prod.v_prod_order_sales_order_link is missing (20261022221940 not applied)';
  end if;
end
$checks$;
