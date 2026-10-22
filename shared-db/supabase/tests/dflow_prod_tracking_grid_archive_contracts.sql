-- Contract tests for 20261022132119_dflow_prod_tracking_grid_archive.sql (issue #4585,
-- claim #4586). Self-contained begin/rollback.
--
-- A. Shape: four columns, PK (grid_type, row_id), grid_type check, clock_timestamp() default.
-- B. ACL: designflow_prod_tracking_grants holds exactly DELETE, INSERT, SELECT with no grant
--    option; anon, authenticated and service_role hold nothing.
-- C. Behaviour (only when the session may SET ROLE; otherwise a WARNING): as the tracking
--    runtime, the archive / show-archived / unarchive statements work, UPDATE is refused, and
--    a grid_type outside the two tracking grids is rejected.

begin;

do $a$
begin
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
      from pg_attribute a where a.attrelid = 'dflow_prod.tracking_grid_archive'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'grid_type:text:true,row_id:bigint:true,archived_at:timestamp with time zone:true,archived_by_user_id:integer:false'
  then raise exception 'A1 columns differ'; end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'dflow_prod.tracking_grid_archive'::regclass and c.contype = 'p')
     is distinct from 'PRIMARY KEY (grid_type, row_id)'
  then raise exception 'A2 primary key differs'; end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'dflow_prod.tracking_grid_archive'::regclass
                 and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%prod_tracking%licensing_tracking%')
  then raise exception 'A3 grid_type check missing'; end if;
end
$a$;

do $b$
declare v_acl text;
begin
  select string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ',' order by a.privilege_type)
    into v_acl
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid = 'dflow_prod.tracking_grid_archive'::regclass
    and a.grantee = 'designflow_prod_tracking_grants'::regrole;
  if v_acl is distinct from 'DELETE,INSERT,SELECT' then
    raise exception 'B1 tracking grants ACL is %, expected DELETE,INSERT,SELECT', v_acl;
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
             join pg_roles r on r.oid = a.grantee
             where c.oid = 'dflow_prod.tracking_grid_archive'::regclass
               and r.rolname in ('anon', 'authenticated', 'service_role')) then
    raise exception 'B2 a client role holds a privilege';
  end if;
end
$b$;

do $c$
declare v_n integer;
begin
  if not pg_has_role(current_user, 'designflow_prod_tracking_runtime', 'SET') then
    raise warning 'C not exercised: % cannot SET ROLE designflow_prod_tracking_runtime', current_user;
    return;
  end if;
  set local role designflow_prod_tracking_runtime;
  insert into dflow_prod.tracking_grid_archive (grid_type, row_id, archived_by_user_id)
    select 'prod_tracking', unnest(array[-1, -2]::bigint[]), null
    on conflict (grid_type, row_id) do nothing;
  insert into dflow_prod.tracking_grid_archive (grid_type, row_id)
    values ('prod_tracking', -1) on conflict (grid_type, row_id) do nothing;
  select count(*) into v_n from dflow_prod.tracking_grid_archive where grid_type = 'prod_tracking' and row_id < 0;
  if v_n <> 2 then raise exception 'C1 expected 2 archived rows, found %', v_n; end if;
  begin
    update dflow_prod.tracking_grid_archive set archived_by_user_id = 1 where row_id = -1;
    raise exception 'C2 UPDATE should be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into dflow_prod.tracking_grid_archive (grid_type, row_id) values ('rfq', -3);
    raise exception 'C3 foreign grid_type accepted';
  exception when check_violation then null;
  end;
  delete from dflow_prod.tracking_grid_archive where grid_type = 'prod_tracking' and row_id in (-1, -2);
  select count(*) into v_n from dflow_prod.tracking_grid_archive where row_id < 0;
  if v_n <> 0 then raise exception 'C4 unarchive left % rows', v_n; end if;
  reset role;
end
$c$;

rollback;
