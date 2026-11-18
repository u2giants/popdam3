-- u2giants/popdam3#1037 Step 7 follow-up (claim popcre/shared-db#6675): the word-form backfill
-- from 20261218084203 timed out in production at 90 s on its first 20,000-row batch (every row
-- also writes the new GIN index). Smaller batches, more often: 2,500 rows every 30 seconds,
-- each run bounded at 25 s, so a run never holds its row locks for long. About 75 runs fill the
-- 183k rows. Same function name and contract; the job still unschedules itself when done.
-- derived-from: 20261218084203
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
set local search_path=pg_catalog,public,extensions;

create or replace function public.dam_search_tsv_en_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  n integer;
begin
  update public.dam_search_keys k
     set search_tsv_en = public.dam_search_tsv_en(k.search_tsv)
    from (select d.document_type, d.entity_id
            from public.dam_search_keys d
           where d.search_tsv_en is null
           limit 2500
           for update skip locked) x
   where k.document_type = x.document_type and k.entity_id = x.entity_id;
  get diagnostics n = row_count;
  if n = 0 then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dam-search-tsv-en-backfill';
  end if;
  return n;
end;
$function$;
revoke all on function public.dam_search_tsv_en_backfill() from public, anon, authenticated, service_role;

do $cron$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dam-search-tsv-en-backfill';
  if exists (select 1 from public.dam_search_keys k where k.search_tsv_en is null) then
    perform cron.schedule('dam-search-tsv-en-backfill', '30 seconds',
      $job$set statement_timeout = '25s'; select public.dam_search_tsv_en_backfill()$job$);
  end if;
end;
$cron$;

commit;
