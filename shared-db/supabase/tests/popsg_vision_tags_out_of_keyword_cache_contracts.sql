-- popdam3#1430: vision_ai tags are kept but never enter the keyword tag cache.
begin;
do $t$
declare
  v_file uuid;
  v_tag_ai uuid;
  v_tag_path uuid;
  v_names text[];
begin
  select id into v_file from public.style_guide_files limit 1;
  if v_file is null then
    raise notice 'no style_guide_files rows; contract skipped';
    return;
  end if;
  insert into public.style_guide_tags (tag, normalized_tag, display_name, facet)
    values ('zz example hero', 'zz example hero', 'zz example hero', 'other') returning id into v_tag_ai;
  insert into public.style_guide_tags (tag, normalized_tag, display_name, facet)
    values ('zz example folder', 'zz example folder', 'zz example folder', 'other') returning id into v_tag_path;
  insert into public.style_guide_file_tags (style_guide_file_id, tag_id, source, facet, confidence, status, rule_version)
    values (v_file, v_tag_ai, 'vision_ai', 'other', 0.9, 'accepted', 'contract'),
           (v_file, v_tag_path, 'path', 'other', 1, 'accepted', 'contract');
  select tag_names into v_names from public.style_guide_files where id = v_file;
  if 'zz example hero' = any(v_names) then
    raise exception 'vision_ai tag entered the keyword tag cache';
  end if;
  if not ('zz example folder' = any(v_names)) then
    raise exception 'path tag missing from the keyword tag cache';
  end if;
  if not exists (select 1 from public.style_guide_file_tags where style_guide_file_id = v_file and tag_id = v_tag_ai) then
    raise exception 'vision_ai tag row was not kept';
  end if;
end
$t$;
rollback;
