-- =====================================================================================
-- Sega DSI -- source landing schema (release 1).
--
-- Migration: 20260819015333_sega_dsi_source_landing.sql
-- Issue:     u2giants/shared-db #1196 (schema contract)
-- Claim:     u2giants/shared-db #1210, reserved version 20260819015333
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO SEGA VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The Sega extract is licensed source data
-- held in the PRIVATE repo u2giants/licensor-source-data. No Sega property, catalog,
-- character, style-guide, asset, file name, path, tag, licensor value or raw payload may
-- ever appear in this file, in a contract test, in CI output, or in a pull request or
-- issue on this repository.
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime from the private loader, which writes through the two functions
-- and the INSERT grants below. The contract tests use INVENTED fixture values only.
--
-- WHAT THIS IS
--   A lossless, append-only, capture-scoped landing of a Sega DSI portal capture. Every
--   source table is keyed by `capture_id`, so a refresh ADDS a snapshot and never
--   overwrites or deletes an earlier one. Retry safety is `on conflict do nothing`, which
--   needs no UPDATE privilege and is exactly idempotent because a capture's source bytes
--   are pinned by source_commit_sha + source_manifest_sha256.
--
-- WHAT THIS DELIBERATELY IS NOT
--   It creates, renames, updates, merges and deletes NOTHING in core.* or dam.*. It
--   resolves NOTHING: this release ships no reconciliation columns at all, so there is no
--   half-built resolution surface to misread. Nothing here is canonical -- these are the
--   portal's own labels, which routinely differ from core.property / core.character, and
--   preserving that difference is the point.
--
-- THE ONE DISTINCTION THAT MUST NOT BE COLLAPSED
--   `sega_style_guide_candidate` and `sega_character_candidate` are CANDIDATES: things
--   this pipeline RECONSTRUCTED or INFERRED, never things the portal states as fact. The
--   Sega portal exposes no Style Guide master record and no Character master record.
--   `sega_character_evidence` holds the evidence behind a character candidate, one row
--   per piece of evidence, and every one of its rows is pinned to
--   relationship_truth = 'inferred' by a CHECK that permits no other value.
--   The three DIRECT relationship tables (sega_asset_catalog, sega_asset_tag,
--   sega_asset_property) hold portal-declared relationships ONLY. Asset-to-property is
--   NEVER inferred from catalog containment. A future promotion release may read the
--   candidate tables, but nothing here may present a candidate as a source-declared fact
--   and nothing may auto-promote one into core.character or core.style_guide.
--
-- IMMUTABILITY IS DELIVERED BY PRIVILEGE SEPARATION, NOT BY TRIGGERS
--   Same mechanism, and the same reason, as the NBCU landing (20260810070000 plus its
--   corrective 20260810080000). This database has been burned by a BEFORE trigger that
--   read a GENERATED ... STORED column, which Postgres populates AFTER before-triggers
--   fire: the value was always NULL, the guard never fired, and nothing ever raised.
--   Privilege separation fails closed and, crucially, is INSPECTABLE in
--   information_schema.role_table_grants, so a contract test can assert the guarantee
--   itself rather than assert that some guard code exists.
--
--   THE TRAP THAT MADE 20260810080000 NECESSARY IS HANDLED HERE IN THIS FILE. The schema
--   `plm` carries `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role`, so
--   every table below is BORN holding UPDATE, DELETE and TRUNCATE for service_role and a
--   bare `grant select, insert` is a no-op. The explicit REVOKE block near the end is
--   what actually makes these rows immutable, and the assertion block after it fails the
--   migration if the revokes did not take.
--
-- COMPLETION FLAGS ARE MANIFEST FACTS, SET AT BEGIN, NEVER MUTATED
--   is_limited, ip_paging_terminal, asset_paging_terminal and ip_associations_complete
--   are properties of the finished scraper output that the loader reads, so they are
--   arguments to plm.begin_sega_capture and are fixed for the life of the capture. They
--   are NOT progress flags. This is stated because the alternative -- defaulting them
--   false and expecting something to flip them later -- cannot work at all: service_role
--   holds no UPDATE on plm.sega_capture, so a capture whose flags were never supplied
--   could never satisfy the completion rule and could never become 'complete'.
--
-- Depends on (exact 14-digit versions):
--   20260621150714  foundation             -- schema plm, app.jwt_role_names
--   20260621150815  app_core               -- app.has_role / has_any_role / has_app_access
--   20260814030000  source_capture_inventory
--   20260814233342  source_capture_inventory_latest_complete  -- the body extended below
-- =====================================================================================


-- =====================================================================================
-- 1. plm.sega_capture -- one row per attempted load. The root of every snapshot.
--
-- capture_key is the loader's idempotency key. The same exact capture is idempotent: a
-- retry resumes the existing `loading` row or returns the already-`complete` row, and
-- never creates a duplicate. Enforced by the unique constraint here plus
-- plm.begin_sega_capture below.
--
-- source_commit_sha vs read_commit_sha are TWO DIFFERENT FACTS and must not be collapsed.
-- source_commit_sha identifies the DATA -- the commit the extract was merged at.
-- read_commit_sha is the commit the loader actually had checked out when it read the
-- bytes, which can be a later commit that changed only documentation.
-- =====================================================================================
create table plm.sega_capture (
  id                       uuid        primary key default gen_random_uuid(),
  capture_key              text        not null unique,
  source_repository        text        not null,
  source_commit_sha        text        not null,
  read_commit_sha          text            null,
  source_manifest_sha256   text        not null,
  portal_base_url          text        not null,
  source_captured_at       timestamptz not null,
  load_started_at          timestamptz not null default now(),
  load_completed_at        timestamptz     null,
  status                   text        not null default 'loading',
  expected_counts          jsonb       not null,
  observed_counts          jsonb       not null default '{}'::jsonb,
  media_downloaded         integer     not null default 0,
  is_limited               boolean     not null default false,
  ip_paging_terminal       boolean     not null default false,
  asset_paging_terminal    boolean     not null default false,
  ip_associations_complete boolean     not null default false,
  error_summary            jsonb       not null default '[]'::jsonb,
  raw_summary              jsonb       not null,
  created_by               text        not null,

  constraint sega_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint sega_capture_key_nonblank_chk        check (btrim(capture_key) <> ''),
  constraint sega_capture_repository_nonblank_chk check (btrim(source_repository) <> ''),
  constraint sega_capture_portal_nonblank_chk     check (btrim(portal_base_url) <> ''),
  constraint sega_capture_created_by_nonblank_chk check (btrim(created_by) <> ''),
  constraint sega_capture_commit_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint sega_capture_read_commit_sha_chk
    check (read_commit_sha is null or read_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint sega_capture_manifest_sha256_chk
    check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  -- Scope guard, not a style preference: this project may never download Sega media.
  constraint sega_capture_media_zero_chk check (media_downloaded = 0),
  constraint sega_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  -- The completion rule from the schema contract, enforced by the table itself and not
  -- only by the finalize function. A future writer that reaches this table another way
  -- still cannot mint a 'complete' capture that was limited, non-terminal, incomplete on
  -- IP associations, media-bearing, or carrying validation errors.
  constraint sega_capture_complete_requirements_chk
    check (
      status <> 'complete'
      or (
        load_completed_at is not null
        and is_limited = false
        and ip_paging_terminal = true
        and asset_paging_terminal = true
        and ip_associations_complete = true
        and media_downloaded = 0
        and jsonb_array_length(error_summary) = 0
      )
    ),
  constraint sega_capture_expected_counts_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint sega_capture_observed_counts_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint sega_capture_error_summary_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint sega_capture_raw_summary_obj_chk
    check (jsonb_typeof(raw_summary) = 'object')
);

comment on table plm.sega_capture is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per attempted Sega '
  'DSI load. Append-only snapshot root: a refresh adds a new capture and NEVER edits or '
  'deletes an earlier one. Only plm.begin_sega_capture and plm.finalize_sega_capture may '
  'write here -- service_role holds SELECT only.';
comment on column plm.sega_capture.source_commit_sha is
  'The private-repo commit that identifies the DATA. capture_key is built from this.';
comment on column plm.sega_capture.read_commit_sha is
  'The private-repo commit the loader actually had checked out. May be LATER than '
  'source_commit_sha when only documentation changed. A separate fact; do not collapse.';
comment on column plm.sega_capture.status is
  'loading -> complete | rejected. A rejected capture stays visible as immutable evidence '
  'and the previous complete capture remains current. ''abandoned'' is permitted by the '
  'CHECK but no function sets it in this release -- flagged, not invented.';
comment on column plm.sega_capture.media_downloaded is
  'Hard zero. Constrained, not merely defaulted: storing Sega media bytes is out of scope.';
comment on column plm.sega_capture.expected_counts is
  'Drift check supplied by the capture manifest, NOT a hard-coded database constraint. '
  'The discovery counts live here per capture so a later capture may legitimately differ.';
comment on column plm.sega_capture.is_limited is
  'A manifest fact fixed at plm.begin_sega_capture, not a progress flag. A limited capture '
  'can never become ''complete''.';
comment on column plm.sega_capture.ip_paging_terminal is
  'Manifest fact fixed at begin: the IP-registry paging reached its terminal page. False '
  'means the crawl did not finish and the capture may never complete.';
comment on column plm.sega_capture.asset_paging_terminal is
  'Manifest fact fixed at begin: the asset paging reached its terminal page.';
comment on column plm.sega_capture.ip_associations_complete is
  'Manifest fact fixed at begin: every IP record had its asset associations read.';


-- =====================================================================================
-- 2. plm.sega_property -- the portal's IP-registry records.
--
-- The portal's own record identifier is identity. Labels are stored byte-for-byte and
-- are NOT identity: nothing here is normalised, trimmed or corrected.
-- =====================================================================================
create table plm.sega_property (
  capture_id         uuid  not null references plm.sega_capture(id) on delete restrict,
  property_source_id text  not null,
  property_label     text  not null,
  primary_source_id  text      null,
  property_type      text      null,
  language           text      null,
  source_status      text      null,
  ip_components_text text      null,
  source_url         text  not null,
  source_hash        text  not null,
  raw                jsonb not null,

  constraint sega_property_pkey primary key (capture_id, property_source_id),
  constraint sega_property_source_id_nonblank_chk check (btrim(property_source_id) <> ''),
  constraint sega_property_label_nonblank_chk     check (btrim(property_label) <> ''),
  constraint sega_property_url_nonblank_chk       check (btrim(source_url) <> ''),
  constraint sega_property_hash_nonblank_chk      check (btrim(source_hash) <> ''),
  constraint sega_property_primary_source_id_nonblank_chk
    check (primary_source_id is null or btrim(primary_source_id) <> ''),
  constraint sega_property_type_nonblank_chk
    check (property_type is null or btrim(property_type) <> ''),
  constraint sega_property_language_nonblank_chk
    check (language is null or btrim(language) <> ''),
  constraint sega_property_source_status_nonblank_chk
    check (source_status is null or btrim(source_status) <> ''),
  constraint sega_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_property is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Portal IP-registry records '
  'for one capture. Labels are byte-for-byte source values; any normalised form belongs '
  'in a later view, never in this table. Resolves nothing to core.property.';


-- =====================================================================================
-- 3. plm.sega_property_licensor -- the licensors a property declares, normalised into
--    rows instead of being left as a delimited string.
--
-- Two uniqueness rules, doing two different jobs: the ordinal preserves the source's
-- stated ORDER, and the normalized-label unique constraint refuses the same licensor
-- twice under a different ordinal.
-- =====================================================================================
create table plm.sega_property_licensor (
  capture_id                uuid    not null,
  property_source_id        text    not null,
  licensor_ordinal          integer not null,
  licensor_label            text    not null,
  normalized_licensor_label text    not null,
  raw                       jsonb   not null,

  constraint sega_property_licensor_pkey
    primary key (capture_id, property_source_id, licensor_ordinal),
  constraint sega_property_licensor_normalized_uk
    unique (capture_id, property_source_id, normalized_licensor_label),
  constraint sega_property_licensor_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.sega_property (capture_id, property_source_id) on delete restrict,
  constraint sega_property_licensor_ordinal_pos_chk check (licensor_ordinal > 0),
  constraint sega_property_licensor_label_nonblank_chk check (btrim(licensor_label) <> ''),
  constraint sega_property_licensor_normalized_nonblank_chk
    check (btrim(normalized_licensor_label) <> ''),
  constraint sega_property_licensor_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_property_licensor is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per licensor a '
  'portal property declares, in source order. Resolves nothing to core.licensor.';


-- =====================================================================================
-- 4. plm.sega_catalog -- the portal's catalog tree.
--
-- The numeric catalog ID is identity. A LEAF LABEL IS NOT IDENTITY: the portal repeats
-- the same label under different paths, so keying on the label would silently merge
-- unrelated nodes. The full hierarchy_path is unique within a capture instead.
--
-- The self-referencing foreign key is DEFERRABLE INITIALLY DEFERRED so the loader may
-- insert nodes in any order within one transaction. It is still enforced at commit --
-- deferred is not optional.
-- =====================================================================================
create table plm.sega_catalog (
  capture_id                uuid    not null,
  catalog_source_id         text    not null,
  parent_catalog_source_id  text        null,
  catalog_label             text    not null,
  hierarchy_path            text    not null,
  hierarchy_depth           integer not null,
  is_expired                boolean     null,
  can_edit                  boolean     null,
  can_delete                boolean     null,
  source_hash               text    not null,
  raw                       jsonb   not null,

  constraint sega_catalog_pkey primary key (capture_id, catalog_source_id),
  constraint sega_catalog_capture_fkey
    foreign key (capture_id) references plm.sega_capture(id) on delete restrict,
  constraint sega_catalog_path_uk unique (capture_id, hierarchy_path),
  constraint sega_catalog_parent_fkey
    foreign key (capture_id, parent_catalog_source_id)
    references plm.sega_catalog (capture_id, catalog_source_id)
    on delete restrict
    deferrable initially deferred,
  constraint sega_catalog_no_self_parent_chk
    check (parent_catalog_source_id is null
           or parent_catalog_source_id <> catalog_source_id),
  constraint sega_catalog_source_id_nonblank_chk check (btrim(catalog_source_id) <> ''),
  constraint sega_catalog_parent_id_nonblank_chk
    check (parent_catalog_source_id is null or btrim(parent_catalog_source_id) <> ''),
  constraint sega_catalog_label_nonblank_chk check (btrim(catalog_label) <> ''),
  constraint sega_catalog_path_nonblank_chk  check (btrim(hierarchy_path) <> ''),
  constraint sega_catalog_hash_nonblank_chk  check (btrim(source_hash) <> ''),
  constraint sega_catalog_depth_pos_chk      check (hierarchy_depth > 0),
  constraint sega_catalog_raw_obj_chk        check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_catalog is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The portal catalog tree for '
  'one capture. The numeric catalog ID is identity; a leaf LABEL is not, because the '
  'portal repeats labels across different paths. hierarchy_path is unique per capture.';
comment on column plm.sega_catalog.parent_catalog_source_id is
  'NULL only for a root node. The self-FK is DEFERRABLE INITIALLY DEFERRED so nodes may '
  'be inserted in any order inside one transaction; it is still enforced at commit, and '
  'plm.finalize_sega_capture independently rejects an unresolved non-root parent.';


-- =====================================================================================
-- 5. plm.sega_style_guide_candidate -- DERIVED EVIDENCE, NOT A PORTAL RECORD.
--
-- The Sega portal exposes no Style Guide master record. Every row here is this
-- pipeline's classification of a catalog node, carrying the rule version and the exact
-- evidence value it fired on so a later rule change can be re-derived and audited.
-- It must never be read as "the source says this is a style guide".
-- =====================================================================================
create table plm.sega_style_guide_candidate (
  capture_id          uuid         not null,
  catalog_source_id   text         not null,
  candidate_label     text         not null,
  classification_type text         not null,
  evidence_type       text         not null default 'catalog_name_rule',
  evidence_value      text         not null,
  rule_version        text         not null,
  confidence          numeric(4,3) not null,
  raw                 jsonb        not null,

  constraint sega_style_guide_candidate_pkey primary key (capture_id, catalog_source_id),
  constraint sega_style_guide_candidate_catalog_fkey
    foreign key (capture_id, catalog_source_id)
    references plm.sega_catalog (capture_id, catalog_source_id) on delete restrict,
  constraint sega_style_guide_candidate_classification_chk
    check (classification_type in
           ('style_guide','trend_guide','text_guide','packaging_guide','other_guide')),
  constraint sega_style_guide_candidate_label_nonblank_chk
    check (btrim(candidate_label) <> ''),
  -- CLOSED SET, exactly as plm.sega_character_evidence.evidence_type is closed. A merely
  -- non-blank column would let a row land as evidence_type = 'source_declared', and then
  -- only the TABLE NAME would say candidate -- a reader who trusts the column would read
  -- this pipeline's own catalog-name classification as a portal-declared style guide. The
  -- Sega portal exposes no Style Guide master record, so there is no honest value here
  -- other than the derivation rule that produced the row. Adding a future rule is a
  -- migration, which is the point: a new claim of provenance gets reviewed, not typed.
  constraint sega_style_guide_candidate_evidence_type_chk
    check (evidence_type in ('catalog_name_rule')),
  constraint sega_style_guide_candidate_evidence_value_nonblank_chk
    check (btrim(evidence_value) <> ''),
  constraint sega_style_guide_candidate_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint sega_style_guide_candidate_confidence_chk
    check (confidence between 0 and 1),
  constraint sega_style_guide_candidate_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_style_guide_candidate is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. This pipeline''s classification of a Sega catalog '
  'node as a guide of some kind. It is NOT a claim that the portal exposes a Style Guide '
  'master record -- the portal exposes none. Never promote a row here into '
  'core.style_guide automatically and never present it as a source-declared fact. '
  'evidence_type is a CLOSED set naming the derivation rule, so no row can ever assert '
  '''source_declared'' provenance -- the candidate status is enforced by a constraint, '
  'not merely implied by the table name.';


-- =====================================================================================
-- 6. plm.sega_character_candidate -- RECONSTRUCTED CHARACTERS, NOT PORTAL RECORDS.
--
-- The portal has no character master record. A candidate is the pipeline's reconstruction
-- from one named inference method; the same normalised label reached by two DIFFERENT
-- methods is deliberately two rows, because the methods are separate evidence and
-- collapsing them would destroy the ability to retire one.
-- =====================================================================================
create table plm.sega_character_candidate (
  capture_id                uuid  not null,
  character_candidate_key   text  not null,
  candidate_label           text  not null,
  normalized_candidate_label text not null,
  inference_method          text  not null,
  rule_version              text  not null,
  raw                       jsonb not null,

  constraint sega_character_candidate_pkey
    primary key (capture_id, character_candidate_key),
  constraint sega_character_candidate_capture_fkey
    foreign key (capture_id) references plm.sega_capture(id) on delete restrict,
  constraint sega_character_candidate_normalized_uk
    unique (capture_id, normalized_candidate_label, inference_method),
  constraint sega_character_candidate_key_nonblank_chk
    check (btrim(character_candidate_key) <> ''),
  constraint sega_character_candidate_label_nonblank_chk
    check (btrim(candidate_label) <> ''),
  constraint sega_character_candidate_normalized_nonblank_chk
    check (btrim(normalized_candidate_label) <> ''),
  constraint sega_character_candidate_method_nonblank_chk
    check (btrim(inference_method) <> ''),
  constraint sega_character_candidate_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint sega_character_candidate_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_character_candidate is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. A character this pipeline RECONSTRUCTED; the Sega '
  'portal states no character master record. No row here may be presented as a direct '
  'source relationship or automatically promoted to core.character. The evidence behind '
  'each candidate lives in plm.sega_character_evidence.';


-- =====================================================================================
-- 7. plm.sega_asset -- asset metadata only. NO MEDIA BYTES, EVER.
--
-- There is deliberately no bytes column and no base64 column. plm.sega_capture pins
-- media_downloaded to zero for the same reason.
-- =====================================================================================
create table plm.sega_asset (
  capture_id        uuid        not null,
  asset_source_id   text        not null,
  file_name         text        not null,
  artist_author     text            null,
  description       text            null,
  source_created_at timestamptz     null,
  source_expires_at timestamptz     null,
  file_size_kb      bigint          null,
  width             integer         null,
  height            integer         null,
  thumbnail_path    text            null,
  can_view          boolean         null,
  can_download      boolean         null,
  is_expired        boolean         null,
  source_hash       text        not null,
  raw               jsonb       not null,

  constraint sega_asset_pkey primary key (capture_id, asset_source_id),
  constraint sega_asset_capture_fkey
    foreign key (capture_id) references plm.sega_capture(id) on delete restrict,
  constraint sega_asset_source_id_nonblank_chk check (btrim(asset_source_id) <> ''),
  constraint sega_asset_file_name_nonblank_chk check (btrim(file_name) <> ''),
  constraint sega_asset_hash_nonblank_chk      check (btrim(source_hash) <> ''),
  constraint sega_asset_artist_nonblank_chk
    check (artist_author is null or btrim(artist_author) <> ''),
  constraint sega_asset_thumbnail_nonblank_chk
    check (thumbnail_path is null or btrim(thumbnail_path) <> ''),
  constraint sega_asset_size_nonneg_chk   check (file_size_kb is null or file_size_kb >= 0),
  constraint sega_asset_width_nonneg_chk  check (width  is null or width  >= 0),
  constraint sega_asset_height_nonneg_chk check (height is null or height >= 0),
  constraint sega_asset_raw_obj_chk       check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_asset is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Asset METADATA for one '
  'capture. There is no media byte column and no base64 column, by design; '
  'plm.sega_capture.media_downloaded is pinned to zero for the same reason.';


-- =====================================================================================
-- 8. plm.sega_character_evidence -- why a character candidate exists.
--
-- One row per piece of evidence. relationship_truth is pinned to 'inferred' by a CHECK
-- that admits no other value: there is no path by which a row in this table can ever
-- claim to be a portal-declared relationship.
--
-- Exactly one of catalog_source_id / asset_source_id is set. Both would make the
-- evidence ambiguous about what it observed; neither would make it unciteable.
-- =====================================================================================
create table plm.sega_character_evidence (
  capture_id              uuid         not null,
  character_candidate_key text         not null,
  evidence_key            text         not null,
  catalog_source_id       text             null,
  asset_source_id         text             null,
  evidence_type           text         not null,
  evidence_value          text         not null,
  confidence              numeric(4,3) not null,
  relationship_truth      text         not null default 'inferred',
  raw                     jsonb        not null,

  constraint sega_character_evidence_pkey
    primary key (capture_id, character_candidate_key, evidence_key),
  constraint sega_character_evidence_candidate_fkey
    foreign key (capture_id, character_candidate_key)
    references plm.sega_character_candidate (capture_id, character_candidate_key)
    on delete restrict,
  constraint sega_character_evidence_catalog_fkey
    foreign key (capture_id, catalog_source_id)
    references plm.sega_catalog (capture_id, catalog_source_id) on delete restrict,
  constraint sega_character_evidence_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.sega_asset (capture_id, asset_source_id) on delete restrict,
  constraint sega_character_evidence_type_chk
    check (evidence_type in ('character_branch','catalog_path','filename')),
  constraint sega_character_evidence_truth_chk
    check (relationship_truth = 'inferred'),
  constraint sega_character_evidence_confidence_chk
    check (confidence between 0 and 1),
  constraint sega_character_evidence_key_nonblank_chk check (btrim(evidence_key) <> ''),
  constraint sega_character_evidence_value_nonblank_chk
    check (btrim(evidence_value) <> ''),
  constraint sega_character_evidence_exactly_one_anchor_chk
    check ((catalog_source_id is not null)::integer
           + (asset_source_id is not null)::integer = 1),
  constraint sega_character_evidence_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_character_evidence is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Why a plm.sega_character_candidate row exists, '
  'anchored to exactly one catalog node or exactly one asset. relationship_truth is '
  'pinned to ''inferred'' by CHECK; there is no value that makes a row here look like a '
  'portal-declared relationship.';


-- =====================================================================================
-- 9. plm.sega_tag -- portal tags, with an honest identity rule.
--
-- Some tags carry a source ID and some do not. Rather than invent one, the identity
-- METHOD is recorded per row and the two methods are kept apart by CHECK:
--   source_id                -> tag_source_id must be present and nonblank
--   normalized_label_fallback-> tag_source_id must be NULL
-- The fallback rows deduplicate on the normalised label; the source-ID rows do not,
-- because two genuinely different tags may normalise identically.
-- =====================================================================================
create table plm.sega_tag (
  capture_id           uuid  not null,
  tag_source_key       text  not null,
  tag_source_id        text      null,
  tag_label            text  not null,
  normalized_tag_label text  not null,
  identity_method      text  not null,
  raw                  jsonb not null,

  constraint sega_tag_pkey primary key (capture_id, tag_source_key),
  constraint sega_tag_capture_fkey
    foreign key (capture_id) references plm.sega_capture(id) on delete restrict,
  constraint sega_tag_identity_method_chk
    check (identity_method in ('source_id','normalized_label_fallback')),
  -- The identity method and the presence of a source ID must agree. Either half alone
  -- would let a fallback row silently carry an ID, or an ID row silently lack one.
  constraint sega_tag_identity_agreement_chk
    check (
      (identity_method = 'source_id'
        and tag_source_id is not null and btrim(tag_source_id) <> '')
      or
      (identity_method = 'normalized_label_fallback' and tag_source_id is null)
    ),
  constraint sega_tag_key_nonblank_chk        check (btrim(tag_source_key) <> ''),
  constraint sega_tag_label_nonblank_chk      check (btrim(tag_label) <> ''),
  constraint sega_tag_normalized_nonblank_chk check (btrim(normalized_tag_label) <> ''),
  constraint sega_tag_raw_obj_chk             check (jsonb_typeof(raw) = 'object')
);

-- Deduplication for fallback-identity tags ONLY. A plain UNIQUE across all rows would
-- reject two source-ID tags that happen to normalise the same way, which is legitimate.
create unique index sega_tag_fallback_normalized_uk
  on plm.sega_tag (capture_id, normalized_tag_label)
  where tag_source_id is null;

comment on table plm.sega_tag is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Portal tags for one capture. '
  'identity_method records whether the tag had a real source ID or was keyed on its '
  'normalised label; the two are kept apart so a fallback key is never mistaken for a '
  'portal identifier.';


-- =====================================================================================
-- 10-12. DIRECT RELATIONSHIP TABLES.
--
-- These three carry PORTAL-DECLARED relationships ONLY. Asset-to-property is never
-- inferred from catalog containment -- that inference belongs in the candidate/evidence
-- tables above, if anywhere, and must not leak in here.
-- =====================================================================================
create table plm.sega_asset_catalog (
  capture_id        uuid  not null,
  asset_source_id   text  not null,
  catalog_source_id text  not null,
  raw               jsonb not null,

  constraint sega_asset_catalog_pkey
    primary key (capture_id, asset_source_id, catalog_source_id),
  constraint sega_asset_catalog_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.sega_asset (capture_id, asset_source_id) on delete restrict,
  constraint sega_asset_catalog_catalog_fkey
    foreign key (capture_id, catalog_source_id)
    references plm.sega_catalog (capture_id, catalog_source_id) on delete restrict,
  constraint sega_asset_catalog_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_asset_catalog is
  'LICENSED SEGA SOURCE EVIDENCE. DIRECT portal relationship: which catalog node holds an '
  'asset. Portal-declared only -- nothing inferred lands here.';

create table plm.sega_asset_tag (
  capture_id      uuid  not null,
  asset_source_id text  not null,
  tag_source_key  text  not null,
  raw             jsonb not null,

  constraint sega_asset_tag_pkey primary key (capture_id, asset_source_id, tag_source_key),
  constraint sega_asset_tag_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.sega_asset (capture_id, asset_source_id) on delete restrict,
  constraint sega_asset_tag_tag_fkey
    foreign key (capture_id, tag_source_key)
    references plm.sega_tag (capture_id, tag_source_key) on delete restrict,
  constraint sega_asset_tag_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_asset_tag is
  'LICENSED SEGA SOURCE EVIDENCE. DIRECT portal relationship: which tags an asset carries. '
  'Portal-declared only -- nothing inferred lands here.';

create table plm.sega_asset_property (
  capture_id         uuid  not null,
  asset_source_id    text  not null,
  property_source_id text  not null,
  evidence_type      text  not null default 'source_asset_ip_association',
  raw                jsonb not null,

  constraint sega_asset_property_pkey
    primary key (capture_id, asset_source_id, property_source_id),
  constraint sega_asset_property_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.sega_asset (capture_id, asset_source_id) on delete restrict,
  constraint sega_asset_property_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.sega_property (capture_id, property_source_id) on delete restrict,
  -- The single permitted value IS the guarantee. Widening this check is how a catalog
  -- containment guess would get in, so it is a closed set of exactly one.
  constraint sega_asset_property_evidence_type_chk
    check (evidence_type = 'source_asset_ip_association'),
  constraint sega_asset_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_asset_property is
  'LICENSED SEGA SOURCE EVIDENCE. DIRECT portal relationship: the source''s own '
  'asset-to-IP association. evidence_type admits exactly one value by CHECK, so an '
  'inference from catalog containment can never be written here.';


-- =====================================================================================
-- INDEXES.
--
-- A composite primary key is indexed left-to-right, so (capture_id, X) lookups are
-- already covered. What is NOT covered is the REVERSE direction of every composite
-- foreign key -- what a delete check and every "find all edges touching this entity"
-- query needs -- plus the label, hash and path lookups the reconciliation work will do.
-- =====================================================================================
create index idx_sega_capture_status_captured
  on plm.sega_capture (status, source_captured_at desc);

create index idx_sega_property_capture            on plm.sega_property (capture_id);
create index idx_sega_property_licensor_capture   on plm.sega_property_licensor (capture_id);
create index idx_sega_catalog_capture             on plm.sega_catalog (capture_id);
create index idx_sega_style_guide_candidate_capture
  on plm.sega_style_guide_candidate (capture_id);
create index idx_sega_character_candidate_capture on plm.sega_character_candidate (capture_id);
create index idx_sega_character_evidence_capture  on plm.sega_character_evidence (capture_id);
create index idx_sega_asset_capture               on plm.sega_asset (capture_id);
create index idx_sega_tag_capture                 on plm.sega_tag (capture_id);
create index idx_sega_asset_catalog_capture       on plm.sega_asset_catalog (capture_id);
create index idx_sega_asset_tag_capture           on plm.sega_asset_tag (capture_id);
create index idx_sega_asset_property_capture      on plm.sega_asset_property (capture_id);

-- source_hash drives "did this row change between captures?".
create index idx_sega_property_source_hash on plm.sega_property (source_hash);
create index idx_sega_catalog_source_hash  on plm.sega_catalog (source_hash);
create index idx_sega_asset_source_hash    on plm.sega_asset (source_hash);

-- Normalised label lookups. NEVER unique here: uniqueness is expressed by the
-- constraints above, which are scoped correctly; a broad unique index would reject
-- legitimate captures.
create index idx_sega_property_licensor_normalized
  on plm.sega_property_licensor (normalized_licensor_label);
create index idx_sega_character_candidate_normalized
  on plm.sega_character_candidate (normalized_candidate_label);
create index idx_sega_tag_normalized on plm.sega_tag (normalized_tag_label);

-- Catalog navigation: children of a node, and prefix search over the path.
create index idx_sega_catalog_parent
  on plm.sega_catalog (capture_id, parent_catalog_source_id);
create index idx_sega_catalog_path on plm.sega_catalog (capture_id, hierarchy_path);

create index idx_sega_asset_file_name on plm.sega_asset (file_name);

-- Reverse direction of every composite foreign key.
create index idx_sega_property_licensor_property
  on plm.sega_property_licensor (capture_id, property_source_id);
create index idx_sega_character_evidence_candidate
  on plm.sega_character_evidence (capture_id, character_candidate_key);
create index idx_sega_character_evidence_catalog
  on plm.sega_character_evidence (capture_id, catalog_source_id)
  where catalog_source_id is not null;
create index idx_sega_character_evidence_asset
  on plm.sega_character_evidence (capture_id, asset_source_id)
  where asset_source_id is not null;
create index idx_sega_asset_catalog_catalog
  on plm.sega_asset_catalog (capture_id, catalog_source_id);
create index idx_sega_asset_tag_tag
  on plm.sega_asset_tag (capture_id, tag_source_key);
create index idx_sega_asset_property_property
  on plm.sega_asset_property (capture_id, property_source_id);


-- =====================================================================================
-- FUNCTIONS.
--
-- Both are `security definer` with a pinned search_path, execute REVOKED from public and
-- granted ONLY to service_role. They are the sole write path to plm.sega_capture, which
-- service_role can only read.
-- =====================================================================================

create or replace function plm.begin_sega_capture(
  p_capture_key              text,
  p_source_repository        text,
  p_source_commit_sha        text,
  p_source_manifest_sha256   text,
  p_portal_base_url          text,
  p_source_captured_at       timestamptz,
  p_expected_counts          jsonb,
  p_raw_summary              jsonb,
  p_created_by               text,
  p_is_limited               boolean,
  p_ip_paging_terminal       boolean,
  p_asset_paging_terminal    boolean,
  p_ip_associations_complete boolean,
  p_read_commit_sha          text default null
) returns uuid
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_existing plm.sega_capture%rowtype;
  v_id       uuid;
begin
  -- Validate before touching anything. A malformed argument must fail here, loudly,
  -- rather than land a half-described capture that the finalization gate then has to
  -- reason about.
  if p_capture_key is null or btrim(p_capture_key) = '' then
    raise exception 'begin_sega_capture: capture_key is required';
  end if;
  if p_source_repository is null or btrim(p_source_repository) = '' then
    raise exception 'begin_sega_capture: source_repository is required';
  end if;
  if p_portal_base_url is null or btrim(p_portal_base_url) = '' then
    raise exception 'begin_sega_capture: portal_base_url is required';
  end if;
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'begin_sega_capture: created_by is required';
  end if;
  if p_source_captured_at is null then
    raise exception 'begin_sega_capture: source_captured_at is required';
  end if;
  if p_source_commit_sha is null or p_source_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_sega_capture: source_commit_sha must be 40 lowercase hex characters';
  end if;
  if p_read_commit_sha is not null and p_read_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_sega_capture: read_commit_sha must be 40 lowercase hex characters';
  end if;
  if p_source_manifest_sha256 is null or p_source_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception
      'begin_sega_capture: source_manifest_sha256 must be 64 lowercase hex characters';
  end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts) <> 'object'
     or p_expected_counts = '{}'::jsonb then
    raise exception 'begin_sega_capture: expected_counts must be a non-empty JSON object';
  end if;
  -- EVERY VALUE MUST BE A JSON NUMBER THAT IS A NON-NEGATIVE INTEGER.
  --
  -- A JSON `null` here is NOT a missing key. It is the exact shape a loader produces from
  -- jsonb_build_object('assets', v_unset_count): the key IS present, so a `?` test at the
  -- publication gate calls the count supplied, while every comparison against the
  -- resulting SQL NULL is UNKNOWN and therefore never false. That is a SKIPPED count
  -- check, and a skipped count check is exactly how a failed or first-page-only asset
  -- crawl publishes as the current complete capture. Refused here, loudly, at the start --
  -- and refused AGAIN at the publication gate, which re-reads the STORED object rather
  -- than trusting that this ever ran.
  --
  -- TWO SEPARATE STATEMENTS, NOT ONE `or`-ED PREDICATE. SQL does not promise to
  -- short-circuit `or`, so a single combined predicate could evaluate the numeric cast on
  -- a JSON string and die with a raw cast error instead of this named message. The type
  -- test has to have finished before anything casts.
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where jsonb_typeof(e.value) <> 'number'
  ) then
    raise exception
      'begin_sega_capture: every expected_counts value must be a JSON number that is a non-negative integer; a null, string, boolean, object or array there would SKIP that count check at the publication gate; got %',
      p_expected_counts;
  end if;
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where (e.value #>> '{}')::numeric < 0
        or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
  ) then
    raise exception
      'begin_sega_capture: every expected_counts value must be a JSON number that is a non-negative integer; got %',
      p_expected_counts;
  end if;
  if p_raw_summary is null or jsonb_typeof(p_raw_summary) <> 'object' then
    raise exception 'begin_sega_capture: raw_summary must be a JSON object';
  end if;
  if p_is_limited is null or p_ip_paging_terminal is null
     or p_asset_paging_terminal is null or p_ip_associations_complete is null then
    raise exception
      'begin_sega_capture: the scope and completeness flags are required and may not be null';
  end if;
  -- Zero-media scope. The table pins media_downloaded to zero; if the manifest CLAIMS a
  -- nonzero media count then the extract and this schema disagree, and that must stop the
  -- load rather than be quietly ignored.
  if (p_expected_counts ? 'media_downloaded')
     and (p_expected_counts ->> 'media_downloaded') <> '0' then
    raise exception
      'begin_sega_capture: expected_counts.media_downloaded must be 0; this project never downloads media';
  end if;

  -- Serialize concurrent starts of the SAME capture_key. Two loader processes racing here
  -- would otherwise both miss the select and both insert.
  perform pg_advisory_xact_lock(hashtextextended('plm.sega_capture:' || p_capture_key, 0));

  select * into v_existing from plm.sega_capture where capture_key = p_capture_key;

  if found then
    -- Same key, different bytes, is a CONTRADICTION, not a resume. Refuse it: silently
    -- appending different source data under an existing capture key would make the
    -- snapshot unreconstructable.
    if v_existing.source_manifest_sha256 is distinct from p_source_manifest_sha256 then
      raise exception
        'begin_sega_capture: capture_key % already exists with a DIFFERENT source manifest hash; refusing',
        p_capture_key;
    end if;
    if v_existing.source_commit_sha is distinct from p_source_commit_sha then
      raise exception
        'begin_sega_capture: capture_key % already exists with a DIFFERENT source commit sha; refusing',
        p_capture_key;
    end if;
    if v_existing.source_repository is distinct from p_source_repository
       or v_existing.portal_base_url is distinct from p_portal_base_url
       or v_existing.source_captured_at is distinct from p_source_captured_at then
      raise exception
        'begin_sega_capture: capture_key % already exists with a DIFFERENT source identity; refusing',
        p_capture_key;
    end if;
    if v_existing.is_limited is distinct from p_is_limited
       or v_existing.ip_paging_terminal is distinct from p_ip_paging_terminal
       or v_existing.asset_paging_terminal is distinct from p_asset_paging_terminal
       or v_existing.ip_associations_complete is distinct from p_ip_associations_complete then
      raise exception
        'begin_sega_capture: capture_key % already exists with DIFFERENT scope/completeness flags; refusing',
        p_capture_key;
    end if;

    if v_existing.status = 'complete' then
      -- Idempotent: hand back the finished capture untouched. Never re-open it.
      return v_existing.id;
    elsif v_existing.status = 'loading' then
      -- Resume. Only the loader's own read commit may be refreshed.
      update plm.sega_capture
         set read_commit_sha = coalesce(p_read_commit_sha, read_commit_sha)
       where id = v_existing.id;
      return v_existing.id;
    else
      raise exception
        'begin_sega_capture: capture_key % is %; start a NEW capture rather than reusing it',
        p_capture_key, v_existing.status;
    end if;
  end if;

  insert into plm.sega_capture (
    capture_key, source_repository, source_commit_sha, read_commit_sha,
    source_manifest_sha256, portal_base_url, source_captured_at, status,
    expected_counts, raw_summary, created_by,
    is_limited, ip_paging_terminal, asset_paging_terminal, ip_associations_complete
  ) values (
    p_capture_key, p_source_repository, p_source_commit_sha, p_read_commit_sha,
    p_source_manifest_sha256, p_portal_base_url, p_source_captured_at, 'loading',
    p_expected_counts, p_raw_summary, p_created_by,
    p_is_limited, p_ip_paging_terminal, p_asset_paging_terminal, p_ip_associations_complete
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function plm.begin_sega_capture(
  text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,boolean,boolean,boolean,text) is
  'Creates or RESUMES exactly one loading Sega capture. Idempotent for an identical '
  'capture. Refuses to re-open a complete or terminal capture, and refuses a same-key '
  'capture whose manifest hash, commit, source identity or scope/completeness flags '
  'differ. The scope and completeness flags are MANIFEST FACTS fixed here for the life of '
  'the capture -- nothing may mutate them later. Sole insert path to plm.sega_capture. '
  'service_role only.';


create or replace function plm.finalize_sega_capture(
  p_capture_id     uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.sega_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_d     bigint;
  v_want  bigint;
  v_key   text;
  v_pairs text[][] := array[
    ['properties',            'sega_property'],
    ['property_licensors',    'sega_property_licensor'],
    ['catalogs',              'sega_catalog'],
    ['style_guide_candidates','sega_style_guide_candidate'],
    ['character_candidates',  'sega_character_candidate'],
    ['character_evidence',    'sega_character_evidence'],
    ['assets',                'sega_asset'],
    ['tags',                  'sega_tag'],
    ['asset_catalogs',        'sega_asset_catalog'],
    ['asset_tags',            'sega_asset_tag'],
    ['asset_properties',      'sega_asset_property']
  ];
  i integer;
begin
  if p_observed_counts is null or jsonb_typeof(p_observed_counts) <> 'object' then
    raise exception 'finalize_sega_capture: p_observed_counts must be a JSON object';
  end if;
  if p_error_summary is null or jsonb_typeof(p_error_summary) <> 'array' then
    raise exception 'finalize_sega_capture: p_error_summary must be a JSON array';
  end if;

  -- The row lock serialises two loaders finalising the same capture.
  select * into v_cap from plm.sega_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_sega_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_sega_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. SCOPE AND COMPLETENESS. A limited or non-terminal capture is not publishable
  -- at all; it is the "partial crawl landed as if complete" failure this design exists to
  -- prevent.
  if v_cap.is_limited then
    v_err := v_err || jsonb_build_object('code','capture_is_limited');
  end if;
  if not v_cap.ip_paging_terminal then
    v_err := v_err || jsonb_build_object('code','ip_paging_not_terminal');
  end if;
  if not v_cap.asset_paging_terminal then
    v_err := v_err || jsonb_build_object('code','asset_paging_not_terminal');
  end if;
  if not v_cap.ip_associations_complete then
    v_err := v_err || jsonb_build_object('code','ip_associations_incomplete');
  end if;
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;

  -- ---- B. Errors the loader itself reported are fatal. A capture that knows it failed
  -- may never publish, whatever the counts say.
  if jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object('code','loader_reported_errors',
                                         'count', jsonb_array_length(p_error_summary));
  end if;

  -- ---- C. Counts, taken from the TABLES, never from a ledger or a summary document.
  -- This repository has shipped a migration that recorded a clean ledger row while its
  -- object did nothing, so "it reported success" is not evidence of anything here.
  --
  -- Three facts must agree: what the source contract EXPECTED, what the loader CLAIMS it
  -- wrote, and what is ACTUALLY in the tables. Checking only two of the three lets a
  -- loader that miscounted its own output pass.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE for
    -- {"assets": null}, and every comparison against the resulting SQL NULL is UNKNOWN --
    -- so a naive `if v_n <> v_want` would NEVER FIRE and the count would go entirely
    -- unchecked, which is the same publication failure as omitting the key. The value must
    -- therefore be a JSON NUMBER, and a non-negative integer at that: a fractional or
    -- negative expectation is a broken loader, not a count.
    --
    -- This re-checks the STORED object rather than trusting that begin_sega_capture ran
    -- its own guard: an owner-level UPDATE can reach plm.sega_capture.expected_counts
    -- without going through that function at all.
    --
    -- The branches are separate, not one `or`-ed predicate: SQL does not promise to
    -- short-circuit `or`, so a combined test could cast a JSON string and die with a raw
    -- cast error instead of the named code below.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    else
      v_want := (v_exp ->> v_key)::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;

    -- The loader's own reported counts carry the identical trap: {"assets": null} makes
    -- `?` true and `(p_observed_counts ->> v_key)::bigint` SQL NULL, so the comparison is
    -- UNKNOWN and the check is skipped. A present non-number is itself a disagreement.
    if not (p_observed_counts ? v_key) then
      v_err := v_err || jsonb_build_object('code','reported_count_missing','entity',v_key);
    elsif jsonb_typeof(p_observed_counts -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                           'entity',v_key,
                                           'json_type',
                                           jsonb_typeof(p_observed_counts -> v_key));
    elsif (p_observed_counts ->> v_key)::numeric < 0
       or (p_observed_counts ->> v_key)::numeric
           <> trunc((p_observed_counts ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_nonnegative_integer',
                                           'entity',v_key,
                                           'reported', p_observed_counts -> v_key);
    elsif (p_observed_counts ->> v_key)::bigint <> v_n then
      v_err := v_err || jsonb_build_object('code','reported_count_mismatch','entity',v_key,
                                           'reported',(p_observed_counts ->> v_key)::bigint,
                                           'observed',v_n);
    end if;
  end loop;

  -- The loop above only inspects the eleven entity keys this schema knows. A stored
  -- expected_counts or a reported observed_counts may carry OTHER keys -- media_downloaded
  -- is one, and a future loader may add more -- and a non-number sitting in one of those
  -- is the same class of defect: a value that looks supplied and compares to nothing.
  -- Sweep the whole object so no key escapes the type rule.
  for v_key in select e.key from jsonb_each(v_exp) e
                where not (v_obs ? e.key)
                  and jsonb_typeof(e.value) <> 'number' loop
    v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                         'entity',v_key,
                                         'json_type', jsonb_typeof(v_exp -> v_key));
  end loop;
  for v_key in select e.key from jsonb_each(p_observed_counts) e
                where not (v_obs ? e.key)
                  and jsonb_typeof(e.value) <> 'number' loop
    v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                         'entity',v_key,
                                         'json_type',
                                         jsonb_typeof(p_observed_counts -> v_key));
  end loop;

  -- ---- D. Duplicate source identifiers. The primary keys already make these impossible;
  -- this asserts that they are still in force rather than trusting that no later migration
  -- weakened one. It is cheap and it fails loudly.
  select count(*), count(distinct property_source_id) into v_n, v_d
    from plm.sega_property where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_property_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct catalog_source_id) into v_n, v_d
    from plm.sega_catalog where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_catalog_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct hierarchy_path) into v_n, v_d
    from plm.sega_catalog where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_catalog_hierarchy_path',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct asset_source_id) into v_n, v_d
    from plm.sega_asset where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct tag_source_key) into v_n, v_d
    from plm.sega_tag where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_tag_source_key',
                                         'rows',v_n,'distinct',v_d);
  end if;

  -- ---- E. Catalog parents. The self-FK is DEFERRABLE, so it is checked at commit; this
  -- reports the same condition as a structured error instead of a raw constraint abort,
  -- and additionally rejects a non-root node that names no parent at all.
  select count(*) into v_n
    from plm.sega_catalog c
   where c.capture_id = p_capture_id
     and c.parent_catalog_source_id is not null
     and not exists (select 1 from plm.sega_catalog p
                      where p.capture_id = c.capture_id
                        and p.catalog_source_id = c.parent_catalog_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','unresolved_catalog_parent','count',v_n);
  end if;
  select count(*) into v_n
    from plm.sega_catalog c
   where c.capture_id = p_capture_id
     and c.hierarchy_depth > 1
     and c.parent_catalog_source_id is null;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','non_root_catalog_without_parent','count',v_n);
  end if;

  -- ---- F. Orphaned relationship endpoints. The composite FKs already make a cross-capture
  -- edge impossible; same reasoning as D -- assert the guarantee, do not assume it.
  select count(*) into v_n
    from plm.sega_asset_catalog l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_catalog c
                       where c.capture_id = l.capture_id
                         and c.catalog_source_id = l.catalog_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_catalog_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_asset_tag l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_tag t
                       where t.capture_id = l.capture_id
                         and t.tag_source_key = l.tag_source_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_tag_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_asset_property l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_property p
                       where p.capture_id = l.capture_id
                         and p.property_source_id = l.property_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_property_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_property_licensor l
   where l.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_property p
                      where p.capture_id = l.capture_id
                        and p.property_source_id = l.property_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_property_licensor','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_character_evidence e
   where e.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_character_candidate c
                      where c.capture_id = e.capture_id
                        and c.character_candidate_key = e.character_candidate_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_character_evidence','count',v_n);
  end if;

  -- Every character candidate must be able to say WHY it exists. A candidate with no
  -- evidence is an unsupported assertion about a licensor's characters.
  select count(*) into v_n
    from plm.sega_character_candidate c
   where c.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_character_evidence e
                      where e.capture_id = c.capture_id
                        and e.character_candidate_key = c.character_candidate_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','character_candidate_without_evidence',
                                         'count',v_n);
  end if;

  -- ---- VERDICT. There is no partial publish: either every check passed or the capture is
  -- rejected and the PREVIOUS complete capture stays current.
  --
  -- WHY THIS DOES NOT RAISE ON A REJECTION, AND WHY THAT IS NOT A SILENT FAILURE.
  -- The contract requires BOTH "set status='rejected' and persist the errors" AND a loud
  -- failure. In PostgreSQL an exception aborts the very transaction that wrote the
  -- rejection row, so raising would roll back the evidence and leave the capture sitting
  -- in 'loading' with no record of why it failed -- destroying the auditability the
  -- rejection exists for. The same impossibility was recorded for
  -- plm.finalize_nbcu_capture (20260810070000) and resolved the same way.
  -- The failure is therefore loud in three simultaneous, inspectable ways:
  --   1. a WARNING in the server log,
  --   2. a PERSISTED status of 'rejected' with the structured errors,
  --   3. the capture is NOT 'complete', which is the only thing any reader keys on.
  -- THE CALLER MUST READ BACK plm.sega_capture.status. This function returns void by
  -- contract, so the status column is the return value.
  if jsonb_array_length(v_err) > 0 then
    update plm.sega_capture
       set status = 'rejected', observed_counts = v_obs, error_summary = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning 'finalize_sega_capture: capture % REJECTED with % error(s): %',
      p_capture_id, jsonb_array_length(v_err), v_err;
    return;
  end if;

  update plm.sega_capture
     set status = 'complete', observed_counts = v_obs,
         error_summary = '[]'::jsonb, load_completed_at = now()
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_sega_capture(uuid, jsonb, jsonb) is
  'The publication gate for a Sega capture. Under a row lock it rejects a limited or '
  'non-terminal capture, loader-reported errors, duplicate source identifiers, orphaned '
  'relationship endpoints, unresolved or missing non-root catalog parents, character '
  'candidates with no evidence, and any count where the source contract, the loader''s '
  'claim and the actual table contents disagree. All pass -> status ''complete'' with the '
  'table-derived observed counts. Any fail -> status ''rejected'', errors PERSISTED, a '
  'server WARNING raised, and the previous complete capture left current. NEVER a partial '
  'publish. It returns void by contract, so THE CALLER MUST READ BACK '
  'plm.sega_capture.status -- raising instead would roll back the rejection record itself '
  '(see the comment in the function body). service_role only.';


-- =====================================================================================
-- RLS, GRANTS, AND THE IMMUTABILITY MECHANISM.
--
-- An RLS policy is not a GRANT and a GRANT is not an RLS policy (AGENTS.md section 11).
-- Both are set here. Supabase's service_role carries BYPASSRLS, so RLS alone could NOT
-- constrain the loader -- the GRANTS are what enforce immutability.
--
--   plm.sega_capture -> service_role: SELECT only. All writes go through the two
--                       security-definer functions.
--   the other 11     -> service_role: SELECT + INSERT. No UPDATE, DELETE or TRUNCATE.
--                       Rows are immutable from the instant they land.
--   authenticated    -> SELECT only, under the established plm read predicate:
--                       PLM app access, administrator, sales or licensing.
--   anon             -> nothing, revoked explicitly.
-- =====================================================================================
-- Every statement below is written out in full, one per table. No dynamic SQL: an
-- auditor -- and the migration guard that verifies a migration only touches objects its
-- author claimed -- must be able to read exactly which table receives which privilege
-- without executing anything.
--
-- ENABLE, deliberately NOT FORCE. FORCE would apply RLS to the table owner too, which
-- locks the migration runner and every contract-test session out of its own tables for
-- no security gain -- service_role is the identity being constrained, and it is
-- constrained by the GRANTS below, not by RLS.

-- plm.sega_capture
alter table plm.sega_capture enable row level security;
revoke all on plm.sega_capture from public;
revoke all on plm.sega_capture from anon;
revoke all on plm.sega_capture from authenticated;
grant select on plm.sega_capture to service_role;
grant select on plm.sega_capture to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_capture_service_read on plm.sega_capture
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_capture_plm_read on plm.sega_capture
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_property
alter table plm.sega_property enable row level security;
revoke all on plm.sega_property from public;
revoke all on plm.sega_property from anon;
revoke all on plm.sega_property from authenticated;
grant select, insert on plm.sega_property to service_role;
grant select on plm.sega_property to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_property_service_read on plm.sega_property
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_property_plm_read on plm.sega_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_property_licensor
alter table plm.sega_property_licensor enable row level security;
revoke all on plm.sega_property_licensor from public;
revoke all on plm.sega_property_licensor from anon;
revoke all on plm.sega_property_licensor from authenticated;
grant select, insert on plm.sega_property_licensor to service_role;
grant select on plm.sega_property_licensor to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_property_licensor_service_read on plm.sega_property_licensor
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_property_licensor_plm_read on plm.sega_property_licensor
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_catalog
alter table plm.sega_catalog enable row level security;
revoke all on plm.sega_catalog from public;
revoke all on plm.sega_catalog from anon;
revoke all on plm.sega_catalog from authenticated;
grant select, insert on plm.sega_catalog to service_role;
grant select on plm.sega_catalog to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_catalog_service_read on plm.sega_catalog
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_catalog_plm_read on plm.sega_catalog
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_style_guide_candidate
alter table plm.sega_style_guide_candidate enable row level security;
revoke all on plm.sega_style_guide_candidate from public;
revoke all on plm.sega_style_guide_candidate from anon;
revoke all on plm.sega_style_guide_candidate from authenticated;
grant select, insert on plm.sega_style_guide_candidate to service_role;
grant select on plm.sega_style_guide_candidate to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_style_guide_candidate_service_read on plm.sega_style_guide_candidate
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_style_guide_candidate_plm_read on plm.sega_style_guide_candidate
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_character_candidate
alter table plm.sega_character_candidate enable row level security;
revoke all on plm.sega_character_candidate from public;
revoke all on plm.sega_character_candidate from anon;
revoke all on plm.sega_character_candidate from authenticated;
grant select, insert on plm.sega_character_candidate to service_role;
grant select on plm.sega_character_candidate to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_character_candidate_service_read on plm.sega_character_candidate
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_character_candidate_plm_read on plm.sega_character_candidate
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_character_evidence
alter table plm.sega_character_evidence enable row level security;
revoke all on plm.sega_character_evidence from public;
revoke all on plm.sega_character_evidence from anon;
revoke all on plm.sega_character_evidence from authenticated;
grant select, insert on plm.sega_character_evidence to service_role;
grant select on plm.sega_character_evidence to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_character_evidence_service_read on plm.sega_character_evidence
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_character_evidence_plm_read on plm.sega_character_evidence
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_asset
alter table plm.sega_asset enable row level security;
revoke all on plm.sega_asset from public;
revoke all on plm.sega_asset from anon;
revoke all on plm.sega_asset from authenticated;
grant select, insert on plm.sega_asset to service_role;
grant select on plm.sega_asset to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_asset_service_read on plm.sega_asset
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_asset_plm_read on plm.sega_asset
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_tag
alter table plm.sega_tag enable row level security;
revoke all on plm.sega_tag from public;
revoke all on plm.sega_tag from anon;
revoke all on plm.sega_tag from authenticated;
grant select, insert on plm.sega_tag to service_role;
grant select on plm.sega_tag to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_tag_service_read on plm.sega_tag
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_tag_plm_read on plm.sega_tag
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_asset_catalog
alter table plm.sega_asset_catalog enable row level security;
revoke all on plm.sega_asset_catalog from public;
revoke all on plm.sega_asset_catalog from anon;
revoke all on plm.sega_asset_catalog from authenticated;
grant select, insert on plm.sega_asset_catalog to service_role;
grant select on plm.sega_asset_catalog to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_asset_catalog_service_read on plm.sega_asset_catalog
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_asset_catalog_plm_read on plm.sega_asset_catalog
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_asset_tag
alter table plm.sega_asset_tag enable row level security;
revoke all on plm.sega_asset_tag from public;
revoke all on plm.sega_asset_tag from anon;
revoke all on plm.sega_asset_tag from authenticated;
grant select, insert on plm.sega_asset_tag to service_role;
grant select on plm.sega_asset_tag to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_asset_tag_service_read on plm.sega_asset_tag
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_asset_tag_plm_read on plm.sega_asset_tag
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.sega_asset_property
alter table plm.sega_asset_property enable row level security;
revoke all on plm.sega_asset_property from public;
revoke all on plm.sega_asset_property from anon;
revoke all on plm.sega_asset_property from authenticated;
grant select, insert on plm.sega_asset_property to service_role;
grant select on plm.sega_asset_property to authenticated;

-- One permissive policy so a future BYPASSRLS-less service identity can still read.
-- It grants nothing on its own: without the GRANT above, SELECT still fails.
create policy sega_asset_property_service_read on plm.sega_asset_property
  for select to service_role using (true);

-- The established plm read predicate, identical to policy plm_read in
-- 20260621151155_api_rls_realtime.sql. Licensed source material is readable by the
-- same population that already reads plm, and by nobody else.
create policy sega_asset_property_plm_read on plm.sega_asset_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- -------------------------------------------------------------------------------------
-- THE REVOKES THAT ACTUALLY DELIVER IMMUTABILITY.
--
-- The schema `plm` carries ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
-- service_role, so Postgres handed every table above SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER at CREATE TABLE time. The `grant select, insert`
-- statements above were therefore NO-OPS against a role that already held everything.
-- This is exactly the defect that migration 20260810080000 had to correct for NBCU
-- after the fact; it is handled inside this file instead.
--
-- REFERENCES and TRIGGER are left in place. REFERENCES only allows creating a foreign key
-- that points AT these tables, which writes nothing, and no user trigger exists on them.
-- -------------------------------------------------------------------------------------
revoke update, delete, truncate on plm.sega_capture from service_role;
revoke insert on plm.sega_capture from authenticated;
revoke update, delete, truncate on plm.sega_capture from authenticated;
-- Capture rows are created and transitioned ONLY by plm.begin_sega_capture and
-- plm.finalize_sega_capture. A direct INSERT here would let a loader mint a capture
-- that skipped every validation in begin_*.
revoke insert on plm.sega_capture from service_role;

revoke update, delete, truncate on plm.sega_property from service_role;
revoke insert on plm.sega_property from authenticated;
revoke update, delete, truncate on plm.sega_property from authenticated;

revoke update, delete, truncate on plm.sega_property_licensor from service_role;
revoke insert on plm.sega_property_licensor from authenticated;
revoke update, delete, truncate on plm.sega_property_licensor from authenticated;

revoke update, delete, truncate on plm.sega_catalog from service_role;
revoke insert on plm.sega_catalog from authenticated;
revoke update, delete, truncate on plm.sega_catalog from authenticated;

revoke update, delete, truncate on plm.sega_style_guide_candidate from service_role;
revoke insert on plm.sega_style_guide_candidate from authenticated;
revoke update, delete, truncate on plm.sega_style_guide_candidate from authenticated;

revoke update, delete, truncate on plm.sega_character_candidate from service_role;
revoke insert on plm.sega_character_candidate from authenticated;
revoke update, delete, truncate on plm.sega_character_candidate from authenticated;

revoke update, delete, truncate on plm.sega_character_evidence from service_role;
revoke insert on plm.sega_character_evidence from authenticated;
revoke update, delete, truncate on plm.sega_character_evidence from authenticated;

revoke update, delete, truncate on plm.sega_asset from service_role;
revoke insert on plm.sega_asset from authenticated;
revoke update, delete, truncate on plm.sega_asset from authenticated;

revoke update, delete, truncate on plm.sega_tag from service_role;
revoke insert on plm.sega_tag from authenticated;
revoke update, delete, truncate on plm.sega_tag from authenticated;

revoke update, delete, truncate on plm.sega_asset_catalog from service_role;
revoke insert on plm.sega_asset_catalog from authenticated;
revoke update, delete, truncate on plm.sega_asset_catalog from authenticated;

revoke update, delete, truncate on plm.sega_asset_tag from service_role;
revoke insert on plm.sega_asset_tag from authenticated;
revoke update, delete, truncate on plm.sega_asset_tag from authenticated;

revoke update, delete, truncate on plm.sega_asset_property from service_role;
revoke insert on plm.sega_asset_property from authenticated;
revoke update, delete, truncate on plm.sega_asset_property from authenticated;

revoke all on function plm.begin_sega_capture(
  text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,boolean,boolean,boolean,text)
  from public;
revoke all on function plm.finalize_sega_capture(uuid, jsonb, jsonb) from public;
grant execute on function plm.begin_sega_capture(
  text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,boolean,boolean,boolean,text)
  to service_role;
grant execute on function plm.finalize_sega_capture(uuid, jsonb, jsonb) to service_role;

-- Assert the OUTCOME inside the migration, so this file cannot fail silently the way the
-- NBCU landing did. If the revokes did not take, this raises and the migration fails.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee in ('service_role','authenticated')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then
    raise exception
      'sega landing: % write grant(s) survive on sega tables; immutability is INERT', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name = 'sega_capture'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 0 then
    raise exception 'sega landing: plm.sega_capture is still directly insertable';
  end if;

  -- A revoke that overshot into SELECT or INSERT would break the loader, so prove it did
  -- not: 12 readable tables, 11 insertable snapshot tables.
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_bad <> 12 then
    raise exception 'sega landing: expected 12 service_role SELECT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 11 then
    raise exception 'sega landing: expected 11 service_role INSERT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'sega\_%'
     and grantee = 'anon';
  if v_bad <> 0 then
    raise exception 'sega landing: anon holds % grant(s) on sega tables', v_bad;
  end if;

  raise notice 'sega privileges: service_role SELECT x12 / INSERT x11, no UPDATE/DELETE/TRUNCATE, anon none';
end;
$$;


-- =====================================================================================
-- api.source_capture_inventory -- EXTENDED, not rewritten.
--
-- This body is the CURRENT definition from 20260814233342 with the Sega source added and
-- nothing else changed. Every pre-existing source (disney/opa, paramount, nbcu, warner,
-- coldlion, other) keeps its exact classification, counting rule, basis, status and note,
-- and the ten output columns keep their names, types and order so existing SELECT *
-- consumers do not shift.
--
-- WHAT WAS ADDED, EXHAUSTIVELY:
--   1. `sega_capture_id` in the `latest` CTE -- the newest complete Sega capture.
--   2. `sega\_%` -> source_system 'sega' in the classifier.
--   3. Sega branches in latest_count, count_basis, latest_complete_status and count_note,
--      mirroring the NBCU rules exactly (one latest complete capture; loading, rejected
--      and abandoned attempts stay retained-only).
--
-- It exposes only counts and status. NO Sega row value is visible through this view, so
-- there is no licensed-content exposure here.
-- =====================================================================================
create or replace view api.source_capture_inventory as
with latest as (
  select
    (select capture_id from plm.pmt_capture
      where status = 'complete' and capture_kind = 'full'
      order by completed_at desc nulls last, started_at desc, capture_id desc limit 1)
      as pmt_capture_id,
    (select id from plm.nbcu_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl
      where status = 'complete'
      order by captured_on desc, finished_at desc, crawl_id desc limit 1)
      as dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run
      where status = 'complete'
      order by captured_on desc, finished_at desc, metadata_run_id desc limit 1)
      as dcp_metadata_run_id,
    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'crawl_id') as has_crawl_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'metadata_run_id') as has_metadata_run_id,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                          'resolved_at','resolution_status')
    ) as carries_resolution,
    obj_description(c.oid, 'pg_class') as table_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm' and c.relkind = 'r'
), classified as (
  select c.*,
    case
      when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
      when c.relname like 'pmt\_%' then 'paramount'
      when c.relname like 'nbcu\_%' then 'nbcu'
      when c.relname like 'wb\_%' then 'warner'
      when c.relname like 'erp\_%' then 'coldlion'
      when c.relname like 'sega\_%' then 'sega'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

      -- Paramount: one latest complete FULL capture, matching api.pmt_latest_complete_capture.
      when c.relname = 'pmt_capture' then case when l.pmt_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_%' and c.has_capture_id and l.pmt_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.pmt_capture_id::text), false, true, '')))[1]::text::bigint

      -- NBCU: one latest complete capture; rejected and abandoned attempts stay retained only.
      when c.relname = 'nbcu_capture' then case when l.nbcu_capture_id is null then null else 1::bigint end
      when c.relname like 'nbcu\_%' and c.has_capture_id and l.nbcu_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.nbcu_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega: identical contract to NBCU -- one latest complete capture, and loading,
      -- rejected and abandoned attempts stay retained only.
      when c.relname = 'sega_capture' then case when l.sega_capture_id is null then null else 1::bigint end
      when c.relname like 'sega\_%' and c.has_capture_id and l.sega_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sega_capture_id::text), false, true, '')))[1]::text::bigint

      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.
      when c.relname = 'dcp_crawl' then case when l.dcp_crawl_id is null then null else 1::bigint end
      when c.relname = 'dcp_asset' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_asset_crawl ac where ac.crawl_id = l.dcp_crawl_id)
      when c.relname like 'dcp\_%' and c.has_crawl_id and l.dcp_crawl_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where crawl_id = %L::uuid',
          c.relname, l.dcp_crawl_id::text), false, true, '')))[1]::text::bigint
      when c.relname = 'dcp_crawl_gap' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_crawl_gap g
          join plm.dcp_crawl_section s on s.id = g.crawl_section_id
          where s.crawl_id = l.dcp_crawl_id)

      -- DCP metadata has its own complete-run clock, separate from path crawls.
      when c.relname = 'dcp_metadata_run' then
        case when l.dcp_metadata_run_id is null then null else 1::bigint end
      when c.relname like 'dcp\_%' and c.has_metadata_run_id
           and l.dcp_metadata_run_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where metadata_run_id = %L::uuid',
          c.relname, l.dcp_metadata_run_id::text), false, true, '')))[1]::text::bigint
      else null
    end as latest_count
  from classified c cross join latest l
)
select
  source_system,
  relname as table_name,
  retained_count as row_count,
  carries_resolution,
  table_comment,
  retained_count as retained_row_count,
  latest_count as latest_complete_row_count,
  case
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; there is no retained-capture clock for this table.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
         and pmt_capture_id is null then
      'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then
      'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
         and nbcu_capture_id is null then
      'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then
      'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then
      'No complete Sega capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then
      'Latest complete Sega capture; loading, rejected and abandoned captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
          or (relname like 'dcp\_%' and has_crawl_id)) and dcp_crawl_id is null then
      'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then
      'Latest complete DCP path crawl, using immutable crawl membership where required.'
    when (relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id))
         and dcp_metadata_run_id is null then
      'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      'Latest complete DCP metadata run, separate from the path-crawl clock.'
    when relname = 'dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else
      'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end as count_note
from counted;

comment on view api.source_capture_inventory is
  'Source landing inventory with two distinct facts. row_count remains a compatibility alias '
  'for retained_row_count, which counts every retained row including failed attempts. '
  'latest_complete_row_count reports current complete-capture coverage only where exact '
  'membership can be derived; NULL means unavailable or not applicable, never zero. '
  'count_basis, latest_complete_status and count_note state the rule. carries_resolution '
  'still describes table shape and never proves that a scrape ran. Counts and status only: '
  'no licensed source row value is exposed here.';

revoke all on api.source_capture_inventory from public;
revoke all on api.source_capture_inventory from anon;
grant select on api.source_capture_inventory to authenticated, service_role;
