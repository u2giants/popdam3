-- =====================================================================================
-- Issue #2440 - chain nightly-reconcile-sg-asset-counts to the rebuild's COMPLETION
-- instead of the fixed clock `45 3 * * *`.
-- Depends on #2439, merged to main as 03f917d0dec6e0973e4b9cddd72e02f686a19e0c.
--
-- Claim #2608 reserves version 20260909005945 and these objects:
--
--   function public.queue_nightly_rebuild_style_groups()      (replaced in place)
--   function public.refresh_style_group_counts_batch(uuid[])  (declared, NOT touched --
--                                                              see "WHAT IS NOT TOUCHED")
--
-- derived-from: the baseline body of queue_nightly_rebuild_style_groups() carried in
-- supabase/ci-bootstrap/010_pre_adoption_baseline.sql. That function has no prior file
-- under supabase/migrations/; the baseline copy was its only source in this repository,
-- and the body below is re-derived from it line by line, not merged into. This migration
-- takes ownership of the function and removes that baseline copy -- see "THE CI BASELINE
-- COPY IS REMOVED BY THIS CHANGE" below.
--
-- THE DEFECT (as recorded on #2440)
-- ---------------------------------------------------------------------------------
--   jobid 6   45 3 * * *   nightly-reconcile-sg-asset-counts
--                          SELECT public.refresh_style_group_counts_batch(array_agg(id))
--                          FROM public.style_groups;
--   jobid 7   0  6 * * *   nightly-rebuild-style-groups
--                          SELECT public.queue_nightly_rebuild_style_groups();
--
-- Both schedules are UTC. Job 6 recomputes every style group's asset count 2 h 15 m
-- BEFORE the rebuild that decides which assets belong to which group. The counts are
-- therefore always measured against yesterday's membership: every group whose membership
-- moves in the nightly rebuild carries a stale count for a full day, and the number is
-- never wrong in a visible way - it is plausible, just old.
--
-- Job 6 is also unbatched despite its name. `array_agg(id) FROM style_groups` hands
-- ~10.9k ids to one call of a function whose own statement_timeout is 30s, and that call
-- was measured at ~94.9s average over 8 calls (#2214 evidence). It is the most expensive
-- statement in the nightly window and it is spent on input the rebuild is about to
-- invalidate.
--
-- WHY THIS IS NOT "MOVE JOB 6 TO A LATER HOUR"
-- ---------------------------------------------------------------------------------
-- The rebuild is ASYNCHRONOUS. Job 7 only ENQUEUES; an external PopDAM worker drives the
-- work and records its state in
-- `public.admin_config -> 'BULK_OPERATIONS' -> 'rebuild-style-groups'`. The 2026-09-06
-- run recorded on #2440 (run_id ba9ce32e-253f-45a9-ab4f-944cb260354c, 135,300 processed)
-- took 2 h 09 m wall clock, and the duration moves with data volume. Replacing one
-- hardcoded clock time with another reproduces this defect at a different hour.
--
-- WHAT THIS MIGRATION DOES - THREE THINGS
-- ---------------------------------------------------------------------------------
-- (1) DELETES job 6's schedule. `nightly-reconcile-sg-asset-counts` is unscheduled. The
--     reconcile no longer runs on a clock at all. This is the change the issue asks for
--     in one line, and everything else exists to make it safe.
--
-- (2) TURNS job 7 INTO A 10-MINUTE POLL (`*/10 * * * *`) over the same function. The
--     jobname `nightly-rebuild-style-groups` and the command
--     `select public.queue_nightly_rebuild_style_groups();` are deliberately UNCHANGED:
--     #2439's evidence, the admin tooling and the operator runbooks all name that job,
--     and renaming it to match the new cadence would silently break every reference for
--     a cosmetic gain. The function, not the schedule, now decides what happens.
--
-- (3) REWRITES queue_nightly_rebuild_style_groups() as a three-armed driver. At most one
--     arm fires per invocation, and every arm is gated on state, never on the clock alone.
--
-- THE THREE ARMS - AND THE ORDER THEY ARE EVALUATED IN
-- ---------------------------------------------------------------------------------
-- Evaluation order is ARM 2, then ARM 1, then ARM 3. That is NOT the numbering order and
-- the difference is load-bearing - see "WHY ARM 2 IS EVALUATED FIRST" below.
--
-- ARM 1 - ENQUEUE. Preserves the retired `0 6 * * *` semantics under a 10-minute poll:
--   fire only at or after 06:00 UTC, only once per UTC day, and only when the operation
--   is not already 'running' or 'queued'. The once-per-day gate reads `last_enqueued_at`
--   from this function's OWN marker object (see "WHERE THE MARKER LIVES"), not from the
--   operation state, because the worker overwrites the operation state wholesale.
--
-- ARM 2 - CHAINED RECONCILE. Fires when the operation's status is exactly 'completed'
--   AND its run_id differs from the last run this function already reconciled.
--     * `= 'completed'`, never "the status changed": a run that ends 'interrupted' or
--       'failed' must NOT trigger a ~98s recompute against membership the rebuild never
--       finished touching. Requirement 1 on #2440.
--     * Keyed on run_id, never on status alone: a status left standing at 'completed'
--       would otherwise re-reconcile every ten minutes forever. Requirement 2 on #2440.
--
-- ARM 3 - THE FLOOR. Fires when the last reconcile of any kind is older than 7 days, or
--   has never happened, AND THE REBUILD IS NOT CURRENTLY IN FLIGHT. Requirement 3 on
--   #2440, and it is not optional: the failure mode this change INTRODUCES is silence. If
--   the rebuild stops reaching 'completed', the counts simply stop refreshing and nothing
--   anywhere says so - strictly worse than today's stale-but-running counts. The floor
--   bounds that silence at 7 days, and the marker object makes it observable rather than
--   inferable (see "THE DETECTOR").
--
-- WHY THE FLOOR IS GATED ON THE REBUILD NOT BEING IN FLIGHT
-- ---------------------------------------------------------------------------------
-- Raised as a HIGH finding in review of this pull request, and it was real. As first
-- written, ARM 3 tested only `last_reconciled_at IS NULL OR older than 7 days`. It did not
-- exclude 'running' or 'queued', and ARM 1 - which returns immediately after enqueueing -
-- writes `last_enqueued_at` but never seeds `last_reconciled_at`. So on the FIRST poll at
-- or after 06:00 UTC following this migration's apply:
--
--   poll 1  ARM 1 fires, enqueues, returns. last_reconciled_at is still null.
--   poll 2  status is now 'queued'/'running', so ARM 1 is skipped and ARM 2 does not
--           match - but ARM 3 saw a null marker and ran the FULL chunked recompute while
--           the worker was mid-rebuild.
--
-- That contradicts this header's own justification for the ~98s advisory-lock window,
-- which is that the reconcile runs AFTER the rebuild reports 'completed'. Worse, a chunk
-- cancelled by that contention aborts the whole driver transaction without stamping the
-- marker, so the next */10 poll retries it - for the remainder of a ~2h09m rebuild.
--
-- THE FIX: ARM 3 now additionally requires that the operation is not in flight. "In
-- flight" is `status in ('running','queued')` AND the operation's own `updated_at`
-- (falling back to `started_at`, then to this function's `last_enqueued_at`) is inside the
-- floor window. The staleness half matters: without it, an operation abandoned at 'queued'
-- because the PopDAM worker died would suppress the floor FOREVER, trading the bug above
-- for unbounded silence - which is precisely what ARM 3 exists to prevent. With it, a
-- rebuild genuinely in progress is left alone, and a rebuild that has been "in progress"
-- for longer than the floor window is correctly treated as not running at all.
--
-- Seeding `last_reconciled_at` on ARM 1 was the other suggested remedy and is deliberately
-- NOT done: `last_reconciled_at` is the detector's answer to "when did the counts last
-- refresh", and stamping it on an enqueue - which refreshes nothing - would make the
-- detector lie. Gating the arm closes the window without corrupting the signal.
--
-- WHY ARM 2 IS EVALUATED FIRST
-- ---------------------------------------------------------------------------------
-- Also raised in review, as a MEDIUM, and also real. ARM 1 rewrites the whole
-- 'rebuild-style-groups' object with a fresh 'queued' state and a new run_id, and it
-- returns. If a run had reached 'completed' but had not yet been reconciled - because the
-- apply landed between completion and the next poll, or because a poll was missed - the
-- 06:00 enqueue would destroy the only record that that run_id had completed, and its
-- membership changes would go uncounted until the 7-day floor. Testing ARM 2's condition
-- before ARM 1 closes it: an unreconciled completed run is always reconciled first, and
-- the enqueue simply happens on the next poll, at most ten minutes later.
--
-- BATCHING - REQUIREMENT 4
-- ---------------------------------------------------------------------------------
-- Both reconcile arms walk public.style_groups in ordered chunks of 500 ids and call
-- public.refresh_style_group_counts_batch once per chunk. The single ~10.9k-element array
-- is gone. This matters for more than tidiness: statement_timeout is enforced PER
-- STATEMENT, and that function carries `SET statement_timeout = '30s'`, so the old
-- single-array call was one statement racing a 30s cap that a 94.9s workload cannot win.
-- Each chunk now gets its own timer. Chunking does not shorten the transaction and is not
-- claimed to: the whole driver invocation remains one transaction.
--
-- WHERE THE MARKER LIVES, AND WHY NOT IN THE OPERATION STATE
-- ---------------------------------------------------------------------------------
-- The marker is a SEPARATE top-level BULK_OPERATIONS key,
-- `admin_config -> 'BULK_OPERATIONS' -> 'style-group-counts-reconcile'`.
--
-- It cannot live inside the 'rebuild-style-groups' object. public.update_bulk_operation
-- (20260819011639) REPLACES that object with a value derived from the caller's payload on
-- every write, so any key this function added there would be erased by the worker's very
-- next progress update - and an idempotency marker that the thing it guards can delete is
-- not a marker. The worker never reads or writes the 'style-group-counts-reconcile' key.
--
-- No new table, column, type or index is created for it. A dedicated marker table was
-- considered and rejected: it would be an object outside this claim, and admin_config is
-- already the store this function writes.
--
-- THE DETECTOR (requirement 3, second half)
-- ---------------------------------------------------------------------------------
-- The marker records `last_reconciled_at`, `last_reconciled_run_id`,
-- `last_reconcile_reason` ('rebuild_completed' | 'floor'), `last_reconcile_rows_written`,
-- `last_reconcile_trigger_status` and `last_enqueued_at`. "When did the counts last
-- refresh, and why" becomes a single read of one JSONB key instead of an inference from
-- cron.job_run_details - which cannot answer it, because cron measures the ENQUEUE and
-- reports success for it. An alert on `last_reconciled_at` older than 48h is now
-- writable; wiring that alert into PopDAM is application work and is NOT done here.
--
-- LOCKING - A REAL COST, STATED PLAINLY
-- ---------------------------------------------------------------------------------
-- The advisory lock `pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))` is taken exactly
-- as the baseline body took it, and it is transaction-scoped, so a reconcile arm holds it
-- for the duration of the reconcile - order ~98s, once per night. Every other
-- BULK_OPERATIONS writer (update_bulk_operation, update_bulk_operations_batch) blocks for
-- that window. This is accepted rather than worked around:
--   * The lock is what makes the run_id marker safe. Two overlapping poll invocations
--     cannot both read "not yet reconciled" and both fire the recompute.
--   * The window follows the rebuild reporting 'completed', so the worker is not mid-run
--     on this operation.
--   * Releasing it early would need a session-scoped lock and an explicit unlock, which
--     reopens exactly the double-fire race the lock exists to close.
-- If BULK_OPERATIONS contention ever becomes real, the fix is a separate advisory key for
-- the reconcile, which touches more objects than this claim holds.
--
-- ADMIN_CONFIG: #2440's scope block lists `table public.admin_config` under reads. This
-- function already WRITES that table today, in the baseline body, and continues to write
-- exactly the same one row (key = 'BULK_OPERATIONS'). No new table is written; the
-- read-only wording in the scope block understates the pre-existing behaviour, and it is
-- named here rather than left to be discovered.
--
-- WHAT IS NOT TOUCHED
-- ---------------------------------------------------------------------------------
-- public.refresh_style_group_counts_batch(uuid[]) is DECLARED in claim #2608 and is
-- deliberately NOT replaced. Requirement 4 asks that the CALL SITE stop passing every
-- group in one array, and the call site is this function. That function's body already
-- carries #2214's change predicate, which is the reason a converged reconcile writes
-- nothing; re-deriving and re-issuing that body here would risk regressing it for no
-- behavioural gain. Over-declaring a write is safe (the lane guard requires the
-- migration's objects to be a SUBSET of the claim's writes); under-declaring is not.
--
-- Also untouched: public.rebuild_style_groups_batch, public.update_bulk_operation,
-- public.update_bulk_operations_batch, public.bulk_operation_runs, the shape of
-- public.admin_config, and every table, column, index, constraint, trigger, policy and
-- grant in the database. No row of style_groups or assets is written by this migration.
--
-- The worker-signalled mechanism (#2440 option A) remains the better long-term shape and
-- is NOT foreclosed: it is PopDAM application work in another repository, and when the
-- worker calls the reconcile as its own final stage, ARM 2 simply stops finding an
-- unreconciled completed run while the floor keeps the safety net. Nothing here has to be
-- undone for that.
--
-- THE CI BASELINE COPY IS REMOVED BY THIS CHANGE
-- ---------------------------------------------------------------------------------
-- supabase/ci-bootstrap/010_pre_adoption_baseline.sql carried the pre-adoption body of
-- queue_nightly_rebuild_style_groups() because no migration in this repository created
-- that function. This migration creates it, so the baseline copy is deleted here.
--
-- This is not cosmetic. The "Database Contract Tests" lane applies the baseline BETWEEN
-- the two migration replay passes (see .github/workflows/database-contract-tests.yml,
-- "WHY BETWEEN THE PASSES AND NOT BEFORE PASS 1"). A migration that replaces a baseline
-- routine and SUCCEEDS in pass 1 is therefore silently overwritten by the baseline's own
-- CREATE OR REPLACE, and the suite then tests the pre-adoption body while every catalog
-- and cron contract still passes. That is exactly what happened to this file: the
-- requirement-1 contract failed because the OLD clock-driven body was the one running.
-- The baseline's own instructions name this remedy -- "a migration has started creating
-- an object the baseline also creates. Delete it from the baseline rather than leaving
-- both." The two grants blocks are left in place; they are idempotent no-ops against the
-- function this migration creates.
--
-- ROLLBACK: a new forward migration restoring the pre-adoption body, which is preserved
-- in this repository's git history of supabase/ci-bootstrap/010_pre_adoption_baseline.sql
-- immediately before this migration's commit, re-scheduling job 7 at `0 6 * * *` and
-- re-creating `nightly-reconcile-sg-asset-counts` at `45 3 * * *` with its original
-- command. The marker key can be left in admin_config harmlessly.
--
-- Contracts: supabase/tests/chain_style_group_counts_to_rebuild_completion_contracts.sql
-- =====================================================================================

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.queue_nightly_rebuild_style_groups()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- The BULK_OPERATIONS key the PopDAM worker owns. This function never invents its
  -- shape; it writes exactly the enqueue state the baseline body wrote.
  c_op            constant text := 'rebuild-style-groups';

  -- This function's own key, which no other writer touches. See the header.
  c_marker        constant text := 'style-group-counts-reconcile';

  -- 06:00 UTC, the hour the retired `0 6 * * *` schedule fired.
  c_enqueue_hour  constant integer := 6;

  -- The floor. Requirement 3 on #2440: bound the silence this change introduces.
  c_floor_days    constant integer := 7;

  -- Chunk size for the reconcile. Requirement 4.
  c_chunk         constant integer := 500;

  v_current         jsonb;
  v_op              jsonb;
  v_marker          jsonb;
  v_status          text;
  v_run_id          text;
  v_last_enqueued   timestamptz;
  v_last_reconciled timestamptz;
  v_last_run        text;
  v_op_seen_at      timestamptz;
  v_in_flight       boolean;
  v_reason          text;
  v_now             timestamptz := now();
  v_state           jsonb;
  v_chunk_ids       uuid[];
  v_offset          integer := 0;
  v_written         integer := 0;
begin
  -- Serialize every BULK_OPERATIONS writer, exactly as the baseline body did. This is
  -- also what makes the run_id marker safe against two overlapping poll invocations.
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);

  v_op := case when jsonb_typeof(v_current -> c_op) = 'object'
               then v_current -> c_op end;
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  v_status          := v_op ->> 'status';
  v_run_id          := nullif(btrim(coalesce(v_op ->> 'run_id', '')), '');
  v_last_enqueued   := nullif(btrim(coalesce(v_marker ->> 'last_enqueued_at', '')), '')::timestamptz;
  v_last_reconciled := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_at', '')), '')::timestamptz;
  v_last_run        := nullif(btrim(coalesce(v_marker ->> 'last_reconciled_run_id', '')), '');

  -- The last moment anything claimed this operation was alive. The worker stamps
  -- 'updated_at' on every progress write and 'started_at' on the enqueue; if the object
  -- carries neither, ARM 1's own 'last_enqueued_at' is the fallback.
  v_op_seen_at := coalesce(
    nullif(btrim(coalesce(v_op ->> 'updated_at', '')), '')::timestamptz,
    nullif(btrim(coalesce(v_op ->> 'started_at', '')), '')::timestamptz,
    v_last_enqueued
  );

  -- A rebuild is IN FLIGHT only if it says 'running'/'queued' AND something has touched it
  -- inside the floor window. An operation stuck at 'queued' for longer than the floor is a
  -- dead worker, not a running rebuild, and must not suppress ARM 3 forever. See
  -- "WHY THE FLOOR IS GATED ON THE REBUILD NOT BEING IN FLIGHT".
  v_in_flight := coalesce(v_status, '') in ('running', 'queued')
                 and v_op_seen_at is not null
                 and v_op_seen_at >= v_now - make_interval(days => c_floor_days);

  -- ======================================================================
  -- ARM 2 - CHAINED RECONCILE, evaluated FIRST. An unreconciled completed run must be
  -- reconciled before ARM 1 is allowed to overwrite the operation object with a fresh
  -- 'queued' state and a new run_id. See "WHY ARM 2 IS EVALUATED FIRST".
  -- ======================================================================
  if v_status = 'completed'
     and v_run_id is not null
     and v_run_id is distinct from v_last_run
  then
    v_reason := 'rebuild_completed';
  end if;

  -- ======================================================================
  -- ARM 1 - ENQUEUE. The retired `0 6 * * *` behaviour, expressed as state.
  -- ======================================================================
  if v_reason is null
     and coalesce(v_status, '') not in ('running', 'queued')
     and extract(hour from (v_now at time zone 'UTC')) >= c_enqueue_hour
     and (
       v_last_enqueued is null
       or (v_last_enqueued at time zone 'UTC')::date < (v_now at time zone 'UTC')::date
     )
  then
    -- Identical to the baseline enqueue state: same keys, same values. The worker's
    -- contract with this object is unchanged.
    v_state := jsonb_build_object(
      'status',         'queued',
      'cursor',         0,
      'params',         jsonb_build_object('force_restart', true),
      'started_at',     v_now::text,
      'updated_at',     v_now::text,
      'progress',       '{}'::jsonb,
      'run_id',         gen_random_uuid()::text,
      'queue_position', (extract(epoch from v_now) * 1000)::bigint,
      'requested_by',   'pg_cron'
    );

    v_current := jsonb_set(v_current, array[c_op], v_state, true);
    v_current := jsonb_set(
      v_current,
      array[c_marker],
      v_marker || jsonb_build_object('last_enqueued_at', v_now::text),
      true
    );

    insert into admin_config (key, value, updated_at)
    values ('BULK_OPERATIONS', v_current, v_now)
    on conflict (key) do update
      set value      = excluded.value,
          updated_at = excluded.updated_at;

    -- A run has just been queued; there is nothing to reconcile on this pass.
    return;
  end if;

  -- ======================================================================
  -- ARM 3 - THE FLOOR. Never while the rebuild is in flight: the ~98s recompute is
  -- justified only against membership the rebuild has finished changing, and running it
  -- mid-rebuild is the HIGH finding documented in the header above.
  -- ======================================================================
  if v_reason is null
     and not v_in_flight
     and (
       v_last_reconciled is null
       or v_last_reconciled < v_now - make_interval(days => c_floor_days)
     )
  then
    v_reason := 'floor';
  end if;

  if v_reason is null then
    return;
  end if;

  -- Requirement 4: ordered chunks, never one array of every group. Ordering by the
  -- primary key over a single transaction snapshot makes the OFFSET walk stable, and
  -- each call gets its own statement_timeout window.
  loop
    select array_agg(s.id)
      into v_chunk_ids
    from (
      select sg.id
      from public.style_groups sg
      order by sg.id
      offset v_offset
      limit c_chunk
    ) s;

    exit when v_chunk_ids is null;

    v_written := v_written + coalesce(public.refresh_style_group_counts_batch(v_chunk_ids), 0);
    v_offset  := v_offset + c_chunk;
  end loop;

  -- Re-read under the same advisory lock before stamping. The reconcile above can run for
  -- minutes; writing back the object read before it would discard any concurrent change
  -- made by a writer that does not take this lock.
  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  v_current := jsonb_set(
    v_current,
    array[c_marker],
    v_marker || jsonb_build_object(
      'last_reconciled_at',            v_now::text,
      -- On a floor pass there is no completed run to attribute, so the previously
      -- reconciled run_id is carried forward unchanged. Overwriting it with the current
      -- (failed or interrupted) run would make ARM 2 skip that run once it finally
      -- succeeds.
      'last_reconciled_run_id',        case when v_reason = 'rebuild_completed'
                                            then to_jsonb(v_run_id)
                                            else coalesce(to_jsonb(v_last_run), 'null'::jsonb) end,
      'last_reconcile_reason',         v_reason,
      'last_reconcile_rows_written',   v_written,
      'last_reconcile_trigger_status', coalesce(v_status, 'unknown')
    ),
    true
  );

  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_current, now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;
end;
$function$;

-- Restated to match the ACL the baseline grants; create or replace preserves it, so these
-- are no-ops. `anon` holds no EXECUTE and is not granted any.
grant execute on function public.queue_nightly_rebuild_style_groups() to service_role;
grant execute on function public.queue_nightly_rebuild_style_groups() to authenticated;
grant execute on function public.queue_nightly_rebuild_style_groups() to postgres;

comment on function public.queue_nightly_rebuild_style_groups() is
  'Nightly style-group rebuild DRIVER (issue #2440). Invoked every 10 minutes by cron job '
  '"nightly-rebuild-style-groups"; the schedule is a poll, the function decides. Three '
  'mutually exclusive arms, evaluated in the order 2, 1, 3: (1) enqueue the rebuild once per '
  'UTC day at or after 06:00 UTC, which is the retired 0 6 * * * behaviour expressed as state; '
  '(2) run the asset-count reconcile in 500-group chunks when the operation reaches status '
  '"completed" with a run_id this function has not already reconciled - checked BEFORE arm 1 so '
  'the enqueue cannot overwrite an unreconciled completed run; (3) run it if the last reconcile '
  'is older than 7 days or never happened AND the rebuild is not in flight - arm 3 never runs '
  'while the operation is "running"/"queued" and freshly touched, because a ~98s recompute '
  'against membership the rebuild is still changing is exactly what this design exists to stop. '
  'An operation stuck at "queued" for longer than the floor window counts as not in flight, so a '
  'dead worker cannot suppress the floor forever. Arm 2 replaces the retired cron job "nightly-reconcile-sg-asset-counts" '
  '(45 3 * * *), which recomputed every count 2h15m BEFORE the rebuild that changed the '
  'membership being counted. Idempotence and the once-per-day enqueue gate are keyed on '
  'admin_config -> BULK_OPERATIONS -> "style-group-counts-reconcile", a separate key the '
  'PopDAM worker never writes: update_bulk_operation replaces the "rebuild-style-groups" '
  'object wholesale, so a marker stored there would be erased by the next progress update. '
  'Arm 3 exists because the failure mode this design introduces is SILENCE - read '
  'last_reconciled_at from that marker to detect it.';

-- =====================================================================================
-- CRON. Job 6 loses its clock schedule outright; job 7 becomes the 10-minute poll.
-- Both are unscheduled by NAME first so this migration is re-runnable and does not depend
-- on a jobid that differs between preview and production.
-- =====================================================================================
do $cron$
declare
  v_job_id bigint;
begin
  -- (1) Delete job 6's schedule. This is the change #2440 asks for.
  for v_job_id in
    select jobid from cron.job where jobname = 'nightly-reconcile-sg-asset-counts'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  -- (2) Job 7 keeps its name and its command; only the cadence changes.
  for v_job_id in
    select jobid from cron.job where jobname = 'nightly-rebuild-style-groups'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'nightly-rebuild-style-groups',
    '*/10 * * * *',
    $cron_body$ select public.queue_nightly_rebuild_style_groups() $cron_body$
  );
end;
$cron$;
