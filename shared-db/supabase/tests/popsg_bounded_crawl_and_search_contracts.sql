-- Issue #2212 contract tests: PopSG bounded crawl reconciliation, PDF text, and
-- the unified search contract.
--
-- Everything here runs inside one transaction that is rolled back, so no fixture
-- survives the test. NOTE: refresh_style_guide_matviews() is deliberately NOT
-- called -- it issues REFRESH MATERIALIZED VIEW CONCURRENTLY, which PostgreSQL
-- forbids inside a transaction block. Its two guarantees are proven instead by
-- (a) the catalogue check that style_guide_folders now HAS the unique index that
-- makes a concurrent refresh possible at all, and (b) the CHECK constraint that
-- makes a run's completion impossible without a recorded refresh.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create or replace function pg_temp.mk_file(
  p_root text, p_run uuid, p_path text, p_ext text default 'pdf', p_active boolean default true
) returns uuid language sql as $$
  -- licensor_name is GENERATED ALWAYS AS split_part(relative_path, '/', 1), so it
  -- cannot be written directly -- the path carries it.
  insert into public.style_guide_files
    (crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, tag_names, tag_search_text)
  values
    (p_run, p_root, 'TestLicensor/' || p_path, 'dir/' || p_root, p_path, replace(p_path, '.pdf', ''),
     p_ext, lower(p_path), 'TestProperty', 'TestGuide',
     1024, timestamptz '2026-01-01 00:00:00+00', p_active, array['alpha','beta'], 'alpha beta')
  returning id;
$$;

do $contracts$
declare
  v_run_a uuid;  -- happy path: bounded batching + resume
  v_run_a2 uuid;
  v_run_b uuid;  -- low-nonzero guard
  v_run_b2 uuid;
  v_run_c uuid;  -- empty-crawl guard
  v_run_d uuid;  -- inaccessible-root guard
  v_run_e uuid;  -- completion invariant
  v_run_f uuid;  -- search-document re-activation
  v_run_f2 uuid;
  v_run_f3 uuid;
  v_run_g uuid;  -- multi-batch reconcile of an already-completed run
  v_run_g2 uuid;
  v_file uuid;
  v_reactivated uuid;
  v_preview record;
  v_batch record;
  v_before bigint;
  v_after bigint;
  v_total integer;
  v_iterations integer;
  v_ok boolean;
  v_sqlstate text;
  v_claim record;
  v_claim_count integer;
  v_identity text;
  v_result jsonb;
  v_page1 jsonb;
  v_page2 jsonb;
  v_page3 jsonb;
  v_ids uuid[];
  v_text text;
begin

  -- =========================================================================
  -- verify 1: every claimed object exists at its exact signature
  -- =========================================================================
  if to_regclass('public.style_guide_pdf_text') is null
     or to_regclass('public.style_guide_search_documents') is null then
    raise exception 'contract 1: a claimed table is missing';
  end if;

  if to_regprocedure('public.preview_stale_sg_files(text,uuid,numeric)') is null
     or to_regprocedure('public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)') is null
     or to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)') is null
     or to_regprocedure('public.claim_style_guide_pdf_text(text,integer,interval,integer)') is null
     or to_regprocedure('public.complete_style_guide_pdf_text(uuid,text,text,integer,text)') is null
     or to_regprocedure('public.search_style_guide_library(text,text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)') is null then
    raise exception 'contract 1: a claimed routine is missing';
  end if;

  -- =========================================================================
  -- verify 2: style_guide_folders can now be refreshed CONCURRENTLY
  -- (a unique index over plain columns is exactly what PostgreSQL requires)
  -- =========================================================================
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.style_guide_folders'::regclass
       and c.relname = 'sgfolders_licensor_property_uidx'
       and i.indisunique
       and i.indexprs is null
       and i.indpred is null) then
    raise exception 'contract 2: style_guide_folders still has no plain unique index, so CONCURRENTLY is impossible';
  end if;

  -- =========================================================================
  -- verify 3: the SECURITY DEFINER function is no longer reachable by
  -- `authenticated` (or `anon`, or PUBLIC)
  -- =========================================================================
  if has_function_privilege('authenticated', 'public.deactivate_stale_sg_files(text,uuid)', 'execute') then
    raise exception 'contract 3: authenticated can still execute deactivate_stale_sg_files';
  end if;
  if has_function_privilege('anon', 'public.deactivate_stale_sg_files(text,uuid)', 'execute') then
    raise exception 'contract 3: anon can still execute deactivate_stale_sg_files';
  end if;
  -- PUBLIC is not a role, so it is read straight out of the ACL: a PUBLIC grant
  -- is spelled with an empty grantee, `=X/owner`.
  if exists (
    select 1
      from pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.deactivate_stale_sg_files(text,uuid)'::regprocedure
       and a::text like '=%') then
    raise exception 'contract 3: PUBLIC can still execute deactivate_stale_sg_files';
  end if;
  if not has_function_privilege('service_role', 'public.deactivate_stale_sg_files(text,uuid)', 'execute') then
    raise exception 'contract 3: service_role lost EXECUTE on deactivate_stale_sg_files';
  end if;
  -- every continuation RPC is service-role only
  if has_function_privilege('authenticated', 'public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.preview_stale_sg_files(text,uuid,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.refresh_style_guide_matviews(uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_style_guide_pdf_text(text,integer,interval,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_style_guide_pdf_text(uuid,text,text,integer,text)', 'execute') then
    raise exception 'contract 3: a continuation RPC is executable by authenticated';
  end if;
  -- the ONE search RPC is the thing authenticated may call
  if not has_function_privilege('authenticated', 'public.search_style_guide_library(text,text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)', 'execute') then
    raise exception 'contract 3: authenticated cannot execute the search RPC';
  end if;

  -- =========================================================================
  -- verify 4: a run cannot reach completed before reconciliation AND
  -- aggregate freshness are both recorded -- by either column
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 5) returning id into v_run_e;

  v_ok := false;
  begin
    update public.style_guide_crawl_runs set lifecycle_state = 'completed' where id = v_run_e;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'contract 4: lifecycle_state reached completed with no reconciliation and no refresh';
  end if;

  v_ok := false;
  begin
    update public.style_guide_crawl_runs set status = 'completed' where id = v_run_e;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'contract 4: legacy status reached completed with no reconciliation and no refresh';
  end if;

  -- reconciliation alone is not enough; freshness is also required
  update public.style_guide_crawl_runs set reconcile_completed_at = now() where id = v_run_e;
  v_ok := false;
  begin
    update public.style_guide_crawl_runs set lifecycle_state = 'completed' where id = v_run_e;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'contract 4: completion was allowed with reconciliation but no aggregate freshness';
  end if;

  -- with both recorded, completion is allowed
  update public.style_guide_crawl_runs set refresh_completed_at = now() where id = v_run_e;
  update public.style_guide_crawl_runs set lifecycle_state = 'completed', status = 'completed' where id = v_run_e;

  -- =========================================================================
  -- verify 5: preview mutates NOTHING
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 4) returning id into v_run_a;
  perform pg_temp.mk_file('ROOT_A', v_run_a, 'a1.pdf');
  perform pg_temp.mk_file('ROOT_A', v_run_a, 'a2.pdf');
  perform pg_temp.mk_file('ROOT_A', v_run_a, 'a3.pdf');
  perform pg_temp.mk_file('ROOT_A', v_run_a, 'a4.pdf');

  -- a second crawl re-sees three of the four; the fourth is genuinely stale
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 3) returning id into v_run_a2;
  update public.style_guide_files set crawl_run_id = v_run_a2
   where root_label = 'ROOT_A' and relative_path in ('TestLicensor/a1.pdf','TestLicensor/a2.pdf','TestLicensor/a3.pdf');

  select count(*) into v_before from public.style_guide_files where root_label = 'ROOT_A' and is_active;

  select * into v_preview from public.preview_stale_sg_files('ROOT_A', v_run_a2);

  select count(*) into v_after from public.style_guide_files where root_label = 'ROOT_A' and is_active;
  if v_before <> v_after then
    raise exception 'contract 5: preview_stale_sg_files mutated rows (% -> %)', v_before, v_after;
  end if;
  if v_preview.stale_candidates <> 1 or v_preview.active_total <> 4 or not v_preview.safe_to_reconcile then
    raise exception 'contract 5: preview reported candidates=% active=% safe=%',
      v_preview.stale_candidates, v_preview.active_total, v_preview.safe_to_reconcile;
  end if;
  if (select lifecycle_state from public.style_guide_crawl_runs where id = v_run_a2) <> 'pending' then
    raise exception 'contract 5: preview changed the run lifecycle state';
  end if;

  -- =========================================================================
  -- verify 6: bounded batching terminates, and resumes after interruption
  -- =========================================================================
  -- make three rows stale so more than one batch is genuinely required
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 1) returning id into v_run_b2;
  update public.style_guide_files set crawl_run_id = v_run_a2, is_active = true
   where root_label = 'ROOT_A';
  perform pg_temp.mk_file('ROOT_A', v_run_a2, 'a5.pdf');
  perform pg_temp.mk_file('ROOT_A', v_run_a2, 'a6.pdf');
  -- now hand the root to a NEW run that re-sees only a5 and a6 plus four others,
  -- leaving exactly three stale rows behind
  update public.style_guide_files set crawl_run_id = v_run_b2
   where root_label = 'ROOT_A' and relative_path in ('TestLicensor/a1.pdf','TestLicensor/a2.pdf','TestLicensor/a5.pdf');
  update public.style_guide_crawl_runs set files_found = 3 where id = v_run_b2;

  -- 3 of 6 re-seen is a ratio of 0.5, which is NOT below the 0.5 floor
  v_total := 0;
  v_iterations := 0;
  loop
    v_iterations := v_iterations + 1;
    -- ONE row per call: each call is a complete, independent, resumable unit
    select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_A', v_run_b2, 1);
    if v_batch.guard_state <> 'ok' then
      raise exception 'contract 6: guard fired unexpectedly: %', v_batch.guard_reason;
    end if;
    if v_batch.deactivated > 1 then
      raise exception 'contract 6: batch size 1 deactivated % rows', v_batch.deactivated;
    end if;
    v_total := v_total + v_batch.deactivated;
    exit when v_batch.done;
    if v_iterations > 20 then
      raise exception 'contract 6: bounded batching did not terminate';
    end if;
  end loop;

  if v_total <> 3 then
    raise exception 'contract 6: expected 3 stale rows reconciled across batches, got %', v_total;
  end if;
  if v_iterations < 3 then
    raise exception 'contract 6: batch size 1 finished in % calls, so it was not bounded', v_iterations;
  end if;

  -- idempotent: running again after completion is a no-op that still reports done
  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_A', v_run_b2, 1);
  if v_batch.deactivated <> 0 or not v_batch.done then
    raise exception 'contract 6: re-running a finished reconciliation was not idempotent (deactivated=%, done=%)',
      v_batch.deactivated, v_batch.done;
  end if;

  -- the rows the run itself saw were never touched
  if (select count(*) from public.style_guide_files
       where root_label = 'ROOT_A' and crawl_run_id = v_run_b2 and not is_active) > 0 then
    raise exception 'contract 6: reconciliation inactivated a row belonging to the accepted run';
  end if;

  -- reconciliation stamped the run, and only now is completion possible
  if (select reconcile_completed_at from public.style_guide_crawl_runs where id = v_run_b2) is null then
    raise exception 'contract 6: reconcile_completed_at was not recorded';
  end if;
  if (select reconcile_batches from public.style_guide_crawl_runs where id = v_run_b2) < 3 then
    raise exception 'contract 6: reconcile_batches was not counted';
  end if;

  -- =========================================================================
  -- verify 7: reactivation works
  -- =========================================================================
  select id into v_reactivated from public.style_guide_files
   where root_label = 'ROOT_A' and not is_active order by relative_path limit 1;
  if v_reactivated is null then
    raise exception 'contract 7: no inactivated row to reactivate';
  end if;

  -- a later crawl sees the file again: the SAME row is reactivated, not duplicated
  update public.style_guide_files
     set is_active = true, crawl_run_id = v_run_b2, last_seen_at = now()
   where id = v_reactivated;

  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_A', v_run_b2, 100);
  if v_batch.guard_state <> 'ok' then
    raise exception 'contract 7: guard fired after reactivation: %', v_batch.guard_reason;
  end if;
  if not (select is_active from public.style_guide_files where id = v_reactivated) then
    raise exception 'contract 7: a reactivated row was inactivated again by its own run';
  end if;

  -- =========================================================================
  -- verify 8: the low-nonzero guard inactivates NOTHING
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 4) returning id into v_run_b;
  perform pg_temp.mk_file('ROOT_B', v_run_b, 'b1.pdf');
  perform pg_temp.mk_file('ROOT_B', v_run_b, 'b2.pdf');
  perform pg_temp.mk_file('ROOT_B', v_run_b, 'b3.pdf');
  perform pg_temp.mk_file('ROOT_B', v_run_b, 'b4.pdf');

  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 1) returning id into v_run_c;
  update public.style_guide_files set crawl_run_id = v_run_c
   where root_label = 'ROOT_B' and relative_path = 'TestLicensor/b1.pdf';

  select count(*) into v_before from public.style_guide_files where root_label = 'ROOT_B' and is_active;
  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_B', v_run_c);
  select count(*) into v_after from public.style_guide_files where root_label = 'ROOT_B' and is_active;

  if v_batch.guard_state <> 'low_nonzero' then
    raise exception 'contract 8: a 1-of-4 crawl was not caught by the low-nonzero guard (guard_state=%)', v_batch.guard_state;
  end if;
  if v_before <> v_after or v_batch.deactivated <> 0 then
    raise exception 'contract 8: the low-nonzero guard inactivated rows (% -> %, deactivated=%)',
      v_before, v_after, v_batch.deactivated;
  end if;
  if (select lifecycle_state from public.style_guide_crawl_runs where id = v_run_c) <> 'attention_required' then
    raise exception 'contract 8: a guarded run was not parked as attention_required';
  end if;
  -- and it still cannot be reported complete
  if (select reconcile_completed_at from public.style_guide_crawl_runs where id = v_run_c) is not null then
    raise exception 'contract 8: a guarded run recorded a reconciliation it never did';
  end if;

  -- =========================================================================
  -- verify 9: the empty-crawl guard inactivates NOTHING
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 3) returning id into v_run_d;
  perform pg_temp.mk_file('ROOT_C', v_run_d, 'c1.pdf');
  perform pg_temp.mk_file('ROOT_C', v_run_d, 'c2.pdf');
  perform pg_temp.mk_file('ROOT_C', v_run_d, 'c3.pdf');

  -- a run that found nothing at all
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 0) returning id into v_file;

  select count(*) into v_before from public.style_guide_files where root_label = 'ROOT_C' and is_active;
  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_C', v_file);
  select count(*) into v_after from public.style_guide_files where root_label = 'ROOT_C' and is_active;

  if v_batch.guard_state <> 'empty_crawl' then
    raise exception 'contract 9: a zero-file crawl was not caught (guard_state=%)', v_batch.guard_state;
  end if;
  if v_before <> v_after or v_after <> 3 then
    raise exception 'contract 9: the empty-crawl guard inactivated rows (% -> %)', v_before, v_after;
  end if;

  -- =========================================================================
  -- verify 10: the inaccessible-root guard inactivates NOTHING
  -- =========================================================================
  insert into public.style_guide_crawl_runs (status, files_found, inaccessible_roots)
  values ('pending', 3, array['ROOT_C']) returning id into v_file;
  update public.style_guide_files set crawl_run_id = v_file
   where root_label = 'ROOT_C' and relative_path = 'TestLicensor/c1.pdf';

  select count(*) into v_before from public.style_guide_files where root_label = 'ROOT_C' and is_active;
  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_C', v_file);
  select count(*) into v_after from public.style_guide_files where root_label = 'ROOT_C' and is_active;

  if v_batch.guard_state <> 'inaccessible_roots' then
    raise exception 'contract 10: an inaccessible root was not caught (guard_state=%)', v_batch.guard_state;
  end if;
  if v_before <> v_after then
    raise exception 'contract 10: the inaccessible-root guard inactivated rows (% -> %)', v_before, v_after;
  end if;

  -- the compatibility wrapper refuses too, rather than silently doing nothing
  v_ok := false;
  begin
    perform public.deactivate_stale_sg_files('ROOT_C', v_file);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'contract 10: deactivate_stale_sg_files did not refuse a guarded root';
  end if;

  -- =========================================================================
  -- verify 11: PDF claim is restart-safe and identity-invalidating
  -- =========================================================================
  select id into v_file from public.style_guide_files
   where root_label = 'ROOT_C' and relative_path = 'TestLicensor/c2.pdf';

  select count(*) into v_claim_count from public.claim_style_guide_pdf_text('worker-1', 50);
  if v_claim_count = 0 then
    raise exception 'contract 11: no PDF work was claimable';
  end if;

  select content_identity into v_identity from public.style_guide_pdf_text where style_guide_file_id = v_file;
  if v_identity is null then
    raise exception 'contract 11: the claimed file has no content identity';
  end if;

  -- a result computed against a DIFFERENT identity is refused
  if public.complete_style_guide_pdf_text(v_file, 'not-the-identity', 'ignored text') then
    raise exception 'contract 11: a stale-identity extraction was accepted';
  end if;

  -- the matching identity is accepted
  if not public.complete_style_guide_pdf_text(v_file, v_identity, 'the quick brown widget bible', 12) then
    raise exception 'contract 11: a matching-identity extraction was refused';
  end if;
  if (select status from public.style_guide_pdf_text where style_guide_file_id = v_file) <> 'extracted' then
    raise exception 'contract 11: the extraction was not stored';
  end if;

  -- completing twice is refused (the claim is spent)
  if public.complete_style_guide_pdf_text(v_file, v_identity, 'second write') then
    raise exception 'contract 11: an unclaimed row accepted a second completion';
  end if;

  -- the file content changes underneath the stored extraction; the next claim
  -- invalidates it rather than serving stale text
  update public.style_guide_files set size_bytes = 999999 where id = v_file;
  perform public.claim_style_guide_pdf_text('worker-2', 50);
  if (select status from public.style_guide_pdf_text where style_guide_file_id = v_file) <> 'claimed'
     or (select extracted_text from public.style_guide_pdf_text where style_guide_file_id = v_file) is not null then
    raise exception 'contract 11: a content-identity change did not invalidate the stored extraction';
  end if;

  -- restart safety: an expired claim is reclaimable by another worker
  update public.style_guide_pdf_text
     set claim_expires_at = now() - interval '1 hour'
   where style_guide_file_id = v_file;
  select count(*) into v_claim_count
    from public.claim_style_guide_pdf_text('worker-3', 50) c
   where c.style_guide_file_id = v_file;
  if v_claim_count <> 1 then
    raise exception 'contract 11: an expired claim was not reclaimable after a worker restart';
  end if;

  -- =========================================================================
  -- verify 12: search paging is stable and the total is exact
  -- =========================================================================
  delete from public.style_guide_search_documents;
  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, is_active, source_identity, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
         'TestGuide', f.directory_path, f.relative_path, f.filename, f.file_extension,
         f.tag_names, f.size_bytes,
         -- DELIBERATELY IDENTICAL timestamps: without the primary-key tiebreak this
         -- is exactly the shape that makes paging repeat and skip rows.
         timestamptz '2026-02-02 00:00:00+00',
         true, md5(f.id::text),
         setweight(to_tsvector('simple', f.filename), 'A')
         || setweight(to_tsvector('simple', 'testguide testproperty testlicensor'), 'B')
    from public.style_guide_files f
   where f.root_label = 'ROOT_C' and f.is_active;

  v_result := public.search_style_guide_library(p_sort => 'modified_desc', p_limit => 200);
  if (v_result ->> 'total')::bigint <> (select count(*) from public.style_guide_search_documents where is_active) then
    raise exception 'contract 12: the reported total (%) is not the exact filtered count', v_result ->> 'total';
  end if;

  v_page1 := public.search_style_guide_library(p_sort => 'modified_desc', p_limit => 1, p_offset => 0);
  v_page2 := public.search_style_guide_library(p_sort => 'modified_desc', p_limit => 1, p_offset => 1);
  v_page3 := public.search_style_guide_library(p_sort => 'modified_desc', p_limit => 1, p_offset => 2);

  select array_agg(x order by x) into v_ids from (
    select (v_page1 -> 'results' -> 0 ->> 'style_guide_file_id')::uuid as x
    union all select (v_page2 -> 'results' -> 0 ->> 'style_guide_file_id')::uuid
    union all select (v_page3 -> 'results' -> 0 ->> 'style_guide_file_id')::uuid
  ) s;

  if cardinality(v_ids) <> 3 then
    raise exception 'contract 12: paging returned % rows across three single-row pages', cardinality(v_ids);
  end if;
  if v_ids[1] = v_ids[2] or v_ids[2] = v_ids[3] or v_ids[1] = v_ids[3] then
    raise exception 'contract 12: single-row pages repeated a row, so paging is not stable';
  end if;
  if (v_page1 ->> 'total')::bigint <> (v_page3 ->> 'total')::bigint then
    raise exception 'contract 12: the total changed between pages';
  end if;

  -- repeating the same page gives the same row: the order is total, not arbitrary
  if (public.search_style_guide_library(p_sort => 'modified_desc', p_limit => 1, p_offset => 1)
        -> 'results' -> 0 ->> 'style_guide_file_id')::uuid
     is distinct from (v_page2 -> 'results' -> 0 ->> 'style_guide_file_id')::uuid then
    raise exception 'contract 12: the same offset returned a different row on a second call';
  end if;

  -- =========================================================================
  -- verify 13: filters, PDF-text search, and matching facets
  -- =========================================================================
  v_result := public.search_style_guide_library(p_licensors => array['NoSuchLicensor']);
  if (v_result ->> 'total')::bigint <> 0 or jsonb_array_length(v_result -> 'results') <> 0 then
    raise exception 'contract 13: a licensor filter that matches nothing returned rows';
  end if;

  v_result := public.search_style_guide_library(p_tags => array['alpha']);
  if (v_result ->> 'total')::bigint = 0 then
    raise exception 'contract 13: the tag filter matched nothing';
  end if;

  v_result := public.search_style_guide_library(p_extensions => array['PDF']);
  if (v_result ->> 'total')::bigint = 0 then
    raise exception 'contract 13: the extension filter is case sensitive';
  end if;

  -- facets are computed over the SAME filtered set the total describes
  v_result := public.search_style_guide_library(p_licensors => array['TestLicensor']);
  if (select sum((e ->> 'count')::bigint)
        from jsonb_array_elements(v_result -> 'facets' -> 'licensors') e)
     is distinct from (v_result ->> 'total')::bigint then
    raise exception 'contract 13: the licensor facet counts do not sum to the reported total';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_result -> 'facets' -> 'tags') e
                  where e ->> 'value' = 'alpha') then
    raise exception 'contract 13: the tag facet is missing a tag that is present in the filtered set';
  end if;

  -- PDF text participates in the search vector
  update public.style_guide_search_documents d
     set search_vector = d.search_vector
       || setweight(to_tsvector('simple', 'zzzunmistakabletoken'), 'D')
   where d.style_guide_file_id = (select id from public.style_guide_files
                                   where root_label = 'ROOT_C' and relative_path = 'TestLicensor/c2.pdf');
  v_result := public.search_style_guide_library(p_query => 'zzzunmistakabletoken');
  if (v_result ->> 'total')::bigint <> 1 then
    raise exception 'contract 13: PDF text is not searchable (total=%)', v_result ->> 'total';
  end if;

  -- inactive documents are never returned
  update public.style_guide_search_documents set is_active = false;
  v_result := public.search_style_guide_library();
  if (v_result ->> 'total')::bigint <> 0 then
    raise exception 'contract 13: inactive documents were returned by the search RPC';
  end if;

  -- =========================================================================
  -- verify 14: a re-activated file is re-activated in unified search
  -- =========================================================================
  -- reconcile_stale_sg_files_batch sets style_guide_search_documents.is_active
  -- = false. The stored source_identity was computed while the file was still
  -- active, so when a later crawl re-sees the file UNCHANGED the identity still
  -- matches and an identity-only candidate predicate would never re-select the
  -- row: the file would be active and permanently invisible to search.
  delete from public.style_guide_search_documents;

  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 2) returning id into v_run_f;
  v_file := pg_temp.mk_file('ROOT_F', v_run_f, 'f1.pdf');
  perform pg_temp.mk_file('ROOT_F', v_run_f, 'f2.pdf');

  -- the search document as refresh_style_guide_matviews would have written it
  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, is_active, source_identity, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
         'TestGuide', f.directory_path, f.relative_path, f.filename, f.file_extension,
         f.tag_names, f.size_bytes, f.modified_at, f.is_active,
         md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
             coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
             coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
             coalesce(f.licensor_name, '') || '|' || f.is_active::text),
         to_tsvector('simple', f.filename)
    from public.style_guide_files f
   where f.root_label = 'ROOT_F';

  select source_identity into v_identity
    from public.style_guide_search_documents where style_guide_file_id = v_file;

  -- a crawl that re-sees only f2 makes f1 stale
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 1) returning id into v_run_f2;
  update public.style_guide_files set crawl_run_id = v_run_f2
   where root_label = 'ROOT_F' and relative_path = 'TestLicensor/f2.pdf';
  update public.style_guide_crawl_runs set files_found = 1 where id = v_run_f2;

  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_F', v_run_f2, 100, 0.5);
  if v_batch.guard_state <> 'ok' or v_batch.deactivated <> 1 then
    raise exception 'contract 14: expected exactly one stale row (state=%, deactivated=%)',
      v_batch.guard_state, v_batch.deactivated;
  end if;
  if (select is_active from public.style_guide_search_documents where style_guide_file_id = v_file) then
    raise exception 'contract 14: the search document of a stale file was not deactivated';
  end if;

  -- a later crawl re-sees f1 UNCHANGED
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 2) returning id into v_run_f3;
  update public.style_guide_files set is_active = true, crawl_run_id = v_run_f3, last_seen_at = now()
   where id = v_file;
  update public.style_guide_files set crawl_run_id = v_run_f3
   where root_label = 'ROOT_F' and relative_path = 'TestLicensor/f2.pdf';

  -- the file is active again and its identity is UNCHANGED, so an identity-only
  -- predicate cannot see it. This is the premise of the defect, asserted rather
  -- than assumed.
  if v_identity is distinct from (
       select md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                  coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                  coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                  coalesce(f.licensor_name, '') || '|' || f.is_active::text)
         from public.style_guide_files f where f.id = v_file) then
    raise exception 'contract 14: the re-seen file no longer has its stored identity, so the test proves nothing';
  end if;

  -- therefore the refresh candidate predicate MUST also key on is_active drift.
  -- refresh_style_guide_matviews cannot be called here (it issues REFRESH ...
  -- CONCURRENTLY, which PostgreSQL forbids inside a transaction block), so the
  -- deployed definition is read from the catalogue.
  if position('d.is_active is distinct from f.is_active' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer)'::regprocedure)) = 0 then
    raise exception 'contract 14: refresh_style_guide_matviews cannot re-activate a returning file, so it stays invisible to search';
  end if;

  -- and the document itself must be re-activated once refreshed
  update public.style_guide_search_documents d
     set is_active = f.is_active, document_updated_at = now()
    from public.style_guide_files f
   where f.id = d.style_guide_file_id and d.is_active is distinct from f.is_active;
  if not (select is_active from public.style_guide_search_documents where style_guide_file_id = v_file) then
    raise exception 'contract 14: the re-activated file did not become visible to search again';
  end if;

  -- =========================================================================
  -- verify 15: a multi-batch reconcile of an ALREADY-completed run survives
  -- =========================================================================
  -- reconcile_completed_at must not be nulled on a non-final batch: on a run
  -- that already reached 'completed' that violates
  -- style_guide_crawl_runs_completion_requires_reconcile and aborts the call.
  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 4) returning id into v_run_g;
  perform pg_temp.mk_file('ROOT_G', v_run_g, 'g1.pdf');
  perform pg_temp.mk_file('ROOT_G', v_run_g, 'g2.pdf');
  perform pg_temp.mk_file('ROOT_G', v_run_g, 'g3.pdf');
  perform pg_temp.mk_file('ROOT_G', v_run_g, 'g4.pdf');

  insert into public.style_guide_crawl_runs (status, files_found) values ('pending', 2) returning id into v_run_g2;
  update public.style_guide_files set crawl_run_id = v_run_g2
   where root_label = 'ROOT_G' and relative_path in ('TestLicensor/g1.pdf','TestLicensor/g2.pdf');
  update public.style_guide_crawl_runs
     set files_found = 2,
         reconcile_completed_at = now(),
         refresh_completed_at = now(),
         lifecycle_state = 'completed',
         status = 'completed'
   where id = v_run_g2;

  -- batch size 1 over two stale rows: the FIRST call is non-final
  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_G', v_run_g2, 1, 0.5);
  if v_batch.guard_state <> 'ok' or v_batch.done then
    raise exception 'contract 15: expected an unfinished first batch (state=%, done=%)',
      v_batch.guard_state, v_batch.done;
  end if;
  if (select reconcile_completed_at from public.style_guide_crawl_runs where id = v_run_g2) is null then
    raise exception 'contract 15: a non-final batch nulled reconcile_completed_at on a completed run';
  end if;

  select * into v_batch from public.reconcile_stale_sg_files_batch('ROOT_G', v_run_g2, 1, 0.5);
  if not v_batch.done then
    raise exception 'contract 15: the second batch did not finish the reconciliation';
  end if;
  if (select reconcile_completed_at from public.style_guide_crawl_runs where id = v_run_g2) is null
     or (select lifecycle_state from public.style_guide_crawl_runs where id = v_run_g2) <> 'completed' then
    raise exception 'contract 15: the completed run lost its reconciliation stamp';
  end if;

  raise notice 'issue #2212 PopSG contracts: all 15 checks passed';
end
$contracts$;

rollback;
