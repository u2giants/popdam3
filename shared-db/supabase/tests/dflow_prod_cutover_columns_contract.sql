begin;

do $test$
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
    raise exception 'dflow_prod cutover columns must be nullable UUIDs without defaults';
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
    raise exception 'dflow_prod cutover columns must not have foreign keys';
  end if;
end
$test$;

rollback;
