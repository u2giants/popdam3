-- Issue #4210: style_guide_file_preview_state mirrors style_guide_files exactly.
begin;
insert into public.style_guide_files
 (id,root_label,relative_path,directory_path,filename,basename_no_ext,file_extension,
  normalized_name,property_folder,style_guide_folder,size_bytes,modified_at,is_active,thumbnail_url,thumbnail_error)
values
 ('42100000-0000-4000-8000-000000000201','ZZ4210M','ZZ4210M/G/a.pdf','G','a.pdf','a','pdf','a','P','G',1,'2026-10-02',true,null,null),
 ('42100000-0000-4000-8000-000000000202','ZZ4210M','ZZ4210M/G/b.pdf','G','b.pdf','b','pdf','b','P','G',1,'2026-10-02',true,'https://example.invalid/t.jpg',null),
 ('42100000-0000-4000-8000-000000000203','ZZ4210M','ZZ4210M/G/c.pdf','G','c.pdf','c','pdf','c','P','G',1,'2026-10-02',true,null,'boom');
update public.style_guide_files set thumbnail_url='https://example.invalid/u.jpg' where id='42100000-0000-4000-8000-000000000201';
update public.style_guide_files set is_active=false where id='42100000-0000-4000-8000-000000000202';
update public.style_guide_files set thumbnail_error=null where id='42100000-0000-4000-8000-000000000203';
do $contracts$
begin
  if exists (
    select 1 from public.style_guide_files f
    full join public.style_guide_file_preview_state s on s.style_guide_file_id = f.id
    where s.style_guide_file_id is null or f.id is null
       or s.is_active is distinct from f.is_active
       or s.has_preview is distinct from (f.thumbnail_url is not null)
       or s.has_error is distinct from (f.thumbnail_url is null and f.thumbnail_error is not null)
  ) then
    raise exception 'preview-state mirror drifted from style_guide_files';
  end if;
  delete from public.style_guide_files where root_label='ZZ4210M';
  if exists (select 1 from public.style_guide_file_preview_state
              where style_guide_file_id::text like '42100000-0000-4000-8000-0000000002%') then
    raise exception 'preview-state mirror kept a deleted file';
  end if;
  if has_table_privilege('authenticated','public.style_guide_file_preview_state','select')
     or has_table_privilege('anon','public.style_guide_file_preview_state','select') then
    raise exception 'preview-state mirror must not be readable by browser roles';
  end if;
end
$contracts$;
rollback;
