-- =====================================================================================
-- Warner Bros. STARLABS source extract -- landing schema and guarded importers.
--
-- Migration: 20260810030000_warner_starlabs_source_landing.sql
-- Issue:     #588 (load the extract); #583 (which of two extracts is authoritative)
-- Claim:     #627 -- this migration owns the plm.wb_* namespace and NOTHING else.
-- Contract:  docs/licensor-portal-scrape-source-schema-20260807.md (written in this PR).
-- Source:    PRIVATE repo u2giants/licensor-source-data, warner-bros/, pinned at
--            main commit 9092c51afc42c080f199e5784451425810c39316
--            (warner-bros/ tree a9056fe9058a317bbfb18238c367cf4d4c642f05).
--
-- GENERATED FILE. Authored from a single spec so that all eight importers are
-- structurally identical; edit deliberately and keep them consistent.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
-- -------------------------------------------------------------------------------
-- The STARLABS extract is business-confidential Warner Bros. data held under a
-- commercial licensing relationship. This repository (u2giants/shared-db) is PUBLIC.
-- Materialising 147,537 Warner asset rows -- or ANY Warner title, property name,
-- character name, asset id or file name -- as INSERTs in supabase/migrations/ would
-- put them permanently in public git history. It is FORBIDDEN here and everywhere:
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime through the plm.sync_wb_* importers below, fed a jsonb
-- snapshot by a tool that reads the CSVs from the PRIVATE repo. No Warner row, and
-- no Warner string, appears anywhere in this file.
--
-- Depends on (exact 14-digit versions):
--   20260621150815  app_core                       -- core.property (resolution FK only)
--   20260724030000  coldlion phase1 mirror schema  -- the plm.erp_* mirror pattern
--   20260807170000  opa property/character landing -- the licensor-landing pattern
--                                                     this deliberately mirrors
--
-- =====================================================================================
-- THE FRANCHISE-vs-PROPERTY TRAP -- READ BEFORE ADDING ANY OBJECT HERE
-- =====================================================================================
-- Warner exposes Franchise and Property as SEPARATE levels, and this schema is built
-- so that the difference SURVIVES the load. Three link objects are deliberately
-- ABSENT, and their absence is the point:
--
--   *  NO franchise -> property table, view, index or join.
--   *  NO style-guide -> property table, view, index or join.
--   *  NO style-guide -> character table, view, index or join.
--
-- None of those three relationships is a Warner record. Each could only be
-- manufactured by joining two rows that happen to share an asset. Warner's portal was
-- audited page by page on 2026-08-07 -- Home, Product, Packaging, Marketing, Jobs, Art
-- Assets, Licensee Help, plus the loaded submission-app code -- and NO page and NO
-- read operation exposed a direct style-guide-to-property or style-guide-to-character
-- relationship. Art Assets implements Property, Style Guide and Character as three
-- INDEPENDENT asset filters.
--
-- Two things appearing on the same asset is not Warner stating that they are linked.
-- Once such a link is stored it is indistinguishable from a real one, forever, and no
-- later reader can tell which rows Warner asserted and which we inferred. So the
-- object that would hold it is never created.
--
-- The exact traps the source files set:
--
--   plm.wb_franchise_property is ONE FLAT IDENTITY LIST, not a hierarchy. Warner's own
--   Art Assets filter is literally labelled "Franchise / Property" -- a single combined
--   filter spanning both levels -- and source_term preserves which portal surface each
--   row came from. The table has NO parent column, NO franchise_id and NO
--   self-reference, because the source asserts no parentage. Do not add one.
--
--   plm.wb_asset_franchise_property links an ASSET to a franchise-or-property value.
--   It never links a franchise to a property. Self-joining it on asset_source_id would
--   fabricate exactly the edge Warner does not publish. Do not write that join and do
--   not create a view containing it.
--
--   plm.wb_asset.franchise_labels, .property_labels and .character_labels are Warner's
--   packed multi-value display strings, stored VERBATIM and deliberately NOT parsed.
--   They are provenance, not relationships. The three link tables are the only
--   authoritative asset relationships. Do not split these columns into edges.
--
--   plm.wb_property_character is the ONLY direct Warner property-to-character record
--   here. It comes from the Product submission page, where Warner itself returns a
--   character array FOR a selected property. All 4,158 rows of the pinned snapshot
--   carry real Warner ids on both endpoints (id_fallback = false, pinned by a CHECK).
--
-- =====================================================================================
-- Objects created (the whole of claim #627, and nothing outside it):
--   8 tables      plm.wb_franchise_property, plm.wb_style_guide, plm.wb_character,
--                 plm.wb_asset, plm.wb_asset_style_guide,
--                 plm.wb_asset_franchise_property, plm.wb_asset_character,
--                 plm.wb_property_character
--   1 predicate   plm.wb_loader_privilege_ok(text, text)
--   8 importers   plm.sync_wb_<entity>(jsonb, text, numeric)
--   8 wrappers    public.sync_wb_<entity>(jsonb, text, numeric)
--   2 views       api.wb_property_character, api.wb_property_reconciliation
--   plus indexes, RLS policies and grants on the eight tables.
--
-- NOTHING in core.* is created, altered, populated or dropped. The single core
-- reference is a NULLABLE resolution FK on plm.wb_property_character.property_id,
-- which records OUR reconciliation on the LANDING row and never mutates core. Whether
-- Warner's 4,158 pairs feed the same canonical table as Disney's is an OPEN OWNER
-- DECISION and has deliberately been given no code path here.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. plm.wb_franchise_property -- Franchise / Property IDENTITIES (Art Assets filter values + Product Property choices)
--    Source: warner-bros/franchise-properties.csv -- 341 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_franchise_property (
  source_term         text         not null,
  source_id           text         not null default '',
  label               text         not null,
  visible_asset_count integer      null,
  captured_date       date         not null,
  source_url          text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                 jsonb        not null,
  source_hash         text         not null,
  first_seen_at       timestamptz  not null default now(),
  last_seen_at        timestamptz  not null default now(),
  imported_at         timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint wb_franchise_property_pkey primary key (source_term, source_id, label),
  constraint wb_franchise_property_label_chk check (btrim(label) <> ''),
  constraint wb_franchise_property_term_chk
    check (source_term in ('Franchise / Property', 'Property'))
);

create index idx_wb_franchise_property_label
  on plm.wb_franchise_property (label);
create index idx_wb_franchise_property_source_id
  on plm.wb_franchise_property (source_id) where source_id <> '';

alter table plm.wb_franchise_property enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_franchise_property_read on plm.wb_franchise_property
  for select to authenticated using (true);

grant select on plm.wb_franchise_property to authenticated;
grant select, insert, update, delete on plm.wb_franchise_property to service_role;
revoke all on plm.wb_franchise_property from anon;

-- -------------------------------------------------------------------------------------
-- 2. plm.wb_style_guide -- Style-guide IDENTITIES
--    Source: warner-bros/style-guides.csv -- 2,310 rows at the pinned commit, 2,304 after the
--    documented natural-key collapse (see the importer).
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_style_guide (
  style_guide_natural_key text         not null,
  source_term             text         not null,
  source_id               text         not null default '',
  visible_asset_count     integer      null,
  captured_date           date         not null,
  source_url              text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                     jsonb        not null,
  source_hash             text         not null,
  first_seen_at           timestamptz  not null default now(),
  last_seen_at            timestamptz  not null default now(),
  imported_at             timestamptz  not null default now(),
  updated_at              timestamptz  not null default now(),

  constraint wb_style_guide_pkey primary key (style_guide_natural_key),
  constraint wb_style_guide_key_chk check (btrim(style_guide_natural_key) <> ''),
  constraint wb_style_guide_term_chk check (source_term = 'Style Guide'),
  constraint wb_style_guide_source_id_chk check (source_id = '')
);

alter table plm.wb_style_guide enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_style_guide_read on plm.wb_style_guide
  for select to authenticated using (true);

grant select on plm.wb_style_guide to authenticated;
grant select, insert, update, delete on plm.wb_style_guide to service_role;
revoke all on plm.wb_style_guide from anon;

-- -------------------------------------------------------------------------------------
-- 3. plm.wb_character -- Character IDENTITIES (Art Assets filter values + Product Character choices)
--    Source: warner-bros/characters.csv -- 4,301 rows at the pinned commit, 4,299 after the
--    documented natural-key collapse (see the importer).
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_character (
  source_term         text         not null,
  source_id           text         not null default '',
  label               text         not null,
  visible_asset_count integer      null,
  captured_date       date         not null,
  source_url          text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                 jsonb        not null,
  source_hash         text         not null,
  first_seen_at       timestamptz  not null default now(),
  last_seen_at        timestamptz  not null default now(),
  imported_at         timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint wb_character_pkey primary key (source_term, source_id, label),
  constraint wb_character_label_chk check (btrim(label) <> ''),
  constraint wb_character_term_chk check (source_term = 'Character')
);

create index idx_wb_character_label
  on plm.wb_character (label);
create index idx_wb_character_source_id
  on plm.wb_character (source_id) where source_id <> '';

alter table plm.wb_character enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_character_read on plm.wb_character
  for select to authenticated using (true);

grant select on plm.wb_character to authenticated;
grant select, insert, update, delete on plm.wb_character to service_role;
revoke all on plm.wb_character from anon;

-- -------------------------------------------------------------------------------------
-- 4. plm.wb_asset -- Asset METADATA ONLY (no asset content was ever downloaded)
--    Source: warner-bros/assets.csv -- 147,537 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_asset (
  asset_source_id         text         not null,
  file_name               text         not null,
  source_path             text         not null,
  season                  text         null,
  property_labels         text         not null,
  franchise_labels        text         not null,
  style_guide_source_id   text         not null default '',
  style_guide_natural_key text         null,
  character_labels        text         not null,
  modified_date           timestamptz  null,
  created_date            timestamptz  null,
  captured_date           date         not null,
  source_url              text         not null,
  warner_asset_id         text         null,
  file_size_bytes         bigint       null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                     jsonb        not null,
  source_hash             text         not null,
  first_seen_at           timestamptz  not null default now(),
  last_seen_at            timestamptz  not null default now(),
  imported_at             timestamptz  not null default now(),
  updated_at              timestamptz  not null default now(),

  constraint wb_asset_pkey primary key (asset_source_id),
  constraint wb_asset_source_id_chk check (btrim(asset_source_id) <> ''),
  constraint wb_asset_file_size_chk
    check (file_size_bytes is null or file_size_bytes >= 0)
);

create index idx_wb_asset_style_guide_natural_key
  on plm.wb_asset (style_guide_natural_key) where style_guide_natural_key is not null;
create index idx_wb_asset_warner_asset_id
  on plm.wb_asset (warner_asset_id) where warner_asset_id is not null;

alter table plm.wb_asset enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_asset_read on plm.wb_asset
  for select to authenticated using (true);

grant select on plm.wb_asset to authenticated;
grant select, insert, update, delete on plm.wb_asset to service_role;
revoke all on plm.wb_asset from anon;

-- -------------------------------------------------------------------------------------
-- 5. plm.wb_asset_style_guide -- DIRECT asset -> style-guide links
--    Source: warner-bros/links-asset-style-guide.csv -- 147,484 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_asset_style_guide (
  asset_source_id         text         not null,
  style_guide_natural_key text         not null,
  style_guide_source_id   text         not null default '',
  file_name               text         not null,
  captured_date           date         not null,
  source_url              text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                     jsonb        not null,
  source_hash             text         not null,
  first_seen_at           timestamptz  not null default now(),
  last_seen_at            timestamptz  not null default now(),
  imported_at             timestamptz  not null default now(),
  updated_at              timestamptz  not null default now(),

  constraint wb_asset_style_guide_pkey primary key (asset_source_id, style_guide_natural_key),
  constraint wb_asset_style_guide_key_chk
    check (btrim(style_guide_natural_key) <> '')
);

create index idx_wb_asset_style_guide_style_guide_natural_key
  on plm.wb_asset_style_guide (style_guide_natural_key);

alter table plm.wb_asset_style_guide enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_asset_style_guide_read on plm.wb_asset_style_guide
  for select to authenticated using (true);

grant select on plm.wb_asset_style_guide to authenticated;
grant select, insert, update, delete on plm.wb_asset_style_guide to service_role;
revoke all on plm.wb_asset_style_guide from anon;

-- -------------------------------------------------------------------------------------
-- 6. plm.wb_asset_franchise_property -- DIRECT asset -> Franchise/Property links
--    Source: warner-bros/links-asset-franchise-property.csv -- 335,946 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_asset_franchise_property (
  asset_source_id              text         not null,
  franchise_property_source_id text         not null default '',
  franchise_property_label     text         not null,
  file_name                    text         not null,
  captured_date                date         not null,
  source_url                   text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                          jsonb        not null,
  source_hash                  text         not null,
  first_seen_at                timestamptz  not null default now(),
  last_seen_at                 timestamptz  not null default now(),
  imported_at                  timestamptz  not null default now(),
  updated_at                   timestamptz  not null default now(),

  constraint wb_asset_franchise_property_pkey primary key (asset_source_id, franchise_property_source_id, franchise_property_label),
  constraint wb_asset_fp_label_chk check (btrim(franchise_property_label) <> '')
);

create index idx_wb_asset_franchise_property_target
  on plm.wb_asset_franchise_property (franchise_property_source_id, franchise_property_label);

alter table plm.wb_asset_franchise_property enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_asset_franchise_property_read on plm.wb_asset_franchise_property
  for select to authenticated using (true);

grant select on plm.wb_asset_franchise_property to authenticated;
grant select, insert, update, delete on plm.wb_asset_franchise_property to service_role;
revoke all on plm.wb_asset_franchise_property from anon;

-- -------------------------------------------------------------------------------------
-- 7. plm.wb_asset_character -- DIRECT asset -> character links
--    Source: warner-bros/links-asset-character.csv -- 51,036 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_asset_character (
  asset_source_id     text         not null,
  character_source_id text         not null,
  character_label     text         not null,
  file_name           text         not null,
  captured_date       date         not null,
  source_url          text         not null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                 jsonb        not null,
  source_hash         text         not null,
  first_seen_at       timestamptz  not null default now(),
  last_seen_at        timestamptz  not null default now(),
  imported_at         timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint wb_asset_character_pkey primary key (asset_source_id, character_source_id),
  constraint wb_asset_character_id_chk check (btrim(character_source_id) <> '')
);

create index idx_wb_asset_character_character_source_id
  on plm.wb_asset_character (character_source_id);

alter table plm.wb_asset_character enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_asset_character_read on plm.wb_asset_character
  for select to authenticated using (true);

grant select on plm.wb_asset_character to authenticated;
grant select, insert, update, delete on plm.wb_asset_character to service_role;
revoke all on plm.wb_asset_character from anon;

-- -------------------------------------------------------------------------------------
-- 8. plm.wb_property_character -- THE ONE DIRECT WARNER PROPERTY -> CHARACTER RECORD
--    Source: warner-bros/links-property-character.csv -- 4,158 rows at the pinned commit.
--    Warner's strings are stored EXACTLY as the portal supplied them: nothing is
--    normalised, split, trimmed or corrected here. Interpretation belongs in api.*.
-- -------------------------------------------------------------------------------------
create table plm.wb_property_character (
  property_source_id  text         not null,
  property_label      text         not null,
  character_source_id text         not null,
  character_label     text         not null,
  id_fallback         boolean      not null,
  captured_at         timestamptz  not null,
  source_url          text         not null,

  -- Reconciliation, recorded on the LANDING row only. ALL NULL/unresolved at
  -- landing: this migration resolves nothing and NEVER mutates a core.property row.
  property_id         uuid         null     references core.property(id) on delete restrict,
  resolution_status   text         not null default 'unresolved',
  resolution_reason   text         null,
  resolved_at         timestamptz  null,
  resolved_by         text         null,

  -- Mirror convention, matching plm.erp_* and plm.opa_property_character.
  raw                 jsonb        not null,
  source_hash         text         not null,
  first_seen_at       timestamptz  not null default now(),
  last_seen_at        timestamptz  not null default now(),
  imported_at         timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint wb_property_character_pkey primary key (property_source_id, character_source_id),
  constraint wb_property_character_property_chk
    check (btrim(property_source_id) <> ''),
  constraint wb_property_character_character_chk
    check (btrim(character_source_id) <> ''),
  constraint wb_property_character_id_fallback_chk check (id_fallback = false),
  constraint wb_property_character_resolution_status_chk
    check (resolution_status in
      ('unresolved','matched','ambiguous','no_match','rejected'))
);

create index idx_wb_property_character_property_source_id
  on plm.wb_property_character (property_source_id);
create index idx_wb_property_character_character_source_id
  on plm.wb_property_character (character_source_id);
create index idx_wb_property_character_property_id
  on plm.wb_property_character (property_id) where property_id is not null;
create index idx_wb_property_character_resolution_status
  on plm.wb_property_character (resolution_status);

alter table plm.wb_property_character enable row level security;

-- Posture matches plm.opa_property_character: RLS on, exactly one read policy,
-- select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
create policy wb_property_character_read on plm.wb_property_character
  for select to authenticated using (true);

grant select on plm.wb_property_character to authenticated;
grant select, insert, update, delete on plm.wb_property_character to service_role;
revoke all on plm.wb_property_character from anon;

comment on table plm.wb_franchise_property is
  'RAW Warner Bros. STARLABS Franchise/Property IDENTITY list. ONE FLAT LIST, NOT A '
  'HIERARCHY: Warner exposes Franchise and Property as SEPARATE levels and its own '
  'Art Assets filter is labelled "Franchise / Property", a single combined filter '
  'over both. This table therefore has NO parent column and NO self-reference, '
  'because the source asserts no parentage -- DO NOT ADD ONE, and do not derive one '
  'by self-joining plm.wb_asset_franchise_property on a shared asset. source_term '
  'records which portal surface a row came from: "Franchise / Property" is the Art '
  'Assets filter, "Property" is the Product submission page. SCOPE: the signed-in POP '
  'Creations licensee account and its current entitlements ONLY -- this is NOT '
  'Warner''s global catalogue. Point-in-time snapshot, no change feed. '
  'Business-confidential Warner Bros. data: never commit a row of it to this PUBLIC '
  'repository. Loaded at runtime by plm.sync_wb_franchise_property, never by a seed.';

comment on table plm.wb_style_guide is
  'RAW Warner Bros. STARLABS style-guide IDENTITY list. Warner exposed NO style-guide '
  'id on ANY of the 2,310 captured rows, so the LABEL is the only available natural '
  'key and source_id is pinned empty by a CHECK constraint -- a future extract that '
  'does carry an id will fail LOUDLY rather than land under an unverified assumption. '
  'THERE IS DELIBERATELY NO style-guide-to-property AND NO style-guide-to-character '
  'TABLE: the 2026-08-07 page-by-page portal audit found no Warner page or read '
  'operation exposing either relationship, so any such link could only be inferred '
  'from a shared asset and would be indistinguishable from a real one once stored. '
  'SCOPE: POP Creations licensee entitlement only, point-in-time. Loaded at runtime '
  'by plm.sync_wb_style_guide.';

comment on table plm.wb_character is
  'RAW Warner Bros. STARLABS character IDENTITY list, combining Art Assets filter '
  'values with Product submission choices (source_term distinguishes them). THE LABEL '
  'IS NOT AN IDENTITY: 495 labels in the pinned snapshot carry more than one distinct '
  'Warner UUID (the portal exposes two separate UUIDs both labelled the same, proven '
  'by narrow one-result searches to point at different assets, properties and style '
  'guides). Match on source_id, never on label, and DO NOT DEDUPE repeated labels. 97 '
  'rows carry no Warner id at all and hold source_id = '''' . SCOPE: POP Creations '
  'licensee entitlement only, point-in-time. Loaded at runtime by '
  'plm.sync_wb_character.';

comment on table plm.wb_asset is
  'RAW Warner Bros. STARLABS asset METADATA. NO ASSET CONTENT WAS EVER DOWNLOADED -- '
  'no artwork, PDF, video or style-guide document. The columns property_labels, '
  'franchise_labels and character_labels are Warner''s PACKED MULTI-VALUE DISPLAY '
  'STRINGS, stored verbatim and deliberately NOT parsed: they are provenance, not '
  'relationships. DO NOT SPLIT THEM INTO EDGES -- plm.wb_asset_franchise_property, '
  'plm.wb_asset_style_guide and plm.wb_asset_character are the only authoritative '
  'asset relationships. style_guide_source_id was empty on all 147,537 rows; the '
  'style guide is identified by natural key only. SCOPE: POP Creations licensee '
  'entitlement only, point-in-time. Business-confidential Warner Bros. data: never '
  'commit a row of it to this PUBLIC repository. Loaded at runtime by '
  'plm.sync_wb_asset.';

comment on table plm.wb_asset_style_guide is
  'DIRECT Warner asset-to-style-guide links, taken from the Art Assets details view '
  'where the style guide is a field ON the asset record. This is a real Warner '
  'relationship. It is NOT evidence of a style-guide-to-property or '
  'style-guide-to-character relationship: deriving either by joining through a shared '
  'asset produces an INFERRED link that Warner never published, and no such object '
  'exists in this schema. In the pinned snapshot asset_source_id alone was unique '
  'across all 147,484 rows (one style guide per asset); the key is nevertheless the '
  'PAIR so a future multi-valued capture needs no migration. Loaded at runtime by '
  'plm.sync_wb_asset_style_guide.';

comment on table plm.wb_asset_franchise_property is
  'DIRECT Warner asset-to-Franchise/Property links from the Art Assets details view. '
  'THIS LINKS AN ASSET TO A FRANCHISE-OR-PROPERTY VALUE AND NEVER A FRANCHISE TO A '
  'PROPERTY. SELF-JOINING THIS TABLE ON asset_source_id WOULD FABRICATE the '
  'franchise-to-property edge that Warner does not publish; do not write that join '
  'and do not create a view containing it. One asset may carry many links (335,946 '
  'links over 147,537 assets in the pinned snapshot). 58 rows carry no Warner id and '
  'hold franchise_property_source_id = '''', which is why the label is part of the '
  'key. Loaded at runtime by plm.sync_wb_asset_franchise_property.';

comment on table plm.wb_asset_character is
  'DIRECT Warner asset-to-character links from the Art Assets details view, where '
  'Character is a field ON the asset record. A real Warner relationship. Covers only '
  'the 35,533 assets that exposed a character value; absence of a character on an '
  'asset is recorded as missing, never guessed. Match characters on '
  'character_source_id, never on character_label (labels are not unique -- see '
  'plm.wb_character). Loaded at runtime by plm.sync_wb_asset_character.';

comment on table plm.wb_property_character is
  'THE ONE DIRECT WARNER PROPERTY-TO-CHARACTER RECORD in this schema, and the only '
  'place a Warner property and a Warner character are joined. Captured from the '
  'Product submission page, where Warner ITSELF returns a character array for a '
  'selected Property via its own field lookup -- so this is Warner asserting the '
  'relationship, not us inferring it from asset co-occurrence. All 4,158 rows of the '
  'pinned 2026-08-07 snapshot carry real Warner ids on BOTH endpoints (id_fallback = '
  'false, pinned by a CHECK so a label-derived fallback extract fails loudly). Covers '
  'all 165 entitled properties. The crawl read the component''s fully loaded '
  'character array, not the 20 rows the menu happened to render. SCOPE WARNING: one '
  'entitled contract and its territories, POP Creations licensee account only -- NOT '
  'Warner''s global catalogue, and authoritative for what it ASSERTS while SILENT '
  'about what it OMITS. The resolution columns are OUR reconciliation, recorded here '
  'and NEVER mutating a core.property row; whether these pairs feed a canonical table '
  'is an OPEN OWNER DECISION with no code path.';

comment on column plm.wb_franchise_property.source_term is
  'Which STARLABS surface this identity came from. "Franchise / Property" is '
  'Warner''s OWN combined Art Assets filter label spanning BOTH levels; "Property" is '
  'the Product submission page. Part of the key because the two surfaces are captured '
  'separately. This column does NOT say whether the row is a franchise or a property '
  '-- Warner does not tell us, and nothing here should pretend otherwise.';

comment on column plm.wb_franchise_property.source_id is
  'Warner''s UUID when the portal exposed one, else '''' (empty string, never NULL, '
  'so it can sit in the primary key). 100 of the 341 pinned rows have no id; 99 of '
  'those repeat the label of an id-bearing row and are an earlier label-only capture '
  'pass. They are kept VERBATIM rather than merged, because merging would be our '
  'interpretation -- resolve them in a view, not in this landing table.';

comment on column plm.wb_franchise_property.visible_asset_count is
  'Warner''s displayed asset count for this filter value at capture time, NULL when '
  'the portal showed none. A UI artefact of the signed-in entitlement, not a '
  'catalogue total. DO NOT BUILD LOGIC ON THIS COLUMN.';

comment on column plm.wb_style_guide.style_guide_natural_key is
  'Warner''s style-guide display label, verbatim, and the ONLY key available because '
  'Warner exposed no style-guide id anywhere. 6 labels appeared twice in the pinned '
  'capture, each as one row with an asset count plus one row without; the importer '
  'collapses those pairs keeping the greater count and reports the collapse.';

comment on column plm.wb_style_guide.source_id is
  'Pinned to '''' by CHECK: Warner exposed NO style-guide id on any of the 2,310 '
  'rows. If a future extract carries one, WIDEN THIS IN A NEW MIGRATION with a '
  'recorded reason so the change is deliberate. Do not drop the constraint to make a '
  'load pass.';

comment on column plm.wb_character.source_id is
  'Warner''s character UUID, or '''' on the 97 rows where the portal exposed none. '
  'THE IDENTITY, and the only safe match key. 4,204 distinct UUIDs, each mapping to '
  'exactly one label.';

comment on column plm.wb_character.label is
  'Warner''s character display label, verbatim. NOT UNIQUE and NOT AN IDENTITY: 495 '
  'labels carry more than one distinct Warner UUID. Repeated labels were proven by '
  'narrow one-result searches to point at genuinely different assets, properties and '
  'style guides, so they must NOT be deduped or collapsed.';

comment on column plm.wb_asset.property_labels is
  'Warner''s PACKED MULTI-VALUE property display string, verbatim and UNPARSED. '
  'Provenance only. The authoritative asset relationship lives in '
  'plm.wb_asset_franchise_property. DO NOT SPLIT THIS INTO EDGES.';

comment on column plm.wb_asset.franchise_labels is
  'Warner''s PACKED MULTI-VALUE franchise display string, verbatim and UNPARSED. Only '
  '9 distinct values across 147,537 assets, which is what a FRANCHISE level looks '
  'like next to 241 property identities -- concrete evidence that Franchise and '
  'Property are different levels and must not be collapsed. Provenance only. DO NOT '
  'SPLIT INTO EDGES and DO NOT PAIR WITH property_labels to manufacture a '
  'franchise-to-property link.';

comment on column plm.wb_asset.character_labels is
  'Warner''s PACKED MULTI-VALUE character display string, verbatim and UNPARSED. '
  'Provenance only; plm.wb_asset_character is authoritative. DO NOT SPLIT INTO EDGES.';

comment on column plm.wb_asset.style_guide_source_id is
  'Empty on all 147,537 pinned rows -- Warner exposes no style-guide id. Kept so the '
  'column exists if Warner ever supplies one. Use style_guide_natural_key.';

comment on column plm.wb_asset.warner_asset_id is
  'Warner''s own asset identifier where the details view exposed one; NULL on 94,389 '
  'of the 147,537 pinned rows. Absence is recorded as missing, never guessed.';

comment on column plm.wb_asset_franchise_property.franchise_property_source_id is
  'Warner''s UUID for the linked Franchise/Property value, or '''' on the 58 pinned '
  'rows where none was exposed. Part of the key alongside the label for exactly that '
  'reason. This is an ASSET endpoint reference; it does not place the value in any '
  'hierarchy.';

comment on column plm.wb_property_character.id_fallback is
  'Warner supplied real ids on both endpoints (false) rather than the crawl falling '
  'back to label matching (true). FALSE on all 4,158 pinned rows and pinned by CHECK, '
  'so an extract that degraded to label matching fails LOUDLY instead of landing '
  'label-derived pairs that look exactly like id-backed Warner records.';

comment on column plm.wb_property_character.property_id is
  'Nullable reconciliation to core.property. NULL and unresolved at landing. '
  'Resolution is recorded on THIS row and must NEVER mutate a core.property row. '
  'Expect a LOW match rate and do not treat it as a defect: core.property mirrors '
  'POP''s ColdLion taxonomy while this carries Warner''s licensable property names.';

-- -------------------------------------------------------------------------------------
-- 9. plm.wb_loader_privilege_ok -- the shared privilege predicate for all eight loaders.
--
-- A callable function rather than an inline check for two reasons, both learned on the
-- Disney OPA build:
--   (a) An anonymous DO block never lands in pg_proc, so a contract test cannot call it
--       and cannot prove it rejects anything. This predicate is directly testable.
--   (b) It takes SESSION_USER, not CURRENT_USER. SECURITY DEFINER rewrites current_user
--       to the function OWNER, so a current_user check inside a definer function always
--       passes and guards nothing. session_user is the real login role and is unaffected.
--
-- Contract: TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity. Every other
-- input, including NULL on both arguments, returns FALSE.
-- -------------------------------------------------------------------------------------
create or replace function plm.wb_loader_privilege_ok(
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

comment on function plm.wb_loader_privilege_ok(text, text) is
'Privilege predicate shared by all eight Warner STARLABS loaders. TRUE only for a '
'NON-NULL, positively matched identity: JWT role service_role, or session_user '
'postgres/supabase_admin. NULL/empty on both arguments returns FALSE. Written as a '
'callable function rather than a DO block so a contract test can prove the NULL case is '
'REJECTED. Takes SESSION_USER because SECURITY DEFINER rewrites current_user to the '
'function owner, making a current_user check useless.';

revoke all on function plm.wb_loader_privilege_ok(text, text) from public;
grant execute on function plm.wb_loader_privilege_ok(text, text) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 10. plm.sync_wb_franchise_property -- guarded MIRROR-ONLY importer for plm.wb_franchise_property
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/franchise-properties.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 341 source rows
--    and lands 341. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_franchise_property(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_franchise_property. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_franchise_property')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'source_term', '')) = ''
     or btrim(coalesce(r.value ->> 'label', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_franchise_property. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'source_term')                                            as source_term,
    coalesce(r.value ->> 'source_id', '')                                  as source_id,
    (r.value ->> 'label')                                                  as label,
    nullif(btrim(coalesce(r.value ->> 'visible_asset_count', '')), '')::integer as visible_asset_count,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL-KEY COLLAPSE. This identity list was captured in more than one
  --     pass, so the same identity can appear twice -- once with Warner's asset
  --     count and once without. Those are the SAME identity, not two, and the
  --     collapse keeps the greater count. It is REPORTED as rows_collapsed so a
  --     change in the collapse volume is visible rather than silent.
  create temporary table _wb_incoming on commit drop as
  select distinct on (source_term, source_id, label) *
  from _wb_raw
  order by source_term, source_id, label, visible_asset_count desc nulls last;

  select count(*) into v_landed from _wb_incoming;
  v_coll := v_seen - v_landed;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 341 or v_landed <> 341) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of franchise-properties.csv must carry '
      'exactly 341 source rows landing 341, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_franchise_property;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_franchise_property. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_franchise_property t on t.source_term = i.source_term and t.source_id = i.source_id and t.label = i.label
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_franchise_property t on t.source_term = i.source_term and t.source_id = i.source_id and t.label = i.label
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_franchise_property as t (
    source_term, source_id, label, visible_asset_count, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.source_term, i.source_id, i.label, i.visible_asset_count, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (source_term, source_id, label) do update set
    visible_asset_count          = excluded.visible_asset_count,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_franchise_property t
  where not exists (select 1 from _wb_incoming i where i.source_term = t.source_term and i.source_id = t.source_id and i.label = t.label);

  v_orphan := 0;  -- identity table: nothing to be orphaned against.

  raise notice 'Warner wb_franchise_property import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_franchise_property(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS franchise-properties.csv '
'extract into plm.wb_franchise_property. Exists INSTEAD OF a seed migration because '
'this repository is PUBLIC and the extract is confidential Warner Bros. data: schema '
'in git, data out of git. Guards: positively-matched privilege, mode, advisory lock, '
'snapshot shape, non-empty rows, explicit captured_at, per-row required fields, '
'natural-key collapse, the pinned 2026-08-07 baseline row count, and a shrink band. '
'Writes ONLY plm.wb_franchise_property. NEVER writes core.*, and NEVER deletes: '
'absence is reported as rows_missing. Error text deliberately echoes no Warner value, '
'because logs are not private.';

create or replace function public.sync_wb_franchise_property(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_franchise_property(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_franchise_property(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_franchise_property so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_franchise_property(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_franchise_property(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_franchise_property(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_franchise_property(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 11. plm.sync_wb_style_guide -- guarded MIRROR-ONLY importer for plm.wb_style_guide
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/style-guides.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 2,310 source rows
--    and lands 2,304 after the natural-key collapse. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_style_guide(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_style_guide. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_style_guide')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'label', '')) = ''
     or btrim(coalesce(r.value ->> 'source_term', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_style_guide. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'label')                                                  as style_guide_natural_key,
    (r.value ->> 'source_term')                                            as source_term,
    coalesce(r.value ->> 'source_id', '')                                  as source_id,
    nullif(btrim(coalesce(r.value ->> 'visible_asset_count', '')), '')::integer as visible_asset_count,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL-KEY COLLAPSE. This identity list was captured in more than one
  --     pass, so the same identity can appear twice -- once with Warner's asset
  --     count and once without. Those are the SAME identity, not two, and the
  --     collapse keeps the greater count. It is REPORTED as rows_collapsed so a
  --     change in the collapse volume is visible rather than silent.
  create temporary table _wb_incoming on commit drop as
  select distinct on (style_guide_natural_key) *
  from _wb_raw
  order by style_guide_natural_key, visible_asset_count desc nulls last;

  select count(*) into v_landed from _wb_incoming;
  v_coll := v_seen - v_landed;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 2310 or v_landed <> 2304) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of style-guides.csv must carry '
      'exactly 2310 source rows landing 2304, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_style_guide;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_style_guide. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_style_guide t on t.style_guide_natural_key = i.style_guide_natural_key
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_style_guide t on t.style_guide_natural_key = i.style_guide_natural_key
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_style_guide as t (
    style_guide_natural_key, source_term, source_id, visible_asset_count, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.style_guide_natural_key, i.source_term, i.source_id, i.visible_asset_count, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (style_guide_natural_key) do update set
    source_term                  = excluded.source_term,
    source_id                    = excluded.source_id,
    visible_asset_count          = excluded.visible_asset_count,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_style_guide t
  where not exists (select 1 from _wb_incoming i where i.style_guide_natural_key = t.style_guide_natural_key);

  v_orphan := 0;  -- identity table: nothing to be orphaned against.

  raise notice 'Warner wb_style_guide import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_style_guide(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS style-guides.csv extract into '
'plm.wb_style_guide. Exists INSTEAD OF a seed migration because this repository is '
'PUBLIC and the extract is confidential Warner Bros. data: schema in git, data out of '
'git. Guards: positively-matched privilege, mode, advisory lock, snapshot shape, '
'non-empty rows, explicit captured_at, per-row required fields, natural-key collapse, '
'the pinned 2026-08-07 baseline row count, and a shrink band. Writes ONLY '
'plm.wb_style_guide. NEVER writes core.*, and NEVER deletes: absence is reported as '
'rows_missing. Error text deliberately echoes no Warner value, because logs are not '
'private.';

create or replace function public.sync_wb_style_guide(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_style_guide(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_style_guide(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_style_guide so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_style_guide(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_style_guide(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_style_guide(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_style_guide(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 12. plm.sync_wb_character -- guarded MIRROR-ONLY importer for plm.wb_character
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/characters.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 4,301 source rows
--    and lands 4,299 after the natural-key collapse. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_character. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_character')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'source_term', '')) = ''
     or btrim(coalesce(r.value ->> 'label', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_character. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'source_term')                                            as source_term,
    coalesce(r.value ->> 'source_id', '')                                  as source_id,
    (r.value ->> 'label')                                                  as label,
    nullif(btrim(coalesce(r.value ->> 'visible_asset_count', '')), '')::integer as visible_asset_count,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL-KEY COLLAPSE. This identity list was captured in more than one
  --     pass, so the same identity can appear twice -- once with Warner's asset
  --     count and once without. Those are the SAME identity, not two, and the
  --     collapse keeps the greater count. It is REPORTED as rows_collapsed so a
  --     change in the collapse volume is visible rather than silent.
  create temporary table _wb_incoming on commit drop as
  select distinct on (source_term, source_id, label) *
  from _wb_raw
  order by source_term, source_id, label, visible_asset_count desc nulls last;

  select count(*) into v_landed from _wb_incoming;
  v_coll := v_seen - v_landed;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 4301 or v_landed <> 4299) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of characters.csv must carry '
      'exactly 4301 source rows landing 4299, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_character;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_character. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_character t on t.source_term = i.source_term and t.source_id = i.source_id and t.label = i.label
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_character t on t.source_term = i.source_term and t.source_id = i.source_id and t.label = i.label
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_character as t (
    source_term, source_id, label, visible_asset_count, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.source_term, i.source_id, i.label, i.visible_asset_count, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (source_term, source_id, label) do update set
    visible_asset_count          = excluded.visible_asset_count,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_character t
  where not exists (select 1 from _wb_incoming i where i.source_term = t.source_term and i.source_id = t.source_id and i.label = t.label);

  v_orphan := 0;  -- identity table: nothing to be orphaned against.

  raise notice 'Warner wb_character import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_character(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS characters.csv extract into '
'plm.wb_character. Exists INSTEAD OF a seed migration because this repository is '
'PUBLIC and the extract is confidential Warner Bros. data: schema in git, data out of '
'git. Guards: positively-matched privilege, mode, advisory lock, snapshot shape, '
'non-empty rows, explicit captured_at, per-row required fields, natural-key collapse, '
'the pinned 2026-08-07 baseline row count, and a shrink band. Writes ONLY '
'plm.wb_character. NEVER writes core.*, and NEVER deletes: absence is reported as '
'rows_missing. Error text deliberately echoes no Warner value, because logs are not '
'private.';

create or replace function public.sync_wb_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_character(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_character(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_character so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_character(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_character(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_character(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 13. plm.sync_wb_asset -- guarded MIRROR-ONLY importer for plm.wb_asset
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/assets.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 147,537 source rows
--    and lands 147,537. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_asset(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_asset. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_asset')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'asset_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'file_name', '')) = ''
     or btrim(coalesce(r.value ->> 'source_path', '')) = ''
     or btrim(coalesce(r.value ->> 'property_labels', '')) = ''
     or btrim(coalesce(r.value ->> 'franchise_labels', '')) = ''
     or btrim(coalesce(r.value ->> 'character_labels', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_asset. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'asset_source_id')                                        as asset_source_id,
    (r.value ->> 'file_name')                                              as file_name,
    (r.value ->> 'source_path')                                            as source_path,
    nullif(btrim(coalesce(r.value ->> 'season', '')), '')                  as season,
    (r.value ->> 'property_labels')                                        as property_labels,
    (r.value ->> 'franchise_labels')                                       as franchise_labels,
    coalesce(r.value ->> 'style_guide_source_id', '')                      as style_guide_source_id,
    nullif(btrim(coalesce(r.value ->> 'style_guide_natural_key', '')), '') as style_guide_natural_key,
    (r.value ->> 'character_labels')                                       as character_labels,
    nullif(btrim(coalesce(r.value ->> 'modified_date', '')), '')::timestamptz as modified_date,
    nullif(btrim(coalesce(r.value ->> 'created_date', '')), '')::timestamptz as created_date,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    nullif(btrim(coalesce(r.value ->> 'warner_asset_id', '')), '')         as warner_asset_id,
    nullif(btrim(coalesce(r.value ->> 'file_size_bytes', '')), '')::bigint as file_size_bytes,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL KEY. A duplicate key inside one snapshot is a real defect in the
  --     extract, not a tie to be broken by last-write-wins. Abort instead.
  select count(*) into v_dupes from (
    select 1 from _wb_raw group by asset_source_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Warner import refused: % duplicate natural key(s) inside one '
      'snapshot for plm.wb_asset. The key must be unique; a duplicate means the extract is '
      'wrong, not that a winner should be chosen.', v_dupes using errcode = 'P0001';
  end if;

  create temporary table _wb_incoming on commit drop as select * from _wb_raw;
  v_landed := v_seen;
  v_coll   := 0;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 147537 or v_landed <> 147537) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of assets.csv must carry '
      'exactly 147537 source rows landing 147537, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_asset;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_asset. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_asset t on t.asset_source_id = i.asset_source_id
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_asset t on t.asset_source_id = i.asset_source_id
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_asset as t (
    asset_source_id, file_name, source_path, season, property_labels, franchise_labels, style_guide_source_id, style_guide_natural_key, character_labels, modified_date, created_date, captured_date, source_url, warner_asset_id, file_size_bytes, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.asset_source_id, i.file_name, i.source_path, i.season, i.property_labels, i.franchise_labels, i.style_guide_source_id, i.style_guide_natural_key, i.character_labels, i.modified_date, i.created_date, i.captured_date, i.source_url, i.warner_asset_id, i.file_size_bytes, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (asset_source_id) do update set
    file_name                    = excluded.file_name,
    source_path                  = excluded.source_path,
    season                       = excluded.season,
    property_labels              = excluded.property_labels,
    franchise_labels             = excluded.franchise_labels,
    style_guide_source_id        = excluded.style_guide_source_id,
    style_guide_natural_key      = excluded.style_guide_natural_key,
    character_labels             = excluded.character_labels,
    modified_date                = excluded.modified_date,
    created_date                 = excluded.created_date,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    warner_asset_id              = excluded.warner_asset_id,
    file_size_bytes              = excluded.file_size_bytes,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_asset t
  where not exists (select 1 from _wb_incoming i where i.asset_source_id = t.asset_source_id);

  v_orphan := 0;  -- identity table: nothing to be orphaned against.

  raise notice 'Warner wb_asset import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_asset(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS assets.csv extract into '
'plm.wb_asset. Exists INSTEAD OF a seed migration because this repository is PUBLIC '
'and the extract is confidential Warner Bros. data: schema in git, data out of git. '
'Guards: positively-matched privilege, mode, advisory lock, snapshot shape, non-empty '
'rows, explicit captured_at, per-row required fields, natural-key uniqueness, the '
'pinned 2026-08-07 baseline row count, and a shrink band. Writes ONLY plm.wb_asset. '
'NEVER writes core.*, and NEVER deletes: absence is reported as rows_missing. Error '
'text deliberately echoes no Warner value, because logs are not private.';

create or replace function public.sync_wb_asset(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_asset(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_asset(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_asset so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_asset(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_asset(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_asset(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_asset(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 14. plm.sync_wb_asset_style_guide -- guarded MIRROR-ONLY importer for plm.wb_asset_style_guide
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/links-asset-style-guide.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 147,484 source rows
--    and lands 147,484. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_asset_style_guide(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_asset_style_guide. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_asset_style_guide')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'asset_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'style_guide_natural_key', '')) = ''
     or btrim(coalesce(r.value ->> 'file_name', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_asset_style_guide. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'asset_source_id')                                        as asset_source_id,
    (r.value ->> 'style_guide_natural_key')                                as style_guide_natural_key,
    coalesce(r.value ->> 'style_guide_source_id', '')                      as style_guide_source_id,
    (r.value ->> 'file_name')                                              as file_name,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL KEY. A duplicate key inside one snapshot is a real defect in the
  --     extract, not a tie to be broken by last-write-wins. Abort instead.
  select count(*) into v_dupes from (
    select 1 from _wb_raw group by asset_source_id, style_guide_natural_key having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Warner import refused: % duplicate natural key(s) inside one '
      'snapshot for plm.wb_asset_style_guide. The key must be unique; a duplicate means the extract is '
      'wrong, not that a winner should be chosen.', v_dupes using errcode = 'P0001';
  end if;

  create temporary table _wb_incoming on commit drop as select * from _wb_raw;
  v_landed := v_seen;
  v_coll   := 0;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 147484 or v_landed <> 147484) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of links-asset-style-guide.csv must carry '
      'exactly 147484 source rows landing 147484, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_asset_style_guide;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_asset_style_guide. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_asset_style_guide t on t.asset_source_id = i.asset_source_id and t.style_guide_natural_key = i.style_guide_natural_key
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_asset_style_guide t on t.asset_source_id = i.asset_source_id and t.style_guide_natural_key = i.style_guide_natural_key
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_asset_style_guide as t (
    asset_source_id, style_guide_natural_key, style_guide_source_id, file_name, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.asset_source_id, i.style_guide_natural_key, i.style_guide_source_id, i.file_name, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (asset_source_id, style_guide_natural_key) do update set
    style_guide_source_id        = excluded.style_guide_source_id,
    file_name                    = excluded.file_name,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_asset_style_guide t
  where not exists (select 1 from _wb_incoming i where i.asset_source_id = t.asset_source_id and i.style_guide_natural_key = t.style_guide_natural_key);

  -- Referential report ONLY. There is deliberately NO foreign key between these
  -- landing tables: the loaders are per-entity, so an FK would make load ORDER a
  -- hidden requirement and turn a routine refresh into a failure. Orphans are
  -- COUNTED and returned so the condition is loud instead of invisible. In the
  -- pinned snapshot this is 0 for every link table.
  select count(*) into v_orphan from _wb_incoming i
  where (not exists (select 1 from plm.wb_asset t where i.asset_source_id = t.asset_source_id))
     or (not exists (select 1 from plm.wb_style_guide t where i.style_guide_natural_key = t.style_guide_natural_key));

  raise notice 'Warner wb_asset_style_guide import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_asset_style_guide(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS links-asset-style-guide.csv '
'extract into plm.wb_asset_style_guide. Exists INSTEAD OF a seed migration because '
'this repository is PUBLIC and the extract is confidential Warner Bros. data: schema '
'in git, data out of git. Guards: positively-matched privilege, mode, advisory lock, '
'snapshot shape, non-empty rows, explicit captured_at, per-row required fields, '
'natural-key uniqueness, the pinned 2026-08-07 baseline row count, and a shrink band. '
'Writes ONLY plm.wb_asset_style_guide. NEVER writes core.*, and NEVER deletes: '
'absence is reported as rows_missing. Error text deliberately echoes no Warner value, '
'because logs are not private.';

create or replace function public.sync_wb_asset_style_guide(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_asset_style_guide(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_asset_style_guide(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_asset_style_guide so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_asset_style_guide(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_asset_style_guide(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_asset_style_guide(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_asset_style_guide(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 15. plm.sync_wb_asset_franchise_property -- guarded MIRROR-ONLY importer for plm.wb_asset_franchise_property
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/links-asset-franchise-property.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 335,946 source rows
--    and lands 335,946. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_asset_franchise_property(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_asset_franchise_property. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_asset_franchise_property')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'asset_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'franchise_property_label', '')) = ''
     or btrim(coalesce(r.value ->> 'file_name', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_asset_franchise_property. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'asset_source_id')                                        as asset_source_id,
    coalesce(r.value ->> 'franchise_property_source_id', '')               as franchise_property_source_id,
    (r.value ->> 'franchise_property_label')                               as franchise_property_label,
    (r.value ->> 'file_name')                                              as file_name,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL KEY. A duplicate key inside one snapshot is a real defect in the
  --     extract, not a tie to be broken by last-write-wins. Abort instead.
  select count(*) into v_dupes from (
    select 1 from _wb_raw group by asset_source_id, franchise_property_source_id, franchise_property_label having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Warner import refused: % duplicate natural key(s) inside one '
      'snapshot for plm.wb_asset_franchise_property. The key must be unique; a duplicate means the extract is '
      'wrong, not that a winner should be chosen.', v_dupes using errcode = 'P0001';
  end if;

  create temporary table _wb_incoming on commit drop as select * from _wb_raw;
  v_landed := v_seen;
  v_coll   := 0;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 335946 or v_landed <> 335946) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of links-asset-franchise-property.csv must carry '
      'exactly 335946 source rows landing 335946, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_asset_franchise_property;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_asset_franchise_property. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_asset_franchise_property t on t.asset_source_id = i.asset_source_id and t.franchise_property_source_id = i.franchise_property_source_id and t.franchise_property_label = i.franchise_property_label
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_asset_franchise_property t on t.asset_source_id = i.asset_source_id and t.franchise_property_source_id = i.franchise_property_source_id and t.franchise_property_label = i.franchise_property_label
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_asset_franchise_property as t (
    asset_source_id, franchise_property_source_id, franchise_property_label, file_name, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.asset_source_id, i.franchise_property_source_id, i.franchise_property_label, i.file_name, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (asset_source_id, franchise_property_source_id, franchise_property_label) do update set
    file_name                    = excluded.file_name,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_asset_franchise_property t
  where not exists (select 1 from _wb_incoming i where i.asset_source_id = t.asset_source_id and i.franchise_property_source_id = t.franchise_property_source_id and i.franchise_property_label = t.franchise_property_label);

  -- Referential report ONLY. There is deliberately NO foreign key between these
  -- landing tables: the loaders are per-entity, so an FK would make load ORDER a
  -- hidden requirement and turn a routine refresh into a failure. Orphans are
  -- COUNTED and returned so the condition is loud instead of invisible. In the
  -- pinned snapshot this is 0 for every link table.
  select count(*) into v_orphan from _wb_incoming i
  where (not exists (select 1 from plm.wb_asset t where i.asset_source_id = t.asset_source_id))
     or (i.franchise_property_source_id <> '' and not exists (select 1 from plm.wb_franchise_property t where i.franchise_property_source_id = t.source_id));

  raise notice 'Warner wb_asset_franchise_property import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_asset_franchise_property(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS '
'links-asset-franchise-property.csv extract into plm.wb_asset_franchise_property. '
'Exists INSTEAD OF a seed migration because this repository is PUBLIC and the extract '
'is confidential Warner Bros. data: schema in git, data out of git. Guards: '
'positively-matched privilege, mode, advisory lock, snapshot shape, non-empty rows, '
'explicit captured_at, per-row required fields, natural-key uniqueness, the pinned '
'2026-08-07 baseline row count, and a shrink band. Writes ONLY '
'plm.wb_asset_franchise_property. NEVER writes core.*, and NEVER deletes: absence is '
'reported as rows_missing. Error text deliberately echoes no Warner value, because '
'logs are not private.';

create or replace function public.sync_wb_asset_franchise_property(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_asset_franchise_property(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_asset_franchise_property(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_asset_franchise_property so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_asset_franchise_property(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_asset_franchise_property(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_asset_franchise_property(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_asset_franchise_property(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 16. plm.sync_wb_asset_character -- guarded MIRROR-ONLY importer for plm.wb_asset_character
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/links-asset-character.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 51,036 source rows
--    and lands 51,036. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_asset_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_asset_character. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_asset_character')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'asset_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'character_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'character_label', '')) = ''
     or btrim(coalesce(r.value ->> 'file_name', '')) = ''
     or btrim(coalesce(r.value ->> 'captured_date', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_asset_character. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'asset_source_id')                                        as asset_source_id,
    (r.value ->> 'character_source_id')                                    as character_source_id,
    (r.value ->> 'character_label')                                        as character_label,
    (r.value ->> 'file_name')                                              as file_name,
    (r.value ->> 'captured_date')::date                                    as captured_date,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL KEY. A duplicate key inside one snapshot is a real defect in the
  --     extract, not a tie to be broken by last-write-wins. Abort instead.
  select count(*) into v_dupes from (
    select 1 from _wb_raw group by asset_source_id, character_source_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Warner import refused: % duplicate natural key(s) inside one '
      'snapshot for plm.wb_asset_character. The key must be unique; a duplicate means the extract is '
      'wrong, not that a winner should be chosen.', v_dupes using errcode = 'P0001';
  end if;

  create temporary table _wb_incoming on commit drop as select * from _wb_raw;
  v_landed := v_seen;
  v_coll   := 0;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 51036 or v_landed <> 51036) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of links-asset-character.csv must carry '
      'exactly 51036 source rows landing 51036, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_asset_character;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_asset_character. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_asset_character t on t.asset_source_id = i.asset_source_id and t.character_source_id = i.character_source_id
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_asset_character t on t.asset_source_id = i.asset_source_id and t.character_source_id = i.character_source_id
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_asset_character as t (
    asset_source_id, character_source_id, character_label, file_name, captured_date, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.asset_source_id, i.character_source_id, i.character_label, i.file_name, i.captured_date, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (asset_source_id, character_source_id) do update set
    character_label              = excluded.character_label,
    file_name                    = excluded.file_name,
    captured_date                = excluded.captured_date,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_asset_character t
  where not exists (select 1 from _wb_incoming i where i.asset_source_id = t.asset_source_id and i.character_source_id = t.character_source_id);

  -- Referential report ONLY. There is deliberately NO foreign key between these
  -- landing tables: the loaders are per-entity, so an FK would make load ORDER a
  -- hidden requirement and turn a routine refresh into a failure. Orphans are
  -- COUNTED and returned so the condition is loud instead of invisible. In the
  -- pinned snapshot this is 0 for every link table.
  select count(*) into v_orphan from _wb_incoming i
  where (not exists (select 1 from plm.wb_asset t where i.asset_source_id = t.asset_source_id))
     or (not exists (select 1 from plm.wb_character t where i.character_source_id = t.source_id));

  raise notice 'Warner wb_asset_character import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_asset_character(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS links-asset-character.csv '
'extract into plm.wb_asset_character. Exists INSTEAD OF a seed migration because this '
'repository is PUBLIC and the extract is confidential Warner Bros. data: schema in '
'git, data out of git. Guards: positively-matched privilege, mode, advisory lock, '
'snapshot shape, non-empty rows, explicit captured_at, per-row required fields, '
'natural-key uniqueness, the pinned 2026-08-07 baseline row count, and a shrink band. '
'Writes ONLY plm.wb_asset_character. NEVER writes core.*, and NEVER deletes: absence '
'is reported as rows_missing. Error text deliberately echoes no Warner value, because '
'logs are not private.';

create or replace function public.sync_wb_asset_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_asset_character(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_asset_character(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_asset_character so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_asset_character(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_asset_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_asset_character(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_asset_character(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 17. plm.sync_wb_property_character -- guarded MIRROR-ONLY importer for plm.wb_property_character
--
--    Snapshot contract (jsonb object):
--      { "captured_at": "YYYY-MM-DD",   -- required; the SNAPSHOT date, explicit,
--                                        --   never derived from now()
--        "rows": [ { ... } ] }           -- required, non-empty; one object per CSV
--                                        --   row, keys EXACTLY the CSV headers of
--                                        --   warner-bros/links-property-character.csv
--
--    Pinned baseline: the 2026-08-07 snapshot carried 4,158 source rows
--    and lands 4,158. Both are asserted when the
--    snapshot declares that capture date, so a truncated or altered re-run of the
--    PINNED extract fails LOUDLY instead of half-loading and reporting success.
--    (A later, genuinely different capture date is not held to these numbers; the
--    shrink band still applies to it.)
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_wb_property_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role      text := auth.role();
  v_rows      jsonb;
  v_captured  date;
  v_hash      text;
  v_seen      integer := 0;
  v_landed    integer := 0;
  v_before    integer := 0;
  v_ins       integer := 0;
  v_upd       integer := 0;
  v_unch      integer := 0;
  v_coll      integer := 0;
  v_missing   integer := 0;
  v_orphan    integer := 0;
  v_bad       integer := 0;
  v_dupes     integer := 0;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception using message = format(
      'Warner import refused: effective JWT role %L / session_user %L is not '
      'permitted to load plm.wb_property_character. Run this through the shared-db apply workflow or as '
      'service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: promotion to core.* is an OPEN OWNER DECISION.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'Warner import refused: mode %L is not supported; only mirror_only '
      'exists. Promotion to core.* is an open owner decision with no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs of THIS loader.
  perform pg_advisory_xact_lock(hashtext('plm.sync_wb_property_character')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Warner import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'Warner import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never taken from a clock: the server runs
  --     America/New_York, so a UTC-midnight timestamp read back through ::date lands
  --     on the PREVIOUS DAY and would silently misdate the snapshot.
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'Warner import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must be an object and carry every NOT NULL field.
  --     One bad row fails the whole snapshot: a partial load is the failure mode
  --     this schema exists to prevent.
  select count(*) into v_bad
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or btrim(coalesce(r.value ->> 'property_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'property_label', '')) = ''
     or btrim(coalesce(r.value ->> 'character_source_id', '')) = ''
     or btrim(coalesce(r.value ->> 'character_label', '')) = ''
     or lower(btrim(coalesce(r.value ->> 'id_fallback', ''))) not in ('true','false')
     or btrim(coalesce(r.value ->> 'captured_at', '')) = ''
     or btrim(coalesce(r.value ->> 'source_url', '')) = ''
  ;
  if v_bad > 0 then
    raise exception 'Warner import refused: % row(s) are malformed or missing a required '
      'field for plm.wb_property_character. No row identifier is echoed here because this repository and its '
      'logs are PUBLIC and the values are licensed Warner data.', v_bad
      using errcode = 'P0001';
  end if;

  -- Materialise the incoming rows once, typed.
  -- The scratch tables are DROPPED FIRST, not merely created ON COMMIT DROP. All
  -- eight loaders can be called inside ONE transaction -- that is the normal
  -- full-refresh shape -- and on commit drop does not fire until the transaction
  -- ENDS, so the second loader would hit "relation _wb_raw already exists". That is
  -- a load-order landmine that only appears once someone batches the refresh.
  drop table if exists _wb_raw;
  drop table if exists _wb_incoming;
  create temporary table _wb_raw on commit drop as
  select
    (r.value ->> 'property_source_id')                                     as property_source_id,
    (r.value ->> 'property_label')                                         as property_label,
    (r.value ->> 'character_source_id')                                    as character_source_id,
    (r.value ->> 'character_label')                                        as character_label,
    (r.value ->> 'id_fallback')::boolean                                   as id_fallback,
    (r.value ->> 'captured_at')::timestamptz                               as captured_at,
    (r.value ->> 'source_url')                                             as source_url,
    r.value            as raw,
    md5(r.value::text) as source_hash
  from jsonb_array_elements(v_rows) r;

  -- G7. NATURAL KEY. A duplicate key inside one snapshot is a real defect in the
  --     extract, not a tie to be broken by last-write-wins. Abort instead.
  select count(*) into v_dupes from (
    select 1 from _wb_raw group by property_source_id, character_source_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Warner import refused: % duplicate natural key(s) inside one '
      'snapshot for plm.wb_property_character. The key must be unique; a duplicate means the extract is '
      'wrong, not that a winner should be chosen.', v_dupes using errcode = 'P0001';
  end if;

  create temporary table _wb_incoming on commit drop as select * from _wb_raw;
  v_landed := v_seen;
  v_coll   := 0;

  -- G8. PINNED-BASELINE ASSERTION. If this claims to be the 2026-08-07 capture, it must
  --     match the counts verified against source commit 9092c51a byte for byte.
  if v_captured = date '2026-08-07'
     and (v_seen <> 4158 or v_landed <> 4158) then
    raise exception 'Warner import refused: the 2026-08-07 snapshot of links-property-character.csv must carry '
      'exactly 4158 source rows landing 4158, but got % landing %. These counts were '
      'verified against pinned source commit 9092c51a. A mismatch means the extract '
      'was read from a dirty working tree or a different commit -- NOT that the '
      'numbers should be updated. Re-read from the pinned commit.', v_seen, v_landed
      using errcode = 'P0001';
  end if;

  -- G9. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of what we
  --     already hold is far more likely to be a truncated extract than a Warner change.
  select count(*) into v_before from plm.wb_property_character;
  if v_before > 0
     and v_landed < v_before * (1 - greatest(0::numeric,
                                             least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'Warner import refused: snapshot lands % rows against % already '
      'stored, a drop beyond the % percent shrink band. A truncated or partially-scraped '
      'extract looks exactly like this. Re-extract, or pass a wider p_max_shrink_fraction '
      'deliberately.', v_landed, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- UPSERT. Writes ONLY plm.wb_property_character. Nothing is deleted: absence is reported
  -- as rows_missing, never acted on (presence adds and corrects; ABSENCE NEVER
  -- REMOVES). first_seen_at is never updated -- it records first observation.
  -- The five resolution columns are ABSENT from both the insert and the update
  -- lists, so a re-import can never wipe a human's resolution decision.
  select count(*) into v_unch
  from _wb_incoming i join plm.wb_property_character t on t.property_source_id = i.property_source_id and t.character_source_id = i.character_source_id
  where t.source_hash = i.source_hash;

  select count(*) into v_upd
  from _wb_incoming i join plm.wb_property_character t on t.property_source_id = i.property_source_id and t.character_source_id = i.character_source_id
  where t.source_hash is distinct from i.source_hash;

  v_ins := v_landed - v_unch - v_upd;

  insert into plm.wb_property_character as t (
    property_source_id, property_label, character_source_id, character_label, id_fallback, captured_at, source_url, raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select i.property_source_id, i.property_label, i.character_source_id, i.character_label, i.id_fallback, i.captured_at, i.source_url, i.raw, i.source_hash,
         now(), now(), now(), now()
  from _wb_incoming i
  on conflict (property_source_id, character_source_id) do update set
    property_label               = excluded.property_label,
    character_label              = excluded.character_label,
    id_fallback                  = excluded.id_fallback,
    captured_at                  = excluded.captured_at,
    source_url                   = excluded.source_url,
    raw                          = excluded.raw,
    source_hash                  = excluded.source_hash,
    last_seen_at                 = now(),
    imported_at                  = now(),
    updated_at                   = now();

  select count(*) into v_missing
  from plm.wb_property_character t
  where not exists (select 1 from _wb_incoming i where i.property_source_id = t.property_source_id and i.character_source_id = t.character_source_id);

  -- Referential report ONLY. There is deliberately NO foreign key between these
  -- landing tables: the loaders are per-entity, so an FK would make load ORDER a
  -- hidden requirement and turn a routine refresh into a failure. Orphans are
  -- COUNTED and returned so the condition is loud instead of invisible. In the
  -- pinned snapshot this is 0 for every link table.
  select count(*) into v_orphan from _wb_incoming i
  where (not exists (select 1 from plm.wb_franchise_property t where i.property_source_id = t.source_id))
     or (not exists (select 1 from plm.wb_character t where i.character_source_id = t.source_id));

  raise notice 'Warner wb_property_character import ok: % seen, % landed (% new, % updated, % unchanged, '
    '% collapsed), % held rows not in this snapshot were LEFT ALONE, % orphan(s). captured_at=%.',
    v_seen, v_landed, v_ins, v_upd, v_unch, v_coll, v_missing, v_orphan, v_captured;

  return query select 'mirror_only'::text, v_captured, v_seen, v_landed, v_ins, v_upd,
                      v_unch, v_coll, v_missing, v_orphan, v_hash;
end;
$$;

comment on function plm.sync_wb_property_character(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Warner STARLABS links-property-character.csv '
'extract into plm.wb_property_character. Exists INSTEAD OF a seed migration because '
'this repository is PUBLIC and the extract is confidential Warner Bros. data: schema '
'in git, data out of git. Guards: positively-matched privilege, mode, advisory lock, '
'snapshot shape, non-empty rows, explicit captured_at, per-row required fields, '
'natural-key uniqueness, the pinned 2026-08-07 baseline row count, and a shrink band. '
'Writes ONLY plm.wb_property_character. NEVER writes core.*, and NEVER deletes: '
'absence is reported as rows_missing. Error text deliberately echoes no Warner value, '
'because logs are not private.';

create or replace function public.sync_wb_property_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_wb_property_character(p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_wb_property_character(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_wb_property_character so a serverless/service-role '
'caller imports the mirror without a raw DB password (plm is not PostgREST-exposed). '
'All guards live in the inner function and are re-evaluated there; this wrapper adds '
'no privilege.';

revoke all on function plm.sync_wb_property_character(jsonb, text, numeric) from public;
revoke all on function public.sync_wb_property_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_wb_property_character(jsonb, text, numeric) to service_role;
grant execute on function public.sync_wb_property_character(jsonb, text, numeric) to service_role;

-- -------------------------------------------------------------------------------------
-- 18. api.wb_property_character -- the consumable view over the ONE direct Warner record.
--
-- Deliberately NOT an interpretation layer. Unlike the Disney OPA view, nothing here is
-- derived, split, normalised or guessed: Warner supplies clean id-backed pairs and any
-- "helpful" transformation would be OUR invention wearing Warner's authority. The view
-- exists to expose the record with its provenance attached, so no consumer can read a
-- row without also reading its scope caveat.
--
-- security_invoker = true so the view cannot become a privilege-escalation path around
-- the base table's RLS.
-- -------------------------------------------------------------------------------------
create view api.wb_property_character
with (security_invoker = true) as
select
  pc.property_source_id,
  pc.property_label,
  pc.character_source_id,
  pc.character_label,
  pc.id_fallback,
  pc.captured_at,
  pc.source_url
from plm.wb_property_character pc;

comment on view api.wb_property_character is
'Consumable read-only view over the ONLY direct Warner Bros. property-to-character '
'record: the Product submission catalogue, where Warner itself returns a character array '
'for a selected property. NOTHING IS DERIVED HERE -- every column is Warner''s own value. '
'There is deliberately NO companion view joining style guides to properties or to '
'characters: Warner publishes no such relationship, and one built from shared-asset '
'co-occurrence would be an INFERRED link indistinguishable from a real one. SCOPE: one '
'entitled contract and its territories, POP Creations licensee account only, snapshot '
'dated captured_at. This is NOT Warner''s global catalogue. AUTHORITY: presence asserts; '
'ABSENCE NEVER REMOVES.';

grant select on api.wb_property_character to authenticated;
grant select on api.wb_property_character to service_role;
revoke all on api.wb_property_character from anon;

-- -------------------------------------------------------------------------------------
-- 19. api.wb_property_reconciliation -- reports reconciliation state, changes nothing.
-- -------------------------------------------------------------------------------------
create view api.wb_property_reconciliation
with (security_invoker = true) as
select
  pc.property_source_id,
  pc.property_label            as warner_property_label,
  count(*)                     as warner_character_count,
  pc.property_id,
  p.name                       as core_property_name,
  l.code                       as core_licensor_code,
  pc.resolution_status,
  pc.resolution_reason,
  pc.resolved_at,
  pc.resolved_by,
  max(pc.captured_at)          as captured_at
from plm.wb_property_character pc
left join core.property p on p.id = pc.property_id
left join core.licensor l on l.id = p.licensor_id
group by pc.property_source_id, pc.property_label, pc.property_id, p.name, l.code,
         pc.resolution_status, pc.resolution_reason, pc.resolved_at, pc.resolved_by;

comment on view api.wb_property_reconciliation is
'One row per Warner Bros. entitled property with its character count and its '
'reconciliation state against core.property. EXPECT A LOW MATCH RATE and do not treat it '
'as an error: core.property mirrors ColdLion -- what POP actually produces and holds a '
'code for -- while this carries Warner''s licensable property catalogue for the entitled '
'contract. Resolution is recorded on the landing row and NEVER mutates core.property. '
'Whether these pairs should be promoted into a canonical table is an OPEN OWNER DECISION '
'and has no code path.';

grant select on api.wb_property_reconciliation to authenticated;
grant select on api.wb_property_reconciliation to service_role;
revoke all on api.wb_property_reconciliation from anon;
