-- Fix-forward of 20261106144500 (popcre/shared-db, work issue #5791; renamed from
-- 20261105235900/#5808 -> 20261106043500/#5830 -> 20261106083500/#5857 after each
-- PR exhausted its automatic promotion attempts against a moving main tip).
-- The base migration stays byte-identical to the body preview applied. This file re-applies
-- the whole, idempotent corrected body: empty email -> NULL, pim FK column names,
-- customer archive via crm.customer_ext.archived_at, archived customers hidden from the
-- picker, explicit view security options (review finding #5810), and the documented
-- IGNORED scope value. Every statement is create-or-replace / if-not-exists.

-- Claim and work issue #5791 (popcrm-web #24, plan_crm_basic_crud.md Step 1).
-- CRM basic add/archive/merge RPCs. Archive state is CRM-owned:
--   contacts  -> crm.contact_ext.archived_at (mirrors the defunct marking of
--                20261105215348_crm_contact_ext.sql; core.contact.status stays
--                untouched so no other app's view changes meaning),
--   customers -> crm.customer_ext.archived_at (PIM api.pm_customer_list
--                filters core.customer.status in ('active','potential'), so a
--                CRM archive through the shared column would hide customers
--                from PIM; and crm.customer_ext.status itself is constrained
--                to active/inactive, so it cannot carry 'archived'),
--   programs  -> crm.opportunity.status='archived' (free text, unread by apps).
-- api.crm_* list views gain archived-row filters; segment views read
-- crm_contact_list and inherit. Access checks: crm_create_contact matches
-- crm_update_contact (app access); contact archive/merge require administrator
-- or sales (defunct-marking ruling #5780); opportunity/customer functions
-- match crm_set_opportunity_stage (administrator/sales/licensing).
-- derived-from: none

alter table crm.contact_ext
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

alter table crm.customer_ext
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

comment on column crm.contact_ext.archived_at is
  'CRM archive stamp: set = hidden from CRM contact lists; null/missing row = current. Undo clears it.';

create or replace function api.crm_create_contact(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_job_title text default null,
  p_company_id uuid default null,
  p_crm_department_id uuid default null,
  p_scope text default null
) returns uuid
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_scope text := upper(coalesce(btrim(coalesce(p_scope, '')), ''));
  v_scope_db text;
  v_contact_id uuid;
  v_dup text;
begin
  if not coalesce(app.has_app_access('crm'), false) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'crm: contact name required' using errcode = 'check_violation';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'crm: valid contact email required' using errcode = 'check_violation';
  end if;
  if v_scope not in ('', 'COMPANY_WIDE', 'DEPARTMENT', 'IGNORED') then
    raise exception 'crm: contact scope must be COMPANY_WIDE or DEPARTMENT'
      using errcode = 'check_violation';
  end if;
  v_scope_db := nullif(v_scope, '');

  if p_company_id is not null
     and not exists (select 1 from core.customer c where c.id = p_company_id) then
    raise exception 'crm: customer % not found', p_company_id using errcode = 'no_data_found';
  end if;
  if p_crm_department_id is not null
     and not exists (select 1 from crm.department d where d.id = p_crm_department_id) then
    raise exception 'crm: department % not found', p_crm_department_id using errcode = 'no_data_found';
  end if;

  if v_email is not null then
    select coalesce(ct.full_name, nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''), ct.email::text)
      into v_dup
      from core.contact ct
      where ct.email = v_email
      limit 1;
    if found then
      raise exception 'crm: a contact with email % already exists (%)', v_email, v_dup
        using errcode = 'unique_violation';
    end if;
  end if;

  insert into core.contact (full_name, email, phone, title, status)
  values (v_name, v_email::extensions.citext, v_phone, v_title, 'active')
  returning id into v_contact_id;

  if p_company_id is not null then
    insert into core.contact_company
      (contact_id, company_id, relationship_type, title, scope, crm_department_id)
    values (v_contact_id, p_company_id, 'buyer', v_title, v_scope_db, p_crm_department_id);
  end if;

  return v_contact_id;
end;
$fn$;

create or replace function api.crm_archive_contact(p_contact_id uuid) returns void
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_role('sales'))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from core.contact ct where ct.id = p_contact_id) then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;

  insert into crm.contact_ext (contact_id, archived_at, archived_by)
  values (p_contact_id, now(), auth.uid())
  on conflict (contact_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;
end;
$fn$;

create or replace function api.crm_merge_contacts(p_keep_id uuid, p_drop_id uuid) returns uuid
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
declare
  v_drop core.contact;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_role('sales'))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_keep_id = p_drop_id then
    raise exception 'crm: cannot merge a contact into itself' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from core.contact ct where ct.id = p_keep_id) then
    raise exception 'crm: contact % not found', p_keep_id using errcode = 'no_data_found';
  end if;
  select * into v_drop from core.contact ct where ct.id = p_drop_id;
  if not found then
    raise exception 'crm: contact % not found', p_drop_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from crm.contact_ext xe
             where xe.contact_id in (p_keep_id, p_drop_id)
               and xe.archived_at is not null) then
    raise exception 'crm: cannot merge archived contacts; restore them first'
      using errcode = 'check_violation';
  end if;

  -- Fill blank fields on the kept contact from the dropped one.
  update core.contact ct set
    first_name = coalesce(ct.first_name, v_drop.first_name),
    last_name = coalesce(ct.last_name, v_drop.last_name),
    full_name = coalesce(ct.full_name, v_drop.full_name),
    email = coalesce(ct.email, v_drop.email),
    phone = coalesce(ct.phone, v_drop.phone),
    title = coalesce(ct.title, v_drop.title)
  where ct.id = p_keep_id;

  -- core.contact_company: drop rows the kept contact already has, move the rest.
  delete from core.contact_company cc
   where cc.contact_id = p_drop_id
     and exists (select 1 from core.contact_company k
                 where k.contact_id = p_keep_id
                   and k.company_id = cc.company_id
                   and k.relationship_type = cc.relationship_type);
  update core.contact_company set contact_id = p_keep_id where contact_id = p_drop_id;

  update core.contact_source_ref set contact_id = p_keep_id where contact_id = p_drop_id;

  -- core.vendor_contact: unique (factory_id, contact_id, role) — drop collisions.
  delete from core.vendor_contact vc
   where vc.contact_id = p_drop_id
     and exists (select 1 from core.vendor_contact k
                 where k.factory_id = vc.factory_id
                   and k.contact_id = p_keep_id
                   and k.role is not distinct from vc.role);
  update core.vendor_contact set contact_id = p_keep_id where contact_id = p_drop_id;

  update crm.department set primary_contact_id = p_keep_id where primary_contact_id = p_drop_id;
  update crm.email_message set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.meeting_note set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.note set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.opportunity set contact_id = p_keep_id where contact_id = p_drop_id;
  update crm.task set contact_id = p_keep_id where contact_id = p_drop_id;
  update pim.product set buyer_contact_id = p_keep_id where buyer_contact_id = p_drop_id;
  update pim.project set primary_contact_id = p_keep_id where primary_contact_id = p_drop_id;

  -- Hide the dropped contact from CRM lists; undo = clear archived_at.
  insert into crm.contact_ext (contact_id, archived_at, archived_by)
  values (p_drop_id, now(), auth.uid())
  on conflict (contact_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;

  return p_keep_id;
end;
$fn$;

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
    (name, company_id, contact_id, department_id, stage, estimated_value, close_date)
  values (v_name, p_company_id, p_contact_id, p_department_id, p_stage, p_estimated_value, p_close_date)
  returning * into result;

  return result;
end;
$fn$;

create or replace function api.crm_archive_opportunity(p_opportunity_id uuid) returns void
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from crm.opportunity o where o.id = p_opportunity_id) then
    raise exception 'crm: program % not found', p_opportunity_id using errcode = 'no_data_found';
  end if;

  update crm.opportunity set status = 'archived', updated_at = now()
  where id = p_opportunity_id;
end;
$fn$;

create or replace function api.crm_archive_customer(p_customer_id uuid) returns void
language plpgsql
security definer
set search_path to 'app', 'core', 'crm', 'public'
as $fn$
declare
  v_open_programs integer;
begin
  if not (coalesce(app.has_app_access('crm'), false)
          and (app.has_role('administrator') or app.has_any_role(array['sales','licensing']::app.app_role[]))) then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from core.customer c where c.id = p_customer_id) then
    raise exception 'crm: customer % not found', p_customer_id using errcode = 'no_data_found';
  end if;

  select count(*) into v_open_programs
  from crm.opportunity o
  where o.company_id = p_customer_id
    and coalesce(o.status, '') <> 'archived';
  if v_open_programs > 0 then
    raise exception 'crm: customer still has % active program(s); archive them first', v_open_programs
      using errcode = 'check_violation';
  end if;

  insert into crm.customer_ext (customer_id, archived_at, archived_by)
  values (p_customer_id, now(), auth.uid())
  on conflict (customer_id) do update
    set archived_at = now(),
        archived_by = excluded.archived_by;
end;
$fn$;

-- Archived-row filters on the CRM list views (segment views read these and
-- inherit). Column lists unchanged.

create or replace view api.crm_contact_list with (security_invoker = false) as
select ct.id,
       coalesce(ct.full_name, nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as name,
       ct.first_name,
       ct.last_name,
       ct.email::text as email,
       ct.phone,
       ct.title as job_title,
       cc.contact_type,
       cc.scope,
       cc.company_id,
       comp.name as company_name,
       comp.customer_status as company_customer_status,
       cc.crm_department_id as department_id,
       d.name as department_name,
       ct.updated_at
from core.contact ct
left join lateral (
  select x.id, x.contact_id, x.company_id, x.relationship_type, x.title, x.is_primary,
         x.started_at, x.ended_at, x.metadata, x.contact_type, x.scope, x.crm_department_id
  from core.contact_company x
  where x.contact_id = ct.id
  order by x.is_primary desc nulls last, x.id
  limit 1
) cc on true
left join core.customer comp on comp.id = cc.company_id
left join crm.department d on d.id = cc.crm_department_id
where app.has_app_access('crm'::app.app_name)
  and not exists (
    select 1 from crm.contact_ext xe
    where xe.contact_id = ct.id and xe.archived_at is not null
  );

create or replace view api.crm_customer_list with (security_invoker = false) as
select c.id,
       c.name,
       c.domain,
       api.crm_customer_logo_url(c.metadata, logo.logo_url) as logo_url,
       c.customer_status,
       c.chain_type,
       c.routing_aliases,
       c.so_patterns,
       c.company_type,
       c.status,
       c.primary_salesperson_profile_id,
       c.account_owner_profile_id,
       c.updated_at,
       c.is_potential,
       c.display_name
from core.customer c
left join lateral (
  select ci.logo_url
  from plm.customer_import ci
  where ci.company_id = c.id
    and nullif(ci.logo_url, '') is not null
  order by ci.updated_at desc nulls last, ci.imported_at desc nulls last
  limit 1
) logo on true
where (select app.has_app_access('crm'::app.app_name) as has_app_access)
  and not exists (
    select 1 from crm.customer_ext xe
    where xe.customer_id = c.id and xe.archived_at is not null
  );

create or replace view api.crm_opportunity_list with (security_invoker = true) as
select o.id,
       o.name,
       o.estimated_value as amount,
       o.close_date,
       o.stage,
       o.program_type,
       o.season_year,
       o.division,
       o.production_po_number,
       o.sales_order_number,
       o.hard_delivery_date,
       o.ai_summary,
       o.ai_state,
       o.company_id,
       comp.name as company_name,
       comp.customer_status as company_customer_status,
       o.contact_id,
       coalesce(ct.full_name, nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as contact_name,
       ct.email::text as contact_email,
       o.department_id,
       d.name as department_name,
       o.factory_id,
       f.name as factory_name,
       o.project_id,
       pr.title as project_title,
       o.owner_profile_id,
       o.updated_at
from crm.opportunity o
left join core.customer comp on comp.id = o.company_id
left join core.contact ct on ct.id = o.contact_id
left join crm.department d on d.id = o.department_id
left join core.factory f on f.id = o.factory_id
left join pim.project pr on pr.id = o.project_id
where coalesce(o.status, '') <> 'archived';

-- The picker feeds every create/assign combobox; an archived customer must not
-- come back through it. Column list otherwise unchanged.
create or replace view api.crm_customer_picker_list with (security_invoker = false, security_barrier = true) as
select c.id,
       c.name,
       c.display_name,
       c.status as core_status,
       coalesce(x.status, 'active'::app.entity_status) as crm_status,
       x.status_reason as crm_status_reason,
       x.status_changed_at as crm_status_changed_at,
       c.updated_at
from core.customer c
left join crm.customer_ext x on x.customer_id = c.id
where app.has_explicit_app_access('crm'::app.app_name)
  and c.status = any (array['active'::app.entity_status, 'potential'::app.entity_status])
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status
  and x.archived_at is null;

revoke all on function api.crm_create_contact(text,text,text,text,uuid,uuid,text) from public, anon;
grant execute on function api.crm_create_contact(text,text,text,text,uuid,uuid,text) to authenticated;
revoke all on function api.crm_archive_contact(uuid) from public, anon;
grant execute on function api.crm_archive_contact(uuid) to authenticated;
revoke all on function api.crm_merge_contacts(uuid,uuid) from public, anon;
grant execute on function api.crm_merge_contacts(uuid,uuid) to authenticated;
revoke all on function api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date) from public, anon;
grant execute on function api.crm_create_opportunity(text,uuid,uuid,uuid,text,numeric,date) to authenticated;
revoke all on function api.crm_archive_opportunity(uuid) from public, anon;
grant execute on function api.crm_archive_opportunity(uuid) to authenticated;
revoke all on function api.crm_archive_customer(uuid) from public, anon;
grant execute on function api.crm_archive_customer(uuid) to authenticated;
