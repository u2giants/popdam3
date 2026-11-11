-- u2giants/popdam3#804: stop the one-minute default-visible sweep from
-- reading all of public.dam_search_documents every minute.
-- Production read-only evidence 2026-11-10 7:50 PM EST: the cron job
-- dam-default-visible-flag-sweep (* * * * *) runs this procedure 1,440 times a
-- day; its OR predicate has no index, so every run sequentially scans the
-- 462 MB heap (seq_scan 6,413, heap_blks_read 326 M, table heap hit 10 %),
-- even with 0 rows pending. That is constant background read I/O on the
-- shared database that competes with PopDAM and PopSG searches.
-- Fix: two small indexes that cover each branch of the predicate, and the
-- same selection written as a UNION of index-friendly branches. Same rows,
-- same limit, same per-row refresh and commit.
-- derived-from: 20261108190600
begin;
set local lock_timeout='500ms';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_sweep_default_visible_flags_batched(integer)')
      and md5(p.prosrc) = '9cd9a43d98cfa06455fcf0509f780b5a') then
    if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.dam_sweep_default_visible_flags_batched(integer)')
        and p.prosrc like '%#804 indexed sweep%') then
      raise exception '#804 pre-change dam_sweep_default_visible_flags_batched differs from 20261108190600; reconcile rather than overwrite';
    end if;
  end if;
end;
$guard$;

-- Rows whose flag or count is unknown (normally none).
create index if not exists dam_search_documents_default_visible_null_idx
  on public.dam_search_documents (document_type, entity_id)
  where has_default_visible_member is null or default_visible_member_count is null;

-- Rows computed with a different thumbnail minimum date (or none).
create index if not exists dam_search_documents_default_visible_min_date_idx
  on public.dam_search_documents (default_visible_min_date);

create or replace procedure public.dam_sweep_default_visible_flags_batched(in p_limit integer default 5000)
 language plpgsql
as $procedure$
-- #804 indexed sweep: each branch is answered by an index, never a full scan.
declare v_min timestamptz := public.assets_thumbnail_min_date(); r record;
begin
  for r in
    select s.document_type, s.entity_id from (
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.has_default_visible_member is null or d.default_visible_member_count is null
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date is null
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date < v_min
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where d.default_visible_min_date > v_min
      union
      select d.document_type, d.entity_id from public.dam_search_documents d
       where v_min is null and d.default_visible_min_date is not null
    ) s
     limit greatest(p_limit, 0)
  loop
    perform public.dam_refresh_default_visible_flag(r.document_type, r.entity_id);
    commit;
  end loop;
end
$procedure$;

commit;
