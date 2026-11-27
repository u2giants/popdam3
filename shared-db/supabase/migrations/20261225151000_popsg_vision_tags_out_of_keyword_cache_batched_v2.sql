-- derived-from: 20260723170000
-- Re-issue of retired 20261225150700/150800/150900 (popdam3#1430). 150900 is
-- replaced per review finding #7198 (content_sha256 kept in step with
-- source_identity, null limit refused). 150800's
-- single-statement rebuild hit the production statement timeout and rolled
-- back (run 46043726223). This version changes only the tag cache rule and
-- adds a bounded batch function; the worker drains the rebuild in slices.
--
-- PopSG: picture-guessed (vision_ai) tags stay stored but no longer feed the
-- keyword tag cache (style_guide_files.tag_names / tag_search_text). Tag rows
-- are not changed or deleted.

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

-- Rebuild the keyword cache and, where safe, the search document for up to
-- p_limit files with accepted vision_ai tags, in id order after p_after.
-- A document is rewritten only when its tags differ and every other column
-- its source identity covers already matches the file; other documents stay
-- queued for refresh_style_guide_matviews (#7189). Returns the last file id
-- handled (null when done) and the counts.
create or replace function public.popsg_rebuild_vision_tag_cache_batch(p_after uuid, p_limit integer)
returns table(last_id uuid, files_changed integer, documents_changed integer)
language plpgsql
security definer
set search_path = public, extensions
set statement_timeout = '20s'
as $$
declare
  v_ids uuid[];
  v_files integer := 0;
  v_docs integer := 0;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'popsg_rebuild_vision_tag_cache_batch: p_limit must be 1..1000' using errcode = '22023';
  end if;
  select array_agg(id order by id) into v_ids from (
    select distinct ft.style_guide_file_id as id
      from public.style_guide_file_tags ft
     where ft.source = 'vision_ai' and ft.status = 'accepted'
       and (p_after is null or ft.style_guide_file_id > p_after)
     order by 1
     limit least(p_limit, 1000)
  ) s;
  if v_ids is null then
    return query select null::uuid, 0, 0;
    return;
  end if;

  update public.style_guide_files f
     set tag_names = c.tags,
         tag_search_text = c.txt
    from (
      select v.id,
             coalesce(array_agg(distinct t.tag order by t.tag) filter (where t.tag is not null), '{}'::text[]) as tags,
             coalesce(string_agg(distinct t.tag, ' ' order by t.tag), '') as txt
        from unnest(v_ids) as v(id)
        left join public.style_guide_file_tags ft
          on ft.style_guide_file_id = v.id and ft.status = 'accepted' and ft.source <> 'vision_ai'
        left join public.style_guide_tags t on t.id = ft.tag_id and t.is_active
       group by v.id
    ) c
   where f.id = c.id
     and (f.tag_names is distinct from c.tags or f.tag_search_text is distinct from c.txt);
  get diagnostics v_files = row_count;

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
         -- Same formula as refresh_style_guide_matviews, so the embedding
         -- pipeline sees the same change it would from the canonical writer.
         content_sha256 = encode(extensions.digest(
             md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text)
             || '|' || coalesce(f.thumbnail_url, ''), 'sha256'), 'hex'),
         document_updated_at = now()
    from public.style_guide_files f
    left join public.style_guide_pdf_text t on t.style_guide_file_id = f.id
   where f.id = any(v_ids)
     and d.style_guide_file_id = f.id
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
  get diagnostics v_docs = row_count;

  return query select v_ids[array_length(v_ids, 1)], v_files, v_docs;
end;
$$;
revoke all on function public.popsg_rebuild_vision_tag_cache_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.popsg_rebuild_vision_tag_cache_batch(uuid, integer) to service_role;
