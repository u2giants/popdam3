-- popcre/designflow-tracking#138. Read-only role for query-plan inspection of
-- the Tracking production grid (page query and sales-order anchors).
-- derived-from: none
--
-- Owner request (Albert Hazan, 2026-11-24): "create the read-only login
-- yourself".
--
-- WHAT THIS CREATES: role tracking_query_reader — NOLOGIN here, SELECT only on
-- the exact relations the Tracking grid reads. No users/auth tables, no
-- functions, no writes. Login and password are enabled afterwards outside git;
-- the password lives only in 1Password vibe_coding (same pattern as
-- oracle_directory_reader, #5776).
--
-- Grants are guarded per relation: tables absent on a target (dflow_prod in
-- the from-empty replay) are skipped, never created.
--
-- statement_timeout 30s, idle_in_transaction_session_timeout 60s,
-- default_transaction_read_only on, connection limit 2.
--
-- PLAIN CREATE ROLE (no if-not-exists) on purpose: a pre-existing role with
-- unknown attributes must fail the apply rather than be adopted.
-- ROLLBACK (forward fix): drop owned by tracking_query_reader; drop role tracking_query_reader;

begin;
set lock_timeout = '5s';
set statement_timeout = '5min';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tracking_query_reader') then
    raise exception 'ABORT tracking#138: role tracking_query_reader already exists; refusing to adopt it';
  end if;
end $$;

create role tracking_query_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication connection limit 2;
comment on role tracking_query_reader is
  'designflow-tracking#138. Read-only query-plan login for the Tracking grid. SELECT on listed grid relations only.';
alter role tracking_query_reader set statement_timeout = '30s';
alter role tracking_query_reader set idle_in_transaction_session_timeout = '60s';
alter role tracking_query_reader set default_transaction_read_only = on;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'dflow_prod') then
    grant usage on schema dflow_prod to tracking_query_reader;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'plm') then
    grant usage on schema plm to tracking_query_reader;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'coldlion') then
    grant usage on schema coldlion to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."ProdOrderHeader"') is not null then
    grant select on dflow_prod."ProdOrderHeader" to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."ProdOrderDetail"') is not null then
    grant select on dflow_prod."ProdOrderDetail" to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."itemHeader"') is not null then
    grant select on dflow_prod."itemHeader" to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod.item_prod_order_detail_associations') is not null then
    grant select on dflow_prod.item_prod_order_detail_associations to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."licensingStatus"') is not null then
    grant select on dflow_prod."licensingStatus" to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."merchGroup"') is not null then
    grant select on dflow_prod."merchGroup" to tracking_query_reader;
  end if;
  if to_regclass('dflow_prod."externalVendor"') is not null then
    grant select on dflow_prod."externalVendor" to tracking_query_reader;
  end if;
  if to_regclass('plm.v_prod_order_sales_order_link') is not null then
    grant select on plm.v_prod_order_sales_order_link to tracking_query_reader;
  end if;
  if to_regclass('plm.prod_stage_progress') is not null then
    grant select on plm.prod_stage_progress to tracking_query_reader;
  end if;
  if to_regclass('plm.prod_stage_option') is not null then
    grant select on plm.prod_stage_option to tracking_query_reader;
  end if;
  if to_regclass('plm.stage') is not null then
    grant select on plm.stage to tracking_query_reader;
  end if;
  if to_regclass('plm.stage_duration') is not null then
    grant select on plm.stage_duration to tracking_query_reader;
  end if;
  if to_regclass('coldlion.order_history_line') is not null then
    grant select on coldlion.order_history_line to tracking_query_reader;
  end if;
end $$;

commit;
