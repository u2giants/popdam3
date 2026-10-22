-- #4634: production counterpart of sandbox-only migration 20261021150012 (#4534).
-- Version reserved by claim #4637. Production target verified from popcre-core-prod.
-- derived-from: none
-- Same shape as sandbox; vendor_id deliberately has no FK because the application
-- validates the environment-specific vendor mapping. WeChat activation is out of scope.
-- Grant backend SELECT/INSERT/UPDATE through its existing NOLOGIN grants role.
-- Narrow #2873 matrix addition: three backend-grants entries; no runtime direct ACL.
-- Identity sequences require no USAGE grant.
-- No change to runtime roles, memberships, existing tables, or production Cloud Run.
-- Rollback: reviewed forward REVOKE SELECT, INSERT, UPDATE ON TABLE
-- dflow_prod.vendor_wechat_identity FROM designflow_prod_backend_grants;
-- restore #2873 expected entries, and preserve any identities rather than drop data.
-- Keep sandbox index scope: unique wechat_key serves login; optional admin-list
-- indexes are deferred until measured. The unionid/openid key namespace is identical
-- to sandbox and the backend, including its theoretical prefixed-unionid collision.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $pre$
begin
  if to_regnamespace('dflow_prod') is null then raise exception '#4634: dflow_prod missing'; end if;
  if not exists(select 1 from pg_roles where rolname='designflow_prod_backend_grants' and not rolcanlogin and not rolbypassrls and not rolsuper) then
    raise exception '#4634: backend grants role missing or unsafe';
  end if;
  if not exists(select 1 from pg_roles where rolname='designflow_prod_backend_runtime' and rolcanlogin and not rolbypassrls and not rolsuper)
     or not pg_has_role('designflow_prod_backend_runtime','designflow_prod_backend_grants','USAGE')
     or not has_schema_privilege('designflow_prod_backend_runtime','dflow_prod','USAGE') then
    raise exception '#4634: backend login or inherited schema access differs';
  end if;
end $pre$;

create table if not exists dflow_prod.vendor_wechat_identity (
  id bigint generated always as identity primary key,
  wechat_key text not null unique,
  unionid text,
  openid text not null,
  nickname text,
  avatar_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'blocked')),
  vendor_id integer,
  decided_by_user_id integer,
  decided_at timestamptz,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_login_at timestamptz,
  check (wechat_key = coalesce(unionid, 'openid:' || openid)),
  check (status <> 'approved' or vendor_id is not null)
);

comment on table dflow_prod.vendor_wechat_identity is
  'WeChat login identities for vendor users; pending until an admin links vendor_id and approves (#4634).';

do $shape$
declare v_oid regclass := 'dflow_prod.vendor_wechat_identity'::regclass;
begin
  if not exists(select 1 from pg_class where oid=v_oid and relkind='r' and not relrowsecurity and not relforcerowsecurity) then
    raise exception '#4634: expected ordinary table without RLS';
  end if;
  if (select string_agg(attname || ':' || format_type(atttypid,atttypmod) || ':' || attnotnull, ',' order by attnum)
      from pg_attribute where attrelid=v_oid and attnum>0 and not attisdropped)
     is distinct from 'id:bigint:true,wechat_key:text:true,unionid:text:false,openid:text:true,nickname:text:false,avatar_url:text:false,status:text:true,vendor_id:integer:false,decided_by_user_id:integer:false,decided_at:timestamp with time zone:false,first_seen_at:timestamp with time zone:true,last_login_at:timestamp with time zone:false' then
    raise exception '#4634: sandbox-compatible column signature differs';
  end if;
  if not exists(select 1 from pg_attribute where attrelid=v_oid and attname='id' and attidentity='a') then
    raise exception '#4634: id must be GENERATED ALWAYS identity';
  end if;
  if (select count(*) from pg_constraint where conrelid=v_oid and contype<>'n')<>5
     or not exists(select 1 from pg_constraint where conrelid=v_oid and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (id)')
     or not exists(select 1 from pg_constraint where conrelid=v_oid and contype='u' and pg_get_constraintdef(oid)='UNIQUE (wechat_key)') then
    raise exception '#4634: primary/unique keys or constraint count differs';
  end if;
  -- Compare complete normalized expressions, not substring matches.
  if (select array_agg(regexp_replace(pg_get_expr(conbin,conrelid), '[[:space:]()]', '', 'g') order by regexp_replace(pg_get_expr(conbin,conrelid), '[[:space:]()]', '', 'g'))
      from pg_constraint where conrelid=v_oid and contype='c') is distinct from
     array['status<>''approved''::textORvendor_idISNOTNULL',
           'status=ANYARRAY[''pending''::text,''approved''::text,''blocked''::text]',
           'wechat_key=COALESCEunionid,''openid:''::text||openid']::text[] then
    raise exception '#4634: sandbox status/key/approval checks differ';
  end if;
  if (select string_agg(a.attname || ':' || pg_get_expr(d.adbin,d.adrelid), ',' order by a.attnum)
      from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
      where d.adrelid=v_oid) is distinct from 'status:''pending''::text,first_seen_at:clock_timestamp()' then
    raise exception '#4634: sandbox defaults differ';
  end if;
end $shape$;

revoke all on table dflow_prod.vendor_wechat_identity from public, anon, authenticated, service_role;
grant select, insert, update on table dflow_prod.vendor_wechat_identity
  to designflow_prod_backend_grants;

do $acl$
declare v_oid regclass := 'dflow_prod.vendor_wechat_identity'::regclass;
begin
  if (select string_agg(privilege_type || case when is_grantable then '*' else '' end, ',' order by privilege_type)
      from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid=v_oid and a.grantee='designflow_prod_backend_grants'::regrole)
      is distinct from 'INSERT,SELECT,UPDATE' then raise exception '#4634: backend group ACL differs'; end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
            where c.oid=v_oid and a.grantee<>'postgres'::regrole
              and a.grantee<>'designflow_prod_backend_grants'::regrole) then
    raise exception '#4634: unexpected direct grantee';
  end if;
  if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
            where has_table_privilege('designflow_prod_backend_runtime',v_oid,p) is distinct from (p in ('SELECT','INSERT','UPDATE'))) then
    raise exception '#4634: backend effective ACL differs';
  end if;
end $acl$;
