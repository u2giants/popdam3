-- derived-from: 20261105165947
--
-- REISSUE of 20261218025935 (#6663): identical SQL plus the statement
-- terminator missing after the $function$ closer before the DO assertion
-- block (preview apply 44235566632 SQLSTATE 42601 statement 11). The
-- original is retired in RETIRED_VERSION_REASONS and never applied anywhere.
--
-- #6418: matview API surface contract for public.style_guide_folders and
-- public.style_guide_file_groups. Part of the #2326 program (plan Step 6,
-- Step 2 finding 2, materialized_view_in_api half).
--
-- WHY
-- ---
-- Materialized views cannot carry RLS and cannot gate per caller: any role with
-- SELECT reads the entire stored snapshot. Live catalog 2026-11-15: both grant
-- SELECT to authenticated (the 2026-09-10 HTTP probe showed a PopDAM viewer
-- reading 22,045 style_guide_file_groups rows AND a CRM identity reading 384
-- style_guide_folders rows cross-app; anon 401). The matviews also carry
-- meaningless INSERT grants.
--
-- CENSUS (durable artifact: docs/verification/database-efficiency/
-- 20261116T040000Z-step6-6418-matview-census/matview-app-reference-census.md)
-- -----------------------------------------------------------------------
-- Exactly ONE application reads these relations directly: PopDAM's
-- src/pages/popsg/PopSGLibraryPage.tsx (three PostgREST reads of both names, as
-- authenticated), plus popdam3's scripts/popsg-readiness-baseline.mjs (service
-- role). popcrm / poppim-web / dflow_plm / popdam have no direct reads (only
-- generated type files). So: single-app, and PopDAM reads them from the browser
-- as authenticated -> the issue's disposition rule prescribes a caller-gated
-- projection over the matview plus a narrowed matview grant. PopDAM keeps
-- working UNCHANGED because the gated projection takes over the exact REST
-- names.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Rename the snapshots (OIDs, columns and REFRESH capability preserved):
--      style_guide_folders      -> style_guide_folders_snapshot
--      style_guide_file_groups  -> style_guide_file_groups_snapshot
-- 2. Narrow the snapshot grants: revoke ALL from anon and authenticated
--    (keeps postgres / service_role for the refresh path).
-- 3. Recreate the ORIGINAL names as caller-gated definer views over the
--    snapshots, gated on app.has_app_access('dam') — the #2662 batch 1 pattern
--    (20260911124746_crm_definer_views_caller_gate.sql). CRM/anon identities
--    see zero rows; PopDAM identities (app_access dam) see the same rows.
-- 4. Re-point public.refresh_style_guide_matviews(uuid,integer,text) at the
--    renamed snapshots (its two REFRESH statements are the only live
--    references — verified read-only 2026-11-15: no other function or view
--    references either name).
--
-- ROLLBACK (named)
-- ----------------
-- Forward migration: recreate the direct-read path for one release —
--   drop view public.style_guide_folders; drop view public.style_guide_file_groups;
--   alter materialized view public.style_guide_folders_snapshot rename to style_guide_folders;
--   alter materialized view public.style_guide_file_groups_snapshot rename to style_guide_file_groups;
--   grant select, insert on public.style_guide_folders to authenticated;  -- captured grants
--   grant select, insert on public.style_guide_file_groups to authenticated;
--   CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(uuid,integer,text)
--     with the ORIGINAL body (pre-change capture is the two REFRESH lines
--     before renaming; the exact pre-image is the function definition on main
--     before this migration).
-- The old read path (the two names) keeps serving rows through the views for
-- one release; the snapshots are then droppable in a later governed change if
-- the gate is retired.
--
-- PREVIEW PROOF (plan; capture with the PR)
-- -----------------------------------------
-- 1. HTTP probe before/after on preview (status codes + Content-Range counts
--    only): out-of-app identity (anon) stays 401; a no-app-access identity
--    goes from full-snapshot count to 0; a dam-identity keeps its count.
-- 2. PopDAM journey (PopSGLibraryPage reads) unchanged: same relation names,
--    same columns.
-- 3. Contract tests green.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Rename the snapshots. OID-preserving: grants, indexes and the unique
--    index backing REFRESH CONCURRENTLY all follow the relation.
alter materialized view public.style_guide_folders rename to style_guide_folders_snapshot;
alter materialized view public.style_guide_file_groups rename to style_guide_file_groups_snapshot;

-- 2. Narrow the snapshot grants (hygiene + the real fix: no API-role reads).
revoke all on public.style_guide_folders_snapshot from anon, authenticated;
revoke all on public.style_guide_file_groups_snapshot from anon, authenticated;

-- 3. Same-name caller-gated projections (#2662 pattern: definer semantics
--    with an explicit in-view gate).
create view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name));

create view public.style_guide_file_groups with (security_invoker = false) as
  select * from public.style_guide_file_groups_snapshot
  where (select app.has_app_access('dam'::app.app_name));

grant select on public.style_guide_folders to authenticated, service_role;
grant select on public.style_guide_file_groups to authenticated, service_role;

-- 4. Re-point the refresh function at the renamed snapshots (full body; only
--    the two REFRESH target names change).

CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text)
 RETURNS TABLE(refreshed_at timestamp with time zone, search_documents_synced integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch integer := greatest(0, least(coalesce(p_search_batch_size, 5000), 50000));
  v_synced integer := 0;
  v_now timestamptz;
  v_started timestamptz := clock_timestamp();
  v_step text := coalesce(p_step, '');
begin
  if v_step not in ('all', 'file_groups', 'folders', 'search') then
    raise exception
      'refresh_style_guide_matviews: unknown p_step %, expected all|file_groups|folders|search',
      p_step;
  end if;

  if p_run_id is not null then
    update public.style_guide_crawl_runs
       set lifecycle_state = case when lifecycle_state in ('completed','failed','attention_required')
                                  then lifecycle_state else 'refreshing' end,
           refresh_started_at = coalesce(refresh_started_at, now())
     where id = p_run_id;
  end if;

  if v_step in ('all', 'file_groups') then
    refresh materialized view concurrently public.style_guide_file_groups_snapshot;
  end if;

  if v_step in ('all', 'folders') then
    refresh materialized view concurrently public.style_guide_folders_snapshot;
  end if;

  if v_step in ('all', 'search') and v_batch > 0 then
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
              -- #4437 review B1: thumbnail-only changes must re-sync too; they
              -- change content_sha256 and must invalidate the stored vector.
              or d.thumbnail_url is distinct from f.thumbnail_url
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
        pdf_text_status, pdf_text_length, source_identity, content_sha256, search_vector,
        document_updated_at)
      select c.id, c.root_label, c.licensor_name, c.property_folder, c.style_guide_folder,
             c.style_guide_name, c.directory_path, c.relative_path, c.filename, c.file_extension,
             c.tag_names, c.size_bytes, c.modified_at, c.thumbnail_url, c.is_active,
             t.status, coalesce(t.text_length, 0), c.source_identity,
             encode(extensions.digest(c.source_identity || '|' || coalesce(c.thumbnail_url, ''), 'sha256'), 'hex'),
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
            content_sha256 = excluded.content_sha256,
            -- #4437: a changed content identity invalidates the embedding and
            -- requeues it; unchanged content keeps vector, stamp and retry state.
            embedding = case when d.content_sha256
                                  = excluded.content_sha256
                        then d.embedding end,
            embedding_model = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_model end,
            embedding_updated_at = case when d.content_sha256
                                              = excluded.content_sha256
                                  then d.embedding_updated_at end,
            embedding_error = case when d.content_sha256
                                        = excluded.content_sha256
                              then d.embedding_error end,
            embedding_error_category = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_error_category end,
            embedding_next_retry_at = case when d.content_sha256
                                                  = excluded.content_sha256
                                        then d.embedding_next_retry_at end,
            embedding_attempts = case when d.content_sha256
                                            = excluded.content_sha256
                                then d.embedding_attempts else 0 end,
            embedding_max_attempts = case when d.content_sha256
                                                = excluded.content_sha256
                                    then d.embedding_max_attempts
                                    else 5 end,
            embedding_lease_token = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_token end,
            embedding_lease_owner = case when d.content_sha256
                                                = excluded.content_sha256
                                        then d.embedding_lease_owner end,
            embedding_lease_expires_at = case when d.content_sha256
                                                    = excluded.content_sha256
                                            then d.embedding_lease_expires_at end,
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
               or d.thumbnail_url is distinct from f.thumbnail_url
               or d.source_identity is distinct from
                 md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' ||
                     coalesce(f.modified_at::text, '') || '|' || coalesce(f.tag_search_text, '') || '|' ||
                     coalesce(f.style_guide_folder, '') || '|' || coalesce(f.property_folder, '') || '|' ||
                     coalesce(f.licensor_name, '') || '|' || f.is_active::text)));
  end if;

  v_now := now();

  -- Completion stamp only on the step that can finish the refresh work.
  -- Matview-only steps leave the run in 'refreshing' with refresh_completed_at
  -- untouched so a later 'search' call (or a caller that knows no search is
  -- needed) closes the run. 'search' and 'all' accumulate the synced count the
  -- existing popdam3 loop already reads.
  if p_run_id is not null and v_step in ('all', 'search') and v_batch > 0 then
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

-- 5. Assertions: the gate is in place, the snapshots are closed to API roles,
--    and the refresh function no longer names the API-visible relations.
do $$
declare
  v text;
begin
  foreach v in array array['style_guide_folders', 'style_guide_file_groups']
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      raise exception '#6418: gated view public.% missing', v;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v || '_snapshot' and c.relkind = 'm'
    ) then
      raise exception '#6418: snapshot public.%_snapshot missing', v;
    end if;
    if has_table_privilege('anon', 'public.' || v || '_snapshot', 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v || '_snapshot', 'SELECT') then
      raise exception '#6418: snapshot public.%_snapshot still readable by API roles', v;
    end if;
    if pg_get_viewdef(('public.' || v)::regclass) not like '%has_app_access%' then
      raise exception '#6418: gated view public.% lost its caller gate', v;
    end if;
  end loop;

  if pg_get_functiondef(to_regprocedure('public.refresh_style_guide_matviews(uuid,integer,text)'))
     like '%refresh materialized view concurrently public.style_guide_file_groups;%' then
    raise exception '#6418: refresh function still targets the API-visible relation';
  end if;
end $$;

commit;
