-- =====================================================================================
-- Peanuts (Tenovos) -- source landing schema (release 1).
--
-- Migration: 20260819125713_peanuts_tenovos_source_landing.sql
-- Issue:     u2giants/shared-db #1217 (schema contract)
-- Claim:     u2giants/shared-db #1231, reserved version 20260819125713
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO PEANUTS VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The Peanuts extract is licensed source data
-- held in the PRIVATE repo u2giants/licensor-source-data under `peanuts/`. No Peanuts art
-- program, style guide, character, initiative, holiday, animation title, asset type,
-- file name, title, keyword, era or raw payload value may ever appear in this file, in a
-- contract test, in CI output, or in a pull request or issue on this repository.
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime from the private loader through the INSERT grants below. The
-- contract tests use INVENTED fixture values only.
--
-- WHAT THIS IS
--   A lossless, append-only, capture-scoped landing of one Peanuts Asset Library
--   (Tenovos DAM v3.5.0, AWS AppSync GraphQL) capture. Every source table is keyed by
--   `capture_id`, so a refresh ADDS a snapshot and never overwrites or deletes an earlier
--   one. Retry safety is `on conflict do nothing`, which needs no UPDATE privilege.
--
-- WHAT THIS DELIBERATELY IS NOT
--   It creates, renames, updates, merges and deletes NOTHING in core.* or dam.*. It
--   resolves NOTHING: this release ships no reconciliation columns at all, so there is no
--   half-built resolution surface to misread. Nothing here is canonical.
--
-- FOUR PORTAL FACTS THIS SHAPE EXISTS TO SURVIVE
--
--   1. THERE IS NO HIERARCHY ABOVE THE ASSET. Tenovos stores one flat metadata document
--      per asset plus a set of controlled vocabularies. There is no style-guide entity,
--      no character roster, no property tree and no folder path. Every axis below is a
--      vocabulary value stamped on the asset, so the vocabulary tables are peers of the
--      asset table, not parents of it.
--
--   2. THE INTERNAL FIELD NAME AND THE PORTAL LABEL DISAGREE ON THE TWO MOST IMPORTANT
--      FIELDS. The field internally named `property` is labelled "Art Program" in the UI,
--      and the field internally named `program` is labelled "Initiative". Neither is a
--      property in our master-data sense. EVERY TABLE AND COLUMN HERE IS NAMED AFTER THE
--      LABEL, and both names are stored on every vocabulary row (source_field_name +
--      source_field_label) and again in plm.peanuts_metadata_field. This is not
--      bookkeeping: a search filter built from the internal name is SILENTLY IGNORED by
--      the API and returns the unfiltered total, so a mis-named filter yields a capture
--      that looks complete and is not.
--
--   3. VOCABULARY VALUES EXIST THAT NO ASSET USES, AND THEY ARE LICENSED CONTENT WE ARE
--      ENTITLED TO. Deriving the master lists from `distinct(value)` over assets -- the
--      obvious loader shortcut -- discards hundreds of style guides and a double-digit
--      number of characters. The vocabularies are pulled from their own API
--      (getControlledVocabularyByIds) and land in their own tables. `asset_count` is
--      therefore `>= 0`, NOT `> 0`: a zero-usage value is exactly the content the naive
--      loader loses, and it must be storable. plm.peanuts_capture carries
--      `vocabularies_loaded_from_source` as the guard against that shortcut.
--
--   4. THE SEARCH API HAS A HARD 10,000-ROW DEEP-PAGING WALL. `from + size > 10000`
--      returns zero hits with HTTP 200 -- silent truncation. The capture converges a
--      little short of the portal's own reported total, and that shortfall is REAL.
--      `assets_unreachable` is the arithmetic proof it was accounted for rather than
--      hidden: a 'complete' capture must satisfy
--      assets_captured + assets_unreachable = portal_reported_asset_total, so a capture
--      claiming zero unreachable assets while sitting below the portal total cannot
--      publish.
--
-- DECLARED FACT vs RECONSTRUCTED, AND THE ONE LINK THAT IS REFUSED OUTRIGHT
--   Declared by the portal and stored as fact: every vocabulary value; every value
--   stamped on an asset; and plm.peanuts_asset_relationship, the asset parent/child graph
--   returned by getRelationshipByObjectId with an explicit link type, which is preserved
--   verbatim in `link_type` rather than assumed.
--   Reconstructed by us and pinned to relationship_truth = 'derived' by a CHECK that
--   permits no other value: plm.peanuts_style_guide_character and
--   plm.peanuts_style_guide_art_program. The style-guide field is SINGLE-select, which is
--   what makes those derivations unambiguous; guide-to-art-program is many-to-many
--   because guides already appear under more than one art program in the source.
--   REFUSED: there is NO art-program-to-character table in this schema, derived or
--   otherwise, and none may be added. The art-program field is multi-select, so an asset
--   carrying two art programs and four characters states nothing about which character
--   belongs to which program. Pairing two independent arrays on one asset is exactly the
--   Disney DCP Vault fabrication this project has already paid for once.
--
-- IMMUTABILITY IS DELIVERED BY PRIVILEGE SEPARATION, NOT BY TRIGGERS
--   Same mechanism, and the same reason, as the NBCU, WildBrain and Sega landings. This
--   database has been burned by a BEFORE trigger that read a GENERATED ... STORED column,
--   which Postgres populates AFTER before-triggers fire: the guard never fired and
--   nothing ever raised. Privilege separation fails closed and is INSPECTABLE in
--   information_schema.role_table_grants, so a contract test can assert the guarantee
--   itself rather than assert that some guard code exists.
--
--   THE TRAP THAT MADE 20260810080000 NECESSARY IS HANDLED IN THIS FILE. The schema `plm`
--   carries `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role`, so every
--   table below is BORN holding UPDATE, DELETE and TRUNCATE for service_role and a bare
--   `grant select, insert` is a no-op. The explicit REVOKE block near the end is what
--   actually makes these rows immutable, and the assertion block after it fails the
--   migration if the revokes did not take.
--
--   Every privilege statement below is written out IN FULL, one per table, statically and
--   schema-qualified. No `DO` loop, no `execute format(...)`. Dynamic privilege SQL hides
--   the privilege model from the cross-PR object guard and from every human reader, and
--   was rejected on the Sega landing (#1196) for exactly that reason.
--
-- THE WRITE PATH TO THE CAPTURE ROOT
--   service_role holds SELECT ONLY on plm.peanuts_capture. Capture rows are created and
--   transitioned exclusively by plm.begin_peanuts_capture and plm.finalize_peanuts_capture
--   below, both `security definer` with a pinned search_path and EXECUTE granted only to
--   service_role. Never grant INSERT on plm.peanuts_capture to service_role: that would
--   let a loader mint a capture that skipped every validation those functions perform.
--   The completion rule is enforced BOTH in finalize_ and as a table CHECK
--   (peanuts_capture_complete_requirements_chk), so it still holds against a writer that
--   reaches the table some other way and does not depend on the functions being correct.
--
-- Depends on (exact 14-digit versions):
--   20260621150714  foundation  -- schema plm
--   20260621150815  app_core    -- app.has_role / has_any_role / has_app_access
-- =====================================================================================


-- =====================================================================================
-- 1. plm.peanuts_capture -- one row per attempted load. The root of every snapshot.
--
-- capture_key is the loader's idempotency key.
--
-- source_commit_sha vs read_commit_sha are TWO DIFFERENT FACTS and must not be collapsed.
-- source_commit_sha identifies the DATA -- the private-repo commit the extract was merged
-- at. read_commit_sha is the commit the loader actually had checked out when it read the
-- bytes, which can be a LATER commit that changed only documentation.
-- =====================================================================================
create table plm.peanuts_capture (
  id                             uuid        primary key default gen_random_uuid(),
  capture_key                    text        not null unique,
  source_repository              text        not null,
  source_commit_sha              text        not null,
  read_commit_sha                text            null,
  source_manifest_sha256         text        not null,
  portal_base_url                text        not null,
  api_endpoint                   text        not null,
  source_customer_id             text        not null,
  source_captured_at             timestamptz not null,
  load_started_at                timestamptz not null default now(),
  load_completed_at              timestamptz     null,
  status                         text        not null default 'loading',
  expected_counts                jsonb       not null,
  observed_counts                jsonb       not null default '{}'::jsonb,
  media_downloaded               integer     not null default 0,
  portal_reported_asset_total    integer     not null,
  assets_captured                integer     not null,
  assets_unreachable             integer     not null,
  deep_paging_partitioned        boolean     not null default false,
  vocabularies_loaded_from_source boolean    not null default false,
  relationship_graph_walked      boolean     not null default false,
  error_summary                  jsonb       not null default '[]'::jsonb,
  raw_summary                    jsonb       not null,
  created_by                     text        not null,

  constraint peanuts_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint peanuts_capture_key_nonblank_chk         check (btrim(capture_key) <> ''),
  constraint peanuts_capture_repository_nonblank_chk  check (btrim(source_repository) <> ''),
  constraint peanuts_capture_portal_nonblank_chk      check (btrim(portal_base_url) <> ''),
  constraint peanuts_capture_api_endpoint_nonblank_chk check (btrim(api_endpoint) <> ''),
  constraint peanuts_capture_customer_id_nonblank_chk check (btrim(source_customer_id) <> ''),
  constraint peanuts_capture_created_by_nonblank_chk  check (btrim(created_by) <> ''),
  constraint peanuts_capture_commit_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint peanuts_capture_read_commit_sha_chk
    check (read_commit_sha is null or read_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint peanuts_capture_manifest_sha256_chk
    check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  -- Scope guard, not a style preference: this project may never download Peanuts media.
  -- This is the constraint that makes the media clause of
  -- peanuts_capture_complete_requirements_chk below, and the media_downloaded_nonzero
  -- branch of plm.finalize_peanuts_capture, UNREACHABLE in normal operation. Both are
  -- kept deliberately as defence in depth for a future in which this line is dropped;
  -- see the note on that branch in the function.
  constraint peanuts_capture_media_zero_chk check (media_downloaded = 0),
  constraint peanuts_capture_portal_total_nonneg_chk
    check (portal_reported_asset_total >= 0),
  constraint peanuts_capture_assets_captured_nonneg_chk check (assets_captured >= 0),
  constraint peanuts_capture_assets_unreachable_nonneg_chk check (assets_unreachable >= 0),
  constraint peanuts_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  -- The completion rule from the schema contract, enforced by the TABLE and not only by a
  -- function, so a writer that reaches this table another way still cannot mint a
  -- 'complete' capture that was un-partitioned, vocabulary-shortcut, media-bearing,
  -- error-carrying, or arithmetically short of the portal's own total.
  constraint peanuts_capture_complete_requirements_chk
    check (
      status <> 'complete'
      or (
        load_completed_at is not null
        and deep_paging_partitioned = true
        and vocabularies_loaded_from_source = true
        and media_downloaded = 0
        and jsonb_array_length(error_summary) = 0
        -- CAST BEFORE ADDING. These three columns are `integer`; a bare
        -- `assets_captured + assets_unreachable` raises a raw `integer out of range`
        -- instead of a check_violation when an owner writes a row above 2^31-1, so the
        -- caller sees a PostgreSQL arithmetic error rather than this named constraint.
        -- Unreachable through any granted role, and plm.finalize_peanuts_capture already
        -- casts on its own copy of this arithmetic -- the CHECK must match the function
        -- rather than differ from it in the one place nobody looks.
        and assets_captured::bigint + assets_unreachable::bigint
            = portal_reported_asset_total::bigint
      )
    ),
  constraint peanuts_capture_expected_counts_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint peanuts_capture_observed_counts_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint peanuts_capture_error_summary_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint peanuts_capture_raw_summary_obj_chk
    check (jsonb_typeof(raw_summary) = 'object')
);

comment on table plm.peanuts_capture is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per attempted '
  'Peanuts (Tenovos) load. Append-only snapshot root: a refresh adds a new capture and '
  'NEVER edits or deletes an earlier one. service_role holds SELECT only -- writes are '
  'reserved for plm.begin_peanuts_capture and plm.finalize_peanuts_capture.';
comment on column plm.peanuts_capture.source_commit_sha is
  'The private-repo commit that identifies the DATA. capture_key is built from this.';
comment on column plm.peanuts_capture.read_commit_sha is
  'The private-repo commit the loader actually had checked out. May be LATER than '
  'source_commit_sha when only documentation changed. A separate fact; do not collapse.';
comment on column plm.peanuts_capture.status is
  'loading -> complete | rejected. A rejected capture stays visible as immutable evidence '
  'and the previous complete capture remains current. ''abandoned'' is permitted by the '
  'CHECK but nothing in this release sets it -- flagged, not invented.';
comment on column plm.peanuts_capture.media_downloaded is
  'Hard zero. Constrained, not merely defaulted: storing Peanuts media bytes is out of scope.';
comment on column plm.peanuts_capture.portal_reported_asset_total is
  'The asset total the portal states for itself. The capture is expected to converge '
  'SHORT of this because of the 10,000-row deep-paging wall; the shortfall belongs in '
  'assets_unreachable, never rounded away.';
comment on column plm.peanuts_capture.assets_unreachable is
  'Not a fudge column: the arithmetic proof that the deep-paging wall was accounted for. '
  'assets_captured + assets_unreachable must equal portal_reported_asset_total before a '
  'capture may be ''complete'', so zero-unreachable-but-short cannot publish.';
comment on column plm.peanuts_capture.deep_paging_partitioned is
  'The crawl worked around the 10,000-row wall by sorting in both directions and then '
  'partitioning by vocabulary term. False means the crawl was silently truncatable.';
comment on column plm.peanuts_capture.vocabularies_loaded_from_source is
  'Set only once the loader has proven the vocabulary tables came from the vocabulary API '
  'and NOT from distinct() over assets. This is the guard against silently discarding the '
  'hundreds of vocabulary values that no asset uses.';
comment on column plm.peanuts_capture.relationship_graph_walked is
  'The asset parent/child graph is populated by a per-asset call and is the slowest part '
  'of the capture. False makes a partial walk visible rather than silently short.';


-- =====================================================================================
-- 2-9. THE EIGHT CONTROLLED-VOCABULARY TABLES.
--
-- One table per axis. All eight share one shape and one identity rule.
--
-- IDENTITY IS `value_key`, A NORMALISED LABEL WE GENERATE. The vocabulary API does return
-- a `valueId` per value, and it is kept in `source_value_id` as evidence -- but it is a
-- vocabulary-ROW identifier, not a stable licensor number, nothing else in the portal
-- references it, and NOTHING MAY JOIN ON IT. It is deliberately nullable and carries no
-- unique constraint so that no future reader can mistake it for a key.
--
-- `asset_count` is `>= 0` and zero is legal and MEANINGFUL -- see fact 3 in the header.
-- =====================================================================================

-- 2. Art programme. Internal field name and UI label disagree here (see header fact 2):
--    this axis is stored under its LABEL. Multi-select on the asset.
create table plm.peanuts_art_program (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_art_program_pkey primary key (capture_id, value_key),
  constraint peanuts_art_program_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_art_program_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_art_program_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_art_program_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_art_program_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_art_program_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_art_program_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_art_program_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_art_program_usage_idx
  on plm.peanuts_art_program (capture_id, asset_count);

comment on table plm.peanuts_art_program is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Art Program '
  'controlled vocabulary, in full, straight from the vocabulary API. Named after the '
  'PORTAL LABEL: the underlying metadata field has a different internal name, and the '
  'mismatch is recorded on every row. This axis is an art-style/era bucket and is NOT a '
  'property in the core.property sense. Resolves nothing.';
comment on column plm.peanuts_art_program.source_value_id is
  'Vocabulary-row id, evidence only. NOT identity. Nothing may join on it.';
comment on column plm.peanuts_art_program.asset_count is
  'Usage, not existence: >= 0, and zero is a legitimate, meaningful row.';

-- 3. Style guide. SINGLE-select on the asset -- this is the fact that licenses the two
--    derived tables at the end of this file, so it is pinned by a CHECK rather than
--    merely stored. Has NO usable source identifier of its own.
create table plm.peanuts_style_guide (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_style_guide_pkey primary key (capture_id, value_key),
  constraint peanuts_style_guide_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_style_guide_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_style_guide_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_style_guide_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_style_guide_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_style_guide_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_style_guide_asset_count_nonneg_chk   check (asset_count >= 0),
  -- Load-bearing, not decorative. Both derived tables below are only unambiguous because
  -- an asset carries at most ONE style guide. If the portal ever turns this field
  -- multi-select, the load must fail here and loudly rather than quietly poison the
  -- derivations with pairings nobody asserted.
  constraint peanuts_style_guide_single_select_chk       check (is_multi_select = false),
  constraint peanuts_style_guide_raw_obj_chk             check (jsonb_typeof(raw) = 'object')
);
create index peanuts_style_guide_usage_idx
  on plm.peanuts_style_guide (capture_id, asset_count);

comment on table plm.peanuts_style_guide is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Style Guide '
  'controlled vocabulary, in full. Identity is the normalised label we generate, because '
  'the portal issues no stable style-guide number. MOST of these values are used by NO '
  'asset, which is precisely why the list is loaded from the vocabulary API instead of '
  'from distinct() over assets. Not merged with the style-guide DOCUMENT assets: those '
  'are rows in plm.peanuts_asset and are connected only through '
  'plm.peanuts_asset.style_guide_key and the declared parent/child graph.';
comment on column plm.peanuts_style_guide.is_multi_select is
  'Pinned false by CHECK. The single-select property of this field is what makes '
  'plm.peanuts_style_guide_character and plm.peanuts_style_guide_art_program derivable '
  'without inventing pairings.';

-- 4. Character. Multi-select on the asset.
create table plm.peanuts_character (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_character_pkey primary key (capture_id, value_key),
  constraint peanuts_character_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_character_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_character_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_character_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_character_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_character_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_character_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_character_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_character_usage_idx
  on plm.peanuts_character (capture_id, asset_count);

comment on table plm.peanuts_character is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Character controlled '
  'vocabulary, in full, including values no asset uses. Resolves nothing to core.character.';

-- 5. Animation title. Multi-select on the asset.
create table plm.peanuts_animation_title (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_animation_title_pkey primary key (capture_id, value_key),
  constraint peanuts_animation_title_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_animation_title_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_animation_title_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_animation_title_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_animation_title_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_animation_title_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_animation_title_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_animation_title_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_animation_title_usage_idx
  on plm.peanuts_animation_title (capture_id, asset_count);

comment on table plm.peanuts_animation_title is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Animation Title '
  'controlled vocabulary, in full. Resolves nothing.';

-- 6. Holiday. Multi-select on the asset.
create table plm.peanuts_holiday (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_holiday_pkey primary key (capture_id, value_key),
  constraint peanuts_holiday_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_holiday_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_holiday_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_holiday_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_holiday_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_holiday_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_holiday_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_holiday_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_holiday_usage_idx
  on plm.peanuts_holiday (capture_id, asset_count);

comment on table plm.peanuts_holiday is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Holiday controlled '
  'vocabulary, in full. Resolves nothing.';

-- 7. Initiative. Internal field name and UI label disagree here too (see header fact 2):
--    stored under its LABEL. Single-select on the asset.
create table plm.peanuts_initiative (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_initiative_pkey primary key (capture_id, value_key),
  constraint peanuts_initiative_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_initiative_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_initiative_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_initiative_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_initiative_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_initiative_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_initiative_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_initiative_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_initiative_usage_idx
  on plm.peanuts_initiative (capture_id, asset_count);

comment on table plm.peanuts_initiative is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Initiative controlled '
  'vocabulary, in full. Named after the PORTAL LABEL; the underlying metadata field '
  'carries a different internal name, recorded on every row. Resolves nothing.';

-- 8. Asset type. Single-select on the asset. Comic-strip type is a SUB-axis of this one
--    and lands as a column on plm.peanuts_asset, not as its own vocabulary table.
create table plm.peanuts_asset_type (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_asset_type_pkey primary key (capture_id, value_key),
  constraint peanuts_asset_type_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_asset_type_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_asset_type_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_asset_type_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_asset_type_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_asset_type_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_asset_type_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_asset_type_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_type_usage_idx
  on plm.peanuts_asset_type (capture_id, asset_count);

comment on table plm.peanuts_asset_type is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Asset Type controlled '
  'vocabulary, in full. Comic-strip type is a sub-axis of this vocabulary and is stored as '
  'plm.peanuts_asset.comic_strip_type rather than as a table of its own.';

-- 9. Licensing status. Single-select on the asset.
create table plm.peanuts_licensing_status (
  capture_id         uuid    not null,
  value_key          text    not null,
  value_label        text    not null,
  source_value_id    text        null,
  source_field_name  text    not null,
  source_field_label text    not null,
  is_multi_select    boolean not null,
  asset_count        integer not null,
  raw                jsonb   not null,

  constraint peanuts_licensing_status_pkey primary key (capture_id, value_key),
  constraint peanuts_licensing_status_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_licensing_status_value_key_nonblank_chk   check (btrim(value_key) <> ''),
  constraint peanuts_licensing_status_value_label_nonblank_chk check (btrim(value_label) <> ''),
  constraint peanuts_licensing_status_source_value_id_nonblank_chk
    check (source_value_id is null or btrim(source_value_id) <> ''),
  constraint peanuts_licensing_status_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_licensing_status_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_licensing_status_asset_count_nonneg_chk   check (asset_count >= 0),
  constraint peanuts_licensing_status_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);
create index peanuts_licensing_status_usage_idx
  on plm.peanuts_licensing_status (capture_id, asset_count);

comment on table plm.peanuts_licensing_status is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Licensing Status '
  'controlled vocabulary, in full. This is the PORTAL''s status wording and is NOT a POP '
  'Creations licensing decision. Resolves nothing.';


-- =====================================================================================
-- 10. plm.peanuts_metadata_field -- the field dictionary.
--
-- This table exists because the internal-name / UI-label mismatch (header fact 2) is the
-- single most dangerous property of this portal and must be STORED rather than
-- remembered. The unique constraint on (capture_id, source_field_label) is what makes the
-- dictionary usable in the label direction, which is the direction every table in this
-- schema is named in.
-- =====================================================================================
create table plm.peanuts_metadata_field (
  capture_id           uuid    not null,
  source_field_name    text    not null,
  source_field_label   text    not null,
  source_definition_id text    not null,
  source_vocabulary_id text        null,
  is_multi_select      boolean not null,
  is_facetable         boolean not null,
  field_type           text    not null,
  raw                  jsonb   not null,

  constraint peanuts_metadata_field_pkey primary key (capture_id, source_field_name),
  constraint peanuts_metadata_field_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  constraint peanuts_metadata_field_label_uk unique (capture_id, source_field_label),
  constraint peanuts_metadata_field_name_nonblank_chk  check (btrim(source_field_name) <> ''),
  constraint peanuts_metadata_field_label_nonblank_chk check (btrim(source_field_label) <> ''),
  constraint peanuts_metadata_field_definition_id_nonblank_chk
    check (btrim(source_definition_id) <> ''),
  constraint peanuts_metadata_field_vocabulary_id_nonblank_chk
    check (source_vocabulary_id is null or btrim(source_vocabulary_id) <> ''),
  constraint peanuts_metadata_field_type_nonblank_chk  check (btrim(field_type) <> ''),
  constraint peanuts_metadata_field_raw_obj_chk        check (jsonb_typeof(raw) = 'object')
);

comment on table plm.peanuts_metadata_field is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The portal''s metadata '
  'field dictionary for one capture: internal field name, the label the UI shows, and the '
  'vocabulary behind it. Stored because the two disagree on the most important fields and '
  'because an API search filter built from the wrong one is SILENTLY IGNORED, returning '
  'the unfiltered total and a capture that looks complete and is not.';


-- =====================================================================================
-- 11. plm.peanuts_asset -- one row per portal asset.
--
-- ASSET IDENTITY IS THE LICENSOR''S. Every asset carries a source-issued UUID, so unlike
-- the vocabulary tables above this table is NOT keyed on anything we generated.
-- FILENAME IS NOT UNIQUE IN THIS PORTAL and must never be treated as a key; the index on
-- lower(file_name) is a lookup aid and is deliberately NOT a unique index.
--
-- style_guide_key IS NULLABLE BY DESIGN AND MOST ROWS ARE NULL. The large majority of
-- assets here are comic strips, which are a first-class asset type rather than
-- style-guide art. Any later promotion that assumes an asset belongs to a guide will drop
-- most of this licensor.
--
-- publication_date_text IS TEXT, NOT DATE: the portal puts free text in that field.
--
-- The metadata document contains nested repeating groups (creator information, the
-- asset-type/comic-type cascade, the character-angle cascade, archive information, notes).
-- They are NOT flattened into columns here; they are preserved whole in `raw`.
-- =====================================================================================
create table plm.peanuts_asset (
  capture_id            uuid    not null,
  source_object_id      text    not null,
  source_file_id        text        null,
  file_name             text    not null,
  file_ext              text        null,
  file_size_bytes       bigint      null,
  content_type          text        null,
  checksum              text        null,
  object_type           text        null,
  version_number        integer     null,
  is_current_version    boolean     null,
  style_guide_key       text        null,
  asset_type_key        text        null,
  comic_strip_type      text        null,
  initiative_key        text        null,
  era_label             text        null,
  licensing_status_key  text        null,
  title                 text        null,
  description           text        null,
  publication_date_text text        null,
  source_created_at     timestamptz null,
  source_updated_at     timestamptz null,
  metadata_template_id  text        null,
  rendition_base_url    text        null,
  raw                   jsonb   not null,

  constraint peanuts_asset_pkey primary key (capture_id, source_object_id),
  constraint peanuts_asset_capture_fkey
    foreign key (capture_id) references plm.peanuts_capture(id) on delete restrict,
  -- The four single-select vocabulary axes. MATCH SIMPLE (the default) is intended: a row
  -- whose key is NULL is exempt, which is exactly the 'no style guide' case.
  constraint peanuts_asset_style_guide_fkey
    foreign key (capture_id, style_guide_key)
    references plm.peanuts_style_guide (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_asset_type_fkey
    foreign key (capture_id, asset_type_key)
    references plm.peanuts_asset_type (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_initiative_fkey
    foreign key (capture_id, initiative_key)
    references plm.peanuts_initiative (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_licensing_status_fkey
    foreign key (capture_id, licensing_status_key)
    references plm.peanuts_licensing_status (capture_id, value_key) on delete restrict,

  constraint peanuts_asset_object_id_nonblank_chk check (btrim(source_object_id) <> ''),
  constraint peanuts_asset_file_id_nonblank_chk
    check (source_file_id is null or btrim(source_file_id) <> ''),
  constraint peanuts_asset_file_name_nonblank_chk check (btrim(file_name) <> ''),
  -- Lowercased and dot-free, so 'JPG', '.jpg' and 'jpg' can never coexist as three
  -- different extensions for the same thing.
  constraint peanuts_asset_file_ext_shape_chk
    check (file_ext is null
           or (btrim(file_ext) <> '' and file_ext = lower(file_ext) and file_ext !~ '\.')),
  constraint peanuts_asset_file_size_nonneg_chk
    check (file_size_bytes is null or file_size_bytes >= 0),
  constraint peanuts_asset_content_type_nonblank_chk
    check (content_type is null or btrim(content_type) <> ''),
  constraint peanuts_asset_checksum_nonblank_chk
    check (checksum is null or btrim(checksum) <> ''),
  constraint peanuts_asset_object_type_nonblank_chk
    check (object_type is null or btrim(object_type) <> ''),
  constraint peanuts_asset_version_number_nonneg_chk
    check (version_number is null or version_number >= 0),
  constraint peanuts_asset_style_guide_key_nonblank_chk
    check (style_guide_key is null or btrim(style_guide_key) <> ''),
  constraint peanuts_asset_asset_type_key_nonblank_chk
    check (asset_type_key is null or btrim(asset_type_key) <> ''),
  constraint peanuts_asset_comic_strip_type_nonblank_chk
    check (comic_strip_type is null or btrim(comic_strip_type) <> ''),
  constraint peanuts_asset_initiative_key_nonblank_chk
    check (initiative_key is null or btrim(initiative_key) <> ''),
  constraint peanuts_asset_era_label_nonblank_chk
    check (era_label is null or btrim(era_label) <> ''),
  constraint peanuts_asset_licensing_status_key_nonblank_chk
    check (licensing_status_key is null or btrim(licensing_status_key) <> ''),
  constraint peanuts_asset_title_nonblank_chk
    check (title is null or btrim(title) <> ''),
  constraint peanuts_asset_description_nonblank_chk
    check (description is null or btrim(description) <> ''),
  constraint peanuts_asset_publication_date_nonblank_chk
    check (publication_date_text is null or btrim(publication_date_text) <> ''),
  constraint peanuts_asset_template_id_nonblank_chk
    check (metadata_template_id is null or btrim(metadata_template_id) <> ''),
  constraint peanuts_asset_rendition_url_nonblank_chk
    check (rendition_base_url is null or btrim(rendition_base_url) <> ''),
  constraint peanuts_asset_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_style_guide_idx on plm.peanuts_asset (capture_id, style_guide_key);
create index peanuts_asset_asset_type_idx  on plm.peanuts_asset (capture_id, asset_type_key);
-- NOT unique: filenames repeat in this portal.
create index peanuts_asset_file_name_idx   on plm.peanuts_asset (capture_id, lower(file_name));

comment on table plm.peanuts_asset is
  'LICENSED PEANUTS SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per portal asset '
  'in one capture. Identity is the licensor''s own object UUID; FILE NAME IS NOT UNIQUE '
  'here and is never identity. The whole metadata document, including every nested '
  'repeating group, is preserved in `raw`. Resolves nothing to dam.* or core.*.';
comment on column plm.peanuts_asset.style_guide_key is
  'NULLABLE BY DESIGN and NULL on most rows -- most assets are comic strips, not '
  'style-guide art. Anything that assumes an asset belongs to a guide will drop the '
  'majority of this licensor.';
comment on column plm.peanuts_asset.comic_strip_type is
  'Sub-axis of asset type, stored as a column rather than as its own vocabulary table.';
comment on column plm.peanuts_asset.publication_date_text is
  'TEXT, NOT DATE, deliberately: the portal puts free text in this field. Parsing belongs '
  'in a later, separate ruling, never in the landing.';
comment on column plm.peanuts_asset.raw is
  'The complete metadata document. The nested repeating groups (creator information, the '
  'asset-type/comic-type cascade, the character-angle cascade, archive information, notes) '
  'live here whole and are NOT lossily flattened into columns.';


-- =====================================================================================
-- 12-15. THE MULTI-VALUE LINK TABLES -- portal-declared, one per multi-select axis.
--
-- Each row is a value the portal itself stamped on the asset. Nothing here is inferred.
-- The reverse indexes exist because the primary key leads with the asset, while the
-- question every consumer asks first is "which assets carry this value".
-- =====================================================================================

-- 12. Asset -> art programme.
create table plm.peanuts_asset_art_program (
  capture_id       uuid  not null,
  source_object_id text  not null,
  art_program_key  text  not null,
  raw              jsonb not null,

  constraint peanuts_asset_art_program_pkey
    primary key (capture_id, source_object_id, art_program_key),
  constraint peanuts_asset_art_program_asset_fkey
    foreign key (capture_id, source_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_art_program_value_fkey
    foreign key (capture_id, art_program_key)
    references plm.peanuts_art_program (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_art_program_key_nonblank_chk check (btrim(art_program_key) <> ''),
  constraint peanuts_asset_art_program_raw_obj_chk      check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_art_program_value_idx
  on plm.peanuts_asset_art_program (capture_id, art_program_key);

comment on table plm.peanuts_asset_art_program is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED: the art-program values the portal '
  'itself stamped on the asset. Multi-select, so an asset may carry several. Nothing may '
  'pair these rows with plm.peanuts_asset_character to manufacture an '
  'art-program-to-character link -- that pairing is refused by this schema.';

-- 13. Asset -> character.
create table plm.peanuts_asset_character (
  capture_id       uuid  not null,
  source_object_id text  not null,
  character_key    text  not null,
  raw              jsonb not null,

  constraint peanuts_asset_character_pkey
    primary key (capture_id, source_object_id, character_key),
  constraint peanuts_asset_character_asset_fkey
    foreign key (capture_id, source_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_character_value_fkey
    foreign key (capture_id, character_key)
    references plm.peanuts_character (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_character_key_nonblank_chk check (btrim(character_key) <> ''),
  constraint peanuts_asset_character_raw_obj_chk      check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_character_value_idx
  on plm.peanuts_asset_character (capture_id, character_key);

comment on table plm.peanuts_asset_character is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED: the character values the portal '
  'itself stamped on the asset. Multi-select. Resolves nothing to core.character.';

-- 14. Asset -> animation title.
create table plm.peanuts_asset_animation_title (
  capture_id          uuid  not null,
  source_object_id    text  not null,
  animation_title_key text  not null,
  raw                 jsonb not null,

  constraint peanuts_asset_animation_title_pkey
    primary key (capture_id, source_object_id, animation_title_key),
  constraint peanuts_asset_animation_title_asset_fkey
    foreign key (capture_id, source_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_animation_title_value_fkey
    foreign key (capture_id, animation_title_key)
    references plm.peanuts_animation_title (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_animation_title_key_nonblank_chk
    check (btrim(animation_title_key) <> ''),
  constraint peanuts_asset_animation_title_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_animation_title_value_idx
  on plm.peanuts_asset_animation_title (capture_id, animation_title_key);

comment on table plm.peanuts_asset_animation_title is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED: the animation-title values the '
  'portal itself stamped on the asset. Multi-select.';

-- 15. Asset -> holiday.
create table plm.peanuts_asset_holiday (
  capture_id       uuid  not null,
  source_object_id text  not null,
  holiday_key      text  not null,
  raw              jsonb not null,

  constraint peanuts_asset_holiday_pkey
    primary key (capture_id, source_object_id, holiday_key),
  constraint peanuts_asset_holiday_asset_fkey
    foreign key (capture_id, source_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_holiday_value_fkey
    foreign key (capture_id, holiday_key)
    references plm.peanuts_holiday (capture_id, value_key) on delete restrict,
  constraint peanuts_asset_holiday_key_nonblank_chk check (btrim(holiday_key) <> ''),
  constraint peanuts_asset_holiday_raw_obj_chk      check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_holiday_value_idx
  on plm.peanuts_asset_holiday (capture_id, holiday_key);

comment on table plm.peanuts_asset_holiday is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED: the holiday values the portal itself '
  'stamped on the asset. Multi-select.';


-- =====================================================================================
-- 16. plm.peanuts_asset_keyword -- portal-declared, but deliberately WITHOUT a vocabulary
--     foreign key.
--
-- Keywords are multi-select and high-cardinality, and the keyword vocabulary is OPEN and
-- only partly validated -- the portal carries a separate free-text unvalidated-keywords
-- field, which stays in plm.peanuts_asset.raw. A foreign key here would either reject
-- legitimate source rows or force us to invent vocabulary entries the licensor never
-- published. `keyword_label` therefore carries the licensor''s own spelling, because no
-- vocabulary table exists to hold it.
-- =====================================================================================
create table plm.peanuts_asset_keyword (
  capture_id       uuid  not null,
  source_object_id text  not null,
  keyword_key      text  not null,
  keyword_label    text  not null,
  raw              jsonb not null,

  constraint peanuts_asset_keyword_pkey
    primary key (capture_id, source_object_id, keyword_key),
  constraint peanuts_asset_keyword_asset_fkey
    foreign key (capture_id, source_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_keyword_key_nonblank_chk   check (btrim(keyword_key) <> ''),
  constraint peanuts_asset_keyword_label_nonblank_chk check (btrim(keyword_label) <> ''),
  constraint peanuts_asset_keyword_raw_obj_chk        check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_keyword_value_idx
  on plm.peanuts_asset_keyword (capture_id, keyword_key);

comment on table plm.peanuts_asset_keyword is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED keywords, with NO vocabulary foreign '
  'key by design: the keyword vocabulary is open and only partly validated. The portal''s '
  'separate free-text unvalidated-keywords field is NOT split out here and stays in '
  'plm.peanuts_asset.raw.';


-- =====================================================================================
-- 17. plm.peanuts_asset_relationship -- THE ONE DECLARED HIERARCHY.
--
-- The portal returns this explicitly, per asset, with a stated parent, a stated child and
-- a stated link type. It is the only true hierarchy in this source and it is FACT, not
-- inference. `link_type` is stored VERBATIM and is never assumed: a future link type we
-- have not seen must land as itself rather than be coerced into the one we know.
--
-- This table is why plm.peanuts_capture.relationship_graph_walked exists -- it is
-- populated by a per-asset call, it is the slowest part of the capture, and a partial
-- walk must be visible rather than silently short.
-- =====================================================================================
create table plm.peanuts_asset_relationship (
  capture_id             uuid  not null,
  source_relationship_id text  not null,
  parent_object_id       text  not null,
  child_object_id        text  not null,
  link_type              text  not null,
  raw                    jsonb not null,

  constraint peanuts_asset_relationship_pkey
    primary key (capture_id, source_relationship_id),
  constraint peanuts_asset_relationship_parent_fkey
    foreign key (capture_id, parent_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_relationship_child_fkey
    foreign key (capture_id, child_object_id)
    references plm.peanuts_asset (capture_id, source_object_id) on delete restrict,
  constraint peanuts_asset_relationship_not_self_chk
    check (parent_object_id <> child_object_id),
  constraint peanuts_asset_relationship_id_nonblank_chk
    check (btrim(source_relationship_id) <> ''),
  constraint peanuts_asset_relationship_parent_nonblank_chk
    check (btrim(parent_object_id) <> ''),
  constraint peanuts_asset_relationship_child_nonblank_chk
    check (btrim(child_object_id) <> ''),
  constraint peanuts_asset_relationship_link_type_nonblank_chk
    check (btrim(link_type) <> ''),
  constraint peanuts_asset_relationship_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);
create index peanuts_asset_relationship_parent_idx
  on plm.peanuts_asset_relationship (capture_id, parent_object_id);
create index peanuts_asset_relationship_child_idx
  on plm.peanuts_asset_relationship (capture_id, child_object_id);

comment on table plm.peanuts_asset_relationship is
  'LICENSED PEANUTS SOURCE EVIDENCE. PORTAL-DECLARED asset parent/child edges -- the only '
  'true hierarchy this source publishes. In practice the parent is a style-guide document '
  'asset and the children are the art files cut from it, but that pattern is NOT encoded: '
  'link_type is stored verbatim so an unfamiliar edge lands as itself.';
comment on column plm.peanuts_asset_relationship.link_type is
  'Stored verbatim, never assumed and never normalised. Do not add a CHECK that pins it to '
  'the values seen so far; an unseen link type must land, not fail.';


-- =====================================================================================
-- 18. plm.peanuts_style_guide_character -- DERIVED, AND LABELLED AS SUCH.
--
-- The portal publishes no character roster per style guide. These rows are OURS.
--
-- The derivation is clean because the style-guide field is SINGLE-select (pinned by
-- peanuts_style_guide_single_select_chk above): an asset carries exactly one style guide
-- or none, so there is no ambiguity to split and no exclusion list is needed. It still
-- covers only the minority of assets that carry a guide at all.
--
-- relationship_truth is CONSTRAINED to 'derived', not defaulted to it, so no later
-- migration can quietly promote these rows to fact by inserting a different value.
-- =====================================================================================
create table plm.peanuts_style_guide_character (
  capture_id         uuid    not null,
  style_guide_key    text    not null,
  character_key      text    not null,
  asset_count        integer not null,
  relationship_truth text    not null,
  derivation_note    text    not null,

  constraint peanuts_style_guide_character_pkey
    primary key (capture_id, style_guide_key, character_key),
  constraint peanuts_style_guide_character_guide_fkey
    foreign key (capture_id, style_guide_key)
    references plm.peanuts_style_guide (capture_id, value_key) on delete restrict,
  constraint peanuts_style_guide_character_character_fkey
    foreign key (capture_id, character_key)
    references plm.peanuts_character (capture_id, value_key) on delete restrict,
  constraint peanuts_style_guide_character_asset_count_pos_chk check (asset_count > 0),
  constraint peanuts_style_guide_character_truth_chk
    check (relationship_truth = 'derived'),
  constraint peanuts_style_guide_character_note_nonblank_chk
    check (btrim(derivation_note) <> '')
);

comment on table plm.peanuts_style_guide_character is
  'DERIVED BY THIS PIPELINE, NOT STATED BY THE LICENSOR. Style guide to character, '
  'co-derived from assets that carry both. Unambiguous only because the style-guide field '
  'is single-select. Every row is pinned to relationship_truth = ''derived'' by a CHECK '
  'that permits no other value. Nothing may present these rows as source-declared fact '
  'and nothing may auto-promote them into core.character.';
comment on column plm.peanuts_style_guide_character.asset_count is
  'How many assets support this pair. Strictly positive: a derived edge with no supporting '
  'asset has nothing behind it and must not exist.';
comment on column plm.peanuts_style_guide_character.derivation_note is
  'Must state the derivation rule actually used, including that the style-guide field is '
  'single-select and that the derivation covers only assets carrying a guide.';


-- =====================================================================================
-- 19. plm.peanuts_style_guide_art_program -- DERIVED, AND MANY-TO-MANY BY REQUIREMENT.
--
-- Many-to-many is not a convenience: style guides in this source already appear under more
-- than one art programme, so a single art-program column on the guide would be wrong on
-- data we already hold. Same 'derived' pin as the table above.
-- =====================================================================================
create table plm.peanuts_style_guide_art_program (
  capture_id         uuid    not null,
  style_guide_key    text    not null,
  art_program_key    text    not null,
  asset_count        integer not null,
  relationship_truth text    not null,
  derivation_note    text    not null,

  constraint peanuts_style_guide_art_program_pkey
    primary key (capture_id, style_guide_key, art_program_key),
  constraint peanuts_style_guide_art_program_guide_fkey
    foreign key (capture_id, style_guide_key)
    references plm.peanuts_style_guide (capture_id, value_key) on delete restrict,
  constraint peanuts_style_guide_art_program_value_fkey
    foreign key (capture_id, art_program_key)
    references plm.peanuts_art_program (capture_id, value_key) on delete restrict,
  constraint peanuts_style_guide_art_program_count_pos_chk check (asset_count > 0),
  constraint peanuts_style_guide_art_program_truth_chk
    check (relationship_truth = 'derived'),
  constraint peanuts_style_guide_art_program_note_chk
    check (btrim(derivation_note) <> '')
);

comment on table plm.peanuts_style_guide_art_program is
  'DERIVED BY THIS PIPELINE, NOT STATED BY THE LICENSOR. Style guide to art programme, '
  'MANY-TO-MANY because guides already appear under more than one programme in the source. '
  'Pinned to relationship_truth = ''derived'' by a CHECK that permits no other value.';


-- =====================================================================================
-- FUNCTIONS -- the sole write path to plm.peanuts_capture.
--
-- Both are `security definer` with a pinned search_path, execute REVOKED from public and
-- granted ONLY to service_role, which can otherwise only READ the capture root.
--
-- THE COUNT-VALIDATION RULE, AND WHY IT IS WRITTEN THE LONG WAY IN FOUR SEPARATE
-- BRANCHES. Three live defects in the sibling landings were found by falsifying this
-- exact code, and all three are shapes that a shorter version accepts:
--
--   (1) #1219 -- A JSON `null` is NOT a missing key. `v_exp ? 'assets'` is TRUE for
--       {"assets": null}, so a presence test reports the count as supplied, while the
--       resulting SQL NULL makes every comparison UNKNOWN and therefore never false. The
--       count check is SKIPPED and a truncated capture publishes as complete.
--
--   (2) #1221 / #1222 -- `(v_exp ->> key)::bigint` casts the TEXT of the JSON number. A
--       perfectly legal integral JSON number written `1.0` renders as the text '1.0' and
--       raises `invalid input syntax for type bigint`; a value past bigint raises
--       out-of-range. Either wedges the capture in `loading` with an unnamed crash. This
--       file range-checks FIRST and then assigns through `::numeric::bigint`, which
--       accepts 1.0 and cannot overflow because the range was already proven.
--
--   (3) A NUMERIC-LOOKING JSON STRING. `{"assets": "12"}` is the dangerous one, because
--       it is a silent WRONG ANSWER rather than a crash: `->>` yields '12', which casts
--       cleanly to 12 and compares equal, so a manifest that lost its types publishes as
--       though it had been checked. It is refused here by an explicit
--       `jsonb_typeof(...) <> 'number'` test, and the test that proves it uses a string
--       whose numeric value MATCHES the true row count -- a fixture using "999" would
--       pass on the mismatch and prove nothing.
--
-- EACH TEST IS ITS OWN BRANCH. SQL does not promise to short-circuit `or`, so a single
-- combined predicate can evaluate a cast on a value the type test was supposed to have
-- rejected, and die with a raw cast error instead of the named code. The type test must
-- have FINISHED before anything casts.
--
-- AND IT IS ENFORCED TWICE. begin_ refuses a bad manifest at the start; finalize_
-- re-reads the STORED object and refuses it again, because an owner-level UPDATE can
-- reach plm.peanuts_capture.expected_counts without going through begin_ at all.
-- =====================================================================================

create or replace function plm.begin_peanuts_capture(
  p_capture_key                     text,
  p_source_repository               text,
  p_source_commit_sha               text,
  p_source_manifest_sha256          text,
  p_portal_base_url                 text,
  p_api_endpoint                    text,
  p_source_customer_id              text,
  p_source_captured_at              timestamptz,
  p_expected_counts                 jsonb,
  p_raw_summary                     jsonb,
  p_created_by                      text,
  p_portal_reported_asset_total     integer,
  p_assets_captured                 integer,
  p_assets_unreachable              integer,
  p_deep_paging_partitioned         boolean,
  p_vocabularies_loaded_from_source boolean,
  p_relationship_graph_walked       boolean,
  p_read_commit_sha                 text default null
) returns uuid
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_existing plm.peanuts_capture%rowtype;
  v_id       uuid;
begin
  -- Validate before touching anything. A malformed argument must fail here, loudly,
  -- rather than land a half-described capture the publication gate then has to reason
  -- about.
  if p_capture_key is null or btrim(p_capture_key) = '' then
    raise exception 'begin_peanuts_capture: capture_key is required';
  end if;
  if p_source_repository is null or btrim(p_source_repository) = '' then
    raise exception 'begin_peanuts_capture: source_repository is required';
  end if;
  if p_portal_base_url is null or btrim(p_portal_base_url) = '' then
    raise exception 'begin_peanuts_capture: portal_base_url is required';
  end if;
  if p_api_endpoint is null or btrim(p_api_endpoint) = '' then
    raise exception 'begin_peanuts_capture: api_endpoint is required';
  end if;
  if p_source_customer_id is null or btrim(p_source_customer_id) = '' then
    raise exception 'begin_peanuts_capture: source_customer_id is required';
  end if;
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'begin_peanuts_capture: created_by is required';
  end if;
  if p_source_captured_at is null then
    raise exception 'begin_peanuts_capture: source_captured_at is required';
  end if;
  if p_source_commit_sha is null or p_source_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_peanuts_capture: source_commit_sha must be 40 lowercase hex characters';
  end if;
  if p_read_commit_sha is not null and p_read_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_peanuts_capture: read_commit_sha must be 40 lowercase hex characters';
  end if;
  if p_source_manifest_sha256 is null or p_source_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception
      'begin_peanuts_capture: source_manifest_sha256 must be 64 lowercase hex characters';
  end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts) <> 'object'
     or p_expected_counts = '{}'::jsonb then
    raise exception
      'begin_peanuts_capture: expected_counts must be a non-empty JSON object';
  end if;

  -- (3) then (1): the TYPE test, alone, first. This rejects a JSON null, a string --
  -- INCLUDING a numeric-looking one such as "12", which would otherwise cast cleanly and
  -- compare equal -- a boolean, an object and an array.
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where jsonb_typeof(e.value) <> 'number'
  ) then
    raise exception
      'begin_peanuts_capture: every expected_counts value must be a JSON NUMBER that is a non-negative integer; a null, a numeric-looking STRING such as "12", a boolean, an object or an array would either skip that count check at the publication gate or pass it on an untyped value; got %',
      p_expected_counts;
  end if;
  -- Only now, with every value proven to be a number, may anything cast.
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where (e.value #>> '{}')::numeric < 0
        or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
  ) then
    raise exception
      'begin_peanuts_capture: every expected_counts value must be a non-negative integer; got %',
      p_expected_counts;
  end if;
  -- (2): refuse an out-of-range count with a NAMED message rather than letting a later
  -- `::bigint` raise a bare out-of-range and wedge the capture in `loading`.
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where (e.value #>> '{}')::numeric > 9223372036854775807::numeric
  ) then
    raise exception
      'begin_peanuts_capture: an expected_counts value exceeds the maximum representable count (9223372036854775807); got %',
      p_expected_counts;
  end if;

  if p_raw_summary is null or jsonb_typeof(p_raw_summary) <> 'object' then
    raise exception 'begin_peanuts_capture: raw_summary must be a JSON object';
  end if;

  -- Zero-media scope. The table pins media_downloaded to zero; a manifest that CLAIMS a
  -- nonzero media count disagrees with this schema, and that must stop the load.
  if (p_expected_counts ? 'media_downloaded')
     and (p_expected_counts ->> 'media_downloaded')::numeric <> 0 then
    raise exception
      'begin_peanuts_capture: expected_counts.media_downloaded must be 0; this project never downloads media';
  end if;

  -- The paging-wall arithmetic is a MANIFEST FACT, fixed here for the life of the
  -- capture. It is not a progress counter, and it cannot be a progress counter:
  -- service_role holds no UPDATE on plm.peanuts_capture, so a capture whose totals were
  -- never supplied could never satisfy the completion rule and could never publish.
  if p_portal_reported_asset_total is null or p_assets_captured is null
     or p_assets_unreachable is null then
    raise exception
      'begin_peanuts_capture: portal_reported_asset_total, assets_captured and assets_unreachable are required and may not be null';
  end if;
  if p_portal_reported_asset_total < 0 or p_assets_captured < 0
     or p_assets_unreachable < 0 then
    raise exception 'begin_peanuts_capture: the asset totals may not be negative';
  end if;
  if p_deep_paging_partitioned is null or p_vocabularies_loaded_from_source is null
     or p_relationship_graph_walked is null then
    raise exception
      'begin_peanuts_capture: the completeness flags are required and may not be null';
  end if;

  -- Serialize concurrent starts of the SAME capture_key. Two loader processes racing here
  -- would otherwise both miss the select and both insert.
  perform pg_advisory_xact_lock(
    hashtextextended('plm.peanuts_capture:' || p_capture_key, 0));

  select * into v_existing from plm.peanuts_capture where capture_key = p_capture_key;

  if found then
    -- Same key, different bytes, is a CONTRADICTION, not a resume. Silently appending
    -- different source data under an existing capture key would make the snapshot
    -- unreconstructable.
    if v_existing.source_manifest_sha256 is distinct from p_source_manifest_sha256 then
      raise exception
        'begin_peanuts_capture: capture_key % already exists with a DIFFERENT source manifest hash; refusing',
        p_capture_key;
    end if;
    if v_existing.source_commit_sha is distinct from p_source_commit_sha then
      raise exception
        'begin_peanuts_capture: capture_key % already exists with a DIFFERENT source commit sha; refusing',
        p_capture_key;
    end if;
    if v_existing.source_repository is distinct from p_source_repository
       or v_existing.portal_base_url is distinct from p_portal_base_url
       or v_existing.api_endpoint is distinct from p_api_endpoint
       or v_existing.source_customer_id is distinct from p_source_customer_id
       or v_existing.source_captured_at is distinct from p_source_captured_at then
      raise exception
        'begin_peanuts_capture: capture_key % already exists with a DIFFERENT source identity; refusing',
        p_capture_key;
    end if;
    if v_existing.portal_reported_asset_total is distinct from p_portal_reported_asset_total
       or v_existing.assets_captured is distinct from p_assets_captured
       or v_existing.assets_unreachable is distinct from p_assets_unreachable
       or v_existing.deep_paging_partitioned is distinct from p_deep_paging_partitioned
       or v_existing.vocabularies_loaded_from_source
            is distinct from p_vocabularies_loaded_from_source
       or v_existing.relationship_graph_walked
            is distinct from p_relationship_graph_walked then
      raise exception
        'begin_peanuts_capture: capture_key % already exists with DIFFERENT asset totals or completeness flags; refusing',
        p_capture_key;
    end if;

    if v_existing.status = 'complete' then
      -- Idempotent: hand back the finished capture untouched. Never re-open it.
      return v_existing.id;
    elsif v_existing.status = 'loading' then
      -- Resume. Only the loader's own read commit may be refreshed.
      update plm.peanuts_capture
         set read_commit_sha = coalesce(p_read_commit_sha, read_commit_sha)
       where id = v_existing.id;
      return v_existing.id;
    else
      raise exception
        'begin_peanuts_capture: capture_key % is %; start a NEW capture rather than reusing it',
        p_capture_key, v_existing.status;
    end if;
  end if;

  insert into plm.peanuts_capture (
    capture_key, source_repository, source_commit_sha, read_commit_sha,
    source_manifest_sha256, portal_base_url, api_endpoint, source_customer_id,
    source_captured_at, status, expected_counts, raw_summary, created_by,
    portal_reported_asset_total, assets_captured, assets_unreachable,
    deep_paging_partitioned, vocabularies_loaded_from_source, relationship_graph_walked
  ) values (
    p_capture_key, p_source_repository, p_source_commit_sha, p_read_commit_sha,
    p_source_manifest_sha256, p_portal_base_url, p_api_endpoint, p_source_customer_id,
    p_source_captured_at, 'loading', p_expected_counts, p_raw_summary, p_created_by,
    p_portal_reported_asset_total, p_assets_captured, p_assets_unreachable,
    p_deep_paging_partitioned, p_vocabularies_loaded_from_source,
    p_relationship_graph_walked
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function plm.begin_peanuts_capture(
  text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,
  integer,integer,integer,boolean,boolean,boolean,text) is
  'Creates or RESUMES exactly one loading Peanuts capture. Idempotent for an identical '
  'capture. Refuses to re-open a complete or terminal capture, and refuses a same-key '
  'capture whose manifest hash, commit, source identity, asset totals or completeness '
  'flags differ. The asset totals and completeness flags are MANIFEST FACTS fixed here '
  'for the life of the capture -- nothing may mutate them later, because service_role '
  'holds no UPDATE on the table. Sole insert path to plm.peanuts_capture. '
  'service_role only.';


create or replace function plm.finalize_peanuts_capture(
  p_capture_id      uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.peanuts_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_d     bigint;
  v_want  bigint;
  v_key   text;
  v_val   jsonb;
  v_max   numeric := 9223372036854775807::numeric;
  v_pairs text[][] := array[
    ['art_programs',             'peanuts_art_program'],
    ['style_guides',             'peanuts_style_guide'],
    ['characters',               'peanuts_character'],
    ['animation_titles',         'peanuts_animation_title'],
    ['holidays',                 'peanuts_holiday'],
    ['initiatives',              'peanuts_initiative'],
    ['asset_types',              'peanuts_asset_type'],
    ['licensing_statuses',       'peanuts_licensing_status'],
    ['metadata_fields',          'peanuts_metadata_field'],
    ['assets',                   'peanuts_asset'],
    ['asset_art_programs',       'peanuts_asset_art_program'],
    ['asset_characters',         'peanuts_asset_character'],
    ['asset_animation_titles',   'peanuts_asset_animation_title'],
    ['asset_holidays',           'peanuts_asset_holiday'],
    ['asset_keywords',           'peanuts_asset_keyword'],
    ['asset_relationships',      'peanuts_asset_relationship'],
    ['style_guide_characters',   'peanuts_style_guide_character'],
    ['style_guide_art_programs', 'peanuts_style_guide_art_program']
  ];
  i integer;
begin
  -- ARGUMENT VALIDATION HAPPENS AFTER THE ROW LOCK, DELIBERATELY, AND RECORDS ITS
  -- REFUSAL INSTEAD OF RAISING.
  --
  -- Raising here -- which is what this function did in its first draft, and what the
  -- sibling gates still do -- aborts before any 'rejected' row is written. A loader that
  -- transposes the two jsonb arguments, or passes SQL null, then leaves the capture in
  -- 'loading' with NO recorded reason, and a retry with the same arguments dies
  -- identically: the capture is WEDGED. That is the same failure class as the raw cast in
  -- #1221/#1222, arriving through a different door. The lock is taken first so that there
  -- IS a row to record the refusal on.
  --
  -- Note the explicit `is null` test on each argument below. `jsonb_typeof(null)` is
  -- NULL, so `jsonb_typeof(x) <> 'object'` alone is UNKNOWN for a SQL NULL and the `if`
  -- would never fire -- the same never-false shape as #1219, one level up.

  -- The row lock serialises two loaders finalising the same capture.
  select * into v_cap from plm.peanuts_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_peanuts_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_peanuts_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  -- Now that a row is locked, an unusable argument becomes recorded evidence rather than a
  -- wedge. Nothing below may run on a non-object p_observed_counts: `?` and `->` against a
  -- jsonb array or scalar answer about the wrong thing rather than failing.
  if p_observed_counts is null or jsonb_typeof(p_observed_counts) <> 'object' then
    v_err := v_err || jsonb_build_object(
      'code','observed_counts_not_an_object',
      'json_type', coalesce(jsonb_typeof(p_observed_counts), 'sql_null'));
  end if;
  if p_error_summary is null or jsonb_typeof(p_error_summary) <> 'array' then
    v_err := v_err || jsonb_build_object(
      'code','error_summary_not_an_array',
      'json_type', coalesce(jsonb_typeof(p_error_summary), 'sql_null'));
  end if;
  if jsonb_array_length(v_err) > 0 then
    update plm.peanuts_capture
       set status            = 'rejected',
           load_completed_at = null,
           observed_counts   = '{}'::jsonb,
           error_summary     = v_err
     where id = p_capture_id;
    raise warning
      'finalize_peanuts_capture: capture % REJECTED on its arguments with % error(s): %',
      p_capture_id, jsonb_array_length(v_err), v_err;
    return;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. SCOPE AND COMPLETENESS.
  if not v_cap.deep_paging_partitioned then
    v_err := v_err || jsonb_build_object('code','deep_paging_not_partitioned');
  end if;
  -- The guard against the loader shortcut that silently discards every vocabulary value
  -- no asset happens to use.
  if not v_cap.vocabularies_loaded_from_source then
    v_err := v_err || jsonb_build_object('code','vocabularies_not_loaded_from_source');
  end if;
  -- UNREACHABLE WHILE peanuts_capture_media_zero_chk STANDS, AND KEPT ON PURPOSE.
  -- The column is `not null default 0` with a CHECK pinning it to zero, so no writer can
  -- put a nonzero value here today and no contract test can reach this branch without
  -- first dropping that constraint. It is defence in depth for the day someone does.
  -- Stated plainly rather than listed as tested, because a branch reported as covered
  -- when it is not is how the next reader is misled.
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;
  -- relationship_graph_walked is DELIBERATELY NOT a publication blocker: the schema
  -- contract's completion rule does not list it, and a capture whose per-asset
  -- relationship walk was skipped is still a truthful capture of everything else. It is
  -- recorded on the capture so a partial walk is VISIBLE, which is the requirement. What
  -- IS blocked is the contradiction -- relationship rows present while the flag says the
  -- walk never ran.
  if not v_cap.relationship_graph_walked then
    select count(*) into v_n
      from plm.peanuts_asset_relationship where capture_id = p_capture_id;
    if v_n <> 0 then
      v_err := v_err || jsonb_build_object('code','relationship_rows_without_graph_walk',
                                           'rows', v_n);
    end if;
  end if;

  -- ---- B. THE PAGING-WALL ARITHMETIC. This is the clause that makes assets_unreachable
  -- proof rather than decoration: a capture claiming zero unreachable assets while
  -- sitting below the portal's own total cannot balance, and cannot publish.
  -- EVERY TERM CAST TO bigint FIRST. These three columns are `integer`, so the bare
  -- `assets_captured + assets_unreachable` that this line used to carry could itself raise
  -- `integer out of range` -- BEFORE the rejection UPDATE below, wedging the capture with
  -- no recorded reason, which is the very failure this branch exists to report. A capture
  -- begun with assets_captured = 2147483647 and assets_unreachable = 1 is enough; both
  -- values pass begin_'s `>= 0` guard.
  if v_cap.assets_captured::bigint + v_cap.assets_unreachable::bigint
       <> v_cap.portal_reported_asset_total::bigint then
    v_err := v_err || jsonb_build_object(
      'code','asset_total_arithmetic_mismatch',
      'portal_total', v_cap.portal_reported_asset_total,
      'captured', v_cap.assets_captured,
      'unreachable', v_cap.assets_unreachable);
  end if;
  -- And the manifest's claimed capture size must match the rows actually present.
  select count(*) into v_n from plm.peanuts_asset where capture_id = p_capture_id;
  if v_n <> v_cap.assets_captured::bigint then
    v_err := v_err || jsonb_build_object('code','assets_captured_disagrees_with_rows',
                                         'claimed', v_cap.assets_captured, 'rows', v_n);
  end if;

  -- ---- C. Errors the loader itself reported are fatal. A capture that knows it failed
  -- may never publish, whatever the counts say.
  if jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object('code','loader_reported_errors',
                                         'count', jsonb_array_length(p_error_summary));
  end if;

  -- ---- D. Counts, taken from the TABLES, never from a ledger or a summary document.
  -- Three facts must agree: what the source contract EXPECTED, what the loader CLAIMS it
  -- wrote, and what is ACTUALLY in the tables. Checking only two of the three lets a
  -- loader that miscounted its own output pass.
  --
  -- Read the long note above plm.begin_peanuts_capture before editing any branch below.
  -- The branch order -- presence, then TYPE, then sign and integrality, then RANGE, and
  -- only then a cast -- is the whole defence, and it re-reads the STORED expected_counts
  -- rather than trusting that begin_ ever ran.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      -- Catches BOTH the JSON null that would skip the check entirely and the
      -- numeric-looking string that would pass it on an untyped value.
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    elsif (v_exp ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_exp -> v_key);
    else
      -- Through ::numeric, never straight to ::bigint: an integral JSON number written
      -- 1.0 renders as the text '1.0', which ::bigint refuses outright.
      v_want := ((v_exp ->> v_key)::numeric)::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;

    -- The loader's own reported counts carry the identical traps.
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
    elsif (p_observed_counts ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','reported_count_out_of_range',
                                           'entity',v_key,
                                           'reported', p_observed_counts -> v_key);
    elsif ((p_observed_counts ->> v_key)::numeric)::bigint <> v_n then
      v_err := v_err || jsonb_build_object('code','reported_count_mismatch','entity',v_key,
                                           'reported',
                                           ((p_observed_counts ->> v_key)::numeric)::bigint,
                                           'observed',v_n);
    end if;
  end loop;

  -- The loop above only inspects the eighteen entity keys this schema knows. A stored
  -- expected_counts or a reported observed_counts may carry OTHER keys -- media_downloaded
  -- is one, and a future loader may add more -- and an unusable value sitting in one of
  -- those is the same class of defect: a value that looks supplied and compares to
  -- nothing. Sweep the whole object so no key escapes the rule.
  --
  -- THE SWEEP APPLIES THE SAME THREE-PART RULE AS THE EIGHTEEN ENTITY KEYS -- type, then
  -- non-negative integer, then bigint range -- not a type test alone. A type-only sweep
  -- ignores -1 and 1.5 under an extra key while its comment claims every key is covered,
  -- and an owner UPDATE can plant exactly those. This matches the corrected Sega sweep in
  -- 20260819112524 (#1222). Neither shape can skip an entity count, so it is a
  -- truthfulness fix rather than a publication hole -- but a guard whose comment
  -- overstates it is how the next reader is misled.
  for v_key, v_val in select e.key, e.value from jsonb_each(v_exp) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_val,'max', v_max);
    end if;
  end loop;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_observed_counts) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_nonnegative_integer',
                                           'entity',v_key,'reported', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','reported_count_out_of_range',
                                           'entity',v_key,'reported', v_val,'max', v_max);
    end if;
  end loop;

  -- ---- E. Duplicate source identifiers. The primary keys already make these impossible;
  -- this asserts that they are still in force rather than trusting that no later
  -- migration weakened one. It is cheap and it fails loudly.
  select count(*), count(distinct source_object_id) into v_n, v_d
    from plm.peanuts_asset where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_object_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct source_relationship_id) into v_n, v_d
    from plm.peanuts_asset_relationship where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_relationship_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct source_field_label) into v_n, v_d
    from plm.peanuts_metadata_field where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_metadata_field_label',
                                         'rows',v_n,'distinct',v_d);
  end if;

  -- ---- F. THE DERIVED/DECLARED SEPARATION, asserted rather than assumed. The CHECK
  -- constraints already pin these; same reasoning as E.
  select count(*) into v_n from plm.peanuts_style_guide_character
   where capture_id = p_capture_id and relationship_truth <> 'derived';
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','style_guide_character_not_derived',
                                         'rows',v_n);
  end if;
  select count(*) into v_n from plm.peanuts_style_guide_art_program
   where capture_id = p_capture_id and relationship_truth <> 'derived';
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','style_guide_art_program_not_derived',
                                         'rows',v_n);
  end if;

  -- ---- G. THE VOCABULARY-SHORTCUT DETECTOR. The flag on the capture is the loader's
  -- CLAIM; this is the EVIDENCE behind it. If a style-guide vocabulary was loaded and
  -- every single value in it is one that some asset also uses, the vocabulary was almost
  -- certainly built from distinct() over assets rather than pulled from the vocabulary
  -- API -- the exact shortcut that silently discards the hundreds of unused values. A
  -- genuine vocabulary load carries values with asset_count = 0.
  select count(*) into v_n from plm.peanuts_style_guide where capture_id = p_capture_id;
  if v_n > 0 and v_cap.vocabularies_loaded_from_source then
    select count(*) into v_d from plm.peanuts_style_guide
     where capture_id = p_capture_id and asset_count = 0;
    if v_d = 0 then
      v_err := v_err || jsonb_build_object(
        'code','vocabulary_shows_no_unused_values',
        'entity','style_guide',
        'values', v_n,
        'note','every value is used by an asset, which is the signature of a distinct()-over-assets shortcut rather than a vocabulary-API load');
    end if;
  end if;

  -- ---- H. VERDICT. There is no partial publish: either every check passed, or the
  -- capture is rejected and the PREVIOUS complete capture stays current.
  --
  -- WHY THIS DOES NOT `raise exception` ON A REJECTION, AND WHY THAT IS NOT A SILENT
  -- FAILURE. The contract requires BOTH "set status='rejected' and persist the errors"
  -- AND a loud failure. In PostgreSQL an exception aborts the very transaction that wrote
  -- the rejection row, so raising would roll back the evidence and leave the capture
  -- sitting in 'loading' with no record of why it failed -- destroying the auditability
  -- the rejection exists for. The same impossibility was recorded for
  -- plm.finalize_nbcu_capture (20260810070000) and plm.finalize_sega_capture
  -- (20260819015333) and is resolved the same way here.
  -- The failure is loud in three simultaneous, inspectable ways:
  --   1. a WARNING in the server log,
  --   2. a PERSISTED status of 'rejected' with the structured errors,
  --   3. the capture is NOT 'complete', which is the only thing any reader keys on.
  -- THE CALLER MUST READ BACK plm.peanuts_capture.status. This function returns void by
  -- contract, so the status column is the return value.
  if jsonb_array_length(v_err) > 0 then
    update plm.peanuts_capture
       set status            = 'rejected',
           load_completed_at = null,
           observed_counts   = v_obs,
           error_summary     = v_err
     where id = p_capture_id;
    raise warning 'finalize_peanuts_capture: capture % REJECTED with % error(s): %',
      p_capture_id, jsonb_array_length(v_err), v_err;
    return;
  end if;

  update plm.peanuts_capture
     set status            = 'complete',
         load_completed_at = now(),
         observed_counts   = v_obs,
         error_summary     = '[]'::jsonb
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_peanuts_capture(uuid, jsonb, jsonb) is
  'Publishes or REJECTS one loading Peanuts capture. Re-validates the STORED '
  'expected_counts rather than trusting begin_peanuts_capture ran, because an owner '
  'UPDATE can reach that column without the function. Every count must be a JSON NUMBER '
  'that is a non-negative integer within bigint range -- a null, a numeric-looking '
  'string, a fraction or an oversized value is a NAMED error code, never a skipped check '
  'and never a raw cast error. Counts come from the TABLES, and expected, reported and '
  'actual must all three agree. All pass -> status ''complete''. Any fail -> status '
  '''rejected'', errors PERSISTED, a server WARNING raised, and the previous complete '
  'capture left current. NEVER a partial publish. It returns void by contract, so THE '
  'CALLER MUST READ BACK plm.peanuts_capture.status -- raising instead would roll back '
  'the rejection record itself (see the comment in the function body). Idempotent on an '
  'already-complete capture. service_role only.';


-- =====================================================================================
-- RLS, GRANTS, AND THE IMMUTABILITY MECHANISM.
--
-- An RLS policy is not a GRANT and a GRANT is not an RLS policy (AGENTS.md section 11).
-- Both are set here. Supabase''s service_role carries BYPASSRLS, so RLS alone could NOT
-- constrain the loader -- the GRANTS are what enforce immutability.
--
--   plm.peanuts_capture -> service_role: SELECT only. All writes go through the two
--                          security-definer functions above.
--   the other 18        -> service_role: SELECT + INSERT. No UPDATE, DELETE or TRUNCATE.
--                          Rows are immutable from the instant they land.
--   authenticated       -> SELECT only, under the established plm read predicate:
--                          PLM app access, administrator, sales or licensing.
--   anon                -> nothing, revoked explicitly.
--
-- Every statement below is written out in full, one per table, statically and
-- schema-qualified. No dynamic SQL: an auditor -- and the guard that verifies a migration
-- only touches objects its author claimed -- must be able to read exactly which table
-- receives which privilege without executing anything.
--
-- ENABLE, deliberately NOT FORCE. FORCE would apply RLS to the table owner too, which
-- locks the migration runner and every contract-test session out of its own tables for no
-- security gain -- service_role is the identity being constrained, and it is constrained
-- by the GRANTS below, not by RLS.
-- =====================================================================================

-- plm.peanuts_capture
alter table plm.peanuts_capture enable row level security;
revoke all on plm.peanuts_capture from public;
revoke all on plm.peanuts_capture from anon;
revoke all on plm.peanuts_capture from authenticated;
grant select on plm.peanuts_capture to service_role;
grant select on plm.peanuts_capture to authenticated;
create policy peanuts_capture_service_read on plm.peanuts_capture
  for select to service_role using (true);
create policy peanuts_capture_plm_read on plm.peanuts_capture
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_art_program
alter table plm.peanuts_art_program enable row level security;
revoke all on plm.peanuts_art_program from public;
revoke all on plm.peanuts_art_program from anon;
revoke all on plm.peanuts_art_program from authenticated;
grant select, insert on plm.peanuts_art_program to service_role;
grant select on plm.peanuts_art_program to authenticated;
create policy peanuts_art_program_service_read on plm.peanuts_art_program
  for select to service_role using (true);
create policy peanuts_art_program_plm_read on plm.peanuts_art_program
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_style_guide
alter table plm.peanuts_style_guide enable row level security;
revoke all on plm.peanuts_style_guide from public;
revoke all on plm.peanuts_style_guide from anon;
revoke all on plm.peanuts_style_guide from authenticated;
grant select, insert on plm.peanuts_style_guide to service_role;
grant select on plm.peanuts_style_guide to authenticated;
create policy peanuts_style_guide_service_read on plm.peanuts_style_guide
  for select to service_role using (true);
create policy peanuts_style_guide_plm_read on plm.peanuts_style_guide
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_character
alter table plm.peanuts_character enable row level security;
revoke all on plm.peanuts_character from public;
revoke all on plm.peanuts_character from anon;
revoke all on plm.peanuts_character from authenticated;
grant select, insert on plm.peanuts_character to service_role;
grant select on plm.peanuts_character to authenticated;
create policy peanuts_character_service_read on plm.peanuts_character
  for select to service_role using (true);
create policy peanuts_character_plm_read on plm.peanuts_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_animation_title
alter table plm.peanuts_animation_title enable row level security;
revoke all on plm.peanuts_animation_title from public;
revoke all on plm.peanuts_animation_title from anon;
revoke all on plm.peanuts_animation_title from authenticated;
grant select, insert on plm.peanuts_animation_title to service_role;
grant select on plm.peanuts_animation_title to authenticated;
create policy peanuts_animation_title_service_read on plm.peanuts_animation_title
  for select to service_role using (true);
create policy peanuts_animation_title_plm_read on plm.peanuts_animation_title
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_holiday
alter table plm.peanuts_holiday enable row level security;
revoke all on plm.peanuts_holiday from public;
revoke all on plm.peanuts_holiday from anon;
revoke all on plm.peanuts_holiday from authenticated;
grant select, insert on plm.peanuts_holiday to service_role;
grant select on plm.peanuts_holiday to authenticated;
create policy peanuts_holiday_service_read on plm.peanuts_holiday
  for select to service_role using (true);
create policy peanuts_holiday_plm_read on plm.peanuts_holiday
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_initiative
alter table plm.peanuts_initiative enable row level security;
revoke all on plm.peanuts_initiative from public;
revoke all on plm.peanuts_initiative from anon;
revoke all on plm.peanuts_initiative from authenticated;
grant select, insert on plm.peanuts_initiative to service_role;
grant select on plm.peanuts_initiative to authenticated;
create policy peanuts_initiative_service_read on plm.peanuts_initiative
  for select to service_role using (true);
create policy peanuts_initiative_plm_read on plm.peanuts_initiative
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_type
alter table plm.peanuts_asset_type enable row level security;
revoke all on plm.peanuts_asset_type from public;
revoke all on plm.peanuts_asset_type from anon;
revoke all on plm.peanuts_asset_type from authenticated;
grant select, insert on plm.peanuts_asset_type to service_role;
grant select on plm.peanuts_asset_type to authenticated;
create policy peanuts_asset_type_service_read on plm.peanuts_asset_type
  for select to service_role using (true);
create policy peanuts_asset_type_plm_read on plm.peanuts_asset_type
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_licensing_status
alter table plm.peanuts_licensing_status enable row level security;
revoke all on plm.peanuts_licensing_status from public;
revoke all on plm.peanuts_licensing_status from anon;
revoke all on plm.peanuts_licensing_status from authenticated;
grant select, insert on plm.peanuts_licensing_status to service_role;
grant select on plm.peanuts_licensing_status to authenticated;
create policy peanuts_licensing_status_service_read on plm.peanuts_licensing_status
  for select to service_role using (true);
create policy peanuts_licensing_status_plm_read on plm.peanuts_licensing_status
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_metadata_field
alter table plm.peanuts_metadata_field enable row level security;
revoke all on plm.peanuts_metadata_field from public;
revoke all on plm.peanuts_metadata_field from anon;
revoke all on plm.peanuts_metadata_field from authenticated;
grant select, insert on plm.peanuts_metadata_field to service_role;
grant select on plm.peanuts_metadata_field to authenticated;
create policy peanuts_metadata_field_service_read on plm.peanuts_metadata_field
  for select to service_role using (true);
create policy peanuts_metadata_field_plm_read on plm.peanuts_metadata_field
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset
alter table plm.peanuts_asset enable row level security;
revoke all on plm.peanuts_asset from public;
revoke all on plm.peanuts_asset from anon;
revoke all on plm.peanuts_asset from authenticated;
grant select, insert on plm.peanuts_asset to service_role;
grant select on plm.peanuts_asset to authenticated;
create policy peanuts_asset_service_read on plm.peanuts_asset
  for select to service_role using (true);
create policy peanuts_asset_plm_read on plm.peanuts_asset
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_art_program
alter table plm.peanuts_asset_art_program enable row level security;
revoke all on plm.peanuts_asset_art_program from public;
revoke all on plm.peanuts_asset_art_program from anon;
revoke all on plm.peanuts_asset_art_program from authenticated;
grant select, insert on plm.peanuts_asset_art_program to service_role;
grant select on plm.peanuts_asset_art_program to authenticated;
create policy peanuts_asset_art_program_service_read on plm.peanuts_asset_art_program
  for select to service_role using (true);
create policy peanuts_asset_art_program_plm_read on plm.peanuts_asset_art_program
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_character
alter table plm.peanuts_asset_character enable row level security;
revoke all on plm.peanuts_asset_character from public;
revoke all on plm.peanuts_asset_character from anon;
revoke all on plm.peanuts_asset_character from authenticated;
grant select, insert on plm.peanuts_asset_character to service_role;
grant select on plm.peanuts_asset_character to authenticated;
create policy peanuts_asset_character_service_read on plm.peanuts_asset_character
  for select to service_role using (true);
create policy peanuts_asset_character_plm_read on plm.peanuts_asset_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_animation_title
alter table plm.peanuts_asset_animation_title enable row level security;
revoke all on plm.peanuts_asset_animation_title from public;
revoke all on plm.peanuts_asset_animation_title from anon;
revoke all on plm.peanuts_asset_animation_title from authenticated;
grant select, insert on plm.peanuts_asset_animation_title to service_role;
grant select on plm.peanuts_asset_animation_title to authenticated;
create policy peanuts_asset_animation_title_service_read on plm.peanuts_asset_animation_title
  for select to service_role using (true);
create policy peanuts_asset_animation_title_plm_read on plm.peanuts_asset_animation_title
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_holiday
alter table plm.peanuts_asset_holiday enable row level security;
revoke all on plm.peanuts_asset_holiday from public;
revoke all on plm.peanuts_asset_holiday from anon;
revoke all on plm.peanuts_asset_holiday from authenticated;
grant select, insert on plm.peanuts_asset_holiday to service_role;
grant select on plm.peanuts_asset_holiday to authenticated;
create policy peanuts_asset_holiday_service_read on plm.peanuts_asset_holiday
  for select to service_role using (true);
create policy peanuts_asset_holiday_plm_read on plm.peanuts_asset_holiday
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_keyword
alter table plm.peanuts_asset_keyword enable row level security;
revoke all on plm.peanuts_asset_keyword from public;
revoke all on plm.peanuts_asset_keyword from anon;
revoke all on plm.peanuts_asset_keyword from authenticated;
grant select, insert on plm.peanuts_asset_keyword to service_role;
grant select on plm.peanuts_asset_keyword to authenticated;
create policy peanuts_asset_keyword_service_read on plm.peanuts_asset_keyword
  for select to service_role using (true);
create policy peanuts_asset_keyword_plm_read on plm.peanuts_asset_keyword
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_asset_relationship
alter table plm.peanuts_asset_relationship enable row level security;
revoke all on plm.peanuts_asset_relationship from public;
revoke all on plm.peanuts_asset_relationship from anon;
revoke all on plm.peanuts_asset_relationship from authenticated;
grant select, insert on plm.peanuts_asset_relationship to service_role;
grant select on plm.peanuts_asset_relationship to authenticated;
create policy peanuts_asset_relationship_service_read on plm.peanuts_asset_relationship
  for select to service_role using (true);
create policy peanuts_asset_relationship_plm_read on plm.peanuts_asset_relationship
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_style_guide_character
alter table plm.peanuts_style_guide_character enable row level security;
revoke all on plm.peanuts_style_guide_character from public;
revoke all on plm.peanuts_style_guide_character from anon;
revoke all on plm.peanuts_style_guide_character from authenticated;
grant select, insert on plm.peanuts_style_guide_character to service_role;
grant select on plm.peanuts_style_guide_character to authenticated;
create policy peanuts_style_guide_character_service_read on plm.peanuts_style_guide_character
  for select to service_role using (true);
create policy peanuts_style_guide_character_plm_read on plm.peanuts_style_guide_character
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

-- plm.peanuts_style_guide_art_program
alter table plm.peanuts_style_guide_art_program enable row level security;
revoke all on plm.peanuts_style_guide_art_program from public;
revoke all on plm.peanuts_style_guide_art_program from anon;
revoke all on plm.peanuts_style_guide_art_program from authenticated;
grant select, insert on plm.peanuts_style_guide_art_program to service_role;
grant select on plm.peanuts_style_guide_art_program to authenticated;
create policy peanuts_style_guide_art_program_service_read on plm.peanuts_style_guide_art_program
  for select to service_role using (true);
create policy peanuts_style_guide_art_program_plm_read on plm.peanuts_style_guide_art_program
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator') or app.has_any_role(array['sales', 'licensing']::app.app_role[]));


-- -------------------------------------------------------------------------------------
-- THE REVOKES THAT ACTUALLY DELIVER IMMUTABILITY.
--
-- The schema `plm` carries ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
-- service_role, so Postgres handed every table above SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER at CREATE TABLE time. The `grant select, insert`
-- statements above were therefore NO-OPS against a role that already held everything.
-- This is exactly the defect that migration 20260810080000 had to correct for NBCU after
-- the fact; it is handled inside this file instead.
--
-- REFERENCES and TRIGGER are left in place. REFERENCES only allows creating a foreign key
-- that points AT these tables, which writes nothing, and no user trigger exists on them.
-- -------------------------------------------------------------------------------------
revoke update, delete, truncate on plm.peanuts_capture from service_role;
revoke insert on plm.peanuts_capture from authenticated;
revoke update, delete, truncate on plm.peanuts_capture from authenticated;
-- Capture rows are created and transitioned ONLY by plm.begin_peanuts_capture and
-- plm.finalize_peanuts_capture. A direct INSERT here would let a loader mint a capture
-- that skipped every validation begin_ exists to perform.
revoke insert on plm.peanuts_capture from service_role;

revoke update, delete, truncate on plm.peanuts_art_program from service_role;
revoke insert on plm.peanuts_art_program from authenticated;
revoke update, delete, truncate on plm.peanuts_art_program from authenticated;

revoke update, delete, truncate on plm.peanuts_style_guide from service_role;
revoke insert on plm.peanuts_style_guide from authenticated;
revoke update, delete, truncate on plm.peanuts_style_guide from authenticated;

revoke update, delete, truncate on plm.peanuts_character from service_role;
revoke insert on plm.peanuts_character from authenticated;
revoke update, delete, truncate on plm.peanuts_character from authenticated;

revoke update, delete, truncate on plm.peanuts_animation_title from service_role;
revoke insert on plm.peanuts_animation_title from authenticated;
revoke update, delete, truncate on plm.peanuts_animation_title from authenticated;

revoke update, delete, truncate on plm.peanuts_holiday from service_role;
revoke insert on plm.peanuts_holiday from authenticated;
revoke update, delete, truncate on plm.peanuts_holiday from authenticated;

revoke update, delete, truncate on plm.peanuts_initiative from service_role;
revoke insert on plm.peanuts_initiative from authenticated;
revoke update, delete, truncate on plm.peanuts_initiative from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_type from service_role;
revoke insert on plm.peanuts_asset_type from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_type from authenticated;

revoke update, delete, truncate on plm.peanuts_licensing_status from service_role;
revoke insert on plm.peanuts_licensing_status from authenticated;
revoke update, delete, truncate on plm.peanuts_licensing_status from authenticated;

revoke update, delete, truncate on plm.peanuts_metadata_field from service_role;
revoke insert on plm.peanuts_metadata_field from authenticated;
revoke update, delete, truncate on plm.peanuts_metadata_field from authenticated;

revoke update, delete, truncate on plm.peanuts_asset from service_role;
revoke insert on plm.peanuts_asset from authenticated;
revoke update, delete, truncate on plm.peanuts_asset from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_art_program from service_role;
revoke insert on plm.peanuts_asset_art_program from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_art_program from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_character from service_role;
revoke insert on plm.peanuts_asset_character from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_character from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_animation_title from service_role;
revoke insert on plm.peanuts_asset_animation_title from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_animation_title from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_holiday from service_role;
revoke insert on plm.peanuts_asset_holiday from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_holiday from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_keyword from service_role;
revoke insert on plm.peanuts_asset_keyword from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_keyword from authenticated;

revoke update, delete, truncate on plm.peanuts_asset_relationship from service_role;
revoke insert on plm.peanuts_asset_relationship from authenticated;
revoke update, delete, truncate on plm.peanuts_asset_relationship from authenticated;

revoke update, delete, truncate on plm.peanuts_style_guide_character from service_role;
revoke insert on plm.peanuts_style_guide_character from authenticated;
revoke update, delete, truncate on plm.peanuts_style_guide_character from authenticated;

revoke update, delete, truncate on plm.peanuts_style_guide_art_program from service_role;
revoke insert on plm.peanuts_style_guide_art_program from authenticated;
revoke update, delete, truncate on plm.peanuts_style_guide_art_program from authenticated;

-- The two functions are the only write path to the capture root, so their EXECUTE
-- privilege is the privilege that matters. Public loses it; only service_role holds it.
revoke all on function plm.begin_peanuts_capture(
  text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,
  integer,integer,integer,boolean,boolean,boolean,text) from public;
revoke all on function plm.finalize_peanuts_capture(uuid, jsonb, jsonb) from public;
grant execute on function plm.begin_peanuts_capture(
  text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,
  integer,integer,integer,boolean,boolean,boolean,text) to service_role;
grant execute on function plm.finalize_peanuts_capture(uuid, jsonb, jsonb) to service_role;


-- Assert the OUTCOME inside the migration, so this file cannot fail silently the way the
-- NBCU landing did. If the revokes did not take, this raises and the migration fails.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee in ('service_role','authenticated')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then
    raise exception
      'peanuts landing: % write grant(s) survive on peanuts tables; immutability is INERT',
      v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name = 'peanuts_capture'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 0 then
    raise exception 'peanuts landing: plm.peanuts_capture is still directly insertable';
  end if;

  -- A revoke that overshot into SELECT or INSERT would break the loader, so prove it did
  -- not: 19 readable tables, 18 insertable snapshot tables.
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_bad <> 19 then
    raise exception 'peanuts landing: expected 19 service_role SELECT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 18 then
    raise exception 'peanuts landing: expected 18 service_role INSERT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_bad <> 19 then
    raise exception
      'peanuts landing: expected 19 authenticated SELECT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'peanuts\_%'
     and grantee = 'anon';
  if v_bad <> 0 then
    raise exception 'peanuts landing: anon holds % grant(s) on peanuts tables', v_bad;
  end if;

  -- The functions are the write path; assert their EXECUTE privilege too, or the
  -- immutability model has a hole nobody can see in the table grants.
  if has_function_privilege('anon', 'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
          'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception
      'peanuts landing: finalize_peanuts_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role',
       'plm.finalize_peanuts_capture(uuid,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'peanuts landing: service_role cannot execute finalize_peanuts_capture';
  end if;
  -- begin_ is the INSERT path to the capture root, so its lockdown matters at least as
  -- much as finalize_'s. Asserting only finalize_ would leave a leaked default EXECUTE on
  -- begin_ entirely invisible.
  if has_function_privilege('anon', 'plm.begin_peanuts_capture(text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,integer,integer,integer,boolean,boolean,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'plm.begin_peanuts_capture(text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,integer,integer,integer,boolean,boolean,boolean,text)', 'EXECUTE') then
    raise exception
      'peanuts landing: begin_peanuts_capture is executable outside service_role';
  end if;
  if not has_function_privilege('service_role', 'plm.begin_peanuts_capture(text,text,text,text,text,text,text,timestamptz,jsonb,jsonb,text,integer,integer,integer,boolean,boolean,boolean,text)', 'EXECUTE') then
    raise exception 'peanuts landing: service_role cannot execute begin_peanuts_capture';
  end if;

  raise notice 'peanuts privileges: service_role SELECT x19 / INSERT x18, no UPDATE/DELETE/TRUNCATE, anon none';
end;
$$;


-- Assert the SHAPE guarantees that this landing is worthless without, so a later edit
-- that quietly drops one fails here rather than in a load six weeks from now.
do $$
declare
  v_n integer;
begin
  -- The refused relationship. No table in this schema may hold an art-program-to-character
  -- link, derived or otherwise.
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'plm'
     and table_name like 'peanuts\_%'
     and table_name like '%art\_program%'
     and table_name like '%character%';
  if v_n <> 0 then
    raise exception
      'peanuts landing: % art-program-to-character table(s) exist; that link is refused', v_n;
  end if;

  -- No media may ever be stored on the asset table.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'plm' and table_name = 'peanuts_asset'
     and (column_name in ('bytes','media','content','blob','base64','file_bytes')
          or data_type = 'bytea');
  if v_n <> 0 then
    raise exception 'peanuts landing: plm.peanuts_asset carries % media-bearing column(s)', v_n;
  end if;

  -- Style guide must be NULLABLE on the asset: most assets carry none.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'plm' and table_name = 'peanuts_asset'
     and column_name = 'style_guide_key' and is_nullable = 'YES';
  if v_n <> 1 then
    raise exception
      'peanuts landing: plm.peanuts_asset.style_guide_key must exist and be NULLABLE';
  end if;

  -- publication_date_text must stay text. A date column here would reject the portal''s
  -- free-text values and lose them.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'plm' and table_name = 'peanuts_asset'
     and column_name = 'publication_date_text' and data_type = 'text';
  if v_n <> 1 then
    raise exception 'peanuts landing: publication_date_text must exist and be text';
  end if;

  -- All 19 claimed tables exist.
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'plm' and table_name like 'peanuts\_%' and table_type = 'BASE TABLE';
  if v_n <> 19 then
    raise exception 'peanuts landing: expected 19 tables, found %', v_n;
  end if;

  raise notice 'peanuts shape: 19 tables, no art-program-to-character link, no media, style guide nullable';
end;
$$;


-- =====================================================================================
-- api.source_capture_inventory -- EXTENDED, not rewritten.
--
-- This body is the CURRENT definition from 20260819015333 (the Sega landing) with the
-- Peanuts source added and NOTHING else changed. Every pre-existing source keeps its
-- exact classification, counting rule, basis, status and note, and the ten output columns
-- keep their names, types and order so existing SELECT * consumers do not shift.
--
-- WHAT WAS ADDED, EXHAUSTIVELY:
--   1. `peanuts_capture_id` in the `latest` CTE -- the newest complete Peanuts capture.
--   2. `peanuts\_%` -> source_system 'peanuts' in the classifier.
--   3. Peanuts branches in latest_count, count_basis, latest_complete_status and
--      count_note, mirroring the NBCU and Sega rules exactly (one latest complete
--      capture; loading, rejected and abandoned attempts stay retained-only).
--
-- ⚠️ WHAT WAS DELIBERATELY NOT ADDED: `plm.wildbrain_*` is still unclassified and still
-- falls through to source_system 'other' with count_basis 'retained_only'. The WildBrain
-- landing (20260819014639) never extended this view. That is a real gap, but those tables
-- belong to another author's object claim, so silently adopting them here would be
-- exactly the cross-author overwrite this repository's object guard exists to prevent. It
-- is reported rather than fixed.
--
-- It exposes only counts and status. NO Peanuts row value is visible through this view,
-- so there is no licensed-content exposure here.
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
      as sega_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id
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
      when c.relname like 'peanuts\_%' then 'peanuts'
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

      -- Peanuts: identical contract to NBCU and Sega -- one latest complete capture, and
      -- loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'peanuts_capture' then case when l.peanuts_capture_id is null then null else 1::bigint end
      when c.relname like 'peanuts\_%' and c.has_capture_id and l.peanuts_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.peanuts_capture_id::text), false, true, '')))[1]::text::bigint

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
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
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
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
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
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
         and peanuts_capture_id is null then
      'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then
      'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.'
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
