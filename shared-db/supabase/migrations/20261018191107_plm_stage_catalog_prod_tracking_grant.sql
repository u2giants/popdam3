-- Issue #4464. Version reserved by migration-author claim #4467.
-- derived-from: none
-- Stage Catalog production access for DesignFlow tracking
-- (popcre/designflow-tracking#124; coordinator decisions #4475 comments 6255045042
-- and 6255388129, mirrored on #2873).
--
-- Narrow #2873 amendment. Privileges go on designflow_prod_tracking_grants, the NOLOGIN
-- grant role that the #2873 identity contract (forward replacement 20261008025618) gives,
-- INHERIT, to the tracking LOGIN role designflow_prod_tracking_runtime. Only the tracking
-- runtime gains plm, and only on the objects below; plm stays forbidden for the backend,
-- item-master and data-sync runtimes. 20261008025618 is applied and immutable, so its
-- schema-boundary check is re-asserted here in narrowed form ($post$), and the #2873
-- proofs (scripts/proofs/2873-*) carry the amended matrix. No role membership changes.
-- Production benefits once popcre-tracking-prod logs in as designflow_prod_tracking_runtime
-- (separate work, #4475); until then the grant is additive and unused.
--
-- Grant matrix, confirmed against designflow-tracking (sandbox-albert):
--   * USAGE on schema plm only (no CREATE).
--   * SELECT on the seven catalog tables.
--   * INSERT, UPDATE, DELETE on the five tables the maintainer editor writes
--     (models/stage-catalog.model.js): stage_list, stage, stage_duration,
--     stage_dependency, licensor_stage_option.
--   * INSERT, UPDATE on prod_stage_progress and prod_stage_option: the tracker tick and
--     Linesheet option (routes/stage-progress.router.js) do SELECT ... FOR UPDATE and
--     INSERT ... ON CONFLICT DO UPDATE. No DELETE: the code never deletes there.
--   * INSERT on dflow_prod."AuditLog": both paths write an audit row (same grant the
--     item-master role holds in 20261008014009).
--   * No EXECUTE grant on plm.stage_catalog_bump_version(): PostgreSQL checks EXECUTE on a
--     trigger function only at CREATE TRIGGER, never for the role whose write fires it
--     (the contract test proves the version bump as this role).
--   Identity columns need no sequence grant (the contract test inserts as the role).
-- RLS stays enabled on the catalog. The role is NOBYPASSRLS, so each catalog table gets
-- one policy scoped TO designflow_prod_tracking_grants only (row authority is the tracking
-- API's maintainer check, as for service_role). No privilege goes to anon or authenticated.
-- No application rows change. USAGE on plm also reaches plm functions already EXECUTE-able
-- by PUBLIC; that pre-existing exposure is tracked in #4474 and is not widened here.
-- Re-runnable: each policy is dropped if present before it is created.
-- Rollback: drop the seven policies; revoke the table and schema privileges from
-- designflow_prod_tracking_grants and restore the #2873 proofs.

do $pre$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_grants' and not rolcanlogin and not rolbypassrls)
  then raise exception '#4464: designflow_prod_tracking_grants missing or not a NOLOGIN NOBYPASSRLS role'; end if;
  if (select count(*) from pg_tables where schemaname = 'plm' and tablename in
      ('stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option')) <> 7
  then raise exception '#4464: stage catalog tables are missing'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
                 where n.nspname = 'dflow_prod' and c.relname = 'AuditLog' and c.relkind = 'r'
                   and a.attidentity in ('a','d'))
  then raise exception '#4464: dflow_prod."AuditLog" is missing, not an ordinary table, or its id is not an identity'; end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_runtime' and rolcanlogin)
  then raise exception '#4464: designflow_prod_tracking_runtime missing'; end if;
end
$pre$;

grant usage on schema plm to designflow_prod_tracking_grants;

grant select on table plm.stage_list, plm.stage, plm.stage_duration, plm.stage_dependency,
  plm.licensor_stage_option, plm.prod_stage_progress, plm.prod_stage_option
  to designflow_prod_tracking_grants;

grant insert, update, delete on table plm.stage_list, plm.stage, plm.stage_duration,
  plm.stage_dependency, plm.licensor_stage_option
  to designflow_prod_tracking_grants;

grant insert, update on table plm.prod_stage_progress, plm.prod_stage_option
  to designflow_prod_tracking_grants;

grant insert on table dflow_prod."AuditLog" to designflow_prod_tracking_grants;

drop policy if exists stage_list_dflow_prod_tracking on plm.stage_list;
create policy stage_list_dflow_prod_tracking on plm.stage_list
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists stage_dflow_prod_tracking on plm.stage;
create policy stage_dflow_prod_tracking on plm.stage
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists stage_duration_dflow_prod_tracking on plm.stage_duration;
create policy stage_duration_dflow_prod_tracking on plm.stage_duration
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists stage_dependency_dflow_prod_tracking on plm.stage_dependency;
create policy stage_dependency_dflow_prod_tracking on plm.stage_dependency
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists licensor_stage_option_dflow_prod_tracking on plm.licensor_stage_option;
create policy licensor_stage_option_dflow_prod_tracking on plm.licensor_stage_option
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists prod_stage_progress_dflow_prod_tracking on plm.prod_stage_progress;
create policy prod_stage_progress_dflow_prod_tracking on plm.prod_stage_progress
  for all to designflow_prod_tracking_grants using (true) with check (true);
drop policy if exists prod_stage_option_dflow_prod_tracking on plm.prod_stage_option;
create policy prod_stage_option_dflow_prod_tracking on plm.prod_stage_option
  for all to designflow_prod_tracking_grants using (true) with check (true);

do $post$
declare v_bad text;
begin
  select string_agg(t || ':' || p, ', ') into v_bad
  from unnest(array['stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option']) t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege('designflow_prod_tracking_grants', 'plm.' || t, p)
        is distinct from (p in ('SELECT','INSERT','UPDATE')
                          or (p = 'DELETE' and t not in ('prod_stage_progress','prod_stage_option')));
  if v_bad is not null then raise exception '#4464: privilege matrix differs: %', v_bad; end if;
  if not has_table_privilege('designflow_prod_tracking_grants', 'dflow_prod."AuditLog"', 'INSERT')
  then raise exception '#4464: INSERT on dflow_prod."AuditLog" missing'; end if;
  if has_schema_privilege('designflow_prod_tracking_grants', 'plm', 'CREATE')
  then raise exception '#4464: CREATE on plm must not be granted'; end if;
  select string_agg(a.privilege_type, ',') into v_bad
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid = 'dflow_prod."AuditLog"'::regclass
    and a.grantee = 'designflow_prod_tracking_grants'::regrole and a.privilege_type <> 'INSERT';
  if v_bad is not null then raise exception '#4464: dflow_prod."AuditLog" must be INSERT-only for tracking, found %', v_bad; end if;
  if (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plm' and p.polname = c.relname || '_dflow_prod_tracking' and c.relrowsecurity
        and p.polcmd = '*' and p.polpermissive
        and p.polroles = array['designflow_prod_tracking_grants'::regrole::oid]
        and pg_get_expr(p.polqual, p.polrelid) = 'true' and pg_get_expr(p.polwithcheck, p.polrelid) = 'true') <> 7
  then raise exception '#4464: the seven role-scoped policies on RLS-enabled tables are not exact'; end if;
  -- #2873 schema boundary (20261008025618:1026), narrowed: plm only for the tracking runtime.
  if not has_schema_privilege('designflow_prod_tracking_runtime', 'plm', 'USAGE')
     or has_schema_privilege('designflow_prod_tracking_runtime', 'plm', 'CREATE')
  then raise exception '#4464: tracking runtime plm schema privileges wrong'; end if;
  if exists (select 1 from unnest(array['backend','item_master','data_sync']) s
             where to_regrole('designflow_prod_'||s||'_runtime') is not null
               and has_schema_privilege('designflow_prod_'||s||'_runtime', 'plm', 'USAGE,CREATE'))
  then raise exception '#2873: a non-tracking designflow_prod runtime reaches plm'; end if;
end
$post$;
