-- REVERT 20260726190000. Restore open Master Data (style tracker) writes.
--
-- 20260726190000_style_tracker_rows_restrict_writes.sql restricted
-- public.style_tracker_rows INSERT/UPDATE to PopDAM admin / app administrator /
-- designer / licensing. That was WRONG: every signed-in PopDAM user is supposed to
-- edit Master Data -- it is the entire purpose of the Styles grid at
-- dam.designflow.app/styles. The restriction locked all 33 plain 'user' accounts
-- out of the feature.
--
-- The permissive policy is DELIBERATE. Do not "harden" it again. It looks anomalous
-- next to public.assets / public.style_groups (which correctly require admin), but
-- those are asset-management tables; style_tracker_rows is the shared team worksheet.
--
-- Why the earlier session thought tightening was safe (both misleading):
--   * public.style_tracker_audit_log was empty -- because the audit trigger is recent
--     and backfills ran with it disabled, NOT because the grid is unused.
--   * public.app_role has only admin|user, so there is no non-admin "editor" role to
--     grant; restricting to admin removes the capability from everyone else.
--
-- If a read-only DAM tester is needed, express that with the app-schema roles that
-- gate the shared api.*/dam.* contracts. Never narrow this table.
-- See AGENTS.md section 0.4.
--
-- Unchanged by this migration: DELETE stays admin-only; SELECT stays open to any
-- authenticated user.

drop policy if exists "Editors insert style tracker rows" on public.style_tracker_rows;
drop policy if exists "Editors update style tracker rows" on public.style_tracker_rows;
drop policy if exists "Authenticated users insert style tracker rows" on public.style_tracker_rows;
drop policy if exists "Authenticated users update style tracker rows" on public.style_tracker_rows;

create policy "Authenticated users insert style tracker rows"
  on public.style_tracker_rows
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users update style tracker rows"
  on public.style_tracker_rows
  for update
  to authenticated
  using (true)
  with check (true);

comment on table public.style_tracker_rows is
  'Master Data / Styles grid rows. INSERT+UPDATE are intentionally open to every authenticated user -- the whole team edits this. Do not restrict (see AGENTS.md 0.4; a 2026-07-26 restriction locked out all non-admin users and was reverted).';

notify pgrst, 'reload schema';
