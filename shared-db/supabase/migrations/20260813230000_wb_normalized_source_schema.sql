-- Issue #925: additive normalized Warner source landing. No source data.
create extension if not exists pgcrypto with schema extensions;

create table plm.wb_franchise (
 id uuid primary key default extensions.gen_random_uuid(), source_namespace text not null, source_id text, fallback_key text,
 label text not null, source_term text not null default 'Franchise', identity_method text not null,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), imported_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(source_term='Franchise' and btrim(source_namespace)<>'' and btrim(label)<>'' and
  ((identity_method='source_id' and source_id is not null and btrim(source_id)<>'' and fallback_key is null) or
   (identity_method='natural_key_fallback' and source_id is null and fallback_key is not null and btrim(fallback_key)<>''))));
create unique index uq_wb_franchise_source on plm.wb_franchise(source_namespace,source_id) where source_id is not null;
create unique index uq_wb_franchise_fallback on plm.wb_franchise(source_namespace,fallback_key) where source_id is null;

create table plm.wb_property (
 id uuid primary key default extensions.gen_random_uuid(), source_namespace text not null, source_id text, fallback_key text,
 label text not null, source_term text not null default 'Property', identity_method text not null,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), imported_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(source_term='Property' and source_namespace in ('warner_product_catalogue','warner_art_assets') and btrim(label)<>'' and
  ((identity_method='source_id' and source_id is not null and btrim(source_id)<>'' and fallback_key is null) or
   (identity_method='natural_key_fallback' and source_id is null and fallback_key is not null and btrim(fallback_key)<>''))));
create unique index uq_wb_property_source on plm.wb_property(source_namespace,source_id) where source_id is not null;
create unique index uq_wb_property_fallback on plm.wb_property(source_namespace,fallback_key) where source_id is null;

create table plm.wb_character_normalized (
 id uuid primary key default extensions.gen_random_uuid(), source_namespace text not null, source_id text, fallback_key text,
 label text not null, source_term text not null default 'Character', identity_method text not null,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), imported_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(source_term='Character' and btrim(source_namespace)<>'' and btrim(label)<>'' and
  ((identity_method='source_id' and source_id is not null and btrim(source_id)<>'' and fallback_key is null) or
   (identity_method='natural_key_fallback' and source_id is null and fallback_key is not null and btrim(fallback_key)<>''))));
create unique index uq_wb_character_normalized_source on plm.wb_character_normalized(source_namespace,source_id) where source_id is not null;
create unique index uq_wb_character_normalized_fallback on plm.wb_character_normalized(source_namespace,fallback_key) where source_id is null;

create table plm.wb_style_guide_normalized (
 id uuid primary key default extensions.gen_random_uuid(), source_namespace text not null, source_id text, fallback_key text,
 label text not null, source_term text not null default 'Style Guide', identity_method text not null,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), imported_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(source_term='Style Guide' and btrim(source_namespace)<>'' and btrim(label)<>'' and
  ((identity_method='source_id' and source_id is not null and btrim(source_id)<>'' and fallback_key is null) or
   (identity_method='natural_key_fallback' and source_id is null and fallback_key is not null and btrim(fallback_key)<>''))));
create unique index uq_wb_style_guide_normalized_source on plm.wb_style_guide_normalized(source_namespace,source_id) where source_id is not null;
create unique index uq_wb_style_guide_normalized_fallback on plm.wb_style_guide_normalized(source_namespace,fallback_key) where source_id is null;

create table plm.wb_asset_normalized (
 id uuid primary key default extensions.gen_random_uuid(), source_namespace text not null, source_id text not null,
 warner_asset_id text, file_name text not null, source_path text not null, season text, file_size_bytes bigint,
 source_created_at timestamptz, source_modified_at timestamptz, capture_id uuid not null, capture_chunk integer not null default 0,
 source_url text not null, raw jsonb not null, source_hash text not null, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), imported_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(btrim(source_namespace)<>'' and btrim(source_id)<>'' and btrim(file_name)<>'' and btrim(source_path)<>'' and (file_size_bytes is null or file_size_bytes>=0)),
 unique(source_namespace,source_id));

create table plm.wb_asset_franchise (
 asset_id uuid not null references plm.wb_asset_normalized(id) on delete restrict, franchise_id uuid not null references plm.wb_franchise(id) on delete restrict,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(asset_id,franchise_id),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict);
create table plm.wb_asset_property (
 asset_id uuid not null references plm.wb_asset_normalized(id) on delete restrict, property_id uuid not null references plm.wb_property(id) on delete restrict,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(asset_id,property_id),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict);
create table plm.wb_asset_character_normalized (
 asset_id uuid not null references plm.wb_asset_normalized(id) on delete restrict, character_id uuid not null references plm.wb_character_normalized(id) on delete restrict,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(asset_id,character_id),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict);
create table plm.wb_asset_style_guide_normalized (
 asset_id uuid not null references plm.wb_asset_normalized(id) on delete restrict, style_guide_id uuid not null references plm.wb_style_guide_normalized(id) on delete restrict,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(asset_id,style_guide_id),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict);
create table plm.wb_property_character_normalized (
 property_id uuid not null references plm.wb_property(id) on delete restrict, character_id uuid not null references plm.wb_character_normalized(id) on delete restrict,
 property_source_id text, character_source_id text, property_label text not null, character_label text not null, identity_fallback boolean not null,
 evidence_type text not null default 'direct_warner_product_catalogue', core_property_id uuid references core.property(id) on delete restrict,
 resolution_status text not null default 'unresolved', resolution_reason text, resolved_at timestamptz, resolved_by text,
 capture_id uuid not null, capture_chunk integer not null default 0, source_url text not null, raw jsonb not null, source_hash text not null,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(property_id,character_id),
 foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict, check(evidence_type='direct_warner_product_catalogue'));
create table plm.wb_franchise_property_evidence (
 franchise_id uuid not null references plm.wb_franchise(id) on delete restrict, property_id uuid not null references plm.wb_property(id) on delete restrict,
 evidence_type text not null, evidence_source text not null, capture_id uuid not null, capture_chunk integer not null default 0,
 source_url text not null, raw jsonb not null, source_hash text not null, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(franchise_id,property_id,evidence_source), foreign key(capture_id,capture_chunk) references plm.wb_capture(capture_id,chunk_number) on delete restrict,
 check(evidence_type='direct_warner_source' and btrim(evidence_source)<>''));

alter table plm.wb_franchise enable row level security;
alter table plm.wb_property enable row level security;
alter table plm.wb_character_normalized enable row level security;
alter table plm.wb_style_guide_normalized enable row level security;
alter table plm.wb_asset_normalized enable row level security;
alter table plm.wb_asset_franchise enable row level security;
alter table plm.wb_asset_property enable row level security;
alter table plm.wb_asset_character_normalized enable row level security;
alter table plm.wb_asset_style_guide_normalized enable row level security;
alter table plm.wb_property_character_normalized enable row level security;
alter table plm.wb_franchise_property_evidence enable row level security;
create policy wb_franchise_read on plm.wb_franchise for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_property_read on plm.wb_property for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_character_normalized_read on plm.wb_character_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_style_guide_normalized_read on plm.wb_style_guide_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_asset_normalized_read on plm.wb_asset_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_asset_franchise_read on plm.wb_asset_franchise for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_asset_property_read on plm.wb_asset_property for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_asset_character_normalized_read on plm.wb_asset_character_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_asset_style_guide_normalized_read on plm.wb_asset_style_guide_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_property_character_normalized_read on plm.wb_property_character_normalized for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
create policy wb_franchise_property_evidence_read on plm.wb_franchise_property_evidence for select to authenticated using(app.has_role('administrator') or app.has_app_access('plm') or app.has_any_role(array['sales','licensing']::app.app_role[]));
grant select on plm.wb_franchise,plm.wb_property,plm.wb_character_normalized,plm.wb_style_guide_normalized,plm.wb_asset_normalized,
 plm.wb_asset_franchise,plm.wb_asset_property,plm.wb_asset_character_normalized,plm.wb_asset_style_guide_normalized,
 plm.wb_property_character_normalized,plm.wb_franchise_property_evidence to authenticated,service_role;
revoke all on plm.wb_franchise,plm.wb_property,plm.wb_character_normalized,plm.wb_style_guide_normalized,plm.wb_asset_normalized,
 plm.wb_asset_franchise,plm.wb_asset_property,plm.wb_asset_character_normalized,plm.wb_asset_style_guide_normalized,
 plm.wb_property_character_normalized,plm.wb_franchise_property_evidence from anon;
comment on table plm.wb_franchise_property is 'DEPRECATED issue #925; compatibility only. Use separate normalized Franchise and Property tables.';
comment on table plm.wb_asset_franchise_property is 'DEPRECATED issue #925; compatibility only. Use separate normalized Asset relationship tables.';
