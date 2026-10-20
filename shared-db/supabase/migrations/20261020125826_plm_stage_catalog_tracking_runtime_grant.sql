-- Issue #4464. Version reissued for migration-author claim #4467 (retires 20261018191107).
-- derived-from: none
-- Stage Catalog production access for DesignFlow tracking, granted to the LOGIN role
-- designflow_prod_tracking_runtime directly (coordinator decision, option (c), recorded on
-- #4475 and #2873).
--
-- Why not designflow_prod_tracking_grants (what 20261018191107 did): in production
-- designflow_prod_backend_runtime is a member of designflow_prod_tracking_grants (and of the
-- data_sync and item_master grant roles), because popcre-tracking-prod still logs in as the
-- backend runtime until its login switch. A grant on the group therefore reached the backend
-- runtime, and 20261018191107's own #2873 post-check rolled it back in production (run
-- 39425038130). 20261018191107 is retired from production; preview and replays still carry
-- it, so this migration first revokes everything it granted to the group (a no-op where it
-- never applied) and drops its policies before recreating them for the runtime role.
--
-- Narrow #2873 amendment: designflow_prod_tracking_runtime is the only runtime role allowed
-- to hold direct privileges, and only these (scripts/proofs/2873-* carry the amended matrix):
--   * USAGE on schema plm only (no CREATE).
--   * SELECT on the seven catalog tables.
--   * INSERT, UPDATE, DELETE on stage_list, stage, stage_duration, stage_dependency,
--     licensor_stage_option (the maintainer editor, models/stage-catalog.model.js).
--   * INSERT, UPDATE on prod_stage_progress and prod_stage_option (tracker tick and
--     Linesheet option, routes/stage-progress.router.js). No DELETE.
--   * INSERT on dflow_prod."AuditLog" (audit rows from both paths).
--   * No EXECUTE grant on plm.stage_catalog_bump_version(): EXECUTE on a trigger function is
--     checked only at CREATE TRIGGER.
-- Nothing is a member of designflow_prod_tracking_runtime except the bootstrap owner, so no
-- other login inherits these grants ($pre$ and $post$ prove it). No role membership changes.
-- RLS stays enabled; each catalog table gets one policy scoped TO the runtime role only.
-- No privilege goes to anon or authenticated. No application rows change.
-- Re-runnable: revokes and drops are idempotent; each policy is dropped before it is created.
-- Rollback: drop the seven policies; revoke the table and schema privileges from
-- designflow_prod_tracking_runtime and restore the #2873 proofs.

do $pre$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_runtime'
                 and rolcanlogin and not rolbypassrls and not rolsuper)
  then raise exception '#4464: designflow_prod_tracking_runtime missing or not a LOGIN NOBYPASSRLS role'; end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
             where m.roleid = 'designflow_prod_tracking_runtime'::regrole
               and r.rolname not in ('postgres', 'supabase_admin'))
  then raise exception '#4464: another role is a member of designflow_prod_tracking_runtime'; end if;
  if (select count(*) from pg_tables where schemaname = 'plm' and tablename in
      ('stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option')) <> 7
  then raise exception '#4464: stage catalog tables are missing'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
                 where n.nspname = 'dflow_prod' and c.relname = 'AuditLog' and c.relkind = 'r'
                   and a.attidentity in ('a','d'))
  then raise exception '#4464: dflow_prod."AuditLog" is missing, not an ordinary table, or its id is not an identity'; end if;
end
$pre$;

-- Undo 20261018191107 wherever it applied (preview, replays); a no-op in production.
revoke all on table plm.stage_list, plm.stage, plm.stage_duration, plm.stage_dependency,
  plm.licensor_stage_option, plm.prod_stage_progress, plm.prod_stage_option
  from designflow_prod_tracking_grants;
revoke insert on table dflow_prod."AuditLog" from designflow_prod_tracking_grants;
revoke usage on schema plm from designflow_prod_tracking_grants;

grant usage on schema plm to designflow_prod_tracking_runtime;

grant select on table plm.stage_list, plm.stage, plm.stage_duration, plm.stage_dependency,
  plm.licensor_stage_option, plm.prod_stage_progress, plm.prod_stage_option
  to designflow_prod_tracking_runtime;

grant insert, update, delete on table plm.stage_list, plm.stage, plm.stage_duration,
  plm.stage_dependency, plm.licensor_stage_option
  to designflow_prod_tracking_runtime;

grant insert, update on table plm.prod_stage_progress, plm.prod_stage_option
  to designflow_prod_tracking_runtime;

grant insert on table dflow_prod."AuditLog" to designflow_prod_tracking_runtime;

drop policy if exists stage_list_dflow_prod_tracking on plm.stage_list;
create policy stage_list_dflow_prod_tracking on plm.stage_list
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists stage_dflow_prod_tracking on plm.stage;
create policy stage_dflow_prod_tracking on plm.stage
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists stage_duration_dflow_prod_tracking on plm.stage_duration;
create policy stage_duration_dflow_prod_tracking on plm.stage_duration
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists stage_dependency_dflow_prod_tracking on plm.stage_dependency;
create policy stage_dependency_dflow_prod_tracking on plm.stage_dependency
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists licensor_stage_option_dflow_prod_tracking on plm.licensor_stage_option;
create policy licensor_stage_option_dflow_prod_tracking on plm.licensor_stage_option
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists prod_stage_progress_dflow_prod_tracking on plm.prod_stage_progress;
create policy prod_stage_progress_dflow_prod_tracking on plm.prod_stage_progress
  for all to designflow_prod_tracking_runtime using (true) with check (true);
drop policy if exists prod_stage_option_dflow_prod_tracking on plm.prod_stage_option;
create policy prod_stage_option_dflow_prod_tracking on plm.prod_stage_option
  for all to designflow_prod_tracking_runtime using (true) with check (true);

do $post$
declare v_bad text;
begin
  select string_agg(t || ':' || p, ', ') into v_bad
  from unnest(array['stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option']) t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege('designflow_prod_tracking_runtime', 'plm.' || t, p)
        is distinct from (p in ('SELECT','INSERT','UPDATE')
                          or (p = 'DELETE' and t not in ('prod_stage_progress','prod_stage_option')));
  if v_bad is not null then raise exception '#4464: privilege matrix differs: %', v_bad; end if;
  if not has_table_privilege('designflow_prod_tracking_runtime', 'dflow_prod."AuditLog"', 'INSERT')
  then raise exception '#4464: INSERT on dflow_prod."AuditLog" missing'; end if;
  if not has_schema_privilege('designflow_prod_tracking_runtime', 'plm', 'USAGE')
     or has_schema_privilege('designflow_prod_tracking_runtime', 'plm', 'CREATE')
  then raise exception '#4464: tracking runtime plm schema privileges wrong'; end if;
  -- Direct grants on the seven tables, AuditLog and plm are exactly the runtime's.
  select string_agg(a.privilege_type, ',') into v_bad
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid = 'dflow_prod."AuditLog"'::regclass
    and a.grantee = 'designflow_prod_tracking_runtime'::regrole and a.privilege_type <> 'INSERT';
  if v_bad is not null then raise exception '#4464: dflow_prod."AuditLog" must be INSERT-only for tracking, found %', v_bad; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(c.relacl) a
             where n.nspname = 'plm' and a.grantee = 'designflow_prod_tracking_grants'::regrole)
     or exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) a
                where n.nspname = 'plm' and a.grantee = 'designflow_prod_tracking_grants'::regrole)
  then raise exception '#4464: designflow_prod_tracking_grants still holds plm privileges'; end if;
  if (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plm' and p.polname = c.relname || '_dflow_prod_tracking' and c.relrowsecurity
        and p.polcmd = '*' and p.polpermissive
        and p.polroles = array['designflow_prod_tracking_runtime'::regrole::oid]
        and pg_get_expr(p.polqual, p.polrelid) = 'true' and pg_get_expr(p.polwithcheck, p.polrelid) = 'true') <> 7
  then raise exception '#4464: the seven role-scoped policies on RLS-enabled tables are not exact'; end if;
  -- No other login inherits the runtime role.
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
             where m.roleid = 'designflow_prod_tracking_runtime'::regrole
               and r.rolname not in ('postgres', 'supabase_admin'))
  then raise exception '#4464: another role is a member of designflow_prod_tracking_runtime'; end if;
  -- #2873 schema boundary (20261008025618:1026), narrowed: plm only for the tracking runtime.
  if exists (select 1 from unnest(array['backend','item_master','data_sync']) s
             where to_regrole('designflow_prod_'||s||'_runtime') is not null
               and has_schema_privilege('designflow_prod_'||s||'_runtime', 'plm', 'USAGE,CREATE'))
  then raise exception '#2873: a non-tracking designflow_prod runtime reaches plm'; end if;
end
$post$;
