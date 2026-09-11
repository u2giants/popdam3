-- Issue #2506: focused contracts for authorized file/guide search and launch filters.
begin;

set local session_replication_role = replica;
insert into auth.users (id, email) values
  ('25060000-0000-4000-8000-000000000001', 'zz2506-authorized@example.invalid'),
  ('25060000-0000-4000-8000-000000000002', 'zz2506-denied@example.invalid');
set local session_replication_role = origin;

insert into public.profiles (user_id, email) values
  ('25060000-0000-4000-8000-000000000001', 'zz2506-authorized@example.invalid'),
  ('25060000-0000-4000-8000-000000000002', 'zz2506-denied@example.invalid');

insert into public.app_access (user_id, app)
values ('25060000-0000-4000-8000-000000000001', 'styleguides');

do $contracts$
declare
  v_result jsonb;
begin
  if to_regprocedure('public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)') is null then
    raise exception 'contract 1: v2 search RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)', 'execute') then
    raise exception 'contract 1: anon can execute v2 search';
  end if;
  if not has_function_privilege('authenticated', 'public.search_style_guide_library_v2(text,text,text[],text[],text[],text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)', 'execute') then
    raise exception 'contract 1: authenticated lost execute on v2 search';
  end if;

  insert into public.style_guide_files
    (id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
  values
    ('25060000-0000-4000-8000-000000000011', 'ZZ2506', 'TestLicensor/GuideA/alpha.pdf', 'GuideA', 'alpha.pdf', 'alpha', 'pdf', 'alpha', 'TestProperty', 'GuideA', 100, '2026-09-01', true, null, 'retryable'),
    ('25060000-0000-4000-8000-000000000012', 'ZZ2506', 'TestLicensor/GuideA/other.ai', 'GuideA', 'other.ai', 'other', 'ai', 'other', 'TestProperty', 'GuideA', 200, '2026-09-01', true, null, null),
    ('25060000-0000-4000-8000-000000000013', 'ZZ2506', 'TestLicensor/GuideB/alpha.jpg', 'GuideB', 'alpha.jpg', 'alpha', 'jpg', 'alpha', 'TestProperty', 'GuideB', 300, '2026-09-01', true, 'https://example.invalid/preview.jpg', null),
    ('25060000-0000-4000-8000-000000000014', 'ZZ2506', 'TestLicensor/GuideC/alpha.pdf', 'GuideC', 'alpha.pdf', 'alpha', 'pdf', 'alpha', 'TestProperty', 'GuideC', 400, '2026-09-01', true, null, 'terminal'),
    ('25060000-0000-4000-8000-000000000015', 'ZZ2506', 'TestLicensor/Inactive/alpha.pdf', 'Inactive', 'alpha.pdf', 'alpha', 'pdf', 'alpha', 'TestProperty', 'Inactive', 500, '2026-09-01', false, null, null);

  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, thumbnail_url, is_active,
     pdf_text_status, pdf_text_length, source_identity, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
         f.style_guide_folder, f.directory_path, f.relative_path, f.filename,
         f.file_extension, array['alpha-tag'], f.size_bytes, f.modified_at,
         f.thumbnail_url, f.is_active,
         case when f.id = '25060000-0000-4000-8000-000000000011' then 'extracted' else null end,
         case when f.id = '25060000-0000-4000-8000-000000000011' then 25 else 0 end,
         md5(f.id::text),
         to_tsvector('simple', case when f.filename = 'other.ai' then 'other' else 'alpha uniquechildtoken' end)
    from public.style_guide_files f where f.root_label = 'ZZ2506';

  insert into public.style_guide_render_queue
    (style_guide_file_id, status, attempts, error_message)
  values
    ('25060000-0000-4000-8000-000000000011', 'failed', 1, 'retryable'),
    ('25060000-0000-4000-8000-000000000012', 'pending', 0, null),
    ('25060000-0000-4000-8000-000000000014', 'failed', 3, 'terminal');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'guides', p_query => 'uniquechildtoken',
    p_sort => 'modified_desc', p_limit => 1, p_offset => 0
  );
  if (v_result->>'total')::integer <> 3 then
    raise exception 'contract 2: guide child-match total expected 3, got %', v_result->>'total';
  end if;
  if jsonb_array_length(v_result->'results') <> 1
     or v_result->'results'->0->>'result_mode' <> 'guides' then
    raise exception 'contract 2: guide paging did not return one guide result';
  end if;

  -- Same timestamps force the final guide identity tiebreak. Pages must be
  -- stable, distinct, and retain one exact guide total.
  if public.search_style_guide_library_v2('guides', 'uniquechildtoken', p_limit => 1, p_offset => 0)
       ->'results'->0->>'guide_key'
     = public.search_style_guide_library_v2('guides', 'uniquechildtoken', p_limit => 1, p_offset => 1)
       ->'results'->0->>'guide_key' then
    raise exception 'contract 3: guide pages repeated a guide';
  end if;
  if public.search_style_guide_library_v2('guides', 'uniquechildtoken', p_limit => 1, p_offset => 1)
       ->'results'->0->>'guide_key'
     is distinct from public.search_style_guide_library_v2('guides', 'uniquechildtoken', p_limit => 1, p_offset => 1)
       ->'results'->0->>'guide_key' then
    raise exception 'contract 3: repeated guide page is unstable';
  end if;

  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'guides', p_query => 'uniquechildtoken',
    p_preview_states => array['missing'],
    p_render_exception_states => array['recoverable_error'],
    p_pdf_content_states => array['available']
  );
  if (v_result->>'total')::integer <> 1
     or v_result->'results'->0->>'style_guide_name' <> 'GuideA'
     or (v_result->'results'->0->>'matched_file_count')::integer <> 1 then
    raise exception 'contract 4: combined child filters did not yield GuideA once: %', v_result;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result->'facets'->'render_exception_states') facet
     where facet->>'value' = 'recoverable_error' and (facet->>'count')::integer = 1
  ) then
    raise exception 'contract 4: facets do not describe the same filtered guide set';
  end if;

  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'files', p_query => 'uniquechildtoken', p_limit => 200
  );
  if (v_result->>'total')::integer <> 3
     or exists (select 1 from jsonb_array_elements(v_result->'results') item
                 where item->>'style_guide_name' = 'Inactive') then
    raise exception 'contract 5: file mode returned inactive content or a wrong total';
  end if;

  -- Inclusive source-date boundaries must agree with the same filtered child set.
  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'files', p_query => 'uniquechildtoken',
    p_modified_after => '2026-09-01'::timestamptz,
    p_modified_before => '2026-09-01'::timestamptz);
  if (v_result->>'total')::integer <> 3 then
    raise exception 'contract 6: equal inclusive date boundary lost matching files';
  end if;
  if (public.search_style_guide_library_v2('files', 'uniquechildtoken',
       p_modified_before => '2026-08-31'::timestamptz)->>'total')::integer <> 0
     or (public.search_style_guide_library_v2('guides', 'uniquechildtoken',
       p_modified_after => '2026-09-02'::timestamptz)->>'total')::integer <> 0 then
    raise exception 'contract 6: source-date exclusion leaked a file or guide';
  end if;

  -- A repeated child tag contributes once to a guide facet, even with combined filters.
  update public.style_guide_search_documents
     set tag_names = array['alpha-tag', 'alpha-tag', null]
   where style_guide_file_id = '25060000-0000-4000-8000-000000000011';
  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'guides', p_query => 'uniquechildtoken',
    p_preview_states => array['missing'],
    p_render_exception_states => array['recoverable_error'],
    p_pdf_content_states => array['available'],
    p_modified_after => '2026-09-01'::timestamptz,
    p_modified_before => '2026-09-01'::timestamptz);
  if (v_result->>'total')::integer <> 1 or not exists (
    select 1 from jsonb_array_elements(v_result->'facets'->'tags') facet
     where facet->>'value' = 'alpha-tag' and (facet->>'count')::integer = 1
  ) then
    raise exception 'contract 7: combined date/filter guide facets double-count child tags';
  end if;

  -- A guide whose identity carries SQL NULL folders must survive the guide-mode
  -- re-join for results and for the child-derived facets, and must stay a
  -- separate identity from the same guide with empty-string folders.
  insert into public.style_guide_files
    (id, root_label, relative_path, directory_path, filename, basename_no_ext,
     file_extension, normalized_name, property_folder, style_guide_folder,
     size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
  values
    ('25060000-0000-4000-8000-000000000021', 'ZZ2506N', 'NullLic/GuideNull/n1.pdf', 'GuideNull', 'n1.pdf', 'n1', 'pdf', 'n1', null, null, 100, '2026-09-01', true, null, null),
    ('25060000-0000-4000-8000-000000000022', 'ZZ2506N', 'NullLic/GuideEmpty/n2.pdf', 'GuideEmpty', 'n2.pdf', 'n2', 'pdf', 'n2', '', '', 100, '2026-09-01', true, null, null);

  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, thumbnail_url, is_active,
     pdf_text_status, pdf_text_length, source_identity, search_vector)
  values
    ('25060000-0000-4000-8000-000000000021', 'ZZ2506N', 'NullLic', null, null,
     'GuideNull', 'GuideNull', 'NullLic/GuideNull/n1.pdf', 'n1.pdf', 'pdf',
     array['null-tag'], 100, '2026-09-01', null, true, null, 0,
     md5('25060000-0000-4000-8000-000000000021'), to_tsvector('simple', 'nullidentitytoken')),
    ('25060000-0000-4000-8000-000000000022', 'ZZ2506N', 'NullLic', '', '',
     'GuideNull', 'GuideEmpty', 'NullLic/GuideEmpty/n2.pdf', 'n2.pdf', 'pdf',
     array['null-tag'], 100, '2026-09-01', null, true, null, 0,
     md5('25060000-0000-4000-8000-000000000022'), to_tsvector('simple', 'nullidentitytoken'));

  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'guides', p_query => 'nullidentitytoken');
  if (v_result->>'total')::integer <> 2 then
    raise exception 'contract 8: NULL-folder guide identity lost from the guide total';
  end if;
  if jsonb_array_length(v_result->'results') <> 2 then
    raise exception 'contract 8: guide re-join dropped a page row for a NULL identity';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result->'results') item
     where item->>'style_guide_name' = 'GuideNull'
       and item->'property_folder' = 'null'::jsonb
       and item->'style_guide_folder' = 'null'::jsonb
       and (item->>'matched_file_count')::integer = 1
       and item->'file_extensions' = '["pdf"]'::jsonb
       and item->'tag_names' = '["null-tag"]'::jsonb
  ) then
    raise exception 'contract 8: NULL-folder guide row lost its re-joined child aggregates';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result->'results') item
     where item->>'style_guide_name' = 'GuideNull'
       and item->>'property_folder' = ''
       and item->>'style_guide_folder' = ''
  ) then
    raise exception 'contract 8: empty-string folder guide collapsed into the NULL identity';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result->'facets'->'extensions') facet
     where facet->>'value' = 'pdf' and (facet->>'count')::integer = 2
  ) or not exists (
    select 1 from jsonb_array_elements(v_result->'facets'->'tags') facet
     where facet->>'value' = 'null-tag' and (facet->>'count')::integer = 2
  ) then
    raise exception 'contract 8: child-derived guide facets undercount NULL identities';
  end if;

  v_result := public.search_style_guide_library_v2(
    p_result_mode => 'files', p_query => 'nullidentitytoken');
  if (v_result->>'total')::integer <> 2
     or jsonb_array_length(v_result->'results') <> 2 then
    raise exception 'contract 8: file mode lost a child under a NULL guide identity';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    '{"sub":"25060000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform public.search_style_guide_library_v2(p_result_mode => 'files', p_limit => 1);

  perform set_config('request.jwt.claims',
    '{"sub":"25060000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  begin
    perform public.search_style_guide_library_v2(p_result_mode => 'files', p_limit => 1);
    raise exception 'contract 9: user without PopSG access reached search';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  raise notice 'issue #2506 PopSG v2 search contracts: all 9 checks passed';
end
$contracts$;

rollback;
