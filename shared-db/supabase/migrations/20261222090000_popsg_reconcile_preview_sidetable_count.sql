-- popcre/shared-db#3458 (u2giants/popdam3#107): nightly PopSG crawls now fail at
-- reconcile, before the matview refresh, with "canceling statement due to
-- statement timeout" (production runs 2026-11-12..2026-11-16). The first
-- reconcile_stale_sg_files_batch call runs preview_stale_sg_files, which joined
-- every crawl_seen row back to style_guide_files to re-check is_active. Right
-- after an ingest rewrites ~223k file rows the visibility map is cleared, so that
-- index-only scan becomes ~61k heap fetches: 4.2 s idle, past 8 s under load.
-- style_guide_file_crawl_seen holds exactly one row per ACTIVE file: the
-- trg_style_guide_files_crawl_seen trigger deletes the row when is_active turns
-- false and the foreign key cascades file deletes (production 2026-11-18: 223446
-- side rows, 223446 active files, 0 side rows on inactive files). Counting the
-- side table alone gives identical numbers in 0.2 s. Function body only; grants
-- are unchanged by CREATE OR REPLACE.
-- derived-from: 20261111132448
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.preview_stale_sg_files(text,uuid,numeric)')
       and md5(p.prosrc) = 'e7c49634b4a489a397670885c123244a') then
    raise exception 'preview_stale_sg_files source differs from 20261111132448; reconcile rather than overwrite';
  end if;
  -- The side-table invariant this body relies on must still be enforced.
  if not exists (
       select 1 from pg_trigger t
        where t.tgrelid = 'public.style_guide_files'::regclass
          and t.tgname = 'trg_style_guide_files_crawl_seen' and t.tgenabled <> 'D')
     or not exists (
       select 1 from pg_constraint c
        where c.conrelid = 'public.style_guide_file_crawl_seen'::regclass
          and c.confrelid = 'public.style_guide_files'::regclass
          and c.contype = 'f' and c.confdeltype = 'c') then
    raise exception 'style_guide_file_crawl_seen is no longer kept to active files only';
  end if;
end;
$guard$;

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

  -- popdam3#804 / #3458: the side table holds one row per active file only
  -- (trigger delete on deactivation, cascade on file delete), so it is counted
  -- alone; no per-row recheck of style_guide_files.
  select count(*),
         count(*) filter (where s.crawl_run_id = p_run_id)
    into v_active, v_run_active
    from public.style_guide_file_crawl_seen s
   where s.root_label = p_root_label;

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

commit;
