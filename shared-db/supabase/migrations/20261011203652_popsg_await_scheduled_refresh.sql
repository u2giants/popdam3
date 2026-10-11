-- Issue #3458; claim #4200. PopDAM #335: await the existing successful
-- scheduler refresh instead of running a full concurrent refresh in an 8s RPC.
-- derived-from: 20260917005221
-- No scheduler, statement timeout, matview, source data, or legacy RPC is changed.
-- Supports existing */15 (20-minute wait) and #4192 hourly at :07 (65-minute
-- wait), each with at most two extra minutes for a qualifying in-flight job.
create or replace function public.await_style_guide_matview_refresh(p_run_id uuid)
returns table (ready boolean, refreshed_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
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
     and regexp_replace(lower(regexp_replace(j.command, '[[:space:]]', '', 'g')), ';$', '') = 'selectpublic.refresh_style_guide_matviews()';
  if v_job is null then
    raise exception 'The existing PopSG refresh scheduler is unavailable or its command changed';
  end if;
  -- The no-argument scheduler command resolves to the two-default-argument
  -- overload, not a zero-argument function. Pin the live, reviewed body so
  -- future drift cannot silently weaken what a successful cron run proves.
  if to_regprocedure('public.refresh_style_guide_matviews()') is not null
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
         and p.prosecdef and p.pronargdefaults = 2
         and md5(p.prosrc) = '52b676f90e4500dc323c2f9e6e6f3c97') then
    raise exception 'The scheduled PopSG refresh contract changed';
  end if;
  if v_start is null then
    v_start := clock_timestamp();
    update public.style_guide_crawl_runs
       set refresh_started_at = v_start, lifecycle_state = 'refreshing'
     where id = p_run_id;
  end if;
  -- A refresh started before this crawl entered refresh is never evidence.
  -- cron.job_run_details has a sequential history scan; existing pg_cron
  -- retention keeps this small. No index on extension-owned relations is assumed.
  -- Completion of a cron run proves both matviews refreshed successfully.
  select max(d.end_time) into v_finished from cron.job_run_details d
   where d.jobid = v_job and d.status = 'succeeded'
     and d.start_time >= greatest(v_start, v_ingest)
     and d.end_time >= d.start_time;
  if v_finished is null and clock_timestamp() - v_start > make_interval(mins => v_wait_minutes) then
    -- A qualifying job may still be running. Allow only the existing two-minute
    -- database execution budget, with a schedule-dependent absolute wait cap. A hung
    -- run can never turn this into unbounded polling; no timeout is changed.
    select exists (select 1 from cron.job_run_details d
      where d.jobid = v_job and d.status in ('starting', 'connecting', 'sending', 'running')
        and d.end_time is null and d.start_time >= greatest(v_start, v_ingest)
        and d.start_time >= clock_timestamp() - interval '2 minutes') into v_inflight;
    if not v_inflight or clock_timestamp() - v_start > make_interval(mins => v_wait_minutes + 2) then
      raise exception 'No successful scheduled PopSG refresh within the bounded wait window';
    end if;
  end if;
  -- Never stamp refresh_completed_at here: the existing search-only step must
  -- drain search synchronization before the caller can complete the crawl.
  return query select v_finished is not null, v_finished;
end;
$function$;
comment on function public.await_style_guide_matview_refresh(uuid) is
  'Issue #3458 / PopDAM #335. Service-only bounded wait for successful existing cron refresh begun after crawl refresh_started_at. ready=false means retry (30s); ready=true allows the existing search-only RPC. Never marks a crawl complete, changes scheduler configuration, or refreshes in the API request.';
revoke all on function public.await_style_guide_matview_refresh(uuid) from public, anon, authenticated;
grant execute on function public.await_style_guide_matview_refresh(uuid) to service_role;

do $verify$
begin
  if to_regprocedure('public.refresh_style_guide_matviews()') is not null
     or not exists (select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
         and p.prosecdef and p.pronargdefaults = 2
         and md5(p.prosrc) = '52b676f90e4500dc323c2f9e6e6f3c97') then
    raise exception 'The existing scheduled PopSG refresh contract is not present';
  end if;
  if not has_function_privilege('service_role', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or has_function_privilege('public', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or has_function_privilege('anon', 'public.await_style_guide_matview_refresh(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.await_style_guide_matview_refresh(uuid)', 'execute') then
    raise exception 'PopSG scheduled refresh wait privileges are incorrect';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
