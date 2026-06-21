-- CRM department/company integrity (parity with the Directus
-- enforce-crm-department-scope.sql trigger): a row's department_id, when set,
-- must belong to the row's company_id. When company_id is null but a department
-- is given, the company is backfilled from the department.

create or replace function crm.enforce_department_company()
returns trigger
language plpgsql
as $$
declare
  dept_company uuid;
begin
  if new.department_id is null then
    return new;
  end if;

  select company_id into dept_company
  from crm.department
  where id = new.department_id;

  if dept_company is null then
    raise exception 'crm: department % does not exist', new.department_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.company_id is null then
    new.company_id := dept_company;
  elsif new.company_id <> dept_company then
    raise exception 'crm: department % does not belong to company % (it belongs to %)',
      new.department_id, new.company_id, dept_company
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm.opportunity',
    'crm.email_message',
    'crm.meeting_note',
    'crm.note',
    'crm.task'
  ]
  loop
    execute format('drop trigger if exists enforce_department_company on %s', t);
    execute format(
      'create trigger enforce_department_company before insert or update on %s
         for each row execute function crm.enforce_department_company()',
      t
    );
  end loop;
end $$;

-- Same rule for a contact's CRM department membership on the relationship row.
create or replace function crm.enforce_contact_company_department()
returns trigger
language plpgsql
as $$
declare
  dept_company uuid;
begin
  if new.crm_department_id is null then
    return new;
  end if;

  select company_id into dept_company
  from crm.department
  where id = new.crm_department_id;

  if dept_company is null then
    raise exception 'crm: department % does not exist', new.crm_department_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.company_id <> dept_company then
    raise exception 'crm: department % does not belong to company %', new.crm_department_id, new.company_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_contact_company_department on core.contact_company;
create trigger enforce_contact_company_department
  before insert or update on core.contact_company
  for each row execute function crm.enforce_contact_company_department();
