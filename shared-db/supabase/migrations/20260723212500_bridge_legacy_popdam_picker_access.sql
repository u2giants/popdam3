-- PopDAM still authorizes browser users through public.app_access(app='popdam').
-- The canonical app.app_access(app='dam') model is not yet the live authority
-- for that application. Accept either source at this serving boundary so the
-- picker contracts match the application's real authorization model during the
-- migration period.

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
where (
    (select app.has_app_access('dam'::app.app_name))
    or (select public.has_app_access(auth.uid(), 'popdam'))
  )
  and c.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_customer_list is
  'DAM picker-safe Customer list. Exposes selected fields only, requires canonical DAM or legacy PopDAM app access, and applies global plus DAM status filtering.';

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
where (
    (select app.has_app_access('dam'::app.app_name))
    or (select public.has_app_access(auth.uid(), 'popdam'))
  )
  and f.status in ('active'::app.entity_status, 'potential'::app.entity_status)
  and coalesce(x.status, 'active'::app.entity_status) = 'active'::app.entity_status;

comment on view api.dam_factory_list is
  'DAM picker-safe Vendor list. Exposes selected fields only, requires canonical DAM or legacy PopDAM app access, and applies global plus DAM status filtering.';

grant select on api.dam_factory_list to authenticated;

notify pgrst, 'reload schema';
