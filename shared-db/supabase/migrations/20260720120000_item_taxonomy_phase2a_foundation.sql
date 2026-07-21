-- Item -> taxonomy resolver, Phase 2a: additive storage foundation only.
-- No existing view is repointed and this migration performs no data backfill.

create table plm.merch_group_header (
  company_code text not null,
  division_code text not null,
  mg_type_code text not null,
  mg_type_desc text not null,
  source_created_at timestamptz,
  source_created_by text,
  source_modified_at timestamptz,
  source_modified_by text,
  raw jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_code, division_code, mg_type_code),
  check (mg_type_code ~ '^[0-9]{2}$')
);

create table plm.item_import_staging (
  sweep_id uuid not null,
  company_code text not null,
  division_code text not null,
  item_no text not null,
  item_description text,
  style_number text,
  status text,
  merch_group_01 text,
  merch_group_02 text,
  merch_group_03 text,
  merch_group_04 text,
  merch_group_05 text,
  merch_group_06 text,
  merch_groups jsonb not null default '{}'::jsonb,
  raw jsonb not null,
  staged_at timestamptz not null default now(),
  primary key (sweep_id, company_code, division_code, item_no)
);

create table plm.item_import (
  company_code text not null,
  division_code text not null,
  item_no text not null,
  item_id uuid references plm.item(id) on delete set null,
  item_description text,
  style_number text,
  status text,
  merch_group_01 text,
  merch_group_02 text,
  merch_group_03 text,
  merch_group_04 text,
  merch_group_05 text,
  merch_group_06 text,
  merch_groups jsonb not null default '{}'::jsonb,
  resolution_outcome text not null default 'unresolved'
    check (resolution_outcome in ('resolved', 'partially-resolved', 'ambiguous', 'unresolved')),
  raw jsonb not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_code, division_code, item_no)
);

create table plm.item_import_unresolved (
  company_code text not null,
  division_code text not null,
  item_no text not null,
  slot_code text not null,
  slot_meaning text,
  source_code text,
  outcome text not null check (outcome in ('partially-resolved', 'ambiguous', 'unresolved')),
  reason text not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  tiebreak text not null default 'none; ambiguous candidates are quarantined',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sync_run_id uuid references ingest.sync_run(id) on delete set null,
  primary key (company_code, division_code, item_no, slot_code),
  foreign key (company_code, division_code, item_no)
    references plm.item_import(company_code, division_code, item_no) on delete cascade
);

create table plm.item_taxonomy_disagreement (
  company_code text not null,
  division_code text not null,
  item_no text not null,
  licensor_slot_code text,
  property_slot_code text,
  slot_licensor_id uuid references core.licensor(id) on delete set null,
  property_id uuid not null references core.property(id) on delete cascade,
  property_licensor_id uuid references core.licensor(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reason text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sync_run_id uuid references ingest.sync_run(id) on delete set null,
  primary key (company_code, division_code, item_no),
  foreign key (company_code, division_code, item_no)
    references plm.item_import(company_code, division_code, item_no) on delete cascade
);

create index item_import_item_id_idx on plm.item_import (item_id);
create index item_import_outcome_idx on plm.item_import (resolution_outcome);
create index item_import_unresolved_outcome_idx on plm.item_import_unresolved (outcome, division_code);
create index item_taxonomy_disagreement_status_idx on plm.item_taxonomy_disagreement (status, division_code);

create trigger set_updated_at before update on plm.merch_group_header
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on plm.item_import
  for each row execute function app.set_updated_at();

alter table plm.merch_group_header enable row level security;
alter table plm.item_import_staging enable row level security;
alter table plm.item_import enable row level security;
alter table plm.item_import_unresolved enable row level security;
alter table plm.item_taxonomy_disagreement enable row level security;

create policy plm_merch_group_header_read on plm.merch_group_header
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
create policy plm_merch_group_header_admin_write on plm.merch_group_header
  for all to authenticated using (app.has_role('administrator')) with check (app.has_role('administrator'));
create policy plm_item_import_staging_admin_only on plm.item_import_staging
  for all to authenticated using (app.has_role('administrator')) with check (app.has_role('administrator'));
create policy plm_item_import_read on plm.item_import
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
create policy plm_item_import_admin_write on plm.item_import
  for all to authenticated using (app.has_role('administrator')) with check (app.has_role('administrator'));
create policy plm_item_import_unresolved_admin_only on plm.item_import_unresolved
  for all to authenticated using (app.has_role('administrator')) with check (app.has_role('administrator'));
create policy plm_item_taxonomy_disagreement_admin_only on plm.item_taxonomy_disagreement
  for all to authenticated using (app.has_role('administrator')) with check (app.has_role('administrator'));

grant usage on schema plm to authenticated, service_role;
grant select on plm.merch_group_header, plm.item_import_staging, plm.item_import,
  plm.item_import_unresolved, plm.item_taxonomy_disagreement to authenticated;
grant all on plm.merch_group_header, plm.item_import_staging, plm.item_import,
  plm.item_import_unresolved, plm.item_taxonomy_disagreement to service_role;

-- Phase-4 will serve plm.item through a security_invoker view. Make its
-- underlying permissions explicit now; RLS was enabled in the baseline.
grant select on plm.item to authenticated;
grant all on plm.item to service_role;

comment on table plm.merch_group_header is 'Coldlion division-scoped dictionary: (division, mg type) determines slot meaning. Never interpret mg_type_code globally.';
comment on table plm.item_import_staging is 'Holding area for a complete Coldlion /items sweep. Silver promotion occurs only after terminal-page and sanity-band assertions.';
comment on table plm.item_import is 'Typed Coldlion item silver mirror. Natural key is company_code + division_code + item_no; raw merch-group codes are retained.';
comment on table plm.item_import_unresolved is 'Current item taxonomy quarantine, one row per item and slot; resolved slots are deleted on a later successful run.';
comment on table plm.item_taxonomy_disagreement is 'Review queue where an item licensor slot disagrees with the resolved property parent. Property parent wins the FK.';
