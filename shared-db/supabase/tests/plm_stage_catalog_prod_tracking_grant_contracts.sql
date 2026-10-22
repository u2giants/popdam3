-- Contract tests for 20261020125826_plm_stage_catalog_tracking_runtime_grant.sql
-- (issue #4464, claim #4467; supersedes 20261018191107). Self-contained begin/rollback:
-- nothing persists even when run directly; CI additionally wraps it
-- (.github/workflows/database-contract-tests.yml).
--
-- A. Catalogue: the exact ACL of the LOGIN role designflow_prod_tracking_runtime on the
--    seven catalog tables read from aclexplode (no hand-enumerated privilege list, so
--    MAINTAIN and any future bit are covered), exactly INSERT on dflow_prod."AuditLog",
--    USAGE without CREATE on plm, no direct EXECUTE grant on the version trigger, no
--    client-role ACL entry, RLS on, seven policies scoped only to that role, the grant role
--    designflow_prod_tracking_grants holds nothing on plm (production makes the backend
--    runtime a member of it), no other role is a member of the tracking runtime, and the
--    backend, item-master and data-sync runtimes still cannot reach plm (#2873 boundary,
--    narrowed for the tracking runtime only).
-- B. Behaviour (only when the session may SET ROLE to it; otherwise a WARNING says it was
--    not exercised): the seeded catalog is visible; INSERT into all five editor tables
--    works (identity-keyed ones without any sequence grant); an editor UPDATE bumps the
--    list version (the trigger fires without any EXECUTE grant); the tracker upserts on prod_stage_progress and prod_stage_option work,
--    including SELECT ... FOR UPDATE; an AuditLog row inserts; DELETE on the two progress
--    tables is refused by the missing table privilege (message checked).

begin;

do $a$
declare v_bad text; v_n int;
  v_role oid := (select oid from pg_roles where rolname = 'designflow_prod_tracking_runtime');
begin
  with acl as (
    select c.relname, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'plm' and a.grantee = v_role
      and c.relname in ('stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option')
  ), want as (
    select t, p from unnest(array['stage_list','stage','stage_duration','stage_dependency','licensor_stage_option']) t
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
    union all
    select t, p from unnest(array['prod_stage_progress','prod_stage_option']) t
      cross join unnest(array['SELECT','INSERT','UPDATE']) p
  )
  select string_agg(coalesce(acl.relname, want.t) || ':' || coalesce(acl.privilege_type, want.p), ', ') into v_bad
  from acl full join want on want.t = acl.relname and want.p = acl.privilege_type
  where acl.relname is null or want.t is null;
  if v_bad is not null then raise exception 'A1 ACL differs from the published matrix: %', v_bad; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into v_bad
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid = 'dflow_prod."AuditLog"'::regclass and a.grantee = v_role;
  if v_bad is distinct from 'INSERT' then raise exception 'A2 dflow_prod.AuditLog ACL for tracking must be exactly INSERT, found %', v_bad; end if;
  if not has_schema_privilege(v_role, 'plm', 'USAGE') then raise exception 'A3 no USAGE'; end if;
  if has_schema_privilege(v_role, 'plm', 'CREATE') then raise exception 'A3 CREATE granted'; end if;
  if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
             where p.oid = 'plm.stage_catalog_bump_version()'::regprocedure and a.grantee = v_role) then
    raise exception 'A4 unexpected direct grant on plm.stage_catalog_bump_version()';
  end if;
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'plm'
    and c.relname in ('stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option')
    and a.grantee in (0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'));
  if v_n <> 0 then raise exception 'A5 PUBLIC/anon/authenticated hold % ACL entries on the catalog', v_n; end if;
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plm' and c.relname in ('stage_list','stage','stage_duration','stage_dependency','licensor_stage_option','prod_stage_progress','prod_stage_option') and c.relrowsecurity;
  if v_n <> 7 then raise exception 'A6 RLS disabled on % tables', 7 - v_n; end if;
  select count(*) into v_n from pg_policies
    where schemaname = 'plm' and policyname = tablename || '_dflow_prod_tracking'
      and roles = array['designflow_prod_tracking_runtime']::name[]
      and cmd = 'ALL' and qual = 'true' and with_check = 'true' and permissive = 'PERMISSIVE';
  if v_n <> 7 then raise exception 'A7 expected 7 exact role-scoped policies, found %', v_n; end if;
  -- Nothing else inherits the runtime role, and the shared grant role holds no plm access.
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
             where m.roleid = v_role and r.rolname not in ('postgres', 'supabase_admin')) then
    raise exception 'A8 another role is a member of designflow_prod_tracking_runtime';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(c.relacl) a
             where n.nspname = 'plm' and a.grantee = 'designflow_prod_tracking_grants'::regrole)
     or has_schema_privilege('designflow_prod_tracking_grants', 'plm', 'USAGE') then
    raise exception 'A8 designflow_prod_tracking_grants still holds plm privileges';
  end if;
  if exists (select 1 from unnest(array['backend','item_master','data_sync']) s
             where to_regrole('designflow_prod_'||s||'_runtime') is not null
               and has_schema_privilege('designflow_prod_'||s||'_runtime', 'plm', 'USAGE,CREATE')) then
    raise exception 'A9 a non-tracking designflow_prod runtime reaches plm';
  end if;
end
$a$;

do $b$
declare v_lists int; v_stages int; v_before int; v_after int; v_id int; v_list int; v_new_stage int; v_msg text;
begin
  begin
    set local role designflow_prod_tracking_runtime;
  exception when insufficient_privilege then
    raise warning 'B NOT EXERCISED: % cannot SET ROLE designflow_prod_tracking_runtime; A-section catalogue assertions only', current_user;
    return;
  end;
  select count(*) into v_lists from plm.stage_list;
  select count(*) into v_stages from plm.stage;
  if v_lists = 0 or v_stages = 0 then raise exception 'B1 catalog invisible to tracking role (lists %, stages %)', v_lists, v_stages; end if;
  perform count(*) from plm.stage_duration;
  perform count(*) from plm.licensor_stage_option;
  -- Identity-keyed inserts: no sequence grant exists, so these prove none is needed.
  insert into plm.stage_list (key, name, position, duration_unit)
    values ('zz4464', 'ZZ 4464', 999, 'days') returning id into v_list;
  insert into plm.stage (list_id, name, pending_label, position) values (v_list, 'ZZ 4464 stage', 'ZZ 4464', 1) returning id into v_new_stage;
  insert into plm.stage_duration (stage_id, scope_kind, scope_value, duration) values (v_new_stage, 'product_type', 'ZZ 4464', 1);
  insert into plm.stage_dependency (stage_id, depends_on_stage_id, kind, allowed_early_days)
    select v_new_stage, min(id), 'soft', 0 from plm.stage where list_id <> v_list;
  insert into plm.licensor_stage_option (stage_id, licensor_name, enabled) values (v_new_stage, 'ZZ 4464', false)
    on conflict (stage_id, licensor_name) do update set enabled = excluded.enabled;
  select s.id, l.version into v_id, v_before from plm.stage s join plm.stage_list l on l.id = s.list_id where s.list_id <> v_list order by s.id limit 1;
  update plm.stage set updated_by = updated_by where id = v_id;
  select l.version into v_after from plm.stage s join plm.stage_list l on l.id = s.list_id where s.id = v_id;
  if v_after <> v_before + 1 then raise exception 'B2 editor write did not bump version (% -> %)', v_before, v_after; end if;
  -- Tracker paths exactly as routes/stage-progress.router.js issues them.
  perform 1 from plm.prod_stage_progress where prod_order_header_id = -4464 and sku is null and stage_id = v_id for update;
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id, done_at, failed, failed_reason, updated_by, updated_at)
    values (-4464, null, v_id, current_date, false, null, null, now())
    on conflict (prod_order_header_id, (coalesce(sku, '')), stage_id) do update set done_at = excluded.done_at;
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id, done_at)
    values (-4464, null, v_id, null)
    on conflict (prod_order_header_id, (coalesce(sku, '')), stage_id) do update set done_at = excluded.done_at;
  perform 1 from plm.prod_stage_option where prod_order_header_id = -4464 for update;
  insert into plm.prod_stage_option (prod_order_header_id, needs_linesheet, updated_by, updated_at) values (-4464, true, null, now())
    on conflict (prod_order_header_id) do update set needs_linesheet = excluded.needs_linesheet;
  insert into plm.prod_stage_option (prod_order_header_id, needs_linesheet, updated_by, updated_at) values (-4464, false, null, now())
    on conflict (prod_order_header_id) do update set needs_linesheet = excluded.needs_linesheet;
  insert into dflow_prod."AuditLog" (user_id_fk, ref_id_fk, "actionType", "oldValue", "newValue", "moduleName", "actionDate")
    values (null, -4464, 'progress', '{}', '{}', 'stage_catalog', now());
  begin
    delete from plm.prod_stage_option where prod_order_header_id = -4464;
    raise exception 'B3 prod_stage_option delete was not refused';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'permission denied for table prod_stage_option%' then raise exception 'B3 refused for the wrong reason: %', v_msg; end if;
  end;
  begin
    delete from plm.prod_stage_progress where prod_order_header_id = -4464;
    raise exception 'B4 prod_stage_progress delete was not refused';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'permission denied for table prod_stage_progress%' then raise exception 'B4 refused for the wrong reason: %', v_msg; end if;
  end;
  reset role;
end
$b$;

rollback;
