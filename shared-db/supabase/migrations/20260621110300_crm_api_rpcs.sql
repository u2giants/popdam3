-- CRM write RPCs for popcrm-web.
--
-- These are security definer so CRM users can edit canonical core.company /
-- core.contact CRM fields without the baseline core RLS (admin-only writes)
-- being broadened for every app. Each function hard-checks app.has_app_access('crm')
-- (which is also true for administrators) before writing. Never trust the client.
--
-- crm.* operational tables (opportunity, department, note, task, email_message,
-- meeting_note, ignore_rule, ai_model_config, licensor_approval_thread) are NOT
-- here: the baseline crm_write policy already lets sales/licensing/admin write
-- them directly, so the frontend writes those base tables through supabase-js.

-- Update CRM-owned fields on a canonical company (account).
create or replace function api.crm_update_account(
  p_company_id uuid,
  p_name text default null,
  p_domain text default null,
  p_customer_status text default null,
  p_chain_type text default null,
  p_routing_aliases text default null,
  p_so_patterns text default null
)
returns core.company
language plpgsql
security definer
set search_path = app, core, crm, public
as $$
declare
  result core.company;
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update core.company c
  set
    name            = coalesce(p_name, c.name),
    domain          = coalesce(p_domain, c.domain),
    customer_status = coalesce(p_customer_status, c.customer_status),
    chain_type      = coalesce(p_chain_type, c.chain_type),
    routing_aliases = coalesce(p_routing_aliases, c.routing_aliases),
    so_patterns     = coalesce(p_so_patterns, c.so_patterns)
  where c.id = p_company_id
  returning c.* into result;

  if not found then
    raise exception 'crm: company % not found', p_company_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$$;

-- Identity contract: the current user's profile + roles + CRM access. Browser
-- code cannot read the `app` schema directly, so auth resolves identity here.
-- Returns null when the auth user has no provisioned app.profile yet.
create or replace function api.current_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = app, public
as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id,
    'auth_user_id', p.auth_user_id,
    'email', p.email,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'status', p.status,
    'roles', coalesce((
      select array_agg(r.slug order by r.slug)
      from app.user_role ur
      join app.role r on r.id = ur.role_id
      where ur.profile_id = p.id and ur.revoked_at is null
    ), array[]::app.app_role[]),
    'crm_access', app.has_app_access('crm')
  ) end
  from (select * from app.profile where auth_user_id = auth.uid() and status = 'active' limit 1) p;
$$;

revoke all on function api.current_user_profile() from public;
grant execute on function api.current_user_profile() to authenticated;

-- Update a canonical contact and (optionally) its company relationship/CRM attrs.
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
  p_scope text default null
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

  -- Upsert the company relationship row carrying CRM contact_type/scope/department.
  if p_company_id is not null then
    insert into core.contact_company (contact_id, company_id, relationship_type, contact_type, scope, crm_department_id)
    values (p_contact_id, p_company_id, 'buyer', p_contact_type, p_scope, p_crm_department_id)
    on conflict (contact_id, company_id, relationship_type) do update
    set
      contact_type      = coalesce(excluded.contact_type, core.contact_company.contact_type),
      scope             = coalesce(excluded.scope, core.contact_company.scope),
      crm_department_id = coalesce(excluded.crm_department_id, core.contact_company.crm_department_id);
  end if;

  return result;
end;
$$;

-- Convenience stage setter for the pipeline board (drag-to-stage).
create or replace function api.crm_set_opportunity_stage(
  p_opportunity_id uuid,
  p_stage text
)
returns crm.opportunity
language plpgsql
security definer
set search_path = app, crm, public
as $$
declare
  result crm.opportunity;
begin
  if not (app.has_app_access('crm')
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  update crm.opportunity o
  set stage = p_stage
  where o.id = p_opportunity_id
  returning o.* into result;

  if not found then
    raise exception 'crm: opportunity % not found', p_opportunity_id using errcode = 'no_data_found';
  end if;

  return result;
end;
$$;

revoke all on function api.crm_update_account(uuid, text, text, text, text, text, text) from public;
revoke all on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text) from public;
revoke all on function api.crm_set_opportunity_stage(uuid, text) from public;

grant execute on function api.crm_update_account(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function api.crm_update_contact(uuid, text, text, text, text, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function api.crm_set_opportunity_stage(uuid, text) to authenticated;
