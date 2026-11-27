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
  -- The batch rebuild handles this file and reports it.
  if (select last_id from public.popsg_rebuild_vision_tag_cache_batch(null, 1000) limit 1) is null then
    raise exception 'batch rebuild found no vision-tagged file';
  end if;
end
$t$;
rollback;
