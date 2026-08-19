-- =====================================================================================
-- Issue #1163 — normalized `mgCategory` taxonomy and its MG01 product-type mapping.
--
-- ADDITIVE ONLY. Creates exactly two new tables in `core`:
--     core.mg_category
--     core.mg_category_merch_group
-- Nothing else is created, altered, dropped or repurposed. In particular the existing
-- free-text `mgCategory` columns on core."merchGroup" and core."merchGroupMaster" are
-- LEFT EXACTLY AS THEY ARE. They stay as an upstream mirror field; this migration does
-- not read them as truth, does not write them, and does not deprecate them.
--
-- THE BUSINESS RULE (docs/merch-group-taxonomy-architecture.md §4.2.1)
-- --------------------------------------------------------------------
--   * `mgCategory` is a HIDDEN grouping ABOVE MG01. It is not an MG level, not a row in
--     the MG01 -> MG02 -> MG03 `parent_id` chain, and not a product type.
--   * One category has MANY MG01 product types.
--   * Each MG01 product type belongs to EXACTLY ONE category.
--   * An item's category is INHERITED from its selected MG01 product type.
--   * MG02 and MG03 refine the product type; they never choose or override the category.
--
-- WHY THE LINK IS TO `mg_id` AND NOT TO THE MG01 LETTER CODE
-- ----------------------------------------------------------
-- AGENTS.md and §3.2c of the taxonomy doc warn that MG codes are unique only per
-- division+type. That was PROVEN live against production qsllyeztdwjgirsysgai on
-- 2026-08-18 (read-only), not assumed:
--
--   select mg_code, count(*), count(distinct "divisionCode_id_fk")
--   from core."merchGroup" where "mgTypeCode" = '01' group by 1 having count(*) > 1;
--     -> 'A' 7 rows across 4 divisions, 'B' 7/4, 'S' 7/4, 'C','D','E','F','G','J','K',
--        'M','P','R','U','V','W' 6 rows each across 4 divisions ... 26 colliding codes.
--
--   select mg_code, count(*), count(distinct "mgTypeCode")
--   from core."merchGroup" where mg_code in ('A','B','F','M','W') group by 1;
--     -> each of those letters exists 22-25 times across 5 DIFFERENT mgTypeCodes.
--
-- Worse, the collision is semantic, not cosmetic: inside mgTypeCode '01' alone, mg_id 26
-- is code 'A' = "LEATHER/COWHIDE" (a retired MATERIAL list) while mg_id 2462 is code 'A'
-- = "Stretched/Box" (the live PRODUCT TYPE). A category table keyed on the bare letter
-- 'A' would silently claim both. So `core.mg_category_merch_group` links to
-- core."merchGroup"(mg_id) — the real row identity, which already carries company and
-- division scope — via a real foreign key.
--
--   select conname, pg_get_constraintdef(oid) ... -> merchGroup_pkey PRIMARY KEY (mg_id)
--
-- HOW THE SEED RESOLVES ROWS
-- --------------------------
-- The authoritative 7-category / 20-product-type mapping is restated in §4.2.1. Nineteen
-- of the twenty come from MerchGroup_Rework.xlsx sheet `Final Version`, columns A-C. The
-- twentieth, ('Q','TBD storage') -> STORAGE, comes from an OWNER RULING by Albert Hazan
-- on 2026-08-18: 'Q' is real and belongs under Storage.
--
-- THE WORKBOOK DOES NOT YET CARRY 'Q'. MerchGroup_Rework.xlsx is a business-owned binary
-- and is NOT edited by this repository. The business must add 'Q TBD storage' under
-- Storage to the workbook so the two agree. UNTIL THAT HAPPENS, THE AUTHORITY FOR 'Q' IS
-- THE RECORDED OWNER RULING in docs/business-rules/merchandise-and-product-taxonomy.md,
-- not the workbook. A future reader who finds only 19 rows in the workbook has found a
-- stale workbook, not a wrong migration.
--
-- The seed
-- matches on the (mg_code, mg_desc) PAIR within mgTypeCode '01', case-insensitively and
-- trimmed. Matching on the pair is what keeps the retired material rows out: 'A' alone
-- would hit "LEATHER/COWHIDE", but ('A','Stretched/Box') cannot.
--
-- Every division that carries a matching row gets its own link row, so the mapping is
-- correct per company/division rather than approximated once globally.
--
-- ONLY `is_active` MERCHANDISE-GROUP ROWS ARE MATCHED
-- ---------------------------------------------------
-- Verified live on 2026-08-18 against production qsllyeztdwjgirsysgai (read-only): every
-- pre-rebuild MG01 row is `is_active = false`, and the whole live product-type set was
-- created in one later batch with `is_active = true`. Today an unfiltered join happens to
-- be safe, because the surviving retired type-01 'A' row reads LEATHER/COWHIDE and cannot
-- match the pair ('A','Stretched/Box'). It is not safe FOREVER: a future rebuild that
-- retires a product type by name and re-inserts the SAME name would leave two rows with
-- the same (mg_code, mg_desc) pair, and an unfiltered seed would silently link BOTH — two
-- link rows for one live product type, with nothing raising. So the seed, the "is there
-- any source data" gate and the verification block ALL filter on `is_active is true`, and
-- they all use the SAME filter so the gate can never disagree with the join.
--
-- `is_active` is nullable on core."merchGroup" (its default is false), so `is true` is
-- deliberate: an unknown activity flag is NOT treated as live. If a genuinely live product
-- type is ever left with a null flag, the per-division assertion below names it and the
-- migration refuses to apply — loud, not silent.
--
-- DIVISION SCOPE IS DECLARED PER PRODUCT TYPE, NOT ASSUMED UNIFORM
-- ----------------------------------------------------------------
-- Verified live on 2026-08-18 against production qsllyeztdwjgirsysgai (read-only):
--   * each of the 19 workbook product types exists as an ACTIVE MG01 row exactly ONCE in
--     EACH of the three divisions CW001, EH001 and SP001;
--   * ('Q','TBD storage') exists exactly ONCE, in CW001 ONLY, and is active there.
--
-- So the authoritative list is NOT a flat list cross-joined against whatever divisions
-- happen to carry rows. Each entry DECLARES the divisions it is expected in
-- (`expected_divisions`): the 19 declare all three, 'Q' declares CW001 only. The expected
-- grid is then built by unnesting that declaration, so it has 19x3 + 1 = 58 cells today —
-- and 58, like the old 57, is an OBSERVATION that appears NOWHERE in this file. The
-- expectation is DERIVED from the declaration and moves with it.
--
-- A naive uniform cross join would demand 'Q' in EH001 and SP001, find it absent and
-- raise on data that is correct. Declaring the scope is what keeps the assertion strict
-- without making it wrong.
--
-- WHY PER-DIVISION AND NOT "RESOLVED SOMEWHERE" (this is the bug that was here before)
-- -----------------------------------------------------------------------------------
-- The previous check LEFT JOINed the authoritative rows to core."merchGroup" and failed
-- only when a row came back NULL. A LEFT JOIN emits NO ROW for a division that did not
-- match — it does not emit a NULL row. So if 'K' matched in CW001 and SP001 but EH001
-- stored it as 'Other Table Top', the join still returned two non-null rows for 'K',
-- nothing was NULL, the migration printed OK and COMMITTED 56 links instead of 57. One
-- division silently had a hole and every downstream category filter silently dropped its
-- items. Expanding the DECLARED (type, division) pairs into a grid first, and then
-- looking for holes in that grid, is what makes a one-division drift impossible to hide.
-- That fix is NOT weakened by the declaration: a declared cell that does not resolve
-- still raises and still names the exact (division, code, description) triple.
--
-- CAN A DIVISION LEGITIMATELY CARRY ONLY PART OF THE MG01 SET?
-- -----------------------------------------------------------
-- (This paragraph replaces an earlier one that said a short division is ALWAYS a data
-- defect. That was wrong: 'Q' is real, correct and CW001-only.)
--
-- Division scope is DECLARED PER PRODUCT TYPE, and a departure from the DECLARED scope
-- is the defect — not a departure from uniformity. Concretely:
--   * A DECLARED (type, division) cell that does not resolve to a linked active MG01 row
--     RAISES and rolls the migration back, naming the exact triple. This is the whole
--     point of the grid and it is unchanged in strength.
--   * An active MG01 row that resolves in a division the list did NOT declare (say 'Q'
--     is rolled out to SP001 next quarter) is reported as a LOUD NOTICE, not a raise.
--     WHY THE ASYMMETRY: a missing declared cell is a correctness hole — that division's
--     items silently fall out of every category filter, which is precisely the 56-of-57
--     failure. An undeclared cell is the opposite: the row WAS found and WAS seeded with
--     its authoritative category, so the data is right and only the declaration is stale.
--     Raising there would turn a legitimate business expansion into a replay failure on
--     every database, i.e. a self-inflicted outage over a non-defect. The notice names
--     the triples so the declaration gets widened in a follow-up governed migration.
--
-- A future division that deliberately sells only a subset is now expressible: declare the
-- subset. It must still be settled on the issue and expressed in a follow-up governed
-- migration — never by loosening the grid check, because "some divisions are allowed to
-- be short" is exactly the hole that let the 56-of-57 seed through.
--
-- WHAT APPLIES ON A DATABASE WITH NO MERCHANDISE-GROUP ROWS
-- ---------------------------------------------------------
-- EVERYTHING STRUCTURAL: both tables, every constraint and index, RLS, the policies and
-- the grants, plus the seven authoritative categories (they are division-independent
-- reference data and do not depend on any source row). Only the category-to-MG01 LINK
-- rows need source data, so on a database with no MG01 rows the link seed is a natural
-- no-op and its assertion is SKIPPED WITH A LOUD NOTICE rather than raising.
-- On a database that DOES carry active MG01 rows the assertion is strict PER DECLARED
-- CELL: anything short of every declared (product type, division) pair resolving raises
-- and rolls back, naming the exact missing (division, code, description) triples.
-- See the long comment in section 5.

-- IDEMPOTENCE
-- -----------
-- Re-runnable. Tables are `create table if not exists`; the category seed upserts on the
-- natural key `code`; the link seed is `on conflict do nothing`. A re-run can therefore
-- never silently RE-POINT a product type that a human deliberately moved. Instead, the
-- final verification block RAISES if any existing link disagrees with the authoritative
-- mapping, so a drift is loud rather than quietly overwritten.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. core.mg_category — the seven categories.
-- -------------------------------------------------------------------------------------

create table if not exists core.mg_category (
  id uuid primary key default gen_random_uuid(),

  -- Stable machine key. This, not the display name, is what application code and later
  -- migrations should reference; the display name is allowed to be re-worded.
  code text not null,

  -- What a human sees if the grouping is ever surfaced. The workbook labels this column
  -- "Prod Category- (no one sees this)", so today it is internal.
  name text not null,

  -- Presentation order for pickers and reports. Not a hierarchy.
  sort_order integer not null default 0,

  is_active boolean not null default true,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mg_category_code_not_blank check (length(btrim(code)) > 0),
  constraint mg_category_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists mg_category_code_key
  on core.mg_category (code);

create unique index if not exists mg_category_name_key
  on core.mg_category (lower(btrim(name)));

comment on table core.mg_category is
  'Issue #1163. The normalized `mgCategory` list: a hidden product grouping ABOVE MG01, '
  'used to constrain downstream logic such as valid sizes. It is NOT an MG hierarchy '
  'level and NOT a product type. Authoritative rule: '
  'docs/merch-group-taxonomy-architecture.md §4.2.1. The free-text `mgCategory` columns '
  'on core."merchGroup" / core."merchGroupMaster" are an upstream mirror, not the master.';

comment on column core.mg_category.code is
  'Stable machine key (WALL, TABLETOP, CLOCK, STORAGE, WORKSPACE, FLOOR, GARDEN). '
  'Reference this, never the display name.';

comment on column core.mg_category.sort_order is
  'Display ordering only. Carries no hierarchy or business meaning.';

-- -------------------------------------------------------------------------------------
-- 2. core.mg_category_merch_group — category -> real MG01 merchandise-group rows.
-- -------------------------------------------------------------------------------------

create table if not exists core.mg_category_merch_group (
  id uuid primary key default gen_random_uuid(),

  mg_category_id uuid not null
    references core.mg_category (id) on delete restrict,

  -- The REAL merchandise-group row identity. Company and division scope ride along on
  -- that row, so this link is division-correct by construction. Never a bare mg_code:
  -- MG codes collide across divisions AND across mgTypeCodes (see header).
  merch_group_mg_id integer not null
    references core."merchGroup" (mg_id) on delete cascade,

  -- Provenance, so a future reader can tell a seeded row from a hand-added one.
  source text not null default 'merchgroup_rework_workbook',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ACCEPTANCE CHECK 3, enforced by the database rather than by convention:
  -- one merchandise-group ROW can belong to AT MOST ONE category. A second insert for
  -- the same mg_id fails outright.
  --
  -- THE NAME SAYS "MG ROW", NOT "PRODUCT TYPE", ON PURPOSE. A product type such as
  -- ('A','Stretched/Box') exists as a SEPARATE ROW in each division, so this constraint
  -- does NOT stop CW001's 'A' being WALL while EH001's 'A' is CLOCK. Naming it
  -- "one_category_per_product_type" promised a rule it cannot deliver. Postgres cannot
  -- express the cross-division rule as a CHECK (a CHECK may not query another table) and
  -- expressing it would need a trigger or a unique index on core."merchGroup", both of
  -- which are objects outside this change's claim. So the cross-division rule is enforced
  -- by the SEED (one authoritative category per (mg_code, mg_desc) pair, applied to every
  -- division), by the per-division verification in section 5, and by section C of
  -- supabase/tests/mg_category_taxonomy_contracts.sql — and the constraint is named and
  -- commented for exactly what it does enforce, nothing more.
  constraint mg_category_merch_group_one_category_per_mg_row
    unique (merch_group_mg_id)
);

create index if not exists mg_category_merch_group_category_idx
  on core.mg_category_merch_group (mg_category_id);

comment on table core.mg_category_merch_group is
  'Issue #1163. Category -> MG01 product type. One category has many MG01 rows; each MG01 '
  'ROW has at most one category (enforced by the unique constraint on merch_group_mg_id; '
  'the cross-division rule that the SAME product type carries the same category in every '
  'division is enforced by the seed and by the contract tests, not by that constraint). '
  'Links to core."merchGroup"(mg_id), NOT to the MG01 letter code: codes are unique only '
  'per division+type and collide semantically (mg_id 26 = ''A'' LEATHER/COWHIDE vs '
  'mg_id 2462 = ''A'' Stretched/Box, both mgTypeCode ''01'').';

comment on column core.mg_category_merch_group.merch_group_mg_id is
  'core."merchGroup".mg_id. Company/division scope is inherited from that row.';

comment on constraint mg_category_merch_group_one_category_per_mg_row
  on core.mg_category_merch_group is
  'Issue #1163 acceptance check 3: ONE merchandise-group ROW cannot belong to two '
  'categories. It does NOT constrain the same product type across divisions, and it does '
  'NOT constrain the linked row to mgTypeCode ''01'' — a CHECK cannot query another table, '
  'and both of those would need an object outside this change''s claim. Section 5 of the '
  'migration and the contract tests cover them.';

-- -------------------------------------------------------------------------------------
-- 3. Structural seed — the seven categories.
-- -------------------------------------------------------------------------------------

insert into core.mg_category (code, name, sort_order)
values
  ('WALL',      'Wall',      10),
  ('TABLETOP',  'Tabletop',  20),
  ('CLOCK',     'Clock',     30),
  ('STORAGE',   'Storage',   40),
  ('WORKSPACE', 'Workspace', 50),
  ('FLOOR',     'Floor',     60),
  ('GARDEN',    'Garden',    70)
on conflict (code) do update
  set name       = excluded.name,
      sort_order = excluded.sort_order,
      updated_at = now();

-- -------------------------------------------------------------------------------------
-- 4. Structural seed — the 20 category-to-MG01 mappings, resolved per division.
--
-- THE FOURTH COLUMN IS THE DECLARED DIVISION SCOPE: the divisions in which this product
-- type is EXPECTED to exist as an active MG01 row. It is the single authoritative
-- declaration and section 5 builds its expected grid from it.
--
-- THE SEED DELIBERATELY DOES NOT FILTER ON IT. The seed links EVERY active MG01 row whose
-- (mg_code, mg_desc) pair is authoritative, in whatever division it is found. The
-- declaration says what MUST exist, not what MAY: if 'Q' turns up in SP001 tomorrow, the
-- honest outcome is that it gets its correct STORAGE category and section 5 reports the
-- undeclared cell as a notice — not that it is left categoryless because a list in this
-- file has not caught up. Filtering the seed on the declaration would silently produce
-- exactly the unlinked rows this migration exists to prevent.
-- -------------------------------------------------------------------------------------

with authoritative (mg_code, mg_desc, category_code, expected_divisions) as (
  values
    -- Wall
    ('A', 'Stretched/Box',   'WALL',      array['CW001','EH001','SP001']),
    ('B', 'Framed',          'WALL',      array['CW001','EH001','SP001']),
    ('C', 'Plaque',          'WALL',      array['CW001','EH001','SP001']),
    ('D', 'Functional',      'WALL',      array['CW001','EH001','SP001']),
    ('E', 'Other Wall',      'WALL',      array['CW001','EH001','SP001']),
    -- Tabletop
    ('F', 'Block',           'TABLETOP',  array['CW001','EH001','SP001']),
    ('G', 'Box',             'TABLETOP',  array['CW001','EH001','SP001']),
    ('H', 'Photo Frames',    'TABLETOP',  array['CW001','EH001','SP001']),
    ('J', 'Object',          'TABLETOP',  array['CW001','EH001','SP001']),
    ('K', 'Other tabletop',  'TABLETOP',  array['CW001','EH001','SP001']),
    -- Clock
    ('M', 'Clocks',          'CLOCK',     array['CW001','EH001','SP001']),
    -- Storage
    ('N', 'Soft storage',    'STORAGE',   array['CW001','EH001','SP001']),
    ('P', 'Hard storage',    'STORAGE',   array['CW001','EH001','SP001']),
    ('R', 'Other storage',   'STORAGE',   array['CW001','EH001','SP001']),
    -- Storage — OWNER RULING 2026-08-18 (Albert Hazan): 'Q' is real and belongs under
    -- Storage. Verified live the same day: it exists as an ACTIVE MG01 row in CW001 ONLY,
    -- which is why its declared scope is one division and not three. The workbook does
    -- not carry this row yet; the recorded owner ruling is the authority until it does.
    ('Q', 'TBD storage',     'STORAGE',   array['CW001']),
    -- Workspace
    ('S', 'Stationery org',  'WORKSPACE', array['CW001','EH001','SP001']),
    ('T', 'Desk acc',        'WORKSPACE', array['CW001','EH001','SP001']),
    ('U', 'Other workspace', 'WORKSPACE', array['CW001','EH001','SP001']),
    -- Floor
    ('V', 'Floor coverings', 'FLOOR',     array['CW001','EH001','SP001']),
    -- Garden
    ('W', 'Garden',          'GARDEN',    array['CW001','EH001','SP001'])
),
resolved as (
  select c.id as mg_category_id, mg.mg_id
  from authoritative a
  join core.mg_category c
    on c.code = a.category_code
  join core."merchGroup" mg
    on mg."mgTypeCode" = '01'
   and mg.is_active is true          -- see "ONLY is_active ROWS ARE MATCHED" in the header
   and upper(btrim(mg.mg_code)) = upper(a.mg_code)
   and lower(btrim(mg.mg_desc)) = lower(a.mg_desc)
)
insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
select mg_category_id, mg_id from resolved
on conflict (merch_group_mg_id) do nothing;

-- -------------------------------------------------------------------------------------
-- 5. Verification — refuse to finish quietly if the seed did not do what it claims.
-- -------------------------------------------------------------------------------------

do $$
declare
  v_categories      integer;
  v_pairs           integer;
  v_source_rows     integer;
  v_types           integer;
  v_divisions       integer;
  v_expected_links  integer;
  v_actual_links    integer;
  v_missing         text;
  v_drift           text;
  v_dupes           text;
  v_undeclared      text;
  v_seen_divisions  text;
  v_renamed         text;
begin
  -- STRUCTURE MUST APPLY EVERYWHERE; ONLY THE ROW ASSERTION IS CONDITIONAL.
  -- ------------------------------------------------------------------------------
  -- WHY THIS CONDITION EXISTS - DO NOT "SIMPLIFY" IT AWAY.
  -- This migration is replayed from EMPTY on an ephemeral database in CI
  -- (.github/workflows/database-contract-tests.yml). That database carries the SCHEMA
  -- of core."merchGroup" but not a single row of it. The first version of this block
  -- raised unconditionally when the authoritative product types did not resolve, so
  -- on the empty database the exception rolled the WHOLE migration back and the two
  -- tables were never created at all. A structural migration is not allowed to depend
  -- on production ROW CONTENT in order to apply its STRUCTURE.
  --
  -- The fix is NOT to drop the guard. It is to distinguish the two situations:
  --   * NO ACTIVE MG01 merchandise-group rows exist at all -> there is nothing to map.
  --     Skip the mapping assertion with a LOUD notice. Nothing is half-seeded, because
  --     nothing could be seeded.
  --   * ACTIVE MG01 rows DO exist -> then EVERY DECLARED (product type, division) cell
  --     must resolve to an active MG01 row in THAT division carrying its authoritative
  --     category. Anything less raises and rolls back, naming the exact missing
  --     (division, code, description) triples.
  --
  -- THE SHAPE IS DERIVED, NEVER HARD-CODED. `v_expected_links` is the number of cells
  -- produced by unnesting `expected_divisions` over the authoritative list - today
  -- 19 types x 3 divisions + 'Q' in CW001 only = 58. The number 58 appears NOWHERE in
  -- this file. Widen or narrow a type's declared scope and the expectation moves with it.
  --
  -- WHY NOT "did each type resolve somewhere?" - because a LEFT JOIN from the flat
  -- authoritative rows emits NO ROW for a division that failed to match, not a NULL row.
  -- Under the old check, 'K' matching in two divisions and failing in the third produced
  -- two non-null rows, no NULLs, an "OK" notice and a COMMITTED 56-of-57 seed. Expanding
  -- the DECLARED (type, division) pairs into a grid and then looking for holes in THAT
  -- grid is what makes a one-division drift loud. Declaring the scope narrows WHICH cells
  -- are expected; it does not soften what happens to a cell that is expected and missing.
  --
  -- DIVISION MATCHING IS ON THE DIVISION CODE STRING (`divisionCode_fk`), because that is
  -- what the declaration names. An active MG01 row with a blank division code therefore
  -- cannot satisfy a declared cell - it raises, which is right: a merchandise-group row
  -- with no division code is itself a defect. To make that diagnosable rather than
  -- baffling, the failure message lists the division labels actually seen.
  --
  -- The drift check below is unconditional in both cases: it only looks at links that
  -- already exist, so it costs nothing on an empty database and never weakens.
  -- ------------------------------------------------------------------------------

  select count(*) into v_categories from core.mg_category;
  if v_categories < 7 then
    raise exception
      'Issue #1163: expected the 7 mgCategory rows, found % - seed did not apply.',
      v_categories;
  end if;

  -- The categories themselves are authoritative, division-independent reference data.
  -- They seed unconditionally on every database, so this assertion stays unconditional.

  -- The gate counts ACTIVE MG01 rows, i.e. exactly the population the seed join matches
  -- against. Counting a different population in the gate than in the join is how a gate
  -- silently stops guarding, so the two are kept identical on purpose.
  select count(*) into v_source_rows
  from core."merchGroup"
  where "mgTypeCode" = '01' and is_active is true;

  with authoritative (mg_code, mg_desc, category_code, expected_divisions) as (
    values
      ('A','Stretched/Box','WALL',array['CW001','EH001','SP001']),
      ('B','Framed','WALL',array['CW001','EH001','SP001']),
      ('C','Plaque','WALL',array['CW001','EH001','SP001']),
      ('D','Functional','WALL',array['CW001','EH001','SP001']),
      ('E','Other Wall','WALL',array['CW001','EH001','SP001']),
      ('F','Block','TABLETOP',array['CW001','EH001','SP001']),
      ('G','Box','TABLETOP',array['CW001','EH001','SP001']),
      ('H','Photo Frames','TABLETOP',array['CW001','EH001','SP001']),
      ('J','Object','TABLETOP',array['CW001','EH001','SP001']),
      ('K','Other tabletop','TABLETOP',array['CW001','EH001','SP001']),
      ('M','Clocks','CLOCK',array['CW001','EH001','SP001']),
      ('N','Soft storage','STORAGE',array['CW001','EH001','SP001']),
      ('P','Hard storage','STORAGE',array['CW001','EH001','SP001']),
      ('R','Other storage','STORAGE',array['CW001','EH001','SP001']),
      -- OWNER RULING 2026-08-18: 'Q' is real and is STORAGE. CW001 only (verified live).
      ('Q','TBD storage','STORAGE',array['CW001']),
      ('S','Stationery org','WORKSPACE',array['CW001','EH001','SP001']),
      ('T','Desk acc','WORKSPACE',array['CW001','EH001','SP001']),
      ('U','Other workspace','WORKSPACE',array['CW001','EH001','SP001']),
      ('V','Floor coverings','FLOOR',array['CW001','EH001','SP001']),
      ('W','Garden','GARDEN',array['CW001','EH001','SP001'])
  ),
  -- THE EXPECTED GRID, DERIVED FROM THE DECLARATION rather than from a uniform cross
  -- join. One row per (product type, declared division). 58 cells today; the number is
  -- computed, never written down.
  declared as (
    select
      a.mg_code, a.mg_desc, a.category_code,
      upper(btrim(u.division_code)) as division_key
    from authoritative a
    cross join lateral unnest(a.expected_divisions) as u(division_code)
  ),
  active_mg01 as (
    select
      mg.mg_id,
      upper(btrim(coalesce(mg."divisionCode_fk", ''))) as division_key,
      coalesce(
        nullif(btrim(mg."divisionCode_fk"), ''),
        'division_id ' || coalesce(mg."divisionCode_id_fk"::text, '(null)')
      ) as division_label,
      upper(btrim(mg.mg_code)) as code_key,
      lower(btrim(mg.mg_desc)) as desc_key
    from core."merchGroup" mg
    where mg."mgTypeCode" = '01' and mg.is_active is true
  ),
  linked as (
    select m.*, c.code as actual_category
    from active_mg01 m
    left join core.mg_category_merch_group l on l.merch_group_mg_id = m.mg_id
    left join core.mg_category c on c.id = l.mg_category_id
  ),
  graded as (
    select
      d.division_key, d.mg_code, d.mg_desc, d.category_code,
      m.mg_id, m.actual_category
    from declared d
    left join linked m
      on m.division_key = d.division_key
     and m.code_key = upper(d.mg_code)
     and m.desc_key = lower(d.mg_desc)
  ),
  holes as (
    select
      division_key || ' / ' || mg_code || ' ' || mg_desc
        || case
             when mg_id is null then ' (no active MG01 row matched)'
             else ' (row ' || mg_id || ' exists but is not linked)'
           end as hole_text
    from graded
    where mg_id is null or actual_category is null
  ),
  -- DRIFT is checked against EVERY linked active MG01 row whose (code, description) pair
  -- is authoritative, in ANY division - not only inside the declared grid. A link that a
  -- human re-pointed in an undeclared division must be just as loud as one inside it.
  drift as (
    select distinct
      l.division_label || ' / ' || l.code_key || ' ' || l.desc_key
        || ' -> ' || l.actual_category as drift_text
    from linked l
    join authoritative a
      on upper(a.mg_code) = l.code_key
     and lower(a.mg_desc) = l.desc_key
    where l.actual_category is not null
      and l.actual_category <> a.category_code
  ),
  -- AMBIGUOUS SOURCE ROWS, detected directly instead of inferred from a count. Two ACTIVE
  -- MG01 rows with the same (code, description) in the same division mean the seed
  -- attached both; that is the exact failure the `is_active` filter exists to prevent.
  -- The old check compared link count against grid size, which no longer works now that
  -- an undeclared-but-real cell may legitimately add a link outside the grid.
  dupes as (
    select
      l.division_label || ' / ' || l.code_key || ' ' || l.desc_key
        || ' (' || count(*) || ' active rows)' as dupe_text
    from linked l
    join authoritative a
      on upper(a.mg_code) = l.code_key
     and lower(a.mg_desc) = l.desc_key
    group by l.division_label, l.code_key, l.desc_key
    having count(*) > 1
  ),
  -- THE REVERSE CHECK: an authoritative product type resolving in a division the list did
  -- NOT declare. Reported, never raised - see "CAN A DIVISION LEGITIMATELY CARRY ONLY
  -- PART OF THE MG01 SET?" in the header for why the asymmetry is deliberate.
  undeclared as (
    select distinct
      l.division_label || ' / ' || l.code_key || ' ' || l.desc_key as undeclared_text
    from linked l
    join authoritative a
      on upper(a.mg_code) = l.code_key
     and lower(a.mg_desc) = l.desc_key
    where not exists (
      select 1 from declared d
      where upper(d.mg_code) = l.code_key
        and lower(d.mg_desc) = l.desc_key
        and d.division_key = l.division_key
    )
  ),
  seen as (select distinct division_label from active_mg01)
  select
    (select count(*) from authoritative),
    (select count(distinct division_key) from declared),
    (select count(*) from declared),
    (select count(*) from graded where actual_category = category_code),
    (select string_agg(hole_text, '; ' order by hole_text) from holes),
    (select string_agg(drift_text, '; ' order by drift_text) from drift),
    (select string_agg(dupe_text, '; ' order by dupe_text) from dupes),
    (select string_agg(undeclared_text, '; ' order by undeclared_text) from undeclared),
    (select string_agg(division_label, ', ' order by division_label) from seen)
  into
    v_types, v_divisions, v_expected_links, v_actual_links,
    v_missing, v_drift, v_dupes, v_undeclared, v_seen_divisions;

  -- UNCONDITIONAL. An existing link that disagrees with the authoritative mapping is a
  -- drift on ANY database and is never overwritten quietly.
  if v_drift is not null then
    raise exception
      'Issue #1163: existing category links disagree with the authoritative mapping: %. '
      'Refusing to overwrite a deliberate change - resolve this on the issue.', v_drift;
  end if;

  if v_dupes is not null then
    raise exception
      'Issue #1163: a division carries more than one ACTIVE mgTypeCode ''01'' row for the '
      'same code/description pair, so the seed attached a category to both: %. Resolve the '
      'duplicate source rows on the issue.', v_dupes;
  end if;

  if v_source_rows = 0 then
    -- Loud, never silent. The structure is in place and the mapping seed is a no-op
    -- because there is no source data on this database to map.
    raise notice
      'Issue #1163: core."merchGroup" holds NO ACTIVE mgTypeCode ''01'' rows on this '
      'database, so the category-to-MG01 mappings were NOT seeded and their assertion is '
      'SKIPPED. The tables, constraints, indexes, RLS and grants applied in full, and '
      'the 7 categories were seeded. On a database that does carry active MG01 rows this '
      'same block raises instead of skipping.';
  elsif v_missing is not null then
    -- Rows ARE present, so a hole in the grid is a real failure. Hard stop.
    --
    -- TELLING A MOVED LINK APART FROM A RENAMED SOURCE DESCRIPTION. If someone upstream
    -- corrects a description (say all three 'Desk acc' rows become 'Desk accessory'), the
    -- existing links survive but the join above no longer finds them, so those rows show
    -- up as missing. That looks identical to a genuinely unseeded row unless we say so.
    -- The tell is an ALREADY-LINKED active MG01 row whose (code, description) pair is not
    -- in the authoritative list, so we look for exactly that and name it in the error.
    -- A description rename is NOT something this migration may absorb: its authoritative
    -- list is the workbook, and changing it is a governed decision. The fix is a
    -- follow-up migration under its own issue, never an edit to this applied file.
    select string_agg(distinct mg.mg_code || ' ' || mg.mg_desc, '; ')
      into v_renamed
    from core.mg_category_merch_group l
    join core."merchGroup" mg on mg.mg_id = l.merch_group_mg_id
    where mg."mgTypeCode" = '01'
      and mg.is_active is true
      and (upper(btrim(mg.mg_code)), lower(btrim(mg.mg_desc))) not in (
        ('A','stretched/box'),('B','framed'),('C','plaque'),('D','functional'),
        ('E','other wall'),('F','block'),('G','box'),('H','photo frames'),
        ('J','object'),('K','other tabletop'),('M','clocks'),('N','soft storage'),
        ('P','hard storage'),('R','other storage'),('Q','tbd storage'),
        ('S','stationery org'),
        ('T','desk acc'),('U','other workspace'),('V','floor coverings'),('W','garden')
      );

    raise exception
      'Issue #1163: % active mgTypeCode ''01'' rows were expected to fill all % declared '
      '(product type, division) cells - % authoritative product types across % declared '
      'divisions - but only % resolved. Missing: %. Division labels actually present: %.%',
      v_source_rows, v_expected_links, v_types, v_divisions, v_actual_links, v_missing,
      coalesce(v_seen_divisions, '(none)'),
      case
        when v_renamed is not null then
          ' NOTE: these merchandise-group rows are ALREADY LINKED but their descriptions '
          'are not in the authoritative list: ' || v_renamed || '. That is the signature '
          'of an upstream DESCRIPTION RENAME, not of a missing link. This migration must '
          'not be edited to follow the rename - it is already applied elsewhere. Open a '
          'follow-up shared-db issue to update the authoritative list in a NEW migration.'
        else
          ' If instead a human deliberately moved or removed a link, that is exactly what '
          'this guard exists to block: resolve it on the issue rather than re-applying.'
      end;
  end if;

  -- THE REVERSE FINDING. Loud, but not fatal: the row was found and correctly categorised,
  -- so the data is right and only the declaration is stale. See the header for why this
  -- notices rather than raises.
  if v_undeclared is not null then
    raise notice
      'Issue #1163 NOTICE: these authoritative product types resolve in divisions the '
      'authoritative list does NOT declare: %. They were seeded with their correct '
      'category, so nothing is wrong with the data - the DECLARATION is out of date. '
      'Widen expected_divisions in a follow-up governed migration under its own issue; '
      'do not edit this applied file.', v_undeclared;
  end if;

  select count(*) into v_pairs from core.mg_category_merch_group;
  raise notice
    'Issue #1163 OK: % categories, % category-to-MG01 link rows total (% declared cells '
    'from % product types across % declared divisions, from % active MG01 source rows).',
    v_categories, v_pairs, v_expected_links, v_types, v_divisions, v_source_rows;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6. RLS and grants — same shape as core.product_size (issue #597).
--
-- WHAT ACTUALLY SHIPS HERE, stated precisely rather than aspirationally:
--   * `anon`  : nothing at all (every privilege revoked).
--   * `authenticated` : SELECT only. There is no INSERT/UPDATE/DELETE grant, so Postgres
--     refuses a write from a browser session BEFORE RLS is ever consulted. The
--     `admin_write` policy exists so that a future decision to grant writes to
--     administrators is already scoped, but today no browser role can reach it.
--   * `service_role` : full grants, and it has BYPASSRLS, so server-side jobs and
--     governed migrations write these rows.
-- That is the same shape as core.product_size (issue #597) and it is deliberate: these
-- are structural reference rows, maintained by migration, not by the application.
-- -------------------------------------------------------------------------------------

alter table core.mg_category             enable row level security;
alter table core.mg_category_merch_group enable row level security;

drop policy if exists shared_read on core.mg_category;
create policy shared_read on core.mg_category
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

drop policy if exists admin_write on core.mg_category;
create policy admin_write on core.mg_category
  for all to authenticated
  using ((select app.has_any_role(array['administrator']::app.app_role[])))
  with check ((select app.has_any_role(array['administrator']::app.app_role[])));

drop policy if exists shared_read on core.mg_category_merch_group;
create policy shared_read on core.mg_category_merch_group
  for select to authenticated
  using (
    (select app.has_any_role(array[
      'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
    ]::app.app_role[]))
  );

drop policy if exists admin_write on core.mg_category_merch_group;
create policy admin_write on core.mg_category_merch_group
  for all to authenticated
  using ((select app.has_any_role(array['administrator']::app.app_role[])))
  with check ((select app.has_any_role(array['administrator']::app.app_role[])));

revoke all on table core.mg_category             from public, anon;
revoke all on table core.mg_category_merch_group from public, anon;

grant select on table core.mg_category             to authenticated;
grant select on table core.mg_category_merch_group to authenticated;

grant all on table core.mg_category             to service_role;
grant all on table core.mg_category_merch_group to service_role;

-- -------------------------------------------------------------------------------------
-- 7. THE READ CONTRACT (issue #1163 acceptance check 5)
--
-- Deliberately shipped as a DOCUMENTED QUERY rather than a view: this change is claimed
-- for exactly two objects, `core.mg_category` and `core.mg_category_merch_group`, and a
-- view would be a third object outside that claim. The query below is the supported
-- contract; a view over it can be added later under its own claim if an app wants one.
--
--   select
--     cat.code            as category_code,
--     cat.name            as category_name,
--     cat.sort_order      as category_sort_order,
--     mg.mg_code          as mg01_code,
--     mg.mg_desc          as mg01_product_type,
--     mg.mg_id            as merch_group_mg_id,
--     mg."companyCode_id_fk"  as company_id,
--     mg."divisionCode_id_fk" as division_id,
--     mg.is_active        as mg01_is_active
--   from core.mg_category_merch_group link
--   join core.mg_category cat on cat.id = link.mg_category_id
--   join core."merchGroup" mg  on mg.mg_id = link.merch_group_mg_id
--   where cat.is_active
--   order by cat.sort_order, mg."divisionCode_id_fk", mg.mg_code;
--
-- To resolve ONE item's category, start from the MG01 row the item selected and follow
-- link -> category. Never resolve by mg_code alone (see header). MG02/MG03 selections
-- must walk up `parent_id` to their MG01 ancestor first; they never carry a category of
-- their own.
-- -------------------------------------------------------------------------------------
