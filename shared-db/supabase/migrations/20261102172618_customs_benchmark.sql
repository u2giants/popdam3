-- Issue #5447; claim #5449. Private historical customs benchmark.
-- derived-from: none
-- Source content is loaded separately as private application data, never committed.
-- This archive is deliberately outside the sanitized hts_rag learning contract.
begin;
create table plm.customs_benchmark_dataset (
  dataset_id text primary key check (dataset_id ~ '^[0-9a-f]{64}$'),
  benchmark_name text not null,
  authority_scope text not null check (authority_scope = 'historical_customs_evidence'),
  source_manifest jsonb not null check (jsonb_typeof(source_manifest) = 'array'),
  original_intelligence jsonb not null check (jsonb_typeof(original_intelligence) = 'object'),
  authority_context text not null,
  source_file_count integer not null check (source_file_count > 0),
  source_byte_count bigint not null check (source_byte_count > 0),
  observation_count integer not null check (observation_count > 0),
  imported_at timestamptz not null default now()
);
create table plm.customs_benchmark_artifact (
  dataset_id text not null references plm.customs_benchmark_dataset(dataset_id),
  relative_path text not null check (btrim(relative_path) <> ''),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  media_type text not null,
  byte_count bigint not null check (byte_count >= 0),
  storage_endpoint text not null check (storage_endpoint like 'https://%'),
  storage_bucket text not null check (btrim(storage_bucket) <> ''),
  storage_key text not null check (storage_key like 'private/customs-benchmark/%'),
  private_verified boolean not null check (private_verified),
  structured_content jsonb,
  primary key (dataset_id, relative_path)
);
create table plm.customs_benchmark_observation (
  dataset_id text not null references plm.customs_benchmark_dataset(dataset_id),
  section text not null check (section in ('matches','suggestions','code_checks','unmatched','coverage','anomalies')),
  source_ordinal integer not null check (source_ordinal >= 0),
  style_number text,
  product_description text,
  product_family text,
  historical_hts text,
  packet_reference text,
  evidence_status text not null,
  exact_historical_candidate boolean not null default false,
  current_law_verified boolean not null default false check (not current_law_verified),
  original_record jsonb not null check (jsonb_typeof(original_record) = 'object'),
  primary key (dataset_id, section, source_ordinal),
  check (not exact_historical_candidate or (section = 'matches' and evidence_status = 'Historical link candidate' and historical_hts is not null))
);
comment on table plm.customs_benchmark_dataset is
  'Authoritative preserved historical customs evidence benchmark, owner-directed in #5447. Historical evidence is not current-law classification truth; original statuses, exclusions and source bytes are mandatory.';
comment on table plm.customs_benchmark_artifact is
  'Private object-storage pointers and byte checksums for customs packets, item-master snapshot, extracts, reports, scripts and context; parsed extraction JSON stays queryable. File bytes are not stored in PostgreSQL. Never expose via browser roles or copy into sanitized shared HTS learning.';
comment on table plm.customs_benchmark_observation is
  'Queryable authoritative historical comparison records. Only explicit historical link candidates may enter historical exact-match scoring; family leads, packet inference, clock exclusions and unresolved cases remain distinct. Retain original_record verbatim in meaning.';
alter table plm.customs_benchmark_dataset enable row level security;
alter table plm.customs_benchmark_artifact enable row level security;
alter table plm.customs_benchmark_observation enable row level security;
revoke all on plm.customs_benchmark_dataset, plm.customs_benchmark_artifact, plm.customs_benchmark_observation from public, anon, authenticated, service_role;
grant select, insert on plm.customs_benchmark_dataset, plm.customs_benchmark_artifact, plm.customs_benchmark_observation to service_role;
commit;
