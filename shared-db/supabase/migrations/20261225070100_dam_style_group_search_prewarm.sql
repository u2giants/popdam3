-- popcre/shared-db#6923 for u2giants/popdam3#1252: typed DAM style-group searches take 5-18 s
-- on their first call and 1.3-2.3 s on the immediate repeat (signed-in viewer, quiet database,
-- Nov 20 2026). EXPLAIN (ANALYZE, BUFFERS) of search_dam_documents: ~13,600 disk reads per cold
-- call; the largest are the style-group picture vectors (full exact scan), the style-group
-- text-meaning HNSW, style_groups, and the dam_search_keys word and trigram indexes. These pages
-- fall out of memory between searches on this 38 GB database. A manual pg_prewarm 'read' of
-- the set below (477 MB, 2.8 s cold / 0.9 s warm) brought fresh-word searches to ~2 s.
-- Same pattern as 20261022234252 (PopSG): 'read' mode fills the operating-system page cache
-- only, never shared_buffers, so other applications' pages are not evicted. Read-only: no rows,
-- grants on data, or search results change. Minute offset 7 avoids the PopSG prewarm (4) and
-- */15 jobs. dam_search_keys heap, path trigram and asset heaps are left out on purpose (size).

create extension if not exists pg_prewarm with schema extensions;

create function dam.prewarm_style_group_search()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $prewarm$
begin
  perform extensions.pg_prewarm('dam.search_group_vectors'::regclass, 'read');
  perform extensions.pg_prewarm('dam.search_group_vectors_pkey'::regclass, 'read');
  perform extensions.pg_prewarm('dam.search_text_vectors'::regclass, 'read');
  perform extensions.pg_prewarm('dam.search_text_vectors_pkey'::regclass, 'read');
  perform extensions.pg_prewarm('dam.search_text_vectors_style_group_hnsw'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_groups'::regclass, 'read');
  perform extensions.pg_prewarm('public.style_groups_pkey'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_documents_pkey'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_documents_default_flag_cover_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_pkey'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_tsv_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_tsv_en_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_title_trgm_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_program_trgm_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.dam_search_keys_customer_trgm_idx'::regclass, 'read');
  perform extensions.pg_prewarm('public.assets_style_group_id_active_idx'::regclass, 'read');
end
$prewarm$;

revoke all on function dam.prewarm_style_group_search() from public, anon, authenticated;
grant execute on function dam.prewarm_style_group_search() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'prewarm-dam-style-group-search'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'prewarm-dam-style-group-search',
    '7-59/10 * * * *',
    $cron_body$ select dam.prewarm_style_group_search() $cron_body$
  );
end;
$cron$;
