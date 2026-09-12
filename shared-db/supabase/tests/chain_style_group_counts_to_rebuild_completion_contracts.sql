-- Contracts for 20260909005945_chain_style_group_counts_to_rebuild_completion.sql (#2440).
--
-- What is being pinned:
--   1. Catalog posture of public.queue_nightly_rebuild_style_groups(): zero arguments,
--      RETURNS void, LANGUAGE plpgsql, SECURITY DEFINER, search_path=public, and EXECUTE
--      granted to service_role and postgres. (#2769 revoked authenticated; the full client-role
--      restriction is pinned by queue_nightly_rebuild_style_groups_execute_grants.sql.)
--   2. Cron state. The clock-driven reconcile job is GONE - `nightly-reconcile-sg-asset-counts`
--      must not exist - and `nightly-rebuild-style-groups` runs on `*/10 * * * *` with its
--      command unchanged. This is the whole point of #2440 and the one thing a later
--      migration could silently undo.
--   3. Requirement 1: a rebuild that did NOT reach status 'completed' triggers no
--      reconcile. Set up a 'failed' run and prove the reconcile marker never moves.
--   4. Requirement 2: idempotence is keyed on run_id, not on status. A 'completed' run
--      whose run_id was already reconciled triggers nothing, however many times the poll
--      fires.
--   5. Requirement 3: the floor arm exists and is time-based - an operation sitting at
--      'failed' with a reconcile older than 7 days DOES reconcile, so the counts cannot
--      go silent indefinitely.
--   6. The marker lives under its own top-level BULK_OPERATIONS key, NOT inside the
--      'rebuild-style-groups' object that public.update_bulk_operation replaces wholesale.
--   7. THE REVIEW HIGH FINDING: the floor arm must not fire while the rebuild is in
--      flight. The exact case is `status` 'queued' or 'running' with `last_reconciled_at`
--      STILL NULL - which is what the very first poll after this migration applies looks
--      like, because the enqueue arm writes last_enqueued_at and returns without ever
--      seeding last_reconciled_at. Before the fix, that poll ran the full ~98s chunked
--      recompute against membership the worker was still rewriting. Both statuses are
--      pinned, both with a null marker.
--   8. The in-flight suppression is bounded. An operation abandoned at 'queued' with
--      nothing touching it for longer than the floor window is a dead worker, not a
--      running rebuild, and the floor must still fire - otherwise fixing (7) would trade
--      a concurrent recompute for unbounded silence, which is what the floor exists to
--      prevent.
--   9. THE REVIEW MEDIUM FINDING: arm 2 is evaluated before arm 1. A completed run that
--      has not yet been reconciled must be reconciled rather than overwritten by the
--      06:00 enqueue, which replaces the operation object wholesale with a new run_id and
--      would otherwise lose that run's membership changes until the floor.
--
-- Every behavioural step below FAILS against the pre-#2440 body, which had no arms at all:
-- it would enqueue (or skip) and never write a 'style-group-counts-reconcile' key.
--
-- Steps 5 and 7 actually run the reconcile, which walks every style group. They are
-- therefore GUARDED on the size of public.style_groups and are skipped with a notice on a
-- production-sized dataset; the negative steps, which carry the two guarantees most at
-- risk, always run.

begin;

do $catalog$
declare
  v_oid     oid;
  v_prokind "char";
  v_secdef  boolean;
  v_lang    name;
  v_rettype text;
  v_config  text[];
  v_missing text;
begin
  select p.oid, p.prokind, p.prosecdef, l.lanname,
         pg_catalog.format_type(p.prorettype, null), p.proconfig
    into v_oid, v_prokind, v_secdef, v_lang, v_rettype, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'queue_nightly_rebuild_style_groups'
    and p.pronargs = 0;

  if v_oid is null then
    raise exception 'CONTRACT: public.queue_nightly_rebuild_style_groups() is missing. Issue #2440 replaces this exact signature and must not change it.';
  end if;

  if v_prokind is distinct from 'f' then
    raise exception 'CONTRACT: queue_nightly_rebuild_style_groups is no longer a plain function (prokind=%).', v_prokind;
  end if;

  if v_rettype is distinct from 'void' then
    raise exception 'CONTRACT: queue_nightly_rebuild_style_groups must return void, found %. The pg_cron command SELECTs it directly.', v_rettype;
  end if;

  if v_lang is distinct from 'plpgsql' then
    raise exception 'CONTRACT: queue_nightly_rebuild_style_groups must be plpgsql (the three arms need control flow), found %.', v_lang;
  end if;

  if not v_secdef then
    raise exception 'CONTRACT: queue_nightly_rebuild_style_groups lost SECURITY DEFINER. pg_cron runs it as postgres, but the admin_config write and the reconcile both depend on definer rights.';
  end if;

  if v_config is null or not (v_config @> array['search_path=public']) then
    raise exception 'CONTRACT: queue_nightly_rebuild_style_groups must pin search_path=public on a SECURITY DEFINER function. proconfig=%', v_config;
  end if;

  select string_agg(r.rolname, ', ' order by r.rolname)
    into v_missing
  from (values ('service_role'), ('postgres')) as r(rolname)
  where not has_function_privilege(r.rolname, v_oid, 'EXECUTE');

  if v_missing is not null then
    raise exception 'CONTRACT: EXECUTE on queue_nightly_rebuild_style_groups() is missing for: %', v_missing;
  end if;

  raise notice 'OK: catalog posture of queue_nightly_rebuild_style_groups() is intact.';
end $catalog$;

do $cron_state$
declare
  v_count    integer;
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  if to_regclass('cron.job') is null then
    raise notice 'SKIP: pg_cron is not installed in this database; cron contracts not evaluated.';
    return;
  end if;

  -- (1) The clock-driven reconcile is gone. This is #2440's stated outcome.
  select count(*) into v_count
  from cron.job
  where jobname = 'nightly-reconcile-sg-asset-counts';

  if v_count <> 0 then
    raise exception 'CONTRACT: cron job "nightly-reconcile-sg-asset-counts" still exists (% row(s)). Issue #2440 deletes its 45 3 * * * schedule; the reconcile is now driven by the rebuild completing.', v_count;
  end if;

  -- (2) The driver job kept its name and command; only the cadence changed.
  select schedule, command, active
    into v_schedule, v_command, v_active
  from cron.job
  where jobname = 'nightly-rebuild-style-groups';

  if v_schedule is null then
    raise exception 'CONTRACT: cron job "nightly-rebuild-style-groups" is missing. It is the poll that drives all three arms; without it nothing rebuilds and nothing reconciles.';
  end if;

  if v_schedule is distinct from '*/10 * * * *' then
    raise exception 'CONTRACT: "nightly-rebuild-style-groups" must poll every 10 minutes, found schedule "%". A daily schedule would delay the chained reconcile by up to a day, which is the defect #2440 removes.', v_schedule;
  end if;

  if v_command not like '%queue_nightly_rebuild_style_groups%' then
    raise exception 'CONTRACT: "nightly-rebuild-style-groups" no longer calls queue_nightly_rebuild_style_groups(). Command is: %', v_command;
  end if;

  if not coalesce(v_active, false) then
    raise exception 'CONTRACT: cron job "nightly-rebuild-style-groups" is inactive.';
  end if;

  raise notice 'OK: reconcile job unscheduled; rebuild driver polls on */10 * * * *.';
end $cron_state$;

do $behaviour$
declare
  c_op     constant text := 'rebuild-style-groups';
  c_marker constant text := 'style-group-counts-reconcile';
  c_guard  constant integer := 2000;

  v_groups   bigint;
  v_baseline jsonb;
  v_marker   jsonb;
  v_reason   text;
  v_run      text;
  v_at       text;
  v_status   text;
begin
  select count(*) into v_groups from public.style_groups;

  -- ------------------------------------------------------------------
  -- Requirement 1: a run that did not complete must not trigger anything.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status', 'failed',
      'run_id', '11111111-1111-1111-1111-111111111111'
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       now()::text,          -- blocks the enqueue arm today
      'last_reconciled_at',     now()::text,          -- blocks the floor arm
      'last_reconciled_run_id', '00000000-0000-0000-0000-000000000000',
      'last_reconcile_reason',  'seed'
    )
  );

  insert into public.admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_baseline, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';

  if v_marker ->> 'last_reconcile_reason' is distinct from 'seed' then
    raise exception 'CONTRACT (#2440 req 1): a rebuild with status "failed" triggered a reconcile (reason became %). The trigger condition must be status = ''completed'', never "the status changed".',
      v_marker ->> 'last_reconcile_reason';
  end if;

  if (select value -> c_op ->> 'status' from public.admin_config where key = 'BULK_OPERATIONS') = 'queued' then
    raise exception 'CONTRACT: the enqueue arm fired despite an enqueue already recorded for today. The once-per-UTC-day gate is broken and the poll would queue a rebuild every 10 minutes.';
  end if;

  raise notice 'OK req 1: a failed rebuild triggers no reconcile.';

  -- ------------------------------------------------------------------
  -- Requirement 2: idempotence is keyed on run_id, not on status alone.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status', 'completed',
      'run_id', '22222222-2222-2222-2222-222222222222'
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       now()::text,
      'last_reconciled_at',     now()::text,
      'last_reconciled_run_id', '22222222-2222-2222-2222-222222222222',  -- same run
      'last_reconcile_reason',  'seed'
    )
  );

  update public.admin_config set value = v_baseline, updated_at = now()
  where key = 'BULK_OPERATIONS';

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';

  if v_marker ->> 'last_reconcile_reason' is distinct from 'seed' then
    raise exception 'CONTRACT (#2440 req 2): a completed run that was ALREADY reconciled was reconciled again (reason became %). Keyed on status alone, a stuck "completed" would re-run the full recompute every 10 minutes forever.',
      v_marker ->> 'last_reconcile_reason';
  end if;

  raise notice 'OK req 2: an already-reconciled run_id is not reconciled twice.';

  -- ------------------------------------------------------------------
  -- Requirement 6: the marker is its own top-level key, not part of the
  -- worker-owned operation object.
  -- ------------------------------------------------------------------
  if (select value -> c_op -> 'last_reconciled_at' from public.admin_config where key = 'BULK_OPERATIONS') is not null then
    raise exception 'CONTRACT: the reconcile marker was written inside the "%" object. public.update_bulk_operation replaces that object wholesale on every worker progress update, so the marker would be erased and idempotence lost.', c_op;
  end if;

  raise notice 'OK: marker is a separate top-level BULK_OPERATIONS key.';

  -- ------------------------------------------------------------------
  -- Review HIGH finding: the floor must NOT fire while the rebuild is in
  -- flight, and the case that matters is the one with NO marker at all -
  -- the first poll after this migration applies. Run for both in-flight
  -- statuses. These are negative steps: they must never run the recompute,
  -- so they are outside the size guard and always execute.
  -- ------------------------------------------------------------------
  foreach v_status in array array['running', 'queued'] loop
    v_baseline := jsonb_build_object(
      c_op, jsonb_build_object(
        'status',     v_status,
        'run_id',     '55555555-5555-5555-5555-555555555555',
        'started_at', now()::text,
        'updated_at', now()::text
      ),
      c_marker, jsonb_build_object(
        -- Exactly what ARM 1 leaves behind: an enqueue stamp and NOTHING else.
        -- last_reconciled_at is absent, i.e. "never reconciled".
        'last_enqueued_at', now()::text
      )
    );

    update public.admin_config set value = v_baseline, updated_at = now()
    where key = 'BULK_OPERATIONS';

    perform public.queue_nightly_rebuild_style_groups();

    select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';

    if v_marker -> 'last_reconcile_reason' is not null then
      raise exception 'CONTRACT (#2440 review HIGH): the floor arm fired (reason = %) while the rebuild was "%" with last_reconciled_at still null. That is the first poll after deploy, and it runs the full ~98s chunked recompute against membership the worker is still rewriting - contradicting the header''s justification for the advisory-lock window, and re-firing every 10 minutes for the rest of a ~2h09m rebuild whenever a cancelled chunk aborts the driver before it stamps the marker.',
        v_marker ->> 'last_reconcile_reason', v_status;
    end if;

    if v_marker -> 'last_reconciled_at' is not null then
      raise exception 'CONTRACT (#2440 review HIGH): last_reconciled_at was stamped while the rebuild was "%". Nothing reconciled anything on this pass.', v_status;
    end if;

    if (select value -> c_op ->> 'status' from public.admin_config where key = 'BULK_OPERATIONS')
       is distinct from v_status then
      raise exception 'CONTRACT: the enqueue arm overwrote an operation that was already "%". The in-flight guard on ARM 1 is broken.', v_status;
    end if;

    raise notice 'OK review HIGH: status "%" with a null reconcile marker triggers nothing.', v_status;
  end loop;

  if v_groups > c_guard then
    raise notice 'SKIP: public.style_groups holds % rows (> %); the positive reconcile steps would run the full recompute and are not executed here.', v_groups, c_guard;
    return;
  end if;

  -- ------------------------------------------------------------------
  -- Requirement 2 (positive half): a NEW completed run does reconcile.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status', 'completed',
      'run_id', '33333333-3333-3333-3333-333333333333'
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       now()::text,
      'last_reconciled_at',     now()::text,
      'last_reconciled_run_id', '22222222-2222-2222-2222-222222222222',  -- a different run
      'last_reconcile_reason',  'seed'
    )
  );

  update public.admin_config set value = v_baseline, updated_at = now()
  where key = 'BULK_OPERATIONS';

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';
  v_reason := v_marker ->> 'last_reconcile_reason';
  v_run    := v_marker ->> 'last_reconciled_run_id';

  if v_reason is distinct from 'rebuild_completed' then
    raise exception 'CONTRACT (#2440 req 2): a newly completed run did NOT trigger the chained reconcile (reason = %). Without this arm the counts are never refreshed at all, because the clock job is gone.', coalesce(v_reason, '<null>');
  end if;

  if v_run is distinct from '33333333-3333-3333-3333-333333333333' then
    raise exception 'CONTRACT: the reconciled run_id was not recorded (found %). Without it the next poll reconciles the same run again.', coalesce(v_run, '<null>');
  end if;

  if v_marker -> 'last_reconcile_rows_written' is null then
    raise exception 'CONTRACT: last_reconcile_rows_written was not recorded. It is part of the detector that makes the new silent failure mode observable.';
  end if;

  raise notice 'OK req 2 (positive): a new completed run reconciles once and records its run_id.';

  -- ------------------------------------------------------------------
  -- Requirement 3: the floor. Silence must be bounded even if the rebuild
  -- never reaches 'completed' again.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status', 'failed',
      'run_id', '44444444-4444-4444-4444-444444444444'
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       now()::text,
      'last_reconciled_at',     (now() - interval '30 days')::text,
      'last_reconciled_run_id', '22222222-2222-2222-2222-222222222222',
      'last_reconcile_reason',  'seed'
    )
  );

  update public.admin_config set value = v_baseline, updated_at = now()
  where key = 'BULK_OPERATIONS';

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';
  v_reason := v_marker ->> 'last_reconcile_reason';
  v_run    := v_marker ->> 'last_reconciled_run_id';
  v_at     := v_marker ->> 'last_reconciled_at';

  if v_reason is distinct from 'floor' then
    raise exception 'CONTRACT (#2440 req 3): the weekly floor did not fire after 30 days without a reconcile (reason = %). Issue #2437''s rule: a change that introduces a new failure mode must not ship without a detector, and this design''s new failure mode is silence.', coalesce(v_reason, '<null>');
  end if;

  if v_run is distinct from '22222222-2222-2222-2222-222222222222' then
    raise exception 'CONTRACT: a floor pass overwrote last_reconciled_run_id with % . It must carry the previous value forward, or the failed run would be treated as reconciled and skipped once it finally succeeds.', coalesce(v_run, '<null>');
  end if;

  if v_at::timestamptz < now() - interval '1 day' then
    raise exception 'CONTRACT: the floor pass did not stamp last_reconciled_at (still %), so it would re-fire on every poll.', v_at;
  end if;

  raise notice 'OK req 3: the 7-day floor fires and bounds the silence.';

  -- ------------------------------------------------------------------
  -- The in-flight suppression is BOUNDED. An operation left at 'queued'
  -- with nothing touching it for longer than the floor window is a dead
  -- worker, and the floor must still fire. Without this, the fix for the
  -- HIGH finding would trade a concurrent recompute for permanent silence.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status',     'queued',
      'run_id',     '66666666-6666-6666-6666-666666666666',
      'started_at', (now() - interval '30 days')::text,
      'updated_at', (now() - interval '30 days')::text
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       (now() - interval '30 days')::text,
      'last_reconciled_at',     (now() - interval '30 days')::text,
      'last_reconciled_run_id', '22222222-2222-2222-2222-222222222222',
      'last_reconcile_reason',  'seed'
    )
  );

  update public.admin_config set value = v_baseline, updated_at = now()
  where key = 'BULK_OPERATIONS';

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';

  if v_marker ->> 'last_reconcile_reason' is distinct from 'floor' then
    raise exception 'CONTRACT (#2440 review HIGH, bound): an operation stuck at "queued" for 30 days suppressed the floor (reason = %). A dead worker must not silence the counts forever; only a rebuild touched inside the floor window counts as in flight.', coalesce(v_marker ->> 'last_reconcile_reason', '<null>');
  end if;

  raise notice 'OK: a stale "queued" operation does not suppress the floor.';

  -- ------------------------------------------------------------------
  -- Review MEDIUM: arm 2 is evaluated before arm 1. A completed run that
  -- was never reconciled must be reconciled, not overwritten by the
  -- enqueue, which replaces the operation object wholesale with a new
  -- run_id.
  --
  -- HONEST LIMIT, stated rather than hidden: the enqueue arm also requires
  -- the current UTC hour to be >= 6, and a contract test cannot move the
  -- clock. `last_enqueued_at` is set to yesterday, which opens the other
  -- half of the enqueue gate, so this step is DISCRIMINATING - it fails
  -- against the pre-fix arm ordering - only when the suite runs at or after
  -- 06:00 UTC. Before that hour the enqueue could not have fired anyway and
  -- the step proves nothing about ordering; it says so out loud instead of
  -- reporting a pass it did not earn. The reconcile assertion below is
  -- checked in both cases, because a completed unreconciled run must be
  -- reconciled at any hour.
  -- ------------------------------------------------------------------
  v_baseline := jsonb_build_object(
    c_op, jsonb_build_object(
      'status',     'completed',
      'run_id',     '77777777-7777-7777-7777-777777777777',
      'started_at', (now() - interval '1 day')::text,
      'updated_at', now()::text
    ),
    c_marker, jsonb_build_object(
      'last_enqueued_at',       (now() - interval '1 day')::text,
      'last_reconciled_at',     now()::text,
      'last_reconciled_run_id', '22222222-2222-2222-2222-222222222222',
      'last_reconcile_reason',  'seed'
    )
  );

  update public.admin_config set value = v_baseline, updated_at = now()
  where key = 'BULK_OPERATIONS';

  perform public.queue_nightly_rebuild_style_groups();

  select value -> c_marker into v_marker from public.admin_config where key = 'BULK_OPERATIONS';

  if v_marker ->> 'last_reconciled_run_id' is distinct from '77777777-7777-7777-7777-777777777777' then
    raise exception 'CONTRACT (#2440 review MEDIUM): a completed-but-unreconciled run was not reconciled (last_reconciled_run_id = %). ARM 1 must not be evaluated before ARM 2: the enqueue replaces the operation object wholesale with a new run_id, destroying the only record that this run completed, and its membership changes would go uncounted until the floor.', coalesce(v_marker ->> 'last_reconciled_run_id', '<null>');
  end if;

  if (select value -> c_op ->> 'status' from public.admin_config where key = 'BULK_OPERATIONS') = 'queued' then
    raise exception 'CONTRACT (#2440 review MEDIUM): the enqueue arm fired on the same pass that had an unreconciled completed run. At most one arm fires per invocation, and the reconcile has priority.';
  end if;

  if extract(hour from (now() at time zone 'UTC')) >= 6 then
    raise notice 'OK review MEDIUM: an unreconciled completed run is reconciled before the enqueue (UTC hour %, the enqueue gate was open, so this step was discriminating).',
      extract(hour from (now() at time zone 'UTC'));
  else
    raise notice 'PARTIAL review MEDIUM: the completed run WAS reconciled, but the UTC hour is % (< 6), so the enqueue arm could not have fired and the ARM-2-before-ARM-1 ordering was NOT exercised by this run. Not claimed as coverage of the ordering.',
      extract(hour from (now() at time zone 'UTC'));
  end if;
end $behaviour$;

rollback;
