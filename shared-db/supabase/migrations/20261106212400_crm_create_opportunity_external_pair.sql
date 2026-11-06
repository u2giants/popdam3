-- Fix-forward of 20261106144600 (popcre/shared-db, work issue #5791): crm_create_opportunity
-- left (external_source, external_id) null, and crm.opportunity enforces
-- UNIQUE NULLS NOT DISTINCT on that pair (opportunity_external_source_external_id_key),
-- so only one manual program can ever exist -- observed live 2026-11-06 on the Step 11
-- gate: the second create failed with a duplicate-key error. CRM-created programs now
-- carry the distinct pair ('crm', 'crm-'||gen_random_uuid()), which also names their
-- provenance. ONLY this function: the 144600 view bodies (security barriers, archived
-- filters) stay exactly as applied -- an earlier draft of this file accidentally
-- replayed 144500's stale view bodies and the app_serving_status contract caught it.
-- derived-from: 20261106144600
-- Claim and work issue #5791 (popcrm-web #24, plan_crm_basic_crud.md Step 11).

create or replace function api.crm_create_opportunity(
  p_name text,
  p_company_id uuid,
  p_contact_id uuid default null,
  p_department_id uuid default null,
  p_stage text default null,
  p_estimated_value numeric default null,
  p_close_date date default null
) returns crm.opportunity
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  result crm.opportunity;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: program name required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from core.customer c where c.id = p_company_id) then
    raise exception 'crm: customer % not found', p_company_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from crm.customer_ext xe
             where xe.customer_id = p_company_id and xe.archived_at is not null) then
    raise exception 'crm: customer is archived; restore it before adding a program'
      using errcode = 'check_violation';
  end if;
  if p_contact_id is not null
     and not exists (select 1 from core.contact ct where ct.id = p_contact_id) then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;
  if p_department_id is not null
     and not exists (select 1 from crm.department d where d.id = p_department_id) then
    raise exception 'crm: department % not found', p_department_id using errcode = 'no_data_found';
  end if;
  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'crm: program amount cannot be negative' using errcode = 'check_violation';
  end if;

  insert into crm.opportunity
    (name, company_id, contact_id, department_id, stage, estimated_value, close_date,
     external_source, external_id)
  values (v_name, p_company_id, p_contact_id, p_department_id, p_stage, p_estimated_value, p_close_date,
          'crm', 'crm-' || gen_random_uuid()::text)
  returning * into result;

  return result;
end;
$fn$;

revoke all on function api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date) from public, anon;
grant execute on function api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date) to authenticated;
