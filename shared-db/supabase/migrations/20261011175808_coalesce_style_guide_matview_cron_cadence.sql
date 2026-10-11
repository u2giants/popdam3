-- #4190 (popdam3 #293 DB half): coalesce the style-guide matview refresh cadence.
--
-- Schedule-only change. No function body or materialized view definition changes.
--
-- Measured 2026-10-11 (read-only, production, last 7 days of cron.job_run_details):
--   refresh-style-guide-matviews                  */15  672 runs, avg 14.6 s
--   refresh-style-guide-library-default-snapshot  */5  2016 runs, avg 45.1 s (~25 h DB time/week)
--   style_guide_search_sync_queue is empty (backlog drained by #3458 bounded refresh); the
--   source rows change essentially only during the nightly crawl, whose completion path
--   already refreshes the matviews on demand. The cron jobs stay as the safety net.
--
-- New cadence:
--   refresh-style-guide-matviews                  hourly at :07
--   refresh-style-guide-library-default-snapshot  every 15 minutes
--
-- Idempotent: alters every job row with that name. A missing job (e.g. a preview branch without the
-- scheduler rows) is reported with a NOTICE and skipped; production proof reads cron.job.
-- .github/live-proofs/3009.sql now accepts the old or new snapshot schedule.

do $cadence$
declare
  v_job record;
  v_found integer;
  v_target record;
begin
  for v_target in
    select * from (values
      ('refresh-style-guide-matviews', '7 * * * *'),
      ('refresh-style-guide-library-default-snapshot', '*/15 * * * *')
    ) as t(jobname, schedule)
  loop
    v_found := 0;
    -- jobname is unique only together with username, so alter every row of that name.
    for v_job in select jobid from cron.job where jobname = v_target.jobname loop
      perform cron.alter_job(job_id := v_job.jobid, schedule := v_target.schedule);
      v_found := v_found + 1;
    end loop;
    if v_found = 0 then
      raise notice 'cron job % not found; skipped', v_target.jobname;
    end if;
  end loop;
end
$cadence$;
