-- Issue #4210; exact-object claim #4662.
-- After 20261022155012 a signed-in "disney" Guides search still hit 57014 at 8.04 s on its
-- first attempt and finished in 3.98 s on the immediate retry. The remaining cost is disk
-- reads of style_guide_search_documents (249 MB heap, 55 MB search index) that fall out of
-- memory between searches on this compute. Every 5 minutes, read the relations the search
-- uses into the operating-system page cache with pg_prewarm 'read' mode, which does not
-- occupy shared_buffers and so does not evict other applications' pages. Read-only: no
-- rows, grants or search results change.

create extension if not exists pg_prewarm with schema extensions;

create function public.prewarm_style_guide_search()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $prewarm$
begin
  perform extensions.pg_prewarm('public.style_guide_search_documents'::regclass, 'read');
  perform extensions.pg_prewarm('public.idx_sg_search_documents_search_vector'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_guide_file_preview_state'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_guide_file_preview_state_pkey'::regclass, 'read');
end
$prewarm$;

revoke all on function public.prewarm_style_guide_search() from public, anon, authenticated;
grant execute on function public.prewarm_style_guide_search() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'prewarm-style-guide-search'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'prewarm-style-guide-search',
    '*/5 * * * *',
    $cron_body$ select public.prewarm_style_guide_search() $cron_body$
  );
end;
$cron$;
