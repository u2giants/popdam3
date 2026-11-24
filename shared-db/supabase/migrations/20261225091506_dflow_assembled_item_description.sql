-- derived-from: none
-- Issue #7041 (claim #7042): DesignFlow assembled item descriptions —
-- SANDBOX HALF of the matched pair (schema `dflow`, project
-- xupnyeifmpsacrqahwwm: sandbox / dev / staging all point here). The
-- production half is the paired version 20261225091507 (schema `dflow_prod`).
-- Work issue popcre/designflow-item-master#194; plan
-- plan_assembled-item-description.md step 1.1 (branch sandbox-albert).
--
-- Objects (this file): nine tables (product_type, product_type_mg,
-- product_type_mg03_allowed, product_type_request, description_convention,
-- item_description_parts, embellishment_phrase, product_type_search_log,
-- mg_display_name), their indexes (trigram on product_type.name,
-- product_type.search_terms, embellishment_phrase.phrase; no vector index,
-- D5), function + trigger item_description_parts_append_only. No grants: the
-- sandbox item service runs as the pooler admin and ownership covers
-- everything (as 20261106050346). resolve_mg_path and the search functions
-- are deferred to plan step 3.1. No data is written.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / drop-if-exists; re-apply is a
-- no-op. Rollback: drop the nine tables (item_description_parts,
-- product_type_search_log, product_type_mg03_allowed, product_type_mg,
-- product_type_request, embellishment_phrase, description_convention,
-- mg_display_name, product_type) and function
-- dflow.item_description_parts_append_only.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#7041/20261225091506 self-check: schema dflow_prod exists here — this is the production project; the paired version 20261225091507 applies there, never this one'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('dflow."itemHeader"') is null then
    raise exception '#7041/20261225091506 self-check: dflow."itemHeader" is missing — wrong database for the sandbox half'
      using errcode = 'feature_not_supported';
  end if;
  if to_regtype('extensions.vector') is null
     or not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception '#7041/20261225091506 self-check: extensions vector and pg_trgm (schema extensions) are required'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- Catalog of product types (L3, L6). Name carries the material. Only
-- 'approved' rows are offered to designers. The embedding is un-sized
-- (D5): embedding_model and embedding_dim are stored beside it, so a model
-- change is a re-embed job, not a migration. Chosen 2026-11-24 (D15):
-- OpenRouter openai/text-embedding-3-large, 3072. Rows are saved with no
-- embedding and embedded afterwards (D4).
create table if not exists dflow.product_type (
  id bigint generated always as identity primary key,
  name text not null,
  search_terms text not null default '',
  short_name text,
  embedding extensions.vector,
  embedding_model text,
  embedding_dim integer,
  embedded_at timestamptz,
  status text not null default 'draft'
    constraint product_type_status_check
    check (status in ('draft','approved','retired')),
  source text not null
    constraint product_type_source_check
    check (source in ('seed','request','manual')),
  created_by integer,
  created_at timestamptz not null default now(),
  approved_by integer,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint product_type_name_not_blank check (btrim(name) <> ''),
  constraint product_type_embedding_meta_check check (
    (embedding is null and embedding_model is null and embedding_dim is null)
    or (embedding is not null and embedding_model is not null
        and embedding_dim = extensions.vector_dims(embedding))
  ),
  constraint product_type_approved_meta_check
    check (status <> 'approved' or approved_at is not null)
);

create unique index if not exists product_type_name_live_key
  on dflow.product_type (lower(btrim(name))) where status <> 'retired';
create index if not exists product_type_name_trgm
  on dflow.product_type using gin (name extensions.gin_trgm_ops);
create index if not exists product_type_search_terms_trgm
  on dflow.product_type using gin (search_terms extensions.gin_trgm_ops);

-- One MG01 > MG02 path per product type (P1, D3), plus optional per-division
-- override rows. division_code null = the default path for every division.
-- Paths are code + category + name; never mg_id (P5): they are resolved per
-- division and per database at the moment of use.
create table if not exists dflow.product_type_mg (
  id bigint generated always as identity primary key,
  product_type_id bigint not null references dflow.product_type(id) on delete cascade,
  division_code text,
  mg01_code text not null,
  mg01_category text,
  mg01_name text not null,
  mg02_code text not null,
  mg02_category text,
  mg02_name text not null,
  mg03_mode text not null
    constraint product_type_mg_mode_check check (mg03_mode in ('fixed','pick')),
  mg03_code text,
  mg03_category text,
  mg03_name text,
  created_by integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_type_mg_fixed_check check (
    (mg03_mode = 'fixed' and mg03_code is not null and mg03_name is not null)
    or (mg03_mode = 'pick' and mg03_code is null and mg03_category is null and mg03_name is null)
  ),
  constraint product_type_mg_division_key
    unique nulls not distinct (product_type_id, division_code)
);

-- MG03 allow-list for 'pick' mode (D2): pre-filled by the system, accepted by
-- the approver.
create table if not exists dflow.product_type_mg03_allowed (
  id bigint generated always as identity primary key,
  product_type_mg_id bigint not null references dflow.product_type_mg(id) on delete cascade,
  mg03_code text not null,
  mg03_category text,
  mg03_name text not null,
  created_at timestamptz not null default now(),
  constraint product_type_mg03_allowed_key
    unique nulls not distinct (product_type_mg_id, mg03_code, mg03_category)
);

-- A designer's request for a missing product type (L4, Q3: the half-filled
-- item is kept as a draft). Resolves to exactly one outcome.
create table if not exists dflow.product_type_request (
  id bigint generated always as identity primary key,
  requested_text text not null,
  note text,
  division_code text,
  requested_by integer,
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    constraint product_type_request_status_check
    check (status in ('pending','approved','merged','rejected')),
  resolved_product_type_id bigint references dflow.product_type(id),
  resolved_by integer,
  resolved_at timestamptz,
  resolution_reason text,
  item_draft jsonb,
  constraint product_type_request_outcome_check check (
    (status = 'pending' and resolved_product_type_id is null and resolved_at is null)
    or (status in ('approved','merged') and resolved_product_type_id is not null and resolved_at is not null)
    or (status = 'rejected' and resolved_product_type_id is null and resolved_at is not null
        and resolution_reason is not null)
  )
);
create index if not exists product_type_request_status_idx
  on dflow.product_type_request (status, requested_at);

-- The naming convention, chosen per division (owner 2026-11-10 1:01 PM EST:
-- CW001/SP001 licensed vs EH001 non-licensed). Versioned; at most one current
-- row per division.
create table if not exists dflow.description_convention (
  id bigint generated always as identity primary key,
  division_code text not null,
  version integer not null,
  template jsonb not null,
  is_current boolean not null default false,
  created_by integer,
  created_at timestamptz not null default now(),
  constraint description_convention_version_key unique (division_code, version)
);
create unique index if not exists description_convention_current_key
  on dflow.description_convention (division_code) where is_current;

-- The parts each item's name was assembled from. Append-only (D11): a change
-- inserts a new row and clears is_current on the old one; exactly one current
-- row per item. mg0N_id record what was written to the item (not a mapping).
create table if not exists dflow.item_description_parts (
  id bigint generated always as identity primary key,
  item_fk integer not null references dflow."itemHeader"(item_id_pk) on delete cascade,
  product_type_id bigint not null references dflow.product_type(id),
  mg01_id integer,
  mg02_id integer,
  mg03_id integer,
  extra_embellishment text,
  artwork_text text,
  size_length numeric(10,3),
  size_width numeric(10,3),
  size_depth numeric(10,3),
  size_unit text not null default 'in',
  mg04_approximate boolean not null default false,
  convention_id bigint not null references dflow.description_convention(id),
  assembled_description text not null,
  is_current boolean not null default true,
  created_by integer,
  created_at timestamptz not null default now(),
  constraint item_description_parts_size_check check (
    (size_length is null or size_length > 0) and (size_width is null or size_width > 0)
    and (size_depth is null or size_depth >= 0)
  )
);
create unique index if not exists item_description_parts_current_key
  on dflow.item_description_parts (item_fk) where is_current;
create index if not exists item_description_parts_product_type_idx
  on dflow.item_description_parts (product_type_id);

create or replace function dflow.item_description_parts_append_only() returns trigger as $fn$
begin
  if old.is_current and not new.is_current
     and (to_jsonb(new) - 'is_current') = (to_jsonb(old) - 'is_current') then
    return new;
  end if;
  raise exception 'item_description_parts % is append-only: insert a new row and clear is_current on the old one',
    old.id using errcode = 'check_violation';
end
$fn$ language plpgsql;

drop trigger if exists item_description_parts_append_only on dflow.item_description_parts;
create trigger item_description_parts_append_only
  before update on dflow.item_description_parts
  for each row execute function dflow.item_description_parts_append_only();

-- Free-text embellishment phrases (L8), fed only by saved items; suggested
-- back to designers, never reviewed. Embedding as on product_type (D4/D5).
create table if not exists dflow.embellishment_phrase (
  id bigint generated always as identity primary key,
  phrase text not null,
  embedding extensions.vector,
  embedding_model text,
  embedding_dim integer,
  embedded_at timestamptz,
  use_count integer not null default 0,
  first_used_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint embellishment_phrase_not_blank check (btrim(phrase) <> ''),
  constraint embellishment_phrase_embedding_meta_check check (
    (embedding is null and embedding_model is null and embedding_dim is null)
    or (embedding is not null and embedding_model is not null
        and embedding_dim = extensions.vector_dims(embedding))
  )
);
create unique index if not exists embellishment_phrase_key
  on dflow.embellishment_phrase (lower(btrim(phrase)));
create index if not exists embellishment_phrase_phrase_trgm
  on dflow.embellishment_phrase using gin (phrase extensions.gin_trgm_ops);

-- Queue health (D9): what designers searched for and what they chose.
create table if not exists dflow.product_type_search_log (
  id bigint generated always as identity primary key,
  searched_at timestamptz not null default now(),
  division_code text,
  query_text text not null,
  result_count integer not null,
  chosen_product_type_id bigint references dflow.product_type(id) on delete set null
);
create index if not exists product_type_search_log_searched_idx
  on dflow.product_type_search_log (searched_at);

-- Our own wording for MG05/MG06 (licensors, properties; EH001 themes), keyed
-- by ColdLion code within its division, never mg_id and never written back to
-- merchGroup (L9). omit_reason and property_group per owner answers
-- 2026-11-10/12 (groups are background metadata and never print).
create table if not exists dflow.mg_display_name (
  id bigint generated always as identity primary key,
  division_code text not null,
  mg_level text not null
    constraint mg_display_name_level_check check (mg_level in ('MG05','MG06')),
  mg_code text not null,
  mg_category text,
  parent_mg_code text,
  coldlion_name text,
  display_name text not null,
  short_name text,
  omit_from_name boolean not null default false,
  omit_reason text
    constraint mg_display_name_omit_reason_check
    check (omit_reason in ('obvious','few_properties','same_name','not_a_licensor','other')),
  property_group text,
  updated_by integer,
  updated_at timestamptz not null default now(),
  constraint mg_display_name_omit_check check (omit_from_name or omit_reason is null),
  constraint mg_display_name_group_check check (property_group is null or mg_level = 'MG06'),
  constraint mg_display_name_key
    unique nulls not distinct (division_code, mg_level, mg_code, mg_category)
);
