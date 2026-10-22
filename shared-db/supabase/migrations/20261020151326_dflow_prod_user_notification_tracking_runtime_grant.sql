-- Issue #4515. Version reserved by migration-author claim #4519.
-- derived-from: none
-- Gives the DesignFlow tracking LOGIN role designflow_prod_tracking_runtime direct
-- SELECT, INSERT on dflow_prod.user_notification (the only two the tracking code needs:
-- overdue-notify reads it and INSERTs ... ON CONFLICT DO NOTHING RETURNING id; it never
-- updates or deletes these rows). Same pattern as
-- 20261020125826 (#4464, coordinator decision option (c) on #4475): grant the runtime
-- role directly, never designflow_prod_tracking_grants, because in production
-- designflow_prod_backend_runtime is a member of that group role.
--
-- Why: popcre-tracking-prod is moving from the backend login to its own login (#4475).
-- The read-only gap check (#4475 comment 6293679640) found this as the only table the
-- tracking code uses that the backend role can reach and the tracking role cannot.
-- The code path is services/overdue-notify.service.js (SELECT, then INSERT INTO
-- user_notification), reached through POST /prod-tracking/overdue-scan?notify=true.
--
-- No sequence grant: user_notification.id is GENERATED ALWAYS AS IDENTITY, and
-- identity defaults draw from the sequence without a USAGE check. The contract test
-- proves an INSERT works as the role with no sequence privilege.
--
-- Narrow #2873 amendment (scripts/proofs/2873-* carry the amended matrix): the
-- tracking runtime may also hold these two direct privileges on this one table.
-- RLS is off on the table (unchanged), so no policy is needed. No data change, no
-- membership change, no anon/authenticated change. Re-runnable and idempotent.
-- Rollback: revoke all on table dflow_prod.user_notification from
-- designflow_prod_tracking_runtime, and restore the #2873 proofs.

do $pre$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_runtime'
                 and rolcanlogin and not rolbypassrls and not rolsuper) then
    raise exception '#4515: designflow_prod_tracking_runtime missing or not a LOGIN NOBYPASSRLS role';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
                 where n.nspname = 'dflow_prod' and c.relname = 'user_notification'
                   and c.relkind = 'r' and a.attidentity in ('a','d')) then
    raise exception '#4515: dflow_prod.user_notification missing, not an ordinary table, or its id is not identity';
  end if;
end
$pre$;

revoke all on table dflow_prod.user_notification from designflow_prod_tracking_runtime;
grant select, insert on table dflow_prod.user_notification
  to designflow_prod_tracking_runtime;

do $post$
declare v_acl text;
begin
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into v_acl
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid = 'dflow_prod.user_notification'::regclass
     and a.grantee = 'designflow_prod_tracking_runtime'::regrole;
  if v_acl is distinct from 'INSERT,SELECT' then
    raise exception '#4515: tracking runtime ACL on dflow_prod.user_notification is %, expected INSERT,SELECT', v_acl;
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
             where c.oid = 'dflow_prod.user_notification'::regclass
               and a.grantee = 'designflow_prod_tracking_runtime'::regrole and a.is_grantable) then
    raise exception '#4515: grant option must not be held';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
             where m.roleid = 'designflow_prod_tracking_runtime'::regrole
               and r.rolname not in ('postgres', 'supabase_admin')) then
    raise exception '#4515: another role is a member of designflow_prod_tracking_runtime';
  end if;
end
$post$;
