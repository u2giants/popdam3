-- Issue #3023; claim #3113. The nightly PopSG crawl failed because
-- public.refresh_style_guide_matviews exceeded the unchanged eight-second
-- statement timeout at about 217k files.
-- derived-from: 20260905104802
-- Production diagnosis (read-only EXPLAIN ANALYZE): the two concurrent matview
-- refreshes take about 2.6 s together; the search-document candidate scan took
-- about 11.6 s even when it found zero rows, because it probed every active
-- file against its search document to compare an md5 identity.
-- Change: an AFTER trigger on style_guide_files enqueues a file id into a
-- narrow queue table whenever an active file is inserted or any identity input
-- changes. The refresh reads candidates from that queue, keeps the exact
-- identity comparison and upsert unchanged, then retires satisfied entries. A
-- narrow queue is used instead of a flag on style_guide_files because flipping
-- a flag there rewrites every index entry (about 3.7 ms per row). Signature,
-- return shape, grants, batch bound and caller contract are unchanged. No
-- timeout changes.
-- Review of PR #3118: the eight-second limit is set on the authenticator role
-- (the API path the crawler calls through), not on the postgres role that
-- applies migrations, so the one-time seed at the end of this file (about 12 s
-- read-only on production) runs without a timeout change. It runs while the
-- trigger's table lock is held, so no concurrent change can slip between the
-- seed and the trigger; apply outside the nightly crawl window.
-- Accepted gap: a search document deleted out-of-band, or a file written with
-- triggers disabled, is not requeued until its next identity change. Nothing in
-- the repository does either; re-running the seed statement repairs it. A
-- per-call sweep is not added because the cheapest missing-document anti-join
-- alone takes about 3.7 s on production.

create table if not exists public.style_guide_search_sync_queue (
  style_guide_file_id uuid primary key,
  queued_at timestamptz not null default clock_timestamp()
);

comment on table public.style_guide_search_sync_queue is
  'Issue #3023. Files whose search document may be missing or stale. Filled by trg_style_guide_files_queue_search_sync, drained by refresh_style_guide_matviews. Internal; service-role only.';

alter table public.style_guide_search_sync_queue enable row level security;
revoke all on table public.style_guide_search_sync_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.style_guide_search_sync_queue to service_role;

create or replace function public.style_guide_files_queue_search_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE'
     and new.relative_path is not distinct from old.relative_path
     and new.size_bytes is not distinct from old.size_bytes
     and new.modified_at is not distinct from old.modified_at
     and new.tag_search_text is not distinct from old.tag_search_text
     and new.style_guide_folder is not distinct from old.style_guide_folder
     and new.property_folder is not distinct from old.property_folder
     and new.licensor_name is not distinct from old.licensor_name
     and new.is_active is not distinct from old.is_active then
    return null;
  end if;

  if new.is_active then
    insert into public.style_guide_search_sync_queue (style_guide_file_id)
    values (new.id)
    on conflict (style_guide_file_id) do update
      set queued_at = excluded.queued_at;
  end if;

  return null;
end;
$function$;

comment on function public.style_guide_files_queue_search_sync() is
  'Issue #3023. Enqueues an active style_guide_files row for search-document sync when it is inserted or any source_identity input changes.';

revoke all on function public.style_guide_files_queue_search_sync() from public, anon, authenticated;

drop trigger if exists trg_style_guide_files_queue_search_sync on public.style_guide_files;
create trigger trg_style_guide_files_queue_search_sync
  after insert or update on public.style_guide_files
  for each row execute function public.style_guide_files_queue_search_sync();

create or replace function public.refresh_style_guide_matviews(
  p_run_id uuid default null,
  p_search_batch_size integer default 5000
)
returns table (
  refreshed_at timestamptz,
  search_documents_synced integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch integer := greatest(0, least(coalesce(p_search_batch_size, 5000), 50000));
  v_synced integer := 0;
  v_now timestamptz;
  v_started timestamptz := clock_timestamp();
begin
  if p_run_id is not null then
    update public.style_guide_crawl_runs
       set lifecycle_state = case when lifecycle_state in ('completed','failed','attention_required')
                                  then lifecycle_state else 'refreshing' end,
           refresh_started_at = coalesce(refresh_started_at, now())
     where id = p_run_id;
  end if;

  -- BOTH concurrently. style_guide_folders became eligible in this migration when
  -- sgfolders_licensor_property_uidx was created; before it, this second refresh
  -- took an ACCESS EXCLUSIVE lock and blocked every reader.
  refresh materialized view concurrently public.style_guide_file_groups;
  refresh materialized view concurrently public.style_guide_folders;

  if v_batch > 0 then
    with candidates as (
      select f.id,
             f.root_label,
             f.licensor_name,
             f.property_folder,
             f.style_guide_folder,
             coalesce(nullif(f.style_guide_folder, ''), nullif(f.property_folder, ''),
                      f.licensor_name, 'Unfiled') as style_guide_name,
             f.directory_path,
             f.relative_path,
             f.filename,
             f.file_extension,
             f.tag_names,
             f.size_bytes,
             f.modified_at,
             f.thumbnail_url,
             f.is_active,
             md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text) as source_identity
        from public.style_guide_search_sync_queue q
        join public.style_guide_files f on f.id = q.style_guide_file_id
        left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
       where (p_run_id is null or f.crawl_run_id = p_run_id)
         and f.is_active
         and (d.style_guide_file_id is null
              -- A file that went stale and later came back unchanged keeps its
              -- stored source_identity, but reconcile_stale_sg_files_batch left
              -- the document is_active = false. Without this clause the row is
              -- never re-selected and stays invisible to unified search forever.
              or d.is_active is distinct from f.is_active
              or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text))
       order by q.style_guide_file_id
       limit v_batch
    ), upserted as (
      insert into public.style_guide_search_documents as d (
        style_guide_file_id, root_label, licensor_name, property_folder, style_guide_folder,
        style_guide_name, directory_path, relative_path, filename, file_extension,
        tag_names, size_bytes, modified_at, thumbnail_url, is_active,
        pdf_text_status, pdf_text_length, source_identity, search_vector, document_updated_at)
      select c.id, c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder,
             c.style_guide_name, c.directory_path, c.relative_path, c.filename, c.file_extension,
             c.tag_names, c.size_bytes, c.modified_at, c.thumbnail_url, c.is_active,
             t.status, coalesce(t.text_length, 0), c.source_identity,
             setweight(to_tsvector('simple', coalesce(c.filename, '')), 'A')
             || setweight(to_tsvector('simple', coalesce(c.style_guide_name, '') || ' ' ||
                                                coalesce(c.property_folder, '') || ' ' ||
                                                coalesce(c.licensor_name, '')), 'B')
             || setweight(to_tsvector('simple', coalesce(c.relative_path, '') || ' ' ||
                                                array_to_string(c.tag_names, ' ')), 'C')
             || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
             now()
        from candidates c
        left join public.style_guide_pdf_text t on t.style_guide_file_id = c.id
      on conflict (style_guide_file_id) do update
        set root_label = excluded.root_label,
            licensor_name = excluded.licensor_name,
            property_folder = excluded.property_folder,
            style_guide_folder = excluded.style_guide_folder,
            style_guide_name = excluded.style_guide_name,
            directory_path = excluded.directory_path,
            relative_path = excluded.relative_path,
            filename = excluded.filename,
            file_extension = excluded.file_extension,
            tag_names = excluded.tag_names,
            size_bytes = excluded.size_bytes,
            modified_at = excluded.modified_at,
            thumbnail_url = excluded.thumbnail_url,
            is_active = excluded.is_active,
            pdf_text_status = excluded.pdf_text_status,
            pdf_text_length = excluded.pdf_text_length,
            source_identity = excluded.source_identity,
            search_vector = excluded.search_vector,
            document_updated_at = now()
      returning d.style_guide_file_id
    )
    select count(*)::integer into v_synced from upserted;

    -- Retire queue entries that are satisfied: the file is gone or inactive
    -- (reconcile deactivates file and document together, and reactivation
    -- requeues), or its document already matches the file's current identity.
    -- Only entries queued before this call started are retired. The trigger
    -- re-stamps queued_at on every change, which locks the entry, so a change
    -- that races this call is re-checked and kept for the next call.
    delete from public.style_guide_search_sync_queue q
     where q.queued_at < v_started
       and not exists (
       select 1
         from public.style_guide_files f
         left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
        where f.id = q.style_guide_file_id
          and f.is_active
          and (d.style_guide_file_id is null
               or d.is_active is distinct from f.is_active
               or d.source_identity is distinct from
               md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                 coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                 coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                 coalesce(f.licensor_name, '') || '|' || f.is_active::text)));
  end if;

  v_now := now();

  if p_run_id is not null then
    update public.style_guide_crawl_runs
       set refresh_completed_at = v_now,
           -- qualified: `search_documents_synced` is also this function's output
           -- parameter, so the bare name would be ambiguous
           search_documents_synced = style_guide_crawl_runs.search_documents_synced + v_synced
     where id = p_run_id;
  end if;

  refreshed_at := v_now;
  search_documents_synced := v_synced;
  return next;
end;
$function$;

comment on function public.refresh_style_guide_matviews(uuid, integer) is
  'Issues #2212, #3023. Refreshes both style-guide matviews CONCURRENTLY, records aggregate freshness against a crawl run, and syncs a BOUNDED slice of search documents drawn from style_guide_search_sync_queue instead of scanning every file. Service-role only.';

-- Seed the queue with every active file whose search document is currently
-- missing or stale, so nothing that drifted before the trigger existed is lost.
insert into public.style_guide_search_sync_queue (style_guide_file_id)
select f.id
  from public.style_guide_files f
  left join public.style_guide_search_documents d on d.style_guide_file_id = f.id
 where f.is_active
   and (d.style_guide_file_id is null
        or d.is_active is distinct from f.is_active
        or d.source_identity is distinct from
           md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
               coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
               coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
               coalesce(f.licensor_name, '') || '|' || f.is_active::text))
on conflict (style_guide_file_id) do nothing;
