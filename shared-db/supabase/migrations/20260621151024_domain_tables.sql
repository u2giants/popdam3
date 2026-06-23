-- Domain tables for DAM, CRM, PM/PIM, PLM, and ingest.

create table ingest.sync_run (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_name text,
  status ingest.sync_status not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_inserted integer not null default 0 check (rows_inserted >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table ingest.raw_record (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references ingest.sync_run(id) on delete set null,
  source_system text not null,
  source_table text not null,
  source_id text not null,
  record_hash text,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (source_system, source_table, source_id)
);

create table ingest.dedupe_candidate (
  id uuid primary key default gen_random_uuid(),
  entity_schema text not null,
  entity_table text not null,
  left_entity_id uuid,
  right_entity_id uuid,
  source_system text,
  confidence app.source_confidence not null default 'possible',
  reason text,
  raw jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by_profile_id uuid references app.profile(id) on delete set null,
  created_at timestamptz not null default now()
);

create table plm.item (
  id uuid primary key default gen_random_uuid(),
  item_number text,
  style_number text,
  name text,
  description text,
  company_id uuid references core.company(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  product_type_id uuid references core.product_type(id) on delete set null,
  merch_group_id uuid references core.merch_group(id) on delete set null,
  status text,
  source_system text,
  source_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.item_detail (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references plm.item(id) on delete cascade,
  detail_type text not null,
  value_text text,
  value_number numeric,
  value_json jsonb not null default '{}'::jsonb,
  source_system text,
  source_id text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.item_attachment (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references plm.item(id) on delete cascade,
  file_object_id uuid references app.file_object(id) on delete set null,
  attachment_type text,
  url text,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.art_piece (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references plm.item(id) on delete set null,
  name text,
  art_type text,
  artist text,
  status text,
  source_system text,
  source_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.production_order (
  id uuid primary key default gen_random_uuid(),
  production_order_number text not null,
  company_id uuid references core.company(id) on delete set null,
  factory_id uuid references core.factory(id) on delete set null,
  status text,
  order_date date,
  requested_ship_date date,
  actual_ship_date date,
  metadata jsonb not null default '{}'::jsonb,
  source_system text,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.production_order_line (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references plm.production_order(id) on delete cascade,
  item_id uuid references plm.item(id) on delete set null,
  line_number text,
  sku text,
  quantity_ordered numeric,
  quantity_shipped numeric,
  unit_cost numeric,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  source_system text,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.licensing_status (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references plm.item(id) on delete cascade,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  status text not null,
  milestone text,
  due_date date,
  completed_at timestamptz,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.licensing_feedback (
  id uuid primary key default gen_random_uuid(),
  licensing_status_id uuid references plm.licensing_status(id) on delete cascade,
  author_name text,
  body text,
  reply_to_id uuid references plm.licensing_feedback(id) on delete set null,
  source_system text,
  source_id text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.rfq_group (
  id uuid primary key default gen_random_uuid(),
  name text,
  status text,
  company_id uuid references core.company(id) on delete set null,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.rfq_item (
  id uuid primary key default gen_random_uuid(),
  rfq_group_id uuid references plm.rfq_group(id) on delete cascade,
  item_id uuid references plm.item(id) on delete set null,
  status text,
  target_cost numeric,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.rfq_vendor (
  id uuid primary key default gen_random_uuid(),
  rfq_group_id uuid references plm.rfq_group(id) on delete cascade,
  factory_id uuid references core.factory(id) on delete set null,
  status text,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table plm.reference_value (
  id uuid primary key default gen_random_uuid(),
  family text not null,
  code text,
  name text not null,
  source_system text,
  source_table text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (family, source_system, source_table, source_id)
);

create table dam.style_group (
  id uuid primary key default gen_random_uuid(),
  sku text,
  title text,
  product_id uuid,
  company_id uuid references core.company(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  product_type_id uuid references core.product_type(id) on delete set null,
  cover_asset_id uuid,
  asset_count integer not null default 0 check (asset_count >= 0),
  status text,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table dam.asset (
  id uuid primary key default gen_random_uuid(),
  style_group_id uuid references dam.style_group(id) on delete set null,
  file_object_id uuid references app.file_object(id) on delete set null,
  sku text,
  title text,
  relative_path text,
  filename text,
  thumbnail_url text,
  file_type text,
  asset_type text,
  workflow_status text,
  company_id uuid references core.company(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  product_subtype_id uuid references core.product_subtype(id) on delete set null,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

alter table dam.style_group
  add constraint dam_style_group_cover_asset_fk
  foreign key (cover_asset_id) references dam.asset(id) on delete set null;

create table dam.asset_character (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references dam.asset(id) on delete cascade,
  character_id uuid not null references core.character(id) on delete cascade,
  unique (asset_id, character_id)
);

create table dam.asset_tag (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references dam.asset(id) on delete cascade,
  tag text not null,
  source_system text,
  created_at timestamptz not null default now(),
  unique (asset_id, tag)
);

create table dam.asset_path_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references dam.asset(id) on delete cascade,
  old_path text,
  new_path text not null,
  changed_at timestamptz not null default now(),
  source_system text,
  metadata jsonb not null default '{}'::jsonb
);

create table dam.asset_checkout (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references dam.asset(id) on delete cascade,
  checked_out_by_profile_id uuid references app.profile(id) on delete set null,
  helper_device_id uuid,
  status text not null default 'active',
  checked_out_at timestamptz not null default now(),
  checked_in_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table dam.agent_registration (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  device_name text,
  status text not null default 'offline',
  last_seen_at timestamptz,
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dam.helper_device (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'inactive',
  paired_profile_id uuid references app.profile(id) on delete set null,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dam.asset_checkout
  add constraint dam_asset_checkout_helper_device_fk
  foreign key (helper_device_id) references dam.helper_device(id) on delete set null;

create table dam.processing_queue (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references dam.asset(id) on delete cascade,
  queue_name text not null,
  status text not null default 'pending',
  priority integer not null default 100,
  payload jsonb not null default '{}'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dam.style_guide_file (
  id uuid primary key default gen_random_uuid(),
  file_object_id uuid references app.file_object(id) on delete set null,
  company_id uuid references core.company(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  title text,
  relative_path text,
  folder text,
  status text,
  source_system text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table dam.sku_style_guide_source (
  id uuid primary key default gen_random_uuid(),
  sku_ref_id uuid references core.sku_ref(id) on delete cascade,
  style_guide_file_id uuid not null references dam.style_guide_file(id) on delete cascade,
  evidence text,
  confidence app.source_confidence not null default 'possible',
  created_at timestamptz not null default now(),
  unique nulls not distinct (sku_ref_id, style_guide_file_id)
);

create table dam.erp_item_snapshot (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references ingest.sync_run(id) on delete set null,
  item_id uuid references plm.item(id) on delete set null,
  style_number text,
  source_system text not null default 'popdam',
  source_id text,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table dam.production_order_snapshot (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references ingest.sync_run(id) on delete set null,
  production_order_line_id uuid references plm.production_order_line(id) on delete set null,
  production_order_number text,
  style_number text,
  source_system text not null default 'popdam',
  source_id text,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique nulls not distinct (source_system, source_id)
);

create table pim.design_collection (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid references core.company(id) on delete set null,
  season text,
  status text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.project (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_id uuid references core.company(id) on delete set null,
  primary_contact_id uuid references core.contact(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  design_collection_id uuid references pim.design_collection(id) on delete set null,
  status text,
  stage text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.design (
  id uuid primary key default gen_random_uuid(),
  design_collection_id uuid references pim.design_collection(id) on delete set null,
  primary_asset_id uuid references dam.asset(id) on delete set null,
  title text not null,
  status text,
  thumbnail_url text,
  nas_path text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pim.project(id) on delete set null,
  design_id uuid references pim.design(id) on delete set null,
  plm_item_id uuid references plm.item(id) on delete set null,
  company_id uuid references core.company(id) on delete set null,
  buyer_contact_id uuid references core.contact(id) on delete set null,
  factory_id uuid references core.factory(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  product_type_id uuid references core.product_type(id) on delete set null,
  code text,
  name text not null,
  status text,
  stage text,
  lifecycle_status text,
  cover_url text,
  external_source text,
  external_id text,
  clickup_task_id text,
  clickup_parent_id text,
  clickup_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

alter table dam.style_group
  add constraint dam_style_group_product_fk
  foreign key (product_id) references pim.product(id) on delete set null;

create table pim.stage (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  pipeline text not null default 'default',
  sort_order numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique nulls not distinct (pipeline, code)
);

create table pim.stage_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references pim.product(id) on delete cascade,
  project_id uuid references pim.project(id) on delete cascade,
  from_stage_id uuid references pim.stage(id) on delete set null,
  to_stage_id uuid references pim.stage(id) on delete set null,
  changed_by_profile_id uuid references app.profile(id) on delete set null,
  changed_at timestamptz not null default now(),
  notes text,
  metadata jsonb not null default '{}'::jsonb
);

create table pim.product_submission (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  status text not null default 'draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product_sample (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  sample_type text,
  status text not null default 'requested',
  requested_at timestamptz,
  received_at timestamptz,
  factory_id uuid references core.factory(id) on delete set null,
  tracking_number text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.revision_request (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  submission_id uuid references pim.product_submission(id) on delete set null,
  requested_by_profile_id uuid references app.profile(id) on delete set null,
  status text not null default 'open',
  body text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  unique nulls not distinct (external_source, external_id)
);

create table pim.customer_order (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pim.project(id) on delete set null,
  product_id uuid references pim.product(id) on delete set null,
  company_id uuid references core.company(id) on delete set null,
  production_order_id uuid references plm.production_order(id) on delete set null,
  order_number text,
  status text,
  order_date date,
  due_date date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.checklist_item (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references pim.product(id) on delete cascade,
  project_id uuid references pim.project(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  sort_order numeric not null default 0,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product_assignee (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  profile_id uuid not null references app.profile(id) on delete cascade,
  assignment_type text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (product_id, profile_id, assignment_type)
);

create table pim.product_file (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  file_object_id uuid references app.file_object(id) on delete set null,
  dam_asset_id uuid references dam.asset(id) on delete set null,
  title text,
  stored_url text,
  thumbnail_url text,
  source_url text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product_update (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  profile_id uuid references app.profile(id) on delete set null,
  body text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product_tag (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  tag text not null,
  source_system text,
  created_at timestamptz not null default now(),
  unique (product_id, tag)
);

create table pim.product_field (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  field_name text not null,
  value_json jsonb,
  external_source text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.product_link (
  id uuid primary key default gen_random_uuid(),
  from_product_id uuid not null references pim.product(id) on delete cascade,
  to_product_id uuid not null references pim.product(id) on delete cascade,
  link_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (from_product_id, to_product_id, link_type)
);

create table pim.product_time_entry (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  profile_id uuid references app.profile(id) on delete set null,
  seconds_spent integer not null check (seconds_spent >= 0),
  started_at timestamptz,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table pim.saved_view (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references app.profile(id) on delete cascade,
  role_id uuid references app.role(id) on delete cascade,
  name text not null,
  scope text not null,
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pim.view_pref (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profile(id) on delete cascade,
  scope text not null,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (profile_id, scope)
);

create table pim.design_asset (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references pim.design(id) on delete cascade,
  asset_id uuid not null references dam.asset(id) on delete cascade,
  link_type text not null default 'reference',
  is_primary boolean not null default false,
  confidence app.source_confidence not null default 'possible',
  created_at timestamptz not null default now(),
  unique (design_id, asset_id, link_type)
);

create table pim.product_style_group (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references pim.product(id) on delete cascade,
  style_group_id uuid not null references dam.style_group(id) on delete cascade,
  confidence app.source_confidence not null default 'possible',
  created_at timestamptz not null default now(),
  unique (product_id, style_group_id)
);

create table crm.department (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id) on delete cascade,
  name text not null,
  primary_contact_id uuid references core.contact(id) on delete set null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table crm.opportunity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  contact_id uuid references core.contact(id) on delete set null,
  department_id uuid references crm.department(id) on delete set null,
  factory_id uuid references core.factory(id) on delete set null,
  project_id uuid references pim.project(id) on delete set null,
  production_order_id uuid references plm.production_order(id) on delete set null,
  name text not null,
  stage text,
  status text,
  estimated_value numeric,
  close_date date,
  production_po_number text,
  sales_order_number text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table crm.opportunity_product (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references crm.opportunity(id) on delete cascade,
  product_id uuid not null references pim.product(id) on delete cascade,
  relationship_type text not null default 'proposed',
  created_at timestamptz not null default now(),
  unique (opportunity_id, product_id, relationship_type)
);

create table crm.email_message (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  contact_id uuid references core.contact(id) on delete set null,
  opportunity_id uuid references crm.opportunity(id) on delete set null,
  direction text,
  subject text,
  body_preview text,
  body_storage_ref text,
  status text,
  sent_at timestamptz,
  received_at timestamptz,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table crm.meeting_note (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  contact_id uuid references core.contact(id) on delete set null,
  opportunity_id uuid references crm.opportunity(id) on delete set null,
  title text,
  body text,
  meeting_at timestamptz,
  created_by_profile_id uuid references app.profile(id) on delete set null,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create table crm.note (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  opportunity_id uuid references crm.opportunity(id) on delete cascade,
  body text not null,
  created_by_profile_id uuid references app.profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm.task (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  opportunity_id uuid references crm.opportunity(id) on delete cascade,
  assignee_profile_id uuid references app.profile(id) on delete set null,
  title text not null,
  status text not null default 'open',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm.ignore_rule (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,
  pattern text not null,
  reason text,
  created_by_profile_id uuid references app.profile(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rule_type, pattern)
);

create table crm.ai_model_config (
  id uuid primary key default gen_random_uuid(),
  feature text not null unique,
  provider text not null,
  model text not null,
  config jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references app.profile(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table crm.licensor_approval_thread (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references core.company(id) on delete set null,
  licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid references core.property(id) on delete set null,
  product_submission_id uuid references pim.product_submission(id) on delete set null,
  revision_request_id uuid references pim.revision_request(id) on delete set null,
  subject text,
  status text,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (external_source, external_id)
);

create index plm_item_style_idx on plm.item (style_number);
create index plm_production_order_number_idx on plm.production_order (production_order_number);
create index plm_production_order_line_sku_idx on plm.production_order_line (sku);
create index dam_asset_style_group_idx on dam.asset (style_group_id);
create index dam_asset_sku_idx on dam.asset (sku);
create index dam_style_group_sku_idx on dam.style_group (sku);
create index pim_product_code_idx on pim.product (code);
create index pim_product_project_idx on pim.product (project_id);
create index pim_product_plm_item_idx on pim.product (plm_item_id);
create index crm_opportunity_company_idx on crm.opportunity (company_id);
create index crm_email_message_opportunity_idx on crm.email_message (opportunity_id);
create index app_comment_target_idx on app.comment (target_schema, target_table, target_id);
create index app_activity_target_idx on app.activity (target_schema, target_table, target_id);

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'plm.item'::regclass,
    'plm.art_piece'::regclass,
    'plm.production_order'::regclass,
    'plm.production_order_line'::regclass,
    'plm.licensing_status'::regclass,
    'plm.rfq_group'::regclass,
    'plm.rfq_item'::regclass,
    'plm.rfq_vendor'::regclass,
    'plm.reference_value'::regclass,
    'dam.style_group'::regclass,
    'dam.asset'::regclass,
    'dam.agent_registration'::regclass,
    'dam.helper_device'::regclass,
    'dam.processing_queue'::regclass,
    'dam.style_guide_file'::regclass,
    'pim.design_collection'::regclass,
    'pim.project'::regclass,
    'pim.design'::regclass,
    'pim.product'::regclass,
    'pim.product_submission'::regclass,
    'pim.product_sample'::regclass,
    'pim.customer_order'::regclass,
    'pim.checklist_item'::regclass,
    'pim.product_file'::regclass,
    'pim.product_field'::regclass,
    'pim.saved_view'::regclass,
    'crm.department'::regclass,
    'crm.opportunity'::regclass,
    'crm.email_message'::regclass,
    'crm.meeting_note'::regclass,
    'crm.note'::regclass,
    'crm.task'::regclass,
    'crm.licensor_approval_thread'::regclass
  ]
  loop
    execute format('create trigger set_updated_at before update on %s for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

comment on table plm.item is 'Canonical operational item master record imported from Designflow PLM.';
comment on table dam.asset is 'First-class DAM asset metadata; object bytes can remain in Spaces or external storage.';
comment on table pim.product is 'PM/PIM product workflow record, linked to core taxonomy and optionally PLM item master.';
comment on table crm.opportunity is 'CRM sales/account opportunity, linked to shared company/contact and PM/PLM crossover records.';
