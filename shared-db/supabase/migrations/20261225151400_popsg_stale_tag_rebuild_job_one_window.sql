-- derived-from: 20261225151300
-- Re-issue per review finding #7210: one window per run (each run commits its
-- own progress), an advisory lock against overlapping runs, the done flag is
-- honoured, and the schedule is guarded for databases without pg_cron.
-- popdam3#1430: finish the PopSG keyword tag rebuild without the worker.
-- A pg_cron job walks style_guide_files in id order. For each window it
-- recomputes the keyword tag cache (vision_ai excluded, as
-- refresh_style_guide_file_tag_cache does) and rewrites any search document
-- whose tags differ from the file, using the guarded rule of
-- popsg_rebuild_vision_tag_cache_batch: other identity columns must already
-- match; stored text lexemes are reused only when safe. It does not depend
-- on vision_ai rows existing, so it also covers a vision_ai wipe. When the
-- walk ends it unschedules itself. Tag rows are not changed or deleted.

insert into public.admin_config (key, value, updated_at)
values ('POPSG_STALE_TAG_REBUILD', jsonb_build_object('after', null, 'done', false), now())
on conflict (key) do nothing;

create or replace function public.popsg_stale_tag_rebuild_job()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_after uuid;
  v_ids uuid[];
  v_docs integer;
  v_total integer := 0;
  v_done boolean;
begin
  -- One run at a time; an overlapping tick returns without work.
  if not pg_try_advisory_xact_lock(hashtext('popsg-stale-tag-rebuild-1430')) then
    return 0;
  end if;
  select nullif(value->>'after', '')::uuid, coalesce((value->>'done')::boolean, false)
    into v_after, v_done
    from public.admin_config where key = 'POPSG_STALE_TAG_REBUILD';
  if v_done then
    return 0;
  end if;

  -- One window per run, so every run commits its own progress.
  begin

    select array_agg(id order by id) into v_ids from (
      select f.id from public.style_guide_files f
       where v_after is null or f.id > v_after
       order by f.id
       limit 3000
    ) s;

    if v_ids is null then
      update public.admin_config
         set value = jsonb_build_object('after', null, 'done', true, 'finished_at', now()), updated_at = now()
       where key = 'POPSG_STALE_TAG_REBUILD';
      if exists (select 1 from pg_namespace where nspname = 'cron') then
        perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'popsg-stale-tag-rebuild';
      end if;
      return v_total;
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
               || case
                    when d.search_vector is not null
                     and d.pdf_text_length is not distinct from coalesce(t.text_length, 0)
                    then ts_filter(d.search_vector, '{d}')
                    else setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D')
                  end,
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
    v_total := v_total + v_docs;

    v_after := v_ids[array_length(v_ids, 1)];
    update public.admin_config
       set value = jsonb_build_object('after', v_after, 'done', false, 'documents', coalesce((value->>'documents')::integer, 0) + v_docs),
           updated_at = now()
     where key = 'POPSG_STALE_TAG_REBUILD';
  end;
  return v_total;
end;
$function$;
revoke all on function public.popsg_stale_tag_rebuild_job() from public, anon, authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'popsg-stale-tag-rebuild';
    perform cron.schedule('popsg-stale-tag-rebuild', '* * * * *',
      $job$set statement_timeout = '90s'; select public.popsg_stale_tag_rebuild_job()$job$);
  else
    raise notice 'pg_cron not installed; popsg-stale-tag-rebuild not scheduled';
  end if;
end;
$cron$;
