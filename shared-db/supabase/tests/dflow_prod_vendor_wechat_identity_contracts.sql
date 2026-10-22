-- #4634: shape and runtime behavior, isolated in a rolled-back transaction.
begin;
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

-- Test-only membership, rolled back with this file. Supabase's non-superuser
-- postgres creates runtime roles with ADMIN but SET FALSE. Exercise the real
-- runtime rather than skipping behavior or changing any production migration.
do $test_authority$
begin
  if not pg_has_role(current_user, 'designflow_prod_backend_runtime', 'SET') then
    execute format('grant designflow_prod_backend_runtime to %I with set true', current_user);
  end if;
end $test_authority$;
set local role designflow_prod_backend_runtime;
do $test$
declare v_id bigint;
begin
  insert into dflow_prod.vendor_wechat_identity(wechat_key,openid)
    values ('openid:contract-4634','contract-4634') returning id into v_id;
  if not exists(select 1 from dflow_prod.vendor_wechat_identity where id=v_id and status='pending') then
    raise exception 'backend SELECT/defaults failed';
  end if;
  update dflow_prod.vendor_wechat_identity set status='approved',vendor_id=4634 where id=v_id;
  begin
    insert into dflow_prod.vendor_wechat_identity(wechat_key,openid)
      values ('openid:contract-4634','contract-4634');
    raise exception 'duplicate wechat_key accepted';
  exception when unique_violation then null; end;
  begin
    insert into dflow_prod.vendor_wechat_identity(wechat_key,openid,status)
      values ('openid:contract-4634-invalid','contract-4634-invalid','invalid');
    raise exception 'invalid status accepted';
  exception when check_violation then null; end;
  begin
    insert into dflow_prod.vendor_wechat_identity(wechat_key,openid,status)
      values ('openid:contract-4634-unlinked','contract-4634-unlinked','approved');
    raise exception 'unlinked approved identity accepted';
  exception when check_violation then null; end;
  begin
    insert into dflow_prod.vendor_wechat_identity(wechat_key,openid)
      values ('wrong-key','contract-4634-key');
    raise exception 'mismatched wechat_key accepted';
  exception when check_violation then null; end;
  begin
    delete from dflow_prod.vendor_wechat_identity where id=v_id;
    raise exception 'backend DELETE must be refused';
  exception when insufficient_privilege then null; end;
  insert into dflow_prod.vendor_wechat_identity(wechat_key,unionid,openid)
    values ('union-contract-4634','union-contract-4634','contract-4634-union');
end $test$;
rollback;
