-- derived-from: 20260915023506
-- u2giants/popdam3#804: stop the PopSG crawl from rewriting every unchanged
-- style_guide_files row.
--
-- Before: complete-style-guide-crawl upserted every crawled file with a new
-- crawl_run_id and last_seen_at, so a nightly crawl rewrote ~221k rows (22
-- indexes, non-HOT), re-fired the tagging and preview triggers for each row,
-- and changed the table's tuple statistics. That change flipped
-- style_guide_refresh_source_signature, so the library default snapshot then
-- rebuilt two materialized views (65-128 s) at busy hours.
--
-- After: "last run that saw this active file" lives in a narrow side table,
-- public.style_guide_file_crawl_seen, holding exactly one row per ACTIVE file.
-- A trigger keeps it in step with every write to style_guide_files (insert,
-- crawl_run_id change, activation, deactivation), and the crawl's new upsert
-- RPC stamps it for unchanged files without touching the file row. Reconcile
-- and its preview read the run stamp from the side table with the same
-- bounded index-range design as #2792 (three ordered ranges, write cap 500,
-- bounded run-active probe, advisory lock, guards and bookkeeping unchanged).

create table if not exists public.style_guide_file_crawl_seen (
  style_guide_file_id uuid primary key
    references public.style_guide_files (id) on delete cascade,
  root_label text not null,
  crawl_run_id uuid,
  last_seen_at timestamptz not null default now()
);

comment on table public.style_guide_file_crawl_seen is
  'Last PopSG crawl run that saw each ACTIVE style_guide_files row (popdam3#804). '
  'One row per active file, kept by trg_style_guide_files_crawl_seen and '
  'upsert_style_guide_crawl_files; read by reconcile/preview.';

create index if not exists idx_sg_file_crawl_seen_root_run
  on public.style_guide_file_crawl_seen (root_label, crawl_run_id, style_guide_file_id);

alter table public.style_guide_file_crawl_seen enable row level security;
revoke all on public.style_guide_file_crawl_seen from public, anon, authenticated;
grant select, insert, update, delete on public.style_guide_file_crawl_seen to service_role;

-- Keep the side table equal to "active files and their run stamp" for every
-- writer, not only the crawl RPC.
create or replace function public.style_guide_files_sync_crawl_seen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.is_active then
    insert into public.style_guide_file_crawl_seen as s
           (style_guide_file_id, root_label, crawl_run_id, last_seen_at)
    values (new.id, new.root_label, new.crawl_run_id, coalesce(new.last_seen_at, now()))
    on conflict (style_guide_file_id) do update
       set root_label = excluded.root_label,
           crawl_run_id = excluded.crawl_run_id,
           last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
     where (s.root_label, s.crawl_run_id) is distinct from (excluded.root_label, excluded.crawl_run_id);
  else
    delete from public.style_guide_file_crawl_seen where style_guide_file_id = new.id;
  end if;
  return null;
end;
$function$;

revoke all on function public.style_guide_files_sync_crawl_seen() from public, anon, authenticated;

drop trigger if exists trg_style_guide_files_crawl_seen on public.style_guide_files;
create trigger trg_style_guide_files_crawl_seen
  after insert or update of is_active, crawl_run_id, root_label on public.style_guide_files
  for each row execute function public.style_guide_files_sync_crawl_seen();

-- One-time backfill: every active file, with its current run stamp.
insert into public.style_guide_file_crawl_seen (style_guide_file_id, root_label, crawl_run_id, last_seen_at)
select f.id, f.root_label, f.crawl_run_id, coalesce(f.last_seen_at, now())
  from public.style_guide_files f
 where f.is_active
on conflict (style_guide_file_id) do nothing;

-- Crawl ingest: write file rows only when something real changed, record
-- "seen" for every crawled row, and return every crawled row's id (the render
-- queue call after it needs all of them, as before).
create or replace function public.upsert_style_guide_crawl_files(
  p_run_id uuid,
  p_rows jsonb
)
returns table (id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_run_id is null then
    raise exception 'upsert_style_guide_crawl_files requires a run id';
  end if;

  create temporary table if not exists pg_temp.sg_crawl_rows (
    root_label text,
    relative_path text,
    directory_path text,
    filename text,
    basename_no_ext text,
    file_extension text,
    property_folder text,
    style_guide_folder text,
    normalized_name text,
    normalized_style_guide_folder text,
    size_bytes bigint,
    modified_at timestamptz,
    has_talent_likeness boolean
  ) on commit drop;
  truncate pg_temp.sg_crawl_rows;

  insert into pg_temp.sg_crawl_rows
  select distinct on (r.root_label, r.relative_path) r.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r (
      root_label text,
      relative_path text,
      directory_path text,
      filename text,
      basename_no_ext text,
      file_extension text,
      property_folder text,
      style_guide_folder text,
      normalized_name text,
      normalized_style_guide_folder text,
      size_bytes bigint,
      modified_at timestamptz,
      has_talent_likeness boolean
    )
   order by r.root_label, r.relative_path;

  insert into public.style_guide_files as f (
    crawl_run_id, root_label, relative_path, directory_path, filename,
    basename_no_ext, file_extension, property_folder, style_guide_folder,
    normalized_name, normalized_style_guide_folder, size_bytes, modified_at,
    last_seen_at, is_active, has_talent_likeness)
  select p_run_id, c.root_label, c.relative_path, c.directory_path, c.filename,
         c.basename_no_ext, c.file_extension, c.property_folder, c.style_guide_folder,
         c.normalized_name, c.normalized_style_guide_folder, c.size_bytes, c.modified_at,
         now(), true, c.has_talent_likeness
    from pg_temp.sg_crawl_rows c
   order by c.root_label, c.relative_path
  on conflict (root_label, relative_path) do update
     set crawl_run_id = excluded.crawl_run_id,
         directory_path = excluded.directory_path,
         filename = excluded.filename,
         basename_no_ext = excluded.basename_no_ext,
         file_extension = excluded.file_extension,
         property_folder = excluded.property_folder,
         style_guide_folder = excluded.style_guide_folder,
         normalized_name = excluded.normalized_name,
         normalized_style_guide_folder = excluded.normalized_style_guide_folder,
         size_bytes = excluded.size_bytes,
         modified_at = excluded.modified_at,
         last_seen_at = excluded.last_seen_at,
         is_active = true,
         has_talent_likeness = excluded.has_talent_likeness
   where not f.is_active
      or (f.directory_path, f.filename, f.basename_no_ext, f.file_extension,
          f.property_folder, f.style_guide_folder, f.normalized_name,
          f.normalized_style_guide_folder, f.size_bytes, f.modified_at,
          f.has_talent_likeness)
         is distinct from
         (excluded.directory_path, excluded.filename, excluded.basename_no_ext,
          excluded.file_extension, excluded.property_folder, excluded.style_guide_folder,
          excluded.normalized_name, excluded.normalized_style_guide_folder,
          excluded.size_bytes, excluded.modified_at, excluded.has_talent_likeness);

  insert into public.style_guide_file_crawl_seen as s
         (style_guide_file_id, root_label, crawl_run_id, last_seen_at)
  select f.id, f.root_label, p_run_id, now()
    from pg_temp.sg_crawl_rows c
    join public.style_guide_files f
      on f.root_label = c.root_label and f.relative_path = c.relative_path
   where f.is_active
  on conflict (style_guide_file_id) do update
     set crawl_run_id = excluded.crawl_run_id,
         root_label = excluded.root_label,
         last_seen_at = excluded.last_seen_at;

  return query
  select f.id
    from pg_temp.sg_crawl_rows c
    join public.style_guide_files f
      on f.root_label = c.root_label and f.relative_path = c.relative_path;
end;
$function$;

revoke all on function public.upsert_style_guide_crawl_files(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_style_guide_crawl_files(uuid, jsonb) to service_role;

-- Accepted-file count for one root of one run (replaces the edge function's
-- direct count on style_guide_files.crawl_run_id).
create or replace function public.count_style_guide_crawl_seen(p_root_label text, p_run_id uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)
    from public.style_guide_file_crawl_seen s
    join public.style_guide_files f on f.id = s.style_guide_file_id
   where s.root_label = p_root_label
     and s.crawl_run_id = p_run_id
     and f.is_active;
$function$;

revoke all on function public.count_style_guide_crawl_seen(text, uuid) from public, anon, authenticated;
grant execute on function public.count_style_guide_crawl_seen(text, uuid) to service_role;

-- Same body as 20260915023506 except the run stamp is read from the side
-- table (s.crawl_run_id); f.is_active is still checked on the file row.
create or replace function public.preview_stale_sg_files(p_root_label text, p_run_id uuid, p_min_ratio numeric DEFAULT 0.5)
 RETURNS TABLE(root_label text, run_id uuid, active_total bigint, run_active_total bigint, stale_candidates bigint, run_files_found integer, root_inaccessible boolean, guard_state text, guard_reason text, safe_to_reconcile boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- popdam3#804: one pass over idx_sg_file_crawl_seen_root_run (active files
  -- only); the file row confirms is_active.
  select count(*),
         count(*) filter (where s.crawl_run_id = p_run_id)
    into v_active, v_run_active
    from public.style_guide_file_crawl_seen s
    join public.style_guide_files f on f.id = s.style_guide_file_id
   where s.root_label = p_root_label
     and f.is_active;

  v_stale := v_active - v_run_active;

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

create or replace function public.reconcile_stale_sg_files_batch(p_root_label text, p_run_id uuid, p_batch_size integer DEFAULT 5000, p_min_ratio numeric DEFAULT 0.5)
 RETURNS TABLE(deactivated integer, remaining bigint, done boolean, guard_state text, guard_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_preview record;
  -- #2792: at most 500 rows are written per call so every call stays well
  -- under the 8s statement ceiling. Larger requests continue via done=false.
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 500), 500));
  v_deactivated integer := 0;
  v_remaining bigint;
  v_ids uuid[] := array[]::uuid[];
  v_run_exists boolean := false;
  v_found integer;
  v_inaccessible boolean;
  v_start_stale integer;
  v_start_active integer;
  v_ratio numeric := coalesce(p_min_ratio, 0.5);
  v_stale bigint;
  v_active bigint;
  v_need bigint;
  v_run_seen bigint;
  v_fast_ok boolean := false;
begin
  -- Serialize every reconciliation of a single root (two half-root runs must
  -- never each treat the other's rows as stale). Transaction-scoped.
  perform pg_advisory_xact_lock(hashtext(p_root_label));

  -- popdam3#804: the run stamp is read from style_guide_file_crawl_seen, which
  -- holds one row per active file (trigger-maintained). Three stale index
  -- ranges of idx_sg_file_crawl_seen_root_run; the run's own rows are skipped.
  select (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id is null)
    into v_stale;

  select true, r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false),
         r.stale_candidates_at_start, r.active_before_reconcile
    into v_run_exists, v_found, v_inaccessible, v_start_stale, v_start_active
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  -- Fast guard (#2792), used only once this run's start counters exist.
  if coalesce(v_run_exists, false)
     and not coalesce(v_inaccessible, false)
     and coalesce(v_found, 0) > 0
     and v_ratio < 1
     and v_start_stale is not null
     and v_start_active is not null then
    v_need := greatest(1, ceil(v_ratio * v_stale / (1 - v_ratio)))::bigint;
    select count(*) into v_run_seen
      from (select 1
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id = p_run_id
             limit v_need) x;
    v_fast_ok := (v_run_seen >= v_need);
  end if;

  if not v_fast_ok then
    select * into v_preview
      from public.preview_stale_sg_files(p_root_label, p_run_id, p_min_ratio);

    if not v_preview.safe_to_reconcile then
      -- NO row is inactivated. The run is parked for a human.
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

    v_stale  := v_preview.stale_candidates;
    v_active := v_preview.active_total;
  end if;

  update public.style_guide_crawl_runs
     set lifecycle_state = case when lifecycle_state in ('completed','failed')
                                then lifecycle_state else 'reconciling' end,
         accepted_for_reconcile = true,
         guard_state = 'ok',
         guard_reason = null,
         attention_reason = null,
         reconcile_started_at = coalesce(reconcile_started_at, now()),
         stale_candidates_at_start = coalesce(stale_candidates_at_start, v_stale::integer),
         active_before_reconcile = coalesce(active_before_reconcile, v_active::integer)
   where id = p_run_id;

  -- Bounded in rows read and written: three ordered range scans, overall order
  -- (crawl_run_id asc nulls last, id); an interrupted run resumes in place.
  select coalesce(array_agg(x.id), array[]::uuid[])
    into v_ids
    from (select s.style_guide_file_id as id
            from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label
             and s.crawl_run_id < p_run_id
           order by s.crawl_run_id, s.style_guide_file_id
           limit v_batch
             for update of s skip locked) x;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(x.id), array[]::uuid[])
      into v_ids
      from (select s.style_guide_file_id as id
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id > p_run_id
             order by s.crawl_run_id, s.style_guide_file_id
             limit v_batch - cardinality(v_ids)
               for update of s skip locked) x;
  end if;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(x.id), array[]::uuid[])
      into v_ids
      from (select s.style_guide_file_id as id
              from public.style_guide_file_crawl_seen s
             where s.root_label = p_root_label
               and s.crawl_run_id is null
             order by s.style_guide_file_id
             limit v_batch - cardinality(v_ids)
               for update of s skip locked) x;
  end if;

  -- Deactivating a file removes its side-table row through the trigger.
  with deactivated_rows as (
    update public.style_guide_files f
       set is_active = false
     where f.id = any (v_ids)
       and f.is_active
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

  -- A selected side-table row whose file was already inactive is stale
  -- bookkeeping; drop it so it is never selected again.
  delete from public.style_guide_file_crawl_seen s
   where s.style_guide_file_id = any (v_ids)
     and not exists (select 1 from public.style_guide_files f
                      where f.id = s.style_guide_file_id and f.is_active);

  select (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label and s.crawl_run_id is null)
    into v_remaining;

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
