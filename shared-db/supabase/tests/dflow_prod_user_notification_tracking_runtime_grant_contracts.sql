-- Contract tests for 20261020151326_dflow_prod_user_notification_tracking_runtime_grant.sql
-- (issue #4515, claim #4519). Self-contained begin/rollback: nothing persists even when
-- run directly; CI additionally wraps it (.github/workflows/database-contract-tests.yml).
--
-- A. Catalogue: the exact ACL of the LOGIN role designflow_prod_tracking_runtime on
--    dflow_prod.user_notification, read from aclexplode, is exactly INSERT, SELECT with
--    no grant option (no UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER); no sequence
--    privilege was added; no other role is a member of the runtime role.
-- B. Behaviour (only when the session may SET ROLE to it; otherwise a WARNING says it was
--    not exercised): as the runtime role, the overdue-notify statement shape works
--    (INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, with an identity
--    id and no sequence grant), SELECT works, and UPDATE and DELETE are refused.

begin;

do $a$
declare v_acl text;
begin
  select string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ','
                    order by a.privilege_type) into v_acl
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.oid = 'dflow_prod.user_notification'::regclass
     and a.grantee = 'designflow_prod_tracking_runtime'::regrole;
  if v_acl is distinct from 'INSERT,SELECT' then
    raise exception 'A1 tracking runtime ACL on dflow_prod.user_notification is %, expected INSERT,SELECT', v_acl;
  end if;
  if exists (select 1 from pg_class s cross join lateral aclexplode(s.relacl) a
             where s.oid = 'dflow_prod.user_notification_id_seq'::regclass
               and a.grantee = 'designflow_prod_tracking_runtime'::regrole) then
    raise exception 'A2 tracking runtime must hold no direct privilege on user_notification_id_seq';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
             where m.roleid = 'designflow_prod_tracking_runtime'::regrole
               and r.rolname not in ('postgres', 'supabase_admin')) then
    raise exception 'A3 another role is a member of designflow_prod_tracking_runtime';
  end if;
end
$a$;

do $b$
declare v_id int; v_n int;
begin
  begin
    set local role designflow_prod_tracking_runtime;
  exception when insufficient_privilege then
    raise warning 'B NOT EXERCISED: % cannot SET ROLE designflow_prod_tracking_runtime; A-section catalogue assertions only', current_user;
    return;
  end;
  insert into dflow_prod.user_notification
    (type, event, title, message, unread, created_date, user_id_fk, idempotency_key)
  values ('alert', 'contract_4515', 't', 'm', true, current_date, null, 'contract-4515-key')
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then raise exception 'B1 insert returned no id'; end if;
  select count(*) into v_n from dflow_prod.user_notification where id = v_id;
  if v_n <> 1 then raise exception 'B2 select as runtime role failed'; end if;
  begin
    update dflow_prod.user_notification set unread = false where id = v_id;
    raise exception 'B3 UPDATE must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from dflow_prod.user_notification where id = v_id;
    raise exception 'B4 DELETE must be refused';
  exception when insufficient_privilege then null;
  end;
  reset role;
end
$b$;

rollback;
