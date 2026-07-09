create table if not exists core.packaging_type (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  ) stored,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_type_name_not_blank check (length(btrim(name)) > 0),
  constraint packaging_type_code_not_blank check (code is null or length(btrim(code)) > 0)
);

create unique index if not exists packaging_type_normalized_name_key
  on core.packaging_type (normalized_name);

create unique index if not exists packaging_type_code_key
  on core.packaging_type (code)
  where code is not null;

create index if not exists packaging_type_status_name_idx
  on core.packaging_type (status, name);

drop trigger if exists set_updated_at on core.packaging_type;
create trigger set_updated_at before update on core.packaging_type
  for each row execute function app.set_updated_at();

alter table core.packaging_type enable row level security;

drop policy if exists shared_read on core.packaging_type;
create policy shared_read on core.packaging_type
  for select
  to authenticated
  using (
    app.has_role('administrator')
    or app.has_any_role(array[
      'sales',
      'licensing',
      'designer',
      'viewer',
      'vendor'
    ]::app.app_role[])
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'apinilla@popcre.com'
  );

drop policy if exists admin_or_packaging_manager_write on core.packaging_type;
create policy admin_or_packaging_manager_write on core.packaging_type
  for all
  to authenticated
  using (
    app.has_role('administrator')
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'apinilla@popcre.com'
  )
  with check (
    app.has_role('administrator')
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'apinilla@popcre.com'
  );

grant select, insert, update, delete on table core.packaging_type to authenticated;
grant all on table core.packaging_type to service_role;

comment on table core.packaging_type is
  'Shared packaging type lookup used by DAM and other applications.';
comment on column core.packaging_type.name is
  'Human-readable packaging type name shown in application pickers.';
comment on column core.packaging_type.code is
  'Optional stable short code for integrations or imports.';
