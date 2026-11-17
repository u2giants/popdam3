-- derived-from: none
-- Claim popcre/shared-db#6584. App contract popcre/designflow-data-syncing#121
-- (merch-group repair rename/fold undo journal; run ids repair_YYYYMMDDHHMMSS).
--
-- Creates one permanent, empty journal table per repair schema:
--   core."merchGroupRepairJournal"        (every database; non-production repair)
--   dflow_prod."merchGroupRepairJournal"  (production shape; the DesignFlow
--     sandbox route conditions away statements on its absent dflow_prod)
-- Same columns in both. Identity primary key, action limited to
-- rename / relink / retire, index (run_id, action). No foreign key. The repair
-- run owns the rows.
--
-- Grants (read-only check 2026-11-17 12:35 PM EST): in production the runtime
-- that already writes dflow_prod."merchGroup" is designflow_prod_data_sync_grants
-- (INSERT, SELECT, UPDATE). It gets INSERT, SELECT, UPDATE here; never DELETE.
-- DesignFlow non-production has no dedicated runtime role (services connect as
-- the table owner), so core gets no extra grant.
-- Row security stays off, matching dflow_prod."merchGroup" (the runtime role
-- does not bypass it, so enabling it with no policy would block the repair);
-- anon and authenticated get nothing. Identity sequences need no grant.
-- Idempotent (if not exists). Rollback: drop both tables.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists core."merchGroupRepairJournal" (
  journal_id bigint generated always as identity primary key,
  run_id text not null,
  action text not null,
  mg_id integer,
  mg_code text,
  previous_desc text,
  parent_id integer,
  is_active boolean,
  previous_active boolean,
  item_id_pk text,
  column_name text,
  from_id integer,
  to_id integer,
  recorded_at timestamptz not null default now(),
  constraint "merchGroupRepairJournal_action_check"
    check (action in ('rename', 'relink', 'retire'))
);
create index if not exists "merchGroupRepairJournal_run_id_action_idx"
  on core."merchGroupRepairJournal" (run_id, action);
revoke all on table core."merchGroupRepairJournal" from anon, authenticated;

create table if not exists dflow_prod."merchGroupRepairJournal" (
  journal_id bigint generated always as identity primary key,
  run_id text not null,
  action text not null,
  mg_id integer,
  mg_code text,
  previous_desc text,
  parent_id integer,
  is_active boolean,
  previous_active boolean,
  item_id_pk text,
  column_name text,
  from_id integer,
  to_id integer,
  recorded_at timestamptz not null default now(),
  constraint "merchGroupRepairJournal_action_check"
    check (action in ('rename', 'relink', 'retire'))
);
create index if not exists "merchGroupRepairJournal_run_id_action_idx"
  on dflow_prod."merchGroupRepairJournal" (run_id, action);
revoke all on table dflow_prod."merchGroupRepairJournal" from anon, authenticated;

grant select, insert, update on table dflow_prod."merchGroupRepairJournal" to designflow_prod_data_sync_grants;


commit;
