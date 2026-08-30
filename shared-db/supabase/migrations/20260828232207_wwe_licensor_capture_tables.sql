-- =====================================================================================
-- WWE licensor capture -- plm.wwe_* table family (schema only, release 1).
--
-- Migration: 20260828232207_wwe_licensor_capture_tables.sql
-- Issue:     u2giants/shared-db #1769 (schema contract)
-- Claim:     u2giants/shared-db #1805, reserved version 20260828232207
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO WWE VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The WWE extract is licensed source data
-- held in the PRIVATE repo u2giants/licensor-source-data
-- (wwe/docs/wwe-shared-db-table-spec.md). No WWE property, contract, submission,
-- style-guide, asset, file name, tag or raw payload value may ever appear in this file,
-- in a contract test, in CI output, or in a pull request or issue on this repository.
--   SCHEMA IN GIT. DATA OUT OF GIT.
--
-- WHAT THIS IS
--   Modelled directly on the existing plm.sega_* family, which covers the same kind of
--   submissions-portal capture (Dependable Solutions, the same platform WWE uses on the
--   submissions side), plus a new creative-portal side (Frontify) that Sega has no
--   equivalent of. Every table carries `capture_id uuid` and `raw jsonb`, so a load is
--   fully re-derivable from its capture. Sits alongside the existing
--   plm.contract_property* tables in this schema.
--
-- TWO CAPTURE HEADERS, BECAUSE TWO UNRELATED PORTALS FEED THIS FAMILY
--   plm.wwe_submission_capture roots the Dependable Solutions submissions-side tables.
--   plm.wwe_creative_capture roots the Frontify creative-side tables. The two portals
--   are captured independently and on different cadences, so they get independent
--   capture roots rather than one shared header pretending they run together.
--
-- THE SUBMISSIONS SIDE IS CANONICAL FOR PROPERTY IDENTITY (owner constraint, issue body)
--   plm.wwe_property is the only property identity in this family. Creative-portal
--   labels (brands, style guides, asset folders/tags) may only ever attach BELOW that
--   level -- as inferred links in the *_inferred tables -- and must never rename, split
--   or merge a submissions-derived property. That is why wwe_creative_brand,
--   wwe_style_guide, wwe_asset, wwe_asset_folder and wwe_tag carry no direct foreign key
--   to wwe_property: every property association they gain is written as a
--   *_property_inferred row, never as a same-capture column value.
--
-- THE VISIBILITY-GAP COUNTS ARE NEVER RECONCILED (owner constraint, issue body)
--   The Frontify account this pipeline reads through reports fewer style guides than it
--   states exist. plm.wwe_creative_capture stores guidelines_visible (what this account
--   could enumerate) and guidelines_reported (what the portal claims exists) as two
--   separate columns. No migration, view or loader may collapse them into one number.
--
-- THE DERIVED/INFERRED TABLES ARE NOT PORTAL RECORDS
--   Mirrors the Sega *_candidate / *_inferred pattern (plm.sega_character_candidate,
--   plm.sega_character_evidence, plm.sega_inferred_asset_property). Nothing in
--   wwe_character_candidate, wwe_character_evidence, wwe_character_property_inferred,
--   wwe_asset_property_inferred, wwe_style_guide_property_inferred or
--   wwe_asset_style_guide_inferred is a source-declared fact. Every row carries
--   match_method, rule_version, confidence and relationship_truth, and
--   relationship_truth is pinned to 'inferred' by CHECK, exactly as
--   plm.sega_character_evidence pins it -- there is no value that lets a row here claim
--   portal-declared provenance.
--
--   The submissions portal exposes a single property and no child IPs on a submission;
--   character-level detail exists only as free text on submission detail pages
--   (wwe_submission_ip), and reflects what THIS LICENSEE submitted, not the licensor's
--   full character vocabulary. wwe_character_candidate is fed from that free text plus
--   creative-side folder/tag labels, and is a reconstruction, never a master record.
--
-- WHY THE INFERRED TABLES CARRY NO FOREIGN KEY TO plm.wwe_property
--   A wwe_property row is scoped to a wwe_submission_capture.id. An inferred link is
--   produced by a process that reads BOTH capture headers (submissions for identity,
--   creative for the candidate labels), so its own capture_id cannot simultaneously
--   satisfy a composite foreign key into a table scoped to the other header. Identity
--   is therefore by property_source_id text value, checked non-blank, not by a foreign
--   key -- the same trade the Sega family makes wherever a table would otherwise need to
--   reference two unrelated capture roots at once.
--
-- WHAT THIS DELIBERATELY IS NOT
--   It creates, renames, updates, merges and deletes NOTHING in core.* or dam.*. It
--   ships no privilege-separation/immutability lock-down and no capture-lifecycle
--   functions (plm.begin_*_capture / plm.finalize_*_capture) -- those are a loader
--   concern for a future release and are out of scope for issue #1769, which asks only
--   for the table family. plm.wwe_submission_capture and plm.wwe_creative_capture are
--   therefore plain landing tables, following the DML-preserving plm.pmt_* convention
--   (service_role default privileges: insert/select/update/delete), not the
--   privilege-locked plm.sega_capture/plm.nbcu_capture convention.
--
-- Depends on (exact 14-digit versions):
--   20260621150714  foundation             -- schema plm
--   20260621150815  app_core               -- app.has_role / has_any_role / has_app_access
-- =====================================================================================


-- =====================================================================================
-- 1. CAPTURE HEADERS.
-- =====================================================================================

create table plm.wwe_submission_capture (
  id                 uuid        primary key default gen_random_uuid(),
  capture_key        text        not null unique,
  source_repository  text        not null,
  source_commit_sha  text        not null,
  source_hash        text        not null,
  source_url         text        not null,
  source_captured_at timestamptz not null,
  load_started_at    timestamptz not null default now(),
  load_completed_at  timestamptz     null,
  status             text        not null default 'loading',
  expected_counts    jsonb       not null,
  observed_counts    jsonb       not null default '{}'::jsonb,
  error_summary      jsonb       not null default '[]'::jsonb,
  raw_summary        jsonb       not null,
  created_by         text        not null,

  constraint wwe_submission_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint wwe_submission_capture_key_nonblank_chk check (btrim(capture_key) <> ''),
  constraint wwe_submission_capture_repository_nonblank_chk
    check (btrim(source_repository) <> ''),
  constraint wwe_submission_capture_commit_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint wwe_submission_capture_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint wwe_submission_capture_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint wwe_submission_capture_created_by_nonblank_chk
    check (btrim(created_by) <> ''),
  constraint wwe_submission_capture_expected_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint wwe_submission_capture_observed_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint wwe_submission_capture_errors_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint wwe_submission_capture_raw_obj_chk check (jsonb_typeof(raw_summary) = 'object'),
  constraint wwe_submission_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null))
);

comment on table plm.wwe_submission_capture is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per attempted '
  'Dependable Solutions submissions-portal load. Append-only snapshot root, columns as '
  'plm.sega_submission_capture. Rows the WWE contract/property/submission tables below.';

create table plm.wwe_creative_capture (
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
  brand_paging_terminal    boolean     not null default false,
  folder_paging_terminal   boolean     not null default false,
  asset_paging_terminal    boolean     not null default false,
  -- The account-visibility gap, kept as two separate manifest facts. See the file
  -- header: these are never reconciled into one number by any loader, view or
  -- migration.
  guidelines_visible       integer     not null,
  guidelines_reported      integer     not null,
  error_summary            jsonb       not null default '[]'::jsonb,
  raw_summary              jsonb       not null,
  created_by               text        not null,

  constraint wwe_creative_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint wwe_creative_capture_key_nonblank_chk check (btrim(capture_key) <> ''),
  constraint wwe_creative_capture_repository_nonblank_chk
    check (btrim(source_repository) <> ''),
  constraint wwe_creative_capture_portal_nonblank_chk check (btrim(portal_base_url) <> ''),
  constraint wwe_creative_capture_created_by_nonblank_chk check (btrim(created_by) <> ''),
  constraint wwe_creative_capture_commit_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint wwe_creative_capture_read_commit_sha_chk
    check (read_commit_sha is null or read_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint wwe_creative_capture_manifest_sha256_chk
    check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint wwe_creative_capture_expected_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint wwe_creative_capture_observed_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint wwe_creative_capture_errors_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint wwe_creative_capture_raw_obj_chk check (jsonb_typeof(raw_summary) = 'object'),
  constraint wwe_creative_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint wwe_creative_capture_guidelines_visible_nonneg_chk
    check (guidelines_visible >= 0),
  constraint wwe_creative_capture_guidelines_reported_nonneg_chk
    check (guidelines_reported >= 0)
);

comment on table plm.wwe_creative_capture is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One row per attempted '
  'Frontify creative-portal load, columns as plm.sega_capture. guidelines_visible vs '
  'guidelines_reported hold the account-visibility gap; never reconciled into one value.';
comment on column plm.wwe_creative_capture.guidelines_visible is
  'Style guides this account could actually enumerate in the capture.';
comment on column plm.wwe_creative_capture.guidelines_reported is
  'Style guide count the portal itself reports as existing. May legitimately exceed '
  'guidelines_visible; that gap is evidence, not an error to correct.';


-- =====================================================================================
-- 2. SUBMISSIONS SIDE (Dependable Solutions). Canonical for property identity.
-- =====================================================================================

create table plm.wwe_contract (
  capture_id        uuid  not null references plm.wwe_submission_capture(id) on delete restrict,
  contract_source_id text not null,
  contract_label    text  not null,
  raw               jsonb not null,

  constraint wwe_contract_pkey primary key (capture_id, contract_source_id),
  constraint wwe_contract_source_id_nonblank_chk check (btrim(contract_source_id) <> ''),
  constraint wwe_contract_label_nonblank_chk check (btrim(contract_label) <> ''),
  constraint wwe_contract_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_contract is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Portal contract records for '
  'one submissions capture.';

create table plm.wwe_property (
  capture_id                uuid  not null references plm.wwe_submission_capture(id) on delete restrict,
  property_source_id        text  not null,
  property_label            text  not null,
  parent_property_source_id text      null,
  license_type_label        text      null,
  source_url                text  not null,
  source_hash               text  not null,
  raw                       jsonb not null,

  constraint wwe_property_pkey primary key (capture_id, property_source_id),
  constraint wwe_property_parent_fkey
    foreign key (capture_id, parent_property_source_id)
    references plm.wwe_property (capture_id, property_source_id)
    on delete restrict
    deferrable initially deferred,
  constraint wwe_property_no_self_parent_chk
    check (parent_property_source_id is null
           or parent_property_source_id <> property_source_id),
  constraint wwe_property_source_id_nonblank_chk check (btrim(property_source_id) <> ''),
  constraint wwe_property_label_nonblank_chk check (btrim(property_label) <> ''),
  constraint wwe_property_parent_nonblank_chk
    check (parent_property_source_id is null or btrim(parent_property_source_id) <> ''),
  constraint wwe_property_license_type_nonblank_chk
    check (license_type_label is null or btrim(license_type_label) <> ''),
  constraint wwe_property_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint wwe_property_hash_nonblank_chk check (btrim(source_hash) <> ''),
  constraint wwe_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_property is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. THE canonical property '
  'identity for this family -- see the file header. Creative-portal labels never '
  'rename, split or merge a row here; they attach only via the *_inferred tables.';

create table plm.wwe_contract_property (
  capture_id          uuid  not null,
  contract_source_id  text  not null,
  property_source_id  text  not null,
  raw                 jsonb not null,

  constraint wwe_contract_property_pkey
    primary key (capture_id, contract_source_id, property_source_id),
  constraint wwe_contract_property_contract_fkey
    foreign key (capture_id, contract_source_id)
    references plm.wwe_contract (capture_id, contract_source_id) on delete restrict,
  constraint wwe_contract_property_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.wwe_property (capture_id, property_source_id) on delete restrict,
  constraint wwe_contract_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_contract_property is
  'LICENSED WWE SOURCE EVIDENCE. Direct portal relationship: which property a contract '
  'grants.';

create table plm.wwe_product_entitlement (
  id                  uuid    primary key default gen_random_uuid(),
  capture_id          uuid    not null references plm.wwe_submission_capture(id) on delete restrict,
  product_label       text    not null,
  category_label      text        null,
  sub_category_label  text        null,
  article_label       text        null,
  contract_source_id  text    not null,
  property_source_id  text    not null,
  raw                 jsonb   not null,

  constraint wwe_product_entitlement_contract_fkey
    foreign key (capture_id, contract_source_id)
    references plm.wwe_contract (capture_id, contract_source_id) on delete restrict,
  constraint wwe_product_entitlement_property_fkey
    foreign key (capture_id, property_source_id)
    references plm.wwe_property (capture_id, property_source_id) on delete restrict,
  constraint wwe_product_entitlement_product_nonblank_chk check (btrim(product_label) <> ''),
  constraint wwe_product_entitlement_category_nonblank_chk
    check (category_label is null or btrim(category_label) <> ''),
  constraint wwe_product_entitlement_sub_category_nonblank_chk
    check (sub_category_label is null or btrim(sub_category_label) <> ''),
  constraint wwe_product_entitlement_article_nonblank_chk
    check (article_label is null or btrim(article_label) <> ''),
  constraint wwe_product_entitlement_contract_nonblank_chk
    check (btrim(contract_source_id) <> ''),
  constraint wwe_product_entitlement_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint wwe_product_entitlement_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_product_entitlement is
  'LICENSED WWE SOURCE EVIDENCE. One entitled product/category/article under a contract '
  'grant. The portal gives this row no natural key, so identity is a surrogate id.';

create table plm.wwe_submission (
  capture_id        uuid        not null references plm.wwe_submission_capture(id) on delete restrict,
  submission_number text        not null,
  submission_code   text            null,
  licensor_label    text        not null,
  contract_label    text            null,
  company_label     text            null,
  sku               text            null,
  submission_type   text            null,
  samples           text            null,
  date_submitted    date            null,
  response_date     date            null,
  submitted_by      text            null,
  status            text            null,
  source_url        text        not null,
  raw               jsonb       not null,

  constraint wwe_submission_pkey primary key (capture_id, submission_number),
  constraint wwe_submission_number_nonblank_chk check (btrim(submission_number) <> ''),
  constraint wwe_submission_licensor_nonblank_chk check (btrim(licensor_label) <> ''),
  constraint wwe_submission_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint wwe_submission_code_nonblank_chk
    check (submission_code is null or btrim(submission_code) <> ''),
  constraint wwe_submission_status_nonblank_chk
    check (status is null or btrim(status) <> ''),
  constraint wwe_submission_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_submission is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One submission record per '
  'capture. The submissions portal exposes a single property per submission and no '
  'child IPs; per-character detail is free text captured in wwe_submission_ip only.';

create table plm.wwe_submission_ip (
  capture_id          uuid    not null,
  submission_number   text    not null,
  ip_ordinal          integer not null,
  ip_label            text    not null,
  normalized_ip_label text    not null,
  raw                 jsonb   not null,

  constraint wwe_submission_ip_pkey primary key (capture_id, submission_number, ip_ordinal),
  constraint wwe_submission_ip_submission_fkey
    foreign key (capture_id, submission_number)
    references plm.wwe_submission (capture_id, submission_number) on delete restrict,
  constraint wwe_submission_ip_ordinal_pos_chk check (ip_ordinal > 0),
  constraint wwe_submission_ip_label_nonblank_chk check (btrim(ip_label) <> ''),
  constraint wwe_submission_ip_normalized_nonblank_chk
    check (btrim(normalized_ip_label) <> ''),
  constraint wwe_submission_ip_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_submission_ip is
  'LICENSED WWE SOURCE EVIDENCE. The multi-valued free-text IP field on a submission, '
  'split into ordered rows. Reflects what this licensee submitted, not the licensor''s '
  'full IP vocabulary -- feeds plm.wwe_character_candidate as evidence only.';

create table plm.wwe_submission_stage (
  capture_id        uuid    not null,
  submission_number text    not null,
  stage_ordinal     integer not null,
  stage_label       text    not null,
  revision_number   integer     null,
  stage_status      text        null,
  raw               jsonb   not null,

  constraint wwe_submission_stage_pkey
    primary key (capture_id, submission_number, stage_ordinal),
  constraint wwe_submission_stage_submission_fkey
    foreign key (capture_id, submission_number)
    references plm.wwe_submission (capture_id, submission_number) on delete restrict,
  constraint wwe_submission_stage_ordinal_pos_chk check (stage_ordinal > 0),
  constraint wwe_submission_stage_label_nonblank_chk check (btrim(stage_label) <> ''),
  constraint wwe_submission_stage_status_nonblank_chk
    check (stage_status is null or btrim(stage_status) <> ''),
  constraint wwe_submission_stage_revision_nonneg_chk
    check (revision_number is null or revision_number >= 0),
  constraint wwe_submission_stage_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_submission_stage is
  'LICENSED WWE SOURCE EVIDENCE. Ordered approval-stage history for one submission.';

create table plm.wwe_submission_image (
  capture_id        uuid  not null,
  submission_number text  not null,
  image_source_id   text  not null,
  stage             text      null,
  raw               jsonb not null,

  constraint wwe_submission_image_pkey
    primary key (capture_id, submission_number, image_source_id),
  constraint wwe_submission_image_submission_fkey
    foreign key (capture_id, submission_number)
    references plm.wwe_submission (capture_id, submission_number) on delete restrict,
  constraint wwe_submission_image_source_id_nonblank_chk
    check (btrim(image_source_id) <> ''),
  constraint wwe_submission_image_stage_nonblank_chk
    check (stage is null or btrim(stage) <> ''),
  constraint wwe_submission_image_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_submission_image is
  'LICENSED WWE SOURCE EVIDENCE. Image metadata attached to a submission stage. No '
  'media bytes -- portal identifiers only, per the shared-db media-scope convention.';

create table plm.wwe_submission_comment (
  capture_id        uuid        not null,
  submission_number text        not null,
  comment_hash      text        not null,
  stage             text            null,
  posted_on         timestamptz     null,
  author            text            null,
  body              text        not null,
  raw               jsonb       not null,

  constraint wwe_submission_comment_pkey
    primary key (capture_id, submission_number, comment_hash),
  constraint wwe_submission_comment_submission_fkey
    foreign key (capture_id, submission_number)
    references plm.wwe_submission (capture_id, submission_number) on delete restrict,
  constraint wwe_submission_comment_hash_chk check (comment_hash ~ '^[0-9a-f]{64}$'),
  constraint wwe_submission_comment_body_nonblank_chk check (btrim(body) <> ''),
  constraint wwe_submission_comment_stage_nonblank_chk
    check (stage is null or btrim(stage) <> ''),
  constraint wwe_submission_comment_author_nonblank_chk
    check (author is null or btrim(author) <> ''),
  constraint wwe_submission_comment_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_submission_comment is
  'LICENSED WWE SOURCE EVIDENCE. Review-thread comments on a submission. Identity is a '
  'content hash because the portal gives comments no stable id.';


-- =====================================================================================
-- 3. CREATIVE SIDE (Frontify). Labels here attach BELOW property identity only.
-- =====================================================================================

create table plm.wwe_creative_brand (
  capture_id      uuid  not null references plm.wwe_creative_capture(id) on delete restrict,
  brand_source_id text  not null,
  brand_label     text  not null,
  raw             jsonb not null,

  constraint wwe_creative_brand_pkey primary key (capture_id, brand_source_id),
  constraint wwe_creative_brand_source_id_nonblank_chk check (btrim(brand_source_id) <> ''),
  constraint wwe_creative_brand_label_nonblank_chk check (btrim(brand_label) <> ''),
  constraint wwe_creative_brand_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_creative_brand is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Frontify brand records for '
  'one creative capture. Carries no direct link to plm.wwe_property -- see file header.';

create table plm.wwe_style_guide (
  capture_id          uuid  not null,
  guideline_source_id text  not null,
  brand_source_id     text  not null,
  guideline_label     text  not null,
  page_count          integer   null,
  source_url          text  not null,
  raw                 jsonb not null,

  constraint wwe_style_guide_pkey primary key (capture_id, guideline_source_id),
  constraint wwe_style_guide_brand_fkey
    foreign key (capture_id, brand_source_id)
    references plm.wwe_creative_brand (capture_id, brand_source_id) on delete restrict,
  constraint wwe_style_guide_source_id_nonblank_chk check (btrim(guideline_source_id) <> ''),
  constraint wwe_style_guide_label_nonblank_chk check (btrim(guideline_label) <> ''),
  constraint wwe_style_guide_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint wwe_style_guide_page_count_nonneg_chk check (page_count is null or page_count >= 0),
  constraint wwe_style_guide_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_style_guide is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. One Frontify guideline this '
  'account could see. Counted in plm.wwe_creative_capture.guidelines_visible.';

create table plm.wwe_style_guide_page (
  capture_id          uuid    not null,
  guideline_source_id text    not null,
  page_source_id      text    not null,
  page_title          text        null,
  page_ordinal        integer not null,
  raw                 jsonb   not null,

  constraint wwe_style_guide_page_pkey
    primary key (capture_id, guideline_source_id, page_source_id),
  constraint wwe_style_guide_page_guide_fkey
    foreign key (capture_id, guideline_source_id)
    references plm.wwe_style_guide (capture_id, guideline_source_id) on delete restrict,
  constraint wwe_style_guide_page_source_id_nonblank_chk check (btrim(page_source_id) <> ''),
  constraint wwe_style_guide_page_title_nonblank_chk
    check (page_title is null or btrim(page_title) <> ''),
  constraint wwe_style_guide_page_ordinal_pos_chk check (page_ordinal > 0),
  constraint wwe_style_guide_page_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_style_guide_page is
  'LICENSED WWE SOURCE EVIDENCE. Ordered pages within one visible style guide.';

create table plm.wwe_asset_library (
  capture_id       uuid    not null,
  library_source_id text  not null,
  brand_source_id  text    not null,
  library_label    text    not null,
  library_kind     text        null,
  asset_count      integer     null,
  raw              jsonb   not null,

  constraint wwe_asset_library_pkey primary key (capture_id, library_source_id),
  constraint wwe_asset_library_brand_fkey
    foreign key (capture_id, brand_source_id)
    references plm.wwe_creative_brand (capture_id, brand_source_id) on delete restrict,
  constraint wwe_asset_library_source_id_nonblank_chk check (btrim(library_source_id) <> ''),
  constraint wwe_asset_library_label_nonblank_chk check (btrim(library_label) <> ''),
  constraint wwe_asset_library_kind_nonblank_chk
    check (library_kind is null or btrim(library_kind) <> ''),
  constraint wwe_asset_library_count_nonneg_chk check (asset_count is null or asset_count >= 0),
  constraint wwe_asset_library_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_library is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. A Frontify asset library '
  'under one brand.';

create table plm.wwe_asset_folder (
  capture_id               uuid    not null,
  folder_source_id         text    not null,
  parent_folder_source_id  text        null,
  folder_label             text    not null,
  folder_path              text    not null,
  folder_depth             integer not null,
  raw                      jsonb   not null,

  constraint wwe_asset_folder_pkey primary key (capture_id, folder_source_id),
  constraint wwe_asset_folder_capture_fkey
    foreign key (capture_id) references plm.wwe_creative_capture(id) on delete restrict,
  constraint wwe_asset_folder_path_uk unique (capture_id, folder_path),
  constraint wwe_asset_folder_parent_fkey
    foreign key (capture_id, parent_folder_source_id)
    references plm.wwe_asset_folder (capture_id, folder_source_id)
    on delete restrict
    deferrable initially deferred,
  constraint wwe_asset_folder_no_self_parent_chk
    check (parent_folder_source_id is null
           or parent_folder_source_id <> folder_source_id),
  constraint wwe_asset_folder_source_id_nonblank_chk check (btrim(folder_source_id) <> ''),
  constraint wwe_asset_folder_parent_nonblank_chk
    check (parent_folder_source_id is null or btrim(parent_folder_source_id) <> ''),
  constraint wwe_asset_folder_label_nonblank_chk check (btrim(folder_label) <> ''),
  constraint wwe_asset_folder_path_nonblank_chk check (btrim(folder_path) <> ''),
  constraint wwe_asset_folder_depth_pos_chk check (folder_depth > 0),
  constraint wwe_asset_folder_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_folder is
  'LICENSED WWE SOURCE EVIDENCE. Self-parented Frontify folder tree for one capture, '
  'same shape as plm.sega_catalog. folder_path is unique per capture; a leaf label is '
  'not, because Frontify repeats folder names under different parents.';

create table plm.wwe_asset (
  capture_id          uuid        not null,
  asset_source_id     text        not null,
  library_source_id   text        not null,
  title               text            null,
  file_name           text        not null,
  extension           text            null,
  asset_kind          text            null,
  width               integer         null,
  height              integer         null,
  source_status       text            null,
  source_created_at   timestamptz     null,
  source_modified_at  timestamptz     null,
  creator_label       text            null,
  copyright_status    text            null,
  copyright_notice    text            null,
  source_hash         text        not null,
  raw                 jsonb       not null,

  constraint wwe_asset_pkey primary key (capture_id, asset_source_id),
  constraint wwe_asset_library_fkey
    foreign key (capture_id, library_source_id)
    references plm.wwe_asset_library (capture_id, library_source_id) on delete restrict,
  constraint wwe_asset_source_id_nonblank_chk check (btrim(asset_source_id) <> ''),
  constraint wwe_asset_file_name_nonblank_chk check (btrim(file_name) <> ''),
  constraint wwe_asset_hash_nonblank_chk check (btrim(source_hash) <> ''),
  constraint wwe_asset_title_nonblank_chk check (title is null or btrim(title) <> ''),
  constraint wwe_asset_extension_nonblank_chk
    check (extension is null or btrim(extension) <> ''),
  constraint wwe_asset_kind_nonblank_chk check (asset_kind is null or btrim(asset_kind) <> ''),
  constraint wwe_asset_source_status_nonblank_chk
    check (source_status is null or btrim(source_status) <> ''),
  constraint wwe_asset_creator_nonblank_chk
    check (creator_label is null or btrim(creator_label) <> ''),
  constraint wwe_asset_copyright_status_nonblank_chk
    check (copyright_status is null or btrim(copyright_status) <> ''),
  constraint wwe_asset_width_nonneg_chk check (width is null or width >= 0),
  constraint wwe_asset_height_nonneg_chk check (height is null or height >= 0),
  constraint wwe_asset_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Asset METADATA only for one '
  'capture -- no media byte column, same convention as plm.sega_asset.';

create table plm.wwe_asset_folder_member (
  capture_id       uuid  not null,
  asset_source_id  text  not null,
  folder_source_id text  not null,
  raw              jsonb not null,

  constraint wwe_asset_folder_member_pkey
    primary key (capture_id, asset_source_id, folder_source_id),
  constraint wwe_asset_folder_member_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.wwe_asset (capture_id, asset_source_id) on delete restrict,
  constraint wwe_asset_folder_member_folder_fkey
    foreign key (capture_id, folder_source_id)
    references plm.wwe_asset_folder (capture_id, folder_source_id) on delete restrict,
  constraint wwe_asset_folder_member_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_folder_member is
  'LICENSED WWE SOURCE EVIDENCE. DIRECT portal relationship: many-to-many folder '
  'membership for an asset.';

create table plm.wwe_tag (
  capture_id           uuid  not null references plm.wwe_creative_capture(id) on delete restrict,
  tag_source_key       text  not null,
  tag_label            text  not null,
  normalized_tag_label text  not null,
  raw                  jsonb not null,

  constraint wwe_tag_pkey primary key (capture_id, tag_source_key),
  constraint wwe_tag_key_nonblank_chk check (btrim(tag_source_key) <> ''),
  constraint wwe_tag_label_nonblank_chk check (btrim(tag_label) <> ''),
  constraint wwe_tag_normalized_nonblank_chk check (btrim(normalized_tag_label) <> ''),
  constraint wwe_tag_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_tag is
  'LICENSED WWE SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Deduplicated tag dimension '
  'for one creative capture.';

create table plm.wwe_asset_tag (
  capture_id      uuid  not null,
  asset_source_id text  not null,
  tag_source_key  text  not null,
  tag_value       text      null,
  -- The portal flags each tag as manually entered or machine-generated (issue body).
  -- Both are kept and the flag must survive the load, so it is a closed CHECK, not a
  -- free-text column that a normalising loader could quietly drop.
  tag_source      text  not null,
  raw             jsonb not null,

  constraint wwe_asset_tag_pkey primary key (capture_id, asset_source_id, tag_source_key),
  constraint wwe_asset_tag_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.wwe_asset (capture_id, asset_source_id) on delete restrict,
  constraint wwe_asset_tag_tag_fkey
    foreign key (capture_id, tag_source_key)
    references plm.wwe_tag (capture_id, tag_source_key) on delete restrict,
  constraint wwe_asset_tag_source_chk
    check (tag_source in ('manual','machine_generated')),
  constraint wwe_asset_tag_value_nonblank_chk
    check (tag_value is null or btrim(tag_value) <> ''),
  constraint wwe_asset_tag_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_tag is
  'LICENSED WWE SOURCE EVIDENCE. DIRECT portal relationship: which tags an asset '
  'carries. tag_source is a closed manual/machine_generated CHECK per the portal''s own '
  'flag -- never collapsed to one undifferentiated tag list.';


-- =====================================================================================
-- 4. DERIVED / INFERRED TABLES. Nothing here is licensor truth (issue body).
--
-- Every table carries match_method, rule_version, confidence and relationship_truth.
-- relationship_truth is pinned to 'inferred' by CHECK, admitting no other value, the
-- same guarantee as plm.sega_character_evidence.relationship_truth.
--
-- capture_id on these tables is NOT foreign-keyed to a single capture header: an
-- inference reads both plm.wwe_submission_capture (for property identity) and
-- plm.wwe_creative_capture (for the creative-side candidate labels) at once, so no
-- single composite foreign key can describe it. See the file header.
-- =====================================================================================

create table plm.wwe_character_candidate (
  capture_id                  uuid         not null,
  character_candidate_key     text         not null,
  candidate_label             text         not null,
  normalized_candidate_label  text         not null,
  inference_method            text         not null,
  rule_version                text         not null,
  raw                         jsonb        not null,

  constraint wwe_character_candidate_pkey primary key (capture_id, character_candidate_key),
  constraint wwe_character_candidate_normalized_uk
    unique (capture_id, normalized_candidate_label, inference_method),
  constraint wwe_character_candidate_key_nonblank_chk
    check (btrim(character_candidate_key) <> ''),
  constraint wwe_character_candidate_label_nonblank_chk check (btrim(candidate_label) <> ''),
  constraint wwe_character_candidate_normalized_nonblank_chk
    check (btrim(normalized_candidate_label) <> ''),
  constraint wwe_character_candidate_method_nonblank_chk
    check (btrim(inference_method) <> ''),
  constraint wwe_character_candidate_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_character_candidate_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_character_candidate is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. A character this pipeline reconstructed from '
  'submission free text and/or creative-side folder and tag labels. Fed by '
  'plm.wwe_submission_ip, plm.wwe_asset_folder and plm.wwe_asset_tag. Never promoted to '
  'core.character automatically and never presented as a source-declared fact.';

create table plm.wwe_character_evidence (
  capture_id              uuid         not null,
  character_candidate_key text         not null,
  evidence_key            text         not null,
  submission_number       text             null,
  folder_source_id        text             null,
  asset_source_id         text             null,
  evidence_type           text         not null,
  evidence_value          text         not null,
  match_method            text         not null,
  rule_version            text         not null,
  confidence              numeric(4,3) not null,
  relationship_truth      text         not null default 'inferred',
  raw                     jsonb        not null,

  constraint wwe_character_evidence_pkey
    primary key (capture_id, character_candidate_key, evidence_key),
  constraint wwe_character_evidence_candidate_fkey
    foreign key (capture_id, character_candidate_key)
    references plm.wwe_character_candidate (capture_id, character_candidate_key)
    on delete restrict,
  -- MATCH SIMPLE (the default): the FK is only checked when its own column is
  -- non-null. This row's capture_id is the SUBMISSIONS capture root (it must match
  -- plm.wwe_character_candidate's capture_id via the FK above, and character
  -- candidates are rooted on the submissions side per the file header), so a
  -- submission_ip anchor can be verified against the real wwe_submission row in the
  -- SAME capture scope, the same way plm.sega_character_evidence's anchor FKs work.
  --
  -- folder_source_id and asset_source_id CANNOT get the equivalent FK: those rows
  -- live under plm.wwe_creative_capture, a different capture-id namespace than this
  -- row's (submissions-rooted) capture_id, so a composite (capture_id, folder_source_id)
  -- FK could never match a real plm.wwe_asset_folder row. This is the identical
  -- dual-capture-root trade the *_property_inferred tables below already make and
  -- document. Those two anchors are still fully covered by
  -- wwe_character_evidence_folder_nonblank_chk / _asset_nonblank_chk and by
  -- wwe_character_evidence_type_anchor_chk below, which is what actually closed the
  -- blank-anchor and type/anchor-mismatch defects; they just cannot also be
  -- foreign-keyed to a same-capture parent.
  constraint wwe_character_evidence_submission_fkey
    foreign key (capture_id, submission_number)
    references plm.wwe_submission (capture_id, submission_number) on delete restrict,
  constraint wwe_character_evidence_type_chk
    check (evidence_type in ('submission_ip','asset_folder','asset_tag')),
  constraint wwe_character_evidence_truth_chk check (relationship_truth = 'inferred'),
  constraint wwe_character_evidence_confidence_chk check (confidence between 0 and 1),
  constraint wwe_character_evidence_key_nonblank_chk check (btrim(evidence_key) <> ''),
  constraint wwe_character_evidence_value_nonblank_chk check (btrim(evidence_value) <> ''),
  constraint wwe_character_evidence_method_nonblank_chk check (btrim(match_method) <> ''),
  constraint wwe_character_evidence_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_character_evidence_submission_nonblank_chk
    check (submission_number is null or btrim(submission_number) <> ''),
  constraint wwe_character_evidence_folder_nonblank_chk
    check (folder_source_id is null or btrim(folder_source_id) <> ''),
  constraint wwe_character_evidence_asset_nonblank_chk
    check (asset_source_id is null or btrim(asset_source_id) <> ''),
  -- Replaces a bare "exactly one anchor is NOT NULL" count, which an empty or
  -- whitespace string could satisfy without naming a real anchor. This ties the
  -- single populated, non-blank anchor to the evidence_type label itself, so a
  -- row cannot claim one type while its data actually anchors to another.
  constraint wwe_character_evidence_type_anchor_chk
    check (
      (evidence_type = 'submission_ip'
         and submission_number is not null and btrim(submission_number) <> ''
         and folder_source_id is null
         and asset_source_id is null)
      or (evidence_type = 'asset_folder'
         and folder_source_id is not null and btrim(folder_source_id) <> ''
         and submission_number is null
         and asset_source_id is null)
      or (evidence_type = 'asset_tag'
         and asset_source_id is not null and btrim(asset_source_id) <> ''
         and submission_number is null
         and folder_source_id is null)
    ),
  constraint wwe_character_evidence_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_character_evidence is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Why a plm.wwe_character_candidate row exists, '
  'anchored to exactly one non-blank submission, folder or asset value that must match '
  'evidence_type by CHECK. submission_number is additionally foreign-keyed to '
  'plm.wwe_submission (same submissions capture scope); folder_source_id and '
  'asset_source_id cannot be, because they live under the separate creative capture '
  'root -- see the constraint comment above. relationship_truth is pinned to '
  '''inferred'' by CHECK; no row here can claim portal-declared provenance.';

create table plm.wwe_character_property_inferred (
  capture_id              uuid         not null,
  character_candidate_key text         not null,
  property_source_id      text         not null,
  match_method            text         not null,
  rule_version            text         not null,
  confidence              numeric(4,3) not null,
  relationship_truth      text         not null default 'inferred',
  raw                     jsonb        not null,

  constraint wwe_character_property_inferred_pkey
    primary key (capture_id, character_candidate_key, property_source_id),
  constraint wwe_character_property_inferred_candidate_fkey
    foreign key (capture_id, character_candidate_key)
    references plm.wwe_character_candidate (capture_id, character_candidate_key)
    on delete restrict,
  constraint wwe_character_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint wwe_character_property_inferred_truth_chk
    check (relationship_truth = 'inferred'),
  constraint wwe_character_property_inferred_confidence_chk
    check (confidence between 0 and 1),
  constraint wwe_character_property_inferred_method_nonblank_chk
    check (btrim(match_method) <> ''),
  constraint wwe_character_property_inferred_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_character_property_inferred_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_character_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. property_source_id is checked non-blank, not '
  'foreign-keyed to plm.wwe_property -- see file header on why these tables carry no '
  'single-capture foreign key into the property-identity table.';

create table plm.wwe_asset_property_inferred (
  capture_id          uuid         not null,
  asset_source_id     text         not null,
  property_source_id  text         not null,
  match_method        text         not null,
  rule_version        text         not null,
  confidence          numeric(4,3) not null,
  relationship_truth  text         not null default 'inferred',
  raw                 jsonb        not null,

  constraint wwe_asset_property_inferred_pkey
    primary key (capture_id, asset_source_id, property_source_id),
  constraint wwe_asset_property_inferred_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.wwe_asset (capture_id, asset_source_id) on delete restrict,
  constraint wwe_asset_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint wwe_asset_property_inferred_truth_chk check (relationship_truth = 'inferred'),
  constraint wwe_asset_property_inferred_confidence_chk check (confidence between 0 and 1),
  constraint wwe_asset_property_inferred_method_nonblank_chk check (btrim(match_method) <> ''),
  constraint wwe_asset_property_inferred_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_asset_property_inferred_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. asset_source_id is foreign-keyed within the same '
  'creative capture; property_source_id is checked non-blank only -- see file header.';

create table plm.wwe_style_guide_property_inferred (
  capture_id           uuid         not null,
  guideline_source_id  text         not null,
  property_source_id   text         not null,
  match_method         text         not null,
  rule_version         text         not null,
  confidence           numeric(4,3) not null,
  relationship_truth   text         not null default 'inferred',
  raw                  jsonb        not null,

  constraint wwe_style_guide_property_inferred_pkey
    primary key (capture_id, guideline_source_id, property_source_id),
  constraint wwe_style_guide_property_inferred_guide_fkey
    foreign key (capture_id, guideline_source_id)
    references plm.wwe_style_guide (capture_id, guideline_source_id) on delete restrict,
  constraint wwe_style_guide_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint wwe_style_guide_property_inferred_truth_chk
    check (relationship_truth = 'inferred'),
  constraint wwe_style_guide_property_inferred_confidence_chk
    check (confidence between 0 and 1),
  constraint wwe_style_guide_property_inferred_method_nonblank_chk
    check (btrim(match_method) <> ''),
  constraint wwe_style_guide_property_inferred_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_style_guide_property_inferred_raw_obj_chk
    check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_style_guide_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. guideline_source_id is foreign-keyed within the '
  'same creative capture; property_source_id is checked non-blank only -- see header.';

create table plm.wwe_asset_style_guide_inferred (
  capture_id           uuid         not null,
  asset_source_id      text         not null,
  guideline_source_id  text         not null,
  match_method         text         not null,
  rule_version         text         not null,
  confidence           numeric(4,3) not null,
  relationship_truth   text         not null default 'inferred',
  raw                  jsonb        not null,

  constraint wwe_asset_style_guide_inferred_pkey
    primary key (capture_id, asset_source_id, guideline_source_id),
  constraint wwe_asset_style_guide_inferred_asset_fkey
    foreign key (capture_id, asset_source_id)
    references plm.wwe_asset (capture_id, asset_source_id) on delete restrict,
  constraint wwe_asset_style_guide_inferred_guide_fkey
    foreign key (capture_id, guideline_source_id)
    references plm.wwe_style_guide (capture_id, guideline_source_id) on delete restrict,
  constraint wwe_asset_style_guide_inferred_truth_chk check (relationship_truth = 'inferred'),
  constraint wwe_asset_style_guide_inferred_confidence_chk check (confidence between 0 and 1),
  constraint wwe_asset_style_guide_inferred_method_nonblank_chk check (btrim(match_method) <> ''),
  constraint wwe_asset_style_guide_inferred_rule_version_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint wwe_asset_style_guide_inferred_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wwe_asset_style_guide_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Both sides (asset, style guide) are '
  'foreign-keyed within the same creative capture -- this table needs no cross-capture '
  'text-only identity, unlike the *_property_inferred tables above.';


-- =====================================================================================
-- INDEXES.
--
-- A composite primary key is indexed left-to-right, so (capture_id, X) lookups are
-- already covered. What is not covered is the reverse direction of every composite
-- foreign key, plus source_hash / normalized-label lookups.
-- =====================================================================================

create index idx_wwe_submission_capture_status
  on plm.wwe_submission_capture (status, source_captured_at desc);
create index idx_wwe_creative_capture_status
  on plm.wwe_creative_capture (status, source_captured_at desc);

create index idx_wwe_contract_capture             on plm.wwe_contract (capture_id);
create index idx_wwe_property_capture             on plm.wwe_property (capture_id);
create index idx_wwe_property_source_hash         on plm.wwe_property (source_hash);
create index idx_wwe_property_parent
  on plm.wwe_property (capture_id, parent_property_source_id);
create index idx_wwe_contract_property_property
  on plm.wwe_contract_property (capture_id, property_source_id);
create index idx_wwe_product_entitlement_capture  on plm.wwe_product_entitlement (capture_id);
create index idx_wwe_product_entitlement_contract
  on plm.wwe_product_entitlement (capture_id, contract_source_id);
create index idx_wwe_product_entitlement_property
  on plm.wwe_product_entitlement (capture_id, property_source_id);
create index idx_wwe_submission_capture          on plm.wwe_submission (capture_id);
create index idx_wwe_submission_status           on plm.wwe_submission (status);
create index idx_wwe_submission_ip_submission
  on plm.wwe_submission_ip (capture_id, submission_number);
create index idx_wwe_submission_ip_normalized
  on plm.wwe_submission_ip (normalized_ip_label);
create index idx_wwe_submission_stage_submission
  on plm.wwe_submission_stage (capture_id, submission_number);
create index idx_wwe_submission_image_submission
  on plm.wwe_submission_image (capture_id, submission_number);
create index idx_wwe_submission_comment_submission
  on plm.wwe_submission_comment (capture_id, submission_number);

create index idx_wwe_creative_brand_capture on plm.wwe_creative_brand (capture_id);
create index idx_wwe_style_guide_capture    on plm.wwe_style_guide (capture_id);
create index idx_wwe_style_guide_brand
  on plm.wwe_style_guide (capture_id, brand_source_id);
create index idx_wwe_style_guide_page_guide
  on plm.wwe_style_guide_page (capture_id, guideline_source_id);
create index idx_wwe_asset_library_capture  on plm.wwe_asset_library (capture_id);
create index idx_wwe_asset_library_brand
  on plm.wwe_asset_library (capture_id, brand_source_id);
create index idx_wwe_asset_folder_capture   on plm.wwe_asset_folder (capture_id);
create index idx_wwe_asset_folder_parent
  on plm.wwe_asset_folder (capture_id, parent_folder_source_id);
create index idx_wwe_asset_folder_path      on plm.wwe_asset_folder (capture_id, folder_path);
create index idx_wwe_asset_capture          on plm.wwe_asset (capture_id);
create index idx_wwe_asset_source_hash      on plm.wwe_asset (source_hash);
create index idx_wwe_asset_library
  on plm.wwe_asset (capture_id, library_source_id);
create index idx_wwe_asset_folder_member_folder
  on plm.wwe_asset_folder_member (capture_id, folder_source_id);
create index idx_wwe_tag_capture            on plm.wwe_tag (capture_id);
create index idx_wwe_tag_normalized         on plm.wwe_tag (normalized_tag_label);
create index idx_wwe_asset_tag_tag
  on plm.wwe_asset_tag (capture_id, tag_source_key);

create index idx_wwe_character_candidate_capture
  on plm.wwe_character_candidate (capture_id);
create index idx_wwe_character_candidate_normalized
  on plm.wwe_character_candidate (normalized_candidate_label);
create index idx_wwe_character_evidence_candidate
  on plm.wwe_character_evidence (capture_id, character_candidate_key);
create index idx_wwe_character_evidence_submission
  on plm.wwe_character_evidence (capture_id, submission_number)
  where submission_number is not null;
create index idx_wwe_character_evidence_folder
  on plm.wwe_character_evidence (capture_id, folder_source_id)
  where folder_source_id is not null;
create index idx_wwe_character_evidence_asset
  on plm.wwe_character_evidence (capture_id, asset_source_id)
  where asset_source_id is not null;
create index idx_wwe_character_property_inferred_candidate
  on plm.wwe_character_property_inferred (capture_id, character_candidate_key);
create index idx_wwe_character_property_inferred_property
  on plm.wwe_character_property_inferred (capture_id, property_source_id);
create index idx_wwe_asset_property_inferred_asset
  on plm.wwe_asset_property_inferred (capture_id, asset_source_id);
create index idx_wwe_asset_property_inferred_property
  on plm.wwe_asset_property_inferred (capture_id, property_source_id);
create index idx_wwe_style_guide_property_inferred_guide
  on plm.wwe_style_guide_property_inferred (capture_id, guideline_source_id);
create index idx_wwe_style_guide_property_inferred_property
  on plm.wwe_style_guide_property_inferred (capture_id, property_source_id);
create index idx_wwe_asset_style_guide_inferred_asset
  on plm.wwe_asset_style_guide_inferred (capture_id, asset_source_id);
create index idx_wwe_asset_style_guide_inferred_guide
  on plm.wwe_asset_style_guide_inferred (capture_id, guideline_source_id);
