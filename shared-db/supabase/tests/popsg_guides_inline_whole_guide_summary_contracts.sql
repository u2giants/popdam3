-- popdam3#1430 Step 9: guide rows carry whole-guide totals from the snapshot,
-- matching the browser enrichment it replaces (sum of member groups, distinct paths).
begin;
insert into public.style_guide_files
 (id,root_label,relative_path,directory_path,filename,basename_no_ext,file_extension,
  normalized_name,property_folder,style_guide_folder,size_bytes,modified_at,is_active)
values
 ('14300000-0000-4000-8000-000000000001','ZZ1430','ZZ1430Lic/Guide/a.pdf','ZZ1430Lic/Guide','a.pdf','a','pdf','a','ZZ1430Prop','Guide',100,'2026-10-02',true),
 ('14300000-0000-4000-8000-000000000002','ZZ1430','ZZ1430Lic/Guide/b.ai','ZZ1430Lic/Guide','b.ai','b','ai','b','ZZ1430Prop','Guide',200,'2026-10-01',true),
 ('14300000-0000-4000-8000-000000000003','ZZ1430','ZZ1430Lic/Guide/Extra/c.pdf','ZZ1430Lic/Guide/Extra','c.pdf','c','pdf','c','ZZ1430Prop','Guide',50,'2026-10-03',true),
 ('14300000-0000-4000-8000-000000000004','ZZ1430','ZZ1430Lic/Loose/d.pdf','ZZ1430Lic/Loose','d.pdf','d','pdf','d','ZZ1430Loose',null,7,'2026-10-04',true);
insert into public.style_guide_search_documents
 (style_guide_file_id,root_label,licensor_name,property_folder,style_guide_folder,
  style_guide_name,directory_path,relative_path,filename,file_extension,tag_names,size_bytes,
  modified_at,is_active,source_identity,search_vector)
select f.id,f.root_label,f.licensor_name,f.property_folder,f.style_guide_folder,
 coalesce(nullif(f.style_guide_folder,''),nullif(f.property_folder,''),f.licensor_name,'Unfiled'),
 f.directory_path,f.relative_path,f.filename,f.file_extension,array[]::text[],f.size_bytes,f.modified_at,true,
 md5(f.id::text),to_tsvector('simple','zz1430match')
from public.style_guide_files f where f.root_label='ZZ1430';
refresh materialized view public.style_guide_file_groups_snapshot;
do $contracts$
declare x jsonb; g jsonb; l jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 x:=public.search_style_guide_library_v2('guides','zz1430match',p_sort=>'name_asc');
 select r into g from jsonb_array_elements(x->'results') r where r->>'style_guide_name'='Guide';
 select r into l from jsonb_array_elements(x->'results') r where r->>'property_folder'='ZZ1430Loose';
 if g is null or (g->>'whole_guide_file_count')::int<>3 or (g->>'total_size_bytes')::bigint<>350
   or g->'member_directory_paths' is distinct from '["ZZ1430Lic/Guide","ZZ1430Lic/Guide/Extra"]'::jsonb then
  raise exception 'Multi-directory guide must carry whole-guide totals: %', g;
 end if;
 if l is null or (l->>'whole_guide_file_count')::int<>1 or (l->>'total_size_bytes')::bigint<>7
   or l->'member_directory_paths' is distinct from '["ZZ1430Lic/Loose"]'::jsonb then
  raise exception 'Null-folder guide must carry its own totals: %', l;
 end if;
 -- A filter narrows matched files but the card still describes the whole guide.
 x:=public.search_style_guide_library_v2('guides','zz1430match',p_extensions=>array['ai']);
 g:=x->'results'->0;
 if (g->>'matched_file_count')::int<>1 or (g->>'whole_guide_file_count')::int<>3
   or (g->>'total_size_bytes')::bigint<>350 then
  raise exception 'Filtered guide must keep whole-guide totals: %', g;
 end if;
 raise notice 'popdam3#1430 inline whole-guide summary contracts passed';
end
$contracts$;
rollback;
