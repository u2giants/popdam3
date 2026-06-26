-- Add explicit clear flags to the CRM contact update RPC.
--
-- Why:
-- - popcrm-web edits core.contact fields and CRM-owned relationship fields
--   (account, department, contact_type, scope) through one browser-facing RPC.
-- - The earlier RPC used coalesce(), so passing null meant "leave unchanged".
--   The UI could not intentionally clear relationship fields.
-- - core.contact_company.company_id is required, so clearing the account means
--   removing the CRM buyer relationship row rather than setting company_id null.

drop function if exists api.crm_update_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text
);

create or replace function api.crm_update_contact(
  p_contact_id uuid,
  p_first_name text default null,
  p_last_name text default null,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_job_title text default null,
  p_company_id uuid default null,
  p_crm_department_id uuid default null,
  p_contact_type text default null,
  p_scope text default null,
  p_clear_company boolean default false,
  p_clear_crm_department boolean default false,
  p_clear_contact_type boolean default false,
  p_clear_scope boolean default false
)
returns core.contact
language plpgsql
security definer
set search_path = app, core, crm, public
as $$
declare
  result core.contact;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update core.contact ct
  set
    first_name = coalesce(p_first_name, ct.first_name),
    last_name  = coalesce(p_last_name, ct.last_name),
    full_name  = coalesce(
      p_full_name,
      nullif(trim(concat_ws(' ', coalesce(p_first_name, ct.first_name), coalesce(p_last_name, ct.last_name))), ''),
      ct.full_name
    ),
    email      = coalesce(p_email::extensions.citext, ct.email),
    phone      = coalesce(p_phone, ct.phone),
    title      = coalesce(p_job_title, ct.title)
  where ct.id = p_contact_id
  returning ct.* into result;

  if not found then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;

  if p_clear_company then
    delete from core.contact_company cc
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer';
  end if;

  if p_company_id is not null then
    update core.contact_company cc
    set is_primary = false
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer'
      and cc.company_id <> p_company_id;

    insert into core.contact_company (
      contact_id,
      company_id,
      relationship_type,
      contact_type,
      scope,
      crm_department_id,
      is_primary
    )
    values (
      p_contact_id,
      p_company_id,
      'buyer',
      case when p_clear_contact_type then null else p_contact_type end,
      case when p_clear_scope then null else p_scope end,
      case when p_clear_crm_department then null else p_crm_department_id end,
      true
    )
    on conflict (contact_id, company_id, relationship_type) do update
    set
      contact_type = case
        when p_clear_contact_type then null
        when excluded.contact_type is not null then excluded.contact_type
        else core.contact_company.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when excluded.scope is not null then excluded.scope
        else core.contact_company.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when excluded.crm_department_id is not null then excluded.crm_department_id
        else core.contact_company.crm_department_id
      end,
      is_primary = true;
  elsif not p_clear_company and (
    p_clear_crm_department
    or p_clear_contact_type
    or p_clear_scope
    or p_crm_department_id is not null
    or p_contact_type is not null
    or p_scope is not null
  ) then
    update core.contact_company cc
    set
      contact_type = case
        when p_clear_contact_type then null
        when p_contact_type is not null then p_contact_type
        else cc.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        else cc.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when p_crm_department_id is not null then p_crm_department_id
        else cc.crm_department_id
      end
    where cc.id = (
      select x.id
      from core.contact_company x
      where x.contact_id = p_contact_id
        and x.relationship_type = 'buyer'
      order by x.is_primary desc nulls last, x.id
      limit 1
    );
  end if;

  return result;
end;
$$;

revoke all on function api.crm_update_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean
) from public;

grant execute on function api.crm_update_contact(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean
) to authenticated;
