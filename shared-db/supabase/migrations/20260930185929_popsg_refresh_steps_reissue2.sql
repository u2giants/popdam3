-- Issue #3458; claim #3483 reissued (second time) from 20260929040458.
-- Replacement of 20260929040458 (merged in PR #3672), which can never be
-- promoted: preview holds it only through ledger reconciliation run
-- 36546629950 (rename of 20260928145444); the only real preview apply was run
-- 36456516739 under version 20260928145444, so no preview run ever recorded
-- evidence for 20260929040458, and the merged-main rehearsal refuses it as
-- already applied on preview (run 36760878045). Production has never held it.
-- 20260929040458 is RETIRED (HARD_BLOCKED in production_migration_guard.py);
-- never promote it. This version carries the identical executable SQL, which
-- is idempotent (CREATE OR REPLACE, COMMENT, REVOKE/GRANT, catalogue-only
-- verify), so it is safe on preview where the objects already exist.
-- Header of 20260929040458 follows unchanged.
-- Issue #3458 (successor tracking #3671); claim #3483 reissued from 20260928003740.
-- Replacement of 20260928003740, which merged in PR #3487 but can never be
-- promoted: its only preview apply (run 36427442828) ran at PR head b38c082a
-- before PR #3641 changed the migrations workflow, so its evidence cannot bind
-- merge commit 4b451fb0, and preview already holds that version. Same
-- precedent as 20260914061331 -> 20260914075758 (#2879 / #2885).
-- 20260928003740 is RETIRED (HARD_BLOCKED in production_migration_guard.py);
-- never promote it. This version carries the identical executable SQL.
-- Idempotent: CREATE OR REPLACE, COMMENT, REVOKE/GRANT and a catalogue-only
-- verify block, so it is safe whether or not 20260928003740 already ran
-- (preview has it; production does not). Final state equals 20260928003740's.
-- Original header (20260928003740): Issue #3458; claim #3483. PopSG nightly public.refresh_style_guide_matviews
-- still times out on change nights (nights with deactivations or new files)
-- because one RPC statement runs BOTH CONCURRENTLY matview refreshes AND the
-- search-document sync under the unchanged 8s authenticator ceiling.
-- #3023 (PR #3118, migration 20260917005221) replaced the full-file search
-- scan with a queue but left the work in a single statement.
-- derived-from: 20260917005221
-- Change: add a separately-steppable overload
--   public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text)
-- with p_step in ('file_groups', 'folders', 'search', 'all'). Each step is its
-- own RPC statement so each one stays under the normal ceiling. The existing
-- (uuid, integer) overload is deliberately NOT rewritten: its body stays
-- byte-identical so the live production catalog contract
-- (popsg_refresh_search_sync_queue_v1, md5(prosrc) of the 2-arg form) and the
-- existing popsg_bounded_crawl_and_search_contracts tests keep passing, and
-- legacy callers keep resolving. No statement timeout is raised anywhere.
-- New caller contract (popdam3 complete-style-guide-crawl) is in the PR body.

create or replace function public.refresh_style_guide_matviews(
  p_run_id uuid,
  p_search_batch_size integer,
  p_step text
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
    refresh materialized view concurrently public.style_guide_file_groups;
  end if;

  if v_step in ('all', 'folders') then
    refresh materialized view concurrently public.style_guide_folders;
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

comment on function public.refresh_style_guide_matviews(uuid, integer, text) is
  'Issue #3458. Steppable refresh: p_step selects file_groups | folders | search | all. Each step is one RPC statement so change-night work fits under the unchanged 8s authenticator ceiling. search drains style_guide_search_sync_queue in p_search_batch_size slices and accumulates search_documents_synced on the crawl run. Service-role only.';

comment on function public.refresh_style_guide_matviews(uuid, integer) is
  'Issues #2212, #3023. Legacy all-in-one overload (both matview refreshes plus one search batch in a single statement). Left in place for existing callers; on change nights it can still exceed the 8s ceiling. Use the (uuid,integer,text) overload with p_step for separately callable steps (issue #3458). Service-role only.';

revoke all on function public.refresh_style_guide_matviews(uuid, integer, text) from public;
revoke all on function public.refresh_style_guide_matviews(uuid, integer, text) from anon;
revoke all on function public.refresh_style_guide_matviews(uuid, integer, text) from authenticated;
grant execute on function public.refresh_style_guide_matviews(uuid, integer, text) to service_role;

-- Issue #3458 review note: the search-step retire predicate filters on
-- q.queued_at (`where q.queued_at < v_started`). The queue table's primary
-- key is style_guide_file_id alone. On a typical change night the queue holds
-- only the delta rows (new/changed files since the last run), so the scan is
-- bounded by the change volume, not the full library. An index on queued_at
-- would serve the predicate but expands this claim's structural writes beyond
-- the admitted function scope; the bounded-scan argument is accepted instead.

-- Catalogue-only self verification (no data scans)
do $verify$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'public.refresh_style_guide_matviews(uuid,integer,text)',
    'public.refresh_style_guide_matviews(uuid,integer)'] loop
    if to_regprocedure(v_name) is null then
      v_missing := v_missing || v_name;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'issue #3458 migration did not create: %', array_to_string(v_missing, ', ');
  end if;

  if not has_function_privilege('service_role', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute') then
    raise exception 'issue #3458: service_role cannot execute the steppable refresh overload';
  end if;
  if has_function_privilege('authenticated', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute')
     or has_function_privilege('anon', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute')
     or has_function_privilege('public', 'public.refresh_style_guide_matviews(uuid,integer,text)', 'execute') then
    raise exception 'issue #3458: the steppable refresh overload is exposed to API roles';
  end if;

  -- The steppable overload must actually gate each step, read the queue (not
  -- every file), and keep the returning-file reactivation clause.
  if position('if v_step in (''all'', ''file_groups'')' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0
     or position('if v_step in (''all'', ''folders'')' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0
     or position('if v_step in (''all'', ''search'')' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0 then
    raise exception 'issue #3458: the steppable refresh overload does not gate file_groups/folders/search separately';
  end if;
  if position('from public.style_guide_search_sync_queue q' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0 then
    raise exception 'issue #3458: the steppable refresh overload does not read the search sync queue';
  end if;
  if position('d.is_active is distinct from f.is_active' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0 then
    raise exception 'issue #3458: the steppable refresh overload lost the returning-file reactivation clause';
  end if;
  if position('refresh materialized view concurrently public.style_guide_file_groups' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0
     or position('refresh materialized view concurrently public.style_guide_folders' in
              pg_get_functiondef('public.refresh_style_guide_matviews(uuid,integer,text)'::regprocedure)) = 0 then
    raise exception 'issue #3458: the steppable refresh overload does not refresh both matviews CONCURRENTLY';
  end if;

  -- Constraint 1 is an accepted invariant of this claim: the legacy 2-arg body
  -- is byte-identical. Pin it here so a future rewrite fails this migration's
  -- own verify block, not only the external catalog contract.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer)')
       and p.prosecdef
       and md5(p.prosrc) = '52b676f90e4500dc323c2f9e6e6f3c97') then
    raise exception 'issue #3458: legacy 2-arg prosrc md5 or definer posture drifted from popsg_refresh_search_sync_queue_v1';
  end if;

  -- The steppable overload must keep the same definer/search_path posture.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.refresh_style_guide_matviews(uuid,integer,text)')
       and p.prosecdef
       and coalesce(p.proconfig, '{}') && array['search_path=public']::text[]) then
    raise exception 'issue #3458: the steppable overload lost SECURITY DEFINER or its fixed search_path';
  end if;

  -- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index on each
  -- matview. Assert both, so a dropped index fails loudly here. The index must
  -- be a plain-column, non-partial unique index (indexprs IS NULL AND indpred
  -- IS NULL) -- exactly what CONCURRENTLY requires. The earlier file_groups
  -- migration creates sgfilegroups_group_uidx only when no unique index exists;
  -- an existing valid unique index can therefore have a different name.
  if not exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indrelid
     where c.oid = 'public.style_guide_file_groups'::regclass
       and i.indisunique
       and i.indisvalid
       and i.indexprs is null
       and i.indpred is null)
     or not exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
     where c.oid = 'public.style_guide_folders'::regclass
       and i.indisunique
       and i.indisvalid
       and i.indexprs is null
       and i.indpred is null
       and ic.relname = 'sgfolders_licensor_property_uidx') then
    raise exception 'issue #3458: a CONCURRENTLY-enabling plain-column non-partial unique index is missing on style_guide_file_groups or style_guide_folders';
  end if;
end
$verify$;
