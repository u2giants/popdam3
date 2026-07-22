-- Shared controlled Customer classification. A Customer may belong to many
-- Channels; values are never stored as free text on the Customer row.
create table core.channel (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  description text,
  status app.entity_status not null default 'active'
    check (status in ('active'::app.entity_status, 'inactive'::app.entity_status)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint core_channel_code_unique unique (code),
  constraint core_channel_name_unique unique (name)
);

comment on table core.channel is
  'Controlled shared Customer classification such as Mass, Specialty, E-commerce, or Off-Price.';

create trigger set_updated_at before update on core.channel
for each row execute function app.set_updated_at();

create table core.customer_channel (
  customer_id uuid not null references core.customer(id) on delete cascade,
  channel_id uuid not null references core.channel(id) on delete restrict,
  assigned_by uuid references app.profile(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (customer_id, channel_id)
);

comment on table core.customer_channel is
  'Many-to-many assignment of canonical Customers to controlled shared Channels.';

create index core_customer_channel_channel_idx
  on core.customer_channel (channel_id, customer_id);

alter table core.channel enable row level security;
alter table core.customer_channel enable row level security;

-- Serving and mutation access is added through protected DB Data Admin and
-- per-app API contracts in Delivery Step 6. No browser table grants here.
revoke all on core.channel from public, anon, authenticated;
revoke all on core.customer_channel from public, anon, authenticated;
grant all on core.channel to service_role;
grant all on core.customer_channel to service_role;

