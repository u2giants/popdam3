-- PopSG background work: warm less often, rebuild the browse snapshot only on change
-- (u2giants/popdam3#804, task 4).
-- derived-from: 20261105165947, 20261022234252
--
-- Measured in production, read-only, 2026-11-11 (pg_stat_statements since 2026-11-06):
--   prewarm-style-guide-search            1,440 calls, 5,124 s  (~1,040 s/day)
--   refresh-style-guide-library-default-snapshot rebuilt every 6 hours with unchanged
--   source signatures (41-80 s each, 4 per day).
--
-- 1. Snapshot: the 6-hour maximum-staleness rebuild is removed. The change signature
--    already covers every way the sources can change: per-table insert/update/delete
--    counters, the table file number (TRUNCATE, rewrite) and postmaster start time
--    (restart). A crash that discards the counters also changes the signature, because
--    the stored counters no longer match the reset ones. Since shared-db 20261111132448
--    (#6046) a crawl no longer rewrites unchanged rows, so an unchanged signature now
--    means an unchanged library. The hourly throttle for search-document-only changes
--    is kept exactly as before.
--
-- 2. Prewarm: same function, same relations, every 15 minutes instead of every 5.
--    With crawl churn gone the pages stay in the operating-system cache between runs
--    (run time fell from ~3.6 s to ~1.5-2.5 s). Offset to minute 4 so it never starts
--    in the same minute as the snapshot job (*/15).

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

  if v_last is not null
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

do $cron$
declare
  v_job_id bigint;
begin
  select jobid into strict v_job_id from cron.job where jobname = 'prewarm-style-guide-search';
  perform cron.alter_job(job_id => v_job_id, schedule => '4-59/15 * * * *');
end;
$cron$;
