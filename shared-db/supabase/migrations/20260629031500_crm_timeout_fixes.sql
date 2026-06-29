-- Fast browser contracts for CRM pages that were timing out through PostgREST.
--
-- Keep this migration additive. Existing crm_customer_list and
-- crm_email_routing_queue callers stay valid while the CRM app moves the slow
-- page loads to the recent/count RPCs below.

create index if not exists core_customer_name_idx
  on core.customer (name);

create index if not exists core_customer_status_name_idx
  on core.customer (customer_status, name);

create index if not exists plm_customer_import_company_logo_recent_idx
  on plm.customer_import (company_id, updated_at desc, imported_at desc)
  where nullif(logo_url, '') is not null;

create index if not exists crm_email_message_received_id_idx
  on crm.email_message (received_at desc, id);

create index if not exists crm_email_message_company_idx
  on crm.email_message (company_id);

create index if not exists crm_email_message_department_idx
  on crm.email_message (department_id);

create index if not exists crm_task_status_due_idx
  on crm.task (status, due_at);

-- security_invoker views that join app.profile need both table privilege and
-- RLS. Policies still decide which profile rows are visible.
grant select on app.profile to authenticated;

create or replace view api.crm_customer_list
with (security_invoker = true) as
with latest_logo as (
  select distinct on (ci.company_id)
    ci.company_id,
    ci.logo_url
  from plm.customer_import ci
  where nullif(ci.logo_url, '') is not null
  order by ci.company_id, ci.updated_at desc nulls last, ci.imported_at desc nulls last
)
select
  c.id,
  c.name,
  c.domain,
  latest_logo.logo_url,
  c.customer_status,
  c.chain_type,
  c.routing_aliases,
  c.so_patterns,
  c.company_type,
  c.status,
  c.primary_salesperson_profile_id,
  c.account_owner_profile_id,
  c.updated_at,
  c.is_potential
from core.customer c
left join latest_logo on latest_logo.company_id = c.id;

create or replace function api.crm_email_routing_recent(p_limit integer default 500)
returns table (
  id uuid,
  subject text,
  sender text,
  recipients text,
  received_at timestamptz,
  routing_status text,
  routing_method text,
  body_preview text,
  detected_so_numbers text,
  detected_po_numbers text,
  company_id uuid,
  company_name text,
  department_id uuid,
  department_name text,
  opportunity_id uuid,
  opportunity_name text,
  opportunity_stage text,
  updated_at timestamptz
)
language sql
security definer
set search_path = api, crm, core, app, public
as $$
  with checked as (
    select case
      when app.has_app_access('crm') then least(greatest(coalesce(p_limit, 500), 1), 1000)
      else null::integer
    end as row_limit
  ),
  recent as (
    select e.*
    from crm.email_message e, checked
    where checked.row_limit is not null
    order by e.received_at desc nulls last, e.id
    limit (select row_limit from checked)
  )
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
  from recent e
  left join core.customer comp on comp.id = e.company_id
  left join crm.department d on d.id = e.department_id
  left join crm.opportunity o on o.id = e.opportunity_id
  order by e.received_at desc nulls last, e.id;
$$;

create or replace function api.crm_email_routing_segment_counts()
returns table (
  company bigint,
  department bigint,
  program bigint,
  triage bigint,
  "all" bigint
)
language sql
security definer
set search_path = api, crm, app, public
as $$
  select
    count(*) filter (
      where not (coalesce(e.routing_status, '') <> '' and e.routing_status not in ('ROUTED', 'SKIPPED'))
        and e.company_id is not null
        and e.department_id is null
        and e.opportunity_id is null
    ) as company,
    count(*) filter (
      where not (coalesce(e.routing_status, '') <> '' and e.routing_status not in ('ROUTED', 'SKIPPED'))
        and e.department_id is not null
        and e.opportunity_id is null
    ) as department,
    count(*) filter (
      where not (coalesce(e.routing_status, '') <> '' and e.routing_status not in ('ROUTED', 'SKIPPED'))
        and e.opportunity_id is not null
    ) as program,
    count(*) filter (
      where (coalesce(e.routing_status, '') <> '' and e.routing_status not in ('ROUTED', 'SKIPPED'))
        or (e.company_id is null and e.department_id is null and e.opportunity_id is null)
    ) as triage,
    count(*) as "all"
  from crm.email_message e
  where app.has_app_access('crm');
$$;

revoke all on function api.crm_email_routing_recent(integer) from public;
revoke all on function api.crm_email_routing_segment_counts() from public;
grant execute on function api.crm_email_routing_recent(integer) to authenticated;
grant execute on function api.crm_email_routing_segment_counts() to authenticated;
grant select on api.crm_customer_list to authenticated;

comment on function api.crm_email_routing_recent(integer) is
  'Fast recent-window email routing feed. Limits crm.email_message before joining labels so browser email routing does not time out.';
comment on function api.crm_email_routing_segment_counts() is
  'Fast full-dataset email routing segment counts for CRM tabs without paging the joined queue view.';
comment on view api.crm_customer_list is
  'CRM customer list for customer pages, pickers, and inline edits. Optimized customer-named replacement for deprecated api.crm_account_list.';
