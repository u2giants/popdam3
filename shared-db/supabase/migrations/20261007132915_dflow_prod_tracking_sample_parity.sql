-- Issue #2875. Version reserved by migration-author claim #3705.
-- Bring the complete current DesignFlow Tracking sample surface into dflow_prod.
--
-- Every object below is the canonical dflow definition produced by migrations
-- 20260722221000 through 20260903083204, re-targeted from dflow to dflow_prod
-- and nothing else: 19 new tables, the Tracking columns on sample,
-- sample_box and sample_shipment_item, 8 views, 26 functions, their
-- identity columns, CHECK/UNIQUE/PRIMARY/FOREIGN KEY constraints, indexes,
-- triggers, comments and exact revoke/grant state. Definitions were read from
-- the catalog of the deployed dflow schema (pg_get_*def), which is those
-- migrations applied in order, so no intermediate superseded body is repeated.
--
-- Boundaries:
--   * No application rows are copied. New tables start empty apart from the four
--     canonical carrier reference rows that migration 20260814130000 seeds.
--   * No object here references schema dflow, and nothing grants any role access
--     to dflow. The only non-owner grants are the canonical service_role grants
--     that dflow carries on the Flow 4 remote-request surface.
--   * SECURITY DEFINER functions pin search_path to pg_catalog, dflow_prod.
--   * Fails closed if any target object already exists or a dependency is missing.

begin;

do $pre$
begin
  if to_regnamespace('dflow_prod') is null then raise exception '#2875: schema dflow_prod is missing'; end if;
  -- Every dependency must be an ordinary table carrying the columns the new
  -- foreign keys, views and functions read.
  if exists (
    select 1 from (values
      ('sample', 'sample_id_pk'),
      ('sample', 'box_id_fk'),
      ('sample_attachment', 'sample_attachment_id'),
      ('sample_attachment', 'sample_id_fk'),
      ('sample_box', 'box_id_pk'),
      ('sample_box', 'box_label'),
      ('sample_box', 'status'),
      ('sample_shipment_item', 'shipment_item_id_pk'),
      ('sample_shipment_item', 'sample_id_fk'),
      ('sample_shipment_item', 'box_id_fk'),
      ('Factory', 'id'),
      ('Factory', 'factory_name'),
      ('Factory', 'factory_nickname'),
      ('vendor', 'vendor_id')
    ) as need(rel, col)
    where not exists (
      select 1 from pg_class c join pg_attribute a on a.attrelid = c.oid
      where c.relnamespace = 'dflow_prod'::regnamespace and c.relname = need.rel and c.relkind = 'r'
        and a.attname = need.col and a.attnum > 0 and not a.attisdropped)
  ) then
    raise exception '#2875: a dflow_prod dependency table or column is missing or is not an ordinary table';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'dflow_prod' and c.relname = any (array['sample_approval_event', 'sample_carrier', 'sample_creation_batch', 'sample_factory_visit', 'sample_factory_visit_event', 'sample_import_job', 'sample_import_row', 'sample_inventory_balance', 'sample_movement', 'sample_path_revision', 'sample_piece_lineage', 'sample_remote_request', 'sample_remote_request_history', 'sample_remote_request_item', 'sample_reservation', 'sample_shipment', 'sample_shipment_line', 'sample_stop_closeout', 'sample_workflow', 'sample_approval_current', 'sample_balance_by_location', 'sample_global_status', 'sample_in_transit', 'sample_inventory', 'sample_open_stop_work', 'sample_receipt_discrepancy', 'sample_visit_plan']::text[])) then
    raise exception '#2875: a target dflow_prod Tracking relation already exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'dflow_prod' and p.proname = any (array['apply_sample_factory_visit_event', 'apply_sample_path_revision', 'pack_sample_reservation', 'post_sample_approval_event', 'post_sample_movement', 'post_sample_piece_split', 'post_sample_remote_request_event', 'prevent_sample_shipment_route_drift', 'project_sample_inventory_movement', 'reject_sample_approval_event_mutation', 'reject_sample_factory_visit_event_mutation', 'reject_sample_movement_mutation', 'reject_sample_path_revision_mutation', 'require_sample_factory_visit_event', 'require_sample_path_revision', 'reserve_sample_remote_request_item', 'sample_movement_auto_office_inventory', 'sample_movement_guard', 'touch_sample_factory_visit_updated_at', 'validate_sample_approval_event', 'validate_sample_factory_visit', 'validate_sample_factory_visit_event', 'validate_sample_movement_shipment_identity', 'validate_sample_path_revision', 'validate_sample_piece_lineage', 'validate_sample_shipment_line_header']::text[])) then
    raise exception '#2875: a target dflow_prod Tracking function already exists';
  end if;
  if exists (select 1 from pg_attribute a where not a.attisdropped and a.attnum > 0 and (a.attrelid, a.attname) in (
       ('dflow_prod.sample'::regclass, 'quantity_migration_state')
      ,('dflow_prod.sample_box'::regclass, 'owner_factory_id_fk')
      ,('dflow_prod.sample_box'::regclass, 'ownership_state')
      ,('dflow_prod.sample_box'::regclass, 'current_custody_type')
      ,('dflow_prod.sample_box'::regclass, 'current_custody_id')
      ,('dflow_prod.sample_shipment_item'::regclass, 'quantity_intended')
    )) then
    raise exception '#2875: a target Tracking column already exists on an existing dflow_prod table';
  end if;
  if exists (select 1 from pg_constraint co join pg_class c on c.oid = co.conrelid
             where c.relnamespace = 'dflow_prod'::regnamespace and co.conname = any (array['sample_quantity_migration_state_check', 'sample_box_custody_pair_check', 'sample_box_ownership_state_check', 'sample_box_owner_factory_fkey', 'sample_shipment_item_quantity_positive', 'sample_shipment_item_sample_box_uniq']::name[]))
     or exists (select 1 from pg_class i where i.relnamespace = 'dflow_prod'::regnamespace
             and i.relname = any (array['sample_box_active_name_custody_uniq', 'sample_box_owner_factory_idx', 'sample_quantity_migration_state_idx', 'sample_shipment_item_box_id_fk_idx', 'sample_shipment_item_sample_id_fk_idx', 'sample_shipment_item_sample_box_uniq']::name[])) then
    raise exception '#2875: a target Tracking constraint or index already exists on an existing dflow_prod table';
  end if;
end
$pre$;

-- Tracking columns, constraints and indexes on existing dflow_prod tables ------
-- (canonical dflow additions from 20260722221000-20260814193402 that the
-- functions and views below read; the tables themselves already exist)

alter table dflow_prod.sample add column quantity_migration_state text default 'unknown'::text not null;
alter table dflow_prod.sample_box add column owner_factory_id_fk integer;
alter table dflow_prod.sample_box add column ownership_state text default 'unassigned'::text not null;
alter table dflow_prod.sample_box add column current_custody_type text;
alter table dflow_prod.sample_box add column current_custody_id text;
alter table dflow_prod.sample_shipment_item add column quantity_intended integer;
alter table dflow_prod.sample add constraint sample_quantity_migration_state_check CHECK ((quantity_migration_state = ANY (ARRAY['unknown'::text, 'known'::text, 'reconciled'::text])));
alter table dflow_prod.sample_box add constraint sample_box_custody_pair_check CHECK ((((current_custody_type IS NULL) AND (current_custody_id IS NULL)) OR ((current_custody_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text, 'in_transit'::text])) AND (current_custody_id IS NOT NULL) AND (btrim(current_custody_id) <> ''::text))));
alter table dflow_prod.sample_box add constraint sample_box_ownership_state_check CHECK ((ownership_state = ANY (ARRAY['owned'::text, 'internal'::text, 'ambiguous'::text, 'unassigned'::text])));
alter table dflow_prod.sample_box add constraint sample_box_owner_factory_fkey FOREIGN KEY (owner_factory_id_fk) REFERENCES dflow_prod.vendor(vendor_id) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
alter table dflow_prod.sample_shipment_item add constraint sample_shipment_item_quantity_positive CHECK (((quantity_intended IS NULL) OR (quantity_intended > 0)));
alter table dflow_prod.sample_shipment_item add constraint sample_shipment_item_sample_box_uniq UNIQUE (sample_id_fk, box_id_fk);
CREATE UNIQUE INDEX sample_box_active_name_custody_uniq ON dflow_prod.sample_box USING btree (lower(btrim(box_label)), current_custody_type, current_custody_id) WHERE current_custody_type IS NOT NULL AND status NOT IN ('closed', 'cancelled');
CREATE INDEX sample_box_owner_factory_idx ON dflow_prod.sample_box USING btree (owner_factory_id_fk);
CREATE INDEX sample_quantity_migration_state_idx ON dflow_prod.sample USING btree (quantity_migration_state);
CREATE INDEX sample_shipment_item_box_id_fk_idx ON dflow_prod.sample_shipment_item USING btree (box_id_fk);
CREATE INDEX sample_shipment_item_sample_id_fk_idx ON dflow_prod.sample_shipment_item USING btree (sample_id_fk);
comment on column dflow_prod.sample.quantity_migration_state is 'Legacy quantity confidence. Existing rows default unknown and must never be treated as quantity one.';

-- Tables ---------------------------------------------------------------------

create table dflow_prod.sample_approval_event (
  sample_approval_event_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  sample_attachment_id integer,
  approval_type text not null,
  approval_state text not null,
  qc_required boolean not null,
  destination_type text,
  destination_id text,
  reason text,
  actor_user text not null,
  actor_role text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_carrier (
  sample_carrier_id smallint generated by default as identity not null,
  carrier_code text not null,
  display_name text not null,
  tracking_url_template text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_creation_batch (
  creation_batch_id bigint generated by default as identity not null,
  mode text not null,
  entry_method text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_by_user text not null,
  created_by_role text not null,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_factory_visit (
  sample_factory_visit_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  factory_id integer not null,
  visit_order integer not null,
  provenance text not null,
  state text default 'planned'::text not null,
  outbound_shipment_id bigint,
  return_shipment_id bigint,
  requested_by_user text not null,
  requested_by_role text not null,
  shipped_at timestamp with time zone,
  factory_received_at timestamp with time zone,
  returned_at timestamp with time zone,
  closed_at timestamp with time zone,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_factory_visit_event (
  sample_factory_visit_event_id bigint generated by default as identity not null,
  sample_factory_visit_id bigint not null,
  revision integer not null,
  event_type text not null,
  from_state text,
  to_state text,
  from_visit_order integer,
  to_visit_order integer,
  from_factory_id integer,
  to_factory_id integer,
  sample_shipment_id bigint,
  reason text not null,
  changed_by_user text not null,
  changed_by_role text not null,
  changed_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_import_job (
  import_job_id bigint generated by default as identity not null,
  template_version text not null,
  content_hash text not null,
  source_filename text not null,
  private_object_key text,
  uploader_user text not null,
  uploader_role text not null,
  uploader_factory_id integer,
  state text default 'uploaded'::text not null,
  row_count integer default 0 not null,
  warning_count integer default 0 not null,
  error_count integer default 0 not null,
  photo_count integer default 0 not null,
  sample_count integer default 0 not null,
  box_count integer default 0 not null,
  confirmation_idempotency_key text,
  confirmation_request_hash text,
  failure_details text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_import_row (
  import_row_id bigint generated by default as identity not null,
  import_job_id bigint not null,
  row_number integer not null,
  normalized_values jsonb default '{}'::jsonb not null,
  validation_errors jsonb default '[]'::jsonb not null,
  validation_warnings jsonb default '[]'::jsonb not null,
  image_state text default 'none'::text not null,
  image_object_key text,
  resolution jsonb,
  resulting_sample_id integer,
  resulting_box_id integer,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_inventory_balance (
  sample_id_fk integer not null,
  location_type text not null,
  location_id text not null,
  quantity bigint not null,
  available_since timestamp with time zone not null
);

create table dflow_prod.sample_movement (
  movement_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  quantity integer not null,
  from_location_type text not null,
  from_location_id text not null,
  from_location_label text,
  to_location_type text not null,
  to_location_id text not null,
  to_location_label text,
  box_id_fk integer,
  shipment_line_id bigint,
  lifecycle_action text not null,
  prior_status text,
  resulting_status text,
  discrepancy_code text,
  discrepancy_details text,
  actor_user text not null,
  actor_role text not null,
  actor_factory_id integer,
  occurred_at timestamp with time zone default now() not null,
  idempotency_key text not null,
  request_hash text not null,
  reversal_of_movement_id bigint,
  created_at timestamp with time zone default now() not null,
  sample_shipment_id bigint
);

create table dflow_prod.sample_path_revision (
  sample_path_revision_id bigint generated by default as identity not null,
  sample_workflow_id bigint not null,
  revision integer not null,
  business_path text not null,
  reason text not null,
  changed_by_user text not null,
  changed_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_piece_lineage (
  sample_piece_lineage_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  parent_sample_id_fk integer not null,
  root_sample_id_fk integer not null,
  piece_quantity integer not null,
  split_reason text not null,
  split_by_user text not null,
  split_by_role text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_remote_request (
  sample_remote_request_id uuid default gen_random_uuid() not null,
  request_source text not null,
  business_path text not null,
  destination_type text not null,
  destination_id text not null,
  requested_by_user text not null,
  requested_by_role text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_remote_request_history (
  sample_remote_request_history_id bigint generated always as identity not null,
  sample_remote_request_item_id uuid not null,
  from_state text,
  to_state text not null,
  actor_user text not null,
  actor_role text not null,
  note text,
  event_payload jsonb default '{}'::jsonb not null,
  idempotency_key text not null,
  request_hash text not null,
  occurred_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_remote_request_item (
  sample_remote_request_item_id uuid default gen_random_uuid() not null,
  sample_remote_request_id uuid not null,
  workflow_id bigint not null,
  sample_id_fk integer,
  source_type text not null,
  business_path text not null,
  source_reference text,
  current_state text default 'requested'::text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_by_user text not null,
  created_by_role text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_reservation (
  sample_reservation_id uuid default gen_random_uuid() not null,
  sample_remote_request_item_id uuid not null,
  sample_id_fk integer not null,
  reservation_state text default 'reserved'::text not null,
  open_sample_id integer generated always as (
CASE
    WHEN (reservation_state = 'reserved'::text) THEN sample_id_fk
    ELSE NULL::integer
END) stored,
  packed_box_id integer,
  packed_shipment_line_id bigint,
  reserved_by_user text not null,
  packed_by_user text,
  idempotency_key text not null,
  request_hash text not null,
  reserved_at timestamp with time zone default now() not null,
  packed_at timestamp with time zone
);

create table dflow_prod.sample_shipment (
  sample_shipment_id bigint generated by default as identity not null,
  carrier_id smallint,
  tracking_number text,
  origin_location_type text not null,
  origin_location_id text not null,
  destination_location_type text not null,
  destination_location_id text not null,
  state text default 'draft'::text not null,
  shipped_at timestamp with time zone,
  received_at timestamp with time zone,
  actor_user text not null,
  actor_role text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table dflow_prod.sample_shipment_line (
  shipment_line_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  box_id_fk integer,
  quantity_intended integer not null,
  origin_location_type text not null,
  origin_location_id text not null,
  destination_location_type text not null,
  destination_location_id text not null,
  route_leg text not null,
  state text default 'packed'::text not null,
  idempotency_key text not null,
  request_hash text not null,
  created_by_user text not null,
  created_by_role text not null,
  created_by_factory_id integer,
  created_at timestamp with time zone default now() not null,
  sample_shipment_id bigint
);

create table dflow_prod.sample_stop_closeout (
  closeout_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  location_type text not null,
  location_id text not null,
  movement_watermark bigint not null,
  revision integer default 1 not null,
  state text default 'closed'::text not null,
  note text not null,
  closed_by_user text not null,
  closed_by_role text not null,
  closed_at timestamp with time zone default now() not null,
  reopens_closeout_id bigint
);

create table dflow_prod.sample_workflow (
  sample_workflow_id bigint generated by default as identity not null,
  sample_id_fk integer not null,
  creation_batch_id bigint,
  workflow_type text not null,
  business_path text not null,
  workflow_state text default 'draft'::text not null,
  contract_version text default 'sample-tracking-release-a-v1'::text not null,
  created_by_user text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Primary key, unique, exclusion and check constraints -------------------------

alter table dflow_prod.sample_approval_event add constraint sample_approval_event_pkey PRIMARY KEY (sample_approval_event_id);
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_sample_id_fk_idempotency_key_key UNIQUE (sample_id_fk, idempotency_key);
alter table dflow_prod.sample_approval_event add constraint sample_approval_attachment_type_check CHECK (((approval_type = 'photo'::text) OR (sample_attachment_id IS NULL)));
alter table dflow_prod.sample_approval_event add constraint sample_approval_destination_pair_check CHECK ((((destination_type IS NULL) AND (destination_id IS NULL)) OR ((destination_type IS NOT NULL) AND (btrim(destination_type) <> ''::text) AND (destination_id IS NOT NULL) AND (btrim(destination_id) <> ''::text))));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_actor_role_check CHECK ((btrim(actor_role) <> ''::text));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_actor_user_check CHECK ((btrim(actor_user) <> ''::text));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_approval_state_check CHECK ((approval_state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_approval_type_check CHECK ((approval_type = ANY (ARRAY['photo'::text, 'qc'::text])));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_approval_event add constraint sample_approval_rejection_reason_check CHECK (((approval_state <> 'rejected'::text) OR ((reason IS NOT NULL) AND (btrim(reason) <> ''::text))));
alter table dflow_prod.sample_carrier add constraint sample_carrier_pkey PRIMARY KEY (sample_carrier_id);
alter table dflow_prod.sample_carrier add constraint sample_carrier_carrier_code_key UNIQUE (carrier_code);
alter table dflow_prod.sample_carrier add constraint sample_carrier_display_name_key UNIQUE (display_name);
alter table dflow_prod.sample_carrier add constraint sample_carrier_carrier_code_check CHECK (((carrier_code = lower(carrier_code)) AND (btrim(carrier_code) <> ''::text)));
alter table dflow_prod.sample_carrier add constraint sample_carrier_display_name_check CHECK ((btrim(display_name) <> ''::text));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_pkey PRIMARY KEY (creation_batch_id);
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_created_by_user_idempotency_key_key UNIQUE (created_by_user, idempotency_key);
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_created_by_role_check CHECK ((btrim(created_by_role) <> ''::text));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_created_by_user_check CHECK ((btrim(created_by_user) <> ''::text));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_entry_method_check CHECK ((entry_method = ANY (ARRAY['manual'::text, 'inventory_selection'::text, 'import_confirm'::text])));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_mode_check CHECK ((mode = ANY (ARRAY['single'::text, 'group'::text])));
alter table dflow_prod.sample_creation_batch add constraint sample_creation_batch_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_pkey PRIMARY KEY (sample_factory_visit_id);
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_requested_by_user_idempotency_key_key UNIQUE (requested_by_user, idempotency_key);
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_closed_matches_state CHECK (((closed_at IS NOT NULL) = (state = ANY (ARRAY['returned'::text, 'cancelled'::text, 'not_returned'::text]))));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_provenance_check CHECK ((provenance = ANY (ARRAY['nyo_requested'::text, 'ningbo_added'::text])));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_receipt_after_ship CHECK (((factory_received_at IS NULL) OR (shipped_at IS NOT NULL)));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_requested_by_role_check CHECK ((btrim(requested_by_role) <> ''::text));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_requested_by_user_check CHECK ((btrim(requested_by_user) <> ''::text));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_returned_needs_return CHECK (((state <> 'returned'::text) OR ((return_shipment_id IS NOT NULL) AND (returned_at IS NOT NULL))));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_shipped_needs_outbound CHECK (((state <> ALL (ARRAY['shipped'::text, 'at_factory'::text, 'returning'::text, 'returned'::text])) OR (outbound_shipment_id IS NOT NULL)));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_shipped_needs_time CHECK (((state <> ALL (ARRAY['shipped'::text, 'at_factory'::text, 'returning'::text, 'returned'::text])) OR (shipped_at IS NOT NULL)));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_state_check CHECK ((state = ANY (ARRAY['planned'::text, 'shipped'::text, 'at_factory'::text, 'returning'::text, 'returned'::text, 'cancelled'::text, 'not_returned'::text])));
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_visit_order_check CHECK ((visit_order > 0));
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_pkey PRIMARY KEY (sample_factory_visit_event_id);
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_sample_factory_visit_id_revision_key UNIQUE (sample_factory_visit_id, revision);
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_changed_by_role_check CHECK ((btrim(changed_by_role) <> ''::text));
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_changed_by_user_check CHECK ((btrim(changed_by_user) <> ''::text));
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_event_type_check CHECK ((event_type = ANY (ARRAY['planned'::text, 'reordered'::text, 'shipped'::text, 'factory_received'::text, 'return_started'::text, 'returned'::text, 'cancelled'::text, 'marked_not_returned'::text, 'factory_changed'::text])));
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_reason_check CHECK ((btrim(reason) <> ''::text));
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_revision_check CHECK ((revision > 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_pkey PRIMARY KEY (import_job_id);
alter table dflow_prod.sample_import_job add constraint sample_import_job_confirmation_idempotency_key_key UNIQUE (confirmation_idempotency_key);
alter table dflow_prod.sample_import_job add constraint sample_import_job_uploader_user_content_hash_key UNIQUE (uploader_user, content_hash);
alter table dflow_prod.sample_import_job add constraint sample_import_job_box_count_check CHECK ((box_count >= 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_check CHECK (((confirmation_idempotency_key IS NULL) = (confirmation_request_hash IS NULL)));
alter table dflow_prod.sample_import_job add constraint sample_import_job_content_hash_check CHECK ((btrim(content_hash) <> ''::text));
alter table dflow_prod.sample_import_job add constraint sample_import_job_error_count_check CHECK ((error_count >= 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_photo_count_check CHECK ((photo_count >= 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_row_count_check CHECK ((row_count >= 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_sample_count_check CHECK ((sample_count >= 0));
alter table dflow_prod.sample_import_job add constraint sample_import_job_state_check CHECK ((state = ANY (ARRAY['uploaded'::text, 'validated'::text, 'confirmation_pending'::text, 'confirmed'::text, 'failed'::text])));
alter table dflow_prod.sample_import_job add constraint sample_import_job_warning_count_check CHECK ((warning_count >= 0));
alter table dflow_prod.sample_import_row add constraint sample_import_row_pkey PRIMARY KEY (import_row_id);
alter table dflow_prod.sample_import_row add constraint sample_import_row_import_job_id_row_number_key UNIQUE (import_job_id, row_number);
alter table dflow_prod.sample_import_row add constraint sample_import_row_image_state_check CHECK ((image_state = ANY (ARRAY['none'::text, 'pending'::text, 'stored'::text, 'failed'::text])));
alter table dflow_prod.sample_import_row add constraint sample_import_row_json_shapes_check CHECK (((jsonb_typeof(normalized_values) = 'object'::text) AND (jsonb_typeof(validation_errors) = 'array'::text) AND (jsonb_typeof(validation_warnings) = 'array'::text)));
alter table dflow_prod.sample_import_row add constraint sample_import_row_row_number_check CHECK ((row_number > 0));
alter table dflow_prod.sample_inventory_balance add constraint sample_inventory_balance_pkey PRIMARY KEY (sample_id_fk, location_type, location_id);
alter table dflow_prod.sample_movement add constraint sample_movement_pkey PRIMARY KEY (movement_id);
alter table dflow_prod.sample_movement add constraint sample_movement_sample_id_fk_idempotency_key_key UNIQUE (sample_id_fk, idempotency_key);
alter table dflow_prod.sample_movement add constraint sample_movement_actor_role_check CHECK ((btrim(actor_role) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_actor_user_check CHECK ((btrim(actor_user) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_check CHECK (((from_location_type <> to_location_type) OR (from_location_id <> to_location_id)));
alter table dflow_prod.sample_movement add constraint sample_movement_check1 CHECK (((reversal_of_movement_id IS NULL) OR (reversal_of_movement_id <> movement_id)));
alter table dflow_prod.sample_movement add constraint sample_movement_check2 CHECK ((((discrepancy_code IS NULL) AND (discrepancy_details IS NULL)) OR (discrepancy_code IS NOT NULL)));
alter table dflow_prod.sample_movement add constraint sample_movement_discrepancy_code_check CHECK (((discrepancy_code IS NULL) OR (discrepancy_code = ANY (ARRAY['short'::text, 'over'::text, 'damaged'::text, 'wrong_item'::text, 'lost'::text, 'other'::text]))));
alter table dflow_prod.sample_movement add constraint sample_movement_discrepancy_details_check CHECK (((discrepancy_code IS NULL) OR (btrim(COALESCE(discrepancy_details, ''::text)) <> ''::text)));
alter table dflow_prod.sample_movement add constraint sample_movement_from_location_id_check CHECK ((btrim(from_location_id) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_from_location_type_check CHECK ((from_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text, 'in_transit'::text, 'terminal'::text])));
alter table dflow_prod.sample_movement add constraint sample_movement_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_lifecycle_action_check CHECK ((lifecycle_action = ANY (ARRAY['create'::text, 'pack'::text, 'ship'::text, 'receive'::text, 'retain'::text, 'repack'::text, 'deliver'::text, 'return'::text, 'dispose'::text, 'loss'::text, 'correct'::text, 'reopen'::text, 'closeout'::text, 'split_out'::text, 'split_in'::text])));
alter table dflow_prod.sample_movement add constraint sample_movement_quantity_check CHECK ((quantity > 0));
alter table dflow_prod.sample_movement add constraint sample_movement_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_to_location_id_check CHECK ((btrim(to_location_id) <> ''::text));
alter table dflow_prod.sample_movement add constraint sample_movement_to_location_type_check CHECK ((to_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text, 'in_transit'::text, 'terminal'::text])));
alter table dflow_prod.sample_movement add constraint sample_movement_transit_identity_check CHECK ((((from_location_type <> 'in_transit'::text) AND (to_location_type <> 'in_transit'::text)) OR ((shipment_line_id IS NOT NULL) AND ((box_id_fk IS NOT NULL) OR (sample_shipment_id IS NOT NULL)))));
alter table dflow_prod.sample_movement add constraint sample_movement_transit_location_identity_check CHECK ((((lifecycle_action = 'return'::text) AND (from_location_type = 'in_transit'::text) AND (to_location_type = 'in_transit'::text) AND (from_location_id <> to_location_id) AND (box_id_fk IS NULL) AND (sample_shipment_id IS NOT NULL) AND (to_location_id = (sample_shipment_id)::text)) OR (((from_location_type <> 'in_transit'::text) OR (from_location_id = COALESCE((box_id_fk)::text, (sample_shipment_id)::text))) AND ((to_location_type <> 'in_transit'::text) OR (to_location_id = COALESCE((box_id_fk)::text, (sample_shipment_id)::text))))));
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_pkey PRIMARY KEY (sample_path_revision_id);
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_sample_workflow_id_revision_key UNIQUE (sample_workflow_id, revision);
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_business_path_check CHECK ((business_path = ANY (ARRAY['factory_ningbo_nyo'::text, 'factory_ningbo_customer'::text, 'factory_nyo'::text, 'factory_customer'::text, 'china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text, 'nyo_factory'::text, 'nyo_ningbo'::text, 'ningbo_nyo'::text, 'ningbo_customer'::text])));
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_changed_by_user_check CHECK ((btrim(changed_by_user) <> ''::text));
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_reason_check CHECK ((btrim(reason) <> ''::text));
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_revision_check CHECK ((revision > 0));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_pkey PRIMARY KEY (sample_piece_lineage_id);
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_sample_id_fk_key UNIQUE (sample_id_fk);
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_split_by_user_idempotency_key_key UNIQUE (split_by_user, idempotency_key);
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_not_own_parent CHECK ((sample_id_fk <> parent_sample_id_fk));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_not_own_root CHECK ((sample_id_fk <> root_sample_id_fk));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_piece_quantity_check CHECK ((piece_quantity > 0));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_split_by_role_check CHECK ((btrim(split_by_role) <> ''::text));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_split_by_user_check CHECK ((btrim(split_by_user) <> ''::text));
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_split_reason_check CHECK ((btrim(split_reason) <> ''::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_pkey PRIMARY KEY (sample_remote_request_id);
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_idempotency_key_key UNIQUE (idempotency_key);
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_business_path_check CHECK ((business_path = ANY (ARRAY['china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text, 'ningbo_nyo'::text, 'ningbo_customer'::text, 'mixed'::text])));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_destination_id_check CHECK ((btrim(destination_id) <> ''::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_destination_type_check CHECK ((destination_type = ANY (ARRAY['office'::text, 'customer'::text])));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_request_source_check CHECK ((request_source = ANY (ARRAY['photo'::text, 'china_warehouse'::text, 'ningbo_inventory'::text, 'mixed'::text])));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_requested_by_role_check CHECK ((requested_by_role = 'nyo'::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_requested_by_user_check CHECK ((btrim(requested_by_user) <> ''::text));
alter table dflow_prod.sample_remote_request add constraint sample_remote_request_source_path_check CHECK ((((request_source = ANY (ARRAY['photo'::text, 'china_warehouse'::text])) AND (business_path = ANY (ARRAY['china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text]))) OR ((request_source = 'ningbo_inventory'::text) AND (business_path = ANY (ARRAY['ningbo_nyo'::text, 'ningbo_customer'::text]))) OR ((request_source = 'mixed'::text) AND (business_path = 'mixed'::text))));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_pkey PRIMARY KEY (sample_remote_request_history_id);
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_sample_remote_request_item_id_key UNIQUE (sample_remote_request_item_id, idempotency_key);
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_actor_role_check CHECK ((actor_role = ANY (ARRAY['nyo'::text, 'ningbo'::text, 'qc'::text])));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_actor_user_check CHECK ((btrim(actor_user) <> ''::text));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_event_payload_check CHECK ((jsonb_typeof(event_payload) = 'object'::text));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_to_state_check CHECK ((to_state = ANY (ARRAY['requested'::text, 'awaiting_ningbo'::text, 'awaiting_qc'::text, 'confirmed'::text, 'not_found'::text, 'declined'::text, 'in_transit_to_ningbo'::text, 'received'::text, 'reserved_for_next_box'::text, 'packed'::text, 'shipped_onward'::text])));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_pkey PRIMARY KEY (sample_remote_request_item_id);
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_sample_remote_request_id_idempot_key UNIQUE (sample_remote_request_id, idempotency_key);
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_business_path_check CHECK ((business_path = ANY (ARRAY['china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text, 'ningbo_nyo'::text, 'ningbo_customer'::text])));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_check CHECK (((source_type = 'photo'::text) OR (sample_id_fk IS NOT NULL)));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_check1 CHECK ((((source_type = ANY (ARRAY['photo'::text, 'china_warehouse'::text])) AND (business_path = ANY (ARRAY['china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text]))) OR ((source_type = 'ningbo_inventory'::text) AND (business_path = ANY (ARRAY['ningbo_nyo'::text, 'ningbo_customer'::text])))));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_created_by_role_check CHECK ((created_by_role = 'nyo'::text));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_created_by_user_check CHECK ((btrim(created_by_user) <> ''::text));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_current_state_check CHECK ((current_state = ANY (ARRAY['requested'::text, 'awaiting_ningbo'::text, 'awaiting_qc'::text, 'confirmed'::text, 'not_found'::text, 'declined'::text, 'in_transit_to_ningbo'::text, 'received'::text, 'reserved_for_next_box'::text, 'packed'::text, 'shipped_onward'::text])));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_source_reference_check CHECK (((source_reference IS NULL) OR (btrim(source_reference) <> ''::text)));
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_source_type_check CHECK ((source_type = ANY (ARRAY['photo'::text, 'china_warehouse'::text, 'ningbo_inventory'::text])));
alter table dflow_prod.sample_reservation add constraint sample_reservation_pkey PRIMARY KEY (sample_reservation_id);
alter table dflow_prod.sample_reservation add constraint sample_reservation_idempotency_key_key UNIQUE (idempotency_key);
alter table dflow_prod.sample_reservation add constraint sample_reservation_open_sample_id_key UNIQUE (open_sample_id);
alter table dflow_prod.sample_reservation add constraint sample_reservation_check CHECK ((((reservation_state = 'reserved'::text) AND (packed_box_id IS NULL) AND (packed_shipment_line_id IS NULL) AND (packed_at IS NULL)) OR ((reservation_state = 'packed'::text) AND (packed_box_id IS NOT NULL) AND (packed_shipment_line_id IS NOT NULL) AND (packed_at IS NOT NULL) AND (btrim(packed_by_user) <> ''::text))));
alter table dflow_prod.sample_reservation add constraint sample_reservation_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_reservation add constraint sample_reservation_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_reservation add constraint sample_reservation_reservation_state_check CHECK ((reservation_state = ANY (ARRAY['reserved'::text, 'packed'::text])));
alter table dflow_prod.sample_reservation add constraint sample_reservation_reserved_by_user_check CHECK ((btrim(reserved_by_user) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_pkey PRIMARY KEY (sample_shipment_id);
alter table dflow_prod.sample_shipment add constraint sample_shipment_idempotency_key_key UNIQUE (idempotency_key);
alter table dflow_prod.sample_shipment add constraint sample_shipment_actor_role_check CHECK ((btrim(actor_role) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_actor_user_check CHECK ((btrim(actor_user) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_check CHECK (((origin_location_type <> destination_location_type) OR (origin_location_id <> destination_location_id)));
alter table dflow_prod.sample_shipment add constraint sample_shipment_check1 CHECK (((carrier_id IS NULL) = (tracking_number IS NULL)));
alter table dflow_prod.sample_shipment add constraint sample_shipment_check2 CHECK (((state <> ALL (ARRAY['shipped'::text, 'received'::text, 'delivered_reported'::text, 'delivery_exception'::text])) OR (shipped_at IS NOT NULL)));
alter table dflow_prod.sample_shipment add constraint sample_shipment_check3 CHECK (((state <> 'received'::text) OR (received_at IS NOT NULL)));
alter table dflow_prod.sample_shipment add constraint sample_shipment_destination_location_id_check CHECK ((btrim(destination_location_id) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_destination_location_type_check CHECK ((destination_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text])));
alter table dflow_prod.sample_shipment add constraint sample_shipment_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_origin_location_id_check CHECK ((btrim(origin_location_id) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_origin_location_type_check CHECK ((origin_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text])));
alter table dflow_prod.sample_shipment add constraint sample_shipment_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_shipment add constraint sample_shipment_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'packed'::text, 'shipped'::text, 'received'::text, 'delivered_reported'::text, 'delivery_exception'::text, 'cancelled'::text])));
alter table dflow_prod.sample_shipment add constraint sample_shipment_tracking_number_check CHECK (((tracking_number IS NULL) OR (btrim(tracking_number) <> ''::text)));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_pkey PRIMARY KEY (shipment_line_id);
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_sample_id_fk_idempotency_key_key UNIQUE (sample_id_fk, idempotency_key);
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_box_or_header_check CHECK (((box_id_fk IS NOT NULL) OR (sample_shipment_id IS NOT NULL)));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_check CHECK (((origin_location_type <> destination_location_type) OR (origin_location_id <> destination_location_id)));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_destination_location_id_check CHECK ((btrim(destination_location_id) <> ''::text));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_destination_location_type_check CHECK ((destination_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text])));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_idempotency_key_check CHECK ((btrim(idempotency_key) <> ''::text));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_origin_location_id_check CHECK ((btrim(origin_location_id) <> ''::text));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_origin_location_type_check CHECK (((origin_location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text, 'warehouse'::text])) OR ((origin_location_type = 'terminal'::text) AND (origin_location_id ~~ '%\_office\_inventory'::text))));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_quantity_intended_check CHECK ((quantity_intended > 0));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_request_hash_check CHECK ((btrim(request_hash) <> ''::text));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_route_leg_check CHECK ((route_leg = ANY (ARRAY['factory_to_ningbo'::text, 'factory_to_nyc'::text, 'factory_to_customer'::text, 'ningbo_to_nyc'::text, 'ningbo_to_customer'::text, 'nyc_to_ningbo'::text, 'nyc_to_factory'::text, 'nyc_to_customer'::text, 'ningbo_to_factory'::text, 'factory_return_to_ningbo'::text, 'warehouse_to_ningbo'::text])));
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_state_check CHECK ((state = ANY (ARRAY['packed'::text, 'shipped'::text, 'partially_received'::text, 'received'::text, 'cancelled'::text])));
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_pkey PRIMARY KEY (closeout_id);
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_sample_id_fk_location_type_location_id_key UNIQUE (sample_id_fk, location_type, location_id, revision);
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_location_id_check CHECK ((btrim(location_id) <> ''::text));
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_location_type_check CHECK ((location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text])));
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_revision_check CHECK ((revision > 0));
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_state_check CHECK ((state = ANY (ARRAY['closed'::text, 'reopened'::text])));
alter table dflow_prod.sample_workflow add constraint sample_workflow_pkey PRIMARY KEY (sample_workflow_id);
alter table dflow_prod.sample_workflow add constraint sample_workflow_sample_id_fk_key UNIQUE (sample_id_fk);
alter table dflow_prod.sample_workflow add constraint sample_workflow_business_path_check CHECK ((business_path = ANY (ARRAY['factory_ningbo_nyo'::text, 'factory_ningbo_customer'::text, 'factory_nyo'::text, 'factory_customer'::text, 'china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text, 'nyo_factory'::text, 'nyo_ningbo'::text, 'ningbo_nyo'::text, 'ningbo_customer'::text])));
alter table dflow_prod.sample_workflow add constraint sample_workflow_contract_version_check CHECK ((contract_version = 'sample-tracking-release-a-v1'::text));
alter table dflow_prod.sample_workflow add constraint sample_workflow_created_by_user_check CHECK ((btrim(created_by_user) <> ''::text));
alter table dflow_prod.sample_workflow add constraint sample_workflow_valid_flow_path CHECK ((((workflow_type = 'nyo_purchased_factory_reference'::text) AND (business_path = ANY (ARRAY['nyo_ningbo'::text, 'nyo_factory'::text]))) OR ((workflow_type = 'vendor_unsolicited_offer'::text) AND (business_path = ANY (ARRAY['factory_ningbo_nyo'::text, 'factory_nyo'::text]))) OR ((workflow_type = 'nyo_factory_make_request'::text) AND (business_path = ANY (ARRAY['factory_ningbo_nyo'::text, 'factory_ningbo_customer'::text, 'factory_nyo'::text, 'factory_customer'::text]))) OR ((workflow_type = 'nyo_remote_china_inventory_request'::text) AND (business_path = ANY (ARRAY['china_warehouse_ningbo_nyo'::text, 'china_warehouse_ningbo_customer'::text, 'ningbo_nyo'::text, 'ningbo_customer'::text])))));
alter table dflow_prod.sample_workflow add constraint sample_workflow_workflow_state_check CHECK ((workflow_state = ANY (ARRAY['draft'::text, 'confirmed'::text, 'packed'::text, 'shipped'::text, 'received'::text, 'delivered_reported'::text, 'delivery_exception'::text, 'cancelled'::text])));
alter table dflow_prod.sample_workflow add constraint sample_workflow_workflow_type_check CHECK ((workflow_type = ANY (ARRAY['nyo_purchased_factory_reference'::text, 'vendor_unsolicited_offer'::text, 'nyo_factory_make_request'::text, 'nyo_remote_china_inventory_request'::text])));

-- Foreign keys ------------------------------------------------------------------

alter table dflow_prod.sample_approval_event add constraint sample_approval_event_sample_attachment_id_fkey FOREIGN KEY (sample_attachment_id) REFERENCES dflow_prod.sample_attachment(sample_attachment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_approval_event add constraint sample_approval_event_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_factory_id_fkey FOREIGN KEY (factory_id) REFERENCES dflow_prod."Factory"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_outbound_shipment_id_fkey FOREIGN KEY (outbound_shipment_id) REFERENCES dflow_prod.sample_shipment(sample_shipment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_return_shipment_id_fkey FOREIGN KEY (return_shipment_id) REFERENCES dflow_prod.sample_shipment(sample_shipment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit add constraint sample_factory_visit_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_sample_factory_visit_id_fkey FOREIGN KEY (sample_factory_visit_id) REFERENCES dflow_prod.sample_factory_visit(sample_factory_visit_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_sample_shipment_id_fkey FOREIGN KEY (sample_shipment_id) REFERENCES dflow_prod.sample_shipment(sample_shipment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_factory_visit_event add constraint sample_factory_visit_event_to_factory_id_fkey FOREIGN KEY (to_factory_id) REFERENCES dflow_prod."Factory"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_import_row add constraint sample_import_row_import_job_id_fkey FOREIGN KEY (import_job_id) REFERENCES dflow_prod.sample_import_job(import_job_id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table dflow_prod.sample_import_row add constraint sample_import_row_resulting_box_id_fkey FOREIGN KEY (resulting_box_id) REFERENCES dflow_prod.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_import_row add constraint sample_import_row_resulting_sample_id_fkey FOREIGN KEY (resulting_sample_id) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_inventory_balance add constraint sample_inventory_balance_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_movement add constraint sample_movement_box_id_fk_fkey FOREIGN KEY (box_id_fk) REFERENCES dflow_prod.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_movement add constraint sample_movement_reversal_of_movement_id_fkey FOREIGN KEY (reversal_of_movement_id) REFERENCES dflow_prod.sample_movement(movement_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_movement add constraint sample_movement_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_movement add constraint sample_movement_sample_shipment_id_fkey FOREIGN KEY (sample_shipment_id) REFERENCES dflow_prod.sample_shipment(sample_shipment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_movement add constraint sample_movement_shipment_line_id_fkey FOREIGN KEY (shipment_line_id) REFERENCES dflow_prod.sample_shipment_line(shipment_line_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_path_revision add constraint sample_path_revision_sample_workflow_id_fkey FOREIGN KEY (sample_workflow_id) REFERENCES dflow_prod.sample_workflow(sample_workflow_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_parent_sample_id_fk_fkey FOREIGN KEY (parent_sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_root_sample_id_fk_fkey FOREIGN KEY (root_sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_piece_lineage add constraint sample_piece_lineage_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_remote_request_history add constraint sample_remote_request_history_sample_remote_request_item_i_fkey FOREIGN KEY (sample_remote_request_item_id) REFERENCES dflow_prod.sample_remote_request_item(sample_remote_request_item_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_sample_remote_request_id_fkey FOREIGN KEY (sample_remote_request_id) REFERENCES dflow_prod.sample_remote_request(sample_remote_request_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_remote_request_item add constraint sample_remote_request_item_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES dflow_prod.sample_workflow(sample_workflow_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_reservation add constraint sample_reservation_packed_box_id_fkey FOREIGN KEY (packed_box_id) REFERENCES dflow_prod.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_reservation add constraint sample_reservation_packed_shipment_line_id_fkey FOREIGN KEY (packed_shipment_line_id) REFERENCES dflow_prod.sample_shipment_line(shipment_line_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_reservation add constraint sample_reservation_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_reservation add constraint sample_reservation_sample_remote_request_item_id_fkey FOREIGN KEY (sample_remote_request_item_id) REFERENCES dflow_prod.sample_remote_request_item(sample_remote_request_item_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_shipment add constraint sample_shipment_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES dflow_prod.sample_carrier(sample_carrier_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_box_id_fk_fkey FOREIGN KEY (box_id_fk) REFERENCES dflow_prod.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_shipment_line add constraint sample_shipment_line_sample_shipment_id_fkey FOREIGN KEY (sample_shipment_id) REFERENCES dflow_prod.sample_shipment(sample_shipment_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_movement_watermark_fkey FOREIGN KEY (movement_watermark) REFERENCES dflow_prod.sample_movement(movement_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_reopens_closeout_id_fkey FOREIGN KEY (reopens_closeout_id) REFERENCES dflow_prod.sample_stop_closeout(closeout_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_stop_closeout add constraint sample_stop_closeout_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_workflow add constraint sample_workflow_creation_batch_id_fkey FOREIGN KEY (creation_batch_id) REFERENCES dflow_prod.sample_creation_batch(creation_batch_id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table dflow_prod.sample_workflow add constraint sample_workflow_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES dflow_prod.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Canonical carrier reference rows (migration 20260814130000 seed, not copied data)

insert into dflow_prod.sample_carrier (carrier_code, display_name, tracking_url_template)
values
  ('ups', 'UPS', 'https://www.ups.com/track?tracknum={tracking_number}'),
  ('fedex', 'FedEx', 'https://www.fedex.com/fedextrack/?trknbr={tracking_number}'),
  ('dhl', 'DHL', 'https://www.dhl.com/global-en/home/tracking.html?tracking-id={tracking_number}'),
  ('usps', 'USPS', 'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number}');

-- Indexes -----------------------------------------------------------------------

CREATE INDEX sample_approval_event_latest_idx ON dflow_prod.sample_approval_event USING btree (sample_id_fk, approval_type, created_at DESC, sample_approval_event_id DESC);
CREATE INDEX sample_factory_visit_factory_queue_idx ON dflow_prod.sample_factory_visit USING btree (factory_id, state, visit_order);
CREATE UNIQUE INDEX sample_factory_visit_one_active_uniq ON dflow_prod.sample_factory_visit USING btree (sample_id_fk) WHERE (state = ANY (ARRAY['shipped'::text, 'at_factory'::text, 'returning'::text]));
CREATE UNIQUE INDEX sample_factory_visit_order_uniq ON dflow_prod.sample_factory_visit USING btree (sample_id_fk, visit_order) WHERE (state <> 'cancelled'::text);
CREATE INDEX sample_factory_visit_sample_state_idx ON dflow_prod.sample_factory_visit USING btree (sample_id_fk, state, visit_order);
CREATE INDEX sample_factory_visit_event_visit_idx ON dflow_prod.sample_factory_visit_event USING btree (sample_factory_visit_id, revision DESC);
CREATE INDEX sample_import_job_state_idx ON dflow_prod.sample_import_job USING btree (state, created_at);
CREATE INDEX sample_import_row_job_idx ON dflow_prod.sample_import_row USING btree (import_job_id, row_number);
CREATE INDEX sample_inventory_balance_screen_idx ON dflow_prod.sample_inventory_balance USING btree ((
CASE
    WHEN ((location_type = 'terminal'::text) AND (location_id = ANY (ARRAY['nyc_office_inventory'::text, 'ningbo_office_inventory'::text]))) THEN 'office'::text
    ELSE location_type
END), (
CASE
    WHEN (location_id = 'nyc_office_inventory'::text) THEN 'nyc'::text
    WHEN (location_id = 'ningbo_office_inventory'::text) THEN 'ningbo'::text
    ELSE location_id
END), available_since DESC, sample_id_fk DESC) WHERE (quantity > 0);
CREATE INDEX sample_movement_box_idx ON dflow_prod.sample_movement USING btree (box_id_fk, occurred_at) WHERE (box_id_fk IS NOT NULL);
CREATE INDEX sample_movement_destination_idx ON dflow_prod.sample_movement USING btree (sample_id_fk, to_location_type, to_location_id);
CREATE INDEX sample_movement_inventory_idx ON dflow_prod.sample_movement USING btree (to_location_type, to_location_id, occurred_at DESC, sample_id_fk);
CREATE INDEX sample_movement_sample_time_idx ON dflow_prod.sample_movement USING btree (sample_id_fk, occurred_at, movement_id);
CREATE INDEX sample_movement_source_idx ON dflow_prod.sample_movement USING btree (sample_id_fk, from_location_type, from_location_id);
CREATE INDEX sample_piece_lineage_parent_idx ON dflow_prod.sample_piece_lineage USING btree (parent_sample_id_fk);
CREATE INDEX sample_piece_lineage_root_idx ON dflow_prod.sample_piece_lineage USING btree (root_sample_id_fk, sample_id_fk);
CREATE UNIQUE INDEX sample_shipment_active_tracking_uniq ON dflow_prod.sample_shipment USING btree (carrier_id, lower(tracking_number)) WHERE ((carrier_id IS NOT NULL) AND (state <> 'cancelled'::text));
CREATE INDEX sample_shipment_line_box_idx ON dflow_prod.sample_shipment_line USING btree (box_id_fk, state);
CREATE INDEX sample_shipment_line_header_idx ON dflow_prod.sample_shipment_line USING btree (sample_shipment_id, shipment_line_id) WHERE (sample_shipment_id IS NOT NULL);
CREATE INDEX sample_shipment_line_sample_idx ON dflow_prod.sample_shipment_line USING btree (sample_id_fk, created_at DESC);
CREATE INDEX sample_stop_closeout_open_idx ON dflow_prod.sample_stop_closeout USING btree (sample_id_fk, location_type, location_id, state);
CREATE INDEX sample_workflow_queue_idx ON dflow_prod.sample_workflow USING btree (workflow_type, workflow_state, updated_at DESC);

-- Functions ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dflow_prod.apply_sample_factory_visit_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.event_type = 'reordered' THEN
    UPDATE dflow_prod.sample_factory_visit
    SET visit_order = NEW.to_visit_order
    WHERE sample_factory_visit_id = NEW.sample_factory_visit_id;
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'factory_changed' THEN
    UPDATE dflow_prod.sample_factory_visit
    SET factory_id = NEW.to_factory_id
    WHERE sample_factory_visit_id = NEW.sample_factory_visit_id;
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'planned' THEN
    -- The row is already 'planned'; revision 1 only records who asked for it.
    RETURN NEW;
  END IF;

  UPDATE dflow_prod.sample_factory_visit v
  SET state = NEW.to_state,
      outbound_shipment_id = CASE WHEN NEW.event_type = 'shipped'
        THEN NEW.sample_shipment_id ELSE v.outbound_shipment_id END,
      return_shipment_id = CASE WHEN NEW.event_type = 'returned'
        THEN NEW.sample_shipment_id ELSE v.return_shipment_id END,
      shipped_at = CASE WHEN NEW.event_type = 'shipped'
        THEN NEW.changed_at ELSE v.shipped_at END,
      factory_received_at = CASE WHEN NEW.event_type = 'factory_received'
        THEN NEW.changed_at ELSE v.factory_received_at END,
      returned_at = CASE WHEN NEW.event_type = 'returned'
        THEN NEW.changed_at ELSE v.returned_at END,
      closed_at = CASE WHEN NEW.to_state IN ('returned','cancelled','not_returned')
        THEN NEW.changed_at ELSE v.closed_at END
  WHERE v.sample_factory_visit_id = NEW.sample_factory_visit_id;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.apply_sample_path_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE dflow_prod.sample_workflow
  SET business_path = NEW.business_path, updated_at = NEW.changed_at
  WHERE sample_workflow_id = NEW.sample_workflow_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.pack_sample_reservation(p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint, p_origin_location_id text, p_destination_type text, p_destination_id text, p_route_leg text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)
 RETURNS dflow_prod.sample_reservation
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'dflow_prod'
AS $function$
DECLARE v_res dflow_prod.sample_reservation; v_item dflow_prod.sample_remote_request_item; v_line dflow_prod.sample_shipment_line; v_line_id bigint; v_membership_id integer;
BEGIN
  IF p_actor_role<>'ningbo' THEN RAISE EXCEPTION 'only Ningbo may pack a reservation' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_res FROM dflow_prod.sample_reservation WHERE sample_reservation_id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  IF v_res.reservation_state='packed' THEN
    SELECT * INTO v_line FROM dflow_prod.sample_shipment_line WHERE shipment_line_id=v_res.packed_shipment_line_id;
    IF v_res.packed_box_id<>p_box_id
       OR v_line.request_hash<>p_request_hash OR v_line.box_id_fk<>p_box_id
       OR v_line.idempotency_key<>p_idempotency_key
       OR v_line.sample_shipment_id IS DISTINCT FROM p_sample_shipment_id
       OR v_line.origin_location_type<>'office'
       OR v_line.origin_location_id<>p_origin_location_id
       OR v_line.destination_location_type<>p_destination_type
       OR v_line.destination_location_id<>p_destination_id
       OR v_line.route_leg<>p_route_leg THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_res;
  END IF;
  IF v_res.reservation_state<>'reserved' THEN RAISE EXCEPTION 'reservation is not open' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_item FROM dflow_prod.sample_remote_request_item WHERE sample_remote_request_item_id=v_res.sample_remote_request_item_id FOR UPDATE;
  IF v_item.current_state<>'reserved_for_next_box' THEN RAISE EXCEPTION 'request item is not reserved for next box' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM dflow_prod.sample_box WHERE box_id_pk=p_box_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'box not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_line FROM dflow_prod.sample_shipment_line WHERE sample_id_fk=v_res.sample_id_fk AND idempotency_key=p_idempotency_key;
  IF FOUND AND (v_line.request_hash<>p_request_hash OR v_line.box_id_fk<>p_box_id
     OR v_line.sample_shipment_id IS DISTINCT FROM p_sample_shipment_id
     OR v_line.origin_location_type<>'office' OR v_line.origin_location_id<>p_origin_location_id
     OR v_line.destination_location_type<>p_destination_type OR v_line.destination_location_id<>p_destination_id
     OR v_line.route_leg<>p_route_leg) THEN
    RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
  END IF;
  INSERT INTO dflow_prod.sample_shipment_item(sample_id_fk,box_id_fk,leg_type,added_date,added_user,quantity_intended)
  VALUES(v_res.sample_id_fk,p_box_id,p_route_leg,now(),p_actor_user,1)
  ON CONFLICT (sample_id_fk,box_id_fk) DO NOTHING RETURNING shipment_item_id_pk INTO v_membership_id;
  IF v_membership_id IS NULL AND NOT EXISTS (SELECT 1 FROM dflow_prod.sample_shipment_item WHERE sample_id_fk=v_res.sample_id_fk AND box_id_fk=p_box_id) THEN RAISE EXCEPTION 'box membership conflict'; END IF;
  INSERT INTO dflow_prod.sample_shipment_line(sample_id_fk,box_id_fk,quantity_intended,origin_location_type,origin_location_id,destination_location_type,destination_location_id,route_leg,state,idempotency_key,request_hash,created_by_user,created_by_role,sample_shipment_id)
  VALUES(v_res.sample_id_fk,p_box_id,1,'office',p_origin_location_id,p_destination_type,p_destination_id,p_route_leg,'packed',p_idempotency_key,p_request_hash,p_actor_user,p_actor_role,p_sample_shipment_id)
  ON CONFLICT (sample_id_fk,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key
  RETURNING shipment_line_id INTO v_line_id;
  UPDATE dflow_prod.sample_reservation SET reservation_state='packed',packed_box_id=p_box_id,packed_shipment_line_id=v_line_id,packed_by_user=p_actor_user,packed_at=now() WHERE sample_reservation_id=p_reservation_id RETURNING * INTO v_res;
  UPDATE dflow_prod.sample_remote_request_item SET current_state='packed',updated_at=now() WHERE sample_remote_request_item_id=v_item.sample_remote_request_item_id;
  INSERT INTO dflow_prod.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash)
  VALUES(v_item.sample_remote_request_item_id,'reserved_for_next_box','packed',p_actor_user,p_actor_role,p_idempotency_key,p_request_hash);
  RETURN v_res;
END;
$function$;

CREATE OR REPLACE FUNCTION dflow_prod.post_sample_approval_event(p_sample_id integer, p_approval_type text, p_approval_state text, p_qc_required boolean, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_sample_attachment_id integer DEFAULT NULL::integer, p_destination_type text DEFAULT NULL::text, p_destination_id text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS dflow_prod.sample_approval_event
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing dflow_prod.sample_approval_event;
  v_result dflow_prod.sample_approval_event;
BEGIN
  IF p_sample_id IS NULL OR p_approval_type IS NULL OR p_approval_state IS NULL
     OR p_qc_required IS NULL OR p_actor_user IS NULL OR btrim(p_actor_user) = ''
     OR p_actor_role IS NULL OR btrim(p_actor_role) = ''
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_hash IS NULL OR btrim(p_request_hash) = '' THEN
    RAISE EXCEPTION 'Required approval event arguments cannot be null or blank'
      USING ERRCODE = '22023';
  END IF;
  IF p_approval_type NOT IN ('photo','qc')
     OR p_approval_state NOT IN ('pending','approved','rejected') THEN
    RAISE EXCEPTION 'Unsupported approval type or state' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(1520, p_sample_id);
  PERFORM 1 FROM dflow_prod.sample WHERE sample_id_pk = p_sample_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sample % does not exist', p_sample_id USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_existing
  FROM dflow_prod.sample_approval_event
  WHERE sample_id_fk = p_sample_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key reused with different request'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO dflow_prod.sample_approval_event (
    sample_id_fk, sample_attachment_id, approval_type, approval_state, qc_required,
    destination_type, destination_id, reason, actor_user, actor_role,
    idempotency_key, request_hash
  ) VALUES (
    p_sample_id, p_sample_attachment_id, p_approval_type, p_approval_state, p_qc_required,
    p_destination_type, p_destination_id, p_reason, p_actor_user, p_actor_role,
    p_idempotency_key, p_request_hash
  ) RETURNING * INTO v_result;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.post_sample_movement(p_sample_id integer, p_quantity integer, p_from_type text, p_from_id text, p_to_type text, p_to_id text, p_action text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_box_id integer DEFAULT NULL::integer, p_shipment_line_id bigint DEFAULT NULL::bigint, p_actor_factory_id integer DEFAULT NULL::integer, p_discrepancy_code text DEFAULT NULL::text, p_discrepancy_details text DEFAULT NULL::text, p_reversal_of bigint DEFAULT NULL::bigint, p_from_label text DEFAULT NULL::text, p_to_label text DEFAULT NULL::text)
 RETURNS dflow_prod.sample_movement
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing dflow_prod.sample_movement;
  v_result dflow_prod.sample_movement;
  v_shipment_id bigint;
  v_line_box_id integer;
  v_line_origin_type text;
  v_line_origin_id text;
  v_line_destination_type text;
  v_line_destination_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(21450, p_sample_id);
  SELECT * INTO v_existing FROM dflow_prod.sample_movement
   WHERE sample_id_fk=p_sample_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505';
    END IF;
    RETURN v_existing;
  END IF;
  IF p_shipment_line_id IS NOT NULL THEN
    SELECT sample_shipment_id,box_id_fk,origin_location_type,origin_location_id,
           destination_location_type,destination_location_id
      INTO v_shipment_id,v_line_box_id,v_line_origin_type,v_line_origin_id,
           v_line_destination_type,v_line_destination_id
    FROM dflow_prod.sample_shipment_line
    WHERE shipment_line_id = p_shipment_line_id AND sample_id_fk = p_sample_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shipment line % does not belong to sample %', p_shipment_line_id, p_sample_id
        USING ERRCODE='23503';
    END IF;
    IF p_box_id IS DISTINCT FROM v_line_box_id THEN
      RAISE EXCEPTION 'Box % does not match shipment line % box %',p_box_id,p_shipment_line_id,v_line_box_id
        USING ERRCODE='23514';
    END IF;
    IF v_shipment_id IS NOT NULL AND p_action IN ('ship','pack') AND (
      p_from_type IS DISTINCT FROM v_line_origin_type OR p_from_id IS DISTINCT FROM v_line_origin_id
      OR p_to_type <> 'in_transit'
    ) THEN
      RAISE EXCEPTION 'Ship movement route does not match shipment line %',p_shipment_line_id
        USING ERRCODE='23514';
    END IF;
    IF v_shipment_id IS NOT NULL AND p_action = 'receive' AND (
      p_from_type <> 'in_transit' OR p_to_type IS DISTINCT FROM v_line_destination_type
      OR p_to_id IS DISTINCT FROM v_line_destination_id
    ) THEN
      RAISE EXCEPTION 'Receive movement route does not match shipment line %',p_shipment_line_id
        USING ERRCODE='23514';
    END IF;
  END IF;
  INSERT INTO dflow_prod.sample_movement(sample_id_fk,quantity,from_location_type,from_location_id,
    from_location_label,to_location_type,to_location_id,to_location_label,box_id_fk,shipment_line_id,
    sample_shipment_id,lifecycle_action,actor_user,actor_role,actor_factory_id,idempotency_key,
    request_hash,discrepancy_code,discrepancy_details,reversal_of_movement_id)
  VALUES(p_sample_id,p_quantity,p_from_type,p_from_id,p_from_label,p_to_type,p_to_id,p_to_label,
    p_box_id,p_shipment_line_id,v_shipment_id,p_action,p_actor_user,p_actor_role,p_actor_factory_id,
    p_idempotency_key,p_request_hash,p_discrepancy_code,p_discrepancy_details,p_reversal_of)
  RETURNING * INTO v_result;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.post_sample_piece_split(p_parent_sample_id integer, p_children jsonb, p_source_location_type text, p_source_location_id text, p_split_reason text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)
 RETURNS SETOF dflow_prod.sample_piece_lineage
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_parent_workflow dflow_prod.sample_workflow;
  v_parent_sample dflow_prod.sample;
  v_parent_root integer;
  v_total integer;
  v_existing dflow_prod.sample_movement;
  v_child record;
  v_child_workflow dflow_prod.sample_workflow;
  v_child_sample dflow_prod.sample;
  v_existing_count integer;
  v_expected_count integer;
BEGIN
  IF jsonb_typeof(p_children) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_children) = 0 THEN
    RAISE EXCEPTION 'Piece split requires a non-empty children array' USING ERRCODE='22023';
  END IF;
  IF btrim(COALESCE(p_source_location_type,'')) = ''
     OR btrim(COALESCE(p_source_location_id,'')) = ''
     OR btrim(COALESCE(p_split_reason,'')) = ''
     OR btrim(COALESCE(p_actor_user,'')) = ''
     OR btrim(COALESCE(p_actor_role,'')) = ''
     OR btrim(COALESCE(p_idempotency_key,'')) = ''
     OR btrim(COALESCE(p_request_hash,'')) = '' THEN
    RAISE EXCEPTION 'Piece split identifiers and audit values must be non-empty' USING ERRCODE='22023';
  END IF;
  -- Flow 1 pieces may be split only while physically held by Ningbo or a
  -- factory. Synthetic terminal sources (especially terminal/created) are
  -- balance-exempt opening legs and must never be usable to mint child custody.
  IF p_source_location_type NOT IN ('office','factory') THEN
    RAISE EXCEPTION 'Piece split source must be a physical office or factory location'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_children) c
    WHERE jsonb_typeof(c.value) <> 'object'
       OR (c.value->>'sample_id') IS NULL
       OR (c.value->>'quantity') IS NULL
       OR (c.value->>'quantity')::integer <= 0
  ) OR (SELECT count(*) FROM jsonb_array_elements(p_children)) <>
       (SELECT count(DISTINCT (value->>'sample_id')::integer) FROM jsonb_array_elements(p_children)) THEN
    RAISE EXCEPTION 'Split children must have unique sample_id values and positive quantities'
      USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(21450, sample_id)
  FROM (
    SELECT p_parent_sample_id AS sample_id
    UNION
    SELECT (value->>'sample_id')::integer FROM jsonb_array_elements(p_children)
  ) ids ORDER BY sample_id;

  SELECT * INTO v_existing FROM dflow_prod.sample_movement
  WHERE sample_id_fk=p_parent_sample_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.lifecycle_action <> 'split_out'
       OR v_existing.request_hash <> p_request_hash
       OR v_existing.from_location_type <> p_source_location_type
       OR v_existing.from_location_id <> p_source_location_id THEN
      RAISE EXCEPTION 'Idempotency key reused with different split request' USING ERRCODE='23505';
    END IF;
    SELECT count(*) INTO v_existing_count
    FROM dflow_prod.sample_piece_lineage l
    JOIN jsonb_array_elements(p_children) c
      ON l.sample_id_fk=(c.value->>'sample_id')::integer
     AND l.piece_quantity=(c.value->>'quantity')::integer
    WHERE l.parent_sample_id_fk=p_parent_sample_id
      AND l.split_by_user=p_actor_user
      AND l.request_hash=p_request_hash;
    SELECT count(*) INTO v_expected_count FROM jsonb_array_elements(p_children);
    IF v_existing_count <> v_expected_count
       OR v_existing.quantity <> (
         SELECT sum((value->>'quantity')::integer) FROM jsonb_array_elements(p_children)
       ) THEN
      RAISE EXCEPTION 'Idempotency key reused with different split children or quantity'
        USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT l.* FROM dflow_prod.sample_piece_lineage l
      WHERE l.parent_sample_id_fk=p_parent_sample_id
        AND l.split_by_user=p_actor_user AND l.request_hash=p_request_hash
      ORDER BY l.sample_id_fk;
    RETURN;
  END IF;

  SELECT * INTO v_parent_workflow FROM dflow_prod.sample_workflow
  WHERE sample_id_fk=p_parent_sample_id FOR UPDATE;
  SELECT * INTO v_parent_sample FROM dflow_prod.sample
  WHERE sample_id_pk=p_parent_sample_id FOR UPDATE;
  IF NOT FOUND OR v_parent_workflow.workflow_type IS DISTINCT FROM 'nyo_purchased_factory_reference' THEN
    RAISE EXCEPTION 'Piece splitting requires a Flow 1 parent sample' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(l.root_sample_id_fk,p_parent_sample_id) INTO v_parent_root
  FROM (SELECT 1) seed
  LEFT JOIN dflow_prod.sample_piece_lineage l ON l.sample_id_fk=p_parent_sample_id;

  v_total := 0;
  FOR v_child IN
    SELECT (value->>'sample_id')::integer AS sample_id,
           (value->>'quantity')::integer AS quantity
    FROM jsonb_array_elements(p_children) ORDER BY 1
  LOOP
    IF v_child.sample_id = p_parent_sample_id THEN
      RAISE EXCEPTION 'A sample cannot be split into itself' USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_child_workflow FROM dflow_prod.sample_workflow
      WHERE sample_id_fk=v_child.sample_id FOR UPDATE;
    SELECT * INTO v_child_sample FROM dflow_prod.sample
      WHERE sample_id_pk=v_child.sample_id FOR UPDATE;
    IF NOT FOUND OR v_child_workflow.workflow_type IS DISTINCT FROM v_parent_workflow.workflow_type
       OR v_child_workflow.business_path IS DISTINCT FROM v_parent_workflow.business_path
       OR v_child_workflow.creation_batch_id IS DISTINCT FROM v_parent_workflow.creation_batch_id
       OR (v_child_sample.item_id_fk,v_child_sample.prod_order_no_fk,v_child_sample.customer_id_fk)
          IS DISTINCT FROM
          (v_parent_sample.item_id_fk,v_parent_sample.prod_order_no_fk,v_parent_sample.customer_id_fk) THEN
      RAISE EXCEPTION 'Child sample % does not share the parent Flow 1 business identity',v_child.sample_id
        USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM dflow_prod.sample_movement WHERE sample_id_fk=v_child.sample_id)
       OR EXISTS (SELECT 1 FROM dflow_prod.sample_piece_lineage WHERE sample_id_fk=v_child.sample_id) THEN
      RAISE EXCEPTION 'Child sample % already has custody or lineage history',v_child.sample_id
        USING ERRCODE='23514';
    END IF;
    v_total := v_total + v_child.quantity;
  END LOOP;

  PERFORM dflow_prod.post_sample_movement(
    p_parent_sample_id,v_total,p_source_location_type,p_source_location_id,
    'terminal','split_identity:' || p_parent_sample_id::text,'split_out',
    p_actor_user,p_actor_role,p_idempotency_key,p_request_hash
  );

  FOR v_child IN
    SELECT (value->>'sample_id')::integer AS sample_id,
           (value->>'quantity')::integer AS quantity
    FROM jsonb_array_elements(p_children) ORDER BY 1
  LOOP
    INSERT INTO dflow_prod.sample_piece_lineage(
      sample_id_fk,parent_sample_id_fk,root_sample_id_fk,piece_quantity,
      split_reason,split_by_user,split_by_role,idempotency_key,request_hash
    ) VALUES (
      v_child.sample_id,p_parent_sample_id,v_parent_root,v_child.quantity,
      p_split_reason,p_actor_user,p_actor_role,
      p_idempotency_key || ':' || v_child.sample_id::text,p_request_hash
    );
    PERFORM dflow_prod.post_sample_movement(
      v_child.sample_id,v_child.quantity,
      'terminal','split_identity:' || p_parent_sample_id::text,
      p_source_location_type,p_source_location_id,'split_in',
      p_actor_user,p_actor_role,
      p_idempotency_key || ':' || v_child.sample_id::text,p_request_hash
    );
  END LOOP;

  RETURN QUERY SELECT l.* FROM dflow_prod.sample_piece_lineage l
    WHERE l.parent_sample_id_fk=p_parent_sample_id
      AND l.split_by_user=p_actor_user AND l.request_hash=p_request_hash
    ORDER BY l.sample_id_fk;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.post_sample_remote_request_event(p_item_id uuid, p_to_state text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_note text DEFAULT NULL::text, p_event_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS dflow_prod.sample_remote_request_history
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'dflow_prod'
AS $function$
DECLARE v_item dflow_prod.sample_remote_request_item; v_request dflow_prod.sample_remote_request; v_workflow dflow_prod.sample_workflow; v_existing dflow_prod.sample_remote_request_history; v_result dflow_prod.sample_remote_request_history;
BEGIN
  IF btrim(coalesce(p_actor_user,''))='' OR btrim(coalesce(p_idempotency_key,''))='' OR btrim(coalesce(p_request_hash,''))='' THEN
    RAISE EXCEPTION 'actor, idempotency key, and request hash are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM dflow_prod.sample_remote_request_item WHERE sample_remote_request_item_id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'remote request item not found' USING ERRCODE='P0002'; END IF;
  -- The item lock serializes same-item first writers. Re-checking the key only
  -- after the lock makes a concurrent exact replay observe the committed row.
  SELECT * INTO v_existing FROM dflow_prod.sample_remote_request_history WHERE sample_remote_request_item_id=p_item_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash OR v_existing.to_state<>p_to_state THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_request FROM dflow_prod.sample_remote_request WHERE sample_remote_request_id=v_item.sample_remote_request_id;
  SELECT * INTO v_workflow FROM dflow_prod.sample_workflow WHERE sample_workflow_id=v_item.workflow_id;
  IF v_workflow.workflow_type<>'nyo_remote_china_inventory_request' OR v_workflow.business_path<>v_item.business_path
     OR (v_item.sample_id_fk IS NOT NULL AND v_workflow.sample_id_fk<>v_item.sample_id_fk)
     OR (v_request.request_source<>'mixed' AND (v_request.request_source<>v_item.source_type OR v_request.business_path<>v_item.business_path)) THEN
    RAISE EXCEPTION 'request item source/path/workflow identity is invalid' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (v_item.current_state='requested' AND p_to_state='requested' AND p_actor_role='nyo'
      AND NOT EXISTS (SELECT 1 FROM dflow_prod.sample_remote_request_history WHERE sample_remote_request_item_id=p_item_id)) OR
    (v_item.current_state='requested' AND p_to_state=CASE WHEN v_item.source_type='ningbo_inventory' THEN 'awaiting_ningbo' ELSE 'awaiting_qc' END AND p_actor_role='nyo') OR
    (v_item.current_state='awaiting_ningbo' AND p_to_state IN ('confirmed','not_found','declined') AND p_actor_role='ningbo') OR
    (v_item.current_state='awaiting_qc' AND p_to_state IN ('confirmed','not_found','declined') AND p_actor_role='qc') OR
    (v_item.current_state='confirmed' AND v_item.source_type IN ('photo','china_warehouse') AND p_to_state='in_transit_to_ningbo' AND p_actor_role='qc') OR
    (v_item.current_state='in_transit_to_ningbo' AND p_to_state='received' AND p_actor_role='ningbo') OR
    (v_item.current_state='packed' AND p_to_state='shipped_onward' AND p_actor_role='ningbo')
  ) THEN RAISE EXCEPTION 'invalid remote request transition or role: % -> % by %',v_item.current_state,p_to_state,p_actor_role USING ERRCODE='23514'; END IF;
  UPDATE dflow_prod.sample_remote_request_item SET current_state=p_to_state,updated_at=now() WHERE sample_remote_request_item_id=p_item_id;
  INSERT INTO dflow_prod.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,note,event_payload,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.current_state,p_to_state,p_actor_user,p_actor_role,p_note,coalesce(p_event_payload,'{}'::jsonb),p_idempotency_key,p_request_hash) RETURNING * INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION dflow_prod.prevent_sample_shipment_route_drift()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_shipment_id bigint;
  v_header record;
BEGIN
  IF TG_TABLE_NAME='sample_shipment' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sample_shipment:' || OLD.sample_shipment_id::text,0));
    IF (NEW.origin_location_type,NEW.origin_location_id,
      NEW.destination_location_type,NEW.destination_location_id)
     IS DISTINCT FROM
     (OLD.origin_location_type,OLD.origin_location_id,
      OLD.destination_location_type,OLD.destination_location_id)
     AND EXISTS (
       SELECT 1 FROM dflow_prod.sample_shipment_line
       WHERE sample_shipment_id=OLD.sample_shipment_id
     ) THEN
    RAISE EXCEPTION 'Shipment route cannot change after lines are attached'
      USING ERRCODE='55000';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtextextended('sample_shipment_line:' || NEW.shipment_line_id::text,0));
    v_shipment_id := NEW.sample_shipment_id;
    IF v_shipment_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('sample_shipment:' || v_shipment_id::text,0));
      SELECT * INTO STRICT v_header FROM dflow_prod.sample_shipment
      WHERE sample_shipment_id=v_shipment_id;
      IF (NEW.origin_location_type,NEW.origin_location_id,
          NEW.destination_location_type,NEW.destination_location_id)
         IS DISTINCT FROM
         (v_header.origin_location_type,v_header.origin_location_id,
          v_header.destination_location_type,v_header.destination_location_id) THEN
        RAISE EXCEPTION 'Shipment line route must match shipment header %',v_shipment_id
          USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='UPDATE'
       AND (NEW.sample_id_fk,NEW.box_id_fk,NEW.sample_shipment_id,
            NEW.origin_location_type,NEW.origin_location_id,
            NEW.destination_location_type,NEW.destination_location_id)
           IS DISTINCT FROM
           (OLD.sample_id_fk,OLD.box_id_fk,OLD.sample_shipment_id,
            OLD.origin_location_type,OLD.origin_location_id,
            OLD.destination_location_type,OLD.destination_location_id)
       AND EXISTS (SELECT 1 FROM dflow_prod.sample_movement
                   WHERE shipment_line_id=OLD.shipment_line_id) THEN
      RAISE EXCEPTION 'Shipment line identity and route cannot change after movement'
        USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.project_sample_inventory_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'dflow_prod'
AS $function$
BEGIN
  INSERT INTO dflow_prod.sample_inventory_balance
    (sample_id_fk,location_type,location_id,quantity,available_since)
  VALUES
    (NEW.sample_id_fk,NEW.to_location_type,NEW.to_location_id,
     NEW.quantity::bigint,NEW.occurred_at)
  ON CONFLICT (sample_id_fk,location_type,location_id) DO UPDATE
  SET quantity = dflow_prod.sample_inventory_balance.quantity + EXCLUDED.quantity,
      available_since = greatest(dflow_prod.sample_inventory_balance.available_since,
                                 EXCLUDED.available_since);

  INSERT INTO dflow_prod.sample_inventory_balance
    (sample_id_fk,location_type,location_id,quantity,available_since)
  VALUES
    (NEW.sample_id_fk,NEW.from_location_type,NEW.from_location_id,
     -NEW.quantity::bigint,NEW.occurred_at)
  ON CONFLICT (sample_id_fk,location_type,location_id) DO UPDATE
  SET quantity = dflow_prod.sample_inventory_balance.quantity + EXCLUDED.quantity,
      available_since = greatest(dflow_prod.sample_inventory_balance.available_since,
                                 EXCLUDED.available_since);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.reject_sample_approval_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Sample approval events are append-only' USING ERRCODE = '55000';
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.reject_sample_factory_visit_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Sample factory visit events are append-only' USING ERRCODE = '55000';
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.reject_sample_movement_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN RAISE EXCEPTION 'Posted sample movements are immutable; use a compensating correction' USING ERRCODE='55000'; END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.reject_sample_path_revision_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Sample path revisions are append-only' USING ERRCODE = '55000';
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.require_sample_factory_visit_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT EXISTS (
    SELECT 1 FROM dflow_prod.sample_factory_visit_event e
    WHERE e.sample_factory_visit_id = NEW.sample_factory_visit_id
      AND e.to_state = NEW.state
      AND e.from_state IS NOT DISTINCT FROM OLD.state
      AND e.revision = (SELECT max(e2.revision) FROM dflow_prod.sample_factory_visit_event e2
                        WHERE e2.sample_factory_visit_id = NEW.sample_factory_visit_id)
  ) THEN
    RAISE EXCEPTION 'Insert the append-only visit event before changing the visit state'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.require_sample_path_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.business_path IS DISTINCT FROM OLD.business_path AND NOT EXISTS (
    SELECT 1 FROM dflow_prod.sample_path_revision r
    WHERE r.sample_workflow_id = NEW.sample_workflow_id
      AND r.business_path = NEW.business_path
      AND r.revision = (SELECT max(r2.revision) FROM dflow_prod.sample_path_revision r2
                        WHERE r2.sample_workflow_id = NEW.sample_workflow_id)
  ) THEN
    RAISE EXCEPTION 'Insert the append-only path revision before changing the workflow path'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.reserve_sample_remote_request_item(p_item_id uuid, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)
 RETURNS dflow_prod.sample_reservation
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'dflow_prod'
AS $function$
DECLARE v_item dflow_prod.sample_remote_request_item; v_existing dflow_prod.sample_reservation; v_result dflow_prod.sample_reservation;
BEGIN
  IF p_actor_role<>'ningbo' THEN RAISE EXCEPTION 'only Ningbo may reserve a confirmed item' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM dflow_prod.sample_remote_request_item WHERE sample_remote_request_item_id=p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.sample_id_fk IS NULL THEN RAISE EXCEPTION 'reservable request item not found' USING ERRCODE='P0002'; END IF;
  -- Serialize first writers on the item, then re-check the operation key so a
  -- concurrent exact replay deterministically returns the committed reservation.
  SELECT * INTO v_existing FROM dflow_prod.sample_reservation WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_existing.request_hash<>p_request_hash OR v_existing.sample_remote_request_item_id<>p_item_id THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF; RETURN v_existing; END IF;
  IF NOT ((v_item.source_type='ningbo_inventory' AND v_item.current_state='confirmed') OR (v_item.source_type IN ('photo','china_warehouse') AND v_item.current_state='received')) THEN
    RAISE EXCEPTION 'item is not physically confirmed in Ningbo' USING ERRCODE='23514';
  END IF;
  INSERT INTO dflow_prod.sample_reservation(sample_remote_request_item_id,sample_id_fk,reserved_by_user,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.sample_id_fk,p_actor_user,p_idempotency_key,p_request_hash) RETURNING * INTO v_result;
  UPDATE dflow_prod.sample_remote_request_item SET current_state='reserved_for_next_box',updated_at=now() WHERE sample_remote_request_item_id=p_item_id;
  INSERT INTO dflow_prod.sample_remote_request_history(sample_remote_request_item_id,from_state,to_state,actor_user,actor_role,idempotency_key,request_hash)
  VALUES(p_item_id,v_item.current_state,'reserved_for_next_box',p_actor_user,p_actor_role,p_idempotency_key,p_request_hash);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION dflow_prod.sample_movement_auto_office_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
-- Preserve the canonical function body's CRLF bytes across Git LF checkouts.
AS E'\r
DECLARE\r
  v_remaining bigint;\r
  v_to_id text;\r
  v_to_label text;\r
  v_idem text;\r
BEGIN\r
  -- Only onward shipments out of an office (not movements into terminal).\r
  IF NEW.from_location_type IS DISTINCT FROM ''office'' THEN\r
    RETURN NEW;\r
  END IF;\r
  IF NEW.to_location_type IS DISTINCT FROM ''in_transit''\r
     AND NEW.to_location_type IS DISTINCT FROM ''customer'' THEN\r
    RETURN NEW;\r
  END IF;\r
\r
  -- Remaining office balance AFTER the inserted onward movement is applied.\r
  SELECT COALESCE(b.quantity, 0)\r
  INTO v_remaining\r
  FROM dflow_prod.sample_balance_by_location b\r
  WHERE b.sample_id_fk = NEW.sample_id_fk\r
    AND b.location_type = ''office''\r
    AND b.location_id = NEW.from_location_id;\r
\r
  v_remaining := COALESCE(v_remaining, 0);\r
\r
  IF v_remaining <= 0 THEN\r
    RETURN NEW;\r
  END IF;\r
\r
  -- Per-office inventory bucket (terminal disposition, not a deletion).\r
  v_to_id := NEW.from_location_id || ''_office_inventory'';\r
  v_to_label := CASE lower(NEW.from_location_id)\r
    WHEN ''ningbo'' THEN ''Ningbo Ofc Inventory''\r
    WHEN ''nyc'' THEN ''NY Ofc Inventory''\r
    WHEN ''ny'' THEN ''NY Ofc Inventory''\r
    WHEN ''new_york'' THEN ''NY Ofc Inventory''\r
    ELSE initcap(replace(NEW.from_location_id, ''_'', '' '')) || '' Ofc Inventory''\r
  END;\r
\r
  -- Deterministic unique idempotency per source movement\r
  -- (UNIQUE (sample_id_fk, idempotency_key) on live table).\r
  v_idem := ''auto-ofc-inv-'' || NEW.movement_id::text;\r
\r
  -- Direct INSERT (not post_sample_movement) so we control every CHECK-facing\r
  -- column. sample_movement_guard still runs as BEFORE INSERT on this row.\r
  -- box_id_fk / shipment_line_id stay NULL: this is not a transit movement\r
  -- (live CHECK only requires them when either side is in_transit).\r
  -- lifecycle_action ''retain'' is in the live CHECK list — do not invent values.\r
  INSERT INTO dflow_prod.sample_movement (\r
    sample_id_fk,\r
    quantity,\r
    from_location_type,\r
    from_location_id,\r
    from_location_label,\r
    to_location_type,\r
    to_location_id,\r
    to_location_label,\r
    box_id_fk,\r
    shipment_line_id,\r
    lifecycle_action,\r
    actor_user,\r
    actor_role,\r
    actor_factory_id,\r
    idempotency_key,\r
    request_hash\r
  ) VALUES (\r
    NEW.sample_id_fk,\r
    v_remaining::integer,\r
    ''office'',\r
    NEW.from_location_id,\r
    NEW.from_location_label,\r
    ''terminal'',\r
    v_to_id,\r
    v_to_label,\r
    NULL,\r
    NULL,\r
    ''retain'',\r
    NEW.actor_user,\r
    NEW.actor_role,\r
    NEW.actor_factory_id,\r
    v_idem,\r
    v_idem\r
  );\r
\r
  RETURN NEW;\r
END;\r
';

CREATE OR REPLACE FUNCTION dflow_prod.sample_movement_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_balance bigint; v_original_sample integer;
BEGIN
  PERFORM pg_advisory_xact_lock(21450, NEW.sample_id_fk);
  IF NEW.reversal_of_movement_id IS NOT NULL THEN
    SELECT sample_id_fk INTO v_original_sample
    FROM dflow_prod.sample_movement WHERE movement_id=NEW.reversal_of_movement_id;
    IF v_original_sample IS NULL OR v_original_sample <> NEW.sample_id_fk THEN
      RAISE EXCEPTION 'Correction must reference an existing movement for the same sample'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT (
    NEW.from_location_type='terminal'
    AND (
      NEW.from_location_id IN ('created','receipt_overage','reconciled_opening')
      OR (NEW.lifecycle_action='split_in' AND NEW.from_location_id LIKE 'split_identity:%')
    )
  ) THEN
    SELECT COALESCE(sum(CASE WHEN to_location_type=NEW.from_location_type
                                  AND to_location_id=NEW.from_location_id
                             THEN quantity ELSE 0 END),0)
         - COALESCE(sum(CASE WHEN from_location_type=NEW.from_location_type
                                  AND from_location_id=NEW.from_location_id
                             THEN quantity ELSE 0 END),0)
      INTO v_balance FROM dflow_prod.sample_movement WHERE sample_id_fk=NEW.sample_id_fk;
    IF v_balance < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient sample balance: available %, requested %',v_balance,NEW.quantity
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.touch_sample_factory_visit_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_approval_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current dflow_prod.sample_approval_event;
  v_photo dflow_prod.sample_approval_event;
BEGIN
  PERFORM pg_advisory_xact_lock(1520, NEW.sample_id_fk);

  IF NEW.sample_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dflow_prod.sample_attachment
    WHERE sample_attachment_id = NEW.sample_attachment_id
      AND sample_id_fk = NEW.sample_id_fk
  ) THEN
    RAISE EXCEPTION 'Attachment % does not belong to sample %',
      NEW.sample_attachment_id, NEW.sample_id_fk USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_current
  FROM dflow_prod.sample_approval_event
  WHERE sample_id_fk = NEW.sample_id_fk AND approval_type = NEW.approval_type
  ORDER BY created_at DESC, sample_approval_event_id DESC
  LIMIT 1;

  IF NOT FOUND AND NEW.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'The first % approval event must be pending', NEW.approval_type
      USING ERRCODE = '23514';
  ELSIF FOUND AND NOT (
    (v_current.approval_state = 'pending' AND NEW.approval_state IN ('approved','rejected')) OR
    (v_current.approval_state = 'rejected' AND NEW.approval_state = 'pending')
  ) THEN
    RAISE EXCEPTION 'Invalid % approval transition from % to %',
      NEW.approval_type, v_current.approval_state, NEW.approval_state USING ERRCODE = '23514';
  END IF;

  IF FOUND AND NEW.qc_required IS DISTINCT FROM v_current.qc_required
     AND NOT (
       NEW.approval_type = 'photo'
       AND v_current.approval_state = 'pending'
       AND NEW.approval_state = 'approved'
       AND NOT v_current.qc_required
       AND NEW.qc_required
     ) THEN
    RAISE EXCEPTION 'QC requirement cannot change within an approval history'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approval_type = 'qc' THEN
    SELECT * INTO v_photo
    FROM dflow_prod.sample_approval_event
    WHERE sample_id_fk = NEW.sample_id_fk AND approval_type = 'photo'
    ORDER BY created_at DESC, sample_approval_event_id DESC
    LIMIT 1;
    IF NOT FOUND OR v_photo.approval_state <> 'approved' OR NOT v_photo.qc_required THEN
      RAISE EXCEPTION 'QC decisions require a currently approved photo with QC required'
        USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.qc_required THEN
      RAISE EXCEPTION 'QC events must carry qc_required=true' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_factory_visit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_workflow_type text;
BEGIN
  SELECT workflow_type INTO v_workflow_type
  FROM dflow_prod.sample_workflow
  WHERE sample_id_fk = NEW.sample_id_fk;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Sample % has no workflow row; factory visits are Flow 1 only', NEW.sample_id_fk
      USING ERRCODE = '23514';
  END IF;

  IF v_workflow_type <> 'nyo_purchased_factory_reference' THEN
    RAISE EXCEPTION
      'Factory visits require workflow_type nyo_purchased_factory_reference, sample % is %',
      NEW.sample_id_fk, v_workflow_type
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_factory_visit_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_state text;
  v_order integer;
  v_factory integer;
  v_expected_revision integer;
BEGIN
  SELECT state, visit_order, factory_id INTO v_state, v_order, v_factory
  FROM dflow_prod.sample_factory_visit
  WHERE sample_factory_visit_id = NEW.sample_factory_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sample factory visit % does not exist', NEW.sample_factory_visit_id
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(max(revision),0) + 1 INTO v_expected_revision
  FROM dflow_prod.sample_factory_visit_event
  WHERE sample_factory_visit_id = NEW.sample_factory_visit_id;

  IF NEW.revision <> v_expected_revision THEN
    RAISE EXCEPTION 'Visit event revision must be %, received %',
      v_expected_revision, NEW.revision USING ERRCODE = '23514';
  END IF;

  IF v_expected_revision = 1 AND NEW.event_type <> 'planned' THEN
    RAISE EXCEPTION 'The first event of a factory visit must be planned, received %',
      NEW.event_type USING ERRCODE = '23514';
  END IF;

  IF NEW.from_state IS DISTINCT FROM v_state THEN
    RAISE EXCEPTION 'Visit event from_state % does not match the current state %',
      COALESCE(NEW.from_state,'<null>'), v_state USING ERRCODE = '23514';
  END IF;

  -- Each event type declares the state it moves to.
  IF NEW.to_state IS DISTINCT FROM (CASE NEW.event_type
      WHEN 'planned' THEN 'planned'
      WHEN 'shipped' THEN 'shipped'
      WHEN 'factory_received' THEN 'at_factory'
      WHEN 'return_started' THEN 'returning'
      WHEN 'returned' THEN 'returned'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'marked_not_returned' THEN 'not_returned'
      ELSE NULL END) THEN
    RAISE EXCEPTION 'Visit event % may not declare to_state %',
      NEW.event_type, COALESCE(NEW.to_state,'<null>') USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'planned' THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Only the first event may be planned' USING ERRCODE = '23514';
    END IF;

  ELSIF NEW.event_type IN ('reordered','factory_changed') THEN
    -- Intent may only be edited while the visit has not yet shipped.
    IF v_state <> 'planned' THEN
      RAISE EXCEPTION 'A % visit cannot be %', v_state,
        CASE NEW.event_type WHEN 'reordered' THEN 'reordered' ELSE 'redirected' END
        USING ERRCODE = '23514';
    END IF;
    IF NEW.event_type = 'reordered' THEN
      IF NEW.to_visit_order IS NULL OR NEW.to_visit_order <= 0 THEN
        RAISE EXCEPTION 'A reordered event must carry a positive to_visit_order'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.from_visit_order IS DISTINCT FROM v_order THEN
        RAISE EXCEPTION 'Visit event from_visit_order % does not match the current order %',
          COALESCE(NEW.from_visit_order,-1), v_order USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW.to_factory_id IS NULL THEN
        RAISE EXCEPTION 'A factory_changed event must carry a to_factory_id'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.from_factory_id IS DISTINCT FROM v_factory THEN
        RAISE EXCEPTION 'Visit event from_factory_id % does not match the current factory %',
          COALESCE(NEW.from_factory_id,-1), v_factory USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSE
    -- The legal state graph. shipped -> returned and at_factory -> returned
    -- are DIRECT edges on purpose: factory check-in is optional in Flow 1 and
    -- a Ningbo receipt must always be able to close the visit in one command.
    IF NOT (
      (v_state = 'planned'    AND NEW.to_state IN ('shipped','cancelled')) OR
      (v_state = 'shipped'    AND NEW.to_state IN ('at_factory','returning','returned','not_returned')) OR
      (v_state = 'at_factory' AND NEW.to_state IN ('returning','returned','not_returned')) OR
      (v_state = 'returning'  AND NEW.to_state IN ('returned','not_returned'))
    ) THEN
      RAISE EXCEPTION 'Factory visit cannot move from % to %', v_state, NEW.to_state
        USING ERRCODE = '23514';
    END IF;

    IF NEW.event_type IN ('shipped','returned') AND NEW.sample_shipment_id IS NULL THEN
      RAISE EXCEPTION 'A % event must carry its sample_shipment_id', NEW.event_type
        USING ERRCODE = '23514';
    END IF;

    -- A piece a factory never returned is gone. It may not be shipped again.
    IF NEW.event_type = 'shipped' AND EXISTS (
      SELECT 1 FROM dflow_prod.sample_factory_visit prior
      WHERE prior.sample_id_fk = (SELECT sample_id_fk FROM dflow_prod.sample_factory_visit
                                  WHERE sample_factory_visit_id = NEW.sample_factory_visit_id)
        AND prior.state = 'not_returned'
    ) THEN
      RAISE EXCEPTION 'This piece was never returned by a factory and cannot be shipped again'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_movement_shipment_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_line dflow_prod.sample_shipment_line;
  v_visit dflow_prod.sample_factory_visit;
  v_outbound_line dflow_prod.sample_shipment_line;
  v_workflow_type text;
BEGIN
  IF NEW.shipment_line_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sample_shipment_line:' || NEW.shipment_line_id::text,0));
  SELECT * INTO v_line FROM dflow_prod.sample_shipment_line
  WHERE shipment_line_id=NEW.shipment_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment line % does not exist',NEW.shipment_line_id USING ERRCODE='23503';
  END IF;
  IF NEW.sample_id_fk IS DISTINCT FROM v_line.sample_id_fk
     OR NEW.box_id_fk IS DISTINCT FROM v_line.box_id_fk
     OR NEW.sample_shipment_id IS DISTINCT FROM v_line.sample_shipment_id THEN
    RAISE EXCEPTION 'Movement identity does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL
     AND NEW.lifecycle_action = 'return'
     AND NEW.from_location_type = 'in_transit'
     AND NEW.to_location_type = 'in_transit' THEN
    SELECT v.* INTO v_visit
    FROM dflow_prod.sample_factory_visit v
    WHERE v.sample_id_fk = NEW.sample_id_fk
      AND v.state = 'shipped'
      AND v.outbound_shipment_id::text = NEW.from_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transit return has no matching shipped factory visit for sample %',NEW.sample_id_fk
        USING ERRCODE='23514';
    END IF;

    SELECT workflow_type INTO v_workflow_type
    FROM dflow_prod.sample_workflow WHERE sample_id_fk=NEW.sample_id_fk;
    IF v_workflow_type IS DISTINCT FROM 'nyo_purchased_factory_reference' THEN
      RAISE EXCEPTION 'Transit return requires a Flow 1 sample' USING ERRCODE='23514';
    END IF;

    SELECT * INTO v_outbound_line
    FROM dflow_prod.sample_shipment_line
    WHERE sample_shipment_id=v_visit.outbound_shipment_id
      AND sample_id_fk=NEW.sample_id_fk;
    IF NOT FOUND
       OR v_outbound_line.destination_location_type IS DISTINCT FROM 'factory'
       OR v_outbound_line.destination_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.origin_location_type IS DISTINCT FROM 'factory'
       OR v_line.origin_location_id IS DISTINCT FROM v_visit.factory_id::text
       OR v_line.destination_location_type IS DISTINCT FROM 'office'
       OR v_line.destination_location_id IS DISTINCT FROM 'Ningbo'
       OR NEW.to_location_id IS DISTINCT FROM v_line.sample_shipment_id::text
       OR NEW.from_location_id = NEW.to_location_id THEN
      RAISE EXCEPTION 'Transit return shipment does not match factory visit %',v_visit.sample_factory_visit_id
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_line.sample_shipment_id IS NOT NULL AND NOT (
    (NEW.from_location_type IS NOT DISTINCT FROM v_line.origin_location_type
      AND NEW.from_location_id IS NOT DISTINCT FROM v_line.origin_location_id
      AND NEW.to_location_type='in_transit')
    OR
    (NEW.from_location_type='in_transit'
      AND NEW.to_location_type IS NOT DISTINCT FROM v_line.destination_location_type
      AND NEW.to_location_id IS NOT DISTINCT FROM v_line.destination_location_id)
  ) THEN
    RAISE EXCEPTION 'Movement route does not match shipment line %',NEW.shipment_line_id
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_path_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_workflow_type text;
  v_expected_revision integer;
BEGIN
  SELECT workflow_type INTO v_workflow_type
  FROM dflow_prod.sample_workflow
  WHERE sample_workflow_id = NEW.sample_workflow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sample workflow % does not exist', NEW.sample_workflow_id USING ERRCODE = '23503';
  END IF;
  IF NOT (
    (v_workflow_type = 'nyo_purchased_factory_reference' AND NEW.business_path IN ('nyo_ningbo','nyo_factory')) OR
    (v_workflow_type = 'vendor_unsolicited_offer' AND NEW.business_path IN ('factory_ningbo_nyo','factory_nyo')) OR
    (v_workflow_type = 'nyo_factory_make_request' AND NEW.business_path IN (
      'factory_ningbo_nyo','factory_ningbo_customer','factory_nyo','factory_customer'
    )) OR
    (v_workflow_type = 'nyo_remote_china_inventory_request' AND NEW.business_path IN (
      'china_warehouse_ningbo_nyo','china_warehouse_ningbo_customer','ningbo_nyo','ningbo_customer'
    ))
  ) THEN
    RAISE EXCEPTION 'Path % is invalid for workflow type %', NEW.business_path, v_workflow_type
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(max(revision),0) + 1 INTO v_expected_revision
  FROM dflow_prod.sample_path_revision WHERE sample_workflow_id = NEW.sample_workflow_id;
  IF NEW.revision <> v_expected_revision THEN
    RAISE EXCEPTION 'Path revision must be %, received %', v_expected_revision, NEW.revision
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_piece_lineage()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_parent_root integer;
BEGIN
  SELECT root_sample_id_fk INTO v_parent_root
  FROM dflow_prod.sample_piece_lineage
  WHERE sample_id_fk = NEW.parent_sample_id_fk;

  IF NOT FOUND THEN
    -- The parent is itself a root: it has no lineage row of its own.
    v_parent_root := NEW.parent_sample_id_fk;
  END IF;

  IF NEW.root_sample_id_fk <> v_parent_root THEN
    RAISE EXCEPTION
      'Piece lineage root % disagrees with the root % of parent sample %',
      NEW.root_sample_id_fk, v_parent_root, NEW.parent_sample_id_fk
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION dflow_prod.validate_sample_shipment_line_header()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_header dflow_prod.sample_shipment;
BEGIN
  IF NEW.sample_shipment_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_header FROM dflow_prod.sample_shipment WHERE sample_shipment_id=NEW.sample_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment header % does not exist',NEW.sample_shipment_id USING ERRCODE='23503';
  END IF;
  IF NEW.origin_location_type IS DISTINCT FROM v_header.origin_location_type
     OR NEW.origin_location_id IS DISTINCT FROM v_header.origin_location_id
     OR NEW.destination_location_type IS DISTINCT FROM v_header.destination_location_type
     OR NEW.destination_location_id IS DISTINCT FROM v_header.destination_location_id THEN
    RAISE EXCEPTION 'Shipment line route must match shipment header %',NEW.sample_shipment_id
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $function$;

-- Views (dependency order) -------------------------------------------------------

create view dflow_prod.sample_approval_current with (security_invoker=true) as
 SELECT DISTINCT ON (sample_id_fk, approval_type) sample_approval_event_id,
    sample_id_fk,
    sample_attachment_id,
    approval_type,
    approval_state,
    qc_required,
    destination_type,
    destination_id,
    reason,
    actor_user,
    actor_role,
    idempotency_key,
    request_hash,
    created_at
   FROM dflow_prod.sample_approval_event
  ORDER BY sample_id_fk, approval_type, created_at DESC, sample_approval_event_id DESC;

create view dflow_prod.sample_balance_by_location as
 WITH legs AS (
         SELECT sample_movement.sample_id_fk,
            sample_movement.to_location_type AS location_type,
            sample_movement.to_location_id AS location_id,
            sample_movement.to_location_label AS location_label,
            sample_movement.quantity AS delta
           FROM dflow_prod.sample_movement
        UNION ALL
         SELECT sample_movement.sample_id_fk,
            sample_movement.from_location_type,
            sample_movement.from_location_id,
            sample_movement.from_location_label,
            (- sample_movement.quantity)
           FROM dflow_prod.sample_movement
        )
 SELECT sample_id_fk,
    location_type,
    location_id,
    max(location_label) AS location_label,
    sum(delta) AS quantity
   FROM legs
  GROUP BY sample_id_fk, location_type, location_id
 HAVING (sum(delta) <> 0);

create view dflow_prod.sample_open_stop_work as
 SELECT sample_id_fk,
    location_type,
    location_id,
    location_label,
    quantity
   FROM dflow_prod.sample_balance_by_location b
  WHERE ((location_type = ANY (ARRAY['factory'::text, 'office'::text, 'customer'::text])) AND (quantity > 0) AND (NOT (EXISTS ( SELECT 1
           FROM dflow_prod.sample_stop_closeout c
          WHERE ((c.sample_id_fk = b.sample_id_fk) AND (c.location_type = b.location_type) AND (c.location_id = b.location_id) AND (c.state = 'closed'::text) AND (c.movement_watermark >= COALESCE(( SELECT max(m.movement_id) AS max
                   FROM dflow_prod.sample_movement m
                  WHERE (m.sample_id_fk = b.sample_id_fk)), (0)::bigint)))))));

create view dflow_prod.sample_global_status as
 SELECT sample_id_pk,
        CASE
            WHEN (quantity_migration_state = 'unknown'::text) THEN 'legacy_unknown'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM dflow_prod.sample_movement m
              WHERE (m.sample_id_fk = s.sample_id_pk)))) THEN 'uninitialized'::text
            WHEN (EXISTS ( SELECT 1
               FROM dflow_prod.sample_balance_by_location b
              WHERE ((b.sample_id_fk = s.sample_id_pk) AND (b.location_type = 'in_transit'::text) AND (b.quantity > 0)))) THEN 'in_transit'::text
            WHEN (EXISTS ( SELECT 1
               FROM dflow_prod.sample_balance_by_location b
              WHERE ((b.sample_id_fk = s.sample_id_pk) AND (b.quantity > 0) AND (b.location_type = ANY (ARRAY['factory'::text, 'office'::text]))))) THEN 'outstanding'::text
            WHEN (EXISTS ( SELECT 1
               FROM dflow_prod.sample_open_stop_work o
              WHERE ((o.sample_id_fk = s.sample_id_pk) AND (o.location_type = ANY (ARRAY['factory'::text, 'office'::text]))))) THEN 'outstanding'::text
            WHEN (EXISTS ( SELECT 1
               FROM dflow_prod.sample_movement m
              WHERE ((m.sample_id_fk = s.sample_id_pk) AND (m.lifecycle_action = 'split_out'::text)))) THEN 'split'::text
            ELSE 'complete'::text
        END AS derived_status
   FROM dflow_prod.sample s;

create view dflow_prod.sample_in_transit as
 SELECT b.sample_id_fk,
    (b.location_id)::integer AS box_id_pk,
    b.quantity,
    bx.box_label,
    bx.tracking_number,
    bx.direction,
    bx.shipped_date
   FROM (dflow_prod.sample_balance_by_location b
     JOIN dflow_prod.sample_box bx ON ((bx.box_id_pk = (b.location_id)::integer)))
  WHERE ((b.location_type = 'in_transit'::text) AND (b.quantity > 0) AND (b.location_id ~ '^[0-9]+$'::text));

create view dflow_prod.sample_inventory as
 SELECT sample_id_fk,
    location_type,
        CASE
            WHEN ((location_type = 'terminal'::text) AND (location_id = ANY (ARRAY['nyc_office_inventory'::text, 'ningbo_office_inventory'::text]))) THEN 'office'::text
            ELSE location_type
        END AS product_location_type,
        CASE
            WHEN (location_id = 'nyc_office_inventory'::text) THEN 'nyc'::text
            WHEN (location_id = 'ningbo_office_inventory'::text) THEN 'ningbo'::text
            ELSE location_id
        END AS product_location_id,
    quantity,
    available_since,
    (EXISTS ( SELECT 1
           FROM dflow_prod.sample_shipment_item si
          WHERE ((si.sample_id_fk = b.sample_id_fk) AND (si.box_id_fk IS NOT NULL)))) AS is_boxed,
    (location_type = 'in_transit'::text) AS is_in_transit,
    ((quantity > 0) AND (location_type <> 'in_transit'::text)) AS is_eligible,
        CASE
            WHEN (quantity <= 0) THEN 'no_balance'::text
            WHEN (location_type = 'in_transit'::text) THEN 'in_transit'::text
            ELSE NULL::text
        END AS ineligibility_reason
   FROM dflow_prod.sample_inventory_balance b
  WHERE (quantity > 0);

create view dflow_prod.sample_receipt_discrepancy as
 SELECT sl.shipment_line_id,
    sl.sample_id_fk,
    sl.box_id_fk,
    sl.quantity_intended,
    COALESCE(sum(m.quantity) FILTER (WHERE (m.lifecycle_action = 'receive'::text)), (0)::bigint) AS quantity_received,
    (sl.quantity_intended - COALESCE(sum(m.quantity) FILTER (WHERE (m.lifecycle_action = 'receive'::text)), (0)::bigint)) AS variance
   FROM (dflow_prod.sample_shipment_line sl
     LEFT JOIN dflow_prod.sample_movement m ON ((m.shipment_line_id = sl.shipment_line_id)))
  GROUP BY sl.shipment_line_id;

create view dflow_prod.sample_visit_plan as
 SELECT v.sample_factory_visit_id,
    v.sample_id_fk,
    COALESCE(l.root_sample_id_fk, v.sample_id_fk) AS root_sample_id_fk,
    l.parent_sample_id_fk,
    v.factory_id,
    f.factory_name,
    f.factory_nickname,
    v.visit_order,
    v.provenance,
    v.state,
    v.shipped_at,
    v.factory_received_at,
    v.returned_at,
    v.closed_at,
    v.outbound_shipment_id,
    ob.tracking_number AS outbound_tracking_number,
    ob.carrier_id AS outbound_carrier_id,
    v.return_shipment_id,
    rt.tracking_number AS return_tracking_number,
    rt.carrier_id AS return_carrier_id,
    v.requested_by_user,
    v.requested_by_role,
    v.created_at,
    v.updated_at,
    piece.piece_count,
    roll.active_visit_id,
    roll.completed_visit_count,
    roll.remaining_visit_count,
    custody.to_location_type AS current_custody_type,
    custody.to_location_id AS current_custody_id,
    custody.occurred_at AS current_custody_since
   FROM (((((((dflow_prod.sample_factory_visit v
     LEFT JOIN dflow_prod.sample_piece_lineage l ON ((l.sample_id_fk = v.sample_id_fk)))
     LEFT JOIN dflow_prod."Factory" f ON ((f.id = v.factory_id)))
     LEFT JOIN dflow_prod.sample_shipment ob ON ((ob.sample_shipment_id = v.outbound_shipment_id)))
     LEFT JOIN dflow_prod.sample_shipment rt ON ((rt.sample_shipment_id = v.return_shipment_id)))
     LEFT JOIN LATERAL ( SELECT max(s.sample_factory_visit_id) FILTER (WHERE (s.state = ANY (ARRAY['shipped'::text, 'at_factory'::text, 'returning'::text]))) AS active_visit_id,
            count(*) FILTER (WHERE (s.state = 'returned'::text)) AS completed_visit_count,
            count(*) FILTER (WHERE (s.state = 'planned'::text)) AS remaining_visit_count
           FROM dflow_prod.sample_factory_visit s
          WHERE (s.sample_id_fk = v.sample_id_fk)) roll ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*) + 1) AS piece_count
           FROM dflow_prod.sample_piece_lineage p
          WHERE (p.root_sample_id_fk = COALESCE(l.root_sample_id_fk, v.sample_id_fk))) piece ON (true))
     LEFT JOIN LATERAL ( SELECT m.to_location_type,
            m.to_location_id,
            m.occurred_at
           FROM dflow_prod.sample_movement m
          WHERE (m.sample_id_fk = v.sample_id_fk)
          ORDER BY m.occurred_at DESC, m.movement_id DESC
         LIMIT 1) custody ON (true));

-- Triggers ----------------------------------------------------------------------

CREATE TRIGGER sample_approval_event_immutable BEFORE DELETE OR UPDATE ON dflow_prod.sample_approval_event FOR EACH ROW EXECUTE FUNCTION dflow_prod.reject_sample_approval_event_mutation();
CREATE TRIGGER sample_approval_event_validate BEFORE INSERT ON dflow_prod.sample_approval_event FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_approval_event();
CREATE TRIGGER sample_factory_visit_event_required BEFORE UPDATE OF state ON dflow_prod.sample_factory_visit FOR EACH ROW EXECUTE FUNCTION dflow_prod.require_sample_factory_visit_event();
CREATE TRIGGER sample_factory_visit_touch BEFORE UPDATE ON dflow_prod.sample_factory_visit FOR EACH ROW EXECUTE FUNCTION dflow_prod.touch_sample_factory_visit_updated_at();
CREATE TRIGGER sample_factory_visit_validate BEFORE INSERT OR UPDATE OF sample_id_fk ON dflow_prod.sample_factory_visit FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_factory_visit();
CREATE TRIGGER sample_factory_visit_event_apply AFTER INSERT ON dflow_prod.sample_factory_visit_event FOR EACH ROW EXECUTE FUNCTION dflow_prod.apply_sample_factory_visit_event();
CREATE TRIGGER sample_factory_visit_event_immutable BEFORE DELETE OR UPDATE ON dflow_prod.sample_factory_visit_event FOR EACH ROW EXECUTE FUNCTION dflow_prod.reject_sample_factory_visit_event_mutation();
CREATE TRIGGER sample_factory_visit_event_validate BEFORE INSERT ON dflow_prod.sample_factory_visit_event FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_factory_visit_event();
CREATE TRIGGER sample_movement_auto_office_inventory_trigger AFTER INSERT ON dflow_prod.sample_movement FOR EACH ROW EXECUTE FUNCTION dflow_prod.sample_movement_auto_office_inventory();
CREATE TRIGGER sample_movement_guard_trigger BEFORE INSERT ON dflow_prod.sample_movement FOR EACH ROW EXECUTE FUNCTION dflow_prod.sample_movement_guard();
CREATE TRIGGER sample_movement_immutable_trigger BEFORE DELETE OR UPDATE ON dflow_prod.sample_movement FOR EACH ROW EXECUTE FUNCTION dflow_prod.reject_sample_movement_mutation();
CREATE TRIGGER sample_movement_project_inventory AFTER INSERT ON dflow_prod.sample_movement FOR EACH ROW EXECUTE FUNCTION dflow_prod.project_sample_inventory_movement();
CREATE TRIGGER sample_movement_shipment_identity BEFORE INSERT ON dflow_prod.sample_movement FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_movement_shipment_identity();
CREATE TRIGGER sample_path_revision_apply AFTER INSERT ON dflow_prod.sample_path_revision FOR EACH ROW EXECUTE FUNCTION dflow_prod.apply_sample_path_revision();
CREATE TRIGGER sample_path_revision_immutable BEFORE DELETE OR UPDATE ON dflow_prod.sample_path_revision FOR EACH ROW EXECUTE FUNCTION dflow_prod.reject_sample_path_revision_mutation();
CREATE TRIGGER sample_path_revision_validate BEFORE INSERT ON dflow_prod.sample_path_revision FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_path_revision();
CREATE TRIGGER sample_piece_lineage_validate BEFORE INSERT OR UPDATE ON dflow_prod.sample_piece_lineage FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_piece_lineage();
CREATE TRIGGER sample_shipment_route_immutable_after_lines BEFORE UPDATE OF origin_location_type, origin_location_id, destination_location_type, destination_location_id ON dflow_prod.sample_shipment FOR EACH ROW EXECUTE FUNCTION dflow_prod.prevent_sample_shipment_route_drift();
CREATE TRIGGER sample_shipment_line_header_route BEFORE INSERT OR UPDATE OF sample_shipment_id, origin_location_type, origin_location_id, destination_location_type, destination_location_id ON dflow_prod.sample_shipment_line FOR EACH ROW EXECUTE FUNCTION dflow_prod.validate_sample_shipment_line_header();
CREATE TRIGGER sample_shipment_line_identity_immutable_after_movement BEFORE INSERT OR UPDATE OF sample_id_fk, box_id_fk, sample_shipment_id, origin_location_type, origin_location_id, destination_location_type, destination_location_id ON dflow_prod.sample_shipment_line FOR EACH ROW EXECUTE FUNCTION dflow_prod.prevent_sample_shipment_route_drift();
CREATE TRIGGER sample_workflow_path_revision_required BEFORE UPDATE OF business_path ON dflow_prod.sample_workflow FOR EACH ROW EXECUTE FUNCTION dflow_prod.require_sample_path_revision();

-- Comments ----------------------------------------------------------------------

comment on table dflow_prod.sample_approval_event is 'Append-only Flow 3 photo and optional QC decision history. It never represents inventory movement.';
comment on table dflow_prod.sample_carrier is 'Canonical manual carrier choices. Carrier automation is deferred.';
comment on table dflow_prod.sample_creation_batch is 'Neutral atomic guided-create batch for single, group, inventory-selection, or confirmed import creation.';
comment on table dflow_prod.sample_factory_visit is 'Release B Flow 1 factory visit plan. Intent, not custody: nothing here may contradict dflow_prod.sample_movement.';
comment on table dflow_prod.sample_factory_visit_event is 'Append-only audit that drives dflow_prod.sample_factory_visit state; never rewrite prior revisions.';
comment on table dflow_prod.sample_inventory_balance is 'Index-backed projection of immutable movement-ledger balances; maintained only by sample_movement_project_inventory.';
comment on table dflow_prod.sample_movement is 'Immutable sole authority for physical sample quantity; post through dflow_prod.post_sample_movement.';
comment on table dflow_prod.sample_path_revision is 'Append-only audit of path changes; never rewrite prior revisions.';
comment on table dflow_prod.sample_piece_lineage is 'Shared-parent relationship for physical pieces split off one sample. One row per child; the original sample has no row and is its own root. Splitting moves no quantity - conservation stays in dflow_prod.sample_movement.';
comment on table dflow_prod.sample_reservation is 'Flow 4 Ningbo next-box planning only; reservation and packing do not establish physical custody.';
comment on table dflow_prod.sample_shipment is 'Shipment header shared by boxed and unboxed shipment lines; movements remain custody truth.';
comment on table dflow_prod.sample_shipment_line is 'Box/sample route intent; intended quantity is not proof of physical movement or receipt.';
comment on table dflow_prod.sample_workflow is 'Stable Release A workflow and business-path identity. Legacy samples have no row and remain unclassified.';
comment on view dflow_prod.sample_approval_current is 'Deterministic latest approval event for each sample and approval type.';
comment on view dflow_prod.sample_global_status is 'Derived global status from custody balances. Fully split parent identities remain split rather than appearing complete.';
comment on view dflow_prod.sample_inventory is 'Server inventory read model over the indexed movement-balance projection, including parked office leftovers.';
comment on view dflow_prod.sample_visit_plan is 'Flow 1 read model: one row per factory visit carrying sample-level rollups, lineage root, custody and both tracking numbers. Index-usable on sample_id_fk and on (factory_id, state).';
comment on function dflow_prod.pack_sample_reservation(p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint, p_origin_location_id text, p_destination_type text, p_destination_id text, p_route_leg text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) is 'Atomically consumes one Flow 4 reservation into box membership and shipment intent without writing sample_movement.';
comment on function dflow_prod.post_sample_approval_event(p_sample_id integer, p_approval_type text, p_approval_state text, p_qc_required boolean, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_sample_attachment_id integer, p_destination_type text, p_destination_id text, p_reason text) is 'Serializes idempotent Flow 3 approval transitions without posting sample movements.';
comment on function dflow_prod.post_sample_piece_split(p_parent_sample_id integer, p_children jsonb, p_source_location_type text, p_source_location_id text, p_split_reason text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) is 'Atomically conserves custody quantity when one Flow 1 sample identity is split into child sample identities.';
comment on function dflow_prod.sample_movement_auto_office_inventory() is 'AFTER INSERT on sample_movement: when an office ships onward (to in_transit or customer), auto-moves any remaining office balance into terminal {office_id}_office_inventory with lifecycle_action=retain. Product rule confirmed 2026-07-23. Disable with DROP TRIGGER sample_movement_auto_office_inventory_trigger ON dflow_prod.sample_movement.';

-- Privileges: reproduce the exact canonical ACL of each dflow object -----------

revoke all on table dflow_prod.sample_approval_event from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_carrier from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_creation_batch from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_factory_visit from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_factory_visit_event from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_import_job from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_import_row from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_inventory_balance from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_movement from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_path_revision from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_piece_lineage from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_remote_request from public, anon, authenticated, service_role;
grant insert, select on table dflow_prod.sample_remote_request to service_role;
revoke all on table dflow_prod.sample_remote_request_history from public, anon, authenticated, service_role;
grant select on table dflow_prod.sample_remote_request_history to service_role;
revoke all on table dflow_prod.sample_remote_request_item from public, anon, authenticated, service_role;
grant insert, select on table dflow_prod.sample_remote_request_item to service_role;
revoke all on table dflow_prod.sample_reservation from public, anon, authenticated, service_role;
grant select on table dflow_prod.sample_reservation to service_role;
revoke all on table dflow_prod.sample_shipment from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_shipment_line from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_stop_closeout from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_workflow from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_approval_current from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_balance_by_location from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_global_status from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_in_transit from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_inventory from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_open_stop_work from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_receipt_discrepancy from public, anon, authenticated, service_role;
revoke all on table dflow_prod.sample_visit_plan from public, anon, authenticated, service_role;
revoke all on function dflow_prod.apply_sample_factory_visit_event() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.apply_sample_path_revision() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.pack_sample_reservation(p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint, p_origin_location_id text, p_destination_type text, p_destination_id text, p_route_leg text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) from public, anon, authenticated, service_role;
grant execute on function dflow_prod.pack_sample_reservation(p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint, p_origin_location_id text, p_destination_type text, p_destination_id text, p_route_leg text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) to service_role;
revoke all on function dflow_prod.post_sample_approval_event(p_sample_id integer, p_approval_type text, p_approval_state text, p_qc_required boolean, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_sample_attachment_id integer, p_destination_type text, p_destination_id text, p_reason text) from public, anon, authenticated, service_role;
revoke all on function dflow_prod.post_sample_movement(p_sample_id integer, p_quantity integer, p_from_type text, p_from_id text, p_to_type text, p_to_id text, p_action text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_box_id integer, p_shipment_line_id bigint, p_actor_factory_id integer, p_discrepancy_code text, p_discrepancy_details text, p_reversal_of bigint, p_from_label text, p_to_label text) from public, anon, authenticated, service_role;
revoke all on function dflow_prod.post_sample_piece_split(p_parent_sample_id integer, p_children jsonb, p_source_location_type text, p_source_location_id text, p_split_reason text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) from public, anon, authenticated, service_role;
revoke all on function dflow_prod.post_sample_remote_request_event(p_item_id uuid, p_to_state text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_note text, p_event_payload jsonb) from public, anon, authenticated, service_role;
grant execute on function dflow_prod.post_sample_remote_request_event(p_item_id uuid, p_to_state text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_note text, p_event_payload jsonb) to service_role;
revoke all on function dflow_prod.prevent_sample_shipment_route_drift() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.project_sample_inventory_movement() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.reject_sample_approval_event_mutation() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.reject_sample_factory_visit_event_mutation() from public, anon, authenticated, service_role;
-- reject_sample_movement_mutation: canonical dflow ACL is the default (owner plus PUBLIC execute); left unchanged.
revoke all on function dflow_prod.reject_sample_path_revision_mutation() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.require_sample_factory_visit_event() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.require_sample_path_revision() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.reserve_sample_remote_request_item(p_item_id uuid, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) from public, anon, authenticated, service_role;
grant execute on function dflow_prod.reserve_sample_remote_request_item(p_item_id uuid, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text) to service_role;
revoke all on function dflow_prod.sample_movement_auto_office_inventory() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.sample_movement_guard() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.touch_sample_factory_visit_updated_at() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_approval_event() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_factory_visit() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_factory_visit_event() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_movement_shipment_identity() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_path_revision() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_piece_lineage() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.validate_sample_shipment_line_header() from public, anon, authenticated, service_role;

commit;
