-- u2giants/popdam3#1037 Step 7 follow-up (claim popcre/shared-db#6679). Fix for 20261218084403:
-- its 40-second stop test chained two operator(...) forms without parentheses, which parse left
-- to right ("(now > started) + interval") and failed after the first 250-row chunk of every run.
-- The test is now parenthesised; everything else is identical (commit every 250 rows, stop after
-- 40 s, pg_cron bare CALL every minute, unschedules itself when nothing is left).
-- No SET clause and no SECURITY DEFINER: either would forbid COMMIT inside the procedure; every
-- name is schema-qualified instead. Only the job owner runs it.
-- derived-from: 20261218084403
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
set local search_path=pg_catalog,public,extensions;

create or replace procedure public.dam_search_tsv_en_backfill_run()
language plpgsql
as $procedure$
declare
  n integer;
  started timestamptz := pg_catalog.clock_timestamp();
begin
  perform pg_catalog.set_config('lock_timeout', '2s', false);
  loop
    update public.dam_search_keys k
       set search_tsv_en = public.dam_search_tsv_en(k.search_tsv)
      from (select d.document_type, d.entity_id
              from public.dam_search_keys d
             where d.search_tsv_en is null
             limit 250
             for update skip locked) x
     where k.document_type operator(pg_catalog.=) x.document_type
       and k.entity_id operator(pg_catalog.=) x.entity_id;
    get diagnostics n = row_count;
    commit;
    if n = 0 then
      perform cron.unschedule(j.jobid) from cron.job j where j.jobname operator(pg_catalog.=) 'dam-search-tsv-en-backfill';
      commit;
      exit;
    end if;
    exit when pg_catalog.clock_timestamp() operator(pg_catalog.>) (started operator(pg_catalog.+) interval '40 seconds');
  end loop;
end;
$procedure$;
revoke all on procedure public.dam_search_tsv_en_backfill_run() from public, anon, authenticated, service_role;

do $cron$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dam-search-tsv-en-backfill';
  if exists (select 1 from public.dam_search_keys k where k.search_tsv_en is null) then
    perform cron.schedule('dam-search-tsv-en-backfill', '* * * * *',
      $job$call public.dam_search_tsv_en_backfill_run()$job$);
  end if;
end;
$cron$;

commit;
