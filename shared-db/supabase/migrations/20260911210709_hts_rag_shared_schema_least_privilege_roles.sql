-- Issue #2712 (author claim #2763): governed shared HTS knowledge schema `hts_rag`
-- and four least-privilege NOLOGIN roles, for popcre/designflow-backend#94.
-- derived-from: none
--
-- WHAT THIS CREATES.
--   * schema hts_rag holding the complete ten-table HTS RAG contract: the nine
--     tables of the durable precedent contract as they stand after migrations
--     20260831234750, 20260901011306, 20260902062827, 20260904172420 and
--     20260907121706, plus hts_rag_debate_runs and the precedent promotion
--     provenance columns and immutability trigger from 20260908202651.
--   * four NOLOGIN roles:
--       designflow_hts_prod_runtime    production runtime, read-only, RLS-limited
--       designflow_hts_alsand_runtime  Alsand runtime, read-only, RLS-limited
--       designflow_hts_prod_worker     production worker, select/insert/bounded update
--       designflow_hts_alsand_worker   Alsand worker, select/insert/bounded update
--
-- SELF-CONTAINED ON PURPOSE. On production 20260907121706, 20260908202651 and
-- 20260909121403 are not applied, so this file depends on none of them. Every table
-- is transcribed as EXPLICIT DDL from 20260909121403 (itself transcribed from the
-- live structure dump) plus the 20260907121706 and 20260908202651 deltas.
-- `create table ... (like ... including all)` is not used: it drops every foreign
-- key, copies primary/unique constraints only as indexes, and derives the result
-- from whatever `public` holds at apply time (see 20260909121403).
--
-- WHAT THIS DOES NOT TOUCH. public.hts_rag_*, hts_rag_split, dflow and dflow_prod are
-- not altered, read or written. No row is copied into hts_rag. The Data API
-- exposed-schema list is not changed, so hts_rag has no browser/PostgREST path.
--
-- SECURITY CONTRACT.
--   * PUBLIC, anon, authenticated and service_role hold NO privilege on the schema,
--     any table, or the function. Only the four roles below are granted anything.
--   * Worker roles (identical rights): SELECT and INSERT on all ten tables, UPDATE
--     only on named mutable workflow columns, no DELETE or TRUNCATE anywhere, so
--     audit and evidence rows cannot be removed. Identity, hash, raw-artifact and
--     provenance columns are never updatable.
--   * Runtime roles (identical rights): SELECT only on precedents, precedent-ruling
--     links and rulings, and row level security limits them to QUALIFIED OPERATIVE
--     precedents and the public official evidence those precedents rely on.
--   * Every table carries `source_environment` ('production' | 'alsand'), NOT NULL
--     with no default, so every write must state its origin. It is provenance
--     METADATA, never authorization: no policy branches on it, and it is not updatable.
--   * One worker policy per role per table (`for all ... using (true)`): rows are not
--     partitioned for workers; the GRANT set is the write ceiling, and because no
--     DELETE is granted the FOR ALL policy cannot delete (the 20260901011306 lesson).
--   * Roles are NOLOGIN. No password appears in this public repository. Giving an
--     application a login that can assume one of these roles is a separate credential
--     step outside this migration.
--
-- PRIVACY CONTRACT (enforced by the application; recorded here for reviewers).
-- Allowed: normalized decisive facts, product/fingerprint hashes, public official
-- evidence, reviewer outputs, policy/model metadata, source environment and
-- determination id, hashes, promotion/refusal state, timestamps. Forbidden: user,
-- customer or licensor identity, RFQ/item ids, prices, attachments, raw chat or
-- unapproved free-form descriptions, auth/session tokens, provider secrets, hidden
-- reasoning, cache telemetry, unrelated operational history. Accordingly the public
-- table's `reviewed_by default auth.uid()` is NOT carried over: these roles have no
-- browser session, and an end-user auth id is identity data.

-- =====================================================================================
-- Roles. Plain `create role` (no if-not-exists): production was verified to hold no
-- designflow_hts* role, and a pre-existing role with unknown attributes or members
-- must fail the apply rather than be silently adopted.
-- =====================================================================================
create role designflow_hts_prod_runtime   nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_hts_alsand_runtime nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_hts_prod_worker    nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_hts_alsand_worker  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

-- =====================================================================================
-- Schema
-- =====================================================================================
create schema hts_rag;

comment on schema hts_rag is
  'Issue #2712. The sole shared HTS knowledge surface for production and Alsand. Not exposed to the Data API. Access only through the four designflow_hts_* roles.';

revoke all on schema hts_rag from public;
revoke all on schema hts_rag from anon;
revoke all on schema hts_rag from authenticated;
revoke all on schema hts_rag from service_role;
grant usage on schema hts_rag to designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
  designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- =====================================================================================
-- hts_rag_rulings  (public official evidence: CBP rulings)
-- =====================================================================================
create table hts_rag.hts_rag_rulings (
  id                     uuid        not null default gen_random_uuid(),
  ruling_number          text        not null,
  full_text              text        not null,
  full_text_hash         text        not null,
  subject                text            null,
  ruling_date            date            null,
  collection             text            null,
  tariffs                jsonb       not null default '[]'::jsonb,
  operationally_revoked  boolean     not null default false,
  revoked_by             jsonb       not null default '[]'::jsonb,
  modified_by            jsonb       not null default '[]'::jsonb,
  source_url             text            null,
  fetched_at             timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  source_environment     text        not null,
  constraint hts_rag_rulings_pkey primary key (id),
  constraint hts_rag_rulings_ruling_number_key unique (ruling_number),
  constraint hts_rag_rulings_tariffs_array_check check (jsonb_typeof(tariffs) = 'array'::text),
  constraint hts_rag_rulings_revoked_by_array_check check (jsonb_typeof(revoked_by) = 'array'::text),
  constraint hts_rag_rulings_modified_by_array_check check (jsonb_typeof(modified_by) = 'array'::text),
  constraint hts_rag_rulings_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_rulings_operationally_revoked_idx
  on hts_rag.hts_rag_rulings using btree (operationally_revoked);
create index hts_rag_rulings_ruling_date_idx
  on hts_rag.hts_rag_rulings using btree (ruling_date desc);

create trigger set_updated_at
before update on hts_rag.hts_rag_rulings
for each row execute function app.set_updated_at();

-- =====================================================================================
-- hts_rag_product_examples
-- =====================================================================================
create table hts_rag.hts_rag_product_examples (
  id                  uuid        not null default gen_random_uuid(),
  product_family      text        not null,
  fixture_version     text        not null,
  fixture_hash        text        not null,
  input_hash          text        not null,
  facts               jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  source_environment  text        not null,
  constraint hts_rag_product_examples_pkey primary key (id),
  constraint hts_rag_product_examples_fixture_version_fixture_hash_input_key
    unique (fixture_version, fixture_hash, input_hash),
  constraint hts_rag_product_examples_product_family_check check (btrim(product_family) <> ''::text),
  constraint hts_rag_product_examples_fixture_version_check check (btrim(fixture_version) <> ''::text),
  constraint hts_rag_product_examples_fixture_hash_check check (fixture_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_product_examples_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_product_examples_facts_check check (jsonb_typeof(facts) = 'object'::text),
  constraint hts_rag_product_examples_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_product_examples_family_idx
  on hts_rag.hts_rag_product_examples using btree (product_family, created_at desc);

-- =====================================================================================
-- hts_rag_precedents  (promotion provenance columns from 20260908202651 inline; the two
-- promotion foreign keys are added after their target tables exist)
-- =====================================================================================
create table hts_rag.hts_rag_precedents (
  id                                 uuid        not null default gen_random_uuid(),
  product_family                     text        not null,
  fixture_version                    text        not null,
  prompt_version                     text        not null,
  classifier_model                   text        not null,
  verifier_model                     text        not null,
  extraction_version                 text        not null,
  fixture_hash                       text        not null,
  input_hash                         text        not null,
  raw_result_hash                    text        not null,
  normalized_facts                   jsonb       not null default '{}'::jsonb,
  positive_attributes                jsonb       not null default '[]'::jsonb,
  negative_attributes                jsonb       not null default '[]'::jsonb,
  exclusions_checked                 jsonb       not null default '[]'::jsonb,
  missing_critical_facts             jsonb       not null default '[]'::jsonb,
  conflicts                          jsonb       not null default '[]'::jsonb,
  plausible_headings                 jsonb       not null default '[]'::jsonb,
  proposed_hts                       text            null,
  classification_state               text        not null,
  reasoning_summary                  text            null,
  confidence_components              jsonb       not null default '{}'::jsonb,
  decision_card_candidate            boolean     not null default false,
  operative_eligible                 boolean     not null default false,
  review_state                       text        not null default 'unreviewed'::text,
  created_at                         timestamptz not null default now(),
  promotion_basis                    text        not null default 'legacy_unspecified'::text,
  promotion_policy_version           text            null,
  promotion_source_determination_id  uuid            null,
  promotion_debate_run_id            uuid            null,
  promotion_gate_result              jsonb           null,
  source_environment                 text        not null,
  constraint hts_rag_precedents_pkey primary key (id),
  constraint hts_rag_precedents_product_family_check check (btrim(product_family) <> ''::text),
  constraint hts_rag_precedents_fixture_version_check check (btrim(fixture_version) <> ''::text),
  constraint hts_rag_precedents_prompt_version_check check (btrim(prompt_version) <> ''::text),
  constraint hts_rag_precedents_classifier_model_check check (btrim(classifier_model) <> ''::text),
  constraint hts_rag_precedents_verifier_model_check check (btrim(verifier_model) <> ''::text),
  constraint hts_rag_precedents_extraction_version_check check (btrim(extraction_version) <> ''::text),
  constraint hts_rag_precedents_fixture_hash_check check (fixture_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_precedents_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_precedents_raw_result_hash_check check (raw_result_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_precedents_normalized_facts_check check (jsonb_typeof(normalized_facts) = 'object'::text),
  constraint hts_rag_precedents_positive_attributes_check check (jsonb_typeof(positive_attributes) = 'array'::text),
  constraint hts_rag_precedents_negative_attributes_check check (jsonb_typeof(negative_attributes) = 'array'::text),
  constraint hts_rag_precedents_exclusions_checked_check check (jsonb_typeof(exclusions_checked) = 'array'::text),
  constraint hts_rag_precedents_missing_critical_facts_check check (jsonb_typeof(missing_critical_facts) = 'array'::text),
  constraint hts_rag_precedents_conflicts_check check (jsonb_typeof(conflicts) = 'array'::text),
  constraint hts_rag_precedents_plausible_headings_check check (jsonb_typeof(plausible_headings) = 'array'::text),
  constraint hts_rag_precedents_confidence_components_check check (jsonb_typeof(confidence_components) = 'object'::text),
  constraint hts_rag_precedents_proposed_hts_check
    check ((proposed_hts is null) or (proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$'::text)),
  constraint hts_rag_precedents_classification_state_check
    check (classification_state = any (array['needs_more_facts'::text, 'provisional_complete'::text])),
  constraint hts_rag_precedents_review_state_check
    check (review_state = any (array['unreviewed'::text, 'accepted'::text, 'rejected'::text, 'needs_revision'::text])),
  constraint hts_rag_precedents_operability_chk
    check ((not operative_eligible) or (classification_state = 'provisional_complete'::text)),
  constraint hts_rag_precedents_promotion_basis_chk
    check (promotion_basis in ('human_review', 'dual_model_verified', 'legacy_unspecified')),
  constraint hts_rag_precedents_promotion_policy_version_chk
    check (promotion_policy_version is null or btrim(promotion_policy_version) <> ''),
  constraint hts_rag_precedents_promotion_gate_result_chk
    check (promotion_gate_result is null or jsonb_typeof(promotion_gate_result) = 'object'),
  constraint hts_rag_precedents_dual_model_provenance_chk check (
    promotion_basis <> 'dual_model_verified'
    or (
      promotion_debate_run_id is not null
      and promotion_policy_version is not null
      and promotion_gate_result is not null
    )
  ),
  constraint hts_rag_precedents_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_precedents_family_review_idx
  on hts_rag.hts_rag_precedents using btree (product_family, review_state, created_at desc);
create unique index hts_rag_precedents_extraction_idempotency_idx
  on hts_rag.hts_rag_precedents using btree
  (fixture_version, prompt_version, classifier_model, verifier_model, extraction_version, fixture_hash, input_hash, raw_result_hash);

-- =====================================================================================
-- hts_rag_precedent_rulings
-- =====================================================================================
create table hts_rag.hts_rag_precedent_rulings (
  id                    uuid        not null default gen_random_uuid(),
  precedent_id          uuid        not null,
  ruling_id             uuid        not null,
  provisional_claim     text            null,
  verifier_relevance    text        not null default 'unverified'::text,
  source_status         text        not null default 'unknown'::text,
  final_relationship    text            null,
  verifier_result_hash  text            null,
  created_at            timestamptz not null default now(),
  source_environment    text        not null,
  constraint hts_rag_precedent_rulings_pkey primary key (id),
  constraint hts_rag_precedent_rulings_precedent_id_ruling_id_key unique (precedent_id, ruling_id),
  constraint hts_rag_precedent_rulings_precedent_id_fkey
    foreign key (precedent_id) references hts_rag.hts_rag_precedents(id) on delete restrict,
  constraint hts_rag_precedent_rulings_ruling_id_fkey
    foreign key (ruling_id) references hts_rag.hts_rag_rulings(id) on delete restrict,
  constraint hts_rag_precedent_rulings_verifier_relevance_check
    check (verifier_relevance = any (array['unverified'::text, 'relevant'::text, 'unrelated'::text, 'conflicting'::text])),
  constraint hts_rag_precedent_rulings_source_status_check
    check (source_status = any (array['unknown'::text, 'active'::text, 'modified'::text, 'revoked'::text])),
  constraint hts_rag_precedent_rulings_final_relationship_check
    check ((final_relationship is null) or (final_relationship = any (array['relied_on'::text, 'supporting'::text, 'contrasting'::text, 'background'::text]))),
  constraint hts_rag_precedent_rulings_verifier_result_hash_check
    check ((verifier_result_hash is null) or (verifier_result_hash ~ '^[0-9a-f]{64}$'::text)),
  constraint hts_rag_precedent_rulings_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_precedent_rulings_relationship_idx
  on hts_rag.hts_rag_precedent_rulings using btree (final_relationship, verifier_relevance);
create index hts_rag_precedent_rulings_ruling_idx
  on hts_rag.hts_rag_precedent_rulings using btree (ruling_id);

-- =====================================================================================
-- hts_rag_extraction_jobs
-- =====================================================================================
create table hts_rag.hts_rag_extraction_jobs (
  id                  uuid        not null default gen_random_uuid(),
  product_example_id  uuid        not null,
  prompt_version      text        not null,
  model_version       text        not null,
  extraction_version  text        not null,
  input_hash          text        not null,
  status              text        not null default 'pending'::text,
  available_at        timestamptz not null default now(),
  claimed_at          timestamptz     null,
  claimed_by          text            null,
  attempt_count       integer     not null default 0,
  result_hash         text            null,
  error_code          text            null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz     null,
  raw_extraction      jsonb           null,
  parse_state         text        not null default 'unparsed'::text,
  parse_error_code    text            null,
  max_attempts        integer     not null default 3,
  dead_lettered_at    timestamptz     null,
  dead_letter_reason  text            null,
  review_needed       boolean     not null default false,
  source_environment  text        not null,
  constraint hts_rag_extraction_jobs_pkey primary key (id),
  constraint hts_rag_extraction_jobs_product_example_id_fkey
    foreign key (product_example_id) references hts_rag.hts_rag_product_examples(id) on delete restrict,
  constraint hts_rag_extraction_jobs_prompt_version_check check (btrim(prompt_version) <> ''::text),
  constraint hts_rag_extraction_jobs_model_version_check check (btrim(model_version) <> ''::text),
  constraint hts_rag_extraction_jobs_extraction_version_check check (btrim(extraction_version) <> ''::text),
  constraint hts_rag_extraction_jobs_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_extraction_jobs_result_hash_check
    check ((result_hash is null) or (result_hash ~ '^[0-9a-f]{64}$'::text)),
  constraint hts_rag_extraction_jobs_status_check
    check (status = any (array['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])),
  constraint hts_rag_extraction_jobs_attempt_count_check check (attempt_count >= 0),
  constraint hts_rag_extraction_jobs_max_attempts_chk check (max_attempts >= 1),
  constraint hts_rag_extraction_jobs_claim_chk check ((claimed_at is null) = (claimed_by is null)),
  constraint hts_rag_extraction_jobs_pending_unclaimed_chk
    check ((status <> 'pending'::text) or (claimed_at is null)),
  constraint hts_rag_extraction_jobs_active_claim_chk
    check ((status <> all (array['running'::text, 'succeeded'::text])) or (claimed_at is not null)),
  constraint hts_rag_extraction_jobs_completion_chk
    check ((status = any (array['succeeded'::text, 'failed'::text, 'cancelled'::text])) = (completed_at is not null)),
  constraint hts_rag_extraction_jobs_success_result_chk
    check ((status <> 'succeeded'::text) or (result_hash is not null)),
  constraint hts_rag_extraction_jobs_retry_budget_chk
    check ((attempt_count < max_attempts) or (status = any (array['succeeded'::text, 'failed'::text, 'cancelled'::text]))),
  constraint hts_rag_extraction_jobs_raw_extraction_chk
    check ((raw_extraction is null) or (jsonb_typeof(raw_extraction) = 'object'::text)),
  constraint hts_rag_extraction_jobs_parse_state_chk
    check (parse_state = any (array['unparsed'::text, 'parsed'::text, 'unparseable'::text, 'enriched'::text])),
  constraint hts_rag_extraction_jobs_parse_artifact_chk
    check ((parse_state = 'unparsed'::text) or (raw_extraction is not null)),
  constraint hts_rag_extraction_jobs_parse_error_chk
    check ((parse_state <> 'unparseable'::text) or (btrim(coalesce(parse_error_code, ''::text)) <> ''::text)),
  constraint hts_rag_extraction_jobs_dead_letter_pair_chk
    check ((dead_lettered_at is null) = (dead_letter_reason is null)),
  constraint hts_rag_extraction_jobs_dead_letter_reason_chk
    check ((dead_letter_reason is null) or (btrim(dead_letter_reason) <> ''::text)),
  constraint hts_rag_extraction_jobs_dead_letter_terminal_chk
    check ((dead_lettered_at is null) or (status = any (array['failed'::text, 'cancelled'::text]))),
  constraint hts_rag_extraction_jobs_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_extraction_jobs_pending_claim_idx
  on hts_rag.hts_rag_extraction_jobs using btree (available_at, created_at)
  where (status = 'pending'::text);
create unique index hts_rag_extraction_jobs_idempotency_idx
  on hts_rag.hts_rag_extraction_jobs using btree
  (product_example_id, prompt_version, model_version, extraction_version, input_hash);

-- =====================================================================================
-- hts_rag_determinations  (includes the 20260907121706 operative proposed-HTS check)
-- =====================================================================================
create table hts_rag.hts_rag_determinations (
  id                       uuid        not null default gen_random_uuid(),
  product_example_id       uuid        not null,
  precedent_id             uuid            null,
  method                   text        not null,
  proposed_hts             text            null,
  classification_state     text        not null,
  operative_eligible       boolean     not null default false,
  result_hash              text        not null,
  comparison_key           uuid        not null,
  comparison_review_state  text        not null default 'unreviewed'::text,
  created_at               timestamptz not null default now(),
  comparison_category      text        not null default 'not_compared'::text,
  comparison_details       jsonb       not null default '{}'::jsonb,
  session_id               uuid            null,
  completion_key           text            null,
  source_environment       text        not null,
  constraint hts_rag_determinations_pkey primary key (id),
  constraint hts_rag_determinations_completion_key_uq unique (completion_key),
  constraint hts_rag_determinations_product_example_id_fkey
    foreign key (product_example_id) references hts_rag.hts_rag_product_examples(id) on delete restrict,
  constraint hts_rag_determinations_precedent_id_fkey
    foreign key (precedent_id) references hts_rag.hts_rag_precedents(id) on delete restrict,
  constraint hts_rag_determinations_method_check
    check (method = any (array['legacy_ai_cross'::text, 'rag_shadow'::text])),
  constraint hts_rag_determinations_proposed_hts_check
    check ((proposed_hts is null) or (proposed_hts ~ '^[0-9]{4}([.][0-9]{2}){0,3}$'::text)),
  constraint hts_rag_determinations_classification_state_check
    check (classification_state = any (array['needs_more_facts'::text, 'provisional_complete'::text])),
  constraint hts_rag_determinations_result_hash_check check (result_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_determinations_comparison_review_state_check
    check (comparison_review_state = any (array['unreviewed'::text, 'accepted'::text, 'rejected'::text, 'needs_revision'::text])),
  constraint hts_rag_determinations_comparison_category_chk
    check (comparison_category = any (array['not_compared'::text, 'agree'::text, 'agree_at_heading'::text, 'disagree'::text, 'incomparable'::text])),
  constraint hts_rag_determinations_comparison_details_chk
    check (jsonb_typeof(comparison_details) = 'object'::text),
  constraint hts_rag_determinations_operability_chk
    check ((not operative_eligible) or (classification_state = 'provisional_complete'::text)),
  constraint hts_rag_determinations_shadow_precedent_chk
    check ((method <> 'rag_shadow'::text) or (precedent_id is not null)),
  constraint hts_rag_determinations_completion_key_chk
    check ((completion_key is null) or (btrim(completion_key) <> ''::text)),
  constraint hts_rag_determinations_completion_session_chk
    check ((completion_key is null) or (session_id is not null)),
  constraint hts_rag_determinations_operative_proposed_hts_chk
    check (not operative_eligible or nullif(btrim(proposed_hts), '') is not null),
  constraint hts_rag_determinations_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_determinations_comparison_category_idx
  on hts_rag.hts_rag_determinations using btree (comparison_category, created_at desc);
create index hts_rag_determinations_comparison_review_idx
  on hts_rag.hts_rag_determinations using btree (comparison_key, comparison_review_state, created_at desc);
create index hts_rag_determinations_family_created_idx
  on hts_rag.hts_rag_determinations using btree (product_example_id, created_at desc);

-- =====================================================================================
-- hts_rag_provider_responses  (immutable provider artifacts, persisted before release)
-- =====================================================================================
create table hts_rag.hts_rag_provider_responses (
  id                 uuid        not null default gen_random_uuid(),
  session_id         uuid        not null,
  turn_index         integer     not null,
  turn_role          text        not null,
  determination_id   uuid            null,
  extraction_job_id  uuid            null,
  provider           text        not null,
  model_version      text        not null,
  prompt_version     text        not null,
  request_hash       text        not null,
  raw_response       jsonb       not null,
  raw_response_hash  text        not null,
  parse_state        text        not null default 'unparsed'::text,
  parsed_payload     jsonb           null,
  parse_error_code   text            null,
  enrichment_state   text        not null default 'none'::text,
  persisted_at       timestamptz not null default clock_timestamp(),
  released_at        timestamptz     null,
  created_at         timestamptz not null default now(),
  source_environment text        not null,
  constraint hts_rag_provider_responses_pkey primary key (id),
  constraint hts_rag_provider_responses_turn_uq unique (session_id, turn_role, turn_index),
  constraint hts_rag_provider_responses_determination_id_fkey
    foreign key (determination_id) references hts_rag.hts_rag_determinations(id) on delete restrict,
  constraint hts_rag_provider_responses_extraction_job_id_fkey
    foreign key (extraction_job_id) references hts_rag.hts_rag_extraction_jobs(id) on delete restrict,
  constraint hts_rag_provider_responses_turn_index_check check (turn_index >= 0),
  constraint hts_rag_provider_responses_turn_role_check
    check (turn_role = any (array['extractor'::text, 'classifier'::text, 'verifier'::text, 'legacy_ai_cross'::text])),
  constraint hts_rag_provider_responses_provider_check check (btrim(provider) <> ''::text),
  constraint hts_rag_provider_responses_model_version_check check (btrim(model_version) <> ''::text),
  constraint hts_rag_provider_responses_prompt_version_check check (btrim(prompt_version) <> ''::text),
  constraint hts_rag_provider_responses_request_hash_check check (request_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_provider_responses_raw_response_check check (jsonb_typeof(raw_response) = 'object'::text),
  constraint hts_rag_provider_responses_raw_response_hash_check check (raw_response_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_provider_responses_parse_state_check
    check (parse_state = any (array['unparsed'::text, 'parsed'::text, 'unparseable'::text, 'enriched'::text])),
  constraint hts_rag_provider_responses_parsed_payload_check
    check ((parsed_payload is null) or (jsonb_typeof(parsed_payload) = 'object'::text)),
  constraint hts_rag_provider_responses_parsed_payload_chk
    check ((parse_state <> all (array['parsed'::text, 'enriched'::text])) or (parsed_payload is not null)),
  constraint hts_rag_provider_responses_parse_error_chk
    check ((parse_state <> 'unparseable'::text) or (btrim(coalesce(parse_error_code, ''::text)) <> ''::text)),
  constraint hts_rag_provider_responses_enrichment_state_check
    check (enrichment_state = any (array['none'::text, 'pending'::text, 'enriched'::text, 'failed'::text])),
  constraint hts_rag_provider_responses_enrichment_chk
    check ((enrichment_state <> 'enriched'::text) or (parse_state = 'enriched'::text)),
  constraint hts_rag_provider_responses_release_order_chk
    check ((released_at is null) or (released_at >= persisted_at)),
  constraint hts_rag_provider_responses_subject_chk
    check ((determination_id is not null) or (extraction_job_id is not null)),
  constraint hts_rag_provider_responses_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_provider_responses_determination_idx
  on hts_rag.hts_rag_provider_responses using btree (determination_id, turn_index)
  where (determination_id is not null);

-- =====================================================================================
-- hts_rag_review_events  (append-only; no auth.uid() default -- see privacy note)
-- =====================================================================================
create table hts_rag.hts_rag_review_events (
  id                  uuid        not null default gen_random_uuid(),
  subject_type        text        not null,
  subject_id          uuid        not null,
  action              text        not null,
  prior_state         text            null,
  new_state           text            null,
  notes               text            null,
  reviewed_by         uuid            null,
  created_at          timestamptz not null default now(),
  source_environment  text        not null,
  constraint hts_rag_review_events_pkey primary key (id),
  constraint hts_rag_review_events_subject_type_check
    check (subject_type = any (array['precedent'::text, 'determination'::text, 'precedent_ruling'::text])),
  constraint hts_rag_review_events_action_check check (btrim(action) <> ''::text),
  constraint hts_rag_review_events_source_environment_chk check (source_environment in ('production', 'alsand'))
);

create index hts_rag_review_events_subject_created_idx
  on hts_rag.hts_rag_review_events using btree (subject_type, subject_id, created_at desc);

-- =====================================================================================
-- hts_rag_product_family_allowlist
-- =====================================================================================
create table hts_rag.hts_rag_product_family_allowlist (
  product_family      text        not null,
  enabled             boolean     not null default false,
  enabled_at          timestamptz     null,
  enabled_by          uuid            null,
  reason              text            null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  source_environment  text        not null,
  constraint hts_rag_product_family_allowlist_pkey primary key (product_family),
  constraint hts_rag_product_family_allowlist_product_family_check check (btrim(product_family) <> ''::text),
  constraint hts_rag_product_family_allowlist_enabled_chk
    check (((not enabled) and (enabled_at is null) and (enabled_by is null))
        or (enabled and (enabled_at is not null) and (enabled_by is not null)
            and (btrim(coalesce(reason, ''::text)) <> ''::text))),
  constraint hts_rag_product_family_allowlist_source_environment_chk check (source_environment in ('production', 'alsand'))
);

-- =====================================================================================
-- hts_rag_debate_runs  (20260908202651 dual-model debate audit)
-- =====================================================================================
create table hts_rag.hts_rag_debate_runs (
  id uuid primary key default gen_random_uuid(),
  source_determination_id uuid not null
    references hts_rag.hts_rag_determinations(id) on delete restrict,
  session_id uuid not null,
  policy_version text not null check (btrim(policy_version) <> ''),
  case_packet_hash text not null check (case_packet_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in (
      'pending', 'claimed', 'initial_opinions', 'debating', 'final_votes',
      'gating', 'promoted', 'not_proven', 'failed', 'dead_letter'
    )),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  turn_count integer not null default 0 check (turn_count >= 0),
  evidence_expansion_count integer not null default 0
    check (evidence_expansion_count >= 0),
  spark_initial_code text check (spark_initial_code is null or spark_initial_code ~ '^[0-9]{10}$'),
  luna_initial_code text check (luna_initial_code is null or luna_initial_code ~ '^[0-9]{10}$'),
  spark_final_code text check (spark_final_code is null or spark_final_code ~ '^[0-9]{10}$'),
  luna_final_code text check (luna_final_code is null or luna_final_code ~ '^[0-9]{10}$'),
  consensus_code text check (consensus_code is null or consensus_code ~ '^[0-9]{10}$'),
  stop_reason text check (stop_reason is null or stop_reason in (
    'converged', 'needs_more_facts', 'deadlocked', 'degraded', 'circuit_breaker'
  )),
  evidence_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_result) = 'object'),
  gate_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(gate_result) = 'object'),
  precedent_id uuid references hts_rag.hts_rag_precedents(id) on delete restrict,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  source_environment text not null
    constraint hts_rag_debate_runs_source_environment_chk check (source_environment in ('production', 'alsand')),
  constraint hts_rag_debate_runs_determination_policy_uq
    unique (source_determination_id, policy_version),
  constraint hts_rag_debate_runs_promoted_chk check (
    status <> 'promoted'
    or (
      consensus_code is not null
      and precedent_id is not null
      and gate_result @> '{"passed": true}'::jsonb
    )
  ),
  constraint hts_rag_debate_runs_terminal_completed_chk check (
    status not in ('promoted', 'not_proven', 'failed', 'dead_letter')
    or completed_at is not null
  )
);

create index hts_rag_debate_runs_claim_idx
  on hts_rag.hts_rag_debate_runs (status, lease_expires_at)
  where status in ('pending', 'claimed');
create index hts_rag_debate_runs_source_determination_idx
  on hts_rag.hts_rag_debate_runs (source_determination_id);
create index hts_rag_debate_runs_precedent_idx
  on hts_rag.hts_rag_debate_runs (precedent_id)
  where precedent_id is not null;

create trigger set_updated_at
before update on hts_rag.hts_rag_debate_runs
for each row execute function app.set_updated_at();

-- Precedent promotion foreign keys: their targets now exist.
alter table hts_rag.hts_rag_precedents
  add constraint hts_rag_precedents_promotion_source_determination_id_fkey
    foreign key (promotion_source_determination_id) references hts_rag.hts_rag_determinations(id) on delete restrict,
  add constraint hts_rag_precedents_promotion_debate_run_id_fkey
    foreign key (promotion_debate_run_id) references hts_rag.hts_rag_debate_runs(id) on delete restrict;

-- =====================================================================================
-- Promotion gate immutability (20260908202651, in this schema)
-- =====================================================================================
create function hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.promotion_gate_result is not null
     and new.promotion_gate_result is distinct from old.promotion_gate_result then
    raise exception using
      errcode = '23514',
      message = 'hts_rag_precedents.promotion_gate_result is immutable once set';
  end if;
  return new;
end
$function$;

revoke all on function hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()
  from public, anon, authenticated, service_role;

create trigger hts_rag_precedents_promotion_gate_immutable
before update of promotion_gate_result on hts_rag.hts_rag_precedents
for each row execute function hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable();

-- =====================================================================================
-- Row level security on every table; no privilege for PUBLIC or any Data API role.
-- =====================================================================================
alter table hts_rag.hts_rag_rulings enable row level security;
alter table hts_rag.hts_rag_product_examples enable row level security;
alter table hts_rag.hts_rag_precedents enable row level security;
alter table hts_rag.hts_rag_precedent_rulings enable row level security;
alter table hts_rag.hts_rag_extraction_jobs enable row level security;
alter table hts_rag.hts_rag_determinations enable row level security;
alter table hts_rag.hts_rag_provider_responses enable row level security;
alter table hts_rag.hts_rag_review_events enable row level security;
alter table hts_rag.hts_rag_product_family_allowlist enable row level security;
alter table hts_rag.hts_rag_debate_runs enable row level security;

revoke all on hts_rag.hts_rag_rulings, hts_rag.hts_rag_product_examples, hts_rag.hts_rag_precedents,
  hts_rag.hts_rag_precedent_rulings, hts_rag.hts_rag_extraction_jobs, hts_rag.hts_rag_determinations,
  hts_rag.hts_rag_provider_responses, hts_rag.hts_rag_review_events,
  hts_rag.hts_rag_product_family_allowlist, hts_rag.hts_rag_debate_runs
  from public, anon, authenticated, service_role;

-- =====================================================================================
-- Worker grants: select + insert everywhere, bounded column update, never delete.
-- =====================================================================================
grant select, insert on hts_rag.hts_rag_rulings, hts_rag.hts_rag_product_examples, hts_rag.hts_rag_precedents,
  hts_rag.hts_rag_precedent_rulings, hts_rag.hts_rag_extraction_jobs, hts_rag.hts_rag_determinations,
  hts_rag.hts_rag_provider_responses, hts_rag.hts_rag_review_events,
  hts_rag.hts_rag_product_family_allowlist, hts_rag.hts_rag_debate_runs
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Rulings: revocation/modification status and fetch metadata may be refreshed; the
-- ruling number, full text and its hash are immutable evidence.
grant update (subject, ruling_date, collection, tariffs, operationally_revoked, revoked_by, modified_by, source_url, fetched_at)
  on hts_rag.hts_rag_rulings to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Precedents: review and promotion workflow only. Extracted facts, hashes and model
-- metadata are immutable; promotion_gate_result is additionally set-once by trigger.
grant update (review_state, decision_card_candidate, operative_eligible, promotion_basis, promotion_policy_version,
  promotion_source_determination_id, promotion_debate_run_id, promotion_gate_result)
  on hts_rag.hts_rag_precedents to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Precedent-ruling links: verifier outcome only; the link identity is immutable.
grant update (provisional_claim, verifier_relevance, source_status, final_relationship, verifier_result_hash)
  on hts_rag.hts_rag_precedent_rulings to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Extraction jobs: queue state machine and the parse/dead-letter record.
grant update (status, available_at, claimed_at, claimed_by, attempt_count, result_hash, error_code, completed_at,
  raw_extraction, parse_state, parse_error_code, max_attempts, dead_lettered_at, dead_letter_reason, review_needed)
  on hts_rag.hts_rag_extraction_jobs to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Determinations: immutable outcome history; only the review transition moves.
grant update (comparison_review_state)
  on hts_rag.hts_rag_determinations to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Provider responses: the raw artifact is immutable; interpretation and release stamp only.
grant update (parse_state, parsed_payload, parse_error_code, enrichment_state, released_at)
  on hts_rag.hts_rag_provider_responses to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Allowlist: activation state only.
grant update (enabled, enabled_at, enabled_by, reason, updated_at)
  on hts_rag.hts_rag_product_family_allowlist to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- Debate runs: the bounded worker set from 20260908202651.
grant update (status, claimed_at, claimed_by, lease_expires_at, attempt_count, turn_count, evidence_expansion_count,
  spark_initial_code, luna_initial_code, spark_final_code, luna_final_code, consensus_code, stop_reason,
  evidence_result, gate_result, precedent_id, error_code, error_detail, completed_at)
  on hts_rag.hts_rag_debate_runs to designflow_hts_prod_worker, designflow_hts_alsand_worker;

-- hts_rag_product_examples and hts_rag_review_events receive no UPDATE at all.

-- =====================================================================================
-- Runtime grants: read only the three evidence-bearing tables; RLS narrows the rows.
-- =====================================================================================
grant select on hts_rag.hts_rag_precedents, hts_rag.hts_rag_precedent_rulings, hts_rag.hts_rag_rulings
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;

-- =====================================================================================
-- Worker policies: exact per-table, per-role. The GRANT set above is the write ceiling.
-- =====================================================================================
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_rulings for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_rulings for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_examples for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_examples for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedents for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedents for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_precedent_rulings for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_precedent_rulings for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_extraction_jobs for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_extraction_jobs for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_determinations for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_determinations for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_provider_responses for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_provider_responses for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_review_events for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_review_events for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_family_allowlist for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_family_allowlist for all to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_debate_runs for all to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_debate_runs for all to designflow_hts_alsand_worker using (true) with check (true);

-- =====================================================================================
-- Runtime policies. A QUALIFIED OPERATIVE precedent is operative_eligible (which the
-- table already ties to provisional_complete), carries a non-empty proposed HTS, and is
-- either human-accepted or dual-model verified and not since rejected or sent back.
-- Ruling links and rulings are visible only through such a precedent; the subqueries
-- run under the caller's own RLS, so the qualification is inherited, not restated.
-- =====================================================================================
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_precedents
  for select to designflow_hts_prod_runtime
  using (
    operative_eligible
    and nullif(btrim(proposed_hts), '') is not null
    and (review_state = 'accepted'
         or (promotion_basis = 'dual_model_verified' and review_state = 'unreviewed'))
  );
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_precedents
  for select to designflow_hts_alsand_runtime
  using (
    operative_eligible
    and nullif(btrim(proposed_hts), '') is not null
    and (review_state = 'accepted'
         or (promotion_basis = 'dual_model_verified' and review_state = 'unreviewed'))
  );

create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_precedent_rulings
  for select to designflow_hts_prod_runtime
  using (exists (select 1 from hts_rag.hts_rag_precedents p where p.id = precedent_id));
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_precedent_rulings
  for select to designflow_hts_alsand_runtime
  using (exists (select 1 from hts_rag.hts_rag_precedents p where p.id = precedent_id));

create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_rulings
  for select to designflow_hts_prod_runtime
  using (exists (select 1 from hts_rag.hts_rag_precedent_rulings pr where pr.ruling_id = hts_rag_rulings.id));
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_rulings
  for select to designflow_hts_alsand_runtime
  using (exists (select 1 from hts_rag.hts_rag_precedent_rulings pr where pr.ruling_id = hts_rag_rulings.id));

-- =====================================================================================
-- POST-APPLY VERIFICATION. Fails the apply if the security posture is not exactly as
-- stated above. Behavioural row-level proofs: supabase/tests/hts_rag_shared_schema_contract.sql.
-- =====================================================================================
do $verify$
declare
  v_table   text;
  v_role    text;
  v_priv    text;
  v_count   integer;
  v_tables  text[] := array[
    'hts_rag_rulings', 'hts_rag_product_examples', 'hts_rag_precedents', 'hts_rag_precedent_rulings',
    'hts_rag_extraction_jobs', 'hts_rag_determinations', 'hts_rag_provider_responses',
    'hts_rag_review_events', 'hts_rag_product_family_allowlist', 'hts_rag_debate_runs'];
  v_workers text[] := array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker'];
  v_runtime text[] := array['designflow_hts_prod_runtime', 'designflow_hts_alsand_runtime'];
begin
  if to_regnamespace('hts_rag') is null then
    raise exception 'VERIFY FAILED: schema hts_rag does not exist';
  end if;

  select count(*) into v_count from pg_roles
   where rolname = any (v_workers || v_runtime)
     and not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb
     and not rolreplication and not rolbypassrls and not rolinherit;
  if v_count <> 4 then
    raise exception 'VERIFY FAILED: expected four NOLOGIN least-privilege designflow_hts roles, got %', v_count;
  end if;

  if exists (
    select 1 from pg_namespace n
     cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
     where n.nspname = 'hts_rag'
       and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))) then
    raise exception 'VERIFY FAILED: PUBLIC or a Data API role holds a privilege on schema hts_rag';
  end if;

  foreach v_table in array v_tables loop
    if to_regclass('hts_rag.' || v_table) is null then
      raise exception 'VERIFY FAILED: hts_rag.% does not exist', v_table;
    end if;

    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'hts_rag' and c.relname = v_table and c.relrowsecurity) then
      raise exception 'VERIFY FAILED: RLS is not enabled on hts_rag.%', v_table;
    end if;

    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where n.nspname = 'hts_rag' and c.relname = v_table
         and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))) then
      raise exception 'VERIFY FAILED: PUBLIC or a Data API role holds a grant on hts_rag.%', v_table;
    end if;

    if exists (select 1 from information_schema.column_privileges
                where table_schema = 'hts_rag' and table_name = v_table
                  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) then
      raise exception 'VERIFY FAILED: PUBLIC or a Data API role holds a column grant on hts_rag.%', v_table;
    end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema = 'hts_rag' and table_name = v_table
                      and column_name = 'source_environment' and is_nullable = 'NO' and column_default is null) then
      raise exception 'VERIFY FAILED: hts_rag.% lacks a mandatory, default-free source_environment', v_table;
    end if;

    foreach v_role in array v_workers loop
      if not has_table_privilege(v_role, 'hts_rag.' || v_table, 'SELECT')
         or not has_table_privilege(v_role, 'hts_rag.' || v_table, 'INSERT') then
        raise exception 'VERIFY FAILED: % cannot select and insert on hts_rag.%', v_role, v_table;
      end if;
      foreach v_priv in array array['UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(v_role, 'hts_rag.' || v_table, v_priv) then
          raise exception 'VERIFY FAILED: % holds table-wide % on hts_rag.%', v_role, v_priv, v_table;
        end if;
      end loop;
      if has_column_privilege(v_role, 'hts_rag.' || v_table, 'source_environment', 'UPDATE') then
        raise exception 'VERIFY FAILED: % may rewrite source_environment on hts_rag.%', v_role, v_table;
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = v_table
                        and policyname = case v_role when 'designflow_hts_prod_worker' then 'hts_rag_prod_worker_access'
                                                     else 'hts_rag_alsand_worker_access' end
                        and roles = array[v_role]::name[]) then
        raise exception 'VERIFY FAILED: worker policy for % missing on hts_rag.%', v_role, v_table;
      end if;
    end loop;

    foreach v_role in array v_runtime loop
      if has_any_column_privilege(v_role, 'hts_rag.' || v_table, 'INSERT')
         or has_any_column_privilege(v_role, 'hts_rag.' || v_table, 'UPDATE')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'DELETE')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'TRUNCATE') then
        raise exception 'VERIFY FAILED: runtime role % can write hts_rag.%', v_role, v_table;
      end if;
      if has_table_privilege(v_role, 'hts_rag.' || v_table, 'SELECT')
         <> (v_table in ('hts_rag_precedents', 'hts_rag_precedent_rulings', 'hts_rag_rulings')) then
        raise exception 'VERIFY FAILED: runtime role % has the wrong SELECT posture on hts_rag.%', v_role, v_table;
      end if;
    end loop;
  end loop;

  select count(*) into v_count from pg_policies
   where schemaname = 'hts_rag' and policyname in ('hts_rag_prod_runtime_read', 'hts_rag_alsand_runtime_read')
     and cmd = 'SELECT' and tablename in ('hts_rag_precedents', 'hts_rag_precedent_rulings', 'hts_rag_rulings');
  if v_count <> 6 then
    raise exception 'VERIFY FAILED: expected six runtime read policies, got %', v_count;
  end if;
  select count(*) into v_count from pg_policies where schemaname = 'hts_rag';
  if v_count <> 26 then
    raise exception 'VERIFY FAILED: expected exactly 26 policies in hts_rag, got %', v_count;
  end if;

  -- 7 transcribed + 2 debate-run + 2 promotion = 11 foreign keys, all inward.
  select count(*) into v_count from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'hts_rag' and c.contype = 'f';
  if v_count <> 11 then
    raise exception 'VERIFY FAILED: hts_rag has % foreign keys, expected 11', v_count;
  end if;
  if exists (select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
              join pg_class rt on rt.oid = c.confrelid join pg_namespace rn on rn.oid = rt.relnamespace
             where n.nspname = 'hts_rag' and c.contype = 'f' and rn.nspname <> 'hts_rag') then
    raise exception 'VERIFY FAILED: an hts_rag foreign key points outside the schema';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'hts_rag.hts_rag_precedents'::regclass
                  and tgname = 'hts_rag_precedents_promotion_gate_immutable' and not tgisinternal) then
    raise exception 'VERIFY FAILED: promotion gate immutability trigger is missing';
  end if;

  if has_function_privilege('anon', 'hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()', 'EXECUTE') then
    raise exception 'VERIFY FAILED: a browser role may execute the promotion gate trigger function';
  end if;
end
$verify$;
