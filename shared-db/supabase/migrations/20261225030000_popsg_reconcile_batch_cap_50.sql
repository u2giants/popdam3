-- popcre/shared-db#3458 (u2giants/popdam3#107): after 20261222090000 fixed the
-- reconcile preview count, the 2026-11-19 nightly crawl (run 914aa546) still
-- failed with "canceling statement due to statement timeout", now inside
-- reconcile_stale_sg_files_batch line 137: the deactivation UPDATE of the FIRST
-- 500-row batch (postgres log 2026-11-20 02:17:24 UTC). Every deactivated file
-- is a non-HOT update of style_guide_files (three trigram GIN indexes, four row
-- triggers) and of style_guide_search_documents (801 MB HNSW index, GIN
-- search_vector), right after an ingest rewrote ~223k rows. The counts now take
-- 0.2 s, so the write batch is what exceeds the 8 s ceiling. The per-call cap is
-- cut from 500 to 50 rows; callers already loop on done=false, so a run only
-- makes more, smaller calls. Function body only; grants are unchanged.
-- derived-from: 20261111132448
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $guard$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)')
       and md5(p.prosrc) = 'e83ac0cbc1c53e5710930932d1125b2a') then
    raise exception 'reconcile_stale_sg_files_batch source differs from 20261111132448; reconcile rather than overwrite';
  end if;
end;
$guard$;

create or replace function public.reconcile_stale_sg_files_batch(p_root_label text, p_run_id uuid, p_batch_size integer DEFAULT 5000, p_min_ratio numeric DEFAULT 0.5)
 RETURNS TABLE(deactivated integer, remaining bigint, done boolean, guard_state text, guard_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_preview record;
  -- #2792/#3458: at most 50 rows are written per call so every call stays well
  -- under the 8s statement ceiling. Larger requests continue via done=false.
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 50), 50));
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

commit;
