-- Restrict Master Data (style tracker) writes to actual editors.
--
-- Found 2026-07-26 while provisioning role-tiered DAM test accounts: the
-- public.style_tracker_rows INSERT/UPDATE policies were
-- `using (true) with check (true)`, so ANY authenticated user -- including a
-- 'viewer' -- could edit Master Data rows, while sibling tables
-- (public.assets, public.style_groups) correctly required an admin role.
-- That is an unintended write hole on the Styles / Master Data grid, which now
-- also writes the canonical customer_id FK (20260722210100).
--
-- New rule, mirroring the established write model on dam.customer_ext
-- (administrator, or the designer/licensing editing roles) and additionally
-- honouring PopDAM's own admin role:
--   INSERT/UPDATE -> public admin  OR  app administrator  OR  designer/licensing
--   DELETE        -> unchanged (public admin only)
--   SELECT        -> unchanged (any authenticated user may read)
--
-- Blast radius checked before applying: public.style_tracker_audit_log had ZERO
-- rows, i.e. no user had ever edited Master Data through the app, so no existing
-- workflow depends on the permissive policy. Users who need edit access should
-- be granted the 'designer' role (app.user_role) rather than re-opening this.

-- Idempotent: drop both the legacy permissive policies and any prior run of the
-- replacements before recreating them.
drop policy if exists "Authenticated users insert style tracker rows" on public.style_tracker_rows;
drop policy if exists "Authenticated users update style tracker rows" on public.style_tracker_rows;
drop policy if exists "Editors insert style tracker rows" on public.style_tracker_rows;
drop policy if exists "Editors update style tracker rows" on public.style_tracker_rows;

create policy "Editors insert style tracker rows"
  on public.style_tracker_rows
  for insert
  to authenticated
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or app.has_role('administrator'::app.app_role)
    or app.has_any_role(array['designer', 'licensing']::app.app_role[])
  );

create policy "Editors update style tracker rows"
  on public.style_tracker_rows
  for update
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or app.has_role('administrator'::app.app_role)
    or app.has_any_role(array['designer', 'licensing']::app.app_role[])
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or app.has_role('administrator'::app.app_role)
    or app.has_any_role(array['designer', 'licensing']::app.app_role[])
  );

notify pgrst, 'reload schema';
