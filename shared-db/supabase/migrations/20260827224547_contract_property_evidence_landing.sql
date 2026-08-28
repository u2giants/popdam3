-- derived-from: none
-- Issue #1676: private, service-only exact Property evidence from signed contracts.
-- Licensed values, document text, filenames, financial terms, territory, restrictions,
-- and personal data are deliberately absent from this public migration.

create table plm.contract_property_capture (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid not null references core.licensor(id) on delete restrict,
  source_identity text not null,
  evidence_date date not null,
  decision_authority text not null,
  controlling_chain_complete boolean not null,
  captured_at timestamptz not null default now(),
  constraint contract_property_capture_source_identity_not_blank
    check (btrim(source_identity) <> ''),
  constraint contract_property_capture_decision_authority_not_blank
    check (btrim(decision_authority) <> '')
);

create table plm.contract_property_document (
  capture_id uuid not null references plm.contract_property_capture(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  evidence_identity text not null,
  document_sha256 text not null,
  signature_status text not null,
  recorded_at timestamptz not null default now(),
  primary key (capture_id, id),
  constraint contract_property_document_evidence_identity_not_blank
    check (btrim(evidence_identity) <> ''),
  constraint contract_property_document_sha256_valid
    check (document_sha256 ~ '^[0-9a-f]{64}$'),
  constraint contract_property_document_signature_status_not_blank
    check (btrim(signature_status) <> '')
);

create table plm.contract_property (
  capture_id uuid not null references plm.contract_property_capture(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  exact_property_text text not null,
  recorded_at timestamptz not null default now(),
  primary key (capture_id, id),
  constraint contract_property_exact_text_not_blank
    check (btrim(exact_property_text) <> '')
);

create table plm.contract_property_evidence (
  capture_id uuid not null,
  id uuid not null default gen_random_uuid(),
  property_id uuid not null,
  document_id uuid not null,
  page_schedule_locator text not null,
  recorded_at timestamptz not null default now(),
  primary key (capture_id, id),
  constraint contract_property_evidence_capture_fkey
    foreign key (capture_id) references plm.contract_property_capture(id) on delete restrict,
  constraint contract_property_evidence_property_fkey
    foreign key (capture_id, property_id)
    references plm.contract_property(capture_id, id) on delete restrict,
  constraint contract_property_evidence_document_fkey
    foreign key (capture_id, document_id)
    references plm.contract_property_document(capture_id, id) on delete restrict,
  constraint contract_property_evidence_locator_not_blank
    check (btrim(page_schedule_locator) <> '')
);

create index contract_property_capture_licensor_idx
  on plm.contract_property_capture (licensor_id);

create unique index contract_property_document_sha256_uq
  on plm.contract_property_document (document_sha256);

create unique index contract_property_licensor_identity_uq
  on plm.contract_property (capture_id, exact_property_text);

create index contract_property_evidence_document_idx
  on plm.contract_property_evidence (document_id);

alter table plm.contract_property_capture enable row level security;
alter table plm.contract_property_capture force row level security;
alter table plm.contract_property_document enable row level security;
alter table plm.contract_property_document force row level security;
alter table plm.contract_property enable row level security;
alter table plm.contract_property force row level security;
alter table plm.contract_property_evidence enable row level security;
alter table plm.contract_property_evidence force row level security;

revoke all on table plm.contract_property_capture from public, anon, authenticated, service_role;
revoke all on table plm.contract_property_document from public, anon, authenticated, service_role;
revoke all on table plm.contract_property from public, anon, authenticated, service_role;
revoke all on table plm.contract_property_evidence from public, anon, authenticated, service_role;

grant select, insert on table plm.contract_property_capture to service_role;
grant select, insert on table plm.contract_property_document to service_role;
grant select, insert on table plm.contract_property to service_role;
grant select, insert on table plm.contract_property_evidence to service_role;

comment on table plm.contract_property_capture is
  'Private service-only capture of exact Property-name evidence from a signed licence-contract chain. No terms, territory, restrictions, filenames, document text, personal data, or financial data.';
comment on table plm.contract_property_document is
  'Opaque document identity and integrity/signature provenance only; document names and contents remain private.';
comment on table plm.contract_property is
  'Exact Property text observed in one licensor-scoped contract capture; never a core.property or portal-vocabulary promotion.';
comment on table plm.contract_property_evidence is
  'Same-capture link from exact Property evidence to its opaque document and page/schedule locator.';
