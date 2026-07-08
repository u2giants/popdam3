-- Canonical picker values for the first segment of SKU/Master Data
-- descriptions: "Product Type + Material" (for example, "Printed Glass
-- Shadowbox" or "Coir Doormat"). This is separate from PLM MG01 product_type:
-- it is the user-facing description phrase shared across apps.

create table if not exists core.product_material (
  id uuid primary key default gen_random_uuid(),
  product_type_id uuid references core.product_type(id) on delete set null,
  product_subtype_id uuid references core.product_subtype(id) on delete set null,
  name text not null,
  material text,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (product_type_id, product_subtype_id, name)
);

create unique index if not exists product_material_type_subtype_code_key
  on core.product_material (product_type_id, product_subtype_id, code)
  where code is not null;

create index if not exists idx_product_material_status_name
  on core.product_material (status, name);

create index if not exists idx_product_material_type
  on core.product_material (product_type_id)
  where product_type_id is not null;

create index if not exists idx_product_material_subtype
  on core.product_material (product_subtype_id)
  where product_subtype_id is not null;

drop trigger if exists set_updated_at on core.product_material;
create trigger set_updated_at before update on core.product_material
  for each row execute function app.set_updated_at();

alter table core.product_material enable row level security;

drop policy if exists shared_read on core.product_material;
create policy shared_read on core.product_material
  for select to authenticated
  using (
    app.has_any_role(array[
      'administrator',
      'sales',
      'licensing',
      'designer',
      'viewer',
      'vendor'
    ]::app.app_role[])
  );

drop policy if exists admin_write on core.product_material;
create policy admin_write on core.product_material
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

grant select on table core.product_material to authenticated;
grant all on table core.product_material to service_role;

comment on table core.product_material is
  'Canonical shared picker values for product type + material description phrases used in SKU/Master Data item descriptions.';

comment on column core.product_material.name is
  'Approved display phrase, e.g. Printed Glass Shadowbox, Coir Doormat, or PE Rattan 2-Tier Wall Shelf.';

insert into core.product_material (name, material, metadata)
values
  ('2pc Canvas Set', 'Canvas', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('3pc Canvas Set', 'Canvas', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('4pc Canvas Set', 'Canvas', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Coir Doormat', 'Coir', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Figural Resin Pencil Cup', 'Resin', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('PE Rattan 2-Tier Wall Shelf', 'PE Rattan', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Printed Canvas', 'Canvas', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Printed Glass Shadowbox', 'Glass', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Printed Wood Wall Decor', 'Wood', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Resin Tabletop Decor', 'Resin', '{"source":"popdam_sku_description_conventions"}'::jsonb),
  ('Wood Wall Shelf', 'Wood', '{"source":"popdam_sku_description_conventions"}'::jsonb)
on conflict (product_type_id, product_subtype_id, name) do update
set
  material = excluded.material,
  status = 'active',
  metadata = core.product_material.metadata || excluded.metadata,
  updated_at = now();
