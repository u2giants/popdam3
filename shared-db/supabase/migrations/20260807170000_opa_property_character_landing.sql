-- =====================================================================================
-- Disney OPA (Online Product Approval) property->character landing schema.
--
-- Migration: 20260807170000_opa_property_character_landing.sql
-- Design:    docs/verification/opa-source-of-truth-20260807/README.md (PR #485),
--            which SUPERSEDES docs/verification/opa-characters-20260806/DESIGN.md.
-- Build note: docs/verification/opa-source-of-truth-20260807/BUILD-NOTE-20260807.md
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
-- -------------------------------------------------------------------------------
-- The OPA extract is business-confidential Disney data obtained under a commercial
-- licensing relationship. This repository (u2giants/shared-db) is PUBLIC. The design
-- doc's section 7.7 proposed a seed migration generated from a CSV committed here;
-- that justification EXPIRED when the CSV was removed from this repo (PR #495) to the
-- private repo u2giants/licensor-source-data (disney-opa/opa-characters.csv).
-- Materialising 10,262 Disney rows as INSERTs in supabase/migrations/ would put them
-- permanently in public git history. It is therefore FORBIDDEN here and everywhere:
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows arrive at runtime through plm.sync_opa_property_character (migration
-- 20260807170100), fed a jsonb snapshot by tools/sync-opa-property-character.mjs,
-- which reads the CSV from the PRIVATE repo. No Disney row appears in this repo.
--
-- Depends on (exact 14-digit versions):
--   20260621150815  app_core                      -- core.licensor, core.property, core.character
--   20260724030000  coldlion phase1 mirror schema -- the plm.erp_* mirror pattern this follows
--   20260727230000  core_style_guide_axis         -- core.style_guide_character (axis 2)
--
-- Objects created: see the BUILD NOTE. Nothing in core.* is ALTERED; nothing existing
-- is dropped; core.character is NOT populated; nothing is resolved; nothing is deleted.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. plm.opa_property_character -- raw vendor landing (README section 7.3)
--
-- SOURCE table. Disney's strings are stored EXACTLY as OPA supplies them: nothing is
-- normalised, split, trimmed or corrected here. Our interpretation lives in
-- api.opa_property_character, never in this table.
--
-- Pattern follows plm.erp_licensor / plm.erp_property exactly: raw typed mirror in plm,
-- read-only consumable view in api, nullable resolution columns on the mirror row.
-- There is NO `coldlion` schema; anyone looking for one will find nothing.
-- Resolution is recorded HERE and NEVER mutates a canonical row.
-- -------------------------------------------------------------------------------------
create table plm.opa_property_character (
  -- Disney's identity. THE NATURAL KEY IS THE ID PAIR, NOT THE NAME PAIR.
  -- Measured on the 2026-08-06 extract: the NAME pair yields 10,240 distinct values
  -- across 10,262 rows -- 22 real collisions -- so keying on names silently DROPS 22
  -- rows. The ID pair is unique at exactly 10,262. (Two distinct licensed_property_id
  -- values share one property display name; "Davy Crockett" is 216 and 425.)
  licensed_property_id  bigint not null,
  character_id          bigint not null,

  -- Disney's strings, byte-for-byte as extracted. Do not normalise.
  property_name         text   not null,
  character_name        text   not null,

  -- Further Disney IDs, preserved but not interpreted.
  brand_property_id     bigint not null,
  option_source_id      bigint not null,

  -- Provenance. Every row carries its own scope caveat by design.
  captured_at           date   not null,
  source_url            text   not null,
  line_of_business      text   not null default 'Home',
  entitlement_scope     text   not null
    default 'POP Creations licensee entitlement only; NOT Disney''s full catalogue',

  -- Reconciliation, per owner ruling 2026-08-07. ALL NULL/unresolved at landing.
  -- THIS MIGRATION RESOLVES NOTHING. Two owner gates are still open (how far Disney
  -- may overwrite our curated names; whether ColdLion deletions propagate), and
  -- leaving every row unresolved is what makes this migration safe to ship first.
  property_id           uuid        null references core.property(id) on delete restrict,
  resolution_status     text   not null default 'unresolved',
  resolution_reason     text        null,
  resolved_at           timestamptz null,
  resolved_by           text        null,

  -- Mirror convention, matching plm.erp_licensor / plm.erp_property.
  raw                   jsonb  not null,
  source_hash           text   not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  imported_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint opa_property_character_pkey
    primary key (licensed_property_id, character_id),

  constraint opa_property_character_property_name_chk
    check (btrim(property_name) <> ''),
  constraint opa_property_character_character_name_chk
    check (btrim(character_name) <> ''),

  -- option_source_id was 1007 on all 10,262 rows. Its meaning is UNKNOWN. Pinned so a
  -- future extract carrying a different value fails LOUDLY rather than landing silently
  -- under an assumption nobody has verified. If a later extract legitimately carries a
  -- different value, WIDEN THIS IN A NEW MIGRATION with a recorded reason. Do not drop it.
  constraint opa_property_character_option_source_chk
    check (option_source_id = 1007),

  constraint opa_property_character_lob_chk
    check (line_of_business = 'Home'),

  constraint opa_property_character_resolution_status_chk
    check (resolution_status in
      ('unresolved','matched','ambiguous','no_match','rejected'))
);

-- IDs are bigint and are deliberately NOT constrained positive. The row
-- `Special Projects` carries licensed_property_id = -9999, character_id = -9998,
-- brand_property_id = -9999. These are Disney sentinels, not corrupt data. Any
-- unsigned, or text-with-digit-check, typing rejects them.

comment on table plm.opa_property_character is
  'RAW Disney OPA (opa.disney.com) property->character picker extract. '
  'SCOPE WARNING: Home line of business ONLY (lobName=Option.Lob.Home), and '
  'ONLY the properties POP Creations'' licensee account is entitled to see. '
  'This is NOT all of Disney and NOT all lines of business. Point-in-time '
  'snapshot, no change feed; refresh is a full manual re-extract requiring '
  'Albert to complete MFA in his own browser. AUTHORITY (owner ruling '
  '2026-08-07): authoritative for what it ASSERTS, SILENT about what it OMITS. '
  'Presence adds and corrects; ABSENCE NEVER REMOVES. Disney''s strings are '
  'stored verbatim; interpretation belongs in api.opa_property_character. '
  'Business-confidential Disney data under a commercial licensing relationship '
  '- do not publish, do not send to any third-party service, and NEVER commit a '
  'row of it to this PUBLIC repository (see the header of migration 20260807170000). '
  'Rows are loaded at runtime by plm.sync_opa_property_character, never by a seed.';

comment on column plm.opa_property_character.option_source_id is
  'Disney''s optionSourceID. Was 1007 on ALL 10,262 rows of the 2026-08-06 '
  'extract. Its meaning is NOT understood. DO NOT BUILD LOGIC ON THIS COLUMN.';

comment on column plm.opa_property_character.licensed_property_id is
  'Disney''s licensedPropertyID. Part of the natural key. 1,445 distinct values '
  'across only 1,444 distinct property_name values, which is exactly why the key '
  'is the ID pair and not the name pair.';

comment on column plm.opa_property_character.property_name is
  'Disney''s exact property display name, verbatim. NOT unique: 1,444 distinct '
  'names across 1,445 distinct licensed_property_id values ("Davy Crockett" is '
  'both 216 and 425). 138 names carry a likeness contract split and 18 carry '
  '"- Individual Characters"; collapsing those qualifiers yields 1,354 base '
  'names. Disney also writes many character names surname-first ("Watson, '
  'Anna") and uses a BACKTICK (`) where an apostrophe is expected. Matching '
  'code must handle both.';

comment on column plm.opa_property_character.character_id is
  'Disney''s characterID. A STABLE character identity: 9,613 distinct values, '
  'never mapping to more than one name. 609 recur across property nodes, but '
  'MEASURED, 561 of those are the SAME property written twice for contract '
  'reasons and 42 more are one Disney data-entry error (see README section 5). '
  'Separately, 21 OPA character NAMES carry multiple characterIDs (e.g. '
  '"Beagle Boys" has 510, 512 and 518031315) -- an apparent Disney system '
  'migration that left two ID generations live. DO NOT DEDUPE THOSE without '
  'asking Disney.';

comment on column plm.opa_property_character.property_id is
  'Nullable reconciliation to core.property, per owner ruling 2026-08-07. '
  'NULL and unresolved at landing. Resolution is recorded on THIS row and must '
  'NEVER mutate a core.property row. Expect a LOW match rate: core.property '
  'under DY is POP''s internal design taxonomy (MOVIE POSTER, SPELLS, POSTER '
  'VERBIAGE) while OPA carries Disney''s real property names. Low overlap is '
  'CORRECT and is not a data-quality finding.';

-- Lookup paths. None of these is unique.
create index idx_opa_property_character_property_name
  on plm.opa_property_character (property_name);
create index idx_opa_property_character_character_name
  on plm.opa_property_character (character_name);
create index idx_opa_property_character_character_id
  on plm.opa_property_character (character_id);
create index idx_opa_property_character_licensed_property_id
  on plm.opa_property_character (licensed_property_id);
create index idx_opa_property_character_property_id
  on plm.opa_property_character (property_id) where property_id is not null;
create index idx_opa_property_character_resolution_status
  on plm.opa_property_character (resolution_status);

-- Supports the view's base-name lookup without recomputing the split.
create index idx_opa_property_character_base_property_name
  on plm.opa_property_character (
    btrim(regexp_replace(property_name,
      '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'))
  );

-- Posture matches plm.erp_property / plm.erp_licensor: RLS on, exactly one read
-- policy, select to authenticated, full rights to service_role, NOTHING to anon.
-- An RLS policy is not a GRANT (AGENTS.md section 11). Both are required.
alter table plm.opa_property_character enable row level security;

create policy opa_property_character_read
  on plm.opa_property_character
  for select to authenticated using (true);

grant select on plm.opa_property_character to authenticated;
grant select, insert, update, delete on plm.opa_property_character to service_role;
revoke all on plm.opa_property_character from anon;

-- -------------------------------------------------------------------------------------
-- 2. core.property_character -- the ownership-axis junction (README section 7.2)
--
-- BUILT ON OWNER RULING, 2026-08-07: Albert directed that this be built, because Laura
-- (licensing manager, the domain authority) CONFIRMED that a character can appear in
-- multiple properties. The design doc argues against it on measurement grounds (~6
-- genuine multi-property cases out of 9,613). That argument has been heard and
-- OVERRULED by the business fact. Do not re-argue it here.
--
-- How this differs from the two tables that already express property<->character, and
-- how the three stay reconciled rather than drifting apart:
--
--   dflow.property_character_associations  (20260710135950, integer keys)
--       LEGACY, APP-LOCAL to DesignFlow. Both endpoints FK the SAME table,
--       dflow.properties_and_characters, whose PROPERTY-typed rows are documented as
--       STYLE GUIDES, not properties (docs/style-guides-characters-and-royalties.md
--       section 5). So despite its name it is a STYLE-GUIDE<->character edge in an app
--       schema. It is a migration SOURCE, not a peer: its 9,622 edges are destined for
--       core.style_guide_character. Nothing reads it as canonical and this migration
--       does not touch it.
--
--   core.style_guide_character            (20260727230000, uuid keys)
--       AXIS 2 -- STYLE. "Which art files show this character." M:N by owner ruling
--       2026-07-23. Left endpoint core.style_guide.
--
--   core.property_character               (THIS TABLE, uuid keys)
--       AXIS 1 -- OWNERSHIP. "Which licensed property does Disney approve this
--       character under." Left endpoint core.property.
--
-- The reconciliation rule that keeps them from drifting, stated as a contract:
--   core.style_guide.property_id is the SINGLE bridge between the two axes. A style
--   guide belongs to exactly one property; therefore every core.style_guide_character
--   edge implies at most one property, and core.property_character is a SUPERSET
--   projection of it, never an independent second opinion. Neither table is derived
--   FROM the other by trigger -- that is what would let them drift silently -- but the
--   invariant is checkable at any time and is asserted in the contract tests:
--       every (style_guide.property_id, character_id) pair implied by
--       core.style_guide_character must exist in core.property_character.
--   Because core.character holds 0 rows today, both tables are empty and the invariant
--   holds trivially. It must be re-asserted before either is first populated.
--
-- Populated from OPA's ID-keyed pairs, once core.character exists. THIS MIGRATION
-- POPULATES NOTHING.
-- -------------------------------------------------------------------------------------
create table core.property_character (
  property_id  uuid not null,
  character_id uuid not null,
  is_primary   boolean     not null default false,
  source       text        not null default 'opa',
  created_at   timestamptz not null default now(),

  -- Named explicitly, matching the names Postgres itself generates, so the object
  -- inventory and the catalog agree. (The design doc listed `core_property_character_pkey`
  -- in prose and `property_character_*_fkey` in its DDL; they cannot both be right.)
  constraint property_character_pkey
    primary key (property_id, character_id),
  constraint property_character_property_id_fkey
    foreign key (property_id) references core.property(id) on delete restrict,
  constraint property_character_character_id_fkey
    foreign key (character_id) references core.character(id) on delete cascade,
  constraint property_character_source_chk
    check (btrim(source) <> '')
);

-- Reverse lookup: "which properties is this character approvable under?"
create index idx_property_character_character_id
  on core.property_character (character_id);

comment on table core.property_character is
  'AXIS 1 (OWNERSHIP) many-to-many bridge between core.property and core.character. '
  'Built on owner ruling 2026-08-07: Laura, the licensing manager, confirmed a '
  'character can appear in multiple properties. Distinct from core.style_guide_character, '
  'which is AXIS 2 (STYLE) and answers "which art files show this character". '
  'Distinct from dflow.property_character_associations, which is a LEGACY APP-LOCAL '
  'style-guide<->character edge (its PROPERTY-typed rows are style guides) and is a '
  'migration source, not a peer. Reconciliation invariant: core.style_guide.property_id '
  'is the single bridge between the axes, so every (style_guide.property_id, character_id) '
  'pair implied by core.style_guide_character must also exist here. Neither table is '
  'trigger-derived from the other; the invariant is asserted in the contract tests and '
  'must be re-asserted before either is first populated.';

comment on column core.property_character.is_primary is
  'Optional hint for a single-parent consumer reading a multi-property character. '
  'OUR invention: Disney supplies no primary flag. Not enforced unique and not '
  'populated by any current process.';

comment on column core.property_character.source is
  'Provenance of the edge, e.g. ''opa'' (Disney OPA extract) or ''curated''. '
  'Free text by design so a new source does not need a migration to be recorded.';

alter table core.property_character enable row level security;

-- Role posture copied from the sibling axis table core.style_guide_character, NOT from
-- the plm mirror: this is canonical core data and must read the same way its sibling does.
create policy shared_read on core.property_character
  for select to authenticated
  using (
    app.has_any_role(array[
      'administrator',
      'sales',
      'licensing',
      'designer',
      'viewer',
      'vendor'
    ]::app.app_role[])
  );

create policy admin_write on core.property_character
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

grant select on table core.property_character to authenticated;
grant all on table core.property_character to service_role;
revoke all on table core.property_character from anon;

-- -------------------------------------------------------------------------------------
-- 3. api.opa_property_character -- the consumable view (README section 7.5)
--
-- EVERY derived column below is OUR INTERPRETATION, not Disney's. Disney supplies ONE
-- string per property node; the base-name/likeness split is inferred by us. Where the
-- inference is not clean, likeness_parse_confident is false and callers MUST fall back
-- to property_name.
--
-- security_invoker = true so the view cannot become a privilege-escalation path around
-- the base table's RLS.
-- -------------------------------------------------------------------------------------
create view api.opa_property_character
with (security_invoker = true) as
select
  -- Disney's own values, verbatim. Trust these.
  o.licensed_property_id,
  o.character_id,
  o.brand_property_id,
  o.property_name,
  o.character_name,

  -- OUR INTERPRETATION from here down. ---------------------------------------------
  btrim(regexp_replace(o.property_name,
    '\s*-\s*(No|With|Without)\s+Likeness\s*$', '', 'i'))
    as base_property_name_interpreted,

  case
    when o.property_name ~* '-\s*With\s+Likeness\s*$'         then 'with'
    when o.property_name ~* '-\s*(No|Without)\s+Likeness\s*$' then 'without'
    when o.property_name ~* 'Likeness'                        then 'unparsed'
    else null
  end as likeness_interpreted,

  (o.property_name !~* 'Likeness'
   or o.property_name ~* '-\s*(No|With|Without)\s+Likeness\s*$')
    as likeness_parse_confident,

  -- Disney writes many characters surname-first. OUR guess at direct order.
  case when o.character_name ~ '^[^,()]+,\s+[^,()]+' then true else false end
    as name_is_surname_first_interpreted,

  -- Disney uses a BACKTICK where an apostrophe belongs on 637 rows.
  replace(o.character_name, '`', '''') as character_name_normalised_interpreted,
  -- ---------------------------------------------------------------------------------

  -- Provenance, so no consumer can read a row without its caveats.
  o.captured_at,
  o.line_of_business,
  o.entitlement_scope,
  o.source_url
from plm.opa_property_character o;

comment on view api.opa_property_character is
  'Consumable read-only view over the raw Disney OPA landing. Every column '
  'ending _interpreted is OUR INTERPRETATION, not Disney''s. When '
  'likeness_parse_confident is false, use property_name and do not rely on the '
  'split. SCOPE: Home line of business only, POP Creations entitlement only, '
  'snapshot dated captured_at. This is NOT all of Disney. AUTHORITY: presence '
  'adds and corrects; ABSENCE NEVER REMOVES.';

grant select on api.opa_property_character to authenticated;
grant select on api.opa_property_character to service_role;
revoke all on api.opa_property_character from anon;

-- -------------------------------------------------------------------------------------
-- 4. api.opa_property_reconciliation -- reports state, changes nothing (section 7.6)
-- -------------------------------------------------------------------------------------
create view api.opa_property_reconciliation
with (security_invoker = true) as
select
  o.licensed_property_id,
  o.property_name              as opa_property_name,
  count(*)                     as opa_character_count,
  o.property_id,
  p.name                       as core_property_name,
  l.code                       as core_licensor_code,
  o.resolution_status,
  o.resolution_reason,
  o.resolved_at,
  o.resolved_by,
  o.captured_at,
  o.line_of_business,
  o.entitlement_scope
from plm.opa_property_character o
left join core.property p on p.id = o.property_id
left join core.licensor l on l.id = p.licensor_id
group by o.licensed_property_id, o.property_name, o.property_id, p.name,
         l.code, o.resolution_status, o.resolution_reason, o.resolved_at,
         o.resolved_by, o.captured_at, o.line_of_business, o.entitlement_scope;

comment on view api.opa_property_reconciliation is
  'One row per Disney OPA property node with its reconciliation state against '
  'core.property. EXPECT A LOW MATCH RATE and do not treat it as an error: '
  'core.property mirrors ColdLion (what POP produces/holds a code for, see '
  'docs/style-guides-characters-and-royalties.md 5A.2) while OPA carries '
  'Disney''s full licensable title catalogue for the Home line of business. '
  'Of 1,445 OPA nodes, 178 match a DesignFlow/PopDAM style guide by exact '
  'Disney ID; the ~1,267 remainder are largely 20th Century Fox / ABC titles '
  'POP has never designed against. Resolution NEVER mutates core.property.';

grant select on api.opa_property_reconciliation to authenticated;
grant select on api.opa_property_reconciliation to service_role;
revoke all on api.opa_property_reconciliation from anon;
