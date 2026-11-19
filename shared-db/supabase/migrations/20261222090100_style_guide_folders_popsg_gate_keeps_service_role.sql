-- derived-from: 20261218230800
--
-- PopDAM #1103 (shared-db claim #6754). Fix-forward for 20261218230800, which
-- widened the style_guide_folders gate to styleguides access but dropped the
-- service_role arm that 20261218090000 (#6452) added. Review finding #6771
-- (BLOCKER): service-role readers, such as popsg-readiness-baseline, would go
-- back to zero rows.
--
-- WHY
-- ---
-- Owner ruling 2026-11-18: "people who use only PopSG should see every licensor
-- and property in the style-guide filters."
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Recreates public.style_guide_folders over the same snapshot with the gate:
--   dam access OR styleguides access OR service_role.
-- Anonymous and no-access identities still see zero rows. Grants unchanged.
-- Asserts the gate contains all three arms before commit.
--
-- ROLLBACK (named)
-- ----------------
-- Restore the 20261218090000 gate (dam OR service_role):
--   create or replace view public.style_guide_folders with (security_invoker = false) as
--     select * from public.style_guide_folders_snapshot
--     where (select app.has_app_access('dam'::app.app_name) or auth.role() = 'service_role');

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view public.style_guide_folders with (security_invoker = false) as
  select * from public.style_guide_folders_snapshot
  where (select app.has_app_access('dam'::app.app_name))
     or (select public.has_app_access(auth.uid(), 'styleguides'::public.app_name))
     or auth.role() = 'service_role';

do $$
declare
  v_def text;
begin
  select pg_get_viewdef('public.style_guide_folders'::regclass, true) into v_def;
  if v_def is null
     or position('has_app_access' in v_def) = 0
     or position('styleguides' in v_def) = 0
     or position('service_role' in v_def) = 0 then
    raise exception 'style_guide_folders gate must admit dam, styleguides and service_role (#1103, #6452)';
  end if;
end
$$;

commit;
