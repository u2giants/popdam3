-- shared-db#6150 / review finding #6157: forward fix for 20261112194140.
-- Re-versioned from 20261112223245 (main advanced); that version stays reserved and unused.
-- core.property_site_path holds licensor-portal paths (OPA/WB/NBCU/Sega site names and ids),
-- the same exposure class core.* tables gate by app role. Replace the open
-- authenticated read (using true) with the standard core.* shared_read predicate.
-- api.mg06_site_path is security invoker, so it inherits this gate. Purely a policy swap.
-- Rollback: drop policy shared_read; recreate property_site_path_read using (true).

drop policy if exists property_site_path_read on core.property_site_path;

create policy shared_read on core.property_site_path
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));
