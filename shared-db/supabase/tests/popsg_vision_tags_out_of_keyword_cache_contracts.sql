-- popdam3#1430: vision_ai tags are kept but never enter the keyword tag cache
-- (tag_names and tag_search_text). Own fixture rows; rolled back.
begin;
insert into public.style_guide_files
  (id, root_label, relative_path, directory_path, filename, basename_no_ext,
   file_extension, normalized_name, property_folder, style_guide_folder,
   size_bytes, modified_at, is_active, thumbnail_url, thumbnail_error)
values
  ('14300000-0000-4000-8000-000000000001', 'ZZ1430', 'TestLicensor/VisionTags/one.pdf', 'VisionTags', 'one.pdf', 'one', 'pdf', 'one', 'TestProperty', 'VisionTags', 100, '2026-11-01', true, 'https://example.invalid/one.jpg', null);
do $t$
declare
  v_file uuid := '14300000-0000-4000-8000-000000000001';
  v_tag_ai uuid;
  v_tag_path uuid;
  v_names text[];
  v_text text;
begin
  insert into public.style_guide_tags (tag, normalized_tag, display_name, facet)
    values ('zz1430 example hero', 'zz1430 example hero', 'zz1430 example hero', 'other') returning id into v_tag_ai;
  insert into public.style_guide_tags (tag, normalized_tag, display_name, facet)
    values ('zz1430 example folder', 'zz1430 example folder', 'zz1430 example folder', 'other') returning id into v_tag_path;
  insert into public.style_guide_file_tags (style_guide_file_id, tag_id, source, facet, confidence, status, rule_version)
    values (v_file, v_tag_ai, 'vision_ai', 'other', 0.9, 'accepted', 'contract'),
           (v_file, v_tag_path, 'path', 'other', 1, 'accepted', 'contract');
  select tag_names, tag_search_text into v_names, v_text from public.style_guide_files where id = v_file;
  if 'zz1430 example hero' = any(v_names) or v_text like '%zz1430 example hero%' then
    raise exception 'vision_ai tag entered the keyword tag cache: % / %', v_names, v_text;
  end if;
  if not ('zz1430 example folder' = any(v_names)) or v_text not like '%zz1430 example folder%' then
    raise exception 'path tag missing from the keyword tag cache: % / %', v_names, v_text;
  end if;
  if not exists (select 1 from public.style_guide_file_tags where style_guide_file_id = v_file and tag_id = v_tag_ai and status = 'accepted') then
    raise exception 'vision_ai tag row was not kept';
  end if;
  -- A null limit is refused (#7198).
  begin
    perform public.popsg_rebuild_vision_tag_cache_batch(null, null);
    raise exception 'null limit was accepted';
  exception when sqlstate '22023' then null;
  end;
  -- Give the file a search document whose stored text lexemes must survive,
  -- and whose old vector carries the vision tag at weight C.
  insert into public.style_guide_search_documents
    (style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
     style_guide_name, directory_path, relative_path, filename, file_extension,
     tag_names, size_bytes, modified_at, thumbnail_url, is_active,
     pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector)
  select f.id, f.root_label, f.licensor_name, f.property_folder, f.style_guide_folder,
     f.style_guide_folder, f.directory_path, f.relative_path, f.filename, f.file_extension,
     array['zz1430 example hero'], f.size_bytes, f.modified_at, f.thumbnail_url, true,
     null, 0, 'stale', 'stale',
     setweight(to_tsvector('simple', 'zz1430 example hero'), 'C') || setweight(to_tsvector('simple', 'zzkeeptext'), 'D')
    from public.style_guide_files f where f.id = v_file;
  -- The batch rebuild handles this file and reports it.
  if (select last_id from public.popsg_rebuild_vision_tag_cache_batch(null, 1000) limit 1) is null then
    raise exception 'batch rebuild found no vision-tagged file';
  end if;
  if (select search_vector from public.style_guide_search_documents where style_guide_file_id = v_file) @@ to_tsquery('simple', 'hero') then
    raise exception 'vision tag still in the rebuilt search vector';
  end if;
  if not (select search_vector from public.style_guide_search_documents where style_guide_file_id = v_file) @@ to_tsquery('simple', 'zzkeeptext') then
    raise exception 'stored document-text lexemes were lost';
  end if;
end
$t$;
rollback;
