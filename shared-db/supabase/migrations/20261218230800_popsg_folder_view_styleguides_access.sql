-- derived-from: 20261218043336
--
-- PopDAM #1103 (shared-db claim #6754). Owner ruling 2026-11-18: "people who
-- use only PopSG should see every licensor and property in the style-guide
-- filters."
--
-- WHY
-- ---
-- public.style_guide_folders is the caller-gated projection over the folder
-- snapshot. Its gate admits only app.has_app_access('dam'), so a PopSG-only
-- user (public app_access 'styleguides', no 'dam') reads zero folder rows and
-- the licensor/property filter tree is empty. PopSG's own search RPCs already
-- authorize on public.has_app_access(auth.uid(), 'styleguides').
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Replaces the view with the same columns and the same snapshot source, and
-- widens only the gate: dam OR styleguides. CREATE OR REPLACE keeps the
-- existing grants (authenticated, service_role). Anonymous and no-access
-- identities still see zero rows.
--
-- ROLLBACK (named)
-- ----------------
-- Re-create the view with only the dam gate:
--   create or replace view public.style_guide_folders with (security_invoker = false) as
--     select * from public.style_guide_folders_snapshot
--     where (select app.has_app_access('dam'::app.app_name));

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name))
     or (select public.has_app_access(auth.uid(), 'styleguides'::public.app_name));

commit;
