-- =====================================================================================
-- Paramount Creative Library -- capture-versioned landing schema, importer and API views.
--
-- Migration: 20260810020000_pmt_creative_library_landing.sql
-- Spec:      u2giants/shared-db issue #623 (build-ready specification).
-- Object claim: issue #625 -- this migration owns the plm.pmt_* and api.pmt_* namespaces
--               and touches NOTHING else.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The Paramount Creative
-- Library capture is business-confidential source data held under a commercial licensing
-- relationship, in the PRIVATE repository u2giants/licensor-source-data (paramount/).
-- Not one real Paramount title, property, entity name, source ID, asset ID, filename or
-- relationship row appears in this file, in any test fixture, or in any commit message.
--     SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime through plm.load_pmt_capture_chunk, fed by
-- tools/sync-paramount-creative-library.mjs, which reads the private checkout.
--
-- SCOPE SEMANTICS, carried on every table comment so no consumer can read a row without
-- its caveats: the capture reflects POP Creations' licensed account and its CURRENT
-- library view. It is NOT Paramount's worldwide catalogue. PRESENCE IS EVIDENCE.
-- ABSENCE IS NOT A DELETE INSTRUCTION AND NOT PROOF OF NONEXISTENCE.
--
-- WHAT IS NEVER STORED HERE: creative file bytes, previews, PDFs, ZIP contents, images,
-- video, credentials, cookies, tokens, authorization headers, signed download URLs.
--
-- SUPERSESSION NOTICE. AGENTS.md section 6.13 ruling 2 ("Paramount release 1 is FIVE
-- tables, not fifteen") and ruling 4 ("build waits for the second Paramount recon") were
-- written on 2026-08-07 while the deferred structures were unproven. The completed
-- capture has since returned and PROVES the franchise, brand, collection,
-- authorized-title and asset-link structures exist, which is the condition both rulings
-- named. Issue #623 therefore directs the complete build. Rulings 1, 3 and 5 are
-- unaffected and are honoured here: per-licensor landing tables (rule 1), the
-- authorized-title count stays CLOSED at 26 (rule 3), and nothing about sub-licensors
-- is modelled (rule 5).
--
-- Depends on (exact 14-digit versions):
--   20260621150815  app_core   -- core.property, core.character, app.has_any_role
--   20260807170000  opa landing -- the plm landing / api view / privilege-predicate
--                                  pattern this migration follows deliberately
--
-- RECONCILIATION BOUNDARY. Nullable references to core.property(id) and
-- core.character(id) are READ-ONLY pointers. Nothing here creates, renames, merges,
-- reparents, deactivates or deletes a canonical core.* record, changes a licensor
-- assignment, treats source absence as deletion, or populates a canonical relationship
-- table. Canonical promotion is a separate reviewed workstream.
-- =====================================================================================

-- =====================================================================================
-- SECTION 0. Shared helpers
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 0.1 The privilege predicate.
--
-- THE NULL-PERMISSIVE TRAP THIS AVOIDS. This shape is FORBIDDEN:
--     if not ( ... or auth.role() = 'service_role' ) then raise ...
-- Inside a migration auth.role() is NULL. `NULL = 'service_role'` is NULL, `false or NULL`
-- is NULL, and `if not NULL then` NEVER RUNS THE BODY. The guard reads strict and behaves
-- wide open. Contract: TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity.
--
-- It is a FUNCTION, not a DO block, so a contract test can call it and prove the NULL
-- case is REJECTED. It takes SESSION_USER, not CURRENT_USER: SECURITY DEFINER rewrites
-- current_user to the function owner, so a current_user check guards nothing.
-- -------------------------------------------------------------------------------------
create or replace function plm.pmt_loader_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function plm.pmt_loader_privilege_ok(text, text) is
'Privilege predicate for the Paramount Creative Library loader. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/supabase_admin. '
'NULL or empty on BOTH arguments returns FALSE. Written as a callable function rather than a '
'DO block so a contract test can prove the NULL case is rejected -- an anonymous block never '
'lands in pg_proc and cannot be tested. Takes SESSION_USER because SECURITY DEFINER rewrites '
'current_user to the function owner, making a current_user check useless.';

revoke all on function plm.pmt_loader_privilege_ok(text, text) from public;
grant execute on function plm.pmt_loader_privilege_ok(text, text) to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. plm.pmt_capture -- one row per scrape
-- =====================================================================================
create table plm.pmt_capture (
  capture_id        uuid primary key default gen_random_uuid(),

  status            text not null default 'loading',
  capture_kind      text not null,
  source_system     text not null default 'paramount_creative_library',
  source_url        text not null,          -- ORIGIN ONLY. Never a signed download URL.
  library_name      text not null,

  started_at        timestamptz not null,
  completed_at      timestamptz null,
  captured_by       text not null,

  -- Provenance of the private source, so any row can be traced back without publishing it.
  private_source_commit text not null,
  manifest_sha256       text not null,

  -- Scalar populations reported by the capture manifest. Every OTHER expected population
  -- lives in plm.pmt_capture_expectation, per capture -- deliberately NOT hard-coded into
  -- a permanent CHECK, because these are this capture's numbers and not a law.
  portal_global_asset_count         integer not null,
  licensed_title_count              integer not null,
  licensed_property_selection_count integer not null,
  property_result_row_count         integer not null,
  unique_asset_count                integer not null,
  metadata_batch_count              integer not null,
  failure_count                     integer not null default 0,
  anomaly_count                     integer not null default 0,

  -- Set by plm.validate_pmt_capture. finalize refuses without it.
  validated_at      timestamptz null,
  validation_passed boolean null,
  failure_message   text null,

  notes             text null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint pmt_capture_status_chk
    check (status in ('loading','validating','complete','failed','abandoned')),
  constraint pmt_capture_kind_chk
    check (capture_kind in ('full','targeted','test')),
  constraint pmt_capture_source_url_chk       check (btrim(source_url) <> ''),
  constraint pmt_capture_library_name_chk     check (btrim(library_name) <> ''),
  constraint pmt_capture_captured_by_chk      check (btrim(captured_by) <> ''),
  constraint pmt_capture_commit_chk           check (btrim(private_source_commit) <> ''),
  constraint pmt_capture_manifest_sha_chk     check (manifest_sha256 ~ '^[0-9a-f]{64}$'),

  constraint pmt_capture_counts_nonneg_chk check (
    portal_global_asset_count         >= 0 and
    licensed_title_count              >= 0 and
    licensed_property_selection_count >= 0 and
    property_result_row_count         >= 0 and
    unique_asset_count                >= 0 and
    metadata_batch_count              >= 0 and
    failure_count                     >= 0 and
    anomaly_count                     >= 0
  ),

  -- COMPLETE is the strongest claim this schema can make, so every part of it is a CHECK
  -- and not a convention: a completion timestamp, zero unresolved failures, and a
  -- validation run that actually passed. finalize cannot fake any of these.
  constraint pmt_capture_complete_requires_evidence_chk check (
    status <> 'complete'
    or (
      completed_at is not null
      and failure_count = 0
      and validated_at is not null
      and validation_passed is true
    )
  ),

  -- A failed capture must say why. Silence is not an acceptable failure record.
  constraint pmt_capture_failed_requires_message_chk check (
    status <> 'failed' or btrim(coalesce(failure_message, '')) <> ''
  )
);

-- The latest-complete-full-capture lookup that every api.pmt_* view depends on.
-- Only 'complete' + 'full' rows are indexed, which is the same predicate the views use:
-- a failed, test, loading, abandoned or targeted capture can never be selected as latest.
create index idx_pmt_capture_latest_complete_full
  on plm.pmt_capture (completed_at desc, capture_id desc)
  where status = 'complete' and capture_kind = 'full';

create index idx_pmt_capture_status on plm.pmt_capture (status, capture_kind);
create index idx_pmt_capture_started_at on plm.pmt_capture (started_at desc);

comment on table plm.pmt_capture is
'One row per Paramount Creative Library scrape. CAPTURE-VERSIONED: every completed capture '
'is retained permanently and a refresh NEVER overwrites an older one -- it is a new '
'capture_id. SCOPE: POP Creations'' licensed account and its CURRENT library view, NOT '
'Paramount''s worldwide catalogue. PRESENCE IS EVIDENCE; ABSENCE IS NOT A DELETE '
'INSTRUCTION AND NOT PROOF OF NONEXISTENCE. Only a status=complete, capture_kind=full row '
'may be served as the latest capture; loading, validating, failed, abandoned, targeted and '
'test captures are permanently ineligible. Business-confidential licensor data: never '
'publish a row, never send it to a third-party service, and NEVER commit one to this '
'PUBLIC repository.';

comment on column plm.pmt_capture.source_url is
'ORIGIN ONLY (scheme + host). Never a signed download URL, never a session-bearing URL, '
'never a query string carrying a token.';
comment on column plm.pmt_capture.portal_global_asset_count is
'The portal-wide current-library asset count OBSERVED by the capture. Context only. It is '
'much larger than unique_asset_count because most of the portal is outside this account''s '
'authorized scope. Do not treat the difference as missing data.';
comment on column plm.pmt_capture.property_result_row_count is
'Rows returned by the exact Property searches. LEGITIMATELY EXCEEDS unique_asset_count, '
'because Property scopes overlap and the same asset is returned under more than one '
'Property. This is not duplication to be cleaned up.';
comment on column plm.pmt_capture.manifest_sha256 is
'SHA-256 of the private capture manifest, computed by the loader BEFORE it connects. '
'finalize refuses when the manifest presented differs from the one the capture began with, '
'so a completed capture can never be re-pointed at different source files.';

-- =====================================================================================
-- SECTION 2. plm.pmt_capture_expectation -- the manifest's expected counts, per capture
--
-- WHY THIS TABLE EXISTS. The spec requires finalization to verify manifest expected
-- versus actual counts for every population, AND forbids hard-coding this capture's
-- counts into permanent database checks. Those two requirements can only both hold if
-- the expectations are DATA, supplied per capture by the loader from the manifest. A
-- CHECK constraint carrying 25,790 would be a law; this row is an assertion about one
-- capture, and the next capture brings its own.
-- =====================================================================================
create table plm.pmt_capture_expectation (
  capture_id     uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  population     text not null,
  expected_count bigint not null,
  source_hash    text not null,
  imported_at    timestamptz not null default now(),

  constraint pmt_capture_expectation_pkey primary key (capture_id, population),
  constraint pmt_capture_expectation_population_chk check (btrim(population) <> ''),
  constraint pmt_capture_expectation_count_chk check (expected_count >= 0)
);

comment on table plm.pmt_capture_expectation is
'Expected population counts read from the PRIVATE capture manifest at load time, one row '
'per population per capture. Finalization compares these to the actual loaded counts and '
'refuses on any mismatch. Deliberately DATA and not CHECK constraints: a capture''s counts '
'describe that capture, not a permanent law, and hard-coding them would make the next '
'refresh unshippable.';

-- =====================================================================================
-- SECTION 3. plm.pmt_capture_batch -- the full-metadata request batches
-- =====================================================================================
create table plm.pmt_capture_batch (
  capture_id           uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  batch_number         integer not null,

  expected_asset_count integer not null,
  returned_asset_count integer not null,
  first_asset_id       text not null,
  last_asset_id        text not null,
  http_status          integer not null,
  content_was_json     boolean not null,

  -- SHA-256 over the sorted, comma-joined ID lists. Equality of the two hashes is the
  -- ONLY thing that proves the portal returned exactly what was asked for; equal COUNTS
  -- do not, because a substitution keeps the count identical.
  requested_ids_sha256 text not null,
  returned_ids_sha256  text not null,
  id_sets_matched      boolean not null,

  complete             boolean not null,
  failure_message      text null,
  captured_at          timestamptz not null,

  source_hash          text not null,
  imported_at          timestamptz not null default now(),

  constraint pmt_capture_batch_pkey primary key (capture_id, batch_number),
  constraint pmt_capture_batch_number_chk check (batch_number >= 1),
  constraint pmt_capture_batch_counts_chk
    check (expected_asset_count >= 0 and returned_asset_count >= 0),
  constraint pmt_capture_batch_first_id_chk check (first_asset_id ~ '^[0-9a-f]{40}$'),
  constraint pmt_capture_batch_last_id_chk  check (last_asset_id  ~ '^[0-9a-f]{40}$'),
  constraint pmt_capture_batch_req_sha_chk  check (requested_ids_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pmt_capture_batch_ret_sha_chk  check (returned_ids_sha256  ~ '^[0-9a-f]{64}$'),

  -- The portal rejected requests of 200 with an HTML error page, so 100 is the proven
  -- ceiling. A batch claiming more than 100 was never actually served and cannot be
  -- complete.
  constraint pmt_capture_batch_complete_chk check (
    complete = false
    or (
      expected_asset_count <= 100
      and expected_asset_count > 0
      and http_status = 200
      and content_was_json is true
      and returned_asset_count = expected_asset_count
      and id_sets_matched is true
      and requested_ids_sha256 = returned_ids_sha256
      and failure_message is null
    )
  ),
  constraint pmt_capture_batch_incomplete_requires_message_chk check (
    complete = true or btrim(coalesce(failure_message, '')) <> ''
  )
);

create index idx_pmt_capture_batch_incomplete
  on plm.pmt_capture_batch (capture_id) where complete = false;

comment on table plm.pmt_capture_batch is
'One row per full-metadata request batch. A batch is complete ONLY on at most 100 requested '
'IDs, HTTP 200, a JSON body, equal expected/returned counts, and EXACT requested-vs-returned '
'ID-set equality proved by matching SHA-256 hashes of the sorted ID lists. Equal counts alone '
'are not proof: a substitution preserves the count. Incomplete batches block finalization.';

comment on column plm.pmt_capture_batch.requested_ids_sha256 is
'SHA-256 of the sorted, comma-joined REQUESTED asset IDs for this batch. The source capture '
'files record only the returned records, so the loader reconstructs the requested slice from '
'the deduplicated authorized-asset list in capture order and hashes that. The reconstruction '
'is falsifiable, not assumed: if it is wrong for any batch the hashes disagree, '
'id_sets_matched is false, and the batch cannot be complete.';

-- =====================================================================================
-- SECTION 4. plm.pmt_authorized_title -- the rights-list titles
-- =====================================================================================
create table plm.pmt_authorized_title (
  capture_id             uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  authorized_title_key   text not null,
  authorized_title_name  text not null,
  capture_status         text not null,
  resolved_property_count integer not null default 0,
  unique_asset_count      integer not null default 0,
  full_metadata_count     integer not null default 0,
  notes                  text null,

  source_hash            text not null,
  imported_at            timestamptz not null default now(),

  constraint pmt_authorized_title_pkey primary key (capture_id, authorized_title_key),
  constraint pmt_authorized_title_key_chk  check (btrim(authorized_title_key) <> ''),
  constraint pmt_authorized_title_name_chk check (btrim(authorized_title_name) <> ''),
  constraint pmt_authorized_title_status_chk check (
    capture_status in ('captured','licensed_but_not_present_in_current_portal_view')
  ),
  constraint pmt_authorized_title_counts_chk check (
    resolved_property_count >= 0 and unique_asset_count >= 0 and full_metadata_count >= 0
  ),
  -- A captured title's unique assets and full-metadata assets must agree. If they do not,
  -- some asset was found but never described, and the capture is not actually complete.
  constraint pmt_authorized_title_captured_metadata_chk check (
    capture_status <> 'captured' or unique_asset_count = full_metadata_count
  ),
  -- A portal-unavailable title carries zeros BY DEFINITION and must still be a row.
  constraint pmt_authorized_title_unavailable_zero_chk check (
    capture_status <> 'licensed_but_not_present_in_current_portal_view'
    or (resolved_property_count = 0 and unique_asset_count = 0 and full_metadata_count = 0)
  )
);

create index idx_pmt_authorized_title_name on plm.pmt_authorized_title (authorized_title_name);
create index idx_pmt_authorized_title_status on plm.pmt_authorized_title (capture_id, capture_status);

comment on table plm.pmt_authorized_title is
'Every title on POP Creations'' Paramount rights list, one row per title per capture, '
'INCLUDING the titles that were not present anywhere in this account''s current portal view. '
'Those carry capture_status = licensed_but_not_present_in_current_portal_view and zero counts. '
'ZERO IS NOT UNLICENSED and absence from the portal view is NOT proof that Paramount holds no '
'content for the title -- it is a fact about the view, recorded so nobody later concludes the '
'title was dropped. The rights-list count is CLOSED by owner ruling (AGENTS.md 6.13 ruling 3): '
'do not add, remove or hunt for extra titles here.';

-- =====================================================================================
-- SECTION 5. plm.pmt_property -- properties carried by authorized assets
--
-- Created before pmt_authorized_title_property because that table FKs into it.
-- =====================================================================================
create table plm.pmt_property (
  capture_id            uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  property_source_id    bigint not null,
  property_name         text not null,

  -- TRUE only for the exact Property selections used to establish authorized scope.
  -- FALSE for a property that merely appears in some authorized asset's metadata.
  is_licensed_selection boolean not null default false,

  -- Nullable READ-ONLY pointer into the canonical taxonomy. NULL at landing, always.
  core_property_id      uuid null references core.property(id) on delete restrict,
  resolution_status     text not null default 'unresolved',
  resolution_reason     text null,
  resolved_at           timestamptz null,
  resolved_by           text null,

  raw                   jsonb not null default '{}'::jsonb,
  source_hash           text not null,
  imported_at           timestamptz not null default now(),

  constraint pmt_property_pkey primary key (capture_id, property_source_id),
  constraint pmt_property_name_chk check (btrim(property_name) <> ''),
  constraint pmt_property_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  -- A resolved pointer without a status, or a matched status without a pointer, is a
  -- half-finished decision. Neither is allowed to sit in the table looking settled.
  constraint pmt_property_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_property_id is not null)
  )
);

create index idx_pmt_property_name on plm.pmt_property (property_name);
create index idx_pmt_property_licensed on plm.pmt_property (capture_id) where is_licensed_selection;
create index idx_pmt_property_core on plm.pmt_property (core_property_id) where core_property_id is not null;
create index idx_pmt_property_resolution on plm.pmt_property (resolution_status);

comment on table plm.pmt_property is
'Every Paramount property carried by an authorized asset in this capture -- NOT only the '
'exact Property selections (is_licensed_selection marks those). Keyed by Paramount''s source '
'ID, never by name. core_property_id is a NULLABLE, READ-ONLY reconciliation pointer: '
'resolution is recorded HERE and must NEVER mutate a core.property row. Creating, renaming, '
'merging, reparenting, deactivating or deleting a canonical record from a source import is '
'FORBIDDEN; canonical promotion is a separate reviewed workstream.';

-- =====================================================================================
-- SECTION 6. plm.pmt_authorized_title_property -- rights-list title -> Paramount property
-- =====================================================================================
create table plm.pmt_authorized_title_property (
  capture_id              uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  authorized_title_key    text not null,
  property_source_id      bigint not null,
  paramount_property_name text not null,
  reported_asset_count    integer not null default 0,
  mapping_status          text not null default 'mapped',
  notes                   text null,
  source_evidence         text not null default 'exact_property_selection',

  source_hash             text not null,
  imported_at             timestamptz not null default now(),

  constraint pmt_authorized_title_property_pkey
    primary key (capture_id, authorized_title_key, property_source_id),
  constraint pmt_authorized_title_property_title_fkey
    foreign key (capture_id, authorized_title_key)
    references plm.pmt_authorized_title(capture_id, authorized_title_key) on delete restrict,
  constraint pmt_authorized_title_property_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_authorized_title_property_name_chk check (btrim(paramount_property_name) <> ''),
  constraint pmt_authorized_title_property_count_chk check (reported_asset_count >= 0),
  constraint pmt_authorized_title_property_evidence_chk
    check (source_evidence = 'exact_property_selection')
);

create index idx_pmt_atp_property on plm.pmt_authorized_title_property (capture_id, property_source_id);
create index idx_pmt_atp_name on plm.pmt_authorized_title_property (paramount_property_name);

comment on table plm.pmt_authorized_title_property is
'Which Paramount property each rights-list title resolved to, established by an EXACT '
'Property selection in the portal. Both endpoints are FK-bound within the SAME capture, so a '
'mapping can never point at an entity from a different scrape.';

-- =====================================================================================
-- SECTION 7-10. The remaining entity tables
-- =====================================================================================
create table plm.pmt_franchise (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  franchise_source_id bigint not null,
  franchise_name      text not null,
  raw                 jsonb not null default '{}'::jsonb,
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_franchise_pkey primary key (capture_id, franchise_source_id),
  constraint pmt_franchise_name_chk check (btrim(franchise_name) <> '')
);
create index idx_pmt_franchise_name on plm.pmt_franchise (franchise_name);

comment on table plm.pmt_franchise is
'Paramount franchises observed in authorized asset metadata, keyed by source ID. Scope and '
'presence/absence semantics are those of plm.pmt_capture. Confidential licensor data: never '
'commit a row to this PUBLIC repository.';

create table plm.pmt_character (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  character_source_id bigint not null,
  character_name      text not null,

  core_character_id   uuid null references core.character(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_character_pkey primary key (capture_id, character_source_id),
  constraint pmt_character_name_chk check (btrim(character_name) <> ''),
  constraint pmt_character_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  constraint pmt_character_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_character_id is not null)
  )
);
create index idx_pmt_character_name on plm.pmt_character (character_name);
create index idx_pmt_character_core on plm.pmt_character (core_character_id) where core_character_id is not null;
create index idx_pmt_character_resolution on plm.pmt_character (resolution_status);

comment on table plm.pmt_character is
'Paramount characters observed in this capture, keyed by SOURCE CHARACTER ID -- never by name '
'and never by a property-character pair. The completed capture found no character source ID '
'assigned to more than one property in the explicit cascading field. NEVER MERGE CHARACTERS BY '
'NAME: two distinct source IDs sharing a display name are two identities until Paramount says '
'otherwise. core_character_id is a nullable READ-ONLY reconciliation pointer and resolution '
'must never mutate a core.character row.';

create table plm.pmt_collection (
  capture_id           uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  collection_source_id bigint not null,
  collection_name      text not null,
  paramount_term       text not null,
  raw                  jsonb not null default '{}'::jsonb,
  source_hash          text not null,
  imported_at          timestamptz not null default now(),

  constraint pmt_collection_pkey primary key (capture_id, collection_source_id),
  constraint pmt_collection_name_chk check (btrim(collection_name) <> ''),
  constraint pmt_collection_term_chk check (btrim(paramount_term) <> '')
);
create index idx_pmt_collection_name on plm.pmt_collection (collection_name);

comment on table plm.pmt_collection is
'The portal concept Paramount calls a Collection. These values ARE our style guides and '
'related creative collections. There is deliberately NO second source table named style '
'guide -- duplicating them would create two populations that drift. Business-facing '
'style-guide wording is provided by api.pmt_style_guides, which reads this table.';

create table plm.pmt_brand (
  capture_id      uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  brand_source_id bigint not null,
  brand_name      text not null,
  raw             jsonb not null default '{}'::jsonb,
  source_hash     text not null,
  imported_at     timestamptz not null default now(),

  constraint pmt_brand_pkey primary key (capture_id, brand_source_id),
  constraint pmt_brand_name_chk check (btrim(brand_name) <> '')
);
create index idx_pmt_brand_name on plm.pmt_brand (brand_name);

comment on table plm.pmt_brand is
'Paramount brands observed in authorized asset metadata, keyed by source ID. Scope and '
'presence/absence semantics are those of plm.pmt_capture.';

-- =====================================================================================
-- SECTION 11. plm.pmt_asset -- one row per portal ASSET RECORD
-- =====================================================================================
create table plm.pmt_asset (
  capture_id         uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id           text not null,
  asset_name         text not null,
  date_imported      timestamptz null,
  date_last_updated  timestamptz null,
  content_size_bytes bigint not null,
  content_type       text not null,
  mime_type          text not null,
  asset_version      integer not null,
  raw                jsonb not null default '{}'::jsonb,
  source_hash        text not null,
  imported_at        timestamptz not null default now(),

  constraint pmt_asset_pkey primary key (capture_id, asset_id),
  constraint pmt_asset_id_format_chk check (asset_id ~ '^[0-9a-f]{40}$'),
  constraint pmt_asset_name_chk check (btrim(asset_name) <> ''),
  constraint pmt_asset_size_chk check (content_size_bytes >= 0),
  constraint pmt_asset_version_chk check (asset_version >= 0),
  constraint pmt_asset_content_type_chk check (btrim(content_type) <> ''),
  constraint pmt_asset_mime_type_chk check (btrim(mime_type) <> '')
);

create index idx_pmt_asset_name on plm.pmt_asset (asset_name);
create index idx_pmt_asset_mime_type on plm.pmt_asset (mime_type);
create index idx_pmt_asset_content_type on plm.pmt_asset (content_type);
create index idx_pmt_asset_date_imported on plm.pmt_asset (date_imported desc);

comment on table plm.pmt_asset is
'One row per Paramount portal ASSET RECORD -- metadata only. A ZIP is ONE asset record; its '
'contents are not enumerated and are not stored. NO CREATIVE BYTES, previews, PDFs, images, '
'video or signed download URLs are held here or anywhere in plm.pmt_*. asset_id is Paramount''s '
'lowercase 40-character hexadecimal identifier and is the only key; names are not keys.';

-- =====================================================================================
-- SECTION 12-16. Asset relationship tables
--
-- All five share one shape and one rule: BOTH endpoints are FK-bound inside the SAME
-- capture, so a link can never straddle two scrapes or outlive an endpoint. Evidence is
-- pinned to full_asset_metadata -- these edges come from the asset's own metadata record
-- and from nowhere else.
-- =====================================================================================
create table plm.pmt_asset_property (
  capture_id         uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id           text not null,
  property_source_id bigint not null,
  source_evidence    text not null default 'full_asset_metadata',
  source_hash        text not null,
  imported_at        timestamptz not null default now(),

  constraint pmt_asset_property_pkey primary key (capture_id, asset_id, property_source_id),
  constraint pmt_asset_property_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_asset_property_property_fkey foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_asset_property_evidence_chk check (source_evidence = 'full_asset_metadata')
);
create index idx_pmt_asset_property_reverse on plm.pmt_asset_property (capture_id, property_source_id);

comment on table plm.pmt_asset_property is
'Asset -> property edges taken from FULL ASSET METADATA. Distinct from '
'plm.pmt_authorized_property_asset, which records exact-Property SEARCH CONTEXT. The two '
'answer different questions and must never be merged or substituted for one another.';

create table plm.pmt_asset_franchise (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id            text not null,
  franchise_source_id bigint not null,
  source_evidence     text not null default 'full_asset_metadata',
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_asset_franchise_pkey primary key (capture_id, asset_id, franchise_source_id),
  constraint pmt_asset_franchise_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_asset_franchise_franchise_fkey foreign key (capture_id, franchise_source_id)
    references plm.pmt_franchise(capture_id, franchise_source_id) on delete restrict,
  constraint pmt_asset_franchise_evidence_chk check (source_evidence = 'full_asset_metadata')
);
create index idx_pmt_asset_franchise_reverse on plm.pmt_asset_franchise (capture_id, franchise_source_id);

comment on table plm.pmt_asset_franchise is
'Asset -> franchise edges taken from FULL ASSET METADATA, capture-scoped on both endpoints.';

create table plm.pmt_asset_character (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id            text not null,
  character_source_id bigint not null,
  source_evidence     text not null default 'full_asset_metadata',
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_asset_character_pkey primary key (capture_id, asset_id, character_source_id),
  constraint pmt_asset_character_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_asset_character_character_fkey foreign key (capture_id, character_source_id)
    references plm.pmt_character(capture_id, character_source_id) on delete restrict,
  constraint pmt_asset_character_evidence_chk check (source_evidence = 'full_asset_metadata')
);
create index idx_pmt_asset_character_reverse on plm.pmt_asset_character (capture_id, character_source_id);

comment on table plm.pmt_asset_character is
'Asset -> character edges taken from FULL ASSET METADATA. THIS is the table that answers '
'"which asset shows this character" -- the question the deferred release-1 design could not '
'answer.';

create table plm.pmt_asset_collection (
  capture_id           uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id             text not null,
  collection_source_id bigint not null,
  source_evidence      text not null default 'full_asset_metadata',
  source_hash          text not null,
  imported_at          timestamptz not null default now(),

  constraint pmt_asset_collection_pkey primary key (capture_id, asset_id, collection_source_id),
  constraint pmt_asset_collection_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_asset_collection_collection_fkey foreign key (capture_id, collection_source_id)
    references plm.pmt_collection(capture_id, collection_source_id) on delete restrict,
  constraint pmt_asset_collection_evidence_chk check (source_evidence = 'full_asset_metadata')
);
create index idx_pmt_asset_collection_reverse on plm.pmt_asset_collection (capture_id, collection_source_id);

comment on table plm.pmt_asset_collection is
'Asset -> collection edges taken from FULL ASSET METADATA. Because a Paramount Collection IS '
'a style guide, this is the DIRECT asset-to-style-guide link, exposed with business wording '
'by api.pmt_style_guides.';

create table plm.pmt_asset_brand (
  capture_id      uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id        text not null,
  brand_source_id bigint not null,
  source_evidence text not null default 'full_asset_metadata',
  source_hash     text not null,
  imported_at     timestamptz not null default now(),

  constraint pmt_asset_brand_pkey primary key (capture_id, asset_id, brand_source_id),
  constraint pmt_asset_brand_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_asset_brand_brand_fkey foreign key (capture_id, brand_source_id)
    references plm.pmt_brand(capture_id, brand_source_id) on delete restrict,
  constraint pmt_asset_brand_evidence_chk check (source_evidence = 'full_asset_metadata')
);
create index idx_pmt_asset_brand_reverse on plm.pmt_asset_brand (capture_id, brand_source_id);

comment on table plm.pmt_asset_brand is
'Asset -> brand edges taken from FULL ASSET METADATA, capture-scoped on both endpoints.';

-- =====================================================================================
-- SECTION 17-18. Explicit cascading property pairs
--
-- EXPLICIT ONLY. These pairs exist because Paramount states them in a single cascading
-- field. A pair assembled by us from two separate metadata fields is NOT this, must never
-- be written here, and belongs in the co-occurrence evidence table instead.
-- =====================================================================================
create table plm.pmt_property_character (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  property_source_id  bigint not null,
  character_source_id bigint not null,
  source_evidence     text not null default 'explicit_cascading_pair',
  evidence_asset_count integer not null default 0,
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_property_character_pkey
    primary key (capture_id, property_source_id, character_source_id),
  constraint pmt_property_character_property_fkey foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_property_character_character_fkey foreign key (capture_id, character_source_id)
    references plm.pmt_character(capture_id, character_source_id) on delete restrict,
  constraint pmt_property_character_evidence_chk check (source_evidence = 'explicit_cascading_pair'),
  constraint pmt_property_character_count_chk check (evidence_asset_count >= 0)
);
create index idx_pmt_property_character_reverse
  on plm.pmt_property_character (capture_id, character_source_id);

comment on table plm.pmt_property_character is
'EXPLICIT cascading property->character pairs as Paramount states them in one field. NEVER '
'MANUFACTURE A ROW HERE from separate metadata fields -- an inferred pair is co-occurrence, '
'not a stated relationship, and inventing one turns a guess into an authority.';

create table plm.pmt_property_collection (
  capture_id           uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  property_source_id   bigint not null,
  collection_source_id bigint not null,
  source_evidence      text not null default 'explicit_cascading_pair',
  evidence_asset_count integer not null default 0,
  source_hash          text not null,
  imported_at          timestamptz not null default now(),

  constraint pmt_property_collection_pkey
    primary key (capture_id, property_source_id, collection_source_id),
  constraint pmt_property_collection_property_fkey foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_property_collection_collection_fkey foreign key (capture_id, collection_source_id)
    references plm.pmt_collection(capture_id, collection_source_id) on delete restrict,
  constraint pmt_property_collection_evidence_chk check (source_evidence = 'explicit_cascading_pair'),
  constraint pmt_property_collection_count_chk check (evidence_asset_count >= 0)
);
create index idx_pmt_property_collection_reverse
  on plm.pmt_property_collection (capture_id, collection_source_id);

comment on table plm.pmt_property_collection is
'EXPLICIT cascading property->collection (style guide) pairs as Paramount states them. Same '
'rule as plm.pmt_property_character: never manufactured from separate fields.';

-- =====================================================================================
-- SECTION 19. plm.pmt_property_franchise_evidence -- CO-OCCURRENCE, NOT A RELATIONSHIP
-- =====================================================================================
create table plm.pmt_property_franchise_evidence (
  capture_id          uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  property_source_id  bigint not null,
  franchise_source_id bigint not null,
  evidence_kind       text not null default 'asset_cooccurrence_not_direct_pair',
  evidence_asset_count integer not null default 0,
  is_direct_source_relationship boolean not null default false,
  source_hash         text not null,
  imported_at         timestamptz not null default now(),

  constraint pmt_property_franchise_evidence_pkey
    primary key (capture_id, property_source_id, franchise_source_id),
  constraint pmt_pfe_property_fkey foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_pfe_franchise_fkey foreign key (capture_id, franchise_source_id)
    references plm.pmt_franchise(capture_id, franchise_source_id) on delete restrict,
  constraint pmt_pfe_count_chk check (evidence_asset_count >= 0),

  -- HARD CHECKS, not defaults. A default can be overridden by an INSERT; these cannot.
  -- Paramount states no property->franchise pair anywhere. Everything in this table was
  -- inferred by us from assets that happened to carry both, and it must stay labelled that
  -- way forever. If Paramount ever DOES publish a direct pair, that is a new table and a
  -- new reviewed migration -- not a boolean flipped here.
  constraint pmt_pfe_kind_chk check (evidence_kind = 'asset_cooccurrence_not_direct_pair'),
  constraint pmt_pfe_not_direct_chk check (is_direct_source_relationship = false)
);
create index idx_pmt_pfe_reverse on plm.pmt_property_franchise_evidence (capture_id, franchise_source_id);

comment on table plm.pmt_property_franchise_evidence is
'CO-OCCURRENCE EVIDENCE ONLY. THIS IS NOT A RELATIONSHIP TABLE. Each row says "some assets '
'carry both this property and this franchise", which is an observation about assets, NOT a '
'statement by Paramount that the property belongs to the franchise. Paramount publishes no '
'direct property-franchise pair. Both evidence_kind and is_direct_source_relationship are '
'pinned by CHECK constraints, not merely defaulted, so no INSERT can quietly promote a '
'co-occurrence into an authority.';

-- =====================================================================================
-- SECTION 20. plm.pmt_authorized_property_asset -- exact Property SEARCH context
-- =====================================================================================
create table plm.pmt_authorized_property_asset (
  capture_id                 uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  licensed_property_source_id bigint not null,
  asset_id                   text not null,
  source_evidence            text not null default 'exact_property_search_result',
  source_hash                text not null,
  imported_at                timestamptz not null default now(),

  constraint pmt_authorized_property_asset_pkey
    primary key (capture_id, licensed_property_source_id, asset_id),
  constraint pmt_apa_property_fkey foreign key (capture_id, licensed_property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_apa_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_apa_evidence_chk check (source_evidence = 'exact_property_search_result')
);
create index idx_pmt_apa_asset on plm.pmt_authorized_property_asset (capture_id, asset_id);

comment on table plm.pmt_authorized_property_asset is
'The exact-Property SEARCH CONTEXT that established which assets this account is authorized '
'to see. INTENTIONALLY SEPARATE from plm.pmt_asset_property: this is "the asset came back '
'under this Property search", that is "the asset''s own metadata names this property". Row '
'count here legitimately EXCEEDS the unique asset count because Property scopes overlap and '
'one asset is returned under several searches.';

-- =====================================================================================
-- SECTION 21. plm.pmt_relationship_anomaly -- malformed source values, preserved
-- =====================================================================================
create table plm.pmt_relationship_anomaly (
  capture_id         uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  anomaly_id         bigint generated always as identity,
  asset_id           text not null,
  relationship_field text not null,
  raw_value          text not null,
  action             text not null,
  details            text null,
  source_hash        text not null,
  imported_at        timestamptz not null default now(),

  constraint pmt_relationship_anomaly_pkey primary key (capture_id, anomaly_id),
  constraint pmt_relationship_anomaly_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,
  constraint pmt_relationship_anomaly_field_chk check (btrim(relationship_field) <> ''),
  constraint pmt_relationship_anomaly_action_chk check (btrim(action) <> '')
);
create index idx_pmt_relationship_anomaly_asset on plm.pmt_relationship_anomaly (capture_id, asset_id);

comment on table plm.pmt_relationship_anomaly is
'Malformed source relationship values, PRESERVED VERBATIM. The missing endpoint is NEVER '
'inferred and an excluded row is NEVER quietly inserted into a valid link table: a guess '
'written into a link table is indistinguishable from a fact, and this table is what keeps '
'the two apart. raw_value is the source string exactly as captured.';

-- =====================================================================================
-- SECTION 22. plm.pmt_property_capture_log -- per exact-Property capture result
-- =====================================================================================
create table plm.pmt_property_capture_log (
  capture_id           uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  property_source_id   bigint not null,
  property_name        text not null,
  reported_asset_count integer not null,
  captured_asset_count integer not null,
  page_count           integer not null,
  complete             boolean not null,
  failure_message      text null,
  source_hash          text not null,
  imported_at          timestamptz not null default now(),

  constraint pmt_property_capture_log_pkey primary key (capture_id, property_source_id),
  constraint pmt_pcl_property_fkey foreign key (capture_id, property_source_id)
    references plm.pmt_property(capture_id, property_source_id) on delete restrict,
  constraint pmt_pcl_name_chk check (btrim(property_name) <> ''),
  constraint pmt_pcl_counts_chk check (
    reported_asset_count >= 0 and captured_asset_count >= 0 and page_count >= 0
  ),
  -- A complete Property capture means the portal''s own reported total was fully collected,
  -- across at least one page, with no failure. Anything less is a partial scrape.
  constraint pmt_pcl_complete_chk check (
    complete = false
    or (reported_asset_count = captured_asset_count
        and page_count >= 1
        and failure_message is null)
  ),
  constraint pmt_pcl_incomplete_requires_message_chk check (
    complete = true or btrim(coalesce(failure_message, '')) <> ''
  )
);
create index idx_pmt_pcl_incomplete on plm.pmt_property_capture_log (capture_id) where complete = false;

comment on table plm.pmt_property_capture_log is
'One row per exact Property search performed during the capture, with the portal''s reported '
'total against what was actually collected. An incomplete row blocks finalization: a Property '
'that was only partly scraped would otherwise look identical to a Property with fewer assets.';

-- =====================================================================================
-- SECTION 23. plm.pmt_shrink_override -- the audited exception to the refresh guard
-- =====================================================================================
create table plm.pmt_shrink_override (
  override_id        bigint generated always as identity primary key,
  capture_id         uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  compared_capture_id uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  population         text not null,
  old_count          bigint not null,
  new_count          bigint not null,
  reason             text not null,
  operator           text not null,
  approver           text not null,
  approved_at        timestamptz not null,
  created_at         timestamptz not null default now(),

  constraint pmt_shrink_override_population_chk check (btrim(population) <> ''),
  constraint pmt_shrink_override_reason_chk check (btrim(reason) <> ''),
  constraint pmt_shrink_override_operator_chk check (btrim(operator) <> ''),
  constraint pmt_shrink_override_approver_chk check (btrim(approver) <> ''),
  constraint pmt_shrink_override_counts_chk check (old_count >= 0 and new_count >= 0),
  -- The operator may not be their own approver. A one-person override is not an approval.
  constraint pmt_shrink_override_two_people_chk check (btrim(operator) <> btrim(approver)),
  constraint pmt_shrink_override_unique unique (capture_id, population)
);
create index idx_pmt_shrink_override_capture on plm.pmt_shrink_override (capture_id);

comment on table plm.pmt_shrink_override is
'The ONLY way past plm.pmt_refresh_shrink_check. Every override is an audit row carrying the '
'reason, the operator, the approver, the approval time, and both counts. Operator and approver '
'must be different people: a shrink override signed by one person is not an approval, it is a '
'bypass. Without a row here a shrinking refresh CANNOT finalize.';

-- =====================================================================================
-- SECTION 24. Immutability -- source fields are frozen once a capture completes
-- =====================================================================================
create or replace function plm.pmt_reject_completed_capture_change()
returns trigger
language plpgsql
as $$
declare
  v_capture uuid;
  v_status  text;
begin
  -- NEW is UNASSIGNED in a DELETE trigger. Reading new.capture_id there raises
  -- "record new is not assigned yet", so the branch comes BEFORE the read, not inside a
  -- coalesce over both.
  if tg_op = 'DELETE' then
    v_capture := old.capture_id;
  else
    v_capture := new.capture_id;
  end if;

  select c.status into v_status from plm.pmt_capture c where c.capture_id = v_capture;

  if v_status = 'complete' then
    raise exception
      'Paramount capture % is COMPLETE and its source rows are immutable; % on %.% is refused. '
      'A refresh is a NEW capture_id, never an edit of an old one -- editing completed evidence '
      'destroys the only record of what the portal actually said.',
      v_capture, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.pmt_reject_completed_capture_change() is
'Row trigger enforcing shared rule 11: source fields are immutable after capture completion. '
'Fires on UPDATE and DELETE of every plm.pmt_* source and relationship table and refuses when '
'the owning capture is complete. This is what makes "retain every completed capture '
'permanently" enforceable rather than a promise.';

-- Attach it to every source/relationship table. plm.pmt_capture itself is handled
-- separately below because finalize must be able to move it INTO the complete state.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on plm.%I '
      'for each row execute function plm.pmt_reject_completed_capture_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- plm.pmt_property and plm.pmt_character carry RECONCILIATION columns, which are OURS and
-- must stay editable after completion. The trigger above would freeze them too, so those
-- two get a narrower trigger that freezes only the SOURCE columns.
create or replace function plm.pmt_reject_completed_source_field_change()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select c.status into v_status from plm.pmt_capture c where c.capture_id = new.capture_id;
  if v_status <> 'complete' then
    return new;
  end if;

  if tg_table_name = 'pmt_property' then
    if new.property_source_id is distinct from old.property_source_id
       or new.property_name is distinct from old.property_name
       or new.is_licensed_selection is distinct from old.is_licensed_selection
       or new.raw is distinct from old.raw
       or new.source_hash is distinct from old.source_hash then
      raise exception 'Paramount capture % is COMPLETE: source fields of plm.pmt_property are '
        'immutable. Only the reconciliation columns (core_property_id, resolution_*) may change.',
        new.capture_id using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'pmt_character' then
    if new.character_source_id is distinct from old.character_source_id
       or new.character_name is distinct from old.character_name
       or new.raw is distinct from old.raw
       or new.source_hash is distinct from old.source_hash then
      raise exception 'Paramount capture % is COMPLETE: source fields of plm.pmt_character are '
        'immutable. Only the reconciliation columns (core_character_id, resolution_*) may change.',
        new.capture_id using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function plm.pmt_reject_completed_source_field_change() is
'Narrower immutability trigger for the two tables that carry reconciliation columns. Source '
'fields freeze on completion; core_property_id / core_character_id and the resolution columns '
'stay editable, because reconciliation is OUR decision made after the capture, not source data.';

drop trigger trg_pmt_property_immutable on plm.pmt_property;
drop trigger trg_pmt_character_immutable on plm.pmt_character;

create trigger trg_pmt_property_source_immutable
  before update on plm.pmt_property
  for each row execute function plm.pmt_reject_completed_source_field_change();
create trigger trg_pmt_character_source_immutable
  before update on plm.pmt_character
  for each row execute function plm.pmt_reject_completed_source_field_change();

-- DELETE stays fully blocked on both.
create or replace function plm.pmt_reject_completed_capture_delete()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select c.status into v_status from plm.pmt_capture c where c.capture_id = old.capture_id;
  if v_status = 'complete' then
    raise exception 'Paramount capture % is COMPLETE; deleting its evidence from %.% is refused.',
      old.capture_id, tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger trg_pmt_property_no_delete
  before delete on plm.pmt_property
  for each row execute function plm.pmt_reject_completed_capture_delete();
create trigger trg_pmt_character_no_delete
  before delete on plm.pmt_character
  for each row execute function plm.pmt_reject_completed_capture_delete();

-- The capture header itself: once complete, nothing on it may change and it may not be
-- deleted. finalize's own UPDATE runs while the row is still 'validating', so it passes.
create or replace function plm.pmt_capture_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'Paramount capture % is COMPLETE and may not be deleted. Completed '
        'captures are retained permanently.', old.capture_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'complete' then
    raise exception 'Paramount capture % is COMPLETE and immutable. A refresh is a NEW capture, '
      'never an edit of a completed one.', old.capture_id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_pmt_capture_freeze
  before update or delete on plm.pmt_capture
  for each row execute function plm.pmt_capture_freeze();

comment on function plm.pmt_capture_freeze() is
'Freezes a completed plm.pmt_capture row against UPDATE and DELETE, and maintains updated_at '
'while the capture is still in flight. finalize''s own UPDATE runs while the row is still '
'validating, so it is unaffected.';

-- =====================================================================================
-- SECTION 25. Security -- RLS, policies and grants on every plm.pmt_* table
--
-- AN RLS POLICY IS NOT A GRANT (AGENTS.md section 11). Both are required, so both are set
-- here for every table in one loop that cannot skip one by hand.
--
-- Posture: RLS on; read to approved app-schema roles only; NOTHING to anon; full rights to
-- service_role. Ordinary authenticated users get SELECT and no DML grant at all, so they
-- cannot mutate landing data even where a policy would permit the row.
--
-- WHY THERE IS NO `force row level security` HERE, WHICH LOOKS LIKE AN OMISSION.
-- An earlier draft of this migration set FORCE on every table, reasoning that the owner
-- (postgres, which is BYPASSRLS) would otherwise read past every policy. That reasoning is
-- correct about reads and CATASTROPHIC for this design: the import functions are SECURITY
-- DEFINER and therefore execute AS postgres, FORCE would subject postgres to the policies,
-- postgres matches NONE of them, and every single INSERT in plm.load_pmt_capture_chunk
-- would be silently filtered to zero rows. The loader would report success and load
-- nothing -- the exact silent-wrong-answer failure this repo exists to prevent.
-- This posture (enable, not force) is also what plm.opa_property_character already uses,
-- so the two licensor landings behave identically. If owner-level read-around ever needs
-- closing, it must be done WITH an explicit owner policy, not by adding FORCE alone.
-- =====================================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override'
  ]
  loop
    execute format('alter table plm.%I enable row level security', t);

    execute format(
      'create policy %I on plm.%I for select to authenticated using ('
      '  app.has_any_role(array[''administrator'',''sales'',''licensing'',''designer'']::app.app_role[])'
      ')', t || '_read', t);

    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to authenticated', t);
    execute format('grant select, insert, update, delete on plm.%I to service_role', t);
  end loop;
end;
$$;

-- service_role needs a policy of its own as well as the DML grant: an RLS policy is not a
-- GRANT and a GRANT is not a policy (AGENTS.md section 11), and with RLS enabled a role
-- matching no policy sees and writes nothing however wide its grants are.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override'
  ]
  loop
    execute format(
      'create policy %I on plm.%I for all to service_role using (true) with check (true)',
      t || '_service', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 26. Import functions
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 26.1 plm.begin_pmt_capture -- opens a capture in 'loading'
--
-- RESUMABLE BY DESIGN. Called twice with the same manifest hash and source commit it
-- returns the SAME in-flight capture instead of starting a second one, so a crashed loader
-- resumes rather than forking a duplicate half-load. Called with a DIFFERENT manifest while
-- one is in flight, it refuses: two different source sets must not share a capture_id.
-- -------------------------------------------------------------------------------------
create or replace function plm.begin_pmt_capture(
  p_capture_kind        text,
  p_source_url          text,
  p_library_name        text,
  p_started_at          timestamptz,
  p_captured_by         text,
  p_private_source_commit text,
  p_manifest_sha256     text,
  p_portal_global_asset_count integer,
  p_licensed_title_count integer,
  p_licensed_property_selection_count integer,
  p_property_result_row_count integer,
  p_unique_asset_count  integer,
  p_metadata_batch_count integer,
  p_expectations        jsonb default '{}'::jsonb,
  p_notes               text default null
)
returns uuid
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role     text := auth.role();
  v_capture  uuid;
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role %L / session_user %L may not begin a '
      'capture. Run as service_role or through the shared-db apply workflow.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  -- One Paramount import at a time, for the whole life of the transaction.
  perform pg_advisory_xact_lock(hashtext('plm.pmt_capture_import')::bigint);

  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Paramount import refused: manifest_sha256 must be 64 lowercase hex '
      'characters. Hash the manifest before connecting.' using errcode = 'P0001';
  end if;

  -- RESUME: same manifest, same commit, still in flight -> reuse it.
  select c.capture_id into v_capture
  from plm.pmt_capture c
  where c.status in ('loading','validating')
    and c.manifest_sha256 = p_manifest_sha256
    and c.private_source_commit = p_private_source_commit
  order by c.started_at desc
  limit 1;

  if v_capture is not null then
    update plm.pmt_capture set status = 'loading' where capture_id = v_capture;
    raise notice 'Resuming in-flight Paramount capture %.', v_capture;
    return v_capture;
  end if;

  -- A DIFFERENT manifest while one is in flight is a conflict, not a second capture.
  if exists (select 1 from plm.pmt_capture where status in ('loading','validating')) then
    raise exception 'Paramount import refused: another capture is already in flight with a '
      'different manifest. Finish, fail or abandon it before starting a new one.'
      using errcode = 'P0001';
  end if;

  -- A COMPLETED capture may never be re-opened or re-pointed.
  if exists (
    select 1 from plm.pmt_capture
    where status = 'complete' and manifest_sha256 = p_manifest_sha256
  ) then
    raise exception 'Paramount import refused: a COMPLETE capture already exists for this exact '
      'manifest. Completed captures are permanent and immutable; re-loading the same source '
      'would either duplicate it or overwrite evidence.' using errcode = 'P0001';
  end if;

  insert into plm.pmt_capture (
    status, capture_kind, source_url, library_name, started_at, captured_by,
    private_source_commit, manifest_sha256,
    portal_global_asset_count, licensed_title_count, licensed_property_selection_count,
    property_result_row_count, unique_asset_count, metadata_batch_count, notes
  ) values (
    'loading', p_capture_kind, p_source_url, p_library_name, p_started_at, p_captured_by,
    p_private_source_commit, p_manifest_sha256,
    p_portal_global_asset_count, p_licensed_title_count, p_licensed_property_selection_count,
    p_property_result_row_count, p_unique_asset_count, p_metadata_batch_count, p_notes
  )
  returning capture_id into v_capture;

  -- Manifest expectations, supplied as {"population": count, ...}.
  insert into plm.pmt_capture_expectation (capture_id, population, expected_count, source_hash)
  select v_capture, e.key, (e.value #>> '{}')::bigint, p_manifest_sha256
  from jsonb_each(coalesce(p_expectations, '{}'::jsonb)) e;

  return v_capture;
end;
$$;

comment on function plm.begin_pmt_capture(text,text,text,timestamptz,text,text,text,integer,integer,integer,integer,integer,integer,jsonb,text) is
'Opens a Paramount Creative Library capture in status loading and records the manifest''s '
'expected population counts. RESUMABLE: the same manifest hash and source commit returns the '
'SAME in-flight capture rather than forking a duplicate half-load. A different manifest while '
'one is in flight is refused, and a manifest already loaded by a COMPLETE capture is refused. '
'Serialized by an advisory lock. service_role only.';

-- -------------------------------------------------------------------------------------
-- 26.2 plm.load_pmt_capture_chunk -- the single bounded typed loading entry point
--
-- ONE function rather than 21 loaders, because 21 near-identical functions is 21 places for
-- the capture guard to be forgotten. The target table is validated against a fixed allow
-- list; there is no dynamic table name a caller can smuggle in.
-- -------------------------------------------------------------------------------------
create or replace function plm.load_pmt_capture_chunk(
  p_capture_id uuid,
  p_target     text,
  p_rows       jsonb
)
returns integer
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
  v_n      integer;
  v_count  integer;
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role %L / session_user %L may not load capture '
      'chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  select status into v_status from plm.pmt_capture where capture_id = p_capture_id;
  if v_status is null then
    raise exception 'Paramount import refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'loading' then
    raise exception 'Paramount import refused: capture % is %L, not loading. A capture that has '
      'left the loading state may not receive more rows.', p_capture_id, v_status
      using errcode = 'P0001';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Paramount import refused: rows must be a jsonb array, got %.',
      coalesce(jsonb_typeof(p_rows), 'null') using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    return 0;
  end if;
  -- BOUNDED. A 25,000-row single call would hold the advisory lock and a transaction open
  -- for minutes and lose everything on one bad row.
  if v_n > 5000 then
    raise exception 'Paramount import refused: chunk of % rows exceeds the 5000-row bound. '
      'Stream bounded chunks.', v_n using errcode = 'P0001';
  end if;

  if p_target = 'pmt_capture_batch' then
    insert into plm.pmt_capture_batch (
      capture_id, batch_number, expected_asset_count, returned_asset_count,
      first_asset_id, last_asset_id, http_status, content_was_json,
      requested_ids_sha256, returned_ids_sha256, id_sets_matched, complete,
      failure_message, captured_at, source_hash)
    select p_capture_id,
      (r->>'batch_number')::integer, (r->>'expected_asset_count')::integer,
      (r->>'returned_asset_count')::integer, r->>'first_asset_id', r->>'last_asset_id',
      (r->>'http_status')::integer, (r->>'content_was_json')::boolean,
      r->>'requested_ids_sha256', r->>'returned_ids_sha256',
      (r->>'id_sets_matched')::boolean, (r->>'complete')::boolean,
      r->>'failure_message', (r->>'captured_at')::timestamptz, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title' then
    insert into plm.pmt_authorized_title (
      capture_id, authorized_title_key, authorized_title_name, capture_status,
      resolved_property_count, unique_asset_count, full_metadata_count, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'authorized_title_name',
      r->>'capture_status', (r->>'resolved_property_count')::integer,
      (r->>'unique_asset_count')::integer, (r->>'full_metadata_count')::integer,
      r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property' then
    insert into plm.pmt_property (
      capture_id, property_source_id, property_name, is_licensed_selection, raw, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, r->>'property_name',
      coalesce((r->>'is_licensed_selection')::boolean, false),
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_franchise' then
    insert into plm.pmt_franchise (capture_id, franchise_source_id, franchise_name, raw, source_hash)
    select p_capture_id, (r->>'franchise_source_id')::bigint, r->>'franchise_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_character' then
    insert into plm.pmt_character (capture_id, character_source_id, character_name, raw, source_hash)
    select p_capture_id, (r->>'character_source_id')::bigint, r->>'character_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_collection' then
    insert into plm.pmt_collection (
      capture_id, collection_source_id, collection_name, paramount_term, raw, source_hash)
    select p_capture_id, (r->>'collection_source_id')::bigint, r->>'collection_name',
      coalesce(r->>'paramount_term', 'Collection'), coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_brand' then
    insert into plm.pmt_brand (capture_id, brand_source_id, brand_name, raw, source_hash)
    select p_capture_id, (r->>'brand_source_id')::bigint, r->>'brand_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset' then
    insert into plm.pmt_asset (
      capture_id, asset_id, asset_name, date_imported, date_last_updated,
      content_size_bytes, content_type, mime_type, asset_version, raw, source_hash)
    select p_capture_id, r->>'asset_id', r->>'asset_name',
      nullif(r->>'date_imported','')::timestamptz, nullif(r->>'date_last_updated','')::timestamptz,
      (r->>'content_size_bytes')::bigint, r->>'content_type', r->>'mime_type',
      (r->>'asset_version')::integer, coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title_property' then
    insert into plm.pmt_authorized_title_property (
      capture_id, authorized_title_key, property_source_id, paramount_property_name,
      reported_asset_count, mapping_status, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', (r->>'property_source_id')::bigint,
      r->>'paramount_property_name', coalesce((r->>'reported_asset_count')::integer, 0),
      coalesce(r->>'mapping_status','mapped'), r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_property' then
    insert into plm.pmt_asset_property (capture_id, asset_id, property_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'property_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_franchise' then
    insert into plm.pmt_asset_franchise (capture_id, asset_id, franchise_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'franchise_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_character' then
    insert into plm.pmt_asset_character (capture_id, asset_id, character_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'character_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_collection' then
    insert into plm.pmt_asset_collection (capture_id, asset_id, collection_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'collection_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_brand' then
    insert into plm.pmt_asset_brand (capture_id, asset_id, brand_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'brand_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_character' then
    insert into plm.pmt_property_character (
      capture_id, property_source_id, character_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'character_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_collection' then
    insert into plm.pmt_property_collection (
      capture_id, property_source_id, collection_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'collection_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_franchise_evidence' then
    -- evidence_kind and is_direct_source_relationship are NOT accepted from the caller.
    -- They are pinned by CHECK anyway; refusing them here means the loader cannot even try.
    insert into plm.pmt_property_franchise_evidence (
      capture_id, property_source_id, franchise_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'franchise_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_property_asset' then
    insert into plm.pmt_authorized_property_asset (
      capture_id, licensed_property_source_id, asset_id, source_hash)
    select p_capture_id, (r->>'licensed_property_source_id')::bigint, r->>'asset_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_capture_log' then
    insert into plm.pmt_property_capture_log (
      capture_id, property_source_id, property_name, reported_asset_count,
      captured_asset_count, page_count, complete, failure_message, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, r->>'property_name',
      (r->>'reported_asset_count')::integer, (r->>'captured_asset_count')::integer,
      (r->>'page_count')::integer, (r->>'complete')::boolean, r->>'failure_message', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_relationship_anomaly' then
    insert into plm.pmt_relationship_anomaly (
      capture_id, asset_id, relationship_field, raw_value, action, details, source_hash)
    select p_capture_id, r->>'asset_id', r->>'relationship_field', r->>'raw_value',
      r->>'action', r->>'details', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  else
    raise exception 'Paramount import refused: %L is not a loadable target. The target list is '
      'a fixed allow list; core.* and every table outside plm.pmt_* are unreachable from here '
      'by construction, not by convention.', p_target using errcode = 'P0001';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function plm.load_pmt_capture_chunk(uuid, text, jsonb) is
'The ONLY row-loading entry point for a Paramount capture. Bounded to 5000 rows per call, '
'refuses any capture not in status loading, and dispatches on a FIXED ALLOW LIST of plm.pmt_* '
'targets -- there is no dynamic table name, so no caller can reach core.* or any other schema '
'through it. Relationship rows are rejected by the capture-scoped composite foreign keys when '
'an endpoint is missing from the same capture, so an orphan link cannot be inserted at all.';

-- -------------------------------------------------------------------------------------
-- 26.3 plm.validate_pmt_capture -- every finalization check, as inspectable rows
--
-- Returns one row per check rather than a bare boolean, so a failure says WHICH check
-- failed and by how much. finalize calls this and refuses on any failing row.
-- -------------------------------------------------------------------------------------
create or replace function plm.validate_pmt_capture(p_capture_id uuid)
returns table (check_name text, expected bigint, actual bigint, ok boolean, detail text)
language plpgsql
-- SECURITY INVOKER, deliberately, unlike the import functions. This reporter is granted to
-- authenticated so an operator can read the check results, and a DEFINER function bypasses
-- RLS entirely -- which would let ANY signed-in user, including one with no app role at all,
-- read Paramount population counts through it. As invoker it is bounded by the same read
-- policy as the base tables. finalize calls it from inside a DEFINER context and is
-- unaffected.
security invoker
set search_path = plm, core, public, extensions
as $$
declare
  c plm.pmt_capture%rowtype;
begin
  select * into c from plm.pmt_capture where capture_id = p_capture_id;
  if c.capture_id is null then
    raise exception 'Paramount validation refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;

  -- 1. Manifest expected vs actual, for every declared population.
  return query
  with actuals(population, actual) as (
    select 'licensed_business_titles', count(*)::bigint from plm.pmt_authorized_title where capture_id = p_capture_id
    union all select 'licensed_property_selections', count(*)::bigint from plm.pmt_property where capture_id = p_capture_id and is_licensed_selection
    union all select 'property_result_rows', count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id
    union all select 'unique_authorized_assets', count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id
    union all select 'metadata_batches', count(*)::bigint from plm.pmt_capture_batch where capture_id = p_capture_id
    union all select 'properties', count(*)::bigint from plm.pmt_property where capture_id = p_capture_id
    union all select 'franchises', count(*)::bigint from plm.pmt_franchise where capture_id = p_capture_id
    union all select 'characters', count(*)::bigint from plm.pmt_character where capture_id = p_capture_id
    union all select 'style_guides', count(*)::bigint from plm.pmt_collection where capture_id = p_capture_id
    union all select 'brands', count(*)::bigint from plm.pmt_brand where capture_id = p_capture_id
    union all select 'asset_property', count(*)::bigint from plm.pmt_asset_property where capture_id = p_capture_id
    union all select 'asset_franchise', count(*)::bigint from plm.pmt_asset_franchise where capture_id = p_capture_id
    union all select 'asset_character', count(*)::bigint from plm.pmt_asset_character where capture_id = p_capture_id
    union all select 'asset_style_guide', count(*)::bigint from plm.pmt_asset_collection where capture_id = p_capture_id
    union all select 'asset_brand', count(*)::bigint from plm.pmt_asset_brand where capture_id = p_capture_id
    union all select 'property_character_explicit', count(*)::bigint from plm.pmt_property_character where capture_id = p_capture_id
    union all select 'property_style_guide_explicit', count(*)::bigint from plm.pmt_property_collection where capture_id = p_capture_id
    union all select 'property_franchise_asset_cooccurrence', count(*)::bigint from plm.pmt_property_franchise_evidence where capture_id = p_capture_id
    union all select 'authorized_property_context', count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id
    union all select 'malformed_explicit_pairs', count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = p_capture_id
    union all select 'captured_properties', count(*)::bigint from plm.pmt_property_capture_log where capture_id = p_capture_id
  )
  select 'manifest:' || e.population, e.expected_count, coalesce(a.actual, 0),
         coalesce(a.actual, 0) = e.expected_count,
         case when a.population is null then 'no actual measured for this declared population'
              else null end
  from plm.pmt_capture_expectation e
  left join actuals a on a.population = e.population
  where e.capture_id = p_capture_id;

  -- 2. At least one expectation must exist. A capture with no declared expectations would
  --    pass check 1 vacuously, which is exactly how an empty load looks like a good one.
  return query
  select 'manifest:expectations_declared',
         1::bigint,
         (select count(*)::bigint from plm.pmt_capture_expectation where capture_id = p_capture_id),
         (select count(*) from plm.pmt_capture_expectation where capture_id = p_capture_id) > 0,
         'a capture with zero declared expectations would pass every count check vacuously';

  -- 3. Every asset has full metadata. In this schema "has full metadata" means the asset
  --    row itself exists AND appears in a complete batch's returned set; the batch table is
  --    the record of that. So: every asset must be inside the batch coverage.
  return query
  select 'assets_covered_by_batches',
         (select count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id),
         (select coalesce(sum(returned_asset_count), 0)::bigint
            from plm.pmt_capture_batch where capture_id = p_capture_id and complete),
         (select count(*) from plm.pmt_asset where capture_id = p_capture_id)
           = (select coalesce(sum(returned_asset_count), 0)
                from plm.pmt_capture_batch where capture_id = p_capture_id and complete),
         'every asset must be described by a complete full-metadata batch';

  -- 4. No incomplete batches.
  return query
  select 'batches_all_complete', 0::bigint,
         (select count(*)::bigint from plm.pmt_capture_batch where capture_id = p_capture_id and not complete),
         not exists (select 1 from plm.pmt_capture_batch where capture_id = p_capture_id and not complete),
         'an incomplete batch means some asset was requested and never described';

  -- 5. Every batch passed exact ID-set validation.
  return query
  select 'batches_id_sets_matched', 0::bigint,
         (select count(*)::bigint from plm.pmt_capture_batch
           where capture_id = p_capture_id and not id_sets_matched),
         not exists (select 1 from plm.pmt_capture_batch
                      where capture_id = p_capture_id and not id_sets_matched),
         'equal counts are not proof; the requested and returned ID sets must be identical';

  -- 6. Every exact Property capture is complete.
  return query
  select 'property_captures_complete', 0::bigint,
         (select count(*)::bigint from plm.pmt_property_capture_log
           where capture_id = p_capture_id and not complete),
         not exists (select 1 from plm.pmt_property_capture_log
                      where capture_id = p_capture_id and not complete),
         'a partly-scraped Property looks identical to a Property with fewer assets';

  -- 7. All rights-list titles are represented, including the portal-unavailable ones.
  return query
  select 'rights_list_titles_present', c.licensed_title_count::bigint,
         (select count(*)::bigint from plm.pmt_authorized_title where capture_id = p_capture_id),
         (select count(*) from plm.pmt_authorized_title where capture_id = p_capture_id)
           = c.licensed_title_count,
         'every rights-list title must be a row, including titles absent from the portal view';

  -- 8. Captured titles: unique assets equal full-metadata assets. (Also a CHECK; asserted
  --    here too so the report names it rather than the load failing with a constraint code.)
  return query
  select 'captured_title_counts_agree', 0::bigint,
         (select count(*)::bigint from plm.pmt_authorized_title
           where capture_id = p_capture_id and capture_status = 'captured'
             and unique_asset_count <> full_metadata_count),
         not exists (select 1 from plm.pmt_authorized_title
                      where capture_id = p_capture_id and capture_status = 'captured'
                        and unique_asset_count <> full_metadata_count),
         null;

  -- 9. Search-result rows may EXCEED unique assets (overlapping Property scopes) but may
  --    never be fewer: fewer means the authorized scope was not fully collected.
  return query
  select 'search_rows_at_least_unique_assets',
         (select count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id),
         (select count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id),
         (select count(*) from plm.pmt_authorized_property_asset where capture_id = p_capture_id)
           >= (select count(*) from plm.pmt_asset where capture_id = p_capture_id),
         'overlap makes MORE search rows than assets legitimate; FEWER is a truncated scope';

  -- 10. No co-occurrence row claims to be direct. (CHECK-enforced; named here explicitly.)
  return query
  select 'cooccurrence_never_direct', 0::bigint,
         (select count(*)::bigint from plm.pmt_property_franchise_evidence
           where capture_id = p_capture_id
             and (is_direct_source_relationship or evidence_kind <> 'asset_cooccurrence_not_direct_pair')),
         not exists (select 1 from plm.pmt_property_franchise_evidence
                      where capture_id = p_capture_id
                        and (is_direct_source_relationship
                             or evidence_kind <> 'asset_cooccurrence_not_direct_pair')),
         null;

  -- 11. Malformed values stayed anomalies -- none of them was quietly turned into a link.
  return query
  select 'anomalies_preserved',
         (select expected_count from plm.pmt_capture_expectation
           where capture_id = p_capture_id and population = 'malformed_explicit_pairs'),
         (select count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = p_capture_id),
         coalesce(
           (select count(*) from plm.pmt_relationship_anomaly where capture_id = p_capture_id)
             = (select expected_count from plm.pmt_capture_expectation
                 where capture_id = p_capture_id and population = 'malformed_explicit_pairs'),
           false),
         'a malformed value that vanished was probably repaired into a link table';

  -- 12. Unresolved failures.
  return query
  select 'no_unresolved_failures', 0::bigint, c.failure_count::bigint, c.failure_count = 0, null;

  -- 13. Duplicate asset IDs within the capture. The primary key already forbids this; the
  --     check is here so the validation REPORT covers it rather than relying on silence.
  return query
  select 'no_duplicate_asset_ids', 0::bigint,
         (select count(*)::bigint from (
            select asset_id from plm.pmt_asset where capture_id = p_capture_id
            group by asset_id having count(*) > 1) d),
         not exists (select 1 from (
            select asset_id from plm.pmt_asset where capture_id = p_capture_id
            group by asset_id having count(*) > 1) d),
         null;

  -- NOTE ON ORPHAN LINKS. There is deliberately no "orphan endpoint" count here. Every
  -- relationship table carries a capture-scoped composite FOREIGN KEY, so an orphan link
  -- cannot be inserted in the first place -- it fails at load time, loudly, instead of
  -- being counted at finalize time. Checking for something the database cannot contain
  -- would be theatre; the contract test proves the FK rejects it instead.
end;
$$;

comment on function plm.validate_pmt_capture(uuid) is
'Runs every finalization check for a Paramount capture and returns ONE ROW PER CHECK with the '
'expected value, the actual value and a pass flag, so a failure names itself instead of '
'reducing to a bare false. Read-only. finalize calls this and refuses if any row is not ok. '
'Expected counts come from plm.pmt_capture_expectation -- the manifest -- never from a '
'hard-coded constant.';

-- -------------------------------------------------------------------------------------
-- 26.4 plm.pmt_refresh_shrink_check -- compare against the latest COMPLETE FULL capture
-- -------------------------------------------------------------------------------------
create or replace function plm.pmt_refresh_shrink_check(p_capture_id uuid)
returns table (population text, old_count bigint, new_count bigint, ok boolean, detail text)
language plpgsql
-- SECURITY INVOKER for the same reason as plm.validate_pmt_capture: it is a read-only
-- reporter granted to authenticated, and a DEFINER here would hand every signed-in user a
-- way around the read policy.
security invoker
set search_path = plm, core, public, extensions
as $$
declare
  v_prior uuid;
begin
  select capture_id into v_prior
  from plm.pmt_capture
  where status = 'complete' and capture_kind = 'full' and capture_id <> p_capture_id
  order by completed_at desc, capture_id desc
  limit 1;

  -- FIRST capture: nothing to compare against, and comparing to nothing is not a pass or a
  -- fail, it is an absence. Reported as such.
  if v_prior is null then
    return query select 'no_prior_complete_full_capture'::text, 0::bigint, 0::bigint, true,
      'first complete full capture; the shrink guard has no baseline and asserted nothing';
    return;
  end if;

  return query
  with pops(population, floor_fraction) as (
    values ('unique_authorized_assets', 0.90::numeric),
           ('asset_property', 0.85), ('asset_franchise', 0.85), ('asset_character', 0.85),
           ('asset_style_guide', 0.85), ('asset_brand', 0.85),
           ('property_character_explicit', 0.85), ('property_style_guide_explicit', 0.85),
           ('property_franchise_asset_cooccurrence', 0.85),
           ('authorized_property_context', 0.85),
           -- Entity populations: any drop to ZERO fails outright, expressed as a floor
           -- just above nothing.
           ('properties', 0.0), ('franchises', 0.0), ('characters', 0.0),
           ('style_guides', 0.0), ('brands', 0.0)
  ),
  m as (
    select p.population, p.floor_fraction,
           coalesce(o.expected_count, 0) as old_count,
           coalesce(n.expected_count, 0) as new_count
    from pops p
    left join plm.pmt_capture_expectation o
      on o.capture_id = v_prior and o.population = p.population
    left join plm.pmt_capture_expectation n
      on n.capture_id = p_capture_id and n.population = p.population
  )
  select m.population, m.old_count, m.new_count,
         (
           -- Any population that had rows and now has none FAILS, whatever the fraction.
           not (m.old_count > 0 and m.new_count = 0)
           and (m.floor_fraction = 0
                or m.old_count = 0
                or m.new_count >= floor(m.old_count * m.floor_fraction))
         )
         or exists (select 1 from plm.pmt_shrink_override so
                     where so.capture_id = p_capture_id and so.population = m.population),
         case
           when m.old_count > 0 and m.new_count = 0
             then 'a previously populated population dropped to zero'
           when m.floor_fraction > 0 and m.old_count > 0
                and m.new_count < floor(m.old_count * m.floor_fraction)
             then 'below the ' || (m.floor_fraction * 100)::text || '% floor of the prior complete full capture'
           else null
         end
  from m;

  -- Rights-list count changes ALWAYS need owner approval, in either direction. A title
  -- appearing is as much a rights change as a title vanishing.
  return query
  select 'licensed_business_titles'::text,
         (select licensed_title_count::bigint from plm.pmt_capture where capture_id = v_prior),
         (select licensed_title_count::bigint from plm.pmt_capture where capture_id = p_capture_id),
         (select p.licensed_title_count = q.licensed_title_count
            from plm.pmt_capture p, plm.pmt_capture q
           where p.capture_id = p_capture_id and q.capture_id = v_prior)
         or exists (select 1 from plm.pmt_shrink_override so
                     where so.capture_id = p_capture_id
                       and so.population = 'licensed_business_titles'),
         'any change to the rights-list count requires a recorded owner approval';

  -- Batches must not go missing.
  return query
  select 'metadata_batches'::text,
         (select count(*)::bigint from plm.pmt_capture_batch where capture_id = v_prior),
         (select count(*)::bigint from plm.pmt_capture_batch where capture_id = p_capture_id),
         (select count(*) from plm.pmt_capture_batch where capture_id = p_capture_id)
           >= (select count(*) from plm.pmt_capture_batch where capture_id = v_prior)
         or exists (select 1 from plm.pmt_shrink_override so
                     where so.capture_id = p_capture_id and so.population = 'metadata_batches'),
         'fewer batches than the prior capture means requests were never made';

  -- Anomalies are REPORTED LOUDLY, never a silent pass, but they do not block: a source
  -- that got messier is news, not a reason to refuse the evidence.
  return query
  select 'relationship_anomalies_increased'::text,
         (select count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = v_prior),
         (select count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = p_capture_id),
         true,
         case when (select count(*) from plm.pmt_relationship_anomaly where capture_id = p_capture_id)
                 > (select count(*) from plm.pmt_relationship_anomaly where capture_id = v_prior)
              then 'LOUD: anomalies INCREASED against the prior complete full capture -- read them'
              else null end;
end;
$$;

comment on function plm.pmt_refresh_shrink_check(uuid) is
'Refresh shrink guard. Compares a capture ONLY to the latest COMPLETE FULL capture -- never to '
'a test, targeted, failed or in-flight one. Refuses: unique assets below 90% of prior, any '
'relationship population below 85%, any entity population or previously populated title '
'dropping to zero, missing batches, and ANY change to the rights-list count. Increased '
'anomalies are reported loudly but do not block. The only way past a refusal is an audited '
'row in plm.pmt_shrink_override, which needs a reason, an operator and a DIFFERENT approver.';

-- -------------------------------------------------------------------------------------
-- 26.5 plm.fail_pmt_capture -- leave failed work VISIBLE
-- -------------------------------------------------------------------------------------
create or replace function plm.fail_pmt_capture(p_capture_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role text := auth.role();
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role %L / session_user %L may not fail a capture.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Paramount fail refused: a reason is required. An unexplained failure is '
      'indistinguishable from an abandoned run.' using errcode = 'P0001';
  end if;

  update plm.pmt_capture
     set status = 'failed', failure_message = p_reason,
         failure_count = greatest(failure_count, 1)
   where capture_id = p_capture_id;

  if not found then
    raise exception 'Paramount fail refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function plm.fail_pmt_capture(uuid, text) is
'Marks a Paramount capture failed with a mandatory reason. The rows already loaded are LEFT IN '
'PLACE and visible: a failed capture is evidence of what went wrong, and deleting it hides the '
'only diagnosis. A failed capture is permanently ineligible to be served as the latest capture.';

-- -------------------------------------------------------------------------------------
-- 26.6 plm.finalize_pmt_capture -- the only path to 'complete'
-- -------------------------------------------------------------------------------------
create or replace function plm.finalize_pmt_capture(
  p_capture_id      uuid,
  p_manifest_sha256 text
)
returns table (check_name text, expected bigint, actual bigint, ok boolean, detail text)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role   text := auth.role();
  c        plm.pmt_capture%rowtype;
  v_failed integer;
  v_first  text;
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount finalize refused: JWT role %L / session_user %L may not finalize.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  -- Two Paramount imports must never finalize together.
  perform pg_advisory_xact_lock(hashtext('plm.pmt_capture_import')::bigint);

  select * into c from plm.pmt_capture where capture_id = p_capture_id for update;
  if c.capture_id is null then
    raise exception 'Paramount finalize refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if c.status = 'complete' then
    raise exception 'Paramount finalize refused: capture % is already complete and immutable.',
      p_capture_id using errcode = 'P0001';
  end if;
  if c.status not in ('loading','validating') then
    raise exception 'Paramount finalize refused: capture % is %L and cannot be completed.',
      p_capture_id, c.status using errcode = 'P0001';
  end if;

  -- MANIFEST IDENTITY. The manifest presented at finalize must be the one the capture began
  -- with, byte for byte. Otherwise a capture could be loaded from one source set and
  -- certified against another.
  if p_manifest_sha256 is distinct from c.manifest_sha256 then
    raise exception 'Paramount finalize refused: manifest hash presented does not match the hash '
      'this capture began with. A capture may not be certified against a different source set.'
      using errcode = 'P0001';
  end if;

  update plm.pmt_capture set status = 'validating' where capture_id = p_capture_id;

  create temporary table _pmt_validation on commit drop as
    select * from plm.validate_pmt_capture(p_capture_id);

  insert into _pmt_validation (check_name, expected, actual, ok, detail)
  select 'shrink:' || s.population, s.old_count, s.new_count, s.ok, s.detail
  from plm.pmt_refresh_shrink_check(p_capture_id) s;

  select count(*), min(v.check_name) into v_failed, v_first
  from _pmt_validation v where not v.ok;

  if v_failed > 0 then
    update plm.pmt_capture
       set status = 'failed',
           failure_count = v_failed,
           failure_message = format('%s validation check(s) failed; first: %s', v_failed, v_first)
     where capture_id = p_capture_id;

    raise exception 'Paramount finalize refused: % validation check(s) failed (first: %). The '
      'capture is marked FAILED and its rows are left in place for diagnosis. Call '
      'plm.validate_pmt_capture(%L) to read every check.', v_failed, v_first, p_capture_id
      using errcode = 'P0001';
  end if;

  update plm.pmt_capture
     set status = 'complete',
         completed_at = now(),
         validated_at = now(),
         validation_passed = true,
         failure_count = 0,
         failure_message = null,
         anomaly_count = (select count(*) from plm.pmt_relationship_anomaly
                           where capture_id = p_capture_id)
   where capture_id = p_capture_id;

  return query select v.check_name, v.expected, v.actual, v.ok, v.detail from _pmt_validation v;
end;
$$;

comment on function plm.finalize_pmt_capture(uuid, text) is
'The ONLY path to status complete. Takes an advisory lock so two Paramount imports cannot '
'finalize together, refuses a manifest hash different from the one the capture began with, '
'refuses an already-complete capture, runs every validation check AND the refresh shrink guard, '
'and marks the capture FAILED with the first failing check name if anything does not pass. On '
'success it returns the full check report, so "it finalized" is never a claim without evidence.';

-- Import functions are service_role only. authenticated may run the READ-ONLY reporters.
revoke all on function plm.begin_pmt_capture(text,text,text,timestamptz,text,text,text,integer,integer,integer,integer,integer,integer,jsonb,text) from public;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public;
revoke all on function plm.finalize_pmt_capture(uuid, text) from public;
revoke all on function plm.fail_pmt_capture(uuid, text) from public;
revoke all on function plm.validate_pmt_capture(uuid) from public;
revoke all on function plm.pmt_refresh_shrink_check(uuid) from public;

revoke all on function plm.begin_pmt_capture(text,text,text,timestamptz,text,text,text,integer,integer,integer,integer,integer,integer,jsonb,text) from anon, authenticated;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from anon, authenticated;
revoke all on function plm.finalize_pmt_capture(uuid, text) from anon, authenticated;
revoke all on function plm.fail_pmt_capture(uuid, text) from anon, authenticated;
revoke all on function plm.validate_pmt_capture(uuid) from anon;
revoke all on function plm.pmt_refresh_shrink_check(uuid) from anon;

grant execute on function plm.begin_pmt_capture(text,text,text,timestamptz,text,text,text,integer,integer,integer,integer,integer,integer,jsonb,text) to service_role;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;
grant execute on function plm.finalize_pmt_capture(uuid, text) to service_role;
grant execute on function plm.fail_pmt_capture(uuid, text) to service_role;
grant execute on function plm.validate_pmt_capture(uuid) to service_role, authenticated;
grant execute on function plm.pmt_refresh_shrink_check(uuid) to service_role, authenticated;

-- =====================================================================================
-- SECTION 27. API views
--
-- ALL EIGHT use security_invoker = true, so a view can never become a privilege-escalation
-- path around the base tables' RLS. anon is revoked on every one of them as well: a view
-- has no RLS of its own, so the GRANT is the only guard if security_invoker were ever lost.
-- =====================================================================================

-- 27.1 The latest COMPLETE FULL capture. Every other view keys off this one, which is what
--      makes "loading/failed/test/targeted never appear" true in ONE place instead of eight.
create view api.pmt_latest_capture
with (security_invoker = true) as
select c.capture_id, c.source_system, c.source_url, c.library_name,
       c.started_at, c.completed_at, c.captured_by,
       c.private_source_commit, c.manifest_sha256,
       c.portal_global_asset_count, c.licensed_title_count,
       c.licensed_property_selection_count, c.property_result_row_count,
       c.unique_asset_count, c.metadata_batch_count, c.anomaly_count, c.notes,
       'POP Creations licensed account, current library view only; NOT Paramount''s worldwide catalogue'::text
         as entitlement_scope
from plm.pmt_capture c
where c.status = 'complete' and c.capture_kind = 'full'
order by c.completed_at desc, c.capture_id desc
limit 1;

comment on view api.pmt_latest_capture is
'The single latest COMPLETE FULL Paramount capture. Loading, validating, failed, abandoned, '
'targeted and test captures are structurally excluded and can never appear here. Every other '
'api.pmt_* view joins through this one, so the rule lives in exactly one place.';

-- 27.2 Assets, with relationships as ARRAYS.
--      NOT a join to five relationship tables: that is a Cartesian product, and a single
--      asset with 3 properties and 4 characters would report 12 rows and inflate every
--      count taken over it. Arrays keep one row per asset, exactly as the source has it.
create view api.pmt_assets
with (security_invoker = true) as
select
  a.capture_id, a.asset_id, a.asset_name,
  a.date_imported, a.date_last_updated,
  a.content_size_bytes, a.content_type, a.mime_type, a.asset_version,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_asset_property ap
              join plm.pmt_property p
                on p.capture_id = ap.capture_id and p.property_source_id = ap.property_source_id
             where ap.capture_id = a.capture_id and ap.asset_id = a.asset_id),
           array[]::text[]) as property_names,
  coalesce((select array_agg(f.franchise_name order by f.franchise_name)
              from plm.pmt_asset_franchise af
              join plm.pmt_franchise f
                on f.capture_id = af.capture_id and f.franchise_source_id = af.franchise_source_id
             where af.capture_id = a.capture_id and af.asset_id = a.asset_id),
           array[]::text[]) as franchise_names,
  coalesce((select array_agg(ch.character_name order by ch.character_name)
              from plm.pmt_asset_character ac
              join plm.pmt_character ch
                on ch.capture_id = ac.capture_id and ch.character_source_id = ac.character_source_id
             where ac.capture_id = a.capture_id and ac.asset_id = a.asset_id),
           array[]::text[]) as character_names,
  coalesce((select array_agg(cl.collection_name order by cl.collection_name)
              from plm.pmt_asset_collection acl
              join plm.pmt_collection cl
                on cl.capture_id = acl.capture_id and cl.collection_source_id = acl.collection_source_id
             where acl.capture_id = a.capture_id and acl.asset_id = a.asset_id),
           array[]::text[]) as style_guide_names,
  coalesce((select array_agg(b.brand_name order by b.brand_name)
              from plm.pmt_asset_brand ab
              join plm.pmt_brand b
                on b.capture_id = ab.capture_id and b.brand_source_id = ab.brand_source_id
             where ab.capture_id = a.capture_id and ab.asset_id = a.asset_id),
           array[]::text[]) as brand_names
from plm.pmt_asset a
join api.pmt_latest_capture lc on lc.capture_id = a.capture_id;

comment on view api.pmt_assets is
'Business-friendly asset metadata from the latest complete full capture, ONE ROW PER ASSET. '
'Relationships are ARRAYS, deliberately: joining five relationship tables would produce a '
'Cartesian product and an asset with 3 properties and 4 characters would report 12 rows, '
'inflating every count taken over this view. METADATA ONLY -- no creative bytes, no previews, '
'no download URLs. A ZIP is one asset record.';

-- 27.3 Collections exposed with business style-guide wording. One table, two vocabularies.
create view api.pmt_style_guides
with (security_invoker = true) as
select
  cl.capture_id,
  cl.collection_source_id as style_guide_source_id,
  cl.collection_name      as style_guide_name,
  cl.paramount_term,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_collection pc
              join plm.pmt_property p
                on p.capture_id = pc.capture_id and p.property_source_id = pc.property_source_id
             where pc.capture_id = cl.capture_id
               and pc.collection_source_id = cl.collection_source_id),
           array[]::text[]) as property_names,
  (select count(*) from plm.pmt_asset_collection ac
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as asset_count,
  (select count(distinct ach.character_source_id)
     from plm.pmt_asset_collection ac
     join plm.pmt_asset_character ach
       on ach.capture_id = ac.capture_id and ach.asset_id = ac.asset_id
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as character_count,
  lc.completed_at as captured_at
from plm.pmt_collection cl
join api.pmt_latest_capture lc on lc.capture_id = cl.capture_id;

comment on view api.pmt_style_guides is
'Paramount Collections presented in OUR business vocabulary as style guides. There is no second '
'source table -- this reads plm.pmt_collection directly, so the two vocabularies can never '
'drift apart into two populations. character_count is distinct characters reached THROUGH the '
'style guide''s assets, which is why it is a count and not an array.';

-- 27.4 Properties.
create view api.pmt_properties
with (security_invoker = true) as
select
  p.capture_id, p.property_source_id, p.property_name, p.is_licensed_selection,
  coalesce((select array_agg(distinct t.authorized_title_name)
              from plm.pmt_authorized_title_property atp
              join plm.pmt_authorized_title t
                on t.capture_id = atp.capture_id and t.authorized_title_key = atp.authorized_title_key
             where atp.capture_id = p.capture_id and atp.property_source_id = p.property_source_id),
           array[]::text[]) as business_title_names,
  (select count(*) from plm.pmt_asset_property ap
    where ap.capture_id = p.capture_id and ap.property_source_id = p.property_source_id) as asset_count,
  (select count(*) from plm.pmt_property_character pch
    where pch.capture_id = p.capture_id and pch.property_source_id = p.property_source_id) as character_count,
  (select count(*) from plm.pmt_property_collection pc
    where pc.capture_id = p.capture_id and pc.property_source_id = p.property_source_id) as style_guide_count,
  coalesce((select array_agg(f.franchise_name order by f.franchise_name)
              from plm.pmt_property_franchise_evidence pfe
              join plm.pmt_franchise f
                on f.capture_id = pfe.capture_id and f.franchise_source_id = pfe.franchise_source_id
             where pfe.capture_id = p.capture_id and pfe.property_source_id = p.property_source_id),
           array[]::text[]) as franchise_names_cooccurrence_evidence_only,
  false as franchise_link_is_a_direct_source_relationship,
  p.core_property_id, p.resolution_status, p.resolution_reason, p.resolved_at
from plm.pmt_property p
join api.pmt_latest_capture lc on lc.capture_id = p.capture_id;

comment on view api.pmt_properties is
'Paramount properties from the latest complete full capture. The franchise column is named '
'franchise_names_cooccurrence_evidence_only and is accompanied by a constant false flag ON '
'PURPOSE: Paramount states no property-franchise relationship, these names come from assets '
'that happened to carry both, and a column called franchise_name would be read as authority '
'within a week. core_property_id is a reconciliation pointer, not a canonical assignment.';

-- 27.5 Characters.
create view api.pmt_characters
with (security_invoker = true) as
select
  ch.capture_id, ch.character_source_id, ch.character_name,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_character pch
              join plm.pmt_property p
                on p.capture_id = pch.capture_id and p.property_source_id = pch.property_source_id
             where pch.capture_id = ch.capture_id
               and pch.character_source_id = ch.character_source_id),
           array[]::text[]) as explicit_property_names,
  (select count(*) from plm.pmt_asset_character ac
    where ac.capture_id = ch.capture_id and ac.character_source_id = ch.character_source_id)
    as asset_count,
  coalesce((select array_agg(distinct cl.collection_name)
              from plm.pmt_asset_character ac
              join plm.pmt_asset_collection acl
                on acl.capture_id = ac.capture_id and acl.asset_id = ac.asset_id
              join plm.pmt_collection cl
                on cl.capture_id = acl.capture_id and cl.collection_source_id = acl.collection_source_id
             where ac.capture_id = ch.capture_id
               and ac.character_source_id = ch.character_source_id),
           array[]::text[]) as style_guide_names,
  ch.core_character_id, ch.resolution_status, ch.resolution_reason, ch.resolved_at
from plm.pmt_character ch
join api.pmt_latest_capture lc on lc.capture_id = ch.capture_id;

comment on view api.pmt_characters is
'Paramount characters from the latest complete full capture. explicit_property_names carries '
'ONLY the pairs Paramount states in its cascading field -- never a pair assembled by us. '
'style_guide_names is reached through the character''s assets and is therefore an observation, '
'not a Paramount statement. Characters are identified by SOURCE ID; never merge two by name.';

-- 27.6 Rights-list summary, including the titles the portal did not show.
create view api.pmt_authorized_title_summary
with (security_invoker = true) as
select
  t.capture_id, t.authorized_title_key, t.authorized_title_name, t.capture_status,
  (t.capture_status = 'licensed_but_not_present_in_current_portal_view')
    as absent_from_current_portal_view,
  t.resolved_property_count, t.unique_asset_count, t.full_metadata_count, t.notes,
  'A zero count means this title was not present in this account''s current portal view. It does NOT mean the title is unlicensed and does NOT prove Paramount holds no content for it.'::text
    as zero_count_meaning
from plm.pmt_authorized_title t
join api.pmt_latest_capture lc on lc.capture_id = t.capture_id;

comment on view api.pmt_authorized_title_summary is
'ALL rights-list titles from the latest complete full capture, INCLUDING the ones absent from '
'the current portal view, which appear with zero counts and an explicit warning column. They '
'are never filtered out: a missing row would read as "not licensed", which is the exact wrong '
'conclusion. The rights-list count is CLOSED by owner ruling.';

-- 27.7 Capture health.
create view api.pmt_capture_health
with (security_invoker = true) as
select
  c.capture_id, c.status, c.capture_kind, c.started_at, c.completed_at,
  c.validated_at, c.validation_passed, c.failure_count, c.failure_message,
  c.anomaly_count, c.manifest_sha256, c.private_source_commit,
  e.population, e.expected_count,
  v.actual, v.ok as check_passed, v.detail
from plm.pmt_capture c
left join plm.pmt_capture_expectation e on e.capture_id = c.capture_id
left join lateral (
  select x.actual, x.ok, x.detail
  from plm.validate_pmt_capture(c.capture_id) x
  where x.check_name = 'manifest:' || e.population
) v on true;

comment on view api.pmt_capture_health is
'Per-capture health for EVERY capture, not only the latest: expected versus actual counts per '
'population, failures, anomalies, the manifest hash and the private source commit. This is the '
'view that answers "did the import really work", and it reads the live actual counts rather '
'than a stored summary, so it cannot go stale against the rows.';

-- 27.8 Franchise evidence, always labelled.
create view api.pmt_property_franchise_evidence
with (security_invoker = true) as
select
  pfe.capture_id,
  p.property_source_id, p.property_name,
  f.franchise_source_id, f.franchise_name,
  pfe.evidence_kind,
  pfe.evidence_asset_count,
  pfe.is_direct_source_relationship,
  'CO-OCCURRENCE ONLY. Paramount states no property-to-franchise relationship. These two appear together on some assets; that is an observation about assets, NOT an authority about ownership.'::text
    as authority_warning
from plm.pmt_property_franchise_evidence pfe
join plm.pmt_property p
  on p.capture_id = pfe.capture_id and p.property_source_id = pfe.property_source_id
join plm.pmt_franchise f
  on f.capture_id = pfe.capture_id and f.franchise_source_id = pfe.franchise_source_id
join api.pmt_latest_capture lc on lc.capture_id = pfe.capture_id;

comment on view api.pmt_property_franchise_evidence is
'Property-franchise CO-OCCURRENCE evidence. Every row carries evidence_kind, '
'is_direct_source_relationship (always false, CHECK-enforced on the base table) and a plain '
'English authority_warning, so no consumer can read this view and mistake it for a Paramount '
'statement about which franchise a property belongs to.';

do $$
declare
  v text;
begin
  foreach v in array array[
    'pmt_latest_capture','pmt_assets','pmt_style_guides','pmt_properties','pmt_characters',
    'pmt_authorized_title_summary','pmt_capture_health','pmt_property_franchise_evidence'
  ]
  loop
    execute format('revoke all on api.%I from public', v);
    execute format('revoke all on api.%I from anon', v);
    execute format('grant select on api.%I to authenticated, service_role', v);
  end loop;
end;
$$;
