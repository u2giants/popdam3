-- Issue #1492 contract: nullable bridges only, with dflow still authoritative.
begin;

do $contract$
declare
  v_profile uuid;
  v_role uuid;
  v_comment uuid;
begin
  if exists (select 1 from dflow.users where app_profile_id is not null)
     or exists (select 1 from dflow."Roles" where app_role_id is not null)
     or exists (select 1 from dflow.comments where app_comment_id is not null) then
    raise exception 'migration inferred or backfilled an identity mapping';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='dflow.users'::regclass
      and conname='users_app_profile_id_fkey'
      and convalidated and confrelid='app.profile'::regclass
      and pg_get_constraintdef(oid) like '%ON UPDATE CASCADE ON DELETE RESTRICT%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='dflow."Roles"'::regclass
      and conname='roles_app_role_id_fkey'
      and convalidated and confrelid='app.role'::regclass
      and pg_get_constraintdef(oid) like '%ON UPDATE CASCADE ON DELETE RESTRICT%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='dflow.comments'::regclass
      and conname='comments_app_comment_id_fkey'
      and convalidated and confrelid='app.comment'::regclass
      and pg_get_constraintdef(oid) like '%ON UPDATE CASCADE ON DELETE RESTRICT%'
  ) then
    raise exception 'one or more canonical identity bridge FKs are missing or incorrect';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname='dflow' and tablename='users'
      and indexname='users_app_profile_id_uidx'
      and indexdef like 'CREATE UNIQUE INDEX%WHERE (app_profile_id IS NOT NULL)'
  ) or not exists (
    select 1 from pg_indexes where schemaname='dflow' and tablename='Roles'
      and indexname='roles_app_role_id_uidx'
      and indexdef like 'CREATE UNIQUE INDEX%WHERE (app_role_id IS NOT NULL)'
  ) or not exists (
    select 1 from pg_indexes where schemaname='dflow' and tablename='comments'
      and indexname='comments_app_comment_id_uidx'
      and indexdef like 'CREATE UNIQUE INDEX%WHERE (app_comment_id IS NOT NULL)'
  ) then
    raise exception 'one or more one-to-one bridge indexes are missing';
  end if;

  -- Existing authority and dependency contracts remain unchanged.
  if not exists (
    select 1 from pg_constraint
    where conrelid='dflow."RolePermissions"'::regclass
      and conname='RolePermissions_RoleId_fkey'
      and confrelid='dflow."Roles"'::regclass
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='dflow."RolePermissions"'::regclass
      and conname='RolePermissions_UserId_fkey'
      and confrelid='dflow.users'::regclass
  ) then
    raise exception 'legacy role-permission integer identity contract changed';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='dflow' and table_name='users'
      and column_name='office_location' and data_type='text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='dflow' and table_name='users'
      and column_name='preferred_language' and data_type='text'
  ) then
    raise exception 'dflow user office/language authority columns changed';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid in ('dflow.users'::regclass,'dflow."Roles"'::regclass,'dflow.comments'::regclass)
      and not tgisinternal
  ) then
    raise exception 'identity adoption must not add trigger mirroring';
  end if;

  -- Prove each mapping is one-to-one while unresolved rows remain allowed.
  insert into app.profile(display_name) values ('issue-1492-contract') returning id into v_profile;
  insert into dflow.users(id,name,app_profile_id) overriding system value
  values (-149201,'issue-1492-user-a',v_profile);
  insert into dflow.users(id,name) overriding system value
  values (-149202,'issue-1492-user-unresolved');
  begin
    insert into dflow.users(id,name,app_profile_id) overriding system value
    values (-149203,'issue-1492-user-b',v_profile);
    raise exception 'one app profile mapped to two legacy users';
  exception when unique_violation then null;
  end;

  select id into v_role from app.role order by id limit 1;
  insert into dflow."Roles"("Id","Name",app_role_id) overriding system value
  values (-149201,'issue-1492-role-a',v_role);
  insert into dflow."Roles"("Id","Name") overriding system value
  values (-149202,'issue-1492-role-unresolved');
  begin
    insert into dflow."Roles"("Id","Name",app_role_id) overriding system value
    values (-149203,'issue-1492-role-b',v_role);
    raise exception 'one app role mapped to two legacy roles';
  exception when unique_violation then null;
  end;

  insert into app.comment(target_schema,target_table,target_id,body)
  values ('plm','item',gen_random_uuid(),'issue-1492-contract') returning id into v_comment;
  insert into dflow.comments(id,comment,item_header_id,user_id,inserted_date,app_comment_id) overriding system value
  values (-149201,'issue-1492-comment-a',-1492,-149201,now(),v_comment);
  insert into dflow.comments(id,comment,item_header_id,user_id,inserted_date) overriding system value
  values (-149202,'issue-1492-comment-unresolved',-1492,-149201,now());
  begin
    insert into dflow.comments(id,comment,item_header_id,user_id,inserted_date,app_comment_id) overriding system value
    values (-149203,'issue-1492-comment-b',-1492,-149201,now(),v_comment);
    raise exception 'one app comment mapped to two legacy comments';
  exception when unique_violation then null;
  end;
end
$contract$;

rollback;
