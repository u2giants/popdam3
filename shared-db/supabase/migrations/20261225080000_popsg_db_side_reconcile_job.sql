-- popcre/shared-db#3458 (u2giants/popdam3#107): the PopSG stale-file retire
-- step runs through PostgREST, whose 8 s statement ceiling cannot be lifted by
-- a function-level SET (scripts/test_style_cron_timeout_loops.py). Right after
-- the nightly ingest the database is I/O-bound, and on 2026-11-20 even a 50-row
-- reconcile_stale_sg_files_batch call and the count_style_guide_crawl_seen join
-- timed out (crawl 3dd3614c, 20:28 UTC). Both bounded-shape fixes
-- (20261225030000, 20261225060000) are live and were not enough.
--
-- The retire step now runs inside the database:
--   * public.request_sg_reconcile(run, roots): the Edge function records the
--     request (one-row update, service_role only) and polls the run row.
--   * public.run_requested_sg_reconciles(): pg_cron every minute, with
--     SET LOCAL statement_timeout = 10min (the pattern that does lift the
--     ceiling), calls the unchanged ratio-guarded reconcile_stale_sg_files_batch
--     in a loop until done. A guard refusal still parks the run as
--     attention_required; an error is stored in reconcile_job_error.
--   * count_style_guide_crawl_seen counts the active-only side table alone
--     (contract-checked to hold no inactive file), as preview_stale_sg_files
--     already does since 20261222090000.
-- derived-from: 20261111132448
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';

alter table public.style_guide_crawl_runs
  add column if not exists reconcile_requested_at timestamptz,
  add column if not exists reconcile_root_labels text[],
  add column if not exists reconcile_job_error text;

comment on column public.style_guide_crawl_runs.reconcile_requested_at is
  '#3458: set by request_sg_reconcile; the sg-reconcile-requested cron job retires stale files for this run.';
comment on column public.style_guide_crawl_runs.reconcile_job_error is
  '#3458: last error from run_requested_sg_reconciles for this run; the crawl fails on it.';

do $guard$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.count_style_guide_crawl_seen(text,uuid)')
       and md5(p.prosrc) = 'c98d01c090eb708d2101e6f4a9d4d5fe') then
    raise exception 'count_style_guide_crawl_seen source differs from production; reconcile rather than overwrite';
  end if;
end;
$guard$;

create or replace function public.count_style_guide_crawl_seen(p_root_label text, p_run_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- #3458: the side table holds one row per active file only.
  select count(*)
    from public.style_guide_file_crawl_seen s
   where s.root_label = p_root_label
     and s.crawl_run_id = p_run_id;
$function$;

create or replace function public.request_sg_reconcile(p_run_id uuid, p_root_labels text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_run_id is null or coalesce(cardinality(p_root_labels), 0) = 0 then
    raise exception 'request_sg_reconcile requires a run id and at least one root label';
  end if;
  update public.style_guide_crawl_runs
     set reconcile_requested_at = coalesce(reconcile_requested_at, now()),
         reconcile_root_labels = p_root_labels,
         reconcile_job_error = null,
         lifecycle_state = case when lifecycle_state in ('completed','failed','attention_required')
                                then lifecycle_state else 'reconciling' end
   where id = p_run_id;
  if not found then
    raise exception 'crawl run % does not exist', p_run_id;
  end if;
end;
$function$;

create or replace function public.run_requested_sg_reconciles()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run record;
  v_root text;
  v_batch record;
  v_calls integer;
  v_runs integer := 0;
  v_parked boolean;
begin
  -- One runner at a time; a still-running minute simply skips the next tick.
  if not pg_try_advisory_xact_lock(hashtext('sg-reconcile-requested-3458')) then
    return 0;
  end if;

  for v_run in
    select r.id, r.reconcile_root_labels
      from public.style_guide_crawl_runs r
     where r.reconcile_requested_at is not null
       and r.reconcile_completed_at is null
       and r.reconcile_job_error is null
       and r.lifecycle_state not in ('completed','failed','attention_required')
     order by r.reconcile_requested_at
  loop
    v_runs := v_runs + 1;
    v_parked := false;
    begin
      foreach v_root in array v_run.reconcile_root_labels loop
        v_calls := 0;
        loop
          v_calls := v_calls + 1;
          select * into v_batch
            from public.reconcile_stale_sg_files_batch(v_root, v_run.id, 50, 0.5);
          if v_batch.guard_state is distinct from 'ok' then
            v_parked := true;   -- the batch function parked the run itself
            exit;
          end if;
          exit when v_batch.done;
          if v_calls >= 2000 then
            raise exception 'root % still has % stale rows after % calls', v_root, v_batch.remaining, v_calls;
          end if;
        end loop;
        exit when v_parked;
      end loop;

      if not v_parked then
        update public.style_guide_crawl_runs
           set reconcile_completed_at = coalesce(reconcile_completed_at, now())
         where id = v_run.id;
      end if;
    exception when others then
      update public.style_guide_crawl_runs
         set reconcile_job_error = left(sqlerrm, 500)
       where id = v_run.id;
    end;
  end loop;
  return v_runs;
end;
$function$;

revoke all on function public.request_sg_reconcile(uuid, text[]) from public, anon, authenticated;
grant execute on function public.request_sg_reconcile(uuid, text[]) to service_role;
revoke all on function public.run_requested_sg_reconciles() from public, anon, authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sg-reconcile-requested';
    perform cron.schedule(
      'sg-reconcile-requested',
      '* * * * *',
      'set local statement_timeout = ''10min''; select public.run_requested_sg_reconciles()');
  else
    raise notice 'pg_cron not installed; sg-reconcile-requested not scheduled';
  end if;
end
$cron$;

commit;
