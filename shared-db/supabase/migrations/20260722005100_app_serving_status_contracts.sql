-- DB Data Admin Delivery Step 6: additive status-aware per-app serving
-- contracts.
--
-- These views enforce the effective-visibility rule from DB_Data_Admin.md
-- section 5 for application pickers:
--
--   core status is active or potential
--   AND
--   application status is active (a missing extension row defaults to active)
--
-- They follow the verified api.dam_customer_list pattern
-- (20260721143000): security_invoker views over core plus only the app's own
-- extension table, granted to authenticated. Nothing existing is replaced:
-- api.crm_customer_list, api.crm_account_list, and api.dam_customer_list keep
-- their current definitions and grants. Consumer pickers move to these
-- contracts during the Step 11 enforcement pass; until then these views add
-- capability without changing any current behavior.
--
-- RLS note: extension-table read policies gate which ext rows the caller can
-- see. For a caller without the app's access, the invisible ext rows
-- coalesce to the default-active value; since core.customer/core.factory are
-- already readable by authenticated, this exposes no additional data. App
-- users (the intended callers) see correct enforcement.

-- CRM Customer picker contract.
create or replace view api.crm_customer_picker_list
with (security_invoker = true) as
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
where c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.crm_customer_picker_list is
  'CRM picker-safe Customer list: global active/potential AND CRM extension status active (missing ext row defaults to active). Additive; api.crm_customer_list is unchanged.';

grant select on api.crm_customer_picker_list to authenticated;

-- PM/PIM Customer picker contract. Replaces the removed legacy
-- api.customer_list for PopPIM callers during the Step 11 cutover.
create or replace view api.pm_customer_list
with (security_invoker = true) as
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
where c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.pm_customer_list is
  'PM/PIM picker-safe Customer list: global active/potential AND PM extension status active (missing ext row defaults to active). Sanctioned replacement target for removed legacy api.customer_list callers.';

grant select on api.pm_customer_list to authenticated;

-- CRM Vendor picker contract. The UI entity is Vendor; the canonical table
-- remains core.factory.
create or replace view api.crm_factory_picker_list
with (security_invoker = true) as
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
where f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.crm_factory_picker_list is
  'CRM picker-safe Vendor list: global active/potential AND CRM extension status active (missing ext row defaults to active).';

grant select on api.crm_factory_picker_list to authenticated;

-- PM/PIM Vendor picker contract. The inventory found no safe PM Vendor
-- serving contract before this migration.
create or replace view api.pm_factory_list
with (security_invoker = true) as
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
where f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.pm_factory_list is
  'PM/PIM picker-safe Vendor list: global active/potential AND PM extension status active (missing ext row defaults to active).';

grant select on api.pm_factory_list to authenticated;

-- DAM Vendor picker contract. The inventory confirmed real DAM Vendor
-- selectors (Sample Vendor / Default Vendor); dam.factory_ext was added in
-- 20260722003400. The dam schema stays unexposed in PostgREST; this api view
-- is the sanctioned serving path.
create or replace view api.dam_factory_list
with (security_invoker = true) as
select
  f.id,
  f.name,
  f.display_name,
  f.code,
  f.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as dam_status,
  x.status_reason as dam_status_reason,
  x.status_changed_at as dam_status_changed_at,
  f.updated_at
from core.factory f
left join dam.factory_ext x on x.factory_id = f.id
where f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_factory_list is
  'DAM picker-safe Vendor list: global active/potential AND DAM extension status active (missing ext row defaults to active).';

grant select on api.dam_factory_list to authenticated;

notify pgrst, 'reload schema';
