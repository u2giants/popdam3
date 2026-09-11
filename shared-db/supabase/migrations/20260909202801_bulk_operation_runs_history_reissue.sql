-- public.bulk_operation_runs -- append-only run history for PopDAM bulk operations.
-- Issue #2439 ("the nightly style-group rebuild failed and cron reported success").
-- Claim issue #2443, reserved version 20260908195056.
-- derived-from: none
--
-- WHY THIS EXISTS
-- ---------------
-- Bulk-operation state is not a table today. It is ONE JSONB object per operation
-- inside public.admin_config under key 'BULK_OPERATIONS', and every writer replaces
-- the whole object (see 20260819011639 and 20260820142402). That store answers
-- "what is the state NOW" and can never answer "when did this last succeed", because
-- each run erases the previous one.
--
-- On 2026-09-06 the nightly style-group rebuild died 8.2 seconds in having processed
-- zero assets, while cron job 7 reported `succeeded` for that same run and for the
-- previous ten nights. Both records were truthful: job 7's body is
-- `select public.queue_nightly_rebuild_style_groups();`, so cron measures the ENQUEUE,
-- not the rebuild an external worker performs afterwards. The only surface that could
-- have contradicted the green tick -- the operation's own outcome -- had already been
-- overwritten. "How long has this been failing?" was, and is, unanswerable from what
-- we store.
--
-- This table is that missing record: one immutable row per terminal outcome, so a
-- run's failure survives the next run and an alert can be written against the WORKER's
-- outcome instead of the scheduler's.
--
-- WHAT THIS IS NOT
-- ----------------
-- ADDITIVE ONLY. It creates one table with its own indexes, policies and grants and
-- nothing else. It does NOT alter public.admin_config (whose shape is unchanged and
-- which remains the live-state store), does not touch public.update_bulk_operation,
-- public.update_bulk_operations_batch, public.queue_nightly_rebuild_style_groups,
-- app.rebuild_style_groups_batch, or any cron entry, and it seeds no rows. Nothing
-- writes this table yet: the PopDAM worker gains an insert at the end of each run in
-- its own repository. Until then the table is empty, and an empty run history must be
-- read as "not instrumented yet", never as "no failures".
--
-- APPEND-ONLY IS ENFORCED BY PRIVILEGE, NOT BY TRIGGER
-- ----------------------------------------------------
-- No role -- not even service_role -- is granted UPDATE or DELETE here. A history that
-- an ordinary writer can edit is not history. The grants below are deliberately
-- INSERT + SELECT only; the table owner (postgres) can still correct the table by an
-- explicit, reviewed migration, which is the intended escape hatch. A trigger-based
-- guard was considered and rejected: it would add a function object outside the
-- objects this change claims, and it can be dropped by the same caller it constrains.
--
-- IDENTITY AND IDEMPOTENCE
-- ------------------------
-- (operation, run_id) is unique. The worker already carries a run_id per run, and a
-- retrying appender must not be able to double-record one run. run_id is text so a
-- uuid, an ISO timestamp or a provider job id all land without a lossy cast.

create table if not exists public.bulk_operation_runs (
  id            uuid primary key default gen_random_uuid(),

  -- The admin_config BULK_OPERATIONS key this run belongs to, e.g.
  -- 'rebuild-style-groups'. Free text on purpose: operations are added by the
  -- application, and an enum here would make the history refuse a new operation.
  operation     text not null,

  -- The worker's own identifier for the run.
  run_id        text not null,

  -- Terminal outcome only. This table records how a run ENDED; live progress stays in
  -- admin_config. The set matches the vocabulary the bulk-operation writers already
  -- use for finished work.
  status        text not null,

  -- The stage the run was in when it ended -- 'clear_assets' in the #2439 failure.
  stage         text,

  -- The operator-facing failure text, exactly as the worker saw it, plus the machine
  -- code where one exists ('unknown' in the #2439 failure). Both nullable: a
  -- successful run carries neither.
  error         text,
  reason_code   text,

  -- The run's own progress counters as reported at the end (total_processed,
  -- assigned, groups, cleared, ...). Kept as jsonb because the counter set differs
  -- per operation and will change without a migration.
  progress      jsonb not null default '{}'::jsonb,

  started_at    timestamptz not null,
  ended_at      timestamptz,

  -- When the row was appended, which is not the same as when the run ended: a worker
  -- that crashes and is reconciled later records a true ended_at and a later
  -- recorded_at. Never overwritten.
  recorded_at   timestamptz not null default now(),

  constraint bulk_operation_runs_operation_not_blank
    check (length(btrim(operation)) > 0),

  constraint bulk_operation_runs_run_id_not_blank
    check (length(btrim(run_id)) > 0),

  -- 'interrupted' is a terminal outcome here even though the live store also uses it
  -- as a resumable state: from the history's point of view the run stopped.
  constraint bulk_operation_runs_status_check
    check (status in ('succeeded', 'failed', 'interrupted', 'cancelled', 'stopped')),

  constraint bulk_operation_runs_stage_not_blank
    check (stage is null or length(btrim(stage)) > 0),

  constraint bulk_operation_runs_reason_code_not_blank
    check (reason_code is null or length(btrim(reason_code)) > 0),

  constraint bulk_operation_runs_progress_is_object
    check (jsonb_typeof(progress) = 'object'),

  -- A run cannot end before it started. ended_at stays nullable so a run reconciled
  -- from a crashed worker, whose end time is genuinely unknown, can still be
  -- recorded rather than being given a fabricated timestamp.
  constraint bulk_operation_runs_ended_after_started
    check (ended_at is null or ended_at >= started_at),

  -- A failure that cannot say why is the second half of the #2439 defect. A
  -- non-succeeded run must carry either a message or a machine code; recording a
  -- silent failure into the history would reproduce the exact blindness this table
  -- exists to end.
  constraint bulk_operation_runs_failure_is_explained
    check (
      status = 'succeeded'
      or coalesce(length(btrim(error)), 0) > 0
      or reason_code is not null
    )
);

-- One row per run. The append is idempotent under retry, and two workers racing to
-- record the same run cannot both win.
create unique index if not exists bulk_operation_runs_operation_run_key
  on public.bulk_operation_runs (operation, run_id);

-- "What happened on the last N runs of this operation" -- the query every alert and
-- every admin screen asks.
create index if not exists bulk_operation_runs_operation_started_idx
  on public.bulk_operation_runs (operation, started_at desc);

-- "Has this operation failed since <time>, and for how long" -- kept partial so the
-- index stays small once successful nightly runs dominate the table.
create index if not exists bulk_operation_runs_failures_idx
  on public.bulk_operation_runs (operation, started_at desc)
  where status <> 'succeeded';

alter table public.bulk_operation_runs enable row level security;

-- Read is administrator-only. The rows carry raw worker error text and internal stage
-- names; the live state they summarise lives in public.admin_config, which grants
-- `authenticated` no select at all. Widening this to every signed-in role would make
-- the history strictly more exposed than the state it records.
drop policy if exists "Administrator read bulk_operation_runs"
  on public.bulk_operation_runs;
create policy "Administrator read bulk_operation_runs"
  on public.bulk_operation_runs
  for select to authenticated
  using (app.has_any_role(array['administrator']::app.app_role[]));

-- Append-only by privilege: insert and select, never update or delete, and never for
-- a browser role beyond the RLS-gated select above.
-- Clear inherited default grants, including service_role UPDATE/DELETE/TRUNCATE.
revoke all on public.bulk_operation_runs from public, anon, authenticated, service_role;
grant select on public.bulk_operation_runs to authenticated;
grant select, insert on public.bulk_operation_runs to service_role;

comment on table public.bulk_operation_runs is
  'Append-only history of terminal PopDAM bulk-operation outcomes (issue #2439). '
  'public.admin_config -> BULK_OPERATIONS holds ONE state object per operation and '
  'overwrites it on every run, so a failure is erased by the next attempt and "how long '
  'has this been failing" is unanswerable. This table keeps one immutable row per run so '
  'alerting can read the WORKER''s outcome; cron.job_run_details cannot, because job 7 '
  'only enqueues the rebuild and reports success for the enqueue. No role is granted '
  'update or delete: history is corrected by a reviewed migration or not at all. Empty '
  'means "not instrumented yet", never "no failures".';
comment on column public.bulk_operation_runs.operation is
  'The admin_config BULK_OPERATIONS key, e.g. rebuild-style-groups. Free text: operations '
  'are added by the application and an enum here would refuse a new one.';
comment on column public.bulk_operation_runs.run_id is
  'The worker''s identifier for the run. Unique per operation, so a retried append cannot '
  'double-record one run. Text so uuid, timestamp and provider job ids all land unchanged.';
comment on column public.bulk_operation_runs.status is
  'Terminal outcome: succeeded | failed | interrupted | cancelled | stopped. Live progress '
  'stays in admin_config; this column says how the run ENDED.';
comment on column public.bulk_operation_runs.stage is
  'The stage in progress when the run ended (clear_assets, assign, count, ...).';
comment on column public.bulk_operation_runs.error is
  'The failure text exactly as the worker saw it. A non-succeeded run must carry this or a '
  'reason_code -- see bulk_operation_runs_failure_is_explained.';
comment on column public.bulk_operation_runs.ended_at is
  'When the run stopped. Null only when a run is reconciled after a crash and its true end '
  'time is unknown; a fabricated timestamp would be worse than an honest null.';
comment on column public.bulk_operation_runs.recorded_at is
  'When this row was appended, which may be later than ended_at for a reconciled run.';
