-- Issue #5758 (handoff item A): run the first real change_log rotation tonight,
-- Re-versioned from 20261106152843 (parked after main-staleness refusals, never applied).
-- 03:00 UTC Sat Nov 7 2026 = 10:00 PM EST Fri Nov 6, instead of waiting for the
-- weekly Sunday job. One shot: the job unschedules itself after the rotation.
-- If this migration lands after the slot, schedule nothing (a "0 3 7 11 *" job
-- would otherwise fire a year from now); Sunday's weekly job covers it.
do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'coldlion-change-log-rotation-once' loop
    perform cron.unschedule(v_job_id);
  end loop;
  if now() < timestamptz '2026-11-07 02:55:00+00' then
    perform cron.schedule(
      'coldlion-change-log-rotation-once',
      '0 3 7 11 *',
      $cron_body$ select * from coldlion.rotate_change_log(false); select cron.unschedule('coldlion-change-log-rotation-once') $cron_body$
    );
  end if;
end;
$cron$;
