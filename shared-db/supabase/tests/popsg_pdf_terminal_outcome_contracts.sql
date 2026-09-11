-- Issue #2507: focused behavior tests for PopSG PDF terminal outcomes.
begin;

do $contracts$
declare
  v_run uuid;
  v_extracted uuid := '00000000-0000-0000-0000-000000002501';
  v_failed uuid := '00000000-0000-0000-0000-000000002502';
  v_skipped uuid := '00000000-0000-0000-0000-000000002503';
  v_inactive uuid := '00000000-0000-0000-0000-000000002504';
  v_changed uuid := '00000000-0000-0000-0000-000000002505';
  v_identity text;
  v_before timestamptz;
  v_refused boolean;
begin
  if to_regprocedure('public.complete_style_guide_pdf_text_v2(uuid,text,text,text,integer,text,text)') is null then
    raise exception 'contract 1: v2 completion RPC is missing';
  end if;
  if to_regprocedure('public.complete_style_guide_pdf_text(uuid,text,text,integer,text)') is null then
    raise exception 'contract 1: the staggered-client v1 completion RPC was removed';
  end if;
  if has_function_privilege('authenticated', 'public.complete_style_guide_pdf_text_v2(uuid,text,text,text,integer,text,text)', 'execute')
     or has_function_privilege('anon', 'public.complete_style_guide_pdf_text_v2(uuid,text,text,text,integer,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.complete_style_guide_pdf_text_v2(uuid,text,text,text,integer,text,text)', 'execute') then
    raise exception 'contract 1: v2 completion RPC is not service-role only';
  end if;

  insert into public.style_guide_crawl_runs (status, files_found)
  values ('pending', 5) returning id into v_run;

  insert into public.style_guide_files
    (id, crawl_run_id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder, size_bytes,
     modified_at, is_active, tag_names, tag_search_text)
  select id, v_run, 'ISSUE2507', 'TestLicensor/' || name, 'TestLicensor', name,
         replace(name, '.pdf', ''), 'pdf', lower(name), 'TestProperty', 'TestGuide',
         1024, timestamptz '2026-01-01 00:00:00+00', true, array['terminal'], 'terminal'
    from (values
      (v_extracted, 'extracted.pdf'),
      (v_failed, 'failed.pdf'),
      (v_skipped, 'skipped.pdf'),
      (v_inactive, 'inactive.pdf'),
      (v_changed, 'changed.pdf')
    ) fixture(id, name);

  insert into public.style_guide_pdf_text
    (style_guide_file_id, content_identity, status, claimed_by, claimed_at, claim_expires_at, attempts)
  select f.id,
         md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')),
         'claimed', 'issue-2507-worker', now(), now() + interval '15 minutes', 1
    from public.style_guide_files f
   where f.id in (v_extracted, v_failed, v_skipped, v_inactive, v_changed);

  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, is_active, source_identity, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
         'TestGuide', f.directory_path, f.relative_path, f.filename, f.file_extension,
         f.tag_names, f.size_bytes, f.modified_at, true, md5(f.id::text),
         to_tsvector('simple', f.filename)
    from public.style_guide_files f
   where f.id in (v_extracted, v_failed, v_skipped, v_inactive, v_changed);

  select document_updated_at into v_before
    from public.style_guide_search_documents where style_guide_file_id = v_failed;
  select content_identity into v_identity
    from public.style_guide_pdf_text where style_guide_file_id = v_extracted;

  if not public.complete_style_guide_pdf_text_v2(
    v_extracted, v_identity, 'extracted', 'native-text', 4, 'issue2507searchtoken', null
  ) then
    raise exception 'contract 2: valid extracted outcome was refused';
  end if;
  if (select (status, extraction_method, extracted_text, terminal_reason, page_count)
             is distinct from ('extracted', 'native-text', 'issue2507searchtoken', null, 4)
        from public.style_guide_pdf_text where style_guide_file_id = v_extracted) then
    raise exception 'contract 2: extracted outcome was not stored truthfully';
  end if;
  if not (select search_vector @@ plainto_tsquery('simple', 'issue2507searchtoken')
            from public.style_guide_search_documents where style_guide_file_id = v_extracted) then
    raise exception 'contract 2: extracted text did not refresh its one search document';
  end if;
  if (select document_updated_at from public.style_guide_search_documents where style_guide_file_id = v_failed)
       is distinct from v_before then
    raise exception 'contract 2: completing one file refreshed another search document';
  end if;
  if public.complete_style_guide_pdf_text_v2(
    v_extracted, v_identity, 'extracted', 'native-text', 4, 'duplicate', null
  ) then
    raise exception 'contract 2: a spent claim accepted a duplicate completion';
  end if;

  select content_identity into v_identity
    from public.style_guide_pdf_text where style_guide_file_id = v_failed;
  if not public.complete_style_guide_pdf_text_v2(
    v_failed, v_identity, 'failed', 'local-ocr', 2, null, 'temporary renderer failure'
  ) then
    raise exception 'contract 3: valid failed outcome was refused';
  end if;
  if (select (status, terminal_reason, error_message, page_count)
             is distinct from ('failed', 'temporary renderer failure', 'temporary renderer failure', 2)
        from public.style_guide_pdf_text where style_guide_file_id = v_failed) then
    raise exception 'contract 3: failed reason was not stored durably and compatibly';
  end if;
  perform public.claim_style_guide_pdf_text('retry-worker', 500, interval '15 minutes', 3);
  if (select (status, attempts) is distinct from ('claimed', 2)
        from public.style_guide_pdf_text where style_guide_file_id = v_failed) then
    raise exception 'contract 3: transient failure was not reclaimable under the existing attempt policy';
  end if;
  if (select status from public.style_guide_pdf_text where style_guide_file_id = v_extracted) <> 'extracted' then
    raise exception 'contract 3: unchanged extracted outcome was reclaimed';
  end if;

  select content_identity into v_identity
    from public.style_guide_pdf_text where style_guide_file_id = v_skipped;
  if not public.complete_style_guide_pdf_text_v2(
    v_skipped, v_identity, 'skipped', 'eligibility-check', null, null, 'oversized document reviewed'
  ) then
    raise exception 'contract 4: valid skipped outcome was refused';
  end if;
  perform public.claim_style_guide_pdf_text('terminal-worker', 500, interval '15 minutes', 3);
  if (select status from public.style_guide_pdf_text where style_guide_file_id = v_skipped) <> 'skipped' then
    raise exception 'contract 4: a reviewed skipped outcome was reclaimed without content change';
  end if;

  select content_identity into v_identity
    from public.style_guide_pdf_text where style_guide_file_id = v_inactive;
  update public.style_guide_files set is_active = false where id = v_inactive;
  if public.complete_style_guide_pdf_text_v2(
    v_inactive, v_identity, 'failed', 'native-text', null, null, 'inactive file'
  ) then
    raise exception 'contract 5: inactive file completion was accepted';
  end if;

  select content_identity into v_identity
    from public.style_guide_pdf_text where style_guide_file_id = v_changed;
  update public.style_guide_files set size_bytes = size_bytes + 1 where id = v_changed;
  if public.complete_style_guide_pdf_text_v2(
    v_changed, v_identity, 'extracted', 'native-text', 1, 'stale text', null
  ) then
    raise exception 'contract 5: stale content identity completion was accepted';
  end if;
  perform public.claim_style_guide_pdf_text('changed-worker', 500, interval '15 minutes', 3);
  if (select status from public.style_guide_pdf_text where style_guide_file_id = v_changed) <> 'claimed'
     or (select content_identity from public.style_guide_pdf_text where style_guide_file_id = v_changed) = v_identity then
    raise exception 'contract 5: changed content did not invalidate and requeue safely';
  end if;

  v_refused := false;
  begin
    perform public.complete_style_guide_pdf_text_v2(v_failed, 'unused', 'extracted', 'native-text', 1, '   ', null);
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'contract 6: empty extracted text was accepted';
  end if;

  v_refused := false;
  begin
    perform public.complete_style_guide_pdf_text_v2(v_failed, 'unused', 'skipped', null, null, null, null);
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'contract 6: skipped outcome without a reason was accepted';
  end if;

  v_refused := false;
  begin
    perform public.complete_style_guide_pdf_text_v2(v_failed, 'unused', 'failed', null, null, null, '   ');
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'contract 6: failed outcome without a reason was accepted';
  end if;

  v_refused := false;
  begin
    perform public.complete_style_guide_pdf_text_v2(v_failed, 'unused', 'failed', null, null, null, repeat('x', 2001));
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'contract 6: overlong terminal reason was accepted';
  end if;

  v_refused := false;
  begin
    perform public.complete_style_guide_pdf_text_v2(v_failed, 'unused', 'pending', null, null, null, null);
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'contract 6: unsupported outcome was accepted';
  end if;

  raise notice 'issue #2507 PopSG PDF terminal outcome contracts: all 6 checks passed';
end
$contracts$;

rollback;
