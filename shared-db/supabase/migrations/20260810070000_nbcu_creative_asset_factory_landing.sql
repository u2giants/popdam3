-- =====================================================================================
-- NBCU Creative Asset Factory -- source landing schema (release 1).
--
-- Migration: 20260810070000_nbcu_creative_asset_factory_landing.sql
-- Design:    nbcu/SUPABASE-IMPORT-SPEC.md in the PRIVATE repo u2giants/licensor-source-data,
--            read in full at private-repo commit 5f1c518b39a913dc42e21de6fc05ba5eb009ab8c.
-- Claim:     u2giants/shared-db issue #628 -- 16 tables + 2 functions. Nothing else.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO NBCU VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The NBCU extract is licensed source data
-- held in the PRIVATE repo u2giants/licensor-source-data. No NBCU title, property name,
-- character name, asset path, file name or raw payload may ever appear in this file, in
-- a contract test, in CI output, or in a PR or issue on this repository.
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime from the private loader nbcu/scripts/load-supabase.mjs, which
-- reads the private repo and writes through the two functions and the INSERT grants
-- below. The contract tests use INVENTED fixture values only.
--
-- WHAT THIS IS
--   A lossless, append-only, snapshot-scoped landing of the 2026-08-09 NBCU capture.
--   Every source table is keyed by `capture_id`, so a later refresh ADDS a snapshot and
--   never overwrites or deletes the previous one. Typed columns make common queries
--   easy; the `raw` column on every table prevents source loss when NBCU changes the
--   portal. Nothing here is canonical: these are NBCU's exact labels, which routinely
--   differ from core.property / core.character / core.style_guide, and preserving that
--   difference is the point.
--
-- WHAT THIS DELIBERATELY IS NOT
--   It does not create, rename, update, merge or delete any core.* or dam.* row. It does
--   not populate core.property_character, core.style_guide_character, dam.style_guide_file
--   or dam.asset_character. It resolves NOTHING -- every reconciliation column ships NULL
--   and unresolved by design. It exposes no api.* view: raw NBCU file names and portal
--   metadata are licensed material and need an explicit access decision first.
--
-- Depends on (exact 14-digit versions):
--   20260621150714  foundation           -- schema plm
--   20260621150815  app_core             -- core.property, core.character
--   20260727230000  core_style_guide_axis -- core.style_guide (confirmed present, so the
--                                            conditional FK in spec section 6.7 is taken)
--
-- THREE RECORDED DECISIONS THAT DIVERGE FROM A PLAIN READING OF THE SPEC. Do not
-- "fix" any of them without reading the reason.
--
--   1. NO TRIGGERS. Spec section 16 left immutability open between triggers and privilege
--      separation; the orchestrator ruled PRIVILEGE SEPARATION on 2026-08-10. This
--      database has been burned by a BEFORE trigger that read a `GENERATED ... STORED`
--      column, which Postgres populates AFTER before-triggers fire: the value was always
--      NULL, the guard never fired, and nothing ever raised. Privilege separation fails
--      closed and is inspectable in pg_class / information_schema.role_table_grants.
--      Mechanism: service_role is granted SELECT + INSERT and NOT update/delete on the
--      15 snapshot tables, and SELECT ONLY on plm.nbcu_capture. Rows are therefore
--      immutable from the instant they land -- STRICTER than "immutable once complete",
--      which satisfies it. Retry-safety is `on conflict do nothing`, which needs no
--      UPDATE privilege and is exactly idempotent because a capture's source bytes are
--      pinned by source_commit_sha + source_manifest_sha256.
--      CONSEQUENCE, stated so it is not discovered by surprise: the reconciliation
--      columns cannot be written by anyone today. That is correct for release 1, which
--      resolves nothing. A future curation release must add its own narrow UPDATE path.
--
--   2. NO nbcu_current_* VIEWS. Spec section 7 made them conditional and section 16 left
--      them open; the orchestrator ruled DEFER on 2026-08-10. Sixteen views nobody has
--      asked for are sixteen objects to keep correct. Callers select the newest capture
--      with `status = 'complete'` ordered by source_captured_at desc and join on
--      capture_id -- idx_nbcu_capture_status_captured exists for exactly that.
--
--   3. FUNCTION OWNERSHIP. Spec section 7 asks for a non-login owner role. This
--      repository has NEVER created a role -- all 267 existing `security definer`
--      functions are owned by the migration runner -- and a cluster-wide role is outside
--      claim #628 and is precisely the kind of shared object that collides with the other
--      sessions writing this repo. The security property is delivered instead by
--      `security definer` + a pinned `search_path` + `revoke execute from public` +
--      `grant execute to service_role` alone. FLAGGED for the orchestrator; not resolved
--      here.
--
-- KNOWN OPEN ITEM CARRIED FORWARD (blocks the loader, not this migration):
--   plm.nbcu_right requires a per-right `ordinal`, but nbcu/LICENSED_SCOPE.md is 75 lines
--   and the spec asserts 57 "documented title lines" without stating which 75-to-57 parse
--   rule produces them. Nobody may infer it. The loader needs that rule stated first.
--
-- ALSO RECORDED: spec section 5 is NOT an exhaustive file list. nbcu/asset-index.csv,
--   nbcu/raw/index/ and nbcu/raw/index-parts/ exist in the private repo, are absent from
--   section 5, and are deliberately NOT loaded.
-- =====================================================================================


-- =====================================================================================
-- 1. plm.nbcu_capture -- one row per attempted full load. The root of every snapshot.
--
-- capture_key format: 'nbcu:<source captured UTC>:<source commit sha>'. The same exact
-- capture is idempotent: a retry resumes the existing `loading` row or returns the
-- already-`complete` row, and never creates a duplicate. That is enforced by the unique
-- constraint here plus plm.begin_nbcu_capture below.
--
-- source_commit_sha vs read_commit_sha are TWO DIFFERENT FACTS and must not be collapsed
-- (orchestrator ruling, 2026-08-10). source_commit_sha identifies the DATA -- the commit
-- the extract was merged at, which is what capture_key is built from. read_commit_sha is
-- the commit the loader actually had checked out when it read the bytes, which can be a
-- later commit that changed only documentation.
-- =====================================================================================
create table plm.nbcu_capture (
  id                         uuid primary key default gen_random_uuid(),
  capture_key                text        not null unique,
  source_repository          text        not null,
  source_commit_sha          text        not null,
  read_commit_sha            text            null,
  source_manifest_sha256     text        not null,
  portal_base_url            text        not null,
  source_captured_at         timestamptz not null,
  load_started_at            timestamptz not null default now(),
  load_completed_at          timestamptz     null,
  status                     text        not null default 'loading',
  expected_counts            jsonb       not null,
  observed_counts            jsonb       not null default '{}'::jsonb,
  excluded_unlicensed_assets integer     not null default 0,
  media_downloaded           integer     not null default 0,
  error_summary              jsonb       not null default '[]'::jsonb,
  raw_summary                jsonb       not null,
  created_by                 text        not null,

  constraint nbcu_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint nbcu_capture_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint nbcu_capture_read_sha_chk
    check (read_commit_sha is null or read_commit_sha ~ '^[0-9a-f]{40}$'),
  -- Scope guard, not a style preference: this project may never download media.
  constraint nbcu_capture_media_chk
    check (media_downloaded = 0),
  constraint nbcu_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint nbcu_capture_excluded_nonneg_chk
    check (excluded_unlicensed_assets >= 0),
  constraint nbcu_capture_expected_counts_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint nbcu_capture_observed_counts_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint nbcu_capture_error_summary_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint nbcu_capture_raw_summary_obj_chk
    check (jsonb_typeof(raw_summary) = 'object')
);

comment on table plm.nbcu_capture is
  'One row per attempted full NBCU load. Append-only snapshot root: a refresh adds a new '
  'capture and NEVER edits or deletes an earlier one. Only plm.begin_nbcu_capture and '
  'plm.finalize_nbcu_capture may write here -- service_role holds SELECT only.';
comment on column plm.nbcu_capture.source_commit_sha is
  'The private-repo commit that identifies the DATA. capture_key is built from this.';
comment on column plm.nbcu_capture.read_commit_sha is
  'The private-repo commit the loader actually had checked out. May be LATER than '
  'source_commit_sha when only documentation changed. A separate fact; do not collapse.';
comment on column plm.nbcu_capture.status is
  'loading -> complete | rejected. A rejected capture stays visible as evidence and the '
  'previous complete capture remains current. NOTE: ''abandoned'' is permitted by the '
  'CHECK but no function sets it in release 1 -- flagged, not invented.';
comment on column plm.nbcu_capture.media_downloaded is
  'Hard zero. Constrained, not merely defaulted: storing NBCU media bytes is out of scope.';


-- =====================================================================================
-- 2. plm.nbcu_right -- the business allowlist and its restrictions.
--
-- Deliberately NOT foreign-keyed to a portal Property: one business right can cover many
-- portal rows, and some rights have no one-to-one portal card at all. Forcing an FK here
-- would silently drop rights that the licence actually grants.
-- =====================================================================================
create table plm.nbcu_right (
  capture_id           uuid    not null references plm.nbcu_capture(id) on delete restrict,
  right_key            text    not null,
  ordinal              integer not null,
  business_title       text    not null,
  rights_scope         text    not null,
  restriction_text     text        null,
  global_rule_applied  boolean not null default false,
  source_document      text    not null,
  raw                  jsonb   not null,

  constraint nbcu_right_pkey primary key (capture_id, right_key),
  constraint nbcu_right_ordinal_uk unique (capture_id, ordinal),
  constraint nbcu_right_scope_chk check (rights_scope in ('title','franchise','all_related')),
  constraint nbcu_right_ordinal_pos_chk check (ordinal > 0),
  constraint nbcu_right_key_fmt_chk check (right_key ~ '^rights-list:[0-9]{3}$'),
  constraint nbcu_right_title_chk check (btrim(business_title) <> ''),
  constraint nbcu_right_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_right is
  'NBCU''s licensed-rights statements and restrictions, independent of portal entities. '
  'No FK to a Property by design: one right can cover many portal rows. '
  'OPEN: the 75-line source document''s 75-to-57 parse rule is unstated, so `ordinal` '
  'cannot be produced yet. The loader is blocked on that rule; this table is not.';
comment on column plm.nbcu_right.rights_scope is
  'title | franchise | all_related. ''Franchise'' in the source means ALL related NBCU titles.';


-- =====================================================================================
-- 3. plm.nbcu_scope -- the 43 licensed portal search scopes and their paging evidence.
--
-- terminal and cardinality(missing_offsets)=0 are CHECKs, not advisory: a nonterminal
-- scope or a hole in the paging means the crawl did not finish, and a partial crawl
-- landed as if complete is the failure mode this whole design exists to prevent.
-- =====================================================================================
create table plm.nbcu_scope (
  capture_id      uuid      not null references plm.nbcu_capture(id) on delete restrict,
  scope_key       text      not null,
  scope_label     text      not null,
  scope_href      text      not null,
  page_count      integer   not null,
  indexed_rows    integer   not null,
  unique_assets   integer   not null,
  terminal        boolean   not null,
  missing_offsets integer[] not null default '{}'::integer[],
  source_files    jsonb     not null,
  raw             jsonb     not null,

  constraint nbcu_scope_pkey primary key (capture_id, scope_key),
  constraint nbcu_scope_href_uk unique (capture_id, scope_href),
  constraint nbcu_scope_key_fmt_chk check (scope_key ~ '^href-sha256:[0-9a-f]{64}$'),
  constraint nbcu_scope_counts_nonneg_chk
    check (page_count >= 0 and indexed_rows >= 0 and unique_assets >= 0),
  constraint nbcu_scope_terminal_chk check (terminal = true),
  constraint nbcu_scope_no_missing_offsets_chk check (cardinality(missing_offsets) = 0),
  constraint nbcu_scope_source_files_arr_chk check (jsonb_typeof(source_files) = 'array'),
  constraint nbcu_scope_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_scope is
  'One row per licensed portal search scope. terminal=true and zero missing offsets are '
  'enforced by CHECK: an unfinished crawl must not be landable. A search scope is NOT '
  'entitlement proof -- the portal returned unrelated assets that only detail-level '
  'Property metadata could exclude.';


-- =====================================================================================
-- 4. plm.nbcu_property -- account-picker rows AND exact asset-metadata Property labels,
--    held side by side without pretending they are already reconciled.
--
-- Key rule (spec section 6.4), enforced by CHECK below:
--   source id present -> property_key = 'source-id:' || property_source_id
--   otherwise         -> property_key = 'metadata-label-sha256:' || sha256(exact label)
-- Display labels are NOT stable identities and exact duplicate labels exist across
-- source kinds, which is why keying on the label is impossible here.
-- =====================================================================================
create table plm.nbcu_property (
  capture_id            uuid        not null references plm.nbcu_capture(id) on delete restrict,
  property_key          text        not null,
  property_source_id    text            null,
  property_label        text        not null,
  source_kind           text        not null,
  ip_family_source_key  text            null,
  ip_family_label       text            null,
  licensed_scope_label  text            null,
  source_url            text        not null,
  source_captured_at    timestamptz not null,
  raw                   jsonb       not null,

  core_property_id      uuid            null references core.property(id) on delete restrict,
  resolution_status     text        not null default 'unresolved',
  resolution_reason     text            null,
  resolved_at           timestamptz     null,
  resolved_by           text            null,

  constraint nbcu_property_pkey primary key (capture_id, property_key),
  constraint nbcu_property_source_kind_chk
    check (source_kind in ('property','franchise_asset','asset_metadata_label')),
  constraint nbcu_property_key_rule_chk
    check (
      case when property_source_id is not null
           then property_key = 'source-id:' || property_source_id
           else property_key like 'metadata-label-sha256:%'
      end
    ),
  constraint nbcu_property_label_chk check (btrim(property_label) <> ''),
  constraint nbcu_property_resolution_status_chk
    check (resolution_status in ('unresolved','matched','no_match','ambiguous','deferred')),
  constraint nbcu_property_resolved_pair_chk
    check ((resolution_status = 'matched') = (core_property_id is not null)),
  constraint nbcu_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

-- Unique only WHERE the source id exists: 98 of the 227 rows are metadata labels with
-- no source id, and a plain UNIQUE would collapse them all into one NULL-group row.
create unique index nbcu_property_source_id_uk
  on plm.nbcu_property (capture_id, property_source_id)
  where property_source_id is not null;

comment on table plm.nbcu_property is
  'NBCU Property records: account-picker rows (source_kind property | franchise_asset) '
  'AND exact asset-metadata Property labels (asset_metadata_label) that the picker never '
  'showed. Labels are stored byte-for-byte -- nothing is normalised, trimmed or corrected. '
  'Any normalised form belongs in a later view, never in this table. Ships fully '
  'unresolved: this migration matches nothing to core.property.';
comment on column plm.nbcu_property.core_property_id is
  'Nullable future reconciliation. NULL and unresolved at landing. Resolution is recorded '
  'on THIS row and must NEVER mutate a core.property row.';


-- =====================================================================================
-- 5. plm.nbcu_ip_family -- explicit IP Family labels. The portal exposed no reliable
--    source id for these, so the key is the hash of the exact label.
-- =====================================================================================
create table plm.nbcu_ip_family (
  capture_id      uuid  not null references plm.nbcu_capture(id) on delete restrict,
  ip_family_key   text  not null,
  ip_family_label text  not null,
  source_id       text      null,
  source_url      text  not null,
  raw             jsonb not null,

  constraint nbcu_ip_family_pkey primary key (capture_id, ip_family_key),
  constraint nbcu_ip_family_label_uk unique (capture_id, ip_family_label),
  constraint nbcu_ip_family_key_fmt_chk check (ip_family_key ~ '^label-sha256:[0-9a-f]{64}$'),
  constraint nbcu_ip_family_label_chk check (btrim(ip_family_label) <> ''),
  constraint nbcu_ip_family_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_ip_family is
  'IP Family labels, generated by the loader from the UNION of the asset metadata''s '
  'ip_family_labels and the ip-family-to-property evidence file. Keyed by label hash '
  'because this capture exposed no reliable IP Family source id.';


-- =====================================================================================
-- 6. plm.nbcu_character -- the authorized Character tag identities.
--
-- Key rule: source id when present, else id_fallback. NEVER the display name.
-- tag_namespace is PARSED FROM the source id and is therefore INTERPRETED, not source.
-- It is relationship evidence at family level; it is NOT proof that a given asset shows
-- a given character, and it may not be used to infer one.
-- =====================================================================================
create table plm.nbcu_character (
  capture_id          uuid        not null references plm.nbcu_capture(id) on delete restrict,
  character_key       text        not null,
  character_source_id text            null,
  character_label     text        not null,
  id_fallback         text            null,
  tag_namespace       text            null,
  source_url          text        not null,
  source_captured_at  timestamptz not null,
  raw                 jsonb       not null,

  core_character_id   uuid            null references core.character(id) on delete restrict,
  resolution_status   text        not null default 'unresolved',
  resolution_reason   text            null,
  resolved_at         timestamptz     null,
  resolved_by         text            null,

  constraint nbcu_character_pkey primary key (capture_id, character_key),
  constraint nbcu_character_key_rule_chk
    check (
      case when character_source_id is not null
           then character_key = character_source_id
           else character_key = id_fallback and id_fallback is not null
      end
    ),
  constraint nbcu_character_label_chk check (btrim(character_label) <> ''),
  constraint nbcu_character_resolution_status_chk
    check (resolution_status in ('unresolved','matched','no_match','ambiguous','deferred')),
  constraint nbcu_character_resolved_pair_chk
    check ((resolution_status = 'matched') = (core_character_id is not null)),
  constraint nbcu_character_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

create unique index nbcu_character_source_id_uk
  on plm.nbcu_character (capture_id, character_source_id)
  where character_source_id is not null;

comment on table plm.nbcu_character is
  'Authorized NBCU Character tags. The portal''s wider global tag vocabulary is larger; '
  'only the authorized namespaces land here as licensed characters. Keyed on source id '
  '(or the deterministic fallback), never on the display name.';
comment on column plm.nbcu_character.tag_namespace is
  'INTERPRETED, not a source field: parsed out of the source id. Family-level relationship '
  'evidence only. It must never be used to infer an asset-to-character link.';


-- =====================================================================================
-- 7. plm.nbcu_style_guide -- clearly labelled guide FOLDERS. Not canonical style guides.
--
-- NBCU exposed no style-guide source id, so the complete normalized folder path is the
-- only stable identity available. Do not strip a trailing 'guide', do not collapse
-- folders, and do NOT merge two guides that share a final folder name -- the full path
-- is the identity, and the unique constraint on folder_path enforces that.
-- =====================================================================================
create table plm.nbcu_style_guide (
  capture_id             uuid        not null references plm.nbcu_capture(id) on delete restrict,
  style_guide_key        text        not null,
  style_guide_source_id  text            null,
  style_guide_label      text        not null,
  folder_path            text        not null,
  identity_basis         text        not null default 'clearly_labelled_guide_folder',
  source_url             text        not null,
  source_captured_at     timestamptz not null,
  raw                    jsonb       not null,

  core_style_guide_id    uuid            null references core.style_guide(id) on delete restrict,
  resolution_status      text        not null default 'unresolved',
  resolution_reason      text            null,
  resolved_at            timestamptz     null,
  resolved_by            text            null,

  constraint nbcu_style_guide_pkey primary key (capture_id, style_guide_key),
  constraint nbcu_style_guide_folder_uk unique (capture_id, folder_path),
  constraint nbcu_style_guide_key_chk check (btrim(style_guide_key) <> ''),
  constraint nbcu_style_guide_folder_chk check (btrim(folder_path) <> ''),
  constraint nbcu_style_guide_label_chk check (btrim(style_guide_label) <> ''),
  constraint nbcu_style_guide_resolution_status_chk
    check (resolution_status in ('unresolved','matched','no_match','ambiguous','deferred')),
  constraint nbcu_style_guide_resolved_pair_chk
    check ((resolution_status = 'matched') = (core_style_guide_id is not null)),
  constraint nbcu_style_guide_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_style_guide is
  'NBCU guide FOLDERS, identified by the complete normalized folder path because the '
  'portal exposed no guide source id. These are NOT automatically core.style_guide rows '
  'and this migration promotes none of them.';


-- =====================================================================================
-- 8. plm.nbcu_asset -- one row per authorized asset path in a capture. No media bytes.
--
-- display_size and display_modified stay TEXT on purpose. The scrape carries the
-- portal's display strings, and display_modified can be raw milliseconds rather than a
-- formatted timestamp; casting either one here would destroy the source value and invent
-- a precision the portal never gave. Derived parsing belongs in a later view.
--
-- The seven jsonb list columns are the exact source arrays. They are NOT split on
-- punctuation -- NBCU names contain commas, apostrophes and curly quotes, so a delimited
-- string could not be losslessly restored. Every one is CHECKed to be a JSON array.
-- =====================================================================================
create table plm.nbcu_asset (
  capture_id              uuid        not null references plm.nbcu_capture(id) on delete restrict,
  asset_source_key        text        not null,
  asset_path              text        not null,
  file_name               text        not null,
  media_type              text            null,
  display_size            text            null,
  display_modified        text            null,
  studio_labels           jsonb       not null,
  ip_family_labels        jsonb       not null,
  property_labels         jsonb       not null,
  character_labels        jsonb       not null,
  restriction_labels      jsonb       not null,
  style_guide_natural_keys jsonb      not null,
  scope_paths             jsonb       not null,
  source_captured_at      timestamptz not null,
  source_url              text        not null,
  raw                     jsonb       not null,
  source_hash             text        not null,

  -- Nullable, and DELIBERATELY WITHOUT AN FK (orchestrator ruling, 2026-08-10, matching
  -- spec section 6.8): no canonical DAM asset table and key has been confirmed. An FK
  -- added to the wrong table costs a migration plus a data repair.
  dam_asset_id            uuid            null,
  resolution_status       text        not null default 'unresolved',
  resolution_reason       text            null,
  resolved_at             timestamptz     null,
  resolved_by             text            null,

  constraint nbcu_asset_pkey primary key (capture_id, asset_source_key),
  constraint nbcu_asset_path_uk unique (capture_id, asset_path),
  constraint nbcu_asset_file_name_chk check (btrim(file_name) <> ''),
  constraint nbcu_asset_path_chk check (btrim(asset_path) <> ''),
  constraint nbcu_asset_source_hash_chk check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint nbcu_asset_resolution_status_chk
    check (resolution_status in ('unresolved','matched','no_match','ambiguous','deferred')),
  constraint nbcu_asset_resolved_pair_chk
    check ((resolution_status = 'matched') = (dam_asset_id is not null)),
  constraint nbcu_asset_studio_labels_arr_chk    check (jsonb_typeof(studio_labels) = 'array'),
  constraint nbcu_asset_ip_family_labels_arr_chk check (jsonb_typeof(ip_family_labels) = 'array'),
  constraint nbcu_asset_property_labels_arr_chk  check (jsonb_typeof(property_labels) = 'array'),
  constraint nbcu_asset_character_labels_arr_chk check (jsonb_typeof(character_labels) = 'array'),
  constraint nbcu_asset_restriction_labels_arr_chk check (jsonb_typeof(restriction_labels) = 'array'),
  constraint nbcu_asset_guide_keys_arr_chk       check (jsonb_typeof(style_guide_natural_keys) = 'array'),
  constraint nbcu_asset_scope_paths_arr_chk      check (jsonb_typeof(scope_paths) = 'array'),
  constraint nbcu_asset_raw_obj_chk              check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_asset is
  'One row per authorized NBCU asset path in a capture. METADATA ONLY -- no artwork, '
  'preview, rendition, PDF or original media byte is stored or downloaded. The unrelated '
  'search results that the portal returned from retained broader search state are excluded '
  'upstream by detail-level Property metadata and must never be loaded.';
comment on column plm.nbcu_asset.display_modified is
  'The portal''s value AS TEXT. Not cast to timestamptz: the scrape may hold raw '
  'milliseconds rather than a formatted time, and casting would invent precision.';
comment on column plm.nbcu_asset.raw is
  'The exact source metadata object. Required even though typed columns exist: typed '
  'columns make common queries easy, `raw` is what prevents source loss when NBCU '
  'changes the portal.';
comment on column plm.nbcu_asset.dam_asset_id is
  'Nullable, NO foreign key by design. The canonical DAM asset table and key are not '
  'confirmed. Add the FK only after that confirmation.';


-- =====================================================================================
-- 9. plm.nbcu_asset_metadata_value -- every metadata heading and every repeated value.
--
-- This table is why a future NBCU portal change cannot silently lose data. A heading
-- nobody has seen before lands as a row here instead of being dropped for want of a
-- column. Headings with NO visible text but WITH attributes land with value_text NULL
-- and the attributes preserved. NEVER drop an unknown heading.
-- =====================================================================================
create table plm.nbcu_asset_metadata_value (
  capture_id       uuid    not null,
  asset_source_key text    not null,
  field_name       text    not null,
  value_ordinal    integer not null,
  value_text       text        null,
  value_attributes jsonb   not null default '{}'::jsonb,
  raw              jsonb   not null,

  constraint nbcu_asset_metadata_value_pkey
    primary key (capture_id, asset_source_key, field_name, value_ordinal),
  constraint nbcu_asset_metadata_value_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_metadata_value_field_chk check (btrim(field_name) <> ''),
  constraint nbcu_asset_metadata_value_ordinal_chk check (value_ordinal >= 0),
  constraint nbcu_asset_metadata_value_attrs_obj_chk check (jsonb_typeof(value_attributes) = 'object'),
  constraint nbcu_asset_metadata_value_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_asset_metadata_value is
  'Every asset metadata heading and every repeated value, in source ordinal order, with '
  'the heading''s EXACT source capitalization. Attribute-only headings land with NULL '
  'value_text and their attributes in value_attributes. An unknown heading is never dropped.';
comment on column plm.nbcu_asset_metadata_value.field_name is
  'The heading exactly as the portal wrote it, including capitalization. Not normalised.';


-- =====================================================================================
-- 10. plm.nbcu_asset_scope -- normalizes the many-to-many hidden inside the asset''s
--     scope_paths array, so "which scopes returned this asset" is a join, not a jsonb scan.
-- =====================================================================================
create table plm.nbcu_asset_scope (
  capture_id       uuid not null,
  asset_source_key text not null,
  scope_key        text not null,
  evidence_type    text not null default 'search_scope_returned_asset',

  constraint nbcu_asset_scope_pkey primary key (capture_id, asset_source_key, scope_key),
  constraint nbcu_asset_scope_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_scope_scope_fkey
    foreign key (capture_id, scope_key)
    references plm.nbcu_scope (capture_id, scope_key) on delete restrict,
  constraint nbcu_asset_scope_evidence_chk check (btrim(evidence_type) <> '')
);

comment on table plm.nbcu_asset_scope is
  'Asset-to-search-scope evidence. Both FKs carry capture_id, so an edge can never point '
  'across two snapshots.';


-- =====================================================================================
-- 11-16. The six evidence-bearing relationship tables.
--
-- Every one of them carries capture_id in BOTH composite foreign keys. That is the whole
-- point: without it an edge could join a 2026-08-09 asset to a 2027 property and the
-- corruption would be invisible. Every one keeps the source evidence_value rather than
-- reducing it to a boolean -- evidence is a source fact and survives matching.
--
-- Endpoint labels are stored WHERE THE SOURCE FILE SUPPLIES THEM. Asset and guide
-- endpoints arrive as keys, so they have no label column; property, character and IP
-- family endpoints arrive as labels that the loader resolves to this snapshot''s keys.
-- Ambiguous label resolution must REJECT the capture, never guess.
-- =====================================================================================

-- 11. IP Family -> Property.
create table plm.nbcu_ip_family_property (
  capture_id         uuid        not null,
  ip_family_key      text        not null,
  property_key       text        not null,
  ip_family_label    text        not null,
  property_label     text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_ip_family_property_pkey primary key (capture_id, ip_family_key, property_key),
  constraint nbcu_ip_family_property_family_fkey
    foreign key (capture_id, ip_family_key)
    references plm.nbcu_ip_family (capture_id, ip_family_key) on delete restrict,
  constraint nbcu_ip_family_property_property_fkey
    foreign key (capture_id, property_key)
    references plm.nbcu_property (capture_id, property_key) on delete restrict,
  constraint nbcu_ip_family_property_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_ip_family_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

-- 12. Property (or franchise-asset Property) -> Character.
create table plm.nbcu_property_character (
  capture_id         uuid        not null,
  property_key       text        not null,
  character_key      text        not null,
  property_label     text        not null,
  character_label    text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_property_character_pkey primary key (capture_id, property_key, character_key),
  constraint nbcu_property_character_property_fkey
    foreign key (capture_id, property_key)
    references plm.nbcu_property (capture_id, property_key) on delete restrict,
  constraint nbcu_property_character_character_fkey
    foreign key (capture_id, character_key)
    references plm.nbcu_character (capture_id, character_key) on delete restrict,
  constraint nbcu_property_character_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_property_character_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_property_character is
  'Property-to-Character evidence. The left endpoint MAY be a franchise_asset Property '
  'row: NBCU''s Character tag namespace proves a family-level relationship, and forcing '
  'it onto a single picker Property would misstate the source.';

-- 13. Asset -> Property. The largest edge table in the capture.
create table plm.nbcu_asset_property (
  capture_id         uuid        not null,
  asset_source_key   text        not null,
  property_key       text        not null,
  property_label     text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_asset_property_pkey primary key (capture_id, asset_source_key, property_key),
  constraint nbcu_asset_property_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_property_property_fkey
    foreign key (capture_id, property_key)
    references plm.nbcu_property (capture_id, property_key) on delete restrict,
  constraint nbcu_asset_property_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_asset_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_asset_property is
  'Asset-to-Property evidence, taken from detail-level metadata. This is the relation '
  'that proved which search results were unrelated and had to be excluded.';

-- 14. Asset -> Character. EMPTY BY EVIDENCE for the 2026-08-09 capture.
create table plm.nbcu_asset_character (
  capture_id         uuid        not null,
  asset_source_key   text        not null,
  character_key      text        not null,
  character_label    text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_asset_character_pkey primary key (capture_id, asset_source_key, character_key),
  constraint nbcu_asset_character_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_character_character_fkey
    foreign key (capture_id, character_key)
    references plm.nbcu_character (capture_id, character_key) on delete restrict,
  constraint nbcu_asset_character_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_asset_character_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_asset_character is
  'Asset-to-Character evidence. THE 2026-08-09 CAPTURE HAS ZERO ROWS AND THAT IS THE '
  'CORRECT ANSWER: asset details exposed no Character field, so the count is zero by '
  'evidence, not because the scrape forgot it. The table exists precisely so that the '
  'finalization gate can assert an explicit ZERO rather than "file missing". Do NOT infer '
  'edges here from a Character tag namespace or from a file name.';

-- 15. Asset -> guide folder.
create table plm.nbcu_asset_style_guide (
  capture_id         uuid        not null,
  asset_source_key   text        not null,
  style_guide_key    text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_asset_style_guide_pkey primary key (capture_id, asset_source_key, style_guide_key),
  constraint nbcu_asset_style_guide_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_style_guide_guide_fkey
    foreign key (capture_id, style_guide_key)
    references plm.nbcu_style_guide (capture_id, style_guide_key) on delete restrict,
  constraint nbcu_asset_style_guide_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_asset_style_guide_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

-- 16. Guide folder -> Property.
create table plm.nbcu_style_guide_property (
  capture_id         uuid        not null,
  style_guide_key    text        not null,
  property_key       text        not null,
  property_label     text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_style_guide_property_pkey primary key (capture_id, style_guide_key, property_key),
  constraint nbcu_style_guide_property_guide_fkey
    foreign key (capture_id, style_guide_key)
    references plm.nbcu_style_guide (capture_id, style_guide_key) on delete restrict,
  constraint nbcu_style_guide_property_property_fkey
    foreign key (capture_id, property_key)
    references plm.nbcu_property (capture_id, property_key) on delete restrict,
  constraint nbcu_style_guide_property_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_style_guide_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);


-- =====================================================================================
-- INDEXES (spec section 6.12). Only the proven set -- nothing indexed blindly.
--
-- Postgres indexes a composite PK left-to-right, so (capture_id, X) lookups are already
-- covered. What is NOT covered is the REVERSE direction on every composite FK, which is
-- what a delete-check and every "find all edges touching this entity" query needs.
-- =====================================================================================

create index idx_nbcu_capture_status_captured
  on plm.nbcu_capture (status, source_captured_at desc);

create index idx_nbcu_right_capture on plm.nbcu_right (capture_id);
create index idx_nbcu_scope_capture on plm.nbcu_scope (capture_id);
create index idx_nbcu_property_capture on plm.nbcu_property (capture_id);
create index idx_nbcu_ip_family_capture on plm.nbcu_ip_family (capture_id);
create index idx_nbcu_character_capture on plm.nbcu_character (capture_id);
create index idx_nbcu_style_guide_capture on plm.nbcu_style_guide (capture_id);
create index idx_nbcu_asset_capture on plm.nbcu_asset (capture_id);

-- Case-insensitive label lookup. NEVER unique: NBCU legitimately reuses labels across
-- source kinds, and a unique index here would reject a valid capture.
create index idx_nbcu_property_lower_label   on plm.nbcu_property   (lower(property_label));
create index idx_nbcu_ip_family_lower_label  on plm.nbcu_ip_family  (lower(ip_family_label));
create index idx_nbcu_character_lower_label  on plm.nbcu_character  (lower(character_label));
create index idx_nbcu_style_guide_lower_label on plm.nbcu_style_guide (lower(style_guide_label));

create index idx_nbcu_asset_file_name  on plm.nbcu_asset (file_name);
create index idx_nbcu_asset_media_type on plm.nbcu_asset (media_type);

create index idx_nbcu_asset_raw_gin                on plm.nbcu_asset using gin (raw);
create index idx_nbcu_asset_property_labels_gin    on plm.nbcu_asset using gin (property_labels);
create index idx_nbcu_asset_ip_family_labels_gin   on plm.nbcu_asset using gin (ip_family_labels);
create index idx_nbcu_asset_restriction_labels_gin on plm.nbcu_asset using gin (restriction_labels);
create index idx_nbcu_asset_scope_paths_gin        on plm.nbcu_asset using gin (scope_paths);

create index idx_nbcu_asset_metadata_value_field
  on plm.nbcu_asset_metadata_value (field_name, value_text);

-- Reverse FK direction on the edge tables.
create index idx_nbcu_asset_scope_scope
  on plm.nbcu_asset_scope (capture_id, scope_key);
create index idx_nbcu_ip_family_property_property
  on plm.nbcu_ip_family_property (capture_id, property_key);
create index idx_nbcu_property_character_character
  on plm.nbcu_property_character (capture_id, character_key);
create index idx_nbcu_asset_property_property
  on plm.nbcu_asset_property (capture_id, property_key);
create index idx_nbcu_asset_character_character
  on plm.nbcu_asset_character (capture_id, character_key);
create index idx_nbcu_asset_style_guide_guide
  on plm.nbcu_asset_style_guide (capture_id, style_guide_key);
create index idx_nbcu_style_guide_property_property
  on plm.nbcu_style_guide_property (capture_id, property_key);

-- Partial indexes on the nullable canonical-resolution FKs and on unresolved rows.
-- Partial because release 1 resolves NOTHING: a full index would be 100% dead weight.
create index idx_nbcu_property_core_property
  on plm.nbcu_property (core_property_id) where core_property_id is not null;
create index idx_nbcu_character_core_character
  on plm.nbcu_character (core_character_id) where core_character_id is not null;
create index idx_nbcu_style_guide_core_style_guide
  on plm.nbcu_style_guide (core_style_guide_id) where core_style_guide_id is not null;
create index idx_nbcu_asset_dam_asset
  on plm.nbcu_asset (dam_asset_id) where dam_asset_id is not null;

create index idx_nbcu_property_unmatched
  on plm.nbcu_property (resolution_status) where resolution_status <> 'matched';
create index idx_nbcu_character_unmatched
  on plm.nbcu_character (resolution_status) where resolution_status <> 'matched';
create index idx_nbcu_style_guide_unmatched
  on plm.nbcu_style_guide (resolution_status) where resolution_status <> 'matched';
create index idx_nbcu_asset_unmatched
  on plm.nbcu_asset (resolution_status) where resolution_status <> 'matched';


-- =====================================================================================
-- FUNCTIONS (spec section 7).
--
-- Both are `security definer` with a pinned search_path, execute REVOKED from public and
-- granted ONLY to service_role. They are the sole write path to plm.nbcu_capture, which
-- service_role can only read.
-- =====================================================================================

create or replace function plm.begin_nbcu_capture(
  p_capture_key            text,
  p_source_repository      text,
  p_source_commit_sha      text,
  p_source_manifest_sha256 text,
  p_portal_base_url        text,
  p_source_captured_at     timestamptz,
  p_expected_counts        jsonb,
  p_raw_summary            jsonb,
  p_created_by             text,
  p_read_commit_sha        text default null
) returns uuid
language plpgsql
security definer
set search_path = plm, core, pg_temp
as $$
declare
  v_existing plm.nbcu_capture%rowtype;
  v_id       uuid;
begin
  -- Validate before touching anything. A malformed argument must fail here, loudly,
  -- rather than land a half-described capture that the finalization gate then has to
  -- reason about.
  if p_capture_key is null or btrim(p_capture_key) = '' then
    raise exception 'begin_nbcu_capture: capture_key is required';
  end if;
  if p_source_repository is null or btrim(p_source_repository) = '' then
    raise exception 'begin_nbcu_capture: source_repository is required';
  end if;
  if p_source_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'begin_nbcu_capture: source_commit_sha must be a 40-character lowercase hex sha';
  end if;
  if p_read_commit_sha is not null and p_read_commit_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'begin_nbcu_capture: read_commit_sha must be a 40-character lowercase hex sha';
  end if;
  if p_source_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'begin_nbcu_capture: source_manifest_sha256 must be a 64-character lowercase hex sha';
  end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts) <> 'object'
     or p_expected_counts = '{}'::jsonb then
    raise exception 'begin_nbcu_capture: expected_counts must be a non-empty JSON object';
  end if;
  if p_raw_summary is null or jsonb_typeof(p_raw_summary) <> 'object' then
    raise exception 'begin_nbcu_capture: raw_summary must be a JSON object';
  end if;
  if p_source_captured_at is null then
    raise exception 'begin_nbcu_capture: source_captured_at is required';
  end if;
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'begin_nbcu_capture: created_by is required';
  end if;

  -- Serialize concurrent starts of the SAME capture_key. Two loader processes racing
  -- here would otherwise both miss the select and both insert.
  perform pg_advisory_xact_lock(hashtextextended('plm.nbcu_capture:' || p_capture_key, 0));

  select * into v_existing from plm.nbcu_capture where capture_key = p_capture_key;

  if found then
    -- Same key, different bytes, is a CONTRADICTION, not a resume. Refuse it: silently
    -- appending different source data under an existing capture key would make the
    -- snapshot unreconstructable.
    if v_existing.source_manifest_sha256 is distinct from p_source_manifest_sha256 then
      raise exception
        'begin_nbcu_capture: capture_key % already exists with a DIFFERENT source manifest hash; refusing',
        p_capture_key;
    end if;
    if v_existing.source_commit_sha is distinct from p_source_commit_sha then
      raise exception
        'begin_nbcu_capture: capture_key % already exists with a DIFFERENT source commit sha; refusing',
        p_capture_key;
    end if;

    if v_existing.status = 'complete' then
      -- Idempotent: hand back the finished capture untouched. Never re-open it.
      return v_existing.id;
    elsif v_existing.status = 'loading' then
      -- Resume. Only the loader''s own read commit may be refreshed.
      update plm.nbcu_capture
         set read_commit_sha = coalesce(p_read_commit_sha, read_commit_sha)
       where id = v_existing.id;
      return v_existing.id;
    else
      raise exception
        'begin_nbcu_capture: capture_key % is %; start a NEW capture rather than reusing it',
        p_capture_key, v_existing.status;
    end if;
  end if;

  insert into plm.nbcu_capture (
    capture_key, source_repository, source_commit_sha, read_commit_sha,
    source_manifest_sha256, portal_base_url, source_captured_at,
    status, expected_counts, raw_summary, created_by
  ) values (
    p_capture_key, p_source_repository, p_source_commit_sha, p_read_commit_sha,
    p_source_manifest_sha256, p_portal_base_url, p_source_captured_at,
    'loading', p_expected_counts, p_raw_summary, p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function plm.begin_nbcu_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,text) is
  'Creates or RESUMES exactly one loading NBCU capture. Idempotent for an identical '
  'capture. Refuses to re-open a complete capture and refuses a same-key capture whose '
  'source manifest or commit differs. Sole write path to plm.nbcu_capture on insert. '
  'service_role only.';


create or replace function plm.finalize_nbcu_capture(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = plm, core, pg_temp
as $$
declare
  v_cap      plm.nbcu_capture%rowtype;
  v_exp      jsonb;
  v_obs      jsonb;
  v_err      jsonb := '[]'::jsonb;
  v_n        bigint;
  v_want     bigint;
  v_key      text;
  v_pairs    text[][] := array[
    ['assets','nbcu_asset'], ['properties','nbcu_property'], ['characters','nbcu_character'],
    ['style_guides','nbcu_style_guide'], ['scopes','nbcu_scope'],
    ['ip_family_property','nbcu_ip_family_property'],
    ['property_character','nbcu_property_character'],
    ['asset_property','nbcu_asset_property'],
    ['asset_character','nbcu_asset_character'],
    ['asset_style_guide','nbcu_asset_style_guide'],
    ['style_guide_property','nbcu_style_guide_property']
  ];
  i integer;
begin
  select * into v_cap from plm.nbcu_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_nbcu_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error.
    return jsonb_build_object('capture_id', p_capture_id, 'status', 'complete',
                              'observed_counts', v_cap.observed_counts, 'already_complete', true);
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_nbcu_capture: capture % is %, not loading', p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;
  v_obs := '{}'::jsonb;

  -- ---- A. Every entity and edge count must equal what the source contract expects.
  -- Counted from the TABLES, never from a ledger or a summary document. This repository
  -- has shipped a migration that recorded a clean ledger row while its object did nothing,
  -- so "it reported success" is not accepted as evidence of anything.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    else
      v_want := (v_exp ->> v_key)::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;
  end loop;

  -- ---- B. Scope paging must be complete. Belt and braces over the table CHECKs.
  select count(*) into v_n from plm.nbcu_scope
   where capture_id = p_capture_id and (terminal is not true or cardinality(missing_offsets) <> 0);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','nonterminal_or_gapped_scope','count',v_n);
  end if;

  -- ---- C. Capture-level invariants that are scope rules, not counts.
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;
  if (v_exp ? 'excluded_unlicensed_assets')
     and v_cap.excluded_unlicensed_assets <> (v_exp ->> 'excluded_unlicensed_assets')::integer then
    v_err := v_err || jsonb_build_object('code','excluded_unlicensed_mismatch',
               'expected',(v_exp ->> 'excluded_unlicensed_assets')::integer,
               'observed', v_cap.excluded_unlicensed_assets);
  end if;
  if (v_exp ? 'failures') and (v_exp ->> 'failures')::integer <> 0 then
    v_err := v_err || jsonb_build_object('code','expected_failures_nonzero');
  end if;

  -- ---- D. Every asset must carry at least one metadata-value row. An asset that landed
  -- with no metadata means the detail expansion silently produced nothing for it.
  select count(*) into v_n
    from plm.nbcu_asset a
   where a.capture_id = p_capture_id
     and not exists (select 1 from plm.nbcu_asset_metadata_value m
                      where m.capture_id = a.capture_id
                        and m.asset_source_key = a.asset_source_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_without_metadata_value','count',v_n);
  end if;
  select count(*) into v_n from plm.nbcu_asset_metadata_value where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('asset_metadata_values', v_n);

  select count(*) into v_n from plm.nbcu_asset_scope where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('asset_scopes', v_n);
  select count(*) into v_n from plm.nbcu_right where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('rights', v_n);

  -- ---- E. Relationship endpoints. The composite FKs already make a cross-capture edge
  -- impossible, so this is an assertion that they are still in force, not a substitute
  -- for them. It is cheap and it fails loudly if a future migration weakens a constraint.
  select count(*) into v_n
    from plm.nbcu_asset_property l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.nbcu_asset a
                       where a.capture_id = l.capture_id and a.asset_source_key = l.asset_source_key)
       or not exists (select 1 from plm.nbcu_property p
                       where p.capture_id = l.capture_id and p.property_key = l.property_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_property_link','count',v_n);
  end if;

  -- ---- F. No relationship may cite a Property label that the snapshot never landed.
  -- This is the check that would have caught the unrelated search results if the
  -- upstream exclusion had ever failed.
  select count(*) into v_n
    from plm.nbcu_asset_property l
    left join plm.nbcu_property p
      on p.capture_id = l.capture_id and p.property_key = l.property_key
   where l.capture_id = p_capture_id
     and (p.property_label is null or p.property_label is distinct from l.property_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','unknown_or_mismatched_property_label','count',v_n);
  end if;

  -- ---- Verdict. There is no partial publish: either every check passed or the capture
  -- is rejected and the PREVIOUS complete capture stays current.
  --
  -- WHY THIS RETURNS INSTEAD OF RAISING, AND WHY THAT IS NOT A WEAKENING.
  -- Spec section 7 asks for BOTH "set status='rejected', record structured errors" AND
  -- "raise an exception". In PostgreSQL those two instructions destroy each other: the
  -- exception aborts the very transaction that wrote the rejection row, so the evidence
  -- is rolled back and the capture is left sitting in `loading` with no record of why it
  -- failed. That directly defeats the spec's own auditability goal. It is an impossibility
  -- in the spec, not a choice, and it is FLAGGED in the pull request.
  -- The safety property the spec actually wants is "never partially publish", and that is
  -- fully preserved: the capture is marked `rejected`, it is not `complete`, no
  -- current-capture reader will ever select it, and the previous complete capture stays
  -- current. The failure is loud in three ways at once -- a WARNING in the server log, a
  -- persisted `rejected` status, and a returned status of 'rejected' the loader must check.
  --
  if jsonb_array_length(v_err) > 0 then
    update plm.nbcu_capture
       set status = 'rejected', observed_counts = v_obs, error_summary = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning 'finalize_nbcu_capture: capture % REJECTED with % error(s)',
      p_capture_id, jsonb_array_length(v_err);
    return jsonb_build_object('capture_id', p_capture_id, 'status', 'rejected',
                              'observed_counts', v_obs, 'errors', v_err,
                              'already_complete', false);
  end if;

  update plm.nbcu_capture
     set status = 'complete', observed_counts = v_obs,
         error_summary = '[]'::jsonb, load_completed_at = now()
   where id = p_capture_id;

  return jsonb_build_object('capture_id', p_capture_id, 'status', 'complete',
                            'observed_counts', v_obs, 'already_complete', false);
end;
$$;

comment on function plm.finalize_nbcu_capture(uuid) is
  'The publication gate. In ONE transaction it counts every entity and edge table for the '
  'capture, checks scope completeness, the media-zero and exclusion invariants, that every '
  'asset has metadata, and that no edge is orphaned or cites an unknown Property label. All '
  'pass -> status complete. Any fail -> status rejected, structured errors PERSISTED, a '
  'server WARNING raised, and a jsonb whose status is ''rejected'' returned; the previous '
  'complete capture is left untouched. NEVER a partial publish. THE CALLER MUST CHECK THE '
  'RETURNED status -- it does not raise, because raising would roll back the very rejection '
  'record the spec asks it to keep (see the comment in the function body). The expected zero '
  'for asset-to-character is a normal pass, not a special case. service_role only.';


-- =====================================================================================
-- RLS, GRANTS, AND THE IMMUTABILITY MECHANISM (spec section 8).
--
-- An RLS policy is not a GRANT and a GRANT is not an RLS policy (AGENTS.md section 11).
-- Both are set here. Note that Supabase''s service_role carries BYPASSRLS, so RLS alone
-- could NOT constrain the loader -- the GRANTS are what actually enforce immutability,
-- which is exactly why privilege separation was chosen over an RLS or trigger guard.
--
--   plm.nbcu_capture   -> service_role: SELECT only. All writes go through the two
--                         security-definer functions.
--   the other 15       -> service_role: SELECT + INSERT. No UPDATE. No DELETE.
--                         Rows are immutable the moment they land.
--   anon               -> nothing, revoked explicitly.
--   authenticated      -> nothing in release 1. Licensed source material is not exposed
--                         to the browser until there is an explicit access decision.
-- =====================================================================================
do $$
declare
  t text;
  tables text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'
  ];
begin
  foreach t in array tables loop
    -- ENABLE, deliberately NOT FORCE. FORCE would apply RLS to the table owner too,
    -- which locks the migration runner and every psql/contract-test session out of its
    -- own tables for no security gain -- service_role is the identity being constrained
    -- and it is constrained by the GRANTS, not by RLS.
    execute format('alter table plm.%I enable row level security', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('revoke all on plm.%I from authenticated', t);

    if t = 'nbcu_capture' then
      execute format('grant select on plm.%I to service_role', t);
    else
      execute format('grant select, insert on plm.%I to service_role', t);
    end if;

    -- One permissive policy so that a future BYPASSRLS-less service identity can still
    -- read. It grants nothing on its own: without the GRANT above, SELECT still fails.
    execute format(
      'create policy %I on plm.%I for select to service_role using (true)',
      t || '_service_read', t);
  end loop;
end;
$$;

revoke all on function plm.begin_nbcu_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,text) from public;
revoke all on function plm.finalize_nbcu_capture(uuid) from public;
grant execute on function plm.begin_nbcu_capture(text,text,text,text,text,timestamptz,jsonb,jsonb,text,text) to service_role;
grant execute on function plm.finalize_nbcu_capture(uuid) to service_role;
