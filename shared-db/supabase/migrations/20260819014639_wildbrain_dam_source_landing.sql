-- =====================================================================================
-- WildBrain DAM -- source landing schema (release 1).
--
-- Migration: 20260819014639_wildbrain_dam_source_landing.sql
-- Issue:     u2giants/shared-db #1197
-- Claim:     u2giants/shared-db #1209 -- 11 tables + 2 functions. Nothing else.
-- Ruling:    AGENTS.md 6.13 ruling 1 -- PER-LICENSOR landing tables. This migration does
--            not extend any existing licensor's tables and adds no shared multi-licensor
--            landing table.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO WILDBRAIN VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The WildBrain extract is licensed source
-- data held in the PRIVATE repo u2giants/licensor-source-data. No WildBrain property,
-- era, character, guide, keyword, asset, file name or raw payload value may ever appear
-- in this file, in a contract test, in CI output, or in a pull request or issue on this
-- repository.
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime from the private loader, which reads the private repo and
-- writes through the two functions and the INSERT grants below. The contract tests in
-- supabase/tests/wildbrain_landing_contracts.sql use INVENTED fixture values only.
--
-- WHAT THIS IS
--   A lossless, append-only, capture-scoped landing of one WildBrain DAM capture. Every
--   source table is keyed by `capture_id`, so a refresh ADDS a snapshot and never
--   overwrites or deletes the previous one. Typed columns make the common queries easy;
--   the `raw` column on every table prevents source loss when the portal changes.
--   Nothing here is canonical.
--
-- WHAT THIS DELIBERATELY IS NOT
--   It creates, renames, updates, merges and deletes NOTHING in core.* or dam.*. There
--   is no reconciliation column to fill and no api.* view: raw portal metadata and file
--   names are licensed material and need an explicit access decision first. The runtime
--   loader lives in the private repository, not here.
--
-- Depends on (exact 14-digit versions):
--   20260621150714  foundation  -- schema plm
--   20260810180000  plm_default_privilege_hole_and_pg17_maintain_revokes -- narrows the
--                   plm schema default privileges to insert/select/update/delete. Every
--                   table created below is therefore BORN holding UPDATE and DELETE for
--                   service_role, and the privilege block at the end of this file is
--                   what actually removes them. Without it the append-only guarantee
--                   below would be decoration -- exactly the defect that migration
--                   20260810080000 had to be written to fix for the NBCU landing.
--
-- -------------------------------------------------------------------------------------
-- THREE PROPERTIES OF THIS SOURCE DRIVE THE SHAPE. Each has burned a licensor load
-- before. Do not "fix" any of them without reading the reason.
--
--   1. THE PORTAL HAS NO STYLE-GUIDE OBJECT. No id, no record, no parent link. A guide's
--      identity is free text typed into a keyword field, comma separated, with workflow
--      status words mixed into the same list. Every guide row is therefore RECONSTRUCTED
--      BY US, not read. plm.wildbrain_guide, plm.wildbrain_guide_alias and
--      plm.wildbrain_asset_guide are structurally separate from the portal-declared
--      tables and every one of them carries relationship_truth = 'inferred', pinned by a
--      CHECK. They must never be presented as portal master records, and they must never
--      be promoted into a canonical style guide without a business ruling.
--
--   2. THE LICENSOR'S OWN DATA CONTAINS SPELLING VARIANTS THAT COLLIDE. Deduplication is
--      a requirement of this schema, not a later cleanup: guide_key is the case-folded,
--      whitespace-collapsed, quote-stripped label and is the primary key, so case
--      variants collapse on landing. Every raw spelling survives in
--      plm.wildbrain_guide_alias with its asset count, which is what makes the
--      deduplication auditable and reversible instead of lossy. Guides that differ by
--      MORE than case -- a genuine typo, a near-duplicate wording -- stay SEPARATE ROWS.
--      Merging those is a business ruling and is out of scope here.
--
--   3. CHARACTER IDENTITY IS THE NUMERIC SOURCE ID, NEVER THE NAME. Character ids appear
--      on assets that the portal's own character dictionary does not contain, and
--      several of those are lowercase or misspelled twins of dictionary entries that DO
--      exist -- so the NAMES COLLIDE. plm.wildbrain_character therefore has NO unique
--      constraint on the normalized label, deliberately, and there is NO constraint
--      requiring an asset character to be in the dictionary. Either one would reject a
--      valid capture. `in_source_dictionary = false` records the licensor defect as
--      evidence, and it is explicitly NOT a rejection condition in the finalize gate.
--
-- IMMUTABILITY IS PRIVILEGE SEPARATION, NOT TRIGGERS. Same ruling as the NBCU landing.
--   service_role gets SELECT + INSERT and NOT update/delete on the ten snapshot tables,
--   and SELECT ONLY on plm.wildbrain_capture. Rows are immutable from the instant they
--   land. Retry safety is `on conflict do nothing`, which needs no UPDATE privilege and
--   is exactly idempotent because a capture's source bytes are pinned by
--   source_commit_sha + source_manifest_sha256. The resulting privileges are readable in
--   information_schema.role_table_grants, so a test can assert the GUARANTEE rather than
--   assert that some guard code exists. A BEFORE trigger in this database once read a
--   GENERATED ... STORED column that Postgres had not populated yet, saw NULL, never
--   fired, and never raised. Privilege separation fails closed.
--
-- SCOPE LIMIT THE LOADER ENFORCES, RECORDED HERE SO IT IS NOT LOST. The licensee account
--   sees exactly ONE property. The portal's dictionaries also expose brands, franchises
--   and characters belonging to unlicensed WildBrain IP with no assets behind them.
--   Those are NOT loaded. plm.wildbrain_era holds one root plus its descendants;
--   plm.wildbrain_character holds only characters evidenced on captured assets. This is
--   a loader responsibility -- a CHECK cannot see what was left out -- and it is stated
--   here so a future session does not "complete" the dictionaries.
-- =====================================================================================


-- =====================================================================================
-- 1. plm.wildbrain_capture -- one row per attempted full load. The root of every snapshot.
--
-- source_commit_sha vs read_commit_sha are TWO DIFFERENT FACTS and must not be collapsed.
-- source_commit_sha identifies the DATA -- the commit the extract was merged at.
-- read_commit_sha is the commit the loader actually had checked out when it read the
-- bytes, which can be a later commit that changed only documentation.
--
-- pagination_verified IS LOAD-BEARING, NOT CEREMONY. The portal's API accepts and
-- SILENTLY IGNORES every offset parameter, returning the first page with HTTP 200
-- forever. A broken pager therefore produces a plausible-looking SHORT capture with no
-- error anywhere. The flag is set only after the scraper has proved unique row counts
-- against the portal's own reported total, and plm.finalize_wildbrain_capture refuses to
-- publish without it.
--
-- WHY pagination_verified AND reported_total ARE ARGUMENTS TO begin_, NOT SET LATER:
-- service_role holds SELECT ONLY on this table, so nothing can UPDATE a capture row
-- outside the two security-definer functions, and finalize_'s signature is fixed by the
-- issue at (capture_id, observed_counts, error_summary). The paging proof is produced by
-- the scrape, which happens BEFORE the load, so the loader passes it in at begin_ time
-- and a resume may refresh it while the capture is still `loading`. It is loader-reported
-- evidence, not capture identity: it is deliberately NOT part of the same-key identity
-- comparison in begin_wildbrain_capture.
-- =====================================================================================
create table plm.wildbrain_capture (
  id                     uuid        primary key default gen_random_uuid(),
  capture_key            text        not null unique,
  source_repository      text        not null,
  source_commit_sha      text        not null,
  read_commit_sha        text            null,
  source_manifest_sha256 text        not null,
  portal_base_url        text        not null,
  source_captured_at     timestamptz not null,
  load_started_at        timestamptz not null default now(),
  load_completed_at      timestamptz     null,
  status                 text        not null default 'loading',
  expected_counts        jsonb       not null,
  observed_counts        jsonb       not null default '{}'::jsonb,
  media_downloaded       integer     not null default 0,
  pagination_verified    boolean     not null default false,
  reported_total         integer         null,
  truncated_child_lists  integer     not null default 0,
  error_summary          jsonb       not null default '[]'::jsonb,
  raw_summary            jsonb       not null,
  created_by             text        not null,

  constraint wildbrain_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint wildbrain_capture_key_nonblank_chk
    check (btrim(capture_key) <> ''),
  constraint wildbrain_capture_repository_nonblank_chk
    check (btrim(source_repository) <> ''),
  constraint wildbrain_capture_portal_base_url_nonblank_chk
    check (btrim(portal_base_url) <> ''),
  constraint wildbrain_capture_created_by_nonblank_chk
    check (btrim(created_by) <> ''),
  constraint wildbrain_capture_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint wildbrain_capture_read_sha_chk
    check (read_commit_sha is null or read_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint wildbrain_capture_manifest_sha_chk
    check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  -- Scope guards, not style preferences. This project may never download media, and a
  -- capture whose child lists were truncated is not a capture -- it is a partial crawl,
  -- and landing a partial crawl as if it were complete is the failure mode this whole
  -- design exists to prevent. Both are constrained to zero, not merely defaulted.
  constraint wildbrain_capture_media_zero_chk
    check (media_downloaded = 0),
  constraint wildbrain_capture_truncated_zero_chk
    check (truncated_child_lists = 0),
  constraint wildbrain_capture_reported_total_nonneg_chk
    check (reported_total is null or reported_total >= 0),
  -- The four preconditions of `complete`, enforced on the row itself so that no future
  -- write path -- not just the finalize function -- can publish a capture that failed
  -- them. `truncated_child_lists` and `media_downloaded` are already pinned to zero
  -- above, so the remaining conditional preconditions are the completion time, the
  -- paging proof and an empty error list.
  constraint wildbrain_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint wildbrain_capture_complete_pagination_chk
    check (status <> 'complete' or pagination_verified),
  constraint wildbrain_capture_complete_no_errors_chk
    check (status <> 'complete' or error_summary = '[]'::jsonb),
  constraint wildbrain_capture_expected_counts_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint wildbrain_capture_observed_counts_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint wildbrain_capture_error_summary_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint wildbrain_capture_raw_summary_obj_chk
    check (jsonb_typeof(raw_summary) = 'object')
);

comment on table plm.wildbrain_capture is
  'One row per attempted full WildBrain DAM load. Append-only snapshot root: a refresh '
  'adds a new capture and NEVER edits or deletes an earlier one. Only '
  'plm.begin_wildbrain_capture and plm.finalize_wildbrain_capture may write here -- '
  'service_role holds SELECT only. A rejected capture stays as immutable evidence and '
  'never replaces the latest complete capture.';
comment on column plm.wildbrain_capture.source_commit_sha is
  'The private-repo commit that identifies the DATA. capture_key is built from this.';
comment on column plm.wildbrain_capture.read_commit_sha is
  'The private-repo commit the loader actually had checked out. May be LATER than '
  'source_commit_sha when only documentation changed. A separate fact; do not collapse.';
comment on column plm.wildbrain_capture.pagination_verified is
  'TRUE only after the scraper proved unique row counts against the portal''s own '
  'reported total. The portal accepts and SILENTLY IGNORES offset parameters, returning '
  'page one with HTTP 200 forever, so a broken pager yields a plausible short capture '
  'with no error. finalize_wildbrain_capture refuses to publish without this.';
comment on column plm.wildbrain_capture.reported_total is
  'The total the portal itself reported for the capture scope, kept as the counterpart '
  'evidence for pagination_verified. Nullable: a portal that reports no total is a '
  'reason to look, not a reason to fabricate a number.';
comment on column plm.wildbrain_capture.media_downloaded is
  'Hard zero. Constrained, not merely defaulted: storing WildBrain media bytes is out of '
  'scope for this database.';
comment on column plm.wildbrain_capture.truncated_child_lists is
  'Hard zero. A capture with a truncated child list is a partial crawl and is not '
  'landable at all.';
comment on column plm.wildbrain_capture.status is
  'loading -> complete | rejected. NOTE: ''abandoned'' is permitted by the CHECK but no '
  'function in release 1 sets it -- flagged, not invented.';


-- =====================================================================================
-- 2. plm.wildbrain_era -- THE PROPERTY AXIS.
--
-- This is the portal's own property field, and it is a REAL DECLARED HIERARCHY, not a
-- path string that happens to contain separators. The parent link is therefore a
-- composite self-referencing foreign key inside the capture, so an era can never point
-- at a parent from a different snapshot.
--
-- DEFERRABLE INITIALLY DEFERRED because a loader that inserts the subtree in one
-- statement, or in child-before-parent order, is doing nothing wrong; the constraint
-- only has to hold at commit. It is NOT weakened -- an unresolved parent still aborts
-- the transaction, and plm.finalize_wildbrain_capture re-asserts the same fact so a
-- future migration that weakened this constraint would be caught at the publication gate.
--
-- Only some of the loaded eras are referenced by an asset; the rest are licensed
-- siblings with no assets in this portal. That is expected and must not fail validation.
-- =====================================================================================
create table plm.wildbrain_era (
  capture_id            uuid    not null references plm.wildbrain_capture(id) on delete restrict,
  era_source_id         text    not null,
  parent_era_source_id  text        null,
  era_label             text    not null,
  normalized_era_label  text    not null,
  is_root               boolean not null,
  raw                   jsonb   not null,

  constraint wildbrain_era_pkey primary key (capture_id, era_source_id),
  constraint wildbrain_era_normalized_label_uk unique (capture_id, normalized_era_label),
  constraint wildbrain_era_parent_fk
    foreign key (capture_id, parent_era_source_id)
    references plm.wildbrain_era (capture_id, era_source_id)
    on delete restrict
    deferrable initially deferred,
  constraint wildbrain_era_not_self_parent_chk
    check (parent_era_source_id is distinct from era_source_id),
  constraint wildbrain_era_root_matches_parent_chk
    check (is_root = (parent_era_source_id is null)),
  constraint wildbrain_era_source_id_nonblank_chk check (btrim(era_source_id) <> ''),
  constraint wildbrain_era_parent_id_nonblank_chk
    check (parent_era_source_id is null or btrim(parent_era_source_id) <> ''),
  constraint wildbrain_era_label_nonblank_chk check (btrim(era_label) <> ''),
  constraint wildbrain_era_normalized_label_nonblank_chk check (btrim(normalized_era_label) <> ''),
  constraint wildbrain_era_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

-- ONE ROOT PER CAPTURE, ENFORCED. The licensee account sees exactly ONE property, so a
-- capture holding two roots is either a second, unlicensed tree that leaked into the
-- crawl or a broken parent link that turned a child into a root. Neither is landable, and
-- neither is caught by anything else here: the composite self-FK only stops a
-- cross-capture parent, and the self-parent CHECK only stops A -> A. Both wrong shapes
-- also satisfy expected_counts, so without this the capture would publish clean.
-- A partial unique index is the only way Postgres expresses "unique among the rows where
-- is_root" -- a table constraint cannot carry a WHERE clause. Written NOT CONCURRENTLY on
-- purpose: this table is empty at migration time and CREATE INDEX CONCURRENTLY cannot run
-- inside the migration transaction.
create unique index wildbrain_era_one_root_per_capture_uk
  on plm.wildbrain_era (capture_id) where is_root;

comment on index plm.wildbrain_era_one_root_per_capture_uk is
  'A capture may hold at most ONE root era. A second root means a second, unlicensed '
  'tree was crawled or a parent link was lost; both would otherwise publish clean.';

comment on table plm.wildbrain_era is
  'The portal''s property axis: one licensed root era and its descendants, as a DECLARED '
  'hierarchy. Rows for other WildBrain franchises are out of scope for this database and '
  'are not loaded. The parent link is a composite self-FK inside the capture, deferrable '
  'so insert order does not matter, and is re-asserted by the finalize gate.';
comment on column plm.wildbrain_era.is_root is
  'Pinned by CHECK to (parent_era_source_id is null). It is a readable convenience, not '
  'an independent fact that could disagree with the parent link.';


-- =====================================================================================
-- 3. plm.wildbrain_creative_group -- the KIND of guide a file belongs to.
--
-- Distinct from an individual guide, which the portal does not model at all. Do not
-- confuse the two: this one HAS a source id, so it is portal-declared fact; an
-- individual guide has none and lives in the reconstructed tables further down.
-- =====================================================================================
create table plm.wildbrain_creative_group (
  capture_id                        uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  creative_group_source_id          text  not null,
  creative_group_label              text  not null,
  normalized_creative_group_label   text  not null,
  raw                               jsonb not null,

  constraint wildbrain_creative_group_pkey primary key (capture_id, creative_group_source_id),
  constraint wildbrain_creative_group_normalized_label_uk
    unique (capture_id, normalized_creative_group_label),
  constraint wildbrain_creative_group_source_id_nonblank_chk
    check (btrim(creative_group_source_id) <> ''),
  constraint wildbrain_creative_group_label_nonblank_chk
    check (btrim(creative_group_label) <> ''),
  constraint wildbrain_creative_group_normalized_label_nonblank_chk
    check (btrim(normalized_creative_group_label) <> ''),
  constraint wildbrain_creative_group_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wildbrain_creative_group is
  'Portal-declared creative group: the KIND of guide a file belongs to. NOT an individual '
  'style guide -- the portal has no object for that (see plm.wildbrain_guide).';


-- =====================================================================================
-- 4. plm.wildbrain_asset_category -- portal-declared asset category.
-- =====================================================================================
create table plm.wildbrain_asset_category (
  capture_id                       uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  asset_category_source_id         text  not null,
  asset_category_label             text  not null,
  normalized_asset_category_label  text  not null,
  raw                              jsonb not null,

  constraint wildbrain_asset_category_pkey primary key (capture_id, asset_category_source_id),
  constraint wildbrain_asset_category_normalized_label_uk
    unique (capture_id, normalized_asset_category_label),
  constraint wildbrain_asset_category_source_id_nonblank_chk
    check (btrim(asset_category_source_id) <> ''),
  constraint wildbrain_asset_category_label_nonblank_chk
    check (btrim(asset_category_label) <> ''),
  constraint wildbrain_asset_category_normalized_label_nonblank_chk
    check (btrim(normalized_asset_category_label) <> ''),
  constraint wildbrain_asset_category_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wildbrain_asset_category is
  'Portal-declared asset category. Only entries actually referenced by a captured asset '
  'are loaded; the portal''s wider dictionary is out of scope.';


-- =====================================================================================
-- 5. plm.wildbrain_asset_nature -- file type AS THE PORTAL CLASSIFIES IT.
--
-- No unique constraint on the label, on purpose and unlike its sibling dictionaries: the
-- issue specifies identity by source id alone here, and this is the dictionary most
-- likely to carry two ids for one human-readable file-type name.
-- =====================================================================================
create table plm.wildbrain_asset_nature (
  capture_id               uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  asset_nature_source_id   text  not null,
  asset_nature_label       text  not null,
  media_type               text      null,
  raw                      jsonb not null,

  constraint wildbrain_asset_nature_pkey primary key (capture_id, asset_nature_source_id),
  constraint wildbrain_asset_nature_source_id_nonblank_chk
    check (btrim(asset_nature_source_id) <> ''),
  constraint wildbrain_asset_nature_label_nonblank_chk
    check (btrim(asset_nature_label) <> ''),
  constraint wildbrain_asset_nature_media_type_nonblank_chk
    check (media_type is null or btrim(media_type) <> ''),
  constraint wildbrain_asset_nature_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wildbrain_asset_nature is
  'Portal-declared file type. media_type is the portal''s OWN MIME string where present '
  'and is not derived, corrected or inferred by this database.';


-- =====================================================================================
-- 6. plm.wildbrain_character -- identity is the NUMERIC SOURCE ID, never the name.
--
-- READ THE `in_source_dictionary` COMMENT BEFORE ADDING ANY CONSTRAINT HERE.
--
-- There is deliberately NO unique constraint on normalized_character_label. The portal
-- issues distinct ids to entries whose names differ only by case or spelling, and BOTH
-- are live on assets. A unique label constraint would reject a valid capture. The
-- normalized label gets a plain INDEX instead, for lookup, which asserts nothing.
-- =====================================================================================
create table plm.wildbrain_character (
  capture_id                  uuid    not null references plm.wildbrain_capture(id) on delete restrict,
  character_source_id         text    not null,
  character_label             text    not null,
  normalized_character_label  text    not null,
  in_source_dictionary        boolean not null,
  raw                         jsonb   not null,

  constraint wildbrain_character_pkey primary key (capture_id, character_source_id),
  constraint wildbrain_character_source_id_nonblank_chk
    check (btrim(character_source_id) <> ''),
  constraint wildbrain_character_label_nonblank_chk
    check (btrim(character_label) <> ''),
  constraint wildbrain_character_normalized_label_nonblank_chk
    check (btrim(normalized_character_label) <> ''),
  constraint wildbrain_character_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

create index idx_wildbrain_character_normalized_label
  on plm.wildbrain_character (capture_id, normalized_character_label);

comment on table plm.wildbrain_character is
  'WildBrain character identities. IDENTITY IS character_source_id AND NOTHING ELSE. '
  'There is NO unique constraint on the normalized label, deliberately: the portal issues '
  'distinct ids to name-twins that differ only by case or spelling and both are live on '
  'assets, so a unique label would reject a valid capture. Only characters evidenced on a '
  'captured asset are loaded.';
comment on column plm.wildbrain_character.in_source_dictionary is
  'FALSE records a character used on an asset that the portal''s OWN dictionary does not '
  'contain. That is a licensor defect preserved as evidence, not a loader error. There is '
  'no constraint requiring an asset character to resolve against the dictionary -- such a '
  'constraint would reject a valid capture -- and finalize_wildbrain_capture explicitly '
  'does NOT treat these rows as a rejection condition.';


-- =====================================================================================
-- 7. plm.wildbrain_asset -- the captured assets.
--
-- era_source_id is NOT NULL: every asset in this portal carries exactly ONE property,
-- and a capture where that is untrue is not loadable. That single-valued era is also
-- what makes property-to-character unambiguous here -- it is derivable by joining
-- plm.wildbrain_asset_character through the asset. That is a real structural difference
-- from the Disney DCP Vault source, where two independent arrays on one asset were paired
-- and the links were fabricated. It is not a judgement call, and it is why no separate
-- property-to-character table exists in this landing.
--
-- raw_keyword_text preserves the UNPARSED keyword string verbatim, so the guide
-- reconstruction can be re-derived or corrected without re-scraping the portal.
--
-- NO MEDIA BYTE, BASE64 OR DOWNLOAD-PATH COLUMN IS ALLOWED HERE. Do not add one.
-- =====================================================================================
create table plm.wildbrain_asset (
  capture_id                uuid        not null references plm.wildbrain_capture(id) on delete restrict,
  asset_source_id           text        not null,
  asset_uuid                text        not null,
  asset_name                text        not null,
  original_file_name        text            null,
  era_source_id             text        not null,
  creative_group_source_id  text            null,
  asset_category_source_id  text            null,
  asset_nature_source_id    text            null,
  universe_label            text        not null,
  raw_keyword_text          text            null,
  source_created_at         timestamptz     null,
  source_modified_at        timestamptz     null,
  file_size_bytes           bigint          null,
  page_count                integer         null,
  source_hash               text        not null,
  raw                       jsonb       not null,

  constraint wildbrain_asset_pkey primary key (capture_id, asset_source_id),
  constraint wildbrain_asset_uuid_uk unique (capture_id, asset_uuid),

  -- Composite FKs: an asset can never reference a dictionary row from a different
  -- snapshot. The three nullable ones use the default MATCH SIMPLE, so a NULL reference
  -- is simply absent rather than an error -- the portal does leave them unset.
  constraint wildbrain_asset_era_fk
    foreign key (capture_id, era_source_id)
    references plm.wildbrain_era (capture_id, era_source_id) on delete restrict,
  constraint wildbrain_asset_creative_group_fk
    foreign key (capture_id, creative_group_source_id)
    references plm.wildbrain_creative_group (capture_id, creative_group_source_id) on delete restrict,
  constraint wildbrain_asset_category_fk
    foreign key (capture_id, asset_category_source_id)
    references plm.wildbrain_asset_category (capture_id, asset_category_source_id) on delete restrict,
  constraint wildbrain_asset_nature_fk
    foreign key (capture_id, asset_nature_source_id)
    references plm.wildbrain_asset_nature (capture_id, asset_nature_source_id) on delete restrict,

  constraint wildbrain_asset_source_id_nonblank_chk check (btrim(asset_source_id) <> ''),
  constraint wildbrain_asset_uuid_nonblank_chk check (btrim(asset_uuid) <> ''),
  constraint wildbrain_asset_name_nonblank_chk check (btrim(asset_name) <> ''),
  constraint wildbrain_asset_original_file_name_nonblank_chk
    check (original_file_name is null or btrim(original_file_name) <> ''),
  constraint wildbrain_asset_era_source_id_nonblank_chk check (btrim(era_source_id) <> ''),
  constraint wildbrain_asset_creative_group_id_nonblank_chk
    check (creative_group_source_id is null or btrim(creative_group_source_id) <> ''),
  constraint wildbrain_asset_category_id_nonblank_chk
    check (asset_category_source_id is null or btrim(asset_category_source_id) <> ''),
  constraint wildbrain_asset_nature_id_nonblank_chk
    check (asset_nature_source_id is null or btrim(asset_nature_source_id) <> ''),
  constraint wildbrain_asset_universe_label_nonblank_chk check (btrim(universe_label) <> ''),
  constraint wildbrain_asset_source_hash_nonblank_chk check (btrim(source_hash) <> ''),
  -- raw_keyword_text may be an EMPTY STRING: an asset with no keywords is a real,
  -- correct outcome in this source and must land, so this column is exempt from the
  -- non-blank rule that applies to identifiers and labels.
  constraint wildbrain_asset_file_size_nonneg_chk
    check (file_size_bytes is null or file_size_bytes >= 0),
  constraint wildbrain_asset_page_count_nonneg_chk
    check (page_count is null or page_count >= 0),
  constraint wildbrain_asset_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

create index idx_wildbrain_asset_era
  on plm.wildbrain_asset (capture_id, era_source_id);
create index idx_wildbrain_asset_creative_group
  on plm.wildbrain_asset (capture_id, creative_group_source_id)
  where creative_group_source_id is not null;
create index idx_wildbrain_asset_category
  on plm.wildbrain_asset (capture_id, asset_category_source_id)
  where asset_category_source_id is not null;
create index idx_wildbrain_asset_nature
  on plm.wildbrain_asset (capture_id, asset_nature_source_id)
  where asset_nature_source_id is not null;

comment on table plm.wildbrain_asset is
  'Captured WildBrain assets. era_source_id is NOT NULL because every asset in this portal '
  'carries exactly one property; a capture where that is untrue is not loadable. NO media '
  'byte, base64 or download-path column is permitted on this table.';
comment on column plm.wildbrain_asset.raw_keyword_text is
  'The UNPARSED keyword string, verbatim. This is what lets the reconstructed guide rows be '
  're-derived or corrected without re-scraping. May be empty or NULL: an asset with no '
  'keywords produces NO plm.wildbrain_asset_guide row, and that is a correct outcome, not '
  'missing data -- the portal offers no way to attribute such an asset to any guide.';
comment on column plm.wildbrain_asset.universe_label is
  'The portal''s own universe label for the asset, stored as given. Not reconciled.';


-- =====================================================================================
-- 8. plm.wildbrain_asset_character -- PORTAL-DECLARED.
--
-- The primary key IS the deduplication: an asset that lists the same character twice
-- collapses to one row. relationship_truth is pinned to 'declared' by CHECK so this table
-- can never be reused to hold something we inferred.
--
-- The FK to plm.wildbrain_character resolves against the CAPTURE's character table, which
-- includes the in_source_dictionary = false rows the loader adds for characters the portal
-- omitted from its own dictionary. There is deliberately no constraint tying these rows to
-- the dictionary itself.
-- =====================================================================================
create table plm.wildbrain_asset_character (
  capture_id           uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  asset_source_id      text  not null,
  character_source_id  text  not null,
  relationship_truth   text  not null default 'declared',
  raw                  jsonb not null,

  constraint wildbrain_asset_character_pkey
    primary key (capture_id, asset_source_id, character_source_id),
  constraint wildbrain_asset_character_asset_fk
    foreign key (capture_id, asset_source_id)
    references plm.wildbrain_asset (capture_id, asset_source_id) on delete restrict,
  constraint wildbrain_asset_character_character_fk
    foreign key (capture_id, character_source_id)
    references plm.wildbrain_character (capture_id, character_source_id) on delete restrict,
  constraint wildbrain_asset_character_truth_chk check (relationship_truth = 'declared'),
  constraint wildbrain_asset_character_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

create index idx_wildbrain_asset_character_character
  on plm.wildbrain_asset_character (capture_id, character_source_id);

comment on table plm.wildbrain_asset_character is
  'Asset-to-character links AS DECLARED BY THE PORTAL. The primary key is the '
  'deduplication. relationship_truth is pinned to ''declared'' -- nothing inferred may '
  'ever be stored here. Property-to-character is derivable from this table joined through '
  'the asset''s single era; it is NOT stored as an independent fact.';


-- =====================================================================================
-- 9. plm.wildbrain_guide -- RECONSTRUCTED BY US, deduplicated. NOT a portal record.
--
-- The portal has no style-guide object at all. These rows are parsed out of the asset
-- keyword field, so relationship_truth is pinned to 'inferred' and derivation_method is
-- pinned to 'keyword_field_split'. rule_version records WHICH parse produced the row, so
-- a corrected parse is a new capture with a new rule_version rather than a silent edit of
-- an earlier snapshot.
--
-- guide_key is the case-folded, whitespace-collapsed, quote-stripped label, and it is the
-- primary key -- that is where the licensor's case-variant duplicates collapse.
-- guide_label is the most frequent raw spelling, chosen deterministically; EVERY spelling
-- is preserved in plm.wildbrain_guide_alias.
--
-- THE KEY-DERIVATION CHECK BELOW IS THE ONE THAT MATTERS. It pins guide_key to the exact
-- normalization of normalized_guide_label:
--     btrim(regexp_replace(replace(lower(x), '"', ''), '[[:space:]]+', ' ', 'g'))
-- All three functions are IMMUTABLE, so this is legal in a CHECK. Without it, a loader
-- with a drifted normalizer would land two rows that should have been one and nothing
-- would say so. plm.finalize_wildbrain_capture re-asserts the same rule at the publication
-- gate, so weakening the constraint later does not silently disable the guarantee.
--
-- TWO HARD RULES FOR THE LOADER, both from real defects in this source. Neither can be
-- expressed as a constraint, so they are recorded here where the next reader will find
-- them:
--   * WORKFLOW STATUS WORDS share the comma list with guide names and must NEVER become
--     a guide row.
--   * At least one asset stores its ENTIRE keyword string wrapped in double quotes. The
--     wrapping quotes must be stripped BEFORE splitting on commas, or one real guide
--     becomes two phantom guides.
--
-- Guides that differ by MORE than case stay separate rows. Merging them is a business
-- ruling and is out of scope for this schema.
-- =====================================================================================
create table plm.wildbrain_guide (
  capture_id              uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  guide_key               text  not null,
  guide_label             text  not null,
  normalized_guide_label  text  not null,
  derivation_method       text  not null default 'keyword_field_split',
  rule_version            text  not null,
  relationship_truth      text  not null default 'inferred',
  raw                     jsonb not null,

  constraint wildbrain_guide_pkey primary key (capture_id, guide_key),
  constraint wildbrain_guide_normalized_label_uk unique (capture_id, normalized_guide_label),
  constraint wildbrain_guide_derivation_method_chk
    check (derivation_method = 'keyword_field_split'),
  constraint wildbrain_guide_truth_chk check (relationship_truth = 'inferred'),
  constraint wildbrain_guide_key_derivation_chk
    check (
      guide_key = btrim(
        regexp_replace(replace(lower(normalized_guide_label), '"', ''), '[[:space:]]+', ' ', 'g')
      )
    ),
  constraint wildbrain_guide_key_nonblank_chk check (btrim(guide_key) <> ''),
  constraint wildbrain_guide_label_nonblank_chk check (btrim(guide_label) <> ''),
  constraint wildbrain_guide_normalized_label_nonblank_chk
    check (btrim(normalized_guide_label) <> ''),
  constraint wildbrain_guide_rule_version_nonblank_chk check (btrim(rule_version) <> ''),
  constraint wildbrain_guide_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wildbrain_guide is
  'Style guides RECONSTRUCTED BY US from the asset keyword field. THE PORTAL HAS NO '
  'STYLE-GUIDE OBJECT -- no id, no record, no parent link -- so no row here is a portal '
  'master record and none may be presented as one. relationship_truth is pinned to '
  '''inferred''. Deduplication to guide_key is case-folding only; near-duplicates that '
  'differ by more than case stay separate and merging them needs a business ruling.';
comment on column plm.wildbrain_guide.guide_key is
  'The case-folded, whitespace-collapsed, quote-stripped label, pinned by CHECK to the '
  'exact normalization of normalized_guide_label. This is where the licensor''s '
  'case-variant duplicates collapse.';
comment on column plm.wildbrain_guide.rule_version is
  'Which parse produced this row. A corrected parse is a NEW capture with a new '
  'rule_version, never a rewrite of an existing snapshot.';


-- =====================================================================================
-- 10. plm.wildbrain_guide_alias -- every raw spelling, with how many assets carried it.
--
-- This is what makes the deduplication AUDITABLE AND REVERSIBLE rather than lossy. Delete
-- this table and the case-folding above becomes an irreversible edit of licensor data.
-- asset_count > 0: an alias no asset used is not evidence of anything.
--
-- relationship_truth IS PINNED HERE TOO, AND IT IS NOT DECORATION. Without it this table
-- has exactly the shape of a portal dictionary -- capture, key, label, count, raw -- and a
-- reader who identifies the portal-declared tables as "the ones with no relationship_truth
-- column" would read alias rows as WildBrain's own vocabulary. They are not. Every alias
-- row is a spelling WE extracted from free keyword text and WE grouped under a guide_key
-- WE derived. All three reconstructed tables carry the pin, so the rule a reader applies
-- is uniform and does not depend on having read the prose above.
-- =====================================================================================
create table plm.wildbrain_guide_alias (
  capture_id         uuid    not null references plm.wildbrain_capture(id) on delete restrict,
  guide_key          text    not null,
  alias_label        text    not null,
  asset_count        integer not null,
  relationship_truth text    not null default 'inferred',
  raw                jsonb   not null,

  constraint wildbrain_guide_alias_pkey primary key (capture_id, guide_key, alias_label),
  constraint wildbrain_guide_alias_guide_fk
    foreign key (capture_id, guide_key)
    references plm.wildbrain_guide (capture_id, guide_key) on delete restrict,
  constraint wildbrain_guide_alias_truth_chk check (relationship_truth = 'inferred'),
  constraint wildbrain_guide_alias_count_pos_chk check (asset_count > 0),
  constraint wildbrain_guide_alias_label_nonblank_chk check (btrim(alias_label) <> ''),
  constraint wildbrain_guide_alias_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.wildbrain_guide_alias is
  'Every raw spelling the licensor used for a reconstructed guide, with the number of '
  'assets that carried it. Makes the guide_key deduplication auditable and reversible. '
  'RECONSTRUCTED, NOT PORTAL VOCABULARY: relationship_truth is pinned to ''inferred'' by '
  'a CHECK so this table can never be mistaken for a portal dictionary.';
comment on column plm.wildbrain_guide_alias.relationship_truth is
  'Pinned to ''inferred''. These spellings were extracted by us from free keyword text '
  'and grouped under a guide_key we derived. The portal has no alias record.';


-- =====================================================================================
-- 11. plm.wildbrain_asset_guide -- RECONSTRUCTED asset-to-guide links.
--
-- alias_label records WHICH spelling THIS asset used, so the evidence survives the
-- deduplication -- and the composite FK to plm.wildbrain_guide_alias makes an unknown
-- spelling impossible rather than merely discouraged.
--
-- ASSETS CARRYING NO KEYWORD TEXT PRODUCE NO ROW HERE. They are not attributed to a
-- placeholder guide, because the portal offers no way to attribute them at all. A
-- substantial share of the assets in a capture are in that position, and that is a
-- CORRECT OUTCOME, not missing data. Do not add a "none" guide to make the numbers tidy.
-- =====================================================================================
create table plm.wildbrain_asset_guide (
  capture_id          uuid  not null references plm.wildbrain_capture(id) on delete restrict,
  asset_source_id     text  not null,
  guide_key           text  not null,
  alias_label         text  not null,
  relationship_truth  text  not null default 'inferred',
  raw                 jsonb not null,

  constraint wildbrain_asset_guide_pkey primary key (capture_id, asset_source_id, guide_key),
  constraint wildbrain_asset_guide_asset_fk
    foreign key (capture_id, asset_source_id)
    references plm.wildbrain_asset (capture_id, asset_source_id) on delete restrict,
  constraint wildbrain_asset_guide_guide_fk
    foreign key (capture_id, guide_key)
    references plm.wildbrain_guide (capture_id, guide_key) on delete restrict,
  constraint wildbrain_asset_guide_alias_fk
    foreign key (capture_id, guide_key, alias_label)
    references plm.wildbrain_guide_alias (capture_id, guide_key, alias_label) on delete restrict,
  constraint wildbrain_asset_guide_truth_chk check (relationship_truth = 'inferred'),
  constraint wildbrain_asset_guide_alias_nonblank_chk check (btrim(alias_label) <> ''),
  constraint wildbrain_asset_guide_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

create index idx_wildbrain_asset_guide_guide
  on plm.wildbrain_asset_guide (capture_id, guide_key);

comment on table plm.wildbrain_asset_guide is
  'Asset-to-guide links RECONSTRUCTED from the keyword field. relationship_truth is pinned '
  'to ''inferred''. alias_label records the spelling THIS asset used and is FK-bound to a '
  'known alias of the guide. An asset with no keyword text produces NO row here, on '
  'purpose: the portal offers no way to attribute it, and a placeholder guide would be a '
  'fabricated fact.';


-- The one query pattern every reader needs: the newest complete capture.
create index idx_wildbrain_capture_status_captured
  on plm.wildbrain_capture (status, source_captured_at desc);


-- =====================================================================================
-- FUNCTIONS.
--
-- Both are `security definer` with a pinned search_path, execute REVOKED from public and
-- granted ONLY to service_role. They are the sole write path to plm.wildbrain_capture,
-- which service_role can only read.
-- =====================================================================================

create or replace function plm.begin_wildbrain_capture(
  p_capture_key            text,
  p_source_repository      text,
  p_source_commit_sha      text,
  p_source_manifest_sha256 text,
  p_portal_base_url        text,
  p_source_captured_at     timestamptz,
  p_expected_counts        jsonb,
  p_raw_summary            jsonb,
  p_created_by             text,
  p_pagination_verified    boolean     default false,
  p_reported_total         integer     default null,
  p_media_downloaded       integer     default 0,
  p_read_commit_sha        text        default null
) returns uuid
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_existing plm.wildbrain_capture%rowtype;
  v_id       uuid;
begin
  -- Validate BEFORE touching anything. A malformed argument must fail here, loudly,
  -- rather than land a half-described capture that the finalize gate then has to reason
  -- about.
  if p_capture_key is null or btrim(p_capture_key) = '' then
    raise exception 'begin_wildbrain_capture: capture_key is required';
  end if;
  if p_source_repository is null or btrim(p_source_repository) = '' then
    raise exception 'begin_wildbrain_capture: source_repository is required';
  end if;
  if p_portal_base_url is null or btrim(p_portal_base_url) = '' then
    raise exception 'begin_wildbrain_capture: portal_base_url is required';
  end if;
  if p_source_commit_sha is null or p_source_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_wildbrain_capture: source_commit_sha must be a 40-character lowercase hex sha';
  end if;
  if p_read_commit_sha is not null and p_read_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception
      'begin_wildbrain_capture: read_commit_sha must be a 40-character lowercase hex sha';
  end if;
  if p_source_manifest_sha256 is null or p_source_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception
      'begin_wildbrain_capture: source_manifest_sha256 must be a 64-character lowercase hex sha';
  end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts) <> 'object'
     or p_expected_counts = '{}'::jsonb then
    raise exception 'begin_wildbrain_capture: expected_counts must be a non-empty JSON object';
  end if;
  -- EVERY VALUE MUST BE A JSON NUMBER THAT IS A NON-NEGATIVE INTEGER. A JSON `null` here
  -- is the exact shape a loader produces from jsonb_build_object('assets', v_unset_count),
  -- and it is NOT a missing key: the key IS present, so a `?` test would call it supplied
  -- while every comparison against it is SQL NULL and therefore never false. That is a
  -- SKIPPED count check, and a skipped count check is precisely how the portal's
  -- silently-ignored-offset pager publishes a 200-row first page as a whole capture.
  -- Refused here, loudly, at the start -- and refused again at the publication gate, which
  -- re-reads the stored object rather than trusting that this ran.
  -- TWO SEPARATE STATEMENTS, NOT ONE `or`-ED PREDICATE. SQL does not promise to
  -- short-circuit `or`, so a single predicate could evaluate the numeric cast on a JSON
  -- string and die with a cast error instead of this named message. The type test has to
  -- have finished before anything casts.
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where jsonb_typeof(e.value) <> 'number'
  ) then
    raise exception
      'begin_wildbrain_capture: every expected_counts value must be a JSON number that is a non-negative integer; a null, string or object there would SKIP that count check at the publication gate; got %',
      p_expected_counts;
  end if;
  if exists (
    select 1 from jsonb_each(p_expected_counts) e
     where (e.value #>> '{}')::numeric < 0
        or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
  ) then
    raise exception
      'begin_wildbrain_capture: every expected_counts value must be a JSON number that is a non-negative integer; got %',
      p_expected_counts;
  end if;
  if p_raw_summary is null or jsonb_typeof(p_raw_summary) <> 'object' then
    raise exception 'begin_wildbrain_capture: raw_summary must be a JSON object';
  end if;
  if p_source_captured_at is null then
    raise exception 'begin_wildbrain_capture: source_captured_at is required';
  end if;
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'begin_wildbrain_capture: created_by is required';
  end if;
  -- The zero-media scope, validated as an ARGUMENT rather than left to the CHECK, so the
  -- caller gets a message that names the rule instead of a constraint violation.
  if p_media_downloaded is null or p_media_downloaded <> 0 then
    raise exception
      'begin_wildbrain_capture: media_downloaded must be 0 -- this project may never download media';
  end if;
  if p_reported_total is not null and p_reported_total < 0 then
    raise exception 'begin_wildbrain_capture: reported_total may not be negative';
  end if;
  if p_pagination_verified is null then
    raise exception 'begin_wildbrain_capture: pagination_verified may not be null';
  end if;

  -- Serialize concurrent starts of the SAME capture_key. Two loader processes racing here
  -- would otherwise both miss the select and both insert.
  perform pg_advisory_xact_lock(hashtextextended('plm.wildbrain_capture:' || p_capture_key, 0));

  select * into v_existing from plm.wildbrain_capture where capture_key = p_capture_key;

  if found then
    -- Same key, different bytes, is a CONTRADICTION, not a resume. Refuse it: silently
    -- appending different source data under an existing capture key would make the
    -- snapshot unreconstructable.
    if v_existing.source_manifest_sha256 is distinct from p_source_manifest_sha256 then
      raise exception
        'begin_wildbrain_capture: capture_key % already exists with a DIFFERENT source manifest hash; refusing',
        p_capture_key;
    end if;
    if v_existing.source_commit_sha is distinct from p_source_commit_sha then
      raise exception
        'begin_wildbrain_capture: capture_key % already exists with a DIFFERENT source commit sha; refusing',
        p_capture_key;
    end if;
    if v_existing.source_captured_at is distinct from p_source_captured_at then
      raise exception
        'begin_wildbrain_capture: capture_key % already exists with a DIFFERENT source_captured_at; refusing',
        p_capture_key;
    end if;

    if v_existing.status = 'complete' then
      -- Idempotent: hand back the finished capture untouched. NEVER re-open it.
      return v_existing.id;
    elsif v_existing.status = 'loading' then
      -- Resume. Only the loader's own operational evidence may be refreshed -- never the
      -- identity fields compared above, and never the status or the counts.
      --
      -- pagination_verified IS STICKY-TRUE ON RESUME, NEVER OVERWRITTEN.
      -- The argument defaults to false, so a plain retry -- `begin_` called again with
      -- the same identity arguments after a crash -- would otherwise silently turn a
      -- proved pager back off. Finalize would then reject, and a rejected capture_key can
      -- NEVER be reused, so the same source bytes would need a brand-new key: a silent
      -- default would destroy the capture. Sticky-true is correct rather than merely
      -- convenient because the flag is EVIDENCE ABOUT THE SOURCE BYTES, and the three
      -- identity comparisons above have already refused to resume unless the manifest
      -- hash, the commit and the captured-at all match -- so the proof still describes
      -- the very bytes being resumed. There is deliberately no way to un-verify: a loader
      -- that discovers the pager was broken must fail the capture through error_summary
      -- at finalize, which keeps the reason as evidence, not by quietly erasing a proof.
      update plm.wildbrain_capture
         set read_commit_sha     = coalesce(p_read_commit_sha, read_commit_sha),
             pagination_verified = pagination_verified or p_pagination_verified,
             reported_total      = coalesce(p_reported_total, reported_total)
       where id = v_existing.id;
      return v_existing.id;
    else
      raise exception
        'begin_wildbrain_capture: capture_key % is %; start a NEW capture rather than reusing it',
        p_capture_key, v_existing.status;
    end if;
  end if;

  insert into plm.wildbrain_capture (
    capture_key, source_repository, source_commit_sha, read_commit_sha,
    source_manifest_sha256, portal_base_url, source_captured_at,
    status, expected_counts, raw_summary, created_by,
    pagination_verified, reported_total, media_downloaded
  ) values (
    p_capture_key, p_source_repository, p_source_commit_sha, p_read_commit_sha,
    p_source_manifest_sha256, p_portal_base_url, p_source_captured_at,
    'loading', p_expected_counts, p_raw_summary, p_created_by,
    p_pagination_verified, p_reported_total, p_media_downloaded
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function plm.begin_wildbrain_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,integer,integer,text) is
  'Creates or RESUMES exactly one loading WildBrain capture. Idempotent for an identical '
  'capture. Refuses to re-open a complete capture, refuses a terminal one, and refuses a '
  'same-key capture whose source manifest, commit or captured-at differs. Validates both '
  'SHA formats, the zero-media scope, and that every expected_counts value is a JSON '
  'number that is a non-negative integer (a JSON null there would silently skip a count '
  'check at the publication gate). On resume pagination_verified is STICKY-TRUE -- the '
  'argument can only ever set it, never clear it, because the argument defaults to false '
  'and a plain retry would otherwise burn the capture key. Sole insert path to '
  'plm.wildbrain_capture. service_role only.';


-- -------------------------------------------------------------------------------------
-- plm.finalize_wildbrain_capture -- the publication gate.
--
-- WHY IT RETURNS VOID AND DOES NOT RAISE ON A VALIDATION FAILURE, AND WHY THAT IS NOT A
-- SILENT FAILURE. The contract requires that a failed capture be marked `rejected` with
-- its errors PERSISTED. In PostgreSQL, raising an exception aborts the very transaction
-- that wrote that rejection row, so raising and persisting are mutually exclusive: raise,
-- and the evidence is rolled back and the capture is left sitting in `loading` with no
-- record of why. The safety property is fully preserved -- the capture is `rejected`, it
-- is not `complete`, no current-capture reader will select it, and the previous complete
-- capture stays current. The failure is loud in three ways: a server WARNING naming the
-- error count, a persisted `rejected` status, and a persisted structured error_summary.
-- THE LOADER MUST RE-READ status AFTER CALLING THIS. Arguments that are wrong on their
-- face, and preconditions such as a missing or non-loading capture, still RAISE.
-- -------------------------------------------------------------------------------------
create or replace function plm.finalize_wildbrain_capture(
  p_capture_id     uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.wildbrain_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_want  bigint;
  v_key   text;
  v_pairs text[][] := array[
    ['eras','wildbrain_era'],
    ['creative_groups','wildbrain_creative_group'],
    ['asset_categories','wildbrain_asset_category'],
    ['asset_natures','wildbrain_asset_nature'],
    ['characters','wildbrain_character'],
    ['assets','wildbrain_asset'],
    ['asset_characters','wildbrain_asset_character'],
    ['guides','wildbrain_guide'],
    ['guide_aliases','wildbrain_guide_alias'],
    ['asset_guides','wildbrain_asset_guide']
  ];
  i integer;
begin
  if p_capture_id is null then
    raise exception 'finalize_wildbrain_capture: capture id is required';
  end if;
  if p_observed_counts is not null and jsonb_typeof(p_observed_counts) <> 'object' then
    raise exception 'finalize_wildbrain_capture: observed_counts must be a JSON object when given';
  end if;
  if p_error_summary is not null and jsonb_typeof(p_error_summary) <> 'array' then
    raise exception 'finalize_wildbrain_capture: error_summary must be a JSON array when given';
  end if;

  -- Row lock: two loaders finalizing the same capture must not interleave their counts.
  select * into v_cap from plm.wildbrain_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_wildbrain_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error, and it
    -- must NOT re-run the gate against a snapshot that is already published.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_wildbrain_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. The loader's own reported errors. Anything the loader saw and reported is a
  -- rejection on its own; the checks below are additional, not a replacement.
  if p_error_summary is not null and jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object(
      'code','loader_reported_errors',
      'count', jsonb_array_length(p_error_summary),
      'errors', p_error_summary);
  end if;

  -- ---- B. Paging and scope invariants. pagination_verified is the one that stops a
  -- silently-short capture from being published (see the table comment).
  if not v_cap.pagination_verified then
    v_err := v_err || jsonb_build_object('code','pagination_not_verified');
  end if;
  -- Belt and braces over the table CHECKs: if a future migration ever loosened them,
  -- this gate still refuses to publish.
  if v_cap.truncated_child_lists <> 0 then
    v_err := v_err || jsonb_build_object('code','truncated_child_lists',
                                         'observed', v_cap.truncated_child_lists);
  end if;
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;

  -- ---- C. Row counts, COUNTED FROM THE TABLES, never from a ledger or a summary
  -- document. This repository has shipped a migration that recorded a clean ledger row
  -- while its object did nothing, so "it reported success" is not evidence of anything.
  -- Every one of the ten keys is REQUIRED in expected_counts: a missing key is a
  -- rejection, not a skipped check, because a skipped check is how a truncated capture
  -- passes.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE for
    -- {"assets": null}, and every comparison against the resulting SQL NULL is UNKNOWN --
    -- so a naive `if v_n <> v_want` would never fire and the count would go UNCHECKED,
    -- which is the same publication failure as omitting the key. jsonb_build_object with
    -- an unset variable produces exactly that shape. So the value must be a JSON NUMBER,
    -- and it must be a non-negative integer: a fractional or negative expectation is a
    -- broken loader, not a count.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number','entity',v_key,
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
  end loop;

  -- If the loader supplied its own observed counts, they must AGREE with what is actually
  -- in the tables. A loader whose idea of what it wrote differs from what landed has a
  -- bug, and publishing its number instead of the measured one would hide it.
  if p_observed_counts is not null then
    for i in 1 .. array_length(v_pairs, 1) loop
      v_key := v_pairs[i][1];
      -- Same JSON-null trap as the expected counts above: a present-but-null value would
      -- make the comparison UNKNOWN and skip the check silently, so a non-number that is
      -- present is itself a disagreement.
      if (p_observed_counts ? v_key)
         and jsonb_typeof(p_observed_counts -> v_key) <> 'number' then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_not_a_number',
                    'entity', v_key,
                    'json_type', jsonb_typeof(p_observed_counts -> v_key));
      elsif (p_observed_counts ? v_key)
         and (p_observed_counts ->> v_key)::numeric <> (v_obs ->> v_key)::numeric then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_disagrees',
                    'entity', v_key,
                    'loader_reported', p_observed_counts -> v_key,
                    'measured', (v_obs ->> v_key)::bigint);
      end if;
    end loop;
  end if;

  -- ---- D. Duplicate source ids. The primary keys already make these impossible within a
  -- capture; this asserts the constraints are still in force rather than trusting that
  -- nobody weakened one.
  select count(*) into v_n
    from (select asset_source_id from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select asset_uuid from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_uuid having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_uuid','count',v_n);
  end if;
  select count(*) into v_n
    from (select character_source_id from plm.wildbrain_character where capture_id = p_capture_id
          group by character_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_character_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select era_source_id from plm.wildbrain_era where capture_id = p_capture_id
          group by era_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_era_source_id','count',v_n);
  end if;

  -- ---- E. Orphaned relationship endpoints. The composite FKs already make a
  -- cross-capture edge impossible; same reasoning as D.
  select count(*) into v_n
    from plm.wildbrain_asset_character l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_character c
                       where c.capture_id = l.capture_id
                         and c.character_source_id = l.character_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_character_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_asset_guide l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_guide g
                       where g.capture_id = l.capture_id and g.guide_key = l.guide_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_guide_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_guide_alias al
   where al.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide g
                      where g.capture_id = al.capture_id and g.guide_key = al.guide_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_guide_alias','count',v_n);
  end if;

  -- ---- F. Every asset must carry a resolved era. era_source_id is NOT NULL and
  -- FK-bound, so this is the same class of assertion as D and E -- and it is the single
  -- most load-bearing fact in this schema, because the whole property axis hangs off it.
  select count(*) into v_n
    from plm.wildbrain_asset a
   where a.capture_id = p_capture_id
     and (a.era_source_id is null
       or not exists (select 1 from plm.wildbrain_era e
                       where e.capture_id = a.capture_id and e.era_source_id = a.era_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_without_resolved_era','count',v_n);
  end if;

  -- ---- G. Era hierarchy: every non-null parent must resolve INSIDE the same capture.
  select count(*) into v_n
    from plm.wildbrain_era e
   where e.capture_id = p_capture_id
     and e.parent_era_source_id is not null
     and not exists (select 1 from plm.wildbrain_era p
                      where p.capture_id = e.capture_id
                        and p.era_source_id = e.parent_era_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','era_parent_unresolved','count',v_n);
  end if;

  -- ---- G2. EXACTLY ONE ROOT. The licensee account sees one property, so a second root
  -- is either an unlicensed tree that leaked into the crawl or a lost parent link.
  -- Re-asserted here for the same reason as D and E: the partial unique index makes it
  -- impossible, and this refuses to publish if a future migration ever drops it.
  select count(*) into v_n
    from plm.wildbrain_era where capture_id = p_capture_id and is_root;
  if v_n > 1 then
    v_err := v_err || jsonb_build_object('code','multiple_root_eras','count',v_n);
  end if;
  select count(*) into v_want from plm.wildbrain_era where capture_id = p_capture_id;
  if v_want > 0 and v_n = 0 then
    v_err := v_err || jsonb_build_object('code','no_root_era','eras',v_want);
  end if;

  -- ---- G3. NO CYCLE. Nothing above can see one: the self-parent CHECK stops only
  -- A -> A, the composite FK stops only a cross-capture parent, and A -> B -> A satisfies
  -- every one of them AND matches expected_counts, so without this a capture containing a
  -- loop publishes clean and every later walk of the property axis either loops forever
  -- or silently truncates.
  --
  -- Measured as REACHABILITY FROM THE ROOT rather than by chasing parents, because that
  -- walk provably terminates: parent_era_source_id is a single column, so an era has at
  -- most one parent, so no member of a cycle can also be a descendant of the root -- it
  -- would need two parents. The recursion therefore visits each era at most once and can
  -- never follow the loop. Anything not reached is in a cycle or hangs off one, and both
  -- are the same verdict: not landable.
  with recursive reachable as (
    select e.era_source_id
      from plm.wildbrain_era e
     where e.capture_id = p_capture_id
       and e.parent_era_source_id is null
    union all
    select c.era_source_id
      from plm.wildbrain_era c
      join reachable r on c.parent_era_source_id = r.era_source_id
     where c.capture_id = p_capture_id
  )
  select count(*) into v_n from reachable;
  if v_n <> v_want then
    v_err := v_err || jsonb_build_object('code','era_cycle_or_unreachable',
                                         'reachable_from_root', v_n, 'eras', v_want);
  end if;

  -- ---- H. Guide key derivation. The same rule the table CHECK pins, re-asserted here so
  -- that weakening the constraint does not silently disable the guarantee.
  select count(*) into v_n
    from plm.wildbrain_guide g
   where g.capture_id = p_capture_id
     and g.guide_key <> btrim(
           regexp_replace(replace(lower(g.normalized_guide_label), '"', ''),
                          '[[:space:]]+', ' ', 'g'));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','guide_key_not_normalization','count',v_n);
  end if;

  -- ---- I. Every asset-to-guide row must cite a KNOWN alias of its own guide.
  select count(*) into v_n
    from plm.wildbrain_asset_guide ag
   where ag.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide_alias al
                      where al.capture_id = ag.capture_id
                        and al.guide_key  = ag.guide_key
                        and al.alias_label = ag.alias_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_guide_unknown_alias','count',v_n);
  end if;

  -- NOT A REJECTION CONDITION, STATED EXPLICITLY SO NOBODY ADDS IT: a character row with
  -- in_source_dictionary = false is a licensor defect preserved as evidence. It is
  -- COUNTED here for visibility and it never blocks publication.
  select count(*) into v_n
    from plm.wildbrain_character
   where capture_id = p_capture_id and in_source_dictionary = false;
  v_obs := v_obs || jsonb_build_object('characters_not_in_source_dictionary', v_n);

  -- ---- Verdict. There is no partial publish.
  if jsonb_array_length(v_err) > 0 then
    update plm.wildbrain_capture
       set status            = 'rejected',
           observed_counts   = v_obs,
           error_summary     = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning
      'finalize_wildbrain_capture: capture % REJECTED with % error(s); read status and error_summary',
      p_capture_id, jsonb_array_length(v_err);
    return;
  end if;

  update plm.wildbrain_capture
     set status            = 'complete',
         observed_counts   = v_obs,
         error_summary     = '[]'::jsonb,
         load_completed_at = now()
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) is
  'The publication gate. Under a row lock it counts every table for the capture and '
  'refuses to publish on: unverified pagination, a truncated child list, a nonzero media '
  'count, loader-reported errors, duplicate source ids, orphaned relationship endpoints, '
  'an asset with an unresolved era, an era whose parent does not resolve in the same '
  'capture, more than one root era, no root era at all, an era cycle (measured as '
  'reachability from the root), a guide_key that is not the normalization of its own '
  'normalized label, an asset-guide row citing an unknown alias, an expected count that '
  'is missing or is not a JSON number that is a non-negative integer, or any count that '
  'differs from expected_counts. All pass -> status complete. Any fail -> status rejected with the '
  'errors PERSISTED and a server WARNING raised; the previous complete capture stays '
  'current. THE CALLER MUST RE-READ status -- it cannot raise on a validation failure '
  'without rolling back the very rejection record it is required to keep. A character '
  'with in_source_dictionary = false is explicitly NOT a rejection condition. '
  'service_role only.';


-- =====================================================================================
-- RLS, GRANTS, AND THE IMMUTABILITY MECHANISM.
--
-- An RLS policy is not a GRANT and a GRANT is not an RLS policy (AGENTS.md section 11).
-- Both are set here. Supabase's service_role carries BYPASSRLS, so RLS alone could NOT
-- constrain the loader -- THE GRANTS ARE WHAT ENFORCE IMMUTABILITY.
--
--   plm.wildbrain_capture -> service_role: SELECT only. All writes go through the two
--                            security-definer functions above.
--   the other ten         -> service_role: SELECT + INSERT. No UPDATE. No DELETE.
--                            Rows are immutable the moment they land.
--   anon, authenticated   -> nothing. Licensed source material is not exposed to a
--                            browser until there is an explicit access decision.
--
-- `revoke all ... from service_role` FIRST, then grant back, is not belt-and-braces --
-- it is THE fix. The plm schema carries ALTER DEFAULT PRIVILEGES granting service_role
-- insert/select/update/delete on every new table, applied by Postgres at CREATE TABLE
-- time, BEFORE any GRANT in this file runs. A bare `grant select, insert` would be a
-- silent no-op against a role that already holds more, which is exactly how the NBCU
-- landing shipped an inert immutability guarantee. Revoking ALL is also deliberately
-- version-agnostic: it removes the PostgreSQL 17 MAINTAIN bit without naming a keyword
-- that does not parse on older servers.
-- =====================================================================================
-- WRITTEN OUT ONE TABLE AT A TIME, NOT AS A `format('... plm.%I ...')` LOOP. A loop reads
-- more tidily and is what the NBCU landing did, but the repository's cross-PR object
-- collision parser reads the literal DDL text, and `alter table plm.%I` parses as a
-- change to an object called `plm` -- a phantom that no claim can honestly declare.
-- Naming each table also means this block is greppable: searching for a table name finds
-- its privileges.

alter table plm.wildbrain_capture enable row level security;
revoke all on plm.wildbrain_capture from public;
revoke all on plm.wildbrain_capture from anon;
revoke all on plm.wildbrain_capture from authenticated;
revoke all on plm.wildbrain_capture from service_role;
grant select on plm.wildbrain_capture to service_role;
create policy wildbrain_capture_service_read on plm.wildbrain_capture for select to service_role using (true);

alter table plm.wildbrain_era enable row level security;
revoke all on plm.wildbrain_era from public;
revoke all on plm.wildbrain_era from anon;
revoke all on plm.wildbrain_era from authenticated;
revoke all on plm.wildbrain_era from service_role;
grant select, insert on plm.wildbrain_era to service_role;
create policy wildbrain_era_service_read on plm.wildbrain_era for select to service_role using (true);

alter table plm.wildbrain_creative_group enable row level security;
revoke all on plm.wildbrain_creative_group from public;
revoke all on plm.wildbrain_creative_group from anon;
revoke all on plm.wildbrain_creative_group from authenticated;
revoke all on plm.wildbrain_creative_group from service_role;
grant select, insert on plm.wildbrain_creative_group to service_role;
create policy wildbrain_creative_group_service_read on plm.wildbrain_creative_group for select to service_role using (true);

alter table plm.wildbrain_asset_category enable row level security;
revoke all on plm.wildbrain_asset_category from public;
revoke all on plm.wildbrain_asset_category from anon;
revoke all on plm.wildbrain_asset_category from authenticated;
revoke all on plm.wildbrain_asset_category from service_role;
grant select, insert on plm.wildbrain_asset_category to service_role;
create policy wildbrain_asset_category_service_read on plm.wildbrain_asset_category for select to service_role using (true);

alter table plm.wildbrain_asset_nature enable row level security;
revoke all on plm.wildbrain_asset_nature from public;
revoke all on plm.wildbrain_asset_nature from anon;
revoke all on plm.wildbrain_asset_nature from authenticated;
revoke all on plm.wildbrain_asset_nature from service_role;
grant select, insert on plm.wildbrain_asset_nature to service_role;
create policy wildbrain_asset_nature_service_read on plm.wildbrain_asset_nature for select to service_role using (true);

alter table plm.wildbrain_character enable row level security;
revoke all on plm.wildbrain_character from public;
revoke all on plm.wildbrain_character from anon;
revoke all on plm.wildbrain_character from authenticated;
revoke all on plm.wildbrain_character from service_role;
grant select, insert on plm.wildbrain_character to service_role;
create policy wildbrain_character_service_read on plm.wildbrain_character for select to service_role using (true);

alter table plm.wildbrain_asset enable row level security;
revoke all on plm.wildbrain_asset from public;
revoke all on plm.wildbrain_asset from anon;
revoke all on plm.wildbrain_asset from authenticated;
revoke all on plm.wildbrain_asset from service_role;
grant select, insert on plm.wildbrain_asset to service_role;
create policy wildbrain_asset_service_read on plm.wildbrain_asset for select to service_role using (true);

alter table plm.wildbrain_asset_character enable row level security;
revoke all on plm.wildbrain_asset_character from public;
revoke all on plm.wildbrain_asset_character from anon;
revoke all on plm.wildbrain_asset_character from authenticated;
revoke all on plm.wildbrain_asset_character from service_role;
grant select, insert on plm.wildbrain_asset_character to service_role;
create policy wildbrain_asset_character_service_read on plm.wildbrain_asset_character for select to service_role using (true);

alter table plm.wildbrain_guide enable row level security;
revoke all on plm.wildbrain_guide from public;
revoke all on plm.wildbrain_guide from anon;
revoke all on plm.wildbrain_guide from authenticated;
revoke all on plm.wildbrain_guide from service_role;
grant select, insert on plm.wildbrain_guide to service_role;
create policy wildbrain_guide_service_read on plm.wildbrain_guide for select to service_role using (true);

alter table plm.wildbrain_guide_alias enable row level security;
revoke all on plm.wildbrain_guide_alias from public;
revoke all on plm.wildbrain_guide_alias from anon;
revoke all on plm.wildbrain_guide_alias from authenticated;
revoke all on plm.wildbrain_guide_alias from service_role;
grant select, insert on plm.wildbrain_guide_alias to service_role;
create policy wildbrain_guide_alias_service_read on plm.wildbrain_guide_alias for select to service_role using (true);

alter table plm.wildbrain_asset_guide enable row level security;
revoke all on plm.wildbrain_asset_guide from public;
revoke all on plm.wildbrain_asset_guide from anon;
revoke all on plm.wildbrain_asset_guide from authenticated;
revoke all on plm.wildbrain_asset_guide from service_role;
grant select, insert on plm.wildbrain_asset_guide to service_role;
create policy wildbrain_asset_guide_service_read on plm.wildbrain_asset_guide for select to service_role using (true);

revoke all on function plm.begin_wildbrain_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,integer,integer,text) from public;
revoke all on function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) from public;
grant execute on function plm.begin_wildbrain_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,boolean,integer,integer,text) to service_role;
grant execute on function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) to service_role;


-- =====================================================================================
-- ASSERT THE OUTCOME INSIDE THE MIGRATION, so this file cannot fail silently the way the
-- NBCU landing did. If the revokes did not take, or a revoke overshot into SELECT or
-- INSERT and would break the loader, this raises and the migration fails.
-- =====================================================================================
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name like 'wildbrain\_%'
     and grantee = 'service_role'
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then
    raise exception
      'wildbrain landing: service_role still holds % write grant(s) on wildbrain tables', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name = 'wildbrain_capture'
     and grantee = 'service_role'
     and privilege_type = 'INSERT';
  if v_bad <> 0 then
    raise exception 'wildbrain landing: plm.wildbrain_capture is still directly insertable';
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_bad <> 11 then
    raise exception 'wildbrain landing: expected 11 SELECT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 10 then
    raise exception 'wildbrain landing: expected 10 INSERT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'wildbrain\_%'
     and grantee in ('anon','authenticated','PUBLIC');
  if v_bad <> 0 then
    raise exception
      'wildbrain landing: % grant(s) to anon/authenticated/PUBLIC survive on wildbrain tables', v_bad;
  end if;

  raise notice
    'wildbrain privileges: service_role SELECT x11, INSERT x10, no UPDATE/DELETE/TRUNCATE';
end;
$$;
