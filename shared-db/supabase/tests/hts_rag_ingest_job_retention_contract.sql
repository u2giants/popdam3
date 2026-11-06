-- #5758 Step 4: finished hts_rag ruling ingest jobs are kept 30 days; failures
-- and open work are never pruned; dry run deletes nothing; service_role only.
begin;

insert into hts_rag.hts_rag_ruling_ingest_jobs
  (id, ruling_number, source_environment, status, attempt_count, max_attempts, completed_at, created_at, updated_at)
values
  ('57580000-0000-4000-8000-0000000000a1', 'ZZ5758A', 'production', 'done',        1, 3, now() - interval '40 days', now() - interval '40 days', now() - interval '40 days'),
  ('57580000-0000-4000-8000-0000000000a2', 'ZZ5758B', 'production', 'done',        1, 3, now() - interval '10 days', now() - interval '10 days', now() - interval '10 days'),
  ('57580000-0000-4000-8000-0000000000a3', 'ZZ5758C', 'production', 'dead_letter', 3, 3, now() - interval '90 days', now() - interval '90 days', now() - interval '90 days'),
  ('57580000-0000-4000-8000-0000000000a4', 'ZZ5758D', 'production', 'pending',     0, 3, null,                       now() - interval '90 days', now() - interval '90 days');

do $retention$
declare v bigint;
begin
  if has_function_privilege('anon', 'hts_rag.prune_ruling_ingest_jobs(boolean)', 'execute')
     or has_function_privilege('authenticated', 'hts_rag.prune_ruling_ingest_jobs(boolean)', 'execute')
     or not has_function_privilege('service_role', 'hts_rag.prune_ruling_ingest_jobs(boolean)', 'execute') then
    raise exception 'prune_ruling_ingest_jobs must be executable by service_role only';
  end if;
  v := hts_rag.prune_ruling_ingest_jobs();
  if v < 1 or (select count(*) from hts_rag.hts_rag_ruling_ingest_jobs where ruling_number like 'ZZ5758%') <> 4 then
    raise exception 'dry run must count and delete nothing (counted %)', v;
  end if;
  perform hts_rag.prune_ruling_ingest_jobs(false);
  if exists (select 1 from hts_rag.hts_rag_ruling_ingest_jobs where ruling_number = 'ZZ5758A') then
    raise exception 'a done job older than 30 days survived';
  end if;
  if (select count(*) from hts_rag.hts_rag_ruling_ingest_jobs where ruling_number in ('ZZ5758B','ZZ5758C','ZZ5758D')) <> 3 then
    raise exception 'a recent done, dead_letter or pending job was pruned';
  end if;
  if not exists (select 1 from cron.job where jobname = 'hts-rag-ingest-jobs-retention' and schedule = '15 8 * * 0') then
    raise exception 'weekly retention cron job missing';
  end if;
  raise notice 'hts ingest-job retention contracts passed';
end
$retention$;

rollback;
