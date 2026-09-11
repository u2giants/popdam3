-- public.bulk_operation_runs -- reconcile the terminal-status vocabulary with the
-- vocabulary production actually emits.
-- Issue #2670 (blocks #2439 and the forwarded appender u2giants/popdam3#123).
-- Claim issue #2671, reserved version 20260910123601.
-- derived-from: 20260909202801
--
-- THE DEFECT
-- ----------
-- 20260909202801 constrained status to
--   ('succeeded','failed','interrupted','cancelled','stopped').
-- That set was written from the words the bulk-operation code *reads*, not from the
-- words the running system *writes*. The success token is wrong: production never
-- writes 'succeeded' anywhere. An appender that copies the live admin_config status
-- through -- the obvious and correct implementation -- is rejected on its first
-- successful run.
--
-- THE EVIDENCE (read-only, production project qsllyeztdwjgirsysgai, 2026-09-10)
-- ---------------------------------------------------------------------------
-- Project ref proved with the Supabase MCP get_project_url before the read:
--   https://qsllyeztdwjgirsysgai.supabase.co
--
-- Query actually run (every operation key, not just the nightly rebuild):
--
--   select op.key as operation_key,
--          op.value->>'status' as status,
--          op.value->>'run_id'  as run_id,
--          left(coalesce(op.value->>'result_message', op.value->>'message'),120) as msg
--     from public.admin_config c,
--          lateral jsonb_each(c.value) as op(key, value)
--    where c.key = 'BULK_OPERATIONS'
--      and jsonb_typeof(op.value) = 'object'
--    order by 1;
--
-- 24 operation keys came back. The complete status vocabulary observed was exactly
-- three words -- and 'succeeded' was not one of them:
--
--   completed    11 keys  ai-tag-bakeoff, ai-tag-single-9bc0a30d-..., ai-tag-single-a4d9cc8c-...,
--                         ai-tag-untagged, erp-classify, erp-enrichment, propagate-group-tags,
--                         rebuild-style-groups, reconcile-style-group-stats, rich-pdf-extract,
--                         tag-popsg-files
--   interrupted   6 keys  ai-tag-all, ai-tag-groups, ai-tag-single-000370e0-...,
--                         ai-tag-single-34f71eee-..., embed-dam-search, reprocess-metadata
--   idle          7 keys  ai-tag-single-{430471d1,46ac858a,64a94955,7d30c057,7faafddb,
--                         e2870df4,e9d8aa1c}-...  -- every one of them with run_id = null
--
-- The #2670 row verbatim:
--   rebuild-style-groups | completed | 3a5cdfaa-ee88-4728-8641-05d4e22e9d37
--                        | "Created 35974 style groups, assigned 98035 assets"
--
-- Second reading, of the writers rather than the state: neither
-- public.update_bulk_operation nor public.update_bulk_operations_batch validates the
-- status word at all -- it is free text chosen by the PopDAM application. The only
-- vocabulary either function knows is its stop family,
--   c_stop_status = array['stop','stopping','stopped','stop_requested'],
-- which it uses to refuse a write that would resume a stopped operation. 'stopped' is
-- the only terminal member of that family; the other three are in-flight states.
--
-- THE DECISION, AND WHY IT IS A WIDEN AND NOT A MAPPING
-- ----------------------------------------------------
-- Widen. A mapping layer would put the appender in charge of translating a word the
-- database cannot see, in a repository the database cannot check, for a vocabulary
-- that is free text and will gain a word the first time PopDAM adds an operation.
-- That is a second place to be wrong about #2439's whole subject: what actually
-- happened. The history records what the worker reported.
--
-- But a bare widen has a trap, and this migration closes it in the same breath.
-- 20260909202801's failures index and its "explain yourself" constraint both spell
-- success as the literal 'succeeded':
--     ... where status <> 'succeeded'
-- Add 'completed' to the allowed set and leave that alone, and every successful
-- nightly run is silently counted as a failure by the exact index alerting is meant
-- to read, while every successful append is refused for not explaining a failure it
-- did not have. So success stops being a spelling:
--
--   * a generated column `succeeded` classifies the vocabulary once, in the database;
--   * the failures index and the explanation constraint are rebuilt on that column;
--   * no caller, query, alert or dashboard ever compares status to a literal again.
--
-- 'idle' is deliberately NOT admitted. It is a live-state word, it carries no run_id
-- in any of the seven rows above, and a run history that accepts it records a run
-- that never happened. Same for 'stop', 'stopping' and 'stop_requested': in-flight,
-- not outcomes. 'succeeded', 'failed' and 'cancelled' stay allowed even though
-- production emits none of them today -- they are the vocabulary #2439's own reissue
-- published, removing them would make this migration a narrowing as well as a
-- widening, and a run that genuinely reports one of them is not a defect.
--
-- 'completed' MEANS "REACHED ITS END", SO IT IS NOT BY ITSELF A SUCCESS
-- --------------------------------------------------------------------
-- PopDAM writes 'completed' for a run with partial failures ("Tagged 588. 1 skipped.
-- 28 failed."). Classifying that word as a success on its own would drop every
-- partial-failure run out of the failures index -- the only alerting surface this
-- table has -- which is the mirror image of the blindness #2439 exists to end. And
-- the detail that would qualify it cannot be recovered later: result_message is NOT
-- a column of this table, it is a field of the admin_config BULK_OPERATIONS object,
-- and 20260909202801 records that every writer replaces that whole object, so each
-- run erases the previous one.
--
-- So the history retains what qualifies the outcome, in a column it owns:
--
--   progress->'failed'  -- a JSON NUMBER, the count of items this run failed on.
--
-- A run spelled 'completed' is a success ONLY when it declares that counter and the
-- counter is zero. Consequences, all enforced by the database and not by convention:
--
--   * 'completed' with failed > 0  -> succeeded = false -> IN the failures index.
--     The partial-failure nightly rebuild alerts, which is the whole point.
--   * 'completed' with no counter, or a non-numeric one -> succeeded = false -> IN
--     the failures index. An appender that does not report its outcome detail is
--     LOUD, not silently green. It is never refused, because a refused append is a
--     lost run (see THE APPENDER CONTRACT below).
--   * 'succeeded' stays an unconditional success: that word is a claim about the
--     outcome, not merely about reaching the end.
--
-- THE APPENDER CONTRACT (u2giants/popdam3#123)
-- --------------------------------------------
-- 1. ALWAYS APPEND. Every terminal run gets a row. Nothing about this table's shape
--    may make a worker skip the append, because admin_config is overwritten by the
--    next run and a skipped append means the run existed nowhere.
-- 2. CARRY THE COUNTERS. Put the per-item counts the live store reports into
--    progress -- at minimum {"failed": <n>}, and "skipped"/"processed" alongside it
--    when known. Omitting "failed" is not refused; it just means the run cannot
--    claim success and will be listed for a human.
-- 3. AN OUTCOME WORD THAT NAMES ITS OWN CAUSE NEEDS NO error. 'interrupted',
--    'stopped' and 'cancelled' each say what happened -- an interrupted run was
--    interrupted -- and 6 of the 24 live keys are 'interrupted', a quarter of the
--    observed vocabulary, whose live state may carry no message at all. Demanding an
--    error there would abort the worker's append transaction with a 23514 and leave
--    NO history row: exactly the #2439 blindness, re-created by the guard meant to
--    end it. So those three words explain themselves; supply error or reason_code
--    when you have one. 'failed' is the one word that names no cause, so 'failed'
--    must still carry an error or a reason_code.
--
-- HOW A REJECTED STATUS IS NOW VISIBLE INSTEAD OF SILENT
-- -----------------------------------------------------
-- Three ways, because "the nightly job failed and nothing said so" is the entire
-- reason #2439 exists:
--
-- 1. The raw word is KEPT. New column `source_status` stores the admin_config status
--    exactly as the worker read it, beside the classified `status`. If a future
--    operation invents a word and the appender normalises it, the original is still
--    on the row -- the history can never quietly relabel a run.
-- 2. The refusal names itself. A status outside the vocabulary raises SQLSTATE 23514
--    on `bulk_operation_runs_status_is_terminal_outcome`, whose name says what was
--    wrong; the column comment lists the accepted words verbatim.
-- 3. The refusal lands where somebody is watching. The append is the worker's own
--    last statement, inside the worker's own transaction: a 23514 there aborts and is
--    reported as that run's failure, rather than being absorbed by a scheduler that
--    only measures the enqueue (cron job 7 -- see 20260909202801).
--
-- ADDITIVE AND FIX-FORWARD. 20260909202801 is not edited. This migration alters only
-- public.bulk_operation_runs -- its constraints, one index it owns, one new column,
-- one new generated column, and the catalog descriptions of five of its columns
-- (status, source_status, succeeded, error and progress: the last two are pre-existing
-- columns whose descriptions this migration rewrites, and it changes nothing else
-- about them). It touches no function, no policy, no grant, no cron entry and no other
-- table, and it read public.admin_config only for the analysis above.

alter table public.bulk_operation_runs
  drop constraint if exists bulk_operation_runs_status_check;

alter table public.bulk_operation_runs
  drop constraint if exists bulk_operation_runs_status_is_terminal_outcome;
alter table public.bulk_operation_runs
  add constraint bulk_operation_runs_status_is_terminal_outcome
  check (status in (
    -- emitted by production today
    'completed',
    'interrupted',
    -- the only terminal member of the writers' stop family
    'stopped',
    -- published by 20260909202801; retained so this is purely a widening
    'succeeded',
    'failed',
    'cancelled'
  ));

-- The raw live word, kept so normalisation can never lose the original.
alter table public.bulk_operation_runs
  add column if not exists source_status text;

alter table public.bulk_operation_runs
  drop constraint if exists bulk_operation_runs_source_status_not_blank;
alter table public.bulk_operation_runs
  add constraint bulk_operation_runs_source_status_not_blank
  check (source_status is null or length(btrim(source_status)) > 0);

-- Success is a classification, not a spelling, and for 'completed' it is a
-- classification of the RUN, not of the word. See the 'completed' section above:
-- 'succeeded' is an unconditional success; 'completed' is a success only when the
-- run declares progress->'failed' as the JSON number 0. Anything else -- a nonzero
-- count, a missing key, a non-numeric key -- is not a success and therefore stays in
-- the failures index. The expression is total: status is not null, and the coalesce
-- makes the completed branch false rather than null when progress says nothing, so
-- the column is `not null` and `where not succeeded` has no null hole.
alter table public.bulk_operation_runs
  add column if not exists succeeded boolean
  generated always as (
    status = 'succeeded'
    or coalesce(status = 'completed' and progress -> 'failed' = '0'::jsonb, false)
  ) stored not null;

-- "A failure must say why", corrected twice over. It now reads the succeeded column
-- itself, so the success rule exists in exactly ONE place in this file and cannot
-- drift from the index predicate. (A stored generated column is computed before row
-- constraints are evaluated and a CHECK may reference it; the real PostgreSQL
-- restriction runs the other way -- a generation expression may not read another
-- generated column.) And the demand is made only of the word that names no cause:
-- see rule 3 of THE APPENDER CONTRACT -- refusing an append destroys the run record
-- entirely, so the self-describing outcome words are accepted as their own
-- explanation, and a 'completed' run that is not a success is already explained by
-- its own counters.
alter table public.bulk_operation_runs
  drop constraint if exists bulk_operation_runs_failure_is_explained;
alter table public.bulk_operation_runs
  add constraint bulk_operation_runs_failure_is_explained
  check (
    succeeded
    or status in ('completed', 'interrupted', 'stopped', 'cancelled')
    or coalesce(length(btrim(error)), 0) > 0
    or reason_code is not null
  );

-- Rebuilt on the classification. The old index spelled success as 'succeeded' and
-- would have counted every real successful run as a failure. Because `succeeded` is
-- now outcome-aware, this same predicate also keeps a 'completed' run WITH failures
-- in the index -- no separate rule, no second place to be wrong.
drop index if exists public.bulk_operation_runs_failures_idx;
create index if not exists bulk_operation_runs_failures_idx
  on public.bulk_operation_runs (operation, started_at desc)
  where not succeeded;

comment on column public.bulk_operation_runs.status is
  'Terminal outcome as the worker reported it: completed | interrupted | stopped | '
  'succeeded | failed | cancelled. Production emits completed and interrupted today '
  '(read 2026-09-10, project qsllyeztdwjgirsysgai, all 24 BULK_OPERATIONS keys); it '
  'emits succeeded nowhere, which is why issue #2670 existed. Live-state words are '
  'refused on purpose -- idle, stop, stopping and stop_requested are not outcomes, and '
  'idle carries no run_id at all. Never compare this column to a literal to ask '
  '"did it work" -- use the succeeded column.';
comment on column public.bulk_operation_runs.source_status is
  'The admin_config BULK_OPERATIONS status exactly as the worker read it, when the '
  'appender normalised it into status. Null carries no claim: on a row appended by a '
  'normalising appender it means status was copied through unchanged, and on any row '
  'written before this column existed it means simply that nothing was recorded. '
  'Kept so the history can never quietly relabel a run.';
comment on column public.bulk_operation_runs.succeeded is
  'Generated, not null, and the ONE place that decides what success means -- the '
  'failures index and the failure-is-explained constraint both read this column, so '
  'no query, alert or dashboard needs to compare status to a literal. True for '
  'status = succeeded, and for '
  'status = completed ONLY when progress->''failed'' is the JSON number 0. completed '
  'means the run REACHED ITS END, not that nothing went wrong: PopDAM writes it for '
  'runs with per-item failures, so a completed run that reports failures, or that '
  'reports no failed counter at all, is false here and is listed in '
  'bulk_operation_runs_failures_idx for a human to read.';
comment on column public.bulk_operation_runs.error is
  'Free-text reason a run did not succeed, when the worker has one. Required only for '
  'status = failed, the one outcome word that names no cause of its own; interrupted, '
  'stopped and cancelled are self-describing, and a completed run that reports '
  'failures is explained by progress->''failed''. Supplying it anyway is always '
  'welcome. See bulk_operation_runs_failure_is_explained.';
comment on column public.bulk_operation_runs.progress is
  'Per-item counters the run reported, as a JSON object. progress->''failed'' MUST be a '
  'JSON number for a completed run to count as a success -- see the succeeded column. '
  'Record ''skipped'' and ''processed'' alongside it when known; this is the only place '
  'those counts survive, because the live admin_config object is overwritten by the '
  'next run.';
