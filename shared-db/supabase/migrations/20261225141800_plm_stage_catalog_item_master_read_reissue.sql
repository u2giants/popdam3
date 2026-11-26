-- Follow-up hardening for 20261225141700 (PR #7155, designflow-tracking#130, claim #7154).
-- 20261225141700 applied to preview and production (run 45861284988) and is
-- blocked on sandbox (run 45852863298) where designflow_prod_* roles do not exist.
--
-- Addresses #7156 findings 1 & 2:
--   1. Grants directly to the LOGIN role designflow_prod_item_master_runtime
--      (the #4464 option (c) pattern, matching 20261020125826) and revokes any
--      Stage Catalog table privileges 20261225141700 left on
--      designflow_prod_item_master_grants during ephemeral/preview replays.
--      USAGE ON SCHEMA plm on designflow_prod_item_master_grants is untouched
--      because 20261225120100 relies on it for plm.designflow_item.
--   2. Uses DROP POLICY IF EXISTS before CREATE POLICY for idempotent replay.
--   3. Raises in $pre$ when designflow_prod_item_master_runtime is absent so
--      from-empty ephemeral replay restores the role before running this
--      migration in pass 2 (matching 20261020125826). Production-only runtime
--      grant; sandbox connects directly without designflow_prod_* roles.
--
-- derived-from: none
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $pre$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'designflow_prod_item_master_runtime'
      and rolcanlogin and not rolbypassrls and not rolsuper
  ) then
    raise exception '#7154: designflow_prod_item_master_runtime missing or not a LOGIN NOBYPASSRLS role';
  end if;
  if exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
    where m.roleid = 'designflow_prod_item_master_runtime'::regrole
      and r.rolname not in ('postgres', 'supabase_admin')
  ) then
    raise exception '#7154: another role is a member of designflow_prod_item_master_runtime';
  end if;
end
$pre$;

revoke all on table plm.stage_list, plm.stage, plm.stage_duration
  from designflow_prod_item_master_grants;

drop policy if exists stage_list_dflow_prod_item_master_read on plm.stage_list;
drop policy if exists stage_dflow_prod_item_master_read on plm.stage;
drop policy if exists stage_duration_dflow_prod_item_master_read on plm.stage_duration;

grant usage on schema plm to designflow_prod_item_master_runtime;

grant select (id, key) on table plm.stage_list to designflow_prod_item_master_runtime;
grant select (id, list_id, done_signal, active)
  on table plm.stage to designflow_prod_item_master_runtime;
grant select (stage_id, scope_kind, scope_value, duration)
  on table plm.stage_duration to designflow_prod_item_master_runtime;

create policy stage_list_dflow_prod_item_master_read on plm.stage_list
  for select to designflow_prod_item_master_runtime using (true);
create policy stage_dflow_prod_item_master_read on plm.stage
  for select to designflow_prod_item_master_runtime using (true);
create policy stage_duration_dflow_prod_item_master_read on plm.stage_duration
  for select to designflow_prod_item_master_runtime using (true);

commit;
