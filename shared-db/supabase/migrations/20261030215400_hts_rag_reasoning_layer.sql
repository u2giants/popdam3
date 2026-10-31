-- Issue popcre/shared-db#5188 (claim #5197, designflow-backend#254): the reasoning layer.
-- derived-from: none
-- Design: designflow-backend docs/design_cbp-ruling-database.md §13 (Fable review,
-- designflow-backend#254 comment 6532099662). Sentences become the unit of provenance;
-- tests, authorities, decision tests/facts/authorities and CBP-stated counterfactuals
-- record "which test, which fact, what flips it"; extractions version each pass;
-- fault lines are computed, never hand-typed.
-- Adaptations to this database: existing rows key on uuid `id`, so decision_id,
-- product_id and attribute_id below are uuid references to those ids (no renames,
-- no app breakage). heading_decisions.rule_used / legal_note_refs / decisive_keys and
-- product_attributes.is_decisive still hold extract-v2 data (~8,600 rows each); they are
-- marked deprecated here and dropped in a follow-up once extraction has migrated the
-- sentence-anchored part (design §13.9 step 2). Security matches #5015: workers write,
-- inserts bound to source_environment; runtime roles read the reasoning tables the
-- classifier cites (not extractions, which hold raw model output and cost).
-- Deferred to the next change (they touch objects held by #5163 until it lands):
-- pgvector iterative scan on the search's vector leg and hts_rag_rulings.tariff_system.

create table hts_rag.hts_rag_ruling_sentences (
  ruling_number text not null,
  seq integer not null,
  section text not null,
  span int4range not null,
  text_norm text not null,
  text_hash text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_ruling_sentences_pkey primary key (ruling_number, seq),
  constraint hts_rag_ruling_sentences_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_sentences_seq_check check (seq >= 0),
  constraint hts_rag_ruling_sentences_section_check check (section in
    ('header', 'facts', 'issue', 'analysis', 'holding', 'effect', 'boilerplate', 'signature', 'unknown')),
  constraint hts_rag_ruling_sentences_hash_check check (text_hash ~ '^[0-9a-f]{40}$'),
  constraint hts_rag_ruling_sentences_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_sentences is
  'Sentences of each ruling in document order; (ruling_number, seq) is the provenance key for every stored claim. text_hash = sha1(text_norm), stable across CBP API and CustomsMobile text. designflow-backend#254 §13.1.';
create index hts_rag_ruling_sentences_hash_idx on hts_rag.hts_rag_ruling_sentences (text_hash);
create index hts_rag_ruling_sentences_section_idx on hts_rag.hts_rag_ruling_sentences (ruling_number, section);
create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_sentences
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_ruling_sentences enable row level security;
revoke all on hts_rag.hts_rag_ruling_sentences
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_sentences
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (section, span, text_norm, text_hash) on hts_rag.hts_rag_ruling_sentences
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_sentences
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_sentences
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_ruling_sentences
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_sentences
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_sentences
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_sentences
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_ruling_sentences
  for update to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_sentences
  for delete to designflow_hts_alsand_worker using (true);
grant select on hts_rag.hts_rag_ruling_sentences to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_sentences
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_sentences
  for select to designflow_hts_alsand_runtime using (true);


create table hts_rag.hts_rag_extractions (
  id uuid not null default gen_random_uuid(),
  ruling_number text not null,
  pass text not null,
  extract_version text not null,
  model text not null,
  prompt_hash text not null,
  text_hash text not null,
  raw_output jsonb,
  cost_usd numeric(8, 5),
  is_current boolean not null default false,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_extractions_pkey primary key (id),
  constraint hts_rag_extractions_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_extractions_pass_check check (pass in ('product', 'reasoning', 'revocation')),
  constraint hts_rag_extractions_version_key unique (ruling_number, pass, extract_version),
  constraint hts_rag_extractions_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_extractions is
  'One row per (ruling, pass, extract_version): model, prompt and text hashes, raw output (re-validation is free). New versions write beside the old and flip is_current. designflow-backend#254 §13.5.';
create unique index hts_rag_extractions_current_uq
  on hts_rag.hts_rag_extractions (ruling_number, pass) where is_current;
create trigger set_updated_at
before update on hts_rag.hts_rag_extractions
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_extractions enable row level security;
revoke all on hts_rag.hts_rag_extractions
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_extractions
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (is_current, raw_output, cost_usd) on hts_rag.hts_rag_extractions
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_extractions
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_extractions
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_extractions
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_extractions
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_extractions
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_extractions
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_extractions
  for update to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_extractions
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_authorities (
  id integer generated always as identity,
  kind text not null,
  ref text not null,
  ref_norm text not null,
  ruling_number text,
  hs_era text,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_authorities_pkey primary key (id),
  constraint hts_rag_authorities_ref_norm_key unique (ref_norm),
  constraint hts_rag_authorities_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete set null,
  constraint hts_rag_authorities_kind_check check (kind in ('gri', 'section_note', 'chapter_note', 'subheading_note',
    'additional_us_note', 'explanatory_note', 'court_case', 'prior_ruling', 'statute', 'informed_compliance', 'other')),
  constraint hts_rag_authorities_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_authorities is
  'One row per distinct legal citation target (GRI, note, EN, case, prior ruling), parsed deterministically. designflow-backend#254 §13.2.';
create trigger set_updated_at
before update on hts_rag.hts_rag_authorities
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_authorities enable row level security;
revoke all on hts_rag.hts_rag_authorities
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_authorities
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (ref, ruling_number, hs_era) on hts_rag.hts_rag_authorities
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_authorities
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_authorities
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_authorities
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_authorities
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_authorities
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_authorities
  for update to designflow_hts_alsand_worker using (true) with check (true);
grant select on hts_rag.hts_rag_authorities to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_authorities
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_authorities
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_classification_tests (
  id integer generated always as identity,
  canonical_name text not null,
  kind text not null,
  anchor_authority_id integer,
  description text,
  vocab_version integer not null,
  merged_into integer,
  embedding extensions.halfvec(768),
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_classification_tests_pkey primary key (id),
  constraint hts_rag_classification_tests_name_key unique (canonical_name),
  constraint hts_rag_classification_tests_anchor_fkey foreign key (anchor_authority_id)
    references hts_rag.hts_rag_authorities(id) on delete set null,
  constraint hts_rag_classification_tests_merged_fkey foreign key (merged_into)
    references hts_rag.hts_rag_classification_tests(id) on delete restrict,
  constraint hts_rag_classification_tests_kind_check check (kind in ('gri', 'section_note', 'chapter_note',
    'additional_us_note', 'explanatory_note', 'judicial', 'cbp_doctrine', 'definitional')),
  constraint hts_rag_classification_tests_not_self_merged check (merged_into is distinct from id),
  constraint hts_rag_classification_tests_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_classification_tests is
  'Controlled vocabulary of tests CBP applies, seeded from law and grown by clustering; merges use merged_into, nothing is deleted. designflow-backend#254 §13.3.';
create trigger set_updated_at
before update on hts_rag.hts_rag_classification_tests
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_classification_tests enable row level security;
revoke all on hts_rag.hts_rag_classification_tests
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_classification_tests
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (canonical_name, description, vocab_version, merged_into, embedding, anchor_authority_id) on hts_rag.hts_rag_classification_tests
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_classification_tests
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_classification_tests
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_classification_tests
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_classification_tests
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_classification_tests
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_classification_tests
  for update to designflow_hts_alsand_worker using (true) with check (true);
grant select on hts_rag.hts_rag_classification_tests to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_classification_tests
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_classification_tests
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_test_aliases (
  alias text not null,
  test_id integer not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_test_aliases_pkey primary key (alias),
  constraint hts_rag_test_aliases_test_fkey foreign key (test_id)
    references hts_rag.hts_rag_classification_tests(id) on delete restrict,
  constraint hts_rag_test_aliases_alias_check check (alias = lower(btrim(alias)) and alias <> ''),
  constraint hts_rag_test_aliases_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_test_aliases is
  'Lower-case free test names (model or CBP wording) mapped to a canonical test. designflow-backend#254 §13.3.';
create index hts_rag_test_aliases_test_idx on hts_rag.hts_rag_test_aliases (test_id);
create trigger set_updated_at
before update on hts_rag.hts_rag_test_aliases
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_test_aliases enable row level security;
revoke all on hts_rag.hts_rag_test_aliases
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_test_aliases
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (test_id) on hts_rag.hts_rag_test_aliases
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_test_aliases
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_test_aliases
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_test_aliases
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_test_aliases
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_test_aliases
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_test_aliases
  for update to designflow_hts_alsand_worker using (true) with check (true);
grant select on hts_rag.hts_rag_test_aliases to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_test_aliases
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_test_aliases
  for select to designflow_hts_alsand_runtime using (true);

alter table hts_rag.hts_rag_heading_decisions add column code_prefix text;
alter table hts_rag.hts_rag_heading_decisions add column rejected_proposed_by text;
alter table hts_rag.hts_rag_heading_decisions add column sentence_seq integer;
alter table hts_rag.hts_rag_heading_decisions add column extraction_id uuid;
alter table hts_rag.hts_rag_heading_decisions
  add constraint hts_rag_heading_decisions_code_prefix_check
    check (code_prefix is null or (code_prefix ~ '^[0-9]{4}(\.?[0-9]{2}){0,3}$' and left(code_prefix, 4) = heading)),
  add constraint hts_rag_heading_decisions_proposed_by_check
    check (rejected_proposed_by is null or rejected_proposed_by in ('importer', 'cbp_alternative', 'prior_ruling')),
  add constraint hts_rag_heading_decisions_extraction_fkey foreign key (extraction_id)
    references hts_rag.hts_rag_extractions(id) on delete set null;
create index hts_rag_heading_decisions_prefix_idx on hts_rag.hts_rag_heading_decisions (code_prefix);
create index hts_rag_heading_decisions_extraction_idx on hts_rag.hts_rag_heading_decisions (extraction_id);
comment on column hts_rag.hts_rag_heading_decisions.code_prefix is
  'The code at whatever depth CBP argued (4/6/8/10 digits); heading stays as its first four digits for grouping. §13.2.';
comment on column hts_rag.hts_rag_heading_decisions.rule_used is
  'DEPRECATED (design §13.8): replaced by hts_rag_decision_tests. Dropped after extract-v2 data is migrated.';
comment on column hts_rag.hts_rag_heading_decisions.legal_note_refs is
  'DEPRECATED (design §13.8): replaced by hts_rag_decision_authorities. Dropped after extract-v2 data is migrated.';
comment on column hts_rag.hts_rag_heading_decisions.decisive_keys is
  'DEPRECATED (design §13.8): replaced by hts_rag_decision_facts. Dropped after extract-v2 data is migrated.';
grant update (code_prefix, rejected_proposed_by, sentence_seq, extraction_id)
  on hts_rag.hts_rag_heading_decisions to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_heading_decisions
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_heading_decisions
  for update to designflow_hts_alsand_worker using (true) with check (true);

alter table hts_rag.hts_rag_product_attributes add column sentence_seq integer;
comment on column hts_rag.hts_rag_product_attributes.is_decisive is
  'DEPRECATED (design §13.8): decisiveness belongs to a decision (hts_rag_decision_facts). Dropped after extract-v2 data is migrated.';
grant update (sentence_seq) on hts_rag.hts_rag_product_attributes to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_product_attributes
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_product_attributes
  for update to designflow_hts_alsand_worker using (true) with check (true);

alter table hts_rag.hts_rag_ruling_products add column extraction_id uuid;
alter table hts_rag.hts_rag_ruling_products add column likely_superseded boolean not null default false;
alter table hts_rag.hts_rag_ruling_products
  add constraint hts_rag_ruling_products_extraction_fkey foreign key (extraction_id)
    references hts_rag.hts_rag_extractions(id) on delete set null,
  drop constraint hts_rag_ruling_products_status_check,
  add constraint hts_rag_ruling_products_status_check
    check (effective_status in ('active', 'modified', 'revoked', 'superseded_by_law'));
create index hts_rag_ruling_products_extraction_idx on hts_rag.hts_rag_ruling_products (extraction_id);
comment on column hts_rag.hts_rag_ruling_products.likely_superseded is
  'NY row whose test outcome conflicts with a later HQ ruling on the same type (ranking ×0.5, never auto-revoked). §13.4.';
grant update (extraction_id, likely_superseded) on hts_rag.hts_rag_ruling_products to designflow_hts_prod_worker, designflow_hts_alsand_worker;

alter table hts_rag.hts_rag_ruling_links add column affected_product_ids uuid[];
comment on column hts_rag.hts_rag_ruling_links.affected_product_ids is
  'Products a revoke/modify link applies to; null = the whole ruling. Drives per-product effective_status. §13.5.';
grant update (affected_product_ids) on hts_rag.hts_rag_ruling_links to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create table hts_rag.hts_rag_decision_tests (
  id uuid not null default gen_random_uuid(),
  decision_id uuid not null,
  test_id integer not null,
  outcome text not null,
  is_dispositive boolean not null default false,
  reason_sentence_seq integer,
  extraction_id uuid not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_decision_tests_pkey primary key (id),
  constraint hts_rag_decision_tests_decision_fkey foreign key (decision_id)
    references hts_rag.hts_rag_heading_decisions(id) on delete cascade,
  constraint hts_rag_decision_tests_test_fkey foreign key (test_id)
    references hts_rag.hts_rag_classification_tests(id) on delete restrict,
  constraint hts_rag_decision_tests_extraction_fkey foreign key (extraction_id)
    references hts_rag.hts_rag_extractions(id) on delete cascade,
  constraint hts_rag_decision_tests_outcome_check check (outcome in ('satisfied', 'failed', 'not_reached', 'assumed')),
  constraint hts_rag_decision_tests_uq unique (decision_id, test_id, extraction_id),
  constraint hts_rag_decision_tests_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_decision_tests is
  'One row per (heading decision, test): outcome, whether CBP said it decided the heading, and the sentence stating it. §13.2.';
create index hts_rag_decision_tests_test_idx on hts_rag.hts_rag_decision_tests (test_id, outcome);
create index hts_rag_decision_tests_extraction_idx on hts_rag.hts_rag_decision_tests (extraction_id);
create trigger set_updated_at
before update on hts_rag.hts_rag_decision_tests
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_decision_tests enable row level security;
revoke all on hts_rag.hts_rag_decision_tests
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_decision_tests
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (outcome, is_dispositive, reason_sentence_seq, extraction_id) on hts_rag.hts_rag_decision_tests
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_decision_tests
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_decision_tests
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_decision_tests
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_decision_tests
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_decision_tests
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_decision_tests
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_decision_tests
  for update to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_decision_tests
  for delete to designflow_hts_alsand_worker using (true);
grant select on hts_rag.hts_rag_decision_tests to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_decision_tests
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_decision_tests
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_decision_facts (
  decision_test_id uuid not null,
  attribute_id uuid,
  attribute_key text not null,
  direction text not null,
  sentence_seq integer not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_decision_facts_pkey primary key (decision_test_id, attribute_key, sentence_seq),
  constraint hts_rag_decision_facts_test_fkey foreign key (decision_test_id)
    references hts_rag.hts_rag_decision_tests(id) on delete cascade,
  constraint hts_rag_decision_facts_attribute_fkey foreign key (attribute_id)
    references hts_rag.hts_rag_product_attributes(id) on delete set null,
  constraint hts_rag_decision_facts_key_fkey foreign key (attribute_key)
    references hts_rag.hts_rag_attribute_keys(key) on delete restrict,
  constraint hts_rag_decision_facts_direction_check check (direction in ('supports', 'defeats')),
  constraint hts_rag_decision_facts_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_decision_facts is
  'Sentence-backed facts that satisfied (supports) or failed (defeats) a decision test. §13.2.';
create index hts_rag_decision_facts_key_idx on hts_rag.hts_rag_decision_facts (attribute_key);
create trigger set_updated_at
before update on hts_rag.hts_rag_decision_facts
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_decision_facts enable row level security;
revoke all on hts_rag.hts_rag_decision_facts
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_decision_facts
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_decision_facts
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_decision_facts
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_decision_facts
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_decision_facts
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_decision_facts
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_decision_facts
  for delete to designflow_hts_alsand_worker using (true);
grant select on hts_rag.hts_rag_decision_facts to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_decision_facts
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_decision_facts
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_decision_authorities (
  decision_id uuid not null,
  authority_id integer not null,
  role text not null,
  sentence_seq integer not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_decision_authorities_pkey primary key (decision_id, authority_id, role),
  constraint hts_rag_decision_authorities_decision_fkey foreign key (decision_id)
    references hts_rag.hts_rag_heading_decisions(id) on delete cascade,
  constraint hts_rag_decision_authorities_authority_fkey foreign key (authority_id)
    references hts_rag.hts_rag_authorities(id) on delete restrict,
  constraint hts_rag_decision_authorities_role_check
    check (role in ('applied', 'distinguished', 'overruled', 'quoted', 'followed')),
  constraint hts_rag_decision_authorities_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_decision_authorities is
  'Which authority each heading decision applied, distinguished, overruled, quoted or followed, with the citing sentence. §13.2.';
create index hts_rag_decision_authorities_authority_idx on hts_rag.hts_rag_decision_authorities (authority_id, role);
create trigger set_updated_at
before update on hts_rag.hts_rag_decision_authorities
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_decision_authorities enable row level security;
revoke all on hts_rag.hts_rag_decision_authorities
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_decision_authorities
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_decision_authorities
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_decision_authorities
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_decision_authorities
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_decision_authorities
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_decision_authorities
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_decision_authorities
  for delete to designflow_hts_alsand_worker using (true);
grant select on hts_rag.hts_rag_decision_authorities to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_decision_authorities
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_decision_authorities
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_counterfactuals (
  product_id uuid not null,
  attribute_key text not null,
  if_value text not null,
  then_code_prefix text not null,
  sentence_seq integer not null,
  extraction_id uuid not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_counterfactuals_pkey primary key (product_id, attribute_key, then_code_prefix, extraction_id, sentence_seq),
  constraint hts_rag_counterfactuals_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_counterfactuals_key_fkey foreign key (attribute_key)
    references hts_rag.hts_rag_attribute_keys(key) on delete restrict,
  constraint hts_rag_counterfactuals_extraction_fkey foreign key (extraction_id)
    references hts_rag.hts_rag_extractions(id) on delete cascade,
  constraint hts_rag_counterfactuals_prefix_check check (then_code_prefix ~ '^[0-9]{4}(\.?[0-9]{2}){0,3}$'),
  constraint hts_rag_counterfactuals_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_counterfactuals is
  'Only when CBP states it in a sentence: if this attribute had that value, the code would be then_code_prefix. Never model speculation. §13.2.';
create trigger set_updated_at
before update on hts_rag.hts_rag_counterfactuals
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_counterfactuals enable row level security;
revoke all on hts_rag.hts_rag_counterfactuals
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_counterfactuals
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_counterfactuals
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_counterfactuals
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_counterfactuals
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_counterfactuals
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_counterfactuals
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_counterfactuals
  for delete to designflow_hts_alsand_worker using (true);
grant select on hts_rag.hts_rag_counterfactuals to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_counterfactuals
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_counterfactuals
  for select to designflow_hts_alsand_runtime using (true);

-- Sentence provenance: refuse dangling (ruling_number, seq) references. Composite FK is
-- impossible because these tables lack ruling_number; resolve it through the parent chain.
create function hts_rag.validate_sentence_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruling text;
  v_seq integer;
begin
  if tg_table_name = 'hts_rag_heading_decisions' then
    v_seq := new.sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
    end if;
  elsif tg_table_name = 'hts_rag_product_attributes' then
    v_seq := new.sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
    end if;
  elsif tg_table_name = 'hts_rag_decision_tests' then
    v_seq := new.reason_sentence_seq;
    if v_seq is not null then
      select p.ruling_number into v_ruling
        from hts_rag.hts_rag_heading_decisions hd
        join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
       where hd.id = new.decision_id;
    end if;
  elsif tg_table_name = 'hts_rag_decision_facts' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_decision_tests dt
      join hts_rag.hts_rag_heading_decisions hd on hd.id = dt.decision_id
      join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
     where dt.id = new.decision_test_id;
  elsif tg_table_name = 'hts_rag_decision_authorities' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_heading_decisions hd
      join hts_rag.hts_rag_ruling_products p on p.id = hd.product_id
     where hd.id = new.decision_id;
  elsif tg_table_name = 'hts_rag_counterfactuals' then
    v_seq := new.sentence_seq;
    select p.ruling_number into v_ruling
      from hts_rag.hts_rag_ruling_products p where p.id = new.product_id;
  end if;
  if v_seq is not null then
    if v_ruling is null or not exists (
      select 1 from hts_rag.hts_rag_ruling_sentences
       where ruling_number = v_ruling and seq = v_seq
    ) then
      raise exception 'sentence provenance (%, %) not found in hts_rag_ruling_sentences', v_ruling, v_seq;
    end if;
  end if;
  return new;
end;
$$;
comment on function hts_rag.validate_sentence_provenance() is
  'Trigger: refuses a claim whose (ruling_number, sentence_seq) is not in hts_rag_ruling_sentences. designflow-backend#254 §13.1.';
revoke all on function hts_rag.validate_sentence_provenance() from public, anon, authenticated, service_role;
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_heading_decisions
for each row execute function hts_rag.validate_sentence_provenance();
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_product_attributes
for each row execute function hts_rag.validate_sentence_provenance();
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_decision_tests
for each row execute function hts_rag.validate_sentence_provenance();
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_decision_facts
for each row execute function hts_rag.validate_sentence_provenance();
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_decision_authorities
for each row execute function hts_rag.validate_sentence_provenance();
create trigger validate_sentence_provenance
before insert or update on hts_rag.hts_rag_counterfactuals
for each row execute function hts_rag.validate_sentence_provenance();

-- affected_product_ids membership: every uuid must reference hts_rag_ruling_products.
create function hts_rag.validate_affected_product_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.affected_product_ids is not null then
    foreach v_id in array new.affected_product_ids loop
      if not exists (select 1 from hts_rag.hts_rag_ruling_products where id = v_id) then
        raise exception 'affected_product_ids contains unknown product %', v_id;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
comment on function hts_rag.validate_affected_product_ids() is
  'Trigger: refuses ruling_links.affected_product_ids that name an unknown product. designflow-backend#254 §13.5.';
revoke all on function hts_rag.validate_affected_product_ids() from public, anon, authenticated, service_role;
create trigger validate_affected_product_ids
before insert or update on hts_rag.hts_rag_ruling_links
for each row execute function hts_rag.validate_affected_product_ids();

create materialized view hts_rag.hts_rag_fault_lines as
with pairs as (
  select p.id as product_id, p.article_type_id,
         coalesce(held.code_prefix, held.heading) as held_prefix,
         coalesce(rej.code_prefix, rej.heading) as rejected_prefix,
         held.id as held_decision_id, rej.id as rejected_decision_id
    from hts_rag.hts_rag_ruling_products p
    join hts_rag.hts_rag_heading_decisions held on held.product_id = p.id and held.outcome = 'held'
    join hts_rag.hts_rag_heading_decisions rej on rej.product_id = p.id and rej.outcome = 'rejected'
   where p.effective_status = 'active' and p.review_state = 'trusted'
)
select least(pr.held_prefix, pr.rejected_prefix) as prefix_a,
       greatest(pr.held_prefix, pr.rejected_prefix) as prefix_b,
       pr.article_type_id,
       dt.test_id,
       df.attribute_key,
       count(distinct pr.product_id) as n_products,
       count(distinct pr.product_id) filter (where pr.held_prefix < pr.rejected_prefix) as n_held_a,
       count(distinct pr.product_id) filter (where pr.held_prefix > pr.rejected_prefix) as n_held_b,
       (array_agg(distinct pr.product_id))[1:3] as example_products
  from pairs pr
  join hts_rag.hts_rag_decision_tests dt on dt.decision_id in (pr.held_decision_id, pr.rejected_decision_id)
  join hts_rag.hts_rag_decision_facts df on df.decision_test_id = dt.id
 group by 1, 2, 3, 4, 5
with no data;
create unique index hts_rag_fault_lines_uq
  on hts_rag.hts_rag_fault_lines (prefix_a, prefix_b, article_type_id, test_id, attribute_key) nulls not distinct;
comment on materialized view hts_rag.hts_rag_fault_lines is
  'For competing code prefixes A and B per article type: which test and attribute key split them, with counts per side and three example products. §13.4.';

create materialized view hts_rag.hts_rag_fault_lines_any_type as
with pairs as (
  select p.id as product_id, p.article_type_id,
         coalesce(held.code_prefix, held.heading) as held_prefix,
         coalesce(rej.code_prefix, rej.heading) as rejected_prefix,
         held.id as held_decision_id, rej.id as rejected_decision_id
    from hts_rag.hts_rag_ruling_products p
    join hts_rag.hts_rag_heading_decisions held on held.product_id = p.id and held.outcome = 'held'
    join hts_rag.hts_rag_heading_decisions rej on rej.product_id = p.id and rej.outcome = 'rejected'
   where p.effective_status = 'active' and p.review_state = 'trusted'
)
select least(pr.held_prefix, pr.rejected_prefix) as prefix_a,
       greatest(pr.held_prefix, pr.rejected_prefix) as prefix_b,
       dt.test_id,
       df.attribute_key,
       count(distinct pr.product_id) as n_products,
       count(distinct pr.product_id) filter (where pr.held_prefix < pr.rejected_prefix) as n_held_a,
       count(distinct pr.product_id) filter (where pr.held_prefix > pr.rejected_prefix) as n_held_b,
       (array_agg(distinct pr.product_id))[1:3] as example_products
  from pairs pr
  join hts_rag.hts_rag_decision_tests dt on dt.decision_id in (pr.held_decision_id, pr.rejected_decision_id)
  join hts_rag.hts_rag_decision_facts df on df.decision_test_id = dt.id
 group by 1, 2, 3, 4
with no data;
create unique index hts_rag_fault_lines_any_type_uq
  on hts_rag.hts_rag_fault_lines_any_type (prefix_a, prefix_b, test_id, attribute_key);
comment on materialized view hts_rag.hts_rag_fault_lines_any_type is
  'hts_rag_fault_lines without the article type, for rare or unresolved types. §13.4.';

revoke all on hts_rag.hts_rag_fault_lines, hts_rag.hts_rag_fault_lines_any_type
  from public, anon, authenticated, service_role;
grant select on hts_rag.hts_rag_fault_lines, hts_rag.hts_rag_fault_lines_any_type
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;

create function hts_rag.hts_rag_refresh_fault_lines()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from pg_matviews where schemaname = 'hts_rag' and matviewname = 'hts_rag_fault_lines' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_fault_lines;
  else
    refresh materialized view hts_rag.hts_rag_fault_lines;
  end if;
  if exists (select 1 from pg_matviews where schemaname = 'hts_rag' and matviewname = 'hts_rag_fault_lines_any_type' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_fault_lines_any_type;
  else
    refresh materialized view hts_rag.hts_rag_fault_lines_any_type;
  end if;
end;
$$;
comment on function hts_rag.hts_rag_refresh_fault_lines() is
  'designflow-backend#254 §13.4. Refreshes both fault-line views after a reasoning extraction batch.';
revoke all on function hts_rag.hts_rag_refresh_fault_lines() from public, anon, authenticated, service_role;
grant execute on function hts_rag.hts_rag_refresh_fault_lines() to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Seed vocabulary: 25 tests anchored to law (GRIs, notes, ENs, leading cases), §13.3.
insert into hts_rag.hts_rag_authorities (kind, ref, ref_norm, source_environment) values
  ('gri', 'GRI 1', 'gri 1', 'production'),
  ('gri', 'GRI 2(a)', 'gri 2(a)', 'production'),
  ('gri', 'GRI 2(b)', 'gri 2(b)', 'production'),
  ('gri', 'GRI 3(a)', 'gri 3(a)', 'production'),
  ('gri', 'GRI 3(b)', 'gri 3(b)', 'production'),
  ('gri', 'GRI 3(c)', 'gri 3(c)', 'production'),
  ('gri', 'GRI 4', 'gri 4', 'production'),
  ('gri', 'GRI 5(a)', 'gri 5(a)', 'production'),
  ('gri', 'GRI 5(b)', 'gri 5(b)', 'production'),
  ('gri', 'GRI 6', 'gri 6', 'production'),
  ('additional_us_note', 'Additional U.S. Rule of Interpretation 1(a)', 'ausr 1(a)', 'production'),
  ('additional_us_note', 'Additional U.S. Rule of Interpretation 1(b)', 'ausr 1(b)', 'production'),
  ('additional_us_note', 'Additional U.S. Rule of Interpretation 1(c)', 'ausr 1(c)', 'production'),
  ('chapter_note', 'Chapter 95 Note 1(v)', 'ch95 note 1(v)', 'production'),
  ('court_case', 'Midwest of Cannon Falls, Inc. v. United States', 'midwest of cannon falls', 'production'),
  ('court_case', 'Park B. Smith, Ltd. v. United States', 'park b. smith', 'production'),
  ('explanatory_note', 'Explanatory Note 95.03', 'en 95.03', 'production'),
  ('chapter_note', 'Chapter 94 Note 2', 'ch94 note 2', 'production'),
  ('explanatory_note', 'Explanatory Note 42.02', 'en 42.02', 'production'),
  ('section_note', 'Section XI Note 2', 'sec xi note 2', 'production'),
  ('section_note', 'Section XI Note 7', 'sec xi note 7', 'production'),
  ('chapter_note', 'Chapter 69 Note (porcelain or china)', 'ch69 porcelain definition', 'production'),
  ('explanatory_note', 'Explanatory Note GRI 3(b) (X)', 'en gri 3(b) x', 'production'),
  ('other', 'Eo nomine rule (judicial doctrine)', 'eo nomine rule', 'production'),
  ('other', 'Ejusdem generis (judicial doctrine)', 'ejusdem generis', 'production');
insert into hts_rag.hts_rag_classification_tests (canonical_name, kind, anchor_authority_id, vocab_version, source_environment) values
  ('GRI 1: terms of the headings and notes', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 1'), 1, 'production'),
  ('GRI 2(a): incomplete, unfinished or unassembled', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 2(a)'), 1, 'production'),
  ('GRI 2(b): mixtures and combinations of materials', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 2(b)'), 1, 'production'),
  ('GRI 3(a): most specific description', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 3(a)'), 1, 'production'),
  ('GRI 3(b): essential character', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 3(b)'), 1, 'production'),
  ('GRI 3(c): last in numerical order', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 3(c)'), 1, 'production'),
  ('GRI 4: most akin', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 4'), 1, 'production'),
  ('GRI 5(a): cases and containers', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 5(a)'), 1, 'production'),
  ('GRI 5(b): packing materials and containers', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 5(b)'), 1, 'production'),
  ('GRI 6: subheading classification', 'gri', (select id from hts_rag.hts_rag_authorities where ref_norm = 'gri 6'), 1, 'production'),
  ('Principal use (AUSR 1(a))', 'additional_us_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ausr 1(a)'), 1, 'production'),
  ('Actual use (AUSR 1(b))', 'additional_us_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ausr 1(b)'), 1, 'production'),
  ('Parts and accessories (AUSR 1(c))', 'additional_us_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ausr 1(c)'), 1, 'production'),
  ('Festive article exclusion (Chapter 95 Note 1(v))', 'chapter_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ch95 note 1(v)'), 1, 'production'),
  ('Festive article: closely associated with a festive occasion (Midwest of Cannon Falls)', 'judicial', (select id from hts_rag.hts_rag_authorities where ref_norm = 'midwest of cannon falls'), 1, 'production'),
  ('Festive article: utilitarian articles excluded (Park B. Smith)', 'judicial', (select id from hts_rag.hts_rag_authorities where ref_norm = 'park b. smith'), 1, 'production'),
  ('Toy: principally designed for amusement (EN 95.03)', 'explanatory_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'en 95.03'), 1, 'production'),
  ('Furniture designed to be placed on the floor (Chapter 94 Note 2)', 'chapter_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ch94 note 2'), 1, 'production'),
  ('Outer surface material (heading 4202 containers)', 'cbp_doctrine', (select id from hts_rag.hts_rag_authorities where ref_norm = 'en 42.02'), 1, 'production'),
  ('Textile fibre predominating by weight (Section XI Note 2)', 'section_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'sec xi note 2'), 1, 'production'),
  ('Made up textile article (Section XI Note 7)', 'section_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'sec xi note 7'), 1, 'production'),
  ('Porcelain or china definition (Chapter 69)', 'definitional', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ch69 porcelain definition'), 1, 'production'),
  ('Set put up for retail sale (EN GRI 3(b) X)', 'explanatory_note', (select id from hts_rag.hts_rag_authorities where ref_norm = 'en gri 3(b) x'), 1, 'production'),
  ('Eo nomine provision covers all forms of the article', 'judicial', (select id from hts_rag.hts_rag_authorities where ref_norm = 'eo nomine rule'), 1, 'production'),
  ('Ejusdem generis: same kind as the listed articles', 'judicial', (select id from hts_rag.hts_rag_authorities where ref_norm = 'ejusdem generis'), 1, 'production');
insert into hts_rag.hts_rag_test_aliases (alias, test_id, source_environment) values
  ('gri 1', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 1: terms of the headings and notes'), 'production'),
  ('terms of the headings', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 1: terms of the headings and notes'), 'production'),
  ('classification by description', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 1: terms of the headings and notes'), 'production'),
  ('gri 2(a)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 2(a): incomplete, unfinished or unassembled'), 'production'),
  ('unassembled', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 2(a): incomplete, unfinished or unassembled'), 'production'),
  ('incomplete or unfinished article', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 2(a): incomplete, unfinished or unassembled'), 'production'),
  ('gri 2(b)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 2(b): mixtures and combinations of materials'), 'production'),
  ('mixtures of materials', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 2(b): mixtures and combinations of materials'), 'production'),
  ('gri 3(a)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(a): most specific description'), 'production'),
  ('rule of relative specificity', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(a): most specific description'), 'production'),
  ('most specific description', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(a): most specific description'), 'production'),
  ('gri 3(b)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(b): essential character'), 'production'),
  ('essential character', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(b): essential character'), 'production'),
  ('gri 3(c)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(c): last in numerical order'), 'production'),
  ('last in numerical order', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 3(c): last in numerical order'), 'production'),
  ('gri 4', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 4: most akin'), 'production'),
  ('most akin', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 4: most akin'), 'production'),
  ('gri 5(a)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 5(a): cases and containers'), 'production'),
  ('specially shaped container', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 5(a): cases and containers'), 'production'),
  ('gri 5(b)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 5(b): packing materials and containers'), 'production'),
  ('packing materials', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 5(b): packing materials and containers'), 'production'),
  ('more than mere packaging', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 5(b): packing materials and containers'), 'production'),
  ('gri 6', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'GRI 6: subheading classification'), 'production'),
  ('ausr 1(a)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Principal use (AUSR 1(a))'), 'production'),
  ('principal use', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Principal use (AUSR 1(a))'), 'production'),
  ('principally used', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Principal use (AUSR 1(a))'), 'production'),
  ('ausr 1(b)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Actual use (AUSR 1(b))'), 'production'),
  ('actual use', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Actual use (AUSR 1(b))'), 'production'),
  ('ausr 1(c)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Parts and accessories (AUSR 1(c))'), 'production'),
  ('parts and accessories', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Parts and accessories (AUSR 1(c))'), 'production'),
  ('ch95 note 1(v)', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article exclusion (Chapter 95 Note 1(v))'), 'production'),
  ('festive article exclusion', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article exclusion (Chapter 95 Note 1(v))'), 'production'),
  ('festive article', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article: closely associated with a festive occasion (Midwest of Cannon Falls)'), 'production'),
  ('closely associated with a festive occasion', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article: closely associated with a festive occasion (Midwest of Cannon Falls)'), 'production'),
  ('midwest of cannon falls', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article: closely associated with a festive occasion (Midwest of Cannon Falls)'), 'production'),
  ('park b. smith', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article: utilitarian articles excluded (Park B. Smith)'), 'production'),
  ('utilitarian festive article', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Festive article: utilitarian articles excluded (Park B. Smith)'), 'production'),
  ('en 95.03', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Toy: principally designed for amusement (EN 95.03)'), 'production'),
  ('principally for amusement', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Toy: principally designed for amusement (EN 95.03)'), 'production'),
  ('amusement value', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Toy: principally designed for amusement (EN 95.03)'), 'production'),
  ('ch94 note 2', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Furniture designed to be placed on the floor (Chapter 94 Note 2)'), 'production'),
  ('designed to be placed on the floor', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Furniture designed to be placed on the floor (Chapter 94 Note 2)'), 'production'),
  ('outer surface', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Outer surface material (heading 4202 containers)'), 'production'),
  ('material of the outer surface', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Outer surface material (heading 4202 containers)'), 'production'),
  ('sec xi note 2', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Textile fibre predominating by weight (Section XI Note 2)'), 'production'),
  ('predominates by weight', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Textile fibre predominating by weight (Section XI Note 2)'), 'production'),
  ('fibre weight', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Textile fibre predominating by weight (Section XI Note 2)'), 'production'),
  ('sec xi note 7', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Made up textile article (Section XI Note 7)'), 'production'),
  ('made up', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Made up textile article (Section XI Note 7)'), 'production'),
  ('porcelain or china', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Porcelain or china definition (Chapter 69)'), 'production'),
  ('porcelain definition', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Porcelain or china definition (Chapter 69)'), 'production'),
  ('set put up for retail sale', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Set put up for retail sale (EN GRI 3(b) X)'), 'production'),
  ('en gri 3(b) x', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Set put up for retail sale (EN GRI 3(b) X)'), 'production'),
  ('eo nomine', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Eo nomine provision covers all forms of the article'), 'production'),
  ('eo nomine provision', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Eo nomine provision covers all forms of the article'), 'production'),
  ('ejusdem generis', (select id from hts_rag.hts_rag_classification_tests where canonical_name = 'Ejusdem generis: same kind as the listed articles'), 'production');
