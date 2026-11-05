-- Stop three pg_cron timeout-retry loops (u2giants/popdam3#804).
-- derived-from: 20261012012727, 20261027012301, 20260917024050, 20261011175808
--
-- Measured Nov 5 2026 (production, read-only): every failed pass ran the full 120 s
-- global statement_timeout, rolled back and repeated, wasting I/O and WAL.
--
-- 1. queue_nightly_rebuild_style_groups(): the counts reconcile becomes resumable.
--    Each pass works about 60 s, durably stores a keyset cursor in its own marker and
--    stamps last_reconciled_* only after the complete walk. Lock order is unchanged.
--    A walk is bound to the operation state it began under; any later operation
--    change discards the cursor and restarts from the first group, so a rebuild can
--    never leave changed membership behind the cursor unnoticed.
--
-- 2. The two refresh jobs get a working 10 minute timeout. A SET on the function does
--    not extend the timer of the running top-level statement. A preceding SET LOCAL
--    in the same multi-statement cron command does: PostgreSQL 13+ starts a fresh timer
--    for each statement of a simple-protocol string (asserted on PG17 by the test).
--
-- 3. Refreshes are skipped only when per-table cumulative statistics, read BEFORE the
--    refresh, prove no committed change. A counter is published only after its
--    transaction ended, so a counted change is always visible to the later refresh.
--    Rolled-back writes merely cause a harmless extra refresh. The table file number
--    covers TRUNCATE; postmaster start covers a restart. Counters lost in a crash are
--    bounded by the maximum staleness below.
--
-- Freshness: matviews hourly on change; library snapshot within 15 minutes of a file or
-- render-queue change and within an hour of a search-document-only change (embedding
-- writes churn that table without changing browse results); both refresh at least every
-- 6 hours. The search-document sync still runs every hour regardless of the gate.

create or replace function public.style_guide_refresh_source_signature(p_sources regclass[])
returns text
language sql
volatile
set search_path to 'pg_catalog'
as $function$
  select md5(string_agg(
           concat_ws(':', s.oid::oid::text,
             pg_stat_get_tuples_inserted(s.oid),
             pg_stat_get_tuples_updated(s.oid),
             pg_stat_get_tuples_deleted(s.oid),
             pg_relation_filenode(s.oid)),
           '|' order by s.oid::oid)
         || '@' || pg_postmaster_start_time()::text)
  from unnest(p_sources) as s(oid);
$function$;

create or replace function public.refresh_style_guide_library_default_snapshot()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_primary text := public.style_guide_refresh_source_signature(
    array['public.style_guide_files', 'public.style_guide_render_queue']::regclass[]);
  v_documents text := public.style_guide_refresh_source_signature(
    array['public.style_guide_search_documents']::regclass[]);
  v_state jsonb;
  v_last timestamptz;
begin
  select a.value -> 'library-default-snapshot' into v_state
    from public.admin_config a where a.key = 'STYLE_GUIDE_REFRESH_STATE';
  v_last := (v_state ->> 'refreshed_at')::timestamptz;

  if v_last >= now() - interval '6 hours'
     and v_state ->> 'primary_signature' = v_primary
     and (v_state ->> 'documents_signature' = v_documents
          or v_last >= now() - interval '1 hour') then
    return;
  end if;

  refresh materialized view concurrently public.style_guide_library_default_guides;
  refresh materialized view concurrently public.style_guide_library_default_summary;

  insert into public.admin_config as a (key, value, updated_at)
  values ('STYLE_GUIDE_REFRESH_STATE',
          jsonb_build_object('library-default-snapshot', jsonb_build_object(
            'refreshed_at', now(), 'primary_signature', v_primary,
            'documents_signature', v_documents)),
          now())
  on conflict (key) do update
    set value = a.value || excluded.value, updated_at = excluded.updated_at;
end
$function$;

create or replace function public.refresh_style_guide_matviews_job()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_signature text := public.style_guide_refresh_source_signature(
    array['public.style_guide_files']::regclass[]);
  v_state jsonb;
  v_last timestamptz;
begin
  select a.value -> 'matviews' into v_state
    from public.admin_config a where a.key = 'STYLE_GUIDE_REFRESH_STATE';
  v_last := (v_state ->> 'refreshed_at')::timestamptz;

  -- A crawl waiting in await_style_guide_matview_refresh treats a successful run of
  -- this job as proof its data is in the matviews, so a recent crawl always refreshes.
  if v_last >= now() - interval '6 hours'
     and v_state ->> 'signature' = v_signature
     and not exists (
       select 1 from public.style_guide_crawl_runs r
        where r.lifecycle_state in ('reconciling', 'refreshing')
          and r.refresh_completed_at is null
          and greatest(r.ingest_completed_at, r.refresh_started_at) >= now() - interval '2 hours') then
    -- Unchanged matviews; the search-document sync is independent and always runs.
    perform public.refresh_style_guide_matviews(
      p_run_id => null, p_search_batch_size => 5000, p_step => 'search');
    return;
  end if;

  perform public.refresh_style_guide_matviews(
    p_run_id => null, p_search_batch_size => 5000, p_step => 'all');

  insert into public.admin_config as a (key, value, updated_at)
  values ('STYLE_GUIDE_REFRESH_STATE',
          jsonb_build_object('matviews', jsonb_build_object(
            'refreshed_at', now(), 'signature', v_signature)),
          now())
  on conflict (key) do update
    set value = a.value || excluded.value, updated_at = excluded.updated_at;
end
$function$;

revoke all on function public.style_guide_refresh_source_signature(regclass[])
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_style_guide_matviews_job()
  from public, anon, authenticated, service_role;

-- Same contract as before, repointed at the new job command and body. Its in-flight
-- allowance widens from the old 2 minute execution budget to the job's 10 minutes.
create or replace function public.await_style_guide_matview_refresh(p_run_id uuid)
returns table(ready boolean, refreshed_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_start timestamptz;
  v_ingest timestamptz;
  v_state text;
  v_job bigint;
  v_wait_minutes integer;
  v_finished timestamptz;
  v_inflight boolean;
begin
  if p_run_id is null then
    raise exception 'A crawl run is required';
  end if;
  select r.refresh_started_at, r.ingest_completed_at, r.lifecycle_state
    into v_start, v_ingest, v_state
    from public.style_guide_crawl_runs r where r.id = p_run_id for update;
  if not found or v_ingest is null or v_state not in ('reconciling', 'refreshing') then
    raise exception 'Crawl must have finished ingestion and reconciliation before awaiting refresh';
  end if;
  select j.jobid, case j.schedule when '*/15 * * * *' then 20 else 65 end
    into v_job, v_wait_minutes from cron.job j
   where j.jobname = 'refresh-style-guide-matviews' and j.active
     and j.schedule in ('*/15 * * * *', '7 * * * *')
     and j.username = 'postgres' and j.database = current_database()
     and regexp_replace(lower(regexp_replace(j.command, '[[:space:]]', '', 'g')), ';$', '')
         = 'setlocalstatement_timeout=''10min'';selectpublic.refresh_style_guide_matviews_job()';
  if v_job is null then
    raise exception 'The existing PopSG refresh scheduler is unavailable or its command changed';
  end if;
  -- Pin the live, reviewed bodies so future drift cannot silently weaken what a
  -- successful cron run proves. The job body refreshes whenever a recent crawl is open.
  if to_regprocedure('public.refresh_style_guide_matviews()') is not null
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
         and p.prosecdef and p.pronargdefaults = 2
         and md5(p.prosrc) = '044a40244377bb9b64dc65efbc7ccf6a')
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews_job()')
         and p.prosecdef
         and md5(p.prosrc) = '6b8b6a3459e103e22996afd84b6abede') then
    raise exception 'The scheduled PopSG refresh contract changed';
  end if;
  if v_start is null then
    v_start := clock_timestamp();
    update public.style_guide_crawl_runs
       set refresh_started_at = v_start, lifecycle_state = 'refreshing'
     where id = p_run_id;
  end if;
  -- A refresh started before this crawl entered refresh is never evidence.
  select max(d.end_time) into v_finished from cron.job_run_details d
   where d.jobid = v_job and d.status = 'succeeded'
     and d.start_time >= greatest(v_start, v_ingest)
     and d.end_time >= d.start_time;
  if v_finished is null and clock_timestamp() - v_start > make_interval(mins => v_wait_minutes) then
    select exists (select 1 from cron.job_run_details d
      where d.jobid = v_job and d.status in ('starting', 'connecting', 'sending', 'running')
        and d.end_time is null and d.start_time >= greatest(v_start, v_ingest)
        and d.start_time >= clock_timestamp() - interval '10 minutes') into v_inflight;
    if not v_inflight or clock_timestamp() - v_start > make_interval(mins => v_wait_minutes + 10) then
      raise exception 'No successful scheduled PopSG refresh within the bounded wait window';
    end if;
  end if;
  -- Never stamp refresh_completed_at here: the existing search-only step must
  -- drain search synchronization before the caller can complete the crawl.
  return query select v_finished is not null, v_finished;
end;
$function$;

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
  c_watermark     constant text := 'style-group-change-watermark';

  -- 06:00 UTC, the hour the retired `0 6 * * *` schedule fired.
  c_enqueue_hour  constant integer := 6;

  -- The floor. Requirement 3 on #2440: bound the silence this change introduces.
  c_floor_days    constant integer := 7;

  -- Reconcile chunk and per-pass budget, measured from the top-level statement start
  -- so that time spent waiting for the locks below counts against the 120 s timeout.
  c_chunk         constant integer := 200;
  c_pass_budget   constant interval := interval '60 seconds';

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
  v_written         bigint := 0;
  v_watermark       jsonb;
  v_cutoff          timestamptz;
  v_since           timestamptz;
  v_full            boolean;
  v_change_locked   boolean := false;
  v_walk            jsonb;
  v_after           uuid;
  v_walk_started    text;
  v_walk_done       boolean := false;
begin
  -- Serialize every BULK_OPERATIONS writer, exactly as the baseline body did. This is
  -- also what makes the run_id marker safe against two overlapping poll invocations.
  -- Acquire before BULK_OPERATIONS: never invert a writer which first stamps
  -- its change and then updates operation state in the same transaction.
  SELECT true INTO v_change_locked
  FROM pg_advisory_lock(hashtext('style-group-change-clock-2421'));
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));
  v_cutoff := clock_timestamp();

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_watermark := coalesce(v_current -> c_watermark, '{}'::jsonb);

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

  -- Only a matching successful worker run acknowledges the captured cutoff.
  -- Failed/interrupted/partial/manual runs never advance it. Older workers may
  -- still do a full walk, which is a safe superset during staged application rollout.
  if v_status = 'completed'
     and v_run_id = v_watermark ->> 'pending_run_id'
     and v_op -> 'params' ->> 'watermark_protocol' = '1'
     and (v_op -> 'params' ->> 'changed_cutoff')::timestamptz
         = (v_watermark ->> 'pending_cutoff')::timestamptz
     and v_run_id is distinct from v_watermark ->> 'last_successful_run_id'
  then
    v_watermark := v_watermark || jsonb_build_object(
      'last_successful_cutoff', v_watermark ->> 'pending_cutoff',
      'last_successful_run_id', v_run_id,
      'last_full_cutoff', case when v_watermark ->> 'pending_mode' = 'full'
        then v_watermark ->> 'pending_cutoff' else v_watermark ->> 'last_full_cutoff' end);
  end if;

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
  -- dead worker, not a running rebuild, and must not suppress ARM 3 forever.
  v_in_flight := coalesce(v_status, '') in ('running', 'queued')
                 and v_op_seen_at is not null
                 and v_op_seen_at >= v_now - make_interval(days => c_floor_days);

  -- ======================================================================
  -- ARM 2 - CHAINED RECONCILE, evaluated FIRST. An unreconciled completed run must be
  -- reconciled before ARM 1 is allowed to overwrite the operation object with a fresh
  -- 'queued' state and a new run_id.
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
    -- First run and every successful seven-day interval retain full convergence.
    v_full := v_watermark ->> 'last_full_cutoff' is null
      or (v_watermark ->> 'last_full_cutoff')::timestamptz <= v_cutoff - interval '7 days';
    v_since := case when v_full then null
      else (v_watermark ->> 'last_successful_cutoff')::timestamptz end;
    v_state := jsonb_build_object(
      'status',         'queued',
      'cursor',         0,
      'params',         jsonb_build_object('force_restart', true,
        'watermark_protocol', 1, 'changed_since', v_since,
        'changed_cutoff', v_cutoff, 'rebuild_mode', case when v_full then 'full' else 'incremental' end),
      'started_at',     v_now::text,
      'updated_at',     v_now::text,
      'progress',       '{}'::jsonb,
      'run_id',         gen_random_uuid()::text,
      'queue_position', (extract(epoch from v_now) * 1000)::bigint,
      'requested_by',   'pg_cron'
    );

    v_watermark := v_watermark || jsonb_build_object(
      'pending_run_id', v_state ->> 'run_id', 'pending_cutoff', v_cutoff,
      'pending_mode', case when v_full then 'full' else 'incremental' end);
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
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
    perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    v_change_locked := false;
    return;
  end if;

  -- The counts-only work retains its old BULK lock but never holds this new
  -- exclusive change-clock lock during its potentially long scan.
  perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
  v_change_locked := false;

  -- ======================================================================
  -- ARM 3 - THE FLOOR. Never while the rebuild is in flight: the recompute is
  -- justified only against membership the rebuild has finished changing.
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

  -- Resume only a walk begun under this exact operation state. Any other state (a new
  -- run, a resumed run, a different arm) may have changed membership behind the cursor.
  v_walk := v_marker -> 'reconcile_walk';
  if jsonb_typeof(v_walk) = 'object'
     and v_walk ->> 'reason' = v_reason
     and v_walk ->> 'run_id' is not distinct from v_run_id
     and v_walk ->> 'trigger_status' is not distinct from v_status
     and (v_walk ->> 'op_seen_at')::timestamptz is not distinct from v_op_seen_at
  then
    v_after        := (v_walk ->> 'after_id')::uuid;
    v_written      := coalesce((v_walk ->> 'rows_written')::bigint, 0);
    v_walk_started := v_walk ->> 'started_at';
  else
    v_walk_started := v_now::text;
  end if;

  -- Ordered primary-key chunks, never one array of every group.
  loop
    exit when clock_timestamp() - statement_timestamp() >= c_pass_budget;

    select array_agg(s.id order by s.id)
      into v_chunk_ids
    from (
      select sg.id
      from public.style_groups sg
      where v_after is null or sg.id > v_after
      order by sg.id
      limit c_chunk
    ) s;

    if v_chunk_ids is null then
      v_walk_done := true;
      exit;
    end if;

    v_written := v_written + coalesce(public.refresh_style_group_counts_batch(v_chunk_ids), 0);
    v_after   := v_chunk_ids[array_length(v_chunk_ids, 1)];
  end loop;

  -- Re-read under the same advisory lock before stamping. The reconcile above can run for
  -- a long time; writing back the object read before it would discard any concurrent
  -- change made by a writer that does not take this lock.
  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);
  v_marker := case when jsonb_typeof(v_current -> c_marker) = 'object'
                   then v_current -> c_marker
                   else '{}'::jsonb end;

  if v_walk_done then
    v_marker := (v_marker - 'reconcile_walk') || jsonb_build_object(
      -- When the walk began, so a change during a multi-pass walk stays inside the floor.
      'last_reconciled_at',            v_walk_started,
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
    );
  else
    v_marker := v_marker || jsonb_build_object('reconcile_walk', jsonb_build_object(
      'reason',         v_reason,
      'run_id',         v_run_id,
      'trigger_status', v_status,
      'op_seen_at',     v_op_seen_at,
      'after_id',       v_after,
      'rows_written',   v_written,
      'started_at',     v_walk_started
    ));
  end if;

  v_current := jsonb_set(v_current, array[c_marker], v_marker, true);

  -- Other callers of this queue serialize through the transaction-scoped BULK
  -- lock, which remains held during counts. Preserve a new pending run even if
  -- an external state writer does not use that lock.
  if v_current -> c_watermark ->> 'pending_run_id'
       is not distinct from v_watermark ->> 'pending_run_id' then
    v_current := jsonb_set(v_current, array[c_watermark], v_watermark, true);
  end if;
  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_current, now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;
exception
  when query_canceled or assert_failure or others then
    if v_change_locked then
      perform pg_advisory_unlock(hashtext('style-group-change-clock-2421'));
    end if;
    raise;
end;
$function$;

-- Idempotent: a job missing on a preview branch is reported and skipped, as in the
-- cadence migration 20261011175808. Schedules are unchanged.
do $jobs$
declare
  v_target record;
  v_job record;
  v_found integer;
begin
  for v_target in
    select * from (values
      ('refresh-style-guide-matviews',
       'set local statement_timeout = ''10min''; select public.refresh_style_guide_matviews_job()'),
      ('refresh-style-guide-library-default-snapshot',
       'set local statement_timeout = ''10min''; select public.refresh_style_guide_library_default_snapshot()')
    ) as t(jobname, command)
  loop
    v_found := 0;
    for v_job in select jobid from cron.job where jobname = v_target.jobname loop
      perform cron.alter_job(job_id := v_job.jobid, command := v_target.command);
      v_found := v_found + 1;
    end loop;
    if v_found = 0 then
      raise notice 'cron job % not found; skipped', v_target.jobname;
    end if;
  end loop;
end
$jobs$;
