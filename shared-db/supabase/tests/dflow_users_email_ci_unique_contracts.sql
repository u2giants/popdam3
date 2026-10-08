-- Issue #4060 contract: dflow.users email is unique case- and whitespace-insensitively.
begin;

do $contract$
begin
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('dflow.users_email_lower_uidx')
      and i.indrelid = to_regclass('dflow.users') and i.indisunique
  ) then
    raise exception 'dflow.users_email_lower_uidx missing or not unique';
  end if;

  insert into dflow.users(id,name,email) overriding system value
  values (-406001,'issue-4060-user-a','Issue4060@Example.test');
  begin
    insert into dflow.users(id,name,email) overriding system value
    values (-406002,'issue-4060-user-b',' issue4060@example.TEST ');
    raise exception 'case/whitespace variant email was accepted';
  exception when unique_violation then null;
  end;

  -- Blank and null emails are absent, not values.
  insert into dflow.users(id,name,email) overriding system value
  values (-406003,'issue-4060-blank-a',''), (-406004,'issue-4060-blank-b','  '),
         (-406005,'issue-4060-null-a',null), (-406006,'issue-4060-null-b',null);
end
$contract$;

rollback;
