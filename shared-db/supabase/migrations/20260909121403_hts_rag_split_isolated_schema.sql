-- Issue #2403 (author claim #2418): create the empty, isolated schema
-- `hts_rag_split` holding nine tables structurally identical to the existing
-- `public.hts_rag_*` tables.
--
-- WHY THIS EXISTS.
-- designflow-backend carries an optional second database connection behind
-- HTS_RAG_DB_ENABLED (default OFF, pinned off in its cloudbuild.yaml) that
-- re-points only those nine models. An independent review approved a sandbox
-- trial on one condition: the secondary connection must resolve to DIFFERENT
-- PHYSICAL TABLES from the ones the primary connection reads, and those tables
-- must NOT already contain the rows the acceptance gate writes. Otherwise a
-- wrong-database read looks exactly like a correct one and the trial proves
-- nothing. This schema is that condition, and its EMPTINESS is the whole point.
--
-- TWO PROPERTIES THIS MIGRATION MUST PRESERVE.
--   1. NO ROWS ARE COPIED. There is no `create table ... as select` and no
--      `insert ... select` anywhere below. Every table is created empty and
--      stays empty. Emptiness is asserted in the verification block.
--   2. `public.hts_rag_*` IS NOT TOUCHED. This migration issues no alter, no
--      rename, no drop and no write against the `public` schema. The only
--      reference to `public` below is a read-only `to_regclass()` existence
--      probe in the verification block.
--
-- WHY EXPLICIT DDL AND NOT `like public.x including all`.
-- `create table ... (like source including all)` copies columns, defaults, not
-- null, check constraints, indexes, comments, storage and identity -- but it
-- does NOT copy PRIMARY KEY / UNIQUE constraints as constraints (it copies
-- their indexes only) and, decisively, it does NOT copy FOREIGN KEYS. Seven of
-- the nine tables here are joined by seven foreign keys internal to the set
-- (determinations -> precedents / product_examples, extraction_jobs ->
-- product_examples, precedent_rulings -> precedents / rulings,
-- provider_responses -> determinations / extraction_jobs). A LIKE clone would
-- silently drop all seven, so the pilot would run against a structurally
-- WEAKER copy and referential defects would not reproduce. LIKE also derives
-- its result from whatever `public` happens to hold at apply time, which makes
-- the migration non-deterministic across environments. Explicit DDL is used
-- instead, transcribed from the read-only structure dump taken from the live
-- DesignFlow non-production database on 2026-09-05 and recorded in issue #2403.
--
-- NO OUTBOUND FOREIGN KEYS. None of the nine tables reference anything outside
-- the set, and nothing outside the set references them, so the schema is
-- self-contained and reversible by dropping it.
--
-- SECURITY POSTURE (deliberate; stated here for review). The application
-- connects as the `postgres` role, which owns these tables and is therefore
-- unaffected. These tables are nonetheless created closed to the Data API: RLS
-- enabled with NO policy, all privileges revoked from PUBLIC / anon /
-- authenticated, and `service_role` granted. This is a deviation from
-- "structurally identical" in the direction of LESS exposure only; it never
-- widens access relative to `public.hts_rag_*`. It is applied because this is
-- an isolated pilot schema that no application front end should reach.

create schema if not exists hts_rag_split;

comment on schema hts_rag_split is
  'Issue #2403. Isolated, intentionally EMPTY mirror of the nine public.hts_rag_* tables, used as the second physical target for the designflow-backend HTS_RAG_DB_ENABLED pilot so that a wrong-database read stays detectable. Never backfill it from public.hts_rag_*: copying rows destroys the only property it was created for.';

-- =====================================================================================
-- hts_rag_rulings  (no inbound dependencies; created first)
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_rulings (
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
  constraint hts_rag_rulings_pkey primary key (id),
  constraint hts_rag_rulings_ruling_number_key unique (ruling_number),
  constraint hts_rag_rulings_tariffs_array_check check (jsonb_typeof(tariffs) = 'array'::text),
  constraint hts_rag_rulings_revoked_by_array_check check (jsonb_typeof(revoked_by) = 'array'::text),
  constraint hts_rag_rulings_modified_by_array_check check (jsonb_typeof(modified_by) = 'array'::text)
);

create index if not exists hts_rag_rulings_operationally_revoked_idx
  on hts_rag_split.hts_rag_rulings using btree (operationally_revoked);
create index if not exists hts_rag_rulings_ruling_date_idx
  on hts_rag_split.hts_rag_rulings using btree (ruling_date desc);

-- =====================================================================================
-- hts_rag_product_examples
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_product_examples (
  id               uuid        not null default gen_random_uuid(),
  product_family   text        not null,
  fixture_version  text        not null,
  fixture_hash     text        not null,
  input_hash       text        not null,
  facts            jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint hts_rag_product_examples_pkey primary key (id),
  constraint hts_rag_product_examples_fixture_version_fixture_hash_input_key
    unique (fixture_version, fixture_hash, input_hash),
  constraint hts_rag_product_examples_product_family_check check (btrim(product_family) <> ''::text),
  constraint hts_rag_product_examples_fixture_version_check check (btrim(fixture_version) <> ''::text),
  constraint hts_rag_product_examples_fixture_hash_check check (fixture_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_product_examples_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'::text),
  constraint hts_rag_product_examples_facts_check check (jsonb_typeof(facts) = 'object'::text)
);

create index if not exists hts_rag_product_examples_family_idx
  on hts_rag_split.hts_rag_product_examples using btree (product_family, created_at desc);

-- =====================================================================================
-- hts_rag_precedents
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_precedents (
  id                       uuid        not null default gen_random_uuid(),
  product_family           text        not null,
  fixture_version          text        not null,
  prompt_version           text        not null,
  classifier_model         text        not null,
  verifier_model           text        not null,
  extraction_version       text        not null,
  fixture_hash             text        not null,
  input_hash               text        not null,
  raw_result_hash          text        not null,
  normalized_facts         jsonb       not null default '{}'::jsonb,
  positive_attributes      jsonb       not null default '[]'::jsonb,
  negative_attributes      jsonb       not null default '[]'::jsonb,
  exclusions_checked       jsonb       not null default '[]'::jsonb,
  missing_critical_facts   jsonb       not null default '[]'::jsonb,
  conflicts                jsonb       not null default '[]'::jsonb,
  plausible_headings       jsonb       not null default '[]'::jsonb,
  proposed_hts             text            null,
  classification_state     text        not null,
  reasoning_summary        text            null,
  confidence_components    jsonb       not null default '{}'::jsonb,
  decision_card_candidate  boolean     not null default false,
  operative_eligible       boolean     not null default false,
  review_state             text        not null default 'unreviewed'::text,
  created_at               timestamptz not null default now(),
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
    check ((not operative_eligible) or (classification_state = 'provisional_complete'::text))
);

create index if not exists hts_rag_precedents_family_review_idx
  on hts_rag_split.hts_rag_precedents using btree (product_family, review_state, created_at desc);
create unique index if not exists hts_rag_precedents_extraction_idempotency_idx
  on hts_rag_split.hts_rag_precedents using btree
  (fixture_version, prompt_version, classifier_model, verifier_model, extraction_version, fixture_hash, input_hash, raw_result_hash);

-- =====================================================================================
-- hts_rag_precedent_rulings
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_precedent_rulings (
  id                    uuid        not null default gen_random_uuid(),
  precedent_id          uuid        not null,
  ruling_id             uuid        not null,
  provisional_claim     text            null,
  verifier_relevance    text        not null default 'unverified'::text,
  source_status         text        not null default 'unknown'::text,
  final_relationship    text            null,
  verifier_result_hash  text            null,
  created_at            timestamptz not null default now(),
  constraint hts_rag_precedent_rulings_pkey primary key (id),
  constraint hts_rag_precedent_rulings_precedent_id_ruling_id_key unique (precedent_id, ruling_id),
  constraint hts_rag_precedent_rulings_precedent_id_fkey
    foreign key (precedent_id) references hts_rag_split.hts_rag_precedents(id) on delete restrict,
  constraint hts_rag_precedent_rulings_ruling_id_fkey
    foreign key (ruling_id) references hts_rag_split.hts_rag_rulings(id) on delete restrict,
  constraint hts_rag_precedent_rulings_verifier_relevance_check
    check (verifier_relevance = any (array['unverified'::text, 'relevant'::text, 'unrelated'::text, 'conflicting'::text])),
  constraint hts_rag_precedent_rulings_source_status_check
    check (source_status = any (array['unknown'::text, 'active'::text, 'modified'::text, 'revoked'::text])),
  constraint hts_rag_precedent_rulings_final_relationship_check
    check ((final_relationship is null) or (final_relationship = any (array['relied_on'::text, 'supporting'::text, 'contrasting'::text, 'background'::text]))),
  constraint hts_rag_precedent_rulings_verifier_result_hash_check
    check ((verifier_result_hash is null) or (verifier_result_hash ~ '^[0-9a-f]{64}$'::text))
);

create index if not exists hts_rag_precedent_rulings_relationship_idx
  on hts_rag_split.hts_rag_precedent_rulings using btree (final_relationship, verifier_relevance);
create index if not exists hts_rag_precedent_rulings_ruling_idx
  on hts_rag_split.hts_rag_precedent_rulings using btree (ruling_id);

-- =====================================================================================
-- hts_rag_extraction_jobs
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_extraction_jobs (
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
  constraint hts_rag_extraction_jobs_pkey primary key (id),
  constraint hts_rag_extraction_jobs_product_example_id_fkey
    foreign key (product_example_id) references hts_rag_split.hts_rag_product_examples(id) on delete restrict,
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
    check ((dead_lettered_at is null) or (status = any (array['failed'::text, 'cancelled'::text])))
);

create index if not exists hts_rag_extraction_jobs_pending_claim_idx
  on hts_rag_split.hts_rag_extraction_jobs using btree (available_at, created_at)
  where (status = 'pending'::text);
create unique index if not exists hts_rag_extraction_jobs_idempotency_idx
  on hts_rag_split.hts_rag_extraction_jobs using btree
  (product_example_id, prompt_version, model_version, extraction_version, input_hash);

-- =====================================================================================
-- hts_rag_determinations
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_determinations (
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
  constraint hts_rag_determinations_pkey primary key (id),
  constraint hts_rag_determinations_completion_key_uq unique (completion_key),
  constraint hts_rag_determinations_product_example_id_fkey
    foreign key (product_example_id) references hts_rag_split.hts_rag_product_examples(id) on delete restrict,
  constraint hts_rag_determinations_precedent_id_fkey
    foreign key (precedent_id) references hts_rag_split.hts_rag_precedents(id) on delete restrict,
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
    check ((completion_key is null) or (session_id is not null))
);

create index if not exists hts_rag_determinations_comparison_category_idx
  on hts_rag_split.hts_rag_determinations using btree (comparison_category, created_at desc);
create index if not exists hts_rag_determinations_comparison_review_idx
  on hts_rag_split.hts_rag_determinations using btree (comparison_key, comparison_review_state, created_at desc);
create index if not exists hts_rag_determinations_family_created_idx
  on hts_rag_split.hts_rag_determinations using btree (product_example_id, created_at desc);

-- =====================================================================================
-- hts_rag_provider_responses
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_provider_responses (
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
  constraint hts_rag_provider_responses_pkey primary key (id),
  constraint hts_rag_provider_responses_turn_uq unique (session_id, turn_role, turn_index),
  constraint hts_rag_provider_responses_determination_id_fkey
    foreign key (determination_id) references hts_rag_split.hts_rag_determinations(id) on delete restrict,
  constraint hts_rag_provider_responses_extraction_job_id_fkey
    foreign key (extraction_job_id) references hts_rag_split.hts_rag_extraction_jobs(id) on delete restrict,
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
    check ((determination_id is not null) or (extraction_job_id is not null))
);

create index if not exists hts_rag_provider_responses_determination_idx
  on hts_rag_split.hts_rag_provider_responses using btree (determination_id, turn_index)
  where (determination_id is not null);

-- =====================================================================================
-- hts_rag_review_events
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_review_events (
  id            uuid        not null default gen_random_uuid(),
  subject_type  text        not null,
  subject_id    uuid        not null,
  action        text        not null,
  prior_state   text            null,
  new_state     text            null,
  notes         text            null,
  reviewed_by   uuid            null default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint hts_rag_review_events_pkey primary key (id),
  constraint hts_rag_review_events_subject_type_check
    check (subject_type = any (array['precedent'::text, 'determination'::text, 'precedent_ruling'::text])),
  constraint hts_rag_review_events_action_check check (btrim(action) <> ''::text)
);

create index if not exists hts_rag_review_events_subject_created_idx
  on hts_rag_split.hts_rag_review_events using btree (subject_type, subject_id, created_at desc);

-- =====================================================================================
-- hts_rag_product_family_allowlist
-- =====================================================================================
create table if not exists hts_rag_split.hts_rag_product_family_allowlist (
  product_family  text        not null,
  enabled         boolean     not null default false,
  enabled_at      timestamptz     null,
  enabled_by      uuid            null,
  reason          text            null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint hts_rag_product_family_allowlist_pkey primary key (product_family),
  constraint hts_rag_product_family_allowlist_product_family_check check (btrim(product_family) <> ''::text),
  constraint hts_rag_product_family_allowlist_enabled_chk
    check (((not enabled) and (enabled_at is null) and (enabled_by is null))
        or (enabled and (enabled_at is not null) and (enabled_by is not null)
            and (btrim(coalesce(reason, ''::text)) <> ''::text)))
);

-- =====================================================================================
-- Security posture, applied to exactly the nine tables this migration creates.
-- =====================================================================================
alter table hts_rag_split.hts_rag_determinations enable row level security;
revoke all on table hts_rag_split.hts_rag_determinations from public;
revoke all on table hts_rag_split.hts_rag_determinations from anon;
revoke all on table hts_rag_split.hts_rag_determinations from authenticated;
grant all on table hts_rag_split.hts_rag_determinations to service_role;

alter table hts_rag_split.hts_rag_extraction_jobs enable row level security;
revoke all on table hts_rag_split.hts_rag_extraction_jobs from public;
revoke all on table hts_rag_split.hts_rag_extraction_jobs from anon;
revoke all on table hts_rag_split.hts_rag_extraction_jobs from authenticated;
grant all on table hts_rag_split.hts_rag_extraction_jobs to service_role;

alter table hts_rag_split.hts_rag_precedents enable row level security;
revoke all on table hts_rag_split.hts_rag_precedents from public;
revoke all on table hts_rag_split.hts_rag_precedents from anon;
revoke all on table hts_rag_split.hts_rag_precedents from authenticated;
grant all on table hts_rag_split.hts_rag_precedents to service_role;

alter table hts_rag_split.hts_rag_precedent_rulings enable row level security;
revoke all on table hts_rag_split.hts_rag_precedent_rulings from public;
revoke all on table hts_rag_split.hts_rag_precedent_rulings from anon;
revoke all on table hts_rag_split.hts_rag_precedent_rulings from authenticated;
grant all on table hts_rag_split.hts_rag_precedent_rulings to service_role;

alter table hts_rag_split.hts_rag_product_examples enable row level security;
revoke all on table hts_rag_split.hts_rag_product_examples from public;
revoke all on table hts_rag_split.hts_rag_product_examples from anon;
revoke all on table hts_rag_split.hts_rag_product_examples from authenticated;
grant all on table hts_rag_split.hts_rag_product_examples to service_role;

alter table hts_rag_split.hts_rag_product_family_allowlist enable row level security;
revoke all on table hts_rag_split.hts_rag_product_family_allowlist from public;
revoke all on table hts_rag_split.hts_rag_product_family_allowlist from anon;
revoke all on table hts_rag_split.hts_rag_product_family_allowlist from authenticated;
grant all on table hts_rag_split.hts_rag_product_family_allowlist to service_role;

alter table hts_rag_split.hts_rag_provider_responses enable row level security;
revoke all on table hts_rag_split.hts_rag_provider_responses from public;
revoke all on table hts_rag_split.hts_rag_provider_responses from anon;
revoke all on table hts_rag_split.hts_rag_provider_responses from authenticated;
grant all on table hts_rag_split.hts_rag_provider_responses to service_role;

alter table hts_rag_split.hts_rag_review_events enable row level security;
revoke all on table hts_rag_split.hts_rag_review_events from public;
revoke all on table hts_rag_split.hts_rag_review_events from anon;
revoke all on table hts_rag_split.hts_rag_review_events from authenticated;
grant all on table hts_rag_split.hts_rag_review_events to service_role;

alter table hts_rag_split.hts_rag_rulings enable row level security;
revoke all on table hts_rag_split.hts_rag_rulings from public;
revoke all on table hts_rag_split.hts_rag_rulings from anon;
revoke all on table hts_rag_split.hts_rag_rulings from authenticated;
grant all on table hts_rag_split.hts_rag_rulings to service_role;

-- =====================================================================================
-- POST-APPLY VERIFICATION -- asserts BEHAVIOUR, not "the statements ran".
-- Fails the apply if any of the nine tables is missing, if any is NOT empty, if
-- the seven internal foreign keys are not all present and inward-pointing, or
-- if the constraint and index populations from the issue #2403 structure dump
-- do not match.
-- =====================================================================================
do $$
declare
  v_table    text;
  v_expected text[] := array[
    'hts_rag_determinations',
    'hts_rag_extraction_jobs',
    'hts_rag_precedents',
    'hts_rag_precedent_rulings',
    'hts_rag_product_examples',
    'hts_rag_product_family_allowlist',
    'hts_rag_provider_responses',
    'hts_rag_review_events',
    'hts_rag_rulings'
  ];
  v_rows     bigint;
  v_count    bigint;
begin
  if to_regnamespace('hts_rag_split') is null then
    raise exception 'VERIFY FAILED: schema hts_rag_split does not exist';
  end if;

  -- Emptiness is the property the whole pilot depends on. Static SQL: every one of
  -- the nine tables is named literally, so this cannot silently skip a table.
  select sum(n) into v_rows from (
    select count(*) from hts_rag_split.hts_rag_determinations
    union all
    select count(*) from hts_rag_split.hts_rag_extraction_jobs
    union all
    select count(*) from hts_rag_split.hts_rag_precedents
    union all
    select count(*) from hts_rag_split.hts_rag_precedent_rulings
    union all
    select count(*) from hts_rag_split.hts_rag_product_examples
    union all
    select count(*) from hts_rag_split.hts_rag_product_family_allowlist
    union all
    select count(*) from hts_rag_split.hts_rag_provider_responses
    union all
    select count(*) from hts_rag_split.hts_rag_review_events
    union all
    select count(*) from hts_rag_split.hts_rag_rulings
  ) as counts(n);
  if v_rows <> 0 then
    raise exception 'VERIFY FAILED: schema hts_rag_split holds % row(s) in total; it must be EMPTY', v_rows;
  end if;

  foreach v_table in array v_expected
  loop
    if to_regclass('hts_rag_split.' || quote_ident(v_table)) is null then
      raise exception 'VERIFY FAILED: hts_rag_split.% does not exist', v_table;
    end if;

    select count(*) into v_count
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'hts_rag_split' and t.relname = v_table and c.contype = 'p';
    if v_count <> 1 then
      raise exception 'VERIFY FAILED: hts_rag_split.% has % primary key(s), expected 1', v_table, v_count;
    end if;

    select count(*) into v_count
      from pg_class t
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'hts_rag_split' and t.relname = v_table and t.relrowsecurity;
    if v_count <> 1 then
      raise exception 'VERIFY FAILED: hts_rag_split.% does not have row level security enabled', v_table;
    end if;

    if has_table_privilege('anon', format('hts_rag_split.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('hts_rag_split.%I', v_table), 'select') then
      raise exception 'VERIFY FAILED: hts_rag_split.% is readable by an application role', v_table;
    end if;
  end loop;

  -- Exactly the seven internal foreign keys, all of them pointing INSIDE this schema.
  select count(*) into v_count
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'hts_rag_split' and c.contype = 'f';
  if v_count <> 7 then
    raise exception 'VERIFY FAILED: hts_rag_split has % foreign key(s), expected 7', v_count;
  end if;

  select count(*) into v_count
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
   where n.nspname = 'hts_rag_split' and c.contype = 'f' and rn.nspname <> 'hts_rag_split';
  if v_count <> 0 then
    raise exception 'VERIFY FAILED: % foreign key(s) in hts_rag_split point outside the schema', v_count;
  end if;

  -- Check constraints: the #2403 structure dump carries 85 across the nine tables.
  select count(*) into v_count
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'hts_rag_split' and c.contype = 'c';
  if v_count <> 85 then
    raise exception 'VERIFY FAILED: hts_rag_split has % check constraint(s), expected 85', v_count;
  end if;

  -- Unique constraints named in the dump.
  select count(*) into v_count
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'hts_rag_split' and c.contype = 'u';
  if v_count <> 5 then
    raise exception 'VERIFY FAILED: hts_rag_split has % unique constraint(s), expected 5', v_count;
  end if;

  -- Every index in the dump, primary-key and unique-constraint indexes included.
  select count(*) into v_count from pg_indexes where schemaname = 'hts_rag_split';
  if v_count <> 28 then
    raise exception 'VERIFY FAILED: hts_rag_split has % index(es), expected 28', v_count;
  end if;

  -- READ-ONLY probe: the source tables must still be there. This migration does
  -- not modify them; the probe exists so a reviewer can see the assertion made.
  foreach v_table in array v_expected
  loop
    if to_regclass('public.' || quote_ident(v_table)) is null then
      raise exception 'VERIFY FAILED: public.% is missing; this migration must never touch it', v_table;
    end if;
  end loop;
end
$$;
