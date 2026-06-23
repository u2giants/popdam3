-- Browser-facing CRM API views for popcrm-web screens.
-- All views are security_invoker = true, so the caller's RLS on the underlying
-- crm.* / core.* tables is enforced. Views expose only browser-safe columns:
-- no raw email bodies, no raw meeting transcripts, no ingest.* payloads.

-- Accounts / triage registry + operational customer pickers.
-- One contract for both: the frontend filters by customer_status for "customers".
create or replace view api.crm_account_list
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.domain,
  c.customer_status,
  c.chain_type,
  c.routing_aliases,
  c.so_patterns,
  c.company_type,
  c.status,
  c.primary_salesperson_profile_id,
  c.account_owner_profile_id,
  c.updated_at
from core.company c;

-- Contacts: person joined to their primary company relationship + CRM department.
create or replace view api.crm_contact_list
with (security_invoker = true) as
select
  ct.id,
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as name,
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
  select x.*
  from core.contact_company x
  where x.contact_id = ct.id
  order by x.is_primary desc nulls last, x.id
  limit 1
) cc on true
left join core.company comp on comp.id = cc.company_id
left join crm.department d on d.id = cc.crm_department_id;

-- Departments + parent company + primary contact.
create or replace view api.crm_department_list
with (security_invoker = true) as
select
  d.id,
  d.name,
  d.category,
  d.division,
  d.is_active as active,
  d.sort_order,
  d.company_id,
  comp.name as company_name,
  d.primary_contact_id,
  coalesce(pc.full_name, nullif(trim(concat_ws(' ', pc.first_name, pc.last_name)), '')) as primary_contact_name,
  pc.email::text as primary_contact_email,
  d.updated_at
from crm.department d
left join core.company comp on comp.id = d.company_id
left join core.contact pc on pc.id = d.primary_contact_id;

-- Opportunities / pipeline board + programs list.
create or replace view api.crm_opportunity_list
with (security_invoker = true) as
select
  o.id,
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
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as contact_name,
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
left join core.company comp on comp.id = o.company_id
left join core.contact ct on ct.id = o.contact_id
left join crm.department d on d.id = o.department_id
left join core.factory f on f.id = o.factory_id
left join pim.project pr on pr.id = o.project_id;

-- Email routing queue. body_preview only — never the raw body.
create or replace view api.crm_email_routing_queue
with (security_invoker = true) as
select
  e.id,
  e.subject,
  e.sender,
  e.recipients,
  e.received_at,
  e.routing_status,
  e.routing_method,
  e.body_preview,
  e.detected_so_numbers,
  e.detected_po_numbers,
  e.company_id,
  comp.name as company_name,
  e.department_id,
  d.name as department_name,
  e.opportunity_id,
  o.name as opportunity_name,
  o.stage as opportunity_stage,
  e.updated_at
from crm.email_message e
left join core.company comp on comp.id = e.company_id
left join crm.department d on d.id = e.department_id
left join crm.opportunity o on o.id = e.opportunity_id;

-- Meetings. transcript id only — never the raw transcript payload.
create or replace view api.crm_meeting_list
with (security_invoker = true) as
select
  m.id,
  m.title as name,
  m.meeting_at as date,
  m.participants,
  m.body as summary,
  m.action_items,
  m.source,
  m.fireflies_transcript_id,
  m.company_id,
  comp.name as company_name,
  comp.customer_status as company_customer_status,
  m.department_id,
  d.name as department_name,
  m.contact_id,
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as contact_name,
  ct.email::text as contact_email,
  m.updated_at
from crm.meeting_note m
left join core.company comp on comp.id = m.company_id
left join crm.department d on d.id = m.department_id
left join core.contact ct on ct.id = m.contact_id;

-- Notes.
create or replace view api.crm_note_list
with (security_invoker = true) as
select
  n.id,
  n.title,
  n.body,
  n.action_items,
  n.source,
  n.fireflies_transcript_id,
  n.company_id,
  comp.name as company_name,
  n.contact_id,
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as contact_name,
  ct.email::text as contact_email,
  n.opportunity_id,
  o.name as opportunity_name,
  o.stage as opportunity_stage,
  n.department_id,
  d.name as department_name,
  n.created_at,
  n.updated_at
from crm.note n
left join core.company comp on comp.id = n.company_id
left join core.contact ct on ct.id = n.contact_id
left join crm.opportunity o on o.id = n.opportunity_id
left join crm.department d on d.id = n.department_id;

-- Tasks.
create or replace view api.crm_task_list
with (security_invoker = true) as
select
  t.id,
  t.title,
  t.body,
  t.status,
  t.due_at,
  t.company_id,
  comp.name as company_name,
  t.contact_id,
  coalesce(ct.full_name, nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '')) as contact_name,
  ct.email::text as contact_email,
  t.opportunity_id,
  o.name as opportunity_name,
  o.stage as opportunity_stage,
  t.department_id,
  d.name as department_name,
  t.assignee_profile_id,
  ap.display_name as assignee_name,
  ap.email::text as assignee_email,
  t.created_at,
  t.updated_at
from crm.task t
left join core.company comp on comp.id = t.company_id
left join core.contact ct on ct.id = t.contact_id
left join crm.opportunity o on o.id = t.opportunity_id
left join crm.department d on d.id = t.department_id
left join app.profile ap on ap.id = t.assignee_profile_id;

-- Licensor approval queue.
create or replace view api.crm_approval_queue
with (security_invoker = true) as
select
  a.id,
  a.name,
  a.property_name,
  a.stage,
  a.submitted_date,
  a.response_date,
  a.due_date,
  a.licensor_comments,
  a.opportunity_id,
  o.name as opportunity_name,
  o.stage as opportunity_stage,
  a.updated_at
from crm.licensor_approval_thread a
left join crm.opportunity o on o.id = a.opportunity_id;

-- Settings: AI model configuration rows.
create or replace view api.crm_ai_model_config_list
with (security_invoker = true) as
select
  id,
  name,
  email_routing_model,
  fireflies_routing_model,
  transcript_split_model,
  opportunity_summary_model,
  updated_at
from crm.ai_model_config;

-- Email ignore rules.
create or replace view api.crm_ignore_rule_list
with (security_invoker = true) as
select
  id,
  name,
  pattern,
  match_type,
  emails_skipped,
  created_at
from crm.ignore_rule;

grant select on
  api.crm_account_list,
  api.crm_contact_list,
  api.crm_department_list,
  api.crm_opportunity_list,
  api.crm_email_routing_queue,
  api.crm_meeting_list,
  api.crm_note_list,
  api.crm_task_list,
  api.crm_approval_queue,
  api.crm_ai_model_config_list,
  api.crm_ignore_rule_list
to authenticated;

comment on view api.crm_account_list is 'CRM accounts/triage company registry; filter customer_status for curated customers.';
comment on view api.crm_email_routing_queue is 'CRM email routing queue; exposes body_preview only, never the raw email body.';
comment on view api.crm_meeting_list is 'CRM meetings; exposes summary/action_items, never the raw Fireflies transcript.';
