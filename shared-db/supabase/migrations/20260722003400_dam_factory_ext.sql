-- DAM-owned Vendor status extension. The inventory confirmed real DAM Vendor
-- pickers. Missing row means DAM-enabled; DAM remains unexposed in PostgREST.
create table dam.factory_ext (
  factory_id uuid primary key references core.factory(id) on delete cascade,
  status app.entity_status not null default 'active'
    check (status in ('active'::app.entity_status, 'inactive'::app.entity_status)),
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dam_factory_ext_inactive_reason_check check (
    status = 'active'::app.entity_status
    or (
      nullif(btrim(status_reason), '') is not null
      and status_changed_at is not null
      and status_changed_by is not null
    )
  )
);

comment on table dam.factory_ext is
  'DAM-owned 1:1 extension of core.factory (Vendor). Missing row means DAM-enabled; shared identity and provenance remain in core.';

create trigger set_updated_at before update on dam.factory_ext
for each row execute function app.set_updated_at();

alter table dam.factory_ext enable row level security;
create policy dam_read on dam.factory_ext for select to authenticated
  using (app.has_app_access('dam') or app.has_role('administrator'));
create policy dam_write on dam.factory_ext for all to authenticated
  using (app.has_role('administrator') or app.has_any_role(array['designer', 'licensing']::app.app_role[]))
  with check (app.has_role('administrator') or app.has_any_role(array['designer', 'licensing']::app.app_role[]));

grant select on dam.factory_ext to authenticated;
grant all on dam.factory_ext to service_role;
