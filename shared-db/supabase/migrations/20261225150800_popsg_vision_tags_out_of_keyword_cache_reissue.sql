-- derived-from: 20260723170000
-- Re-issue of retired 20261225150700 (PR #7188, held by review finding #7189),
-- with the rebuild restricted per that finding.
-- PopSG: picture-guessed (vision_ai) tags stay stored but no longer feed the
-- keyword tag cache (style_guide_files.tag_names / tag_search_text), so they
-- cannot make a name search match files whose folders are about something
-- else (popdam3#1430 accuracy regression). Folder, filename, path, manual and
-- deterministic tags still feed it. Tag rows are not changed or deleted.

create or replace function public.refresh_style_guide_file_tag_cache(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tags text[];
  v_search text;
begin
  select
    coalesce(array_agg(distinct t.tag order by t.tag), '{}'::text[]),
    coalesce(string_agg(distinct t.tag, ' ' order by t.tag), '')
  into v_tags, v_search
  from public.style_guide_file_tags ft
  join public.style_guide_tags t on t.id = ft.tag_id
  where ft.style_guide_file_id = p_file_id
    and ft.status = 'accepted'
    and ft.source <> 'vision_ai'
    and t.is_active;

  update public.style_guide_files
  set tag_names = v_tags,
      tag_search_text = v_search
  where id = p_file_id
    and (tag_names is distinct from v_tags or tag_search_text is distinct from v_search);
end;
$$;
revoke all on function public.refresh_style_guide_file_tag_cache(uuid) from public;
grant execute on function public.refresh_style_guide_file_tag_cache(uuid) to service_role;

-- One-time rebuild. The cache is rebuilt only where it changes. A search
-- document is rewritten only when its tags differ AND every other column the
-- source identity covers already matches the file; documents with other
-- pending changes stay dirty for refresh_style_guide_matviews (#7189).
create temporary table popsg_vision_files on commit drop as
  select distinct style_guide_file_id as id
    from public.style_guide_file_tags
   where source = 'vision_ai' and status = 'accepted';

update public.style_guide_files f
   set tag_names = c.tags,
       tag_search_text = c.txt
  from (
    select v.id,
           coalesce(array_agg(distinct t.tag order by t.tag) filter (where t.tag is not null), '{}'::text[]) as tags,
           coalesce(string_agg(distinct t.tag, ' ' order by t.tag), '') as txt
      from popsg_vision_files v
      left join public.style_guide_file_tags ft
        on ft.style_guide_file_id = v.id and ft.status = 'accepted' and ft.source <> 'vision_ai'
      left join public.style_guide_tags t on t.id = ft.tag_id and t.is_active
     group by v.id
  ) c
 where f.id = c.id
   and (f.tag_names is distinct from c.tags or f.tag_search_text is distinct from c.txt);

update public.style_guide_search_documents d
   set tag_names = f.tag_names,
       source_identity = md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text),
       search_vector =
           setweight(to_tsvector('simple', coalesce(d.filename, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(d.style_guide_name, '') || ' ' ||
                                              coalesce(d.property_folder, '') || ' ' ||
                                              coalesce(d.licensor_name, '')), 'B')
           || setweight(to_tsvector('simple', coalesce(d.relative_path, '') || ' ' ||
                                              array_to_string(f.tag_names, ' ')), 'C')
           || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
       document_updated_at = now()
  from public.style_guide_files f
  join popsg_vision_files v on v.id = f.id
  left join public.style_guide_pdf_text t on t.style_guide_file_id = f.id
 where d.style_guide_file_id = f.id
   and f.is_active
   and d.is_active
   and d.tag_names is distinct from f.tag_names
   and d.relative_path is not distinct from f.relative_path
   and d.filename is not distinct from f.filename
   and d.size_bytes is not distinct from f.size_bytes
   and d.modified_at is not distinct from f.modified_at
   and d.style_guide_folder is not distinct from f.style_guide_folder
   and d.property_folder is not distinct from f.property_folder
   and d.licensor_name is not distinct from f.licensor_name;
