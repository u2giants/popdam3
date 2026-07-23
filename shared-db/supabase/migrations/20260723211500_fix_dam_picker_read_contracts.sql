-- Make the DAM picker views usable by every authenticated user who has DAM
-- application access, including least-privilege users whose app role is not one
-- of the legacy shared core-table roles.
--
-- security_invoker=true made the views inherit core.customer/core.factory RLS.
-- Those policies intentionally enumerate staff roles and therefore returned an
-- empty set for the DAM browser-test/user role. Keep the underlying core and dam
-- schemas private: these security-definer views expose only picker-safe columns
-- and explicitly gate every row on DAM app access.

create or replace view api.dam_customer_list
with (security_invoker = false, security_barrier = true) as
select
  c.id,
  c.name,
  c.display_name,
  c.status as core_status,
  coalesce(x.status, 'active'::app.entity_status) as dam_status,
  x.status_reason as dam_status_reason,
  x.status_changed_at as dam_status_changed_at,
  x.updated_at as dam_settings_updated_at,
  c.updated_at
from core.customer c
left join dam.customer_ext x on x.customer_id = c.id
where (select app.has_app_access('dam'::app.app_name))
  and c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_customer_list is
  'DAM picker-safe Customer list. Security-definer serving boundary exposes only selected picker fields, requires DAM app access, and applies global plus DAM status filtering. Underlying core/dam tables remain governed by their own RLS.';

grant select on api.dam_customer_list to authenticated;

create or replace view api.dam_factory_list
with (security_invoker = false, security_barrier = true) as
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
where (select app.has_app_access('dam'::app.app_name))
  and f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_factory_list is
  'DAM picker-safe Vendor list. Security-definer serving boundary exposes only selected picker fields, requires DAM app access, and applies global plus DAM status filtering. Underlying core/dam tables remain governed by their own RLS.';

grant select on api.dam_factory_list to authenticated;

notify pgrst, 'reload schema';
