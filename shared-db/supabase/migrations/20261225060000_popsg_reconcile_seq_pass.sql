-- popcre/shared-db#3458 (u2giants/popdam3#107): with the 50-row cap
-- (20261225030000) live, the manual crawl 5a6c7058 on 2026-11-20 still timed
-- out in its FIRST reconcile call (nothing committed). Cause: each ingest moves
-- ~223k style_guide_file_crawl_seen rows to the new run id, leaving the old
-- run's index entries dead inside the stale uuid range. The function's range
-- scans (two counts plus the victim pick) walk all of them with random heap
-- reads, which exceeds the 8 s ceiling until autovacuum cleans up. Measured
-- read-only on production 2026-11-20: one range count 2.2 s with 5,527 heap
-- fetches for 312 live rows, while a sequential pass of the whole root takes
-- 0.17 s. Stale rows are now counted and picked with a sequential pass
-- (index scans off for those two statements only), and the closing count is
-- derived from rows removed. Order, cap, guards and grants are unchanged.
-- derived-from: 20261225030000
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $guard$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.reconcile_stale_sg_files_batch(text,uuid,integer,numeric)')
       and md5(p.prosrc) = '932cb9c4d7d4fa9a2477ada001311d71') then
    raise exception 'reconcile_stale_sg_files_batch source differs from 20261225030000; reconcile rather than overwrite';
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
  -- #3458: right after an ingest every row of the previous run is a dead
  -- index entry inside the stale uuid range, so an index range walk visits
  -- ~223k dead heap tuples (random reads) and blew the 8s ceiling. Stale rows
  -- are found with a sequential pass over the small side table instead.
  perform set_config('enable_indexscan', 'off', true);
  perform set_config('enable_indexonlyscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  select count(*) into v_stale
    from public.style_guide_file_crawl_seen s
   where s.root_label = p_root_label
     and (s.crawl_run_id <> p_run_id or s.crawl_run_id is null);
  perform set_config('enable_indexscan', 'on', true);
  perform set_config('enable_indexonlyscan', 'on', true);
  perform set_config('enable_bitmapscan', 'on', true);

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

  -- Stale rows in order (crawl_run_id asc nulls last, id), sequential pass.
  perform set_config('enable_indexscan', 'off', true);
  perform set_config('enable_indexonlyscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  select coalesce(array_agg(x.id), array[]::uuid[])
    into v_ids
    from (select s.style_guide_file_id as id
            from public.style_guide_file_crawl_seen s
           where s.root_label = p_root_label
             and (s.crawl_run_id <> p_run_id or s.crawl_run_id is null)
           order by s.crawl_run_id nulls last, s.style_guide_file_id
           limit v_batch
             for update of s skip locked) x;
  perform set_config('enable_indexscan', 'on', true);
  perform set_config('enable_indexonlyscan', 'on', true);
  perform set_config('enable_bitmapscan', 'on', true);

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

  -- Every selected row leaves the side table (trigger or the delete above);
  -- the advisory lock keeps other reconciles of this root out.
  v_remaining := greatest(v_stale - cardinality(v_ids), 0);

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
