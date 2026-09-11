-- Issue #2212 -- PopSG bounded crawl reconciliation, PDF text extraction, and the
-- unified search contract.
--
-- WHY THIS EXISTS
-- ---------------
-- `public.deactivate_stale_sg_files(text, uuid)` issued ONE unbounded UPDATE over
-- every active row of a crawl root, and `public.refresh_style_guide_matviews()`
-- refreshed `public.style_guide_folders` NON-concurrently (it had no unique index,
-- so CONCURRENTLY was impossible). During an ordinary production crawl both timed
-- out while `style_guide_crawl_runs.status` had ALREADY been set to 'completed'.
-- The run therefore reported success over a library that had never been reconciled
-- and aggregates that were never refreshed.
--
-- It is also a live security defect: `deactivate_stale_sg_files` is SECURITY
-- DEFINER and `authenticated` holds EXECUTE on it, so any signed-in user could
-- inactivate an entire style-guide root.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--  1. Adds explicit lifecycle state and counters to `style_guide_crawl_runs`, and
--     a CHECK constraint that makes "completed" IMPOSSIBLE before reconciliation
--     and aggregate freshness have both been recorded. Declarative, not a trigger.
--  2. Adds `preview_stale_sg_files` -- a read-only candidate/guard preview that
--     mutates nothing.
--  3. Adds `reconcile_stale_sg_files_batch` -- deterministic, bounded, idempotent,
--     resumable batch reconciliation keyed on (root_label, accepted crawl run).
--  4. Rewrites `deactivate_stale_sg_files` to delegate to the guarded bounded
--     batch, and REVOKES it from `authenticated` and `PUBLIC`.
--  5. Gives `style_guide_folders` a unique index so BOTH matviews refresh
--     CONCURRENTLY (non-blocking), and rewrites `refresh_style_guide_matviews`
--     to record freshness against the run and to sync a BOUNDED slice of search
--     documents.
--  6. Adds `style_guide_pdf_text` with restart-safe claim/complete RPCs keyed to
--     ACTIVE `style_guide_files`, invalidating on content-identity change.
--  7. Adds `style_guide_search_documents` and ONE authorized RPC,
--     `search_style_guide_library`, with required filters, stable ranking and
--     pagination, an exact total, and matching facets.
--
-- NO BULK BACKFILL AND NO FULL AGGREGATE REBUILD. Search documents and PDF-text
-- rows are created incrementally in bounded slices by the RPCs above. The only
-- row writes here are to the 133 rows of `style_guide_crawl_runs`, which is
-- required to satisfy the new CHECK constraint.
--
-- LEAST PRIVILEGE. Every continuation RPC (preview, reconcile, refresh, claim,
-- complete, and the rewritten deactivate) is service-role only. The single
-- read-only search RPC is the one thing `authenticated` may call, and it runs
-- SECURITY INVOKER so row-level security still applies.

begin;

-- ---------------------------------------------------------------------------
-- 1. Crawl-run lifecycle state and counters
-- ---------------------------------------------------------------------------

alter table public.style_guide_crawl_runs
  add column if not exists lifecycle_state text not null default 'pending',
  add column if not exists ingest_completed_at timestamptz,
  add column if not exists reconcile_started_at timestamptz,
  add column if not exists reconcile_completed_at timestamptz,
  add column if not exists refresh_started_at timestamptz,
  add column if not exists refresh_completed_at timestamptz,
  add column if not exists accepted_for_reconcile boolean not null default false,
  add column if not exists files_upserted integer not null default 0,
  add column if not exists files_deactivated integer not null default 0,
  add column if not exists files_reactivated integer not null default 0,
  add column if not exists reconcile_batches integer not null default 0,
  add column if not exists stale_candidates_at_start integer,
  add column if not exists stale_remaining integer,
  add column if not exists active_before_reconcile integer,
  add column if not exists guard_state text,
  add column if not exists guard_reason text,
  add column if not exists attention_reason text,
  add column if not exists search_documents_synced integer not null default 0;

comment on column public.style_guide_crawl_runs.lifecycle_state is
  'Issue #2212. Explicit crawl lifecycle: pending -> ingesting -> reconciling -> refreshing -> completed, or failed / attention_required. `status` is retained for compatibility and is constrained alongside it.';
comment on column public.style_guide_crawl_runs.guard_state is
  'Issue #2212. ok | empty_crawl | inaccessible_roots | low_nonzero. A non-ok guard refuses reconciliation and NEVER inactivates current rows.';

-- Historical rows predate the lifecycle columns. Their reconcile/refresh stamps
-- are set from the completion they already recorded so the invariant below can be
-- enforced without inventing a state they were never in. 133 rows.
update public.style_guide_crawl_runs
   set lifecycle_state = case when status = 'failed' then 'failed'
                              when status = 'completed' then 'completed'
                              else 'pending' end,
       accepted_for_reconcile = (status = 'completed'),
       reconcile_completed_at = case when status = 'completed'
                                     then coalesce(reconcile_completed_at, completed_at, created_at) end,
       refresh_completed_at   = case when status = 'completed'
                                     then coalesce(refresh_completed_at, completed_at, created_at) end,
       guard_state = coalesce(guard_state, case when status = 'completed' then 'ok' end)
 where lifecycle_state = 'pending';

alter table public.style_guide_crawl_runs
  drop constraint if exists style_guide_crawl_runs_lifecycle_state_check;
alter table public.style_guide_crawl_runs
  add constraint style_guide_crawl_runs_lifecycle_state_check
  check (lifecycle_state in ('pending','ingesting','reconciling','refreshing','completed','failed','attention_required'));

alter table public.style_guide_crawl_runs
  drop constraint if exists style_guide_crawl_runs_guard_state_check;
alter table public.style_guide_crawl_runs
  add constraint style_guide_crawl_runs_guard_state_check
  check (guard_state is null or guard_state in ('ok','empty_crawl','inaccessible_roots','low_nonzero'));

-- THE INVARIANT. A run cannot be reported complete -- by either the new
-- lifecycle_state or the legacy status column -- until reconciliation AND
-- aggregate freshness have both been recorded. This is the exact failure the
-- production incident produced, and a CHECK constraint cannot be forgotten.
alter table public.style_guide_crawl_runs
  drop constraint if exists style_guide_crawl_runs_completion_requires_reconcile;
alter table public.style_guide_crawl_runs
  add constraint style_guide_crawl_runs_completion_requires_reconcile
  check (
    (lifecycle_state <> 'completed' and status is distinct from 'completed')
    or (reconcile_completed_at is not null and refresh_completed_at is not null)
  );

-- ---------------------------------------------------------------------------
-- 2. Reconciliation index and the concurrent-refresh unique index
-- ---------------------------------------------------------------------------

-- Deterministic keyset batching of stale candidates for one root and one
-- accepted run. `id` is the tiebreak that makes a batch resumable.
create index if not exists idx_sgf_reconcile_root_active_run_id
  on public.style_guide_files (root_label, crawl_run_id, id)
  where is_active;

-- The two style-guide matviews predate this repository's migration history: they
-- exist in production but are absent from supabase/ci-bootstrap, so a replay from
-- the baseline has nothing to index. These two statements are a NO-OP in
-- production (IF NOT EXISTS) and reconstruct the exact live definitions, verbatim
-- from the production catalogue, wherever the relations are missing. Both
-- relations are inside this migration's object claim.
create materialized view if not exists public.style_guide_file_groups as
  select md5((coalesce(root_label, ''::text) || '/'::text) || coalesce(directory_path, ''::text)) as group_key,
         root_label,
         directory_path,
         licensor_name,
         property_folder,
         style_guide_folder,
         coalesce(nullif(style_guide_folder, ''::text), nullif(property_folder, ''::text),
                  licensor_name, 'Unfiled'::text) as style_guide_name,
         (count(*))::integer as file_count,
         max(modified_at) as latest_modified_at,
         (sum(coalesce(size_bytes, (0)::bigint)))::bigint as total_size_bytes,
         (array_remove(array_agg(thumbnail_url order by modified_at desc nulls last), null::text))[1] as sample_thumbnail_url
    from public.style_guide_files
   where is_active = true
   group by root_label, directory_path, licensor_name, property_folder, style_guide_folder;

-- `style_guide_file_groups` is refreshed CONCURRENTLY below, which requires a
-- unique index. Production already has one; a fresh replay from the baseline
-- reconstructs the matview above and would otherwise have none, so the refresh
-- would error. Created only when the relation has no unique index at all, so
-- this stays a NO-OP in production.
do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'style_guide_file_groups'
       and i.indisunique
  ) then
    create unique index if not exists sgfilegroups_group_uidx
      on public.style_guide_file_groups
         (root_label, directory_path, licensor_name, property_folder, style_guide_folder)
         nulls not distinct;
  end if;
end
$$;

create materialized view if not exists public.style_guide_folders as
  select distinct licensor_name, property_folder
    from public.style_guide_files
   where is_active = true and licensor_name is not null;

-- `style_guide_folders` had NO unique index, which is why its refresh was
-- blocking. NULLS NOT DISTINCT because property_folder is nullable and
-- REFRESH ... CONCURRENTLY must be able to match those rows.
create unique index if not exists sgfolders_licensor_property_uidx
  on public.style_guide_folders (licensor_name, property_folder) nulls not distinct;

-- ---------------------------------------------------------------------------
-- 3. PDF text extraction
-- ---------------------------------------------------------------------------

create table if not exists public.style_guide_pdf_text (
  style_guide_file_id uuid primary key
    references public.style_guide_files (id) on delete cascade,
  content_identity text not null,
  status text not null default 'pending',
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempts integer not null default 0,
  page_count integer,
  extracted_text text,
  text_length integer generated always as (coalesce(length(extracted_text), 0)) stored,
  error_message text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_guide_pdf_text_status_check
    check (status in ('pending','claimed','extracted','failed','skipped'))
);

comment on table public.style_guide_pdf_text is
  'Issue #2212. PopSG PDF text keyed to ACTIVE style_guide_files. `content_identity` is derived from the file row; a change to it invalidates the extraction on the next claim, and complete_style_guide_pdf_text refuses a result whose identity no longer matches. Restart-safe: an expired claim is reclaimable.';

create index if not exists idx_sg_pdf_text_claimable
  on public.style_guide_pdf_text (status, claim_expires_at, style_guide_file_id)
  where status in ('pending','claimed','failed');

alter table public.style_guide_pdf_text enable row level security;

drop policy if exists "authenticated read style_guide_pdf_text" on public.style_guide_pdf_text;
create policy "authenticated read style_guide_pdf_text"
  on public.style_guide_pdf_text for select to authenticated using (true);

revoke all on public.style_guide_pdf_text from public;
revoke all on public.style_guide_pdf_text from anon;
grant select on public.style_guide_pdf_text to authenticated;
grant all on public.style_guide_pdf_text to service_role;

-- ---------------------------------------------------------------------------
-- 4. Search documents
-- ---------------------------------------------------------------------------

create table if not exists public.style_guide_search_documents (
  style_guide_file_id uuid primary key
    references public.style_guide_files (id) on delete cascade,
  root_label text not null,
  licensor_name text,
  property_folder text,
  style_guide_folder text,
  style_guide_name text not null,
  directory_path text not null,
  relative_path text not null,
  filename text not null,
  file_extension text,
  tag_names text[] not null default '{}'::text[],
  size_bytes bigint,
  modified_at timestamptz,
  thumbnail_url text,
  is_active boolean not null default true,
  pdf_text_status text,
  pdf_text_length integer not null default 0,
  source_identity text not null,
  search_vector tsvector not null,
  document_updated_at timestamptz not null default now()
);

comment on table public.style_guide_search_documents is
  'Issue #2212. Incrementally maintained PopSG search documents. Populated in bounded slices by refresh_style_guide_matviews and complete_style_guide_pdf_text, and deactivated by reconcile_stale_sg_files_batch. Deliberately NOT backfilled by the migration.';

create index if not exists idx_sg_search_documents_search_vector
  on public.style_guide_search_documents using gin (search_vector)
  where is_active;

create index if not exists idx_sg_search_documents_filters
  on public.style_guide_search_documents
     (licensor_name, property_folder, file_extension, modified_at desc)
  where is_active;

-- The stable-paging key. Ranking always ends in style_guide_file_id, so no two
-- pages can ever repeat or skip a row.
create index if not exists idx_sg_search_documents_stable_page
  on public.style_guide_search_documents
     (modified_at desc nulls last, style_guide_file_id)
  where is_active;

alter table public.style_guide_search_documents enable row level security;

drop policy if exists "authenticated read style_guide_search_documents" on public.style_guide_search_documents;
create policy "authenticated read style_guide_search_documents"
  on public.style_guide_search_documents for select to authenticated using (true);

revoke all on public.style_guide_search_documents from public;
revoke all on public.style_guide_search_documents from anon;
grant select on public.style_guide_search_documents to authenticated;
grant all on public.style_guide_search_documents to service_role;

-- ---------------------------------------------------------------------------
-- 5. preview_stale_sg_files -- read-only, mutates nothing
-- ---------------------------------------------------------------------------

create or replace function public.preview_stale_sg_files(
  p_root_label text,
  p_run_id uuid,
  p_min_ratio numeric default 0.5
)
returns table (
  root_label text,
  run_id uuid,
  active_total bigint,
  run_active_total bigint,
  stale_candidates bigint,
  run_files_found integer,
  root_inaccessible boolean,
  guard_state text,
  guard_reason text,
  safe_to_reconcile boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_active bigint;
  v_run_active bigint;
  v_stale bigint;
  v_found integer;
  v_inaccessible boolean;
  v_state text;
  v_reason text;
  v_ratio numeric;
begin
  if p_root_label is null or p_run_id is null then
    raise exception 'preview_stale_sg_files requires a root label and a run id';
  end if;

  select count(*) filter (where f.is_active),
         count(*) filter (where f.is_active and f.crawl_run_id = p_run_id),
         count(*) filter (where f.is_active and f.crawl_run_id is distinct from p_run_id)
    into v_active, v_run_active, v_stale
    from public.style_guide_files f
   where f.root_label = p_root_label;

  select r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false)
    into v_found, v_inaccessible
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  if not found then
    v_state := 'empty_crawl';
    v_reason := format('crawl run %s does not exist', p_run_id);
  elsif v_inaccessible then
    v_state := 'inaccessible_roots';
    v_reason := format('root %L is listed in the run''s inaccessible_roots; current rows are left active', p_root_label);
  elsif coalesce(v_found, 0) = 0 or v_run_active = 0 then
    v_state := 'empty_crawl';
    v_reason := format('run reported files_found=%s and %s active rows for this root; refusing to inactivate %s current rows',
                       coalesce(v_found, 0), v_run_active, v_active);
  else
    v_ratio := case when v_active > 0 then v_run_active::numeric / v_active::numeric else 1 end;
    if v_active > 0 and v_ratio < coalesce(p_min_ratio, 0.5) then
      v_state := 'low_nonzero';
      v_reason := format('run saw %s of %s active rows (ratio %s < %s); suspicious partial crawl, current rows left active',
                         v_run_active, v_active, round(v_ratio, 4), coalesce(p_min_ratio, 0.5));
    else
      v_state := 'ok';
      v_reason := null;
    end if;
  end if;

  root_label        := p_root_label;
  run_id            := p_run_id;
  active_total      := v_active;
  run_active_total  := v_run_active;
  stale_candidates  := v_stale;
  run_files_found   := v_found;
  root_inaccessible := coalesce(v_inaccessible, false);
  guard_state       := v_state;
  guard_reason      := v_reason;
  safe_to_reconcile := (v_state = 'ok');
  return next;
end;
$function$;

comment on function public.preview_stale_sg_files(text, uuid, numeric) is
  'Issue #2212. Read-only preview of stale reconciliation candidates and the empty / inaccessible / low-nonzero guards. Mutates nothing. Service-role only.';

-- ---------------------------------------------------------------------------
-- 6. reconcile_stale_sg_files_batch -- bounded, idempotent, resumable
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_stale_sg_files_batch(
  p_root_label text,
  p_run_id uuid,
  p_batch_size integer default 5000,
  p_min_ratio numeric default 0.5
)
returns table (
  deactivated integer,
  remaining bigint,
  done boolean,
  guard_state text,
  guard_reason text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_preview record;
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 5000), 50000));
  v_deactivated integer := 0;
  v_remaining bigint;
begin
  -- Serialize every reconciliation of a single root. Without this, two accepted
  -- runs that each crawled roughly half of one root each see the OTHER run's
  -- rows as stale; both pass the ratio guard on their own half, and together they
  -- inactivate every active row of the root. FOR UPDATE SKIP LOCKED does not
  -- prevent that -- the two batches touch disjoint rows, so neither ever blocks.
  -- The lock is transaction-scoped, so it is released with the caller's commit.
  perform pg_advisory_xact_lock(hashtext(p_root_label));

  select * into v_preview
    from public.preview_stale_sg_files(p_root_label, p_run_id, p_min_ratio);

  if not v_preview.safe_to_reconcile then
    -- NO row is inactivated. The run is parked for a human rather than being
    -- allowed to report a completion it did not earn.
    update public.style_guide_crawl_runs
       set lifecycle_state = 'attention_required',
           guard_state = v_preview.guard_state,
           guard_reason = v_preview.guard_reason,
           attention_reason = v_preview.guard_reason,
           accepted_for_reconcile = false
     where id = p_run_id;

    deactivated  := 0;
    remaining    := v_preview.stale_candidates;
    done         := false;
    guard_state  := v_preview.guard_state;
    guard_reason := v_preview.guard_reason;
    return next;
    return;
  end if;

  update public.style_guide_crawl_runs
     set lifecycle_state = case when lifecycle_state in ('completed','failed')
                                then lifecycle_state else 'reconciling' end,
         accepted_for_reconcile = true,
         guard_state = 'ok',
         guard_reason = null,
         attention_reason = null,
         reconcile_started_at = coalesce(reconcile_started_at, now()),
         stale_candidates_at_start = coalesce(stale_candidates_at_start, v_preview.stale_candidates::integer),
         active_before_reconcile = coalesce(active_before_reconcile, v_preview.active_total::integer)
   where id = p_run_id;

  -- Bounded, deterministic, resumable. Ordering on id makes an interrupted run
  -- resume exactly where it stopped; SKIP LOCKED lets two workers cooperate
  -- without either of them scanning the whole root.
  with victims as (
    select f.id
      from public.style_guide_files f
     where f.root_label = p_root_label
       and f.is_active
       and f.crawl_run_id is distinct from p_run_id
     order by f.id
     limit v_batch
     for update skip locked
  ), deactivated_rows as (
    update public.style_guide_files f
       set is_active = false
      from victims v
     where f.id = v.id
     returning f.id
  ), document_rows as (
    update public.style_guide_search_documents d
       set is_active = false,
           document_updated_at = now()
      from deactivated_rows dr
     where d.style_guide_file_id = dr.id
     returning d.style_guide_file_id
  )
  select count(*)::integer into v_deactivated from deactivated_rows;

  select count(*)
    into v_remaining
    from public.style_guide_files f
   where f.root_label = p_root_label
     and f.is_active
     and f.crawl_run_id is distinct from p_run_id;

  update public.style_guide_crawl_runs
     set files_deactivated = files_deactivated + v_deactivated,
         reconcile_batches = reconcile_batches + 1,
         stale_remaining = v_remaining::integer,
         reconcile_completed_at = case when v_remaining = 0 then coalesce(reconcile_completed_at, now())
                                       else reconcile_completed_at end
   where id = p_run_id;

  deactivated  := v_deactivated;
  remaining    := v_remaining;
  done         := (v_remaining = 0);
  guard_state  := 'ok';
  guard_reason := null;
  return next;
end;
$function$;

comment on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) is
  'Issue #2212. Bounded, idempotent, resumable stale reconciliation for one root and one accepted crawl run. Refuses to inactivate anything when the empty / inaccessible / low-nonzero guard fires. Service-role only.';

-- ---------------------------------------------------------------------------
-- 7. deactivate_stale_sg_files -- same signature, guarded body, locked down
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_stale_sg_files(
  p_root_label text,
  p_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total integer := 0;
  v_batch record;
  v_iterations integer := 0;
begin
  -- The pre-#2212 body was a single unbounded UPDATE over every active row of
  -- the root, with no guard at all. It timed out in production. The signature is
  -- preserved for compatibility; the behaviour is now the guarded bounded loop.
  loop
    v_iterations := v_iterations + 1;
    select * into v_batch
      from public.reconcile_stale_sg_files_batch(p_root_label, p_run_id, 5000, 0.5);

    if v_batch.guard_state is distinct from 'ok' then
      raise exception 'deactivate_stale_sg_files refused: %', v_batch.guard_reason
        using errcode = 'raise_exception';
    end if;

    v_total := v_total + v_batch.deactivated;
    exit when v_batch.done or v_iterations >= 200;
  end loop;

  return v_total;
end;
$function$;

comment on function public.deactivate_stale_sg_files(text, uuid) is
  'Issue #2212. Compatibility wrapper over reconcile_stale_sg_files_batch. Formerly an unbounded UPDATE executable by `authenticated`; EXECUTE is now service-role only.';

-- ---------------------------------------------------------------------------
-- 8. refresh_style_guide_matviews -- non-blocking, records freshness,
--    syncs a bounded slice of search documents
-- ---------------------------------------------------------------------------

-- The zero-argument form is replaced by one with all-default arguments, so every
-- existing `select refresh_style_guide_matviews()` call site still resolves.
drop function if exists public.refresh_style_guide_matviews();

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
        from public.style_guide_files f
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
       order by f.id
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
  'Issue #2212. Refreshes both style-guide matviews CONCURRENTLY, records aggregate freshness against a crawl run, and syncs a BOUNDED slice of search documents. Never rebuilds aggregates from scratch. Service-role only.';

-- ---------------------------------------------------------------------------
-- 9. PDF text claim / complete
-- ---------------------------------------------------------------------------

create or replace function public.claim_style_guide_pdf_text(
  p_worker_id text,
  p_batch_size integer default 10,
  p_claim_ttl interval default interval '15 minutes',
  p_max_attempts integer default 3
)
returns table (
  style_guide_file_id uuid,
  root_label text,
  relative_path text,
  content_identity text,
  attempts integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
-- The RETURNS TABLE output parameters share their names with the columns this
-- body reads, so an unqualified name -- `on conflict (style_guide_file_id)` in
-- particular, where the inference list cannot be qualified -- is ambiguous.
-- Columns win; every variable here is either `p_`- or `v_`-prefixed.
#variable_conflict use_column
declare
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 10), 500));
begin
  if p_worker_id is null or p_worker_id = '' then
    raise exception 'claim_style_guide_pdf_text requires a worker id';
  end if;

  -- Enrol a BOUNDED slice of active PDFs that have no extraction row yet. This is
  -- how the table fills: incrementally, never by a migration backfill.
  insert into public.style_guide_pdf_text (style_guide_file_id, content_identity, status)
  select f.id,
         md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')),
         'pending'
    from public.style_guide_files f
    left join public.style_guide_pdf_text t on t.style_guide_file_id = f.id
   where f.is_active
     and lower(coalesce(f.file_extension, '')) in ('pdf', '.pdf')
     and t.style_guide_file_id is null
   order by f.id
   limit v_batch
  on conflict (style_guide_file_id) do nothing;

  return query
  with eligible as (
    select t.style_guide_file_id as file_id,
           f.root_label as root,
           f.relative_path as rel_path,
           md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')) as identity_now
      from public.style_guide_pdf_text t
      join public.style_guide_files f on f.id = t.style_guide_file_id
     where f.is_active
       and (
             t.status = 'pending'
             -- Restart safety: an expired claim is reclaimable, so a worker that
             -- died mid-extraction never strands a file.
             or (t.status = 'claimed' and coalesce(t.claim_expires_at, '-infinity'::timestamptz) < now())
             or (t.status = 'failed' and t.attempts < coalesce(p_max_attempts, 3))
             -- Content identity moved underneath a stored extraction.
             or t.content_identity is distinct from
                md5(f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, ''))
           )
     order by t.style_guide_file_id
     limit v_batch
     for update of t skip locked
  )
  update public.style_guide_pdf_text t
     set status = 'claimed',
         claimed_by = p_worker_id,
         claimed_at = now(),
         claim_expires_at = now() + coalesce(p_claim_ttl, interval '15 minutes'),
         attempts = case when t.content_identity is distinct from e.identity_now then 1 else t.attempts + 1 end,
         extracted_text = case when t.content_identity is distinct from e.identity_now then null else t.extracted_text end,
         page_count = case when t.content_identity is distinct from e.identity_now then null else t.page_count end,
         extracted_at = case when t.content_identity is distinct from e.identity_now then null else t.extracted_at end,
         error_message = null,
         content_identity = e.identity_now,
         updated_at = now()
    from eligible e
   where t.style_guide_file_id = e.file_id
  returning t.style_guide_file_id, e.root, e.rel_path, t.content_identity, t.attempts;
end;
$function$;

comment on function public.claim_style_guide_pdf_text(text, integer, interval, integer) is
  'Issue #2212. Restart-safe bounded claim of PopSG PDF extraction work against ACTIVE style_guide_files. Reclaims expired claims and invalidates a stored extraction whose content identity changed. Service-role only.';

create or replace function public.complete_style_guide_pdf_text(
  p_style_guide_file_id uuid,
  p_content_identity text,
  p_text text default null,
  p_page_count integer default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated integer;
begin
  -- The identity match is the invalidation guard: a result computed against a
  -- file version that has since changed, or against a file that is no longer
  -- active, is REFUSED rather than stored as current.
  update public.style_guide_pdf_text t
     set status = case when p_error is not null then 'failed' else 'extracted' end,
         extracted_text = case when p_error is not null then null else p_text end,
         page_count = case when p_error is not null then null else p_page_count end,
         error_message = p_error,
         extracted_at = case when p_error is not null then null else now() end,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = now()
    from public.style_guide_files f
   where t.style_guide_file_id = p_style_guide_file_id
     and f.id = t.style_guide_file_id
     and f.is_active
     and t.content_identity = p_content_identity
     and t.status = 'claimed';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  -- Keep the search document for this one file current. Bounded to a single row.
  update public.style_guide_search_documents d
     set pdf_text_status = t.status,
         pdf_text_length = coalesce(t.text_length, 0),
         search_vector =
           setweight(to_tsvector('simple', coalesce(d.filename, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(d.style_guide_name, '') || ' ' ||
                                              coalesce(d.property_folder, '') || ' ' ||
                                              coalesce(d.licensor_name, '')), 'B')
           || setweight(to_tsvector('simple', coalesce(d.relative_path, '') || ' ' ||
                                              array_to_string(d.tag_names, ' ')), 'C')
           || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
         document_updated_at = now()
    from public.style_guide_pdf_text t
   where d.style_guide_file_id = p_style_guide_file_id
     and t.style_guide_file_id = d.style_guide_file_id;

  return true;
end;
$function$;

comment on function public.complete_style_guide_pdf_text(uuid, text, text, integer, text) is
  'Issue #2212. Stores a PDF extraction result only when the content identity still matches and the file is still active; otherwise returns false. Service-role only.';

-- ---------------------------------------------------------------------------
-- 10. search_style_guide_library -- the ONE authorized search RPC
-- ---------------------------------------------------------------------------

create or replace function public.search_style_guide_library(
  p_query text default null,
  p_licensors text[] default null,
  p_properties text[] default null,
  p_style_guides text[] default null,
  p_extensions text[] default null,
  p_tags text[] default null,
  p_modified_after timestamptz default null,
  p_modified_before timestamptz default null,
  p_sort text default 'relevance',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
with params as (
  select nullif(btrim(coalesce(p_query, '')), '') as q,
         case when lower(coalesce(p_sort, 'relevance')) in ('relevance','modified_desc','modified_asc','name_asc')
              then lower(coalesce(p_sort, 'relevance')) else 'relevance' end as sort_key,
         greatest(1, least(coalesce(p_limit, 50), 200)) as lim,
         greatest(0, coalesce(p_offset, 0)) as off
), tsq as (
  select case when p.q is null then null
              else websearch_to_tsquery('simple', p.q) end as query
    from params p
), filtered as (
  select d.*,
         case when t.query is null then 0::real else ts_rank_cd(d.search_vector, t.query) end as rank
    from public.style_guide_search_documents d
    cross join tsq t
   where d.is_active
     and (t.query is null or d.search_vector @@ t.query)
     and (p_licensors is null or cardinality(p_licensors) = 0 or d.licensor_name = any (p_licensors))
     and (p_properties is null or cardinality(p_properties) = 0 or d.property_folder = any (p_properties))
     and (p_style_guides is null or cardinality(p_style_guides) = 0 or d.style_guide_name = any (p_style_guides))
     and (p_extensions is null or cardinality(p_extensions) = 0 or lower(coalesce(d.file_extension, '')) = any (select lower(x) from unnest(p_extensions) x))
     and (p_tags is null or cardinality(p_tags) = 0 or d.tag_names && p_tags)
     and (p_modified_after is null or d.modified_at >= p_modified_after)
     and (p_modified_before is null or d.modified_at <= p_modified_before)
), page as (
  -- STABLE PAGING. Every ordering ends in style_guide_file_id, which is the
  -- primary key, so the sort is a total order: no page can repeat or skip a row.
  select f.*
    from filtered f, params p
   order by
     case when p.sort_key = 'relevance' then f.rank end desc nulls last,
     case when p.sort_key in ('relevance','modified_desc') then f.modified_at end desc nulls last,
     case when p.sort_key = 'modified_asc' then f.modified_at end asc nulls last,
     case when p.sort_key = 'name_asc' then lower(f.filename) end asc nulls last,
     f.style_guide_file_id
   offset (select off from params)
   limit (select lim from params)
)
select jsonb_build_object(
  'total', (select count(*) from filtered),
  'limit', (select lim from params),
  'offset', (select off from params),
  'sort', (select sort_key from params),
  'query', (select q from params),
  'results', coalesce((
    select jsonb_agg(jsonb_build_object(
      'style_guide_file_id', pg.style_guide_file_id,
      'root_label', pg.root_label,
      'licensor_name', pg.licensor_name,
      'property_folder', pg.property_folder,
      'style_guide_name', pg.style_guide_name,
      'directory_path', pg.directory_path,
      'relative_path', pg.relative_path,
      'filename', pg.filename,
      'file_extension', pg.file_extension,
      'tag_names', to_jsonb(pg.tag_names),
      'size_bytes', pg.size_bytes,
      'modified_at', pg.modified_at,
      'thumbnail_url', pg.thumbnail_url,
      'pdf_text_status', pg.pdf_text_status,
      'pdf_text_length', pg.pdf_text_length,
      'rank', pg.rank
    ) order by pg.rn)
    from (select page.*, row_number() over () as rn from page) pg
  ), '[]'::jsonb),
  'facets', jsonb_build_object(
    'licensors', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select licensor_name as v, count(*) as c from filtered
                                  where licensor_name is not null group by 1) s), '[]'::jsonb),
    'properties', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select property_folder as v, count(*) as c from filtered
                                  where property_folder is not null group by 1) s), '[]'::jsonb),
    'style_guides', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select style_guide_name as v, count(*) as c from filtered group by 1) s), '[]'::jsonb),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select lower(file_extension) as v, count(*) as c from filtered
                                  where file_extension is not null group by 1) s), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', c) order by c desc, v)
                           from (select tag as v, count(*) as c from filtered, unnest(tag_names) tag group by 1) s), '[]'::jsonb)
  )
);
$function$;

comment on function public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer) is
  'Issue #2212. The one authorized PopSG search RPC: active path/name/guide-metadata/tag/PDF-text search with required filters, stable total-order pagination, an exact total, and facets computed over the same filtered set. SECURITY INVOKER, so row-level security still applies.';

-- ---------------------------------------------------------------------------
-- 11. Least privilege
-- ---------------------------------------------------------------------------

-- THE SECURITY FIX. `authenticated` held EXECUTE on a SECURITY DEFINER function
-- that could inactivate an entire style-guide root.
revoke all on function public.deactivate_stale_sg_files(text, uuid) from public;
revoke all on function public.deactivate_stale_sg_files(text, uuid) from anon;
revoke all on function public.deactivate_stale_sg_files(text, uuid) from authenticated;
grant execute on function public.deactivate_stale_sg_files(text, uuid) to service_role;

revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from public;
revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from anon;
revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from authenticated;
grant execute on function public.preview_stale_sg_files(text, uuid, numeric) to service_role;

revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from public;
revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from anon;
revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from authenticated;
grant execute on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) to service_role;

revoke all on function public.refresh_style_guide_matviews(uuid, integer) from public;
revoke all on function public.refresh_style_guide_matviews(uuid, integer) from anon;
revoke all on function public.refresh_style_guide_matviews(uuid, integer) from authenticated;
grant execute on function public.refresh_style_guide_matviews(uuid, integer) to service_role;

revoke all on function public.claim_style_guide_pdf_text(text, integer, interval, integer) from public;
revoke all on function public.claim_style_guide_pdf_text(text, integer, interval, integer) from anon;
revoke all on function public.claim_style_guide_pdf_text(text, integer, interval, integer) from authenticated;
grant execute on function public.claim_style_guide_pdf_text(text, integer, interval, integer) to service_role;

revoke all on function public.complete_style_guide_pdf_text(uuid, text, text, integer, text) from public;
revoke all on function public.complete_style_guide_pdf_text(uuid, text, text, integer, text) from anon;
revoke all on function public.complete_style_guide_pdf_text(uuid, text, text, integer, text) from authenticated;
grant execute on function public.complete_style_guide_pdf_text(uuid, text, text, integer, text) to service_role;

revoke all on function public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer) from public;
revoke all on function public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer) from anon;
grant execute on function public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.search_style_guide_library(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 12. Catalogue-only self verification (no data scans -- issue #1285)
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  -- verify 1: every new relation exists
  foreach v_name in array array['public.style_guide_pdf_text','public.style_guide_search_documents'] loop
    if to_regclass(v_name) is null then v_missing := v_missing || v_name; end if;
  end loop;

  -- verify 2: every claimed index exists
  foreach v_name in array array[
    'public.idx_sgf_reconcile_root_active_run_id',
    'public.sgfolders_licensor_property_uidx',
    'public.idx_sg_pdf_text_claimable',
    'public.idx_sg_search_documents_search_vector',
    'public.idx_sg_search_documents_filters',
    'public.idx_sg_search_documents_stable_page'] loop
    if to_regclass(v_name) is null then v_missing := v_missing || v_name; end if;
  end loop;

  -- verify 3: every claimed routine exists at its exact signature
  foreach v_name in array array[
    'public.preview_stale_sg_files(text,uuid,numeric)',
    'public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)',
    'public.deactivate_stale_sg_files(text,uuid)',
    'public.refresh_style_guide_matviews(uuid,integer)',
    'public.claim_style_guide_pdf_text(text,integer,interval,integer)',
    'public.complete_style_guide_pdf_text(uuid,text,text,integer,text)',
    'public.search_style_guide_library(text,text[],text[],text[],text[],text[],timestamptz,timestamptz,text,integer,integer)'] loop
    if to_regprocedure(v_name) is null then v_missing := v_missing || v_name; end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'issue #2212 migration did not create: %', array_to_string(v_missing, ', ');
  end if;

  -- verify 4: the completion invariant constraint is present
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.style_guide_crawl_runs'::regclass
       and conname = 'style_guide_crawl_runs_completion_requires_reconcile') then
    raise exception 'issue #2212: the completion invariant constraint is missing';
  end if;

  -- verify 5: authenticated no longer holds EXECUTE on the definer function
  if has_function_privilege('authenticated', 'public.deactivate_stale_sg_files(text,uuid)', 'execute') then
    raise exception 'issue #2212: authenticated still holds EXECUTE on deactivate_stale_sg_files';
  end if;
end
$verify$;

commit;
