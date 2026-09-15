-- Issue #2792 contract tests: PopSG stale reconciliation stays bounded in rows
-- READ and rows WRITTEN, with every #2212 guarantee preserved.
--
-- One transaction, rolled back; no fixture survives.

begin;

create or replace function pg_temp.mk_file2792(
  p_root text, p_run uuid, p_path text, p_active boolean default true
) returns uuid language sql as $$
  insert into public.style_guide_files
    (crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, tag_names, tag_search_text)
  values
    (p_run, p_root, 'TestLicensor/' || p_path, 'dir/' || p_root, p_path, replace(p_path, '.pdf', ''),
     'pdf', lower(p_path), 'TestProperty', 'TestGuide',
     1024, timestamptz '2026-01-01 00:00:00+00', p_active, array['alpha'], 'alpha')
  returning id;
$$;

do $contracts$
declare
  c_low    constant uuid := '00000000-0000-4000-8000-000000000001';
  c_run    constant uuid := '00000000-0000-4000-8000-000000000005';
  c_high   constant uuid := '00000000-0000-4000-8000-000000000009';
  c_guard  constant uuid := '00000000-0000-4000-8000-00000000000a';
  c_inacc  constant uuid := '00000000-0000-4000-8000-00000000000b';
  v_src text;
  v_preview record;
  v_batch record;
  v_i integer;
  v_total integer := 0;
  v_calls integer := 0;
  v_order uuid[] := array[]::uuid[];
  v_expected uuid[];
  v_ids_before uuid[];
  v_ids_after uuid[];
  v_run_before jsonb;
  v_run_after jsonb;
  v_docs integer;
begin
  -- -------------------------------------------------------------------------
  -- 1. signatures, least privilege, and the index the range scans rely on
  -- -------------------------------------------------------------------------
  if to_regprocedure('public.preview_stale_sg_files(text,uuid,numeric)') is null
     or to_regprocedure('public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)') is null then
    raise exception '2792 contract 1: a routine signature changed';
  end if;
  if has_function_privilege('authenticated', 'public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)', 'execute')
     or has_function_privilege('anon', 'public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.preview_stale_sg_files(text,uuid,numeric)', 'execute')
     or has_function_privilege('anon', 'public.preview_stale_sg_files(text,uuid,numeric)', 'execute')
     or not has_function_privilege('service_role', 'public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)', 'execute')
     or not has_function_privilege('service_role', 'public.preview_stale_sg_files(text,uuid,numeric)', 'execute') then
    raise exception '2792 contract 1: EXECUTE grants drifted from service-role only';
  end if;
  if to_regclass('public.idx_sgf_reconcile_root_active_run_id') is null then
    raise exception '2792 contract 1: idx_sgf_reconcile_root_active_run_id is missing';
  end if;

  -- 2. body shape: no id-ordered victim walk, advisory lock kept, cap is 2,000
  v_src := pg_get_functiondef('public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)'::regprocedure);
  if v_src !~ 'pg_advisory_xact_lock' then
    raise exception '2792 contract 2: advisory serialization was removed';
  end if;
  if v_src ~ 'is distinct from p_run_id' then
    raise exception '2792 contract 2: victims are still selected with IS DISTINCT FROM (full-root walk)';
  end if;
  if v_src !~ 'least\(coalesce\(p_batch_size, 500\), 500\)' then
    raise exception '2792 contract 2: per-call write cap is not 500';
  end if;
  if pg_get_functiondef('public.preview_stale_sg_files(text,uuid,numeric)'::regprocedure) !~ 'and f\.is_active;' then
    raise exception '2792 contract 2: preview no longer restricts its count to active rows';
  end if;
  if v_src !~ 'limit v_need' then
    raise exception '2792 contract 2: later batches no longer bound the run-active guard probe';
  end if;

  -- -------------------------------------------------------------------------
  -- fixtures: run ids chosen so stale rows sit on BOTH sides of the accepted
  -- run in uuid order, plus NULL-run rows
  -- -------------------------------------------------------------------------
  insert into public.style_guide_crawl_runs (id, status, files_found) values
    (c_low, 'pending', 10), (c_high, 'pending', 10), (c_run, 'pending', 6),
    (c_guard, 'pending', 1), (c_inacc, 'pending', 6);
  update public.style_guide_crawl_runs set inaccessible_roots = array['R2792'] where id = c_inacc;

  for v_i in 1..6 loop
    perform pg_temp.mk_file2792('R2792', c_run, format('seen%s.pdf', v_i));
  end loop;
  perform pg_temp.mk_file2792('R2792', c_high, 'h1.pdf');
  perform pg_temp.mk_file2792('R2792', c_low,  'l1.pdf');
  perform pg_temp.mk_file2792('R2792', c_high, 'h2.pdf');
  perform pg_temp.mk_file2792('R2792', c_low,  'l2.pdf');
  perform pg_temp.mk_file2792('R2792', c_run,  'n1.pdf');
  update public.style_guide_files set crawl_run_id = null
   where root_label = 'R2792' and relative_path = 'TestLicensor/n1.pdf';
  -- an already-inactive row must never be counted or rewritten
  perform pg_temp.mk_file2792('R2792', c_low, 'old.pdf', false);

  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, is_active, source_identity, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
         'TestGuide', f.directory_path, f.relative_path, f.filename, f.file_extension,
         f.tag_names, f.size_bytes, f.modified_at, true, md5(f.id::text),
         to_tsvector('simple', f.filename)
    from public.style_guide_files f
   where f.root_label = 'R2792' and f.is_active
  on conflict do nothing;

  -- expected continuation order: crawl_run_id asc nulls last, id
  select array_agg(id order by crawl_run_id nulls last, id) into v_expected
    from public.style_guide_files
   where root_label = 'R2792' and is_active and (crawl_run_id is null or crawl_run_id <> c_run);

  -- -------------------------------------------------------------------------
  -- 3. preview counts active rows only and mutates nothing
  -- -------------------------------------------------------------------------
  select * into v_preview from public.preview_stale_sg_files('R2792', c_run);
  if v_preview.active_total <> 11 or v_preview.run_active_total <> 6
     or v_preview.stale_candidates <> 5 or not v_preview.safe_to_reconcile then
    raise exception '2792 contract 3: preview active=% run=% stale=% safe=%',
      v_preview.active_total, v_preview.run_active_total, v_preview.stale_candidates, v_preview.safe_to_reconcile;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. guards inactivate NOTHING (low ratio, empty, inaccessible)
  -- -------------------------------------------------------------------------
  select array_agg(id order by id) into v_ids_before from public.style_guide_files where root_label = 'R2792' and is_active;

  update public.style_guide_files set crawl_run_id = c_guard
   where root_label = 'R2792' and relative_path = 'TestLicensor/seen1.pdf';
  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_guard, 2000);
  if v_batch.guard_state <> 'low_nonzero' or v_batch.deactivated <> 0 or v_batch.done then
    raise exception '2792 contract 4: low-ratio guard state=% deactivated=%', v_batch.guard_state, v_batch.deactivated;
  end if;
  if (select lifecycle_state from public.style_guide_crawl_runs where id = c_guard) <> 'attention_required' then
    raise exception '2792 contract 4: guarded run was not parked attention_required';
  end if;
  update public.style_guide_files set crawl_run_id = c_run
   where root_label = 'R2792' and relative_path = 'TestLicensor/seen1.pdf';

  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', gen_random_uuid(), 2000);
  if v_batch.guard_state <> 'empty_crawl' or v_batch.deactivated <> 0 then
    raise exception '2792 contract 4: missing-run guard state=%', v_batch.guard_state;
  end if;

  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_inacc, 2000);
  if v_batch.guard_state <> 'inaccessible_roots' or v_batch.deactivated <> 0 then
    raise exception '2792 contract 4: inaccessible guard state=%', v_batch.guard_state;
  end if;

  select array_agg(id order by id) into v_ids_after from public.style_guide_files where root_label = 'R2792' and is_active;
  if v_ids_before is distinct from v_ids_after then
    raise exception '2792 contract 4: a guarded call changed active rows';
  end if;

  -- -------------------------------------------------------------------------
  -- 5. a failed call mutates nothing (the statement error rolls it back)
  -- -------------------------------------------------------------------------
  select to_jsonb(r) into v_run_before from public.style_guide_crawl_runs r where id = c_run;
  begin
    perform public.reconcile_stale_sg_files_batch('R2792', c_run, 2000);
    raise exception using errcode = 'P2792', message = 'forced failure after the batch';
  exception when sqlstate 'P2792' then
    null;
  end;
  select array_agg(id order by id) into v_ids_after from public.style_guide_files where root_label = 'R2792' and is_active;
  select to_jsonb(r) into v_run_after from public.style_guide_crawl_runs r where id = c_run;
  if v_ids_before is distinct from v_ids_after or v_run_before is distinct from v_run_after then
    raise exception '2792 contract 5: a failed call left row or counter changes behind';
  end if;

  -- -------------------------------------------------------------------------
  -- 6. deterministic continuation across both uuid sides and NULL, one per call
  -- -------------------------------------------------------------------------
  loop
    v_calls := v_calls + 1;
    select array_agg(id order by crawl_run_id nulls last, id) into v_ids_before
      from public.style_guide_files
     where root_label = 'R2792' and is_active and (crawl_run_id is null or crawl_run_id <> c_run);
    select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_run, 1);
    if v_batch.guard_state <> 'ok' or v_batch.deactivated > 1 then
      raise exception '2792 contract 6: call % state=% deactivated=%', v_calls, v_batch.guard_state, v_batch.deactivated;
    end if;
    if v_batch.deactivated = 1 then
      if (select is_active from public.style_guide_files where id = v_ids_before[1]) then
        raise exception '2792 contract 6: call % did not take the next row in (crawl_run_id nulls last, id) order', v_calls;
      end if;
      v_order := v_order || v_ids_before[1];
    end if;
    v_total := v_total + v_batch.deactivated;
    if v_batch.remaining <> 5 - v_total then
      raise exception '2792 contract 6: remaining=% after % deactivated', v_batch.remaining, v_total;
    end if;
    exit when v_batch.done;
    if v_calls > 10 then
      raise exception '2792 contract 6: continuation did not terminate';
    end if;
  end loop;
  if v_total <> 5 or v_order is distinct from v_expected then
    raise exception '2792 contract 6: reconciled % rows in the wrong order', v_total;
  end if;

  -- accepted run's rows and the already-inactive row were untouched; docs synced
  if exists (select 1 from public.style_guide_files where root_label = 'R2792' and crawl_run_id = c_run and not is_active) then
    raise exception '2792 contract 6: a row of the accepted run was inactivated';
  end if;
  select count(*) into v_docs
    from public.style_guide_search_documents d
    join public.style_guide_files f on f.id = d.style_guide_file_id
   where f.root_label = 'R2792' and not f.is_active and d.is_active;
  if v_docs <> 0 then
    raise exception '2792 contract 6: % search documents stayed active for inactivated files', v_docs;
  end if;
  if exists (select 1 from public.style_guide_files where root_label = 'R2792' and not is_active and relative_path <> 'TestLicensor/old.pdf'
             and id <> all (v_order)) then
    raise exception '2792 contract 6: an unexpected row was inactivated';
  end if;

  -- counters and completion stamp
  if (select files_deactivated from public.style_guide_crawl_runs where id = c_run) <> 5
     or (select stale_remaining from public.style_guide_crawl_runs where id = c_run) <> 0
     or (select stale_candidates_at_start from public.style_guide_crawl_runs where id = c_run) <> 5
     or (select reconcile_completed_at from public.style_guide_crawl_runs where id = c_run) is null
     or (select reconcile_batches from public.style_guide_crawl_runs where id = c_run) <> v_calls then
    raise exception '2792 contract 6: run counters or completion stamp are wrong';
  end if;

  -- -------------------------------------------------------------------------
  -- 7. idempotent retry after completion
  -- -------------------------------------------------------------------------
  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_run, 2000);
  if v_batch.deactivated <> 0 or not v_batch.done or v_batch.remaining <> 0
     or (select files_deactivated from public.style_guide_crawl_runs where id = c_run) <> 5 then
    raise exception '2792 contract 7: retry after completion was not a no-op';
  end if;

  -- -------------------------------------------------------------------------
  -- 8a. the bounded guard on a later call agrees with preview at the boundary:
  --     6 run rows vs 6 new stale (ratio exactly 0.5) proceeds; 6 vs 7 parks
  -- -------------------------------------------------------------------------
  for v_i in 1..6 loop
    perform pg_temp.mk_file2792('R2792', c_low, format('late%s.pdf', v_i));
  end loop;
  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_run, 2000);
  if v_batch.guard_state <> 'ok' or v_batch.deactivated <> 6 or not v_batch.done then
    raise exception '2792 contract 8a: ratio-boundary call state=% deactivated=%', v_batch.guard_state, v_batch.deactivated;
  end if;
  for v_i in 1..7 loop
    perform pg_temp.mk_file2792('R2792', c_high, format('later%s.pdf', v_i));
  end loop;
  select array_agg(id order by id) into v_ids_before from public.style_guide_files where root_label = 'R2792' and is_active;
  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792', c_run, 2000);
  select array_agg(id order by id) into v_ids_after from public.style_guide_files where root_label = 'R2792' and is_active;
  if v_batch.guard_state <> 'low_nonzero' or v_batch.deactivated <> 0 or v_batch.remaining <> 7
     or v_ids_before is distinct from v_ids_after
     or (select lifecycle_state from public.style_guide_crawl_runs where id = c_run) <> 'attention_required' then
    raise exception '2792 contract 8a: below-ratio later call state=% deactivated=% remaining=%',
      v_batch.guard_state, v_batch.deactivated, v_batch.remaining;
  end if;

  -- -------------------------------------------------------------------------
  -- 8. a request above the cap writes at most 500 and continues with done=false
  -- -------------------------------------------------------------------------
  insert into public.style_guide_crawl_runs (id, status, files_found)
  values ('00000000-0000-4000-8000-00000000000c', 'pending', 751);
  insert into public.style_guide_files
    (crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder, size_bytes, modified_at, is_active)
  select case when g <= 751 then '00000000-0000-4000-8000-00000000000c'::uuid else c_low end,
         'R2792CAP', format('TestLicensor/cap%s.pdf', g), 'dir/R2792CAP', format('cap%s.pdf', g),
         format('cap%s', g), 'pdf', format('cap%s.pdf', g), 'TestProperty', 'TestGuide',
         1, timestamptz '2026-01-01 00:00:00+00', true
    from generate_series(1, 1500) g;

  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792CAP', '00000000-0000-4000-8000-00000000000c', 50000);
  if v_batch.deactivated <> 500 or v_batch.done or v_batch.remaining <> 249 then
    raise exception '2792 contract 8: oversized request deactivated=% remaining=% done=%',
      v_batch.deactivated, v_batch.remaining, v_batch.done;
  end if;
  select * into v_batch from public.reconcile_stale_sg_files_batch('R2792CAP', '00000000-0000-4000-8000-00000000000c', 50000);
  if v_batch.deactivated <> 249 or not v_batch.done or v_batch.remaining <> 0 then
    raise exception '2792 contract 8: continuation deactivated=% remaining=% done=%',
      v_batch.deactivated, v_batch.remaining, v_batch.done;
  end if;

  raise notice 'issue #2792 PopSG bounded reconcile contracts: all 8 checks passed';
end
$contracts$;

rollback;
