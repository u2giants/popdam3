-- Step 11 live-acceptance repair: make CRM and PM picker views explicit,
-- app-gated serving contracts.
--
-- security_invoker forced every request through the base-table role policies.
-- In production that both excluded valid app-only users with no shared role and
-- made CRM's bounded ilike search exceed the PostgREST statement timeout.
-- These views expose only picker-safe columns and retain the effective-status
-- predicates, so a protected security-barrier view is the appropriate boundary.

create or replace view api.crm_customer_picker_list
with (security_invoker = false, security_barrier = true) as
select
  c.id,
  c.name,
  c.display_name,
  c.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as crm_status,
  x.status_reason as crm_status_reason,
  x.status_changed_at as crm_status_changed_at,
  c.updated_at
from core.customer c
left join crm.customer_ext x on x.customer_id = c.id
where app.has_explicit_app_access('crm')
  and c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

create or replace view api.pm_customer_list
with (security_invoker = false, security_barrier = true) as
select
  c.id,
  c.name,
  c.display_name,
  c.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as pm_status,
  x.status_reason as pm_status_reason,
  x.status_changed_at as pm_status_changed_at,
  c.updated_at
from core.customer c
left join pim.customer_ext x on x.customer_id = c.id
where app.has_explicit_app_access('pm')
  and c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

create or replace view api.crm_factory_picker_list
with (security_invoker = false, security_barrier = true) as
select
  f.id,
  f.name,
  f.display_name,
  f.code,
  f.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as crm_status,
  x.status_reason as crm_status_reason,
  x.status_changed_at as crm_status_changed_at,
  f.updated_at
from core.factory f
left join crm.factory_ext x on x.factory_id = f.id
where app.has_explicit_app_access('crm')
  and f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

create or replace view api.pm_factory_list
with (security_invoker = false, security_barrier = true) as
select
  f.id,
  f.name,
  f.display_name,
  f.code,
  f.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as pm_status,
  x.status_reason as pm_status_reason,
  x.status_changed_at as pm_status_changed_at,
  f.updated_at
from core.factory f
left join pim.factory_ext x on x.factory_id = f.id
where app.has_explicit_app_access('pm')
  and f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

grant select on
  api.crm_customer_picker_list,
  api.pm_customer_list,
  api.crm_factory_picker_list,
  api.pm_factory_list
to authenticated;

comment on view api.crm_customer_picker_list is
  'Protected CRM picker contract: explicit CRM access, global active/potential, and CRM status active.';
comment on view api.pm_customer_list is
  'Protected PM picker contract: explicit PM access, global active/potential, and PM status active.';
comment on view api.crm_factory_picker_list is
  'Protected CRM Vendor picker contract: explicit CRM access, global active/potential, and CRM status active.';
comment on view api.pm_factory_list is
  'Protected PM Vendor picker contract: explicit PM access, global active/potential, and PM status active.';
