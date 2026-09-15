-- Issue #2792 -- PopSG stale-file reconciliation must finish under the ordinary
-- production statement ceiling.
--
-- WHY THIS EXISTS
-- ---------------
-- Production nightly PopSG crawls (~216k accepted files) ended with
-- `public.reconcile_stale_sg_files_batch` failing SQLSTATE 57014 at the normal
-- 8s statement timeout, every night, changing zero rows (u2giants/popdam3#107).
-- The #2212 bodies were bounded in ROWS WRITTEN but not in ROWS READ:
--
--  * victims were chosen `order by f.id` over `is_active and crawl_run_id is
--    distinct from <run>`. The partial index idx_sgf_reconcile_root_active_run_id
--    (root_label, crawl_run_id, id) WHERE is_active cannot serve an id ordering,
--    so each batch walked the ~213k rows the accepted run had just re-seen to
--    find a few thousand stale ones;
--  * preview_stale_sg_files counted the whole root, inactive rows included,
--    and the batch repeated that full count after every write.
--
-- WHAT CHANGES (signatures, return shapes, grants, guards unchanged)
-- -----------------------------------------------------------------
--  1. preview_stale_sg_files counts in one pass over the active partial index
--     (inactive rows are never read). The empty / inaccessible / ratio guard
--     logic is byte-for-byte the same. The batch's FIRST call per run uses this
--     exact preview; later calls count stale rows from the stale index ranges
--     and prove the ratio by reading at most ceil(r*stale/(1-r)) run-active
--     entries, falling back to the exact preview whenever that proof fails, so
--     every guard decision equals preview's.
--  2. reconcile_stale_sg_files_batch picks victims as three ordered index RANGE
--     scans -- crawl_run_id < run, crawl_run_id > run, crawl_run_id IS NULL --
--     so the accepted run's own rows are never visited. Continuation order is
--     deterministic: (crawl_run_id asc nulls last, id).
--  3. Rows written per call are capped at 500 (was up to 50,000). A larger
--     request is honoured as 500 and returns done=false with the exact
--     remaining count; callers already loop until done. Measured on a preview
--     clone (217,193 active, 4,137 stale): 500 rows 1.8-2.6s, 1,000 rows 5.5s,
--     2,000 rows 6.8s -- so 500 keeps a wide margin under 8s.
--  4. remaining is recounted from the stale index ranges only.
--
-- Advisory serialization, reversible inactivation (is_active=false, never a
-- delete), active search-document sync, counters, completion stamps, and the
-- attention_required parking on a guard refusal are preserved exactly. No new
-- index, no timeout change, no row data touched by this migration.

begin;

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

  -- #2792: one pass over the partial index idx_sgf_reconcile_root_active_run_id;
  -- inactive rows of the root are never read.
  select count(*),
         count(*) filter (where f.crawl_run_id = p_run_id)
    into v_active, v_run_active
    from public.style_guide_files f
   where f.root_label = p_root_label
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

comment on function public.preview_stale_sg_files(text, uuid, numeric) is
  'Issues #2212/#2792. Read-only preview of stale reconciliation candidates and the empty / inaccessible / low-nonzero guards, counted from the active partial index only. Mutates nothing. Service-role only.';

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
  -- #2792: at most 500 rows are written per call so every call stays well
  -- under the 8s statement ceiling (each inactivation fires the tagging trigger
  -- and maintains ~22 indexes; measured ~3.7 ms/row at clone volume). Larger
  -- requests continue via done=false.
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
  -- Serialize every reconciliation of a single root. Without this, two accepted
  -- runs that each crawled roughly half of one root each see the OTHER run's
  -- rows as stale; both pass the ratio guard on their own half, and together they
  -- inactivate every active row of the root. FOR UPDATE SKIP LOCKED does not
  -- prevent that -- the two batches touch disjoint rows, so neither ever blocks.
  -- The lock is transaction-scoped, so it is released with the caller's commit.
  perform pg_advisory_xact_lock(hashtext(p_root_label));

  -- #2792: stale rows are counted from the three stale index ranges only; the
  -- accepted run's own (re-seen) entries are never walked for this count.
  select (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id is null)
    into v_stale;

  select true, r.files_found,
         coalesce(p_root_label = any (coalesce(r.inaccessible_roots, array[]::text[])), false),
         r.stale_candidates_at_start, r.active_before_reconcile
    into v_run_exists, v_found, v_inaccessible, v_start_stale, v_start_active
    from public.style_guide_crawl_runs r
   where r.id = p_run_id;

  -- Fast guard, used only once this run's start counters exist (i.e. after an
  -- exact first call). preview's ratio guard refuses when run/(run+stale) < r,
  -- which for 0 <= ... r < 1 is exactly run < r*stale/(1-r). So it suffices to
  -- prove at least v_need run-active rows exist, reading at most v_need index
  -- entries. Whenever the proof is not obtained, the exact preview decides.
  if coalesce(v_run_exists, false)
     and not coalesce(v_inaccessible, false)
     and coalesce(v_found, 0) > 0
     and v_ratio < 1
     and v_start_stale is not null
     and v_start_active is not null then
    v_need := greatest(1, ceil(v_ratio * v_stale / (1 - v_ratio)))::bigint;
    select count(*) into v_run_seen
      from (select 1
              from public.style_guide_files f
             where f.root_label = p_root_label
               and f.is_active
               and f.crawl_run_id = p_run_id
             limit v_need) s;
    v_fast_ok := (v_run_seen >= v_need);
  end if;

  if not v_fast_ok then
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

  -- #2792: bounded in rows READ as well as rows written. Three ordered range
  -- scans of idx_sgf_reconcile_root_active_run_id -- crawl_run_id < run, then
  -- > run, then IS NULL -- skip the accepted run's own (re-seen) rows entirely,
  -- each taking only what the batch still needs. The overall order is
  -- (crawl_run_id asc nulls last, id): deterministic, and an interrupted run
  -- resumes exactly where it stopped. (Row locks cannot sit on a UNION, hence
  -- three statements.)
  select coalesce(array_agg(s.id), array[]::uuid[])
    into v_ids
    from (select f.id
            from public.style_guide_files f
           where f.root_label = p_root_label
             and f.is_active
             and f.crawl_run_id < p_run_id
           order by f.crawl_run_id, f.id
           limit v_batch
             for update of f skip locked) s;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(s.id), array[]::uuid[])
      into v_ids
      from (select f.id
              from public.style_guide_files f
             where f.root_label = p_root_label
               and f.is_active
               and f.crawl_run_id > p_run_id
             order by f.crawl_run_id, f.id
             limit v_batch - cardinality(v_ids)
               for update of f skip locked) s;
  end if;

  if cardinality(v_ids) < v_batch then
    select v_ids || coalesce(array_agg(s.id), array[]::uuid[])
      into v_ids
      from (select f.id
              from public.style_guide_files f
             where f.root_label = p_root_label
               and f.is_active
               and f.crawl_run_id is null
             order by f.id
             limit v_batch - cardinality(v_ids)
               for update of f skip locked) s;
  end if;

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

  -- Exact remaining, from the three stale index ranges only. Every active row
  -- of the root is either run-stamped or in exactly one of these ranges.
  select (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id < p_run_id)
       + (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id > p_run_id)
       + (select count(*) from public.style_guide_files f
           where f.root_label = p_root_label and f.is_active and f.crawl_run_id is null)
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

comment on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) is
  'Issues #2212/#2792. Bounded (<= 500 rows per call), index-range, idempotent, resumable stale reconciliation for one root and one accepted crawl run; continuation order (crawl_run_id nulls last, id). Refuses to inactivate anything when the empty / inaccessible / low-nonzero guard fires. Service-role only.';

-- CREATE OR REPLACE keeps existing ACLs; restated so the contract is explicit.
revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from public;
revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from anon;
revoke all on function public.preview_stale_sg_files(text, uuid, numeric) from authenticated;
grant execute on function public.preview_stale_sg_files(text, uuid, numeric) to service_role;

revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from public;
revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from anon;
revoke all on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) from authenticated;
grant execute on function public.reconcile_stale_sg_files_batch(text, uuid, integer, numeric) to service_role;

commit;
