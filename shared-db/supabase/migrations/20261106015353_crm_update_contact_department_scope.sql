-- Pair a contact's CRM department with DEPARTMENT scope, and stop the
-- department-only silent no-op. (#5801)
-- derived-from: 20260626171000
--
-- Why:
-- - popcrm-web's contact flyout saves a department through
--   api.crm_update_contact, which set core.contact_company.crm_department_id
--   but left scope untouched (usually COMPANY_WIDE).
-- - The email-routing worker only honors a contact's department when
--   scope = 'DEPARTMENT' (findDepartment), so flyout assignments never
--   propagated: later emails from that sender still routed COMPANY_ONLY and
--   showed no department. Production carried 4 contacts with a department but
--   non-DEPARTMENT scope.
-- - Separately, when only p_crm_department_id was passed (no p_company_id) and
--   the contact had no buyer relation row, the elsif UPDATE matched zero rows
--   and the RPC still returned success -- a silent no-op verified live.
--
-- Behavior (verified in preview before production):
-- 1. Assigning a department sets scope = 'DEPARTMENT' unless the caller passes
--    an explicit p_scope or p_clear_scope.
-- 2. Clearing the department reverts a DEPARTMENT-scoped row to COMPANY_WIDE
--    (same explicit-p_scope exception).
-- 3. A department-only call for a contact with no buyer relation row now
--    inserts the row using the department's own company (the same inherit rule
--    the flyout uses) instead of silently doing nothing.
-- 4. Passing p_company_id together with a department from a different company
--    is now rejected instead of storing an inconsistent pair.
--
-- Signature is unchanged; api.ts and post_batch_app_verification.py keep
-- matching it.

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
  text,
  boolean,
  boolean,
  boolean,
  boolean
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
  v_dept_company uuid;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_crm_department_id is not null then
    select d.company_id into v_dept_company
    from crm.department d
    where d.id = p_crm_department_id;

    if v_dept_company is null then
      raise exception 'crm: department % not found', p_crm_department_id using errcode = 'no_data_found';
    end if;

    if p_company_id is not null and p_company_id <> v_dept_company then
      raise exception 'crm: department % belongs to a different company', p_crm_department_id using errcode = 'foreign_key_violation';
    end if;
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
      case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        else null
      end,
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
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and core.contact_company.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
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
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and cc.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
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

    -- A department-only call for a contact with no buyer relation row used to
    -- land here, match nothing, and still report success. Create the row from
    -- the department's own company, the same inherit rule the flyout applies.
    -- (p_contact_type-only / p_scope-only calls on a relation-less contact stay
    -- intentional no-ops: there is no relation row to carry them.)
    if not found and p_crm_department_id is not null then
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
        v_dept_company,
        'buyer',
        case when p_clear_contact_type then null else p_contact_type end,
        case
          when p_clear_scope then null
          when p_scope is not null then p_scope
          else 'DEPARTMENT'
        end,
        case when p_clear_crm_department then null else p_crm_department_id end,
        not exists (
          select 1 from core.contact_company x
          where x.contact_id = p_contact_id
            and x.relationship_type = 'buyer'
            and x.is_primary
        )
      );
    end if;
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
