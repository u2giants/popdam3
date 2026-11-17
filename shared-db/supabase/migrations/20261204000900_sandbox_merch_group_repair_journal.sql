-- #6584 sandbox half: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- derived-from: none
-- Creates core."merchGroupRepairJournal" exactly as 20261204000800 does. That
-- migration also creates the dflow_prod copy, which this sandbox (no dflow_prod
-- schema) cannot run. No grant: sandbox services connect as the owner
-- (read-only check 2026-11-17 12:35 PM EST). Idempotent. Rollback: drop table.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $check$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#6584/20261204000900 self-check: schema dflow_prod exists here; DesignFlow sandbox only'
      using errcode = 'feature_not_supported';
  end if;
end
$check$;

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

commit;
