-- Shared app and core canonical tables.

create table app.role (
  id uuid primary key default gen_random_uuid(),
  slug app.app_role not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.profile (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email extensions.citext unique,
  display_name text,
  provider text,
  external_identifier text,
  avatar_url text,
  status app.entity_status not null default 'active',
  source_refs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.user_role (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profile(id) on delete cascade,
  role_id uuid not null references app.role(id) on delete restrict,
  granted_by_profile_id uuid references app.profile(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (profile_id, role_id)
);

create table app.app_access (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profile(id) on delete cascade,
  app app.app_name not null,
  granted_by_profile_id uuid references app.profile(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (profile_id, app)
);

create table app.file_object (
  id uuid primary key default gen_random_uuid(),
  storage_provider app.file_storage_provider not null default 'external',
  bucket text,
  object_key text,
  url text,
  thumbnail_url text,
  filename text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum text,
  source_system text,
  source_table text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references app.profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_table, source_id)
);

create table app.comment (
  id uuid primary key default gen_random_uuid(),
  target_schema text not null,
  target_table text not null,
  target_id uuid not null,
  body text not null,
  visibility text not null default 'internal',
  created_by_profile_id uuid references app.profile(id) on delete set null,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.activity (
  id uuid primary key default gen_random_uuid(),
  target_schema text not null,
  target_table text not null,
  target_id uuid not null,
  action text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references app.profile(id) on delete set null,
  source_system text,
  source_id text,
  created_at timestamptz not null default now()
);

create table app.notification (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profile(id) on delete cascade,
  app app.app_name not null,
  target_schema text,
  target_table text,
  target_id uuid,
  title text not null,
  body text,
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table core.company (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  normalized_name text generated always as (lower(regexp_replace(coalesce(legal_name, name), '\s+', ' ', 'g'))) stored,
  company_type text not null default 'customer',
  status app.entity_status not null default 'active',
  website text,
  domain text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.company_source_ref (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id) on delete cascade,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  source_code text,
  source_name text,
  confidence app.source_confidence not null default 'verified',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create table core.contact (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  first_name text,
  last_name text,
  email extensions.citext,
  phone text,
  title text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.contact_source_ref (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references core.contact(id) on delete cascade,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  source_email extensions.citext,
  confidence app.source_confidence not null default 'verified',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create table core.contact_company (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references core.contact(id) on delete cascade,
  company_id uuid not null references core.company(id) on delete cascade,
  relationship_type text not null default 'buyer',
  title text,
  is_primary boolean not null default false,
  started_at date,
  ended_at date,
  metadata jsonb not null default '{}'::jsonb,
  unique (contact_id, company_id, relationship_type)
);

create table core.licensor (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (code)
);

create table core.property (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid references core.licensor(id) on delete set null,
  name text not null,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (licensor_id, code)
);

create table core.character (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references core.property(id) on delete cascade,
  name text not null,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (property_id, code)
);

create table core.taxonomy_source_ref (
  id uuid primary key default gen_random_uuid(),
  entity_schema text not null default 'core',
  entity_table text not null,
  entity_id uuid not null,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  source_code text,
  source_name text,
  confidence app.source_confidence not null default 'verified',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create table core.product_category (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references core.product_category(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.product_type (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references core.product_category(id) on delete set null,
  name text not null,
  code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (category_id, code),
  unique nulls not distinct (category_id, name)
);

create table core.product_subtype (
  id uuid primary key default gen_random_uuid(),
  product_type_id uuid references core.product_type(id) on delete cascade,
  name text not null,
  code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (product_type_id, code),
  unique nulls not distinct (product_type_id, name)
);

create table core.merch_group (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references core.merch_group(id) on delete set null,
  code text,
  name text not null,
  level integer not null default 1 check (level > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (parent_id, code)
);

create table core.factory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  company_id uuid references core.company(id) on delete set null,
  status app.entity_status not null default 'active',
  vendor_group text,
  country text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (code)
);

create table core.factory_source_ref (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references core.factory(id) on delete cascade,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  source_code text,
  confidence app.source_confidence not null default 'verified',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create table core.vendor_contact (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid references core.factory(id) on delete cascade,
  contact_id uuid references core.contact(id) on delete cascade,
  role text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  unique nulls not distinct (factory_id, contact_id, role)
);

create table core.sku_ref (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  normalized_sku text generated always as (upper(regexp_replace(sku, '[^A-Za-z0-9]+', '', 'g'))) stored,
  entity_schema text not null,
  entity_table text not null,
  entity_id uuid not null,
  source_system text,
  source_table text,
  source_id text,
  confidence app.source_confidence not null default 'possible',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index core_sku_ref_source_uidx
  on core.sku_ref (source_system, source_table, source_id)
  where source_system is not null and source_table is not null and source_id is not null;

create index core_company_normalized_name_idx on core.company (normalized_name);
create index core_company_domain_idx on core.company (domain);
create index core_contact_email_idx on core.contact (email);
create index core_contact_company_company_idx on core.contact_company (company_id);
create index core_sku_ref_normalized_sku_idx on core.sku_ref (normalized_sku);

insert into app.role (slug, name, description)
values
  ('administrator', 'Administrator', 'Full administrative access.'),
  ('sales', 'Sales', 'CRM and customer account workflow access.'),
  ('licensing', 'Licensing', 'Licensing, approval, submission, and PM workflow access.'),
  ('designer', 'Designer', 'Design and PM workflow access without broad pricing access.'),
  ('viewer', 'Viewer', 'Read-only business data access.'),
  ('vendor', 'Vendor', 'External vendor access; row scoping required before product/order grants.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    updated_at = now();

create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = app, public
as $$
  select p.id
  from app.profile p
  where p.auth_user_id = auth.uid()
    and p.status = 'active'
  limit 1;
$$;

create or replace function app.has_role(required_role app.app_role)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.user_role ur
    join app.role r on r.id = ur.role_id
    where ur.profile_id = app.current_profile_id()
      and r.slug = required_role
      and ur.revoked_at is null
  )
  or lower(required_role::text) = any(app.jwt_role_names());
$$;

create or replace function app.has_any_role(required_roles app.app_role[])
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from unnest(required_roles) as required_role
    where app.has_role(required_role)
  );
$$;

create or replace function app.has_app_access(required_app app.app_name)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select app.has_role('administrator')
  or exists (
    select 1
    from app.app_access aa
    where aa.profile_id = app.current_profile_id()
      and aa.app = required_app
      and aa.revoked_at is null
  );
$$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'app.role'::regclass,
    'app.profile'::regclass,
    'app.file_object'::regclass,
    'app.comment'::regclass,
    'core.company'::regclass,
    'core.contact'::regclass,
    'core.licensor'::regclass,
    'core.property'::regclass,
    'core.character'::regclass,
    'core.product_category'::regclass,
    'core.product_type'::regclass,
    'core.product_subtype'::regclass,
    'core.merch_group'::regclass,
    'core.factory'::regclass
  ]
  loop
    execute format('create trigger set_updated_at before update on %s for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

comment on table core.company is 'Canonical customer/company/account row across CRM, PM, DAM path metadata, and PLM customers.';
comment on table core.contact is 'Canonical person/contact/buyer row across CRM, PM, and PLM-adjacent contacts.';
comment on table core.sku_ref is 'Cross-domain SKU/style/item reference spine used to link PM product, DAM style group/assets, and PLM item master.';
