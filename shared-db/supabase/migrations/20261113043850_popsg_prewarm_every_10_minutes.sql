-- PopSG search prewarm: every 10 minutes instead of 15 (u2giants/popdam3#804, task 1 step 4).
-- derived-from: 20261111162335
--
-- Clean reading, popdam3 run 43365823149 (2026-11-12, 11:29 PM EST): PopSG guides p95 4,106 ms
-- against the 3,000 ms bar. The prewarm is the only lever in the handoff for it; the function,
-- its relations and the snapshot job are unchanged. Minute offset 4 is kept so the run never
-- starts in the same minute as the snapshot job (*/15).

select cron.alter_job(
  job_id => (select jobid from cron.job where jobname = 'prewarm-style-guide-search'),
  schedule => '4-59/10 * * * *'
);
