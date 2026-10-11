-- #3458/#335: fixture-only behavior tests, rolled back. No full refresh runs.
-- pg_cron owns its job/log tables under supabase_admin, so fixtures must not
-- assume postgres can write them. Execute the installed function body against
-- temporary scheduler tables; real function privileges stay asserted below.
begin;
create temporary table popsg_test_jobs (
  jobid bigint primary key, jobname text, command text, active boolean,
  username text, database text, schedule text default '*/15 * * * *'
);
create temporary table popsg_test_job_runs (
  jobid bigint, runid bigint, status text, start_time timestamptz, end_time timestamptz
);
-- Rebind only scheduler relations and the function name; all controller logic
-- is taken from the installed production-bound function, never reimplemented.
do $bind$
begin
  execute replace(replace(replace(
    pg_get_functiondef('public.await_style_guide_matview_refresh(uuid)'::regprocedure),
    'public.await_style_guide_matview_refresh', 'pg_temp.await_style_guide_matview_refresh'),
    'cron.job_run_details', 'pg_temp.popsg_test_job_runs'),
    'cron.job', 'pg_temp.popsg_test_jobs');
end
$bind$;
do $test$
declare
  v_run uuid;
  v_expired uuid;
  v_job bigint;
  v_ready boolean;
  v_stamp timestamptz;
  v_start timestamptz;
  v_original_command text;
  v_failed boolean;
begin
  v_job := 9;
  insert into pg_temp.popsg_test_jobs values (v_job, 'refresh-style-guide-matviews', ' SELECT public.refresh_style_guide_matviews(); ', true, 'postgres', current_database(), '*/15 * * * *');
  -- Isolate scheduler evidence only inside this rolled-back disposable test.
  delete from pg_temp.popsg_test_job_runs where jobid = v_job;
  update pg_temp.popsg_test_jobs set active = true, username = 'postgres', database = current_database(),
    command = ' SELECT public.refresh_style_guide_matviews(); ' where jobid = v_job;
  insert into public.style_guide_crawl_runs (status, lifecycle_state, ingest_completed_at)
    values ('running', 'reconciling', clock_timestamp() - interval '1 minute') returning id into v_run;
  select ready, refreshed_at into v_ready, v_stamp from pg_temp.await_style_guide_matview_refresh(v_run);
  if v_ready or v_stamp is not null then raise exception 'Pending scheduler was falsely accepted'; end if;
  select refresh_started_at into v_start from public.style_guide_crawl_runs where id = v_run;
  if v_start is null then raise exception 'Wait boundary was not persisted'; end if;
  insert into pg_temp.popsg_test_job_runs (jobid, runid, status, start_time, end_time)
    values (v_job, 1, 'succeeded', v_start - interval '1 second', v_start + interval '1 second');
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_run);
  if v_ready then raise exception 'Refresh begun before reconciliation was accepted'; end if;
  insert into pg_temp.popsg_test_job_runs (jobid, runid, status, start_time, end_time)
    values (v_job, 1, 'failed', v_start, clock_timestamp());
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_run);
  if v_ready then raise exception 'Failed scheduler was accepted'; end if;
  if (select refresh_started_at from public.style_guide_crawl_runs where id = v_run) <> v_start then
    raise exception 'Continuation reset the wait boundary';
  end if;
  insert into public.style_guide_crawl_runs (status, lifecycle_state, ingest_completed_at, refresh_started_at)
    values ('running', 'refreshing', clock_timestamp() - interval '22 minutes', clock_timestamp() - interval '21 minutes') returning id into v_expired;
  -- Remove the deliberately old-success fixture, which would be valid for the expired run.
  delete from pg_temp.popsg_test_job_runs where jobid = v_job and status = 'succeeded';
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_expired);
  exception when raise_exception then v_failed := sqlerrm = 'No successful scheduled PopSG refresh within the bounded wait window'; end;
  if not v_failed then raise exception 'An expired wait did not fail'; end if;
  -- The approved hourly cadence has its own bounded window, not the old 20 minutes.
  update pg_temp.popsg_test_jobs set schedule = '7 * * * *' where jobid = v_job;
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_expired);
  if v_ready then raise exception 'Hourly pending work was falsely completed'; end if;
  update public.style_guide_crawl_runs set ingest_completed_at = clock_timestamp() - interval '68 minutes',
    refresh_started_at = clock_timestamp() - interval '66 minutes' where id = v_expired;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_expired);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Hourly wait did not expire'; end if;
  insert into pg_temp.popsg_test_job_runs values (v_job, 20, 'running', clock_timestamp() - interval '1 minute', null);
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_expired);
  if v_ready then raise exception 'Hourly in-flight work was falsely completed'; end if;
  update public.style_guide_crawl_runs set refresh_started_at = clock_timestamp() - interval '68 minutes' where id = v_expired;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_expired);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Hourly in-flight work escaped its absolute cap'; end if;
  delete from pg_temp.popsg_test_job_runs where runid = 20;
  update pg_temp.popsg_test_jobs set schedule = '0 0 * * *' where jobid = v_job;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_run);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Unsupported cadence was accepted'; end if;
  update pg_temp.popsg_test_jobs set schedule = '*/15 * * * *' where jobid = v_job;
  update public.style_guide_crawl_runs set ingest_completed_at = clock_timestamp() - interval '22 minutes',
    refresh_started_at = clock_timestamp() - interval '21 minutes' where id = v_expired;
  -- A recent qualifying scheduler run in flight gets a bounded grace period.
  insert into pg_temp.popsg_test_job_runs (jobid, runid, status, start_time, end_time)
    values (v_job, 2, 'running', clock_timestamp() - interval '1 minute', null);
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_expired);
  if v_ready then raise exception 'In-flight work was falsely completed'; end if;
  update public.style_guide_crawl_runs set refresh_started_at = clock_timestamp() - interval '23 minutes' where id = v_expired;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_expired);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'In-flight work escaped the absolute wait cap'; end if;
  delete from pg_temp.popsg_test_job_runs where jobid = v_job and status = 'running';
  insert into pg_temp.popsg_test_job_runs (jobid, runid, status, start_time, end_time)
    values (v_job, 3, 'succeeded', v_start, v_start - interval '1 second');
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_run);
  if v_ready then raise exception 'Anomalous scheduler chronology was accepted'; end if;
  update pg_temp.popsg_test_jobs set command = 'select public.refresh_style_guide_matviews()' where jobid = v_job;
  select ready into v_ready from pg_temp.await_style_guide_matview_refresh(v_run);
  if v_ready then raise exception 'Pending lowercase/semicolon-free command was falsely completed'; end if;

  insert into pg_temp.popsg_test_job_runs (jobid, runid, status, start_time, end_time)
    values (v_job, 1, 'succeeded', v_start, clock_timestamp());
  select ready, refreshed_at into v_ready, v_stamp from pg_temp.await_style_guide_matview_refresh(v_run);
  if not v_ready or v_stamp is null then raise exception 'Fresh successful refresh was not accepted'; end if;
  if (select refresh_completed_at is not null from public.style_guide_crawl_runs where id = v_run) then
    raise exception 'Search synchronization was skipped by prematurely stamping completion';
  end if;
  update pg_temp.popsg_test_jobs set active = false where jobid = v_job;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_run);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Inactive scheduler was accepted'; end if;
  update pg_temp.popsg_test_jobs set active = true, command = 'select 1' where jobid = v_job;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(v_run);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Changed scheduler command was accepted'; end if;
  v_failed := false;
  begin perform pg_temp.await_style_guide_matview_refresh(null);
  exception when raise_exception then v_failed := true; end;
  if not v_failed then raise exception 'Missing run was accepted'; end if;
  if has_function_privilege('public', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or has_function_privilege('anon', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.await_style_guide_matview_refresh(uuid)', 'execute') then
    raise exception 'Service-only privilege contract failed';
  end if;
end
$test$;
rollback;
