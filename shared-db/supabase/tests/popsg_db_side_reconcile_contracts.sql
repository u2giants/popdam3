-- Issue #3458 contract tests: the PopSG retire step runs as a database job
-- (no PostgREST 8 s ceiling) and keeps the ratio guard.
--
-- One transaction, rolled back; no fixture survives.

begin;

create or replace function pg_temp.mk_file3458(p_root text, p_run uuid, p_path text)
returns uuid language sql as $$
  insert into public.style_guide_files
    (crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, tag_names, tag_search_text)
  values
    (p_run, p_root, 'TestLicensor/' || p_path, 'dir/' || p_root, p_path, replace(p_path, '.pdf', ''),
     'pdf', lower(p_path), 'TestProperty', 'TestGuide',
     1024, timestamptz '2026-01-01 00:00:00+00', true, array['alpha'], 'alpha')
  returning id;
$$;

do $contracts$
declare
  c_old  constant uuid := '00000000-0000-4000-8000-000000003401';
  c_run  constant uuid := '00000000-0000-4000-8000-000000003405';
  c_bad  constant uuid := '00000000-0000-4000-8000-000000003409';
  v_i integer;
  v_run record;
begin
  -- 1. privileges: request is service-role only; the job is not callable by API roles
  if has_function_privilege('anon', 'public.request_sg_reconcile(uuid,text[])', 'execute')
     or has_function_privilege('authenticated', 'public.request_sg_reconcile(uuid,text[])', 'execute')
     or not has_function_privilege('service_role', 'public.request_sg_reconcile(uuid,text[])', 'execute')
     or has_function_privilege('service_role', 'public.run_requested_sg_reconciles()', 'execute')
     or has_function_privilege('authenticated', 'public.run_requested_sg_reconciles()', 'execute') then
    raise exception '3458 contract 1: grants drifted';
  end if;
  if pg_get_functiondef('public.count_style_guide_crawl_seen(text,uuid)'::regprocedure) ~ 'join public\.style_guide_files' then
    raise exception '3458 contract 1: count_style_guide_crawl_seen rejoins style_guide_files';
  end if;

  -- fixtures: 120 files seen by c_run, 70 stale from c_old (more than one 50-row batch)
  insert into public.style_guide_crawl_runs (id, status, files_found) values
    (c_old, 'pending', 70), (c_run, 'pending', 120), (c_bad, 'pending', 1);
  for v_i in 1..70 loop perform pg_temp.mk_file3458('R3458', c_old, format('old%s.pdf', v_i)); end loop;
  for v_i in 1..120 loop perform pg_temp.mk_file3458('R3458', c_run, format('seen%s.pdf', v_i)); end loop;

  if public.count_style_guide_crawl_seen('R3458', c_run) <> 120 then
    raise exception '3458 contract 2: accepted count wrong';
  end if;

  -- 2. request, then the job retires all 70 stale files across several batches
  perform public.request_sg_reconcile(c_run, array['R3458']);
  perform public.run_requested_sg_reconciles();
  select * into v_run from public.style_guide_crawl_runs where id = c_run;
  if v_run.reconcile_completed_at is null or v_run.reconcile_job_error is not null
     or v_run.files_deactivated <> 70
     or exists (select 1 from public.style_guide_files where root_label = 'R3458' and crawl_run_id = c_old and is_active)
     or (select count(*) from public.style_guide_files where root_label = 'R3458' and is_active) <> 120 then
    raise exception '3458 contract 2: job did not retire exactly the stale rows (deactivated=%, error=%)',
      v_run.files_deactivated, v_run.reconcile_job_error;
  end if;

  -- 3. a second tick is a no-op for a finished run
  if public.run_requested_sg_reconciles() <> 0 then
    raise exception '3458 contract 3: finished run picked up again';
  end if;

  -- 4. ratio guard still parks a suspicious partial crawl; nothing is retired
  perform pg_temp.mk_file3458('R3458', c_bad, 'bad1.pdf');
  perform public.request_sg_reconcile(c_bad, array['R3458']);
  perform public.run_requested_sg_reconciles();
  select * into v_run from public.style_guide_crawl_runs where id = c_bad;
  if v_run.lifecycle_state <> 'attention_required' or v_run.reconcile_completed_at is not null
     or (select count(*) from public.style_guide_files where root_label = 'R3458' and is_active) <> 121 then
    raise exception '3458 contract 4: guard did not park the run (state=%)', v_run.lifecycle_state;
  end if;

  raise notice 'issue #3458 PopSG database-side reconcile contracts: all 4 checks passed';
end
$contracts$;

rollback;
