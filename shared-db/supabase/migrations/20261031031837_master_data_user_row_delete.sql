-- Issue #5128 (claim-first, claim #5209): re-derivation of merged-but-stranded
-- 20261030125352 under a fresh reserved version. Owner request, Albert Hazan,
-- 2026-10-30 (ZCode chat): "pull the latest repo and allow admins to delete
-- user-created rows in master data".
--
-- WHY A SECOND VERSION: 20261030125352 merged clean (PR #5129) but entered the
-- PREVIEW ledger inside batch run 41143267036, which later failed on ANOTHER
-- migration's rollback and concluded failure. The production gate then refused
-- the batch's evidence ("original apply run has wrong conclusion"), and an
-- applied version is never applied again — so the version is permanently
-- un-promotable (same shape as the #4508 orphan). Superseding with this fresh
-- version restores the automatic promotion lane; the SQL body is byte-identical
-- to 20261030125352 below the derivation line, and every statement is
-- idempotent (create-or-replace functions, constraint drop/re-add of the same
-- definition, no-op backfill guarded by origin is null).
--
-- derived-from: 20260710135700


begin;

-- 1. Audit event type gains 'row_deleted' (2,802 rows; cheap check re-add).
alter table public.style_tracker_audit_log
  drop constraint style_tracker_audit_log_event_type_check;

alter table public.style_tracker_audit_log
  add constraint style_tracker_audit_log_event_type_check
  check (event_type = any (array['row_added'::text, 'cell_update'::text, 'value_resolution'::text, 'row_deleted'::text]));

-- 2. add_style_tracker_rows: stamp user-added rows so they stay identifiable
--    after the user fills cells (cell writes merge into row_data but keep
--    existing keys). Full re-derivation of the 20260710135700 body with only
--    the row_data literal changed.
create or replace function public.add_style_tracker_rows(p_source_sheet text, p_tracker_type text, p_count integer default 1)
 returns setof style_tracker_rows
 language plpgsql
 security definer
 set search_path to 'public', 'plm'
as $function$
declare
  v_count integer;
  v_start_row integer;
begin
  if p_source_sheet not in ('License.Style', 'Generic.Style') then
    raise exception 'Unsupported source_sheet: %', p_source_sheet;
  end if;

  if p_tracker_type not in ('licensed', 'generic', 'vendor', 'project', 'order', 'other') then
    raise exception 'Unsupported tracker_type: %', p_tracker_type;
  end if;

  v_count := greatest(1, least(coalesce(p_count, 1), 25));

  select coalesce(max(source_row_number), 2) + 1
  into v_start_row
  from public.style_tracker_rows
  where source_workbook_id = '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214'
    and source_sheet = p_source_sheet;

  return query
  insert into public.style_tracker_rows (
    source_workbook_id,
    source_sheet,
    source_row_number,
    tracker_type,
    row_data
  )
  select
    '1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214',
    p_source_sheet,
    v_start_row + offset_value,
    p_tracker_type,
    jsonb_build_object('origin', 'user_added')
  from generate_series(0, v_count - 1) as offset_value
  returning *;
end;
$function$;

-- Production already holds these grants (verified 2026-10-30), but no migration
-- declared them, so a from-empty replay denies the call. Declared here while
-- re-deriving the function, matching the delete RPC's discipline below.
revoke all on function public.add_style_tracker_rows(text, text, integer) from public;
grant execute on function public.add_style_tracker_rows(text, text, integer) to authenticated;
grant execute on function public.add_style_tracker_rows(text, text, integer) to service_role;

-- 3. Guarded delete entry point. SECURITY DEFINER because the audit table has
--    no INSERT policy for authenticated callers (audit writes normally happen
--    through the SECURITY DEFINER trigger); the explicit has_role gate below
--    replaces the RLS admin DELETE policy this function bypasses.
create or replace function public.delete_style_tracker_rows(p_row_ids uuid[])
 returns table(deleted_count integer, skipped_count integer)
 language plpgsql
 security definer
 set search_path to 'public', 'plm'
as $function$
declare
  v_deleted integer;
  v_skipped integer;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'delete_style_tracker_rows requires the admin role'
      using errcode = '42501';
  end if;

  -- Audit BEFORE delete: the audit FK on style_tracker_row_id is ON DELETE SET
  -- NULL, so history survives the row itself.
  insert into public.style_tracker_audit_log (
    event_type,
    style_tracker_row_id,
    source_sheet,
    source_row_number,
    column_letter,
    field_key,
    metadata,
    changed_by
  )
  select
    'row_deleted',
    r.id,
    r.source_sheet,
    r.source_row_number,
    null,
    null,
    jsonb_build_object(
      'tracker_type', r.tracker_type,
      'sku', r.sku,
      'origin', r.row_data ->> 'origin',
      'row_data', r.row_data
    ),
    auth.uid()
  from public.style_tracker_rows r
  where r.id = any(p_row_ids)
    and r.row_data ->> 'origin' = 'user_added';

  delete from public.style_tracker_rows r
  where r.id = any(p_row_ids)
    and r.row_data ->> 'origin' = 'user_added';

  get diagnostics v_deleted = row_count;
  select greatest(coalesce(cardinality(p_row_ids), 0) - v_deleted, 0)
  into v_skipped;

  return query select v_deleted, v_skipped;
end;
$function$;

revoke all on function public.delete_style_tracker_rows(uuid[]) from public;
grant execute on function public.delete_style_tracker_rows(uuid[]) to authenticated;

-- 4. One-time backfill: rows whose row_added audit event names a real user and
--    which carry no origin yet are the user-created rows added before the
--    stamp existed (verified 3, all blank). Auto-flow rows keep their own
--    origin; sheet-synced rows have no user-authored row_added event.
with user_added as (
  select distinct a.style_tracker_row_id
  from public.style_tracker_audit_log a
  where a.event_type = 'row_added'
    and a.changed_by is not null
)
update public.style_tracker_rows r
set row_data = r.row_data || jsonb_build_object('origin', 'user_added')
from user_added u
where r.id = u.style_tracker_row_id
  and r.row_data ->> 'origin' is null;

commit;
