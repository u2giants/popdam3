-- Issue #4210: page metadata must not expand once per duplicate tag.
begin;
insert into public.style_guide_files
 (id,root_label,relative_path,directory_path,filename,basename_no_ext,file_extension,
  normalized_name,property_folder,style_guide_folder,size_bytes,modified_at,is_active,thumbnail_url,thumbnail_error)
values
 ('42100000-0000-4000-8000-000000000101','ZZ4210','ZZ4210Licensor/Guide/a.pdf','Guide','a.pdf','a','pdf','a','ZZ4210Property','Guide',100,'2026-10-02',true,null,'retryable'),
 ('42100000-0000-4000-8000-000000000102','ZZ4210','ZZ4210Licensor/Guide/b.ai','Guide','b.ai','b','ai','b','ZZ4210Property','Guide',200,'2026-10-01',true,'https://example.invalid/live.jpg',null);
insert into public.style_guide_search_documents
 (style_guide_file_id,root_label,licensor_name,property_folder,style_guide_folder,
  style_guide_name,directory_path,relative_path,filename,file_extension,tag_names,size_bytes,
  modified_at,thumbnail_url,is_active,pdf_text_status,pdf_text_length,source_identity,search_vector)
select f.id,f.root_label,f.licensor_name,f.property_folder,f.style_guide_folder,
 'Guide',f.directory_path,f.relative_path,f.filename,f.file_extension,
 case when f.file_extension='pdf' then array['first','same','same',null] else array['last','same'] end,
 f.size_bytes,f.modified_at,'https://example.invalid/stale.jpg',true,
 case when f.file_extension='pdf' then 'extracted' end,
 case when f.file_extension='pdf' then 42 else 0 end,md5(f.id::text),to_tsvector('simple','zz4210match')
from public.style_guide_files f where f.root_label='ZZ4210';
insert into public.style_guide_render_queue(style_guide_file_id,status,attempts)
values ('42100000-0000-4000-8000-000000000101','failed',1),
       ('42100000-0000-4000-8000-000000000102','pending',0);
do $contracts$
declare x jsonb; row jsonb; i integer; exts jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 for i in 1..8 loop
  x:=public.search_style_guide_library_v2('guides','zz4210match',p_sort=>'relevance',p_limit=>1);
  row:=x->'results'->0;
  -- file_extensions comes from array_agg(DISTINCT d.extension) with no ORDER BY
  -- in either the snapshot matview or this repair. PostgreSQL does not document
  -- DISTINCT aggregate order, so compare the set, not the array order.
  exts:=coalesce(row->'file_extensions','[]'::jsonb);
  if x->>'total'<>'1' or row->>'matched_file_count'<>'2'
    or row->'tag_names' is distinct from '["first","last","same"]'::jsonb
    or (select coalesce(jsonb_agg(DISTINCT e.value order by e.value),'[]'::jsonb)
          from jsonb_array_elements_text(exts) e(value)) is distinct from '["ai","pdf"]'::jsonb
    or jsonb_array_length(exts) is distinct from 2
    or row->>'thumbnail_url'<>'https://example.invalid/live.jpg'
    or row->'preview_states' is distinct from '["available","missing"]'::jsonb
    or row->'render_exception_states' is distinct from '["none","recoverable_error"]'::jsonb
    or row->'pdf_content_states' is distinct from '["available","not_applicable"]'::jsonb then
   raise exception 'Guide page aggregates changed or stale preview selected';
  end if;
 end loop;
 x:=public.search_style_guide_library_v2('guides','zz4210match',p_extensions=>array['pdf']);
 if x->'results'->0->>'matched_file_count'<>'1'
   or x->'results'->0->'tag_names' is distinct from '["first","same"]'::jsonb then
  raise exception 'Extension filter must aggregate only matching children';
 end if;
 x:=public.search_style_guide_library_v2('guides','zz4210match',p_tags=>array['last']);
 if x->'results'->0->>'matched_file_count'<>'1'
   or x->'results'->0->'pdf_content_states' is distinct from '["not_applicable"]'::jsonb then
  raise exception 'Bound tag filter must retain the exact child result';
 end if;
 x:=public.search_style_guide_library_v2('guides','zz4210match',p_limit=>1,p_offset=>1);
 if x->>'total'<>'1' or x->'results' is distinct from '[]'::jsonb then
  raise exception 'Guide offset must retain total without inventing a page row';
 end if;
 x:=public.search_style_guide_library_v2('guides','zz4210nomatch');
 if x->>'total'<>'0' or x->'results' is distinct from '[]'::jsonb then
  raise exception 'Unmatched guide query must stay empty';
 end if;
 -- Pre-existing sort-key limitation (not introduced by this repair):
 -- group_id keeps NULL and '' distinct via length-prefixed parts, so both
 -- appear as separate guide rows. entity_key / guide_key uses coalesce(...,''),
 -- so those two rows share the final sort tie-break key and their relative
 -- page order is unspecified. This is unchanged from the 20260917024050 body.
 raise notice 'Issue 4210 guide page metadata contracts passed';
 raise notice 'null-vs-empty guide_key sort ties remain unspecified (pre-existing)';
end
$contracts$;
rollback;
