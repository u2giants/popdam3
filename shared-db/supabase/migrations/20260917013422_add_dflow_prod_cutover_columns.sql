-- Issue #2870. Version reserved by migration-author claim #2871.
-- Restore the two nullable UUID columns present in the Cloud SQL production
-- contract and already consumed by the current DesignFlow backend models.

begin;

alter table dflow_prod.users
  add column if not exists app_profile_id uuid;

alter table dflow_prod.comments
  add column if not exists app_comment_id uuid;

comment on column dflow_prod.users.app_profile_id is
  'Optional application profile identifier retained for DesignFlow production compatibility.';

comment on column dflow_prod.comments.app_comment_id is
  'Optional application comment identifier retained for DesignFlow production compatibility.';

do $verification$
begin
  if exists (
    select 1
    from (values
      ('users', 'app_profile_id'),
      ('comments', 'app_comment_id')
    ) as expected(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'dflow_prod'
        and c.table_name = expected.table_name
        and c.column_name = expected.column_name
        and c.data_type = 'uuid'
        and c.is_nullable = 'YES'
        and c.column_default is null
    )
  ) then
    raise exception 'dflow_prod cutover UUID columns do not match the nullable no-default contract';
  end if;

  if exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and (
        (c.conrelid = 'dflow_prod.users'::regclass and a.attname = 'app_profile_id')
        or
        (c.conrelid = 'dflow_prod.comments'::regclass and a.attname = 'app_comment_id')
      )
  ) then
    raise exception 'dflow_prod cutover UUID columns must not acquire foreign keys';
  end if;
end
$verification$;

commit;
