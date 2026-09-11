-- Issue #2172 — ColdLion landing unit 2: correct the item header/detail/merch-group
-- structures. Plan: plan_coldlion_landing_schema_completion.md §9 Step 3.
-- derived-from: 20260825023430
-- 20260825023430_coldlion_raw_landing_phases_2_6.sql is NOT edited; this is a
-- forward migration, per §11 "never edit applied migrations".
--
-- OBJECT CLAIM. This file writes exactly three objects and nothing else:
--   coldlion.item_header, coldlion.item_detail, coldlion.item_merch_group.
--
-- =====================================================================================
-- LIVE EVIDENCE THIS FILE WAS AUTHORED AGAINST (re-sampled 2026-09-03, read-only)
-- =====================================================================================
-- Issue #2172 requires the shape to come from a LIVE SAMPLE, not from /api-docs,
-- because the spec is proven stale for the history feeds. Both were checked:
--
--   * GET /EhpApi/items?companyCode=<co>&size=3&page=0 -> Spring Page envelope
--     (first,last,number,numberOfElements,size,sort,totalElements,totalPages).
--     The live record carries 146 field names; /api-docs ItemHeader declares 146.
--     The two sets are IDENTICAL. For this feed the spec is currently accurate.
--
--   * GET /EhpApi/itemDetails?companyCode=<co>&size=3&page=0 -> BARE JSON ARRAY.
--     There is NO page envelope and the `size` parameter is IGNORED: that request
--     returned the complete 26,747-record set. The live record carries 133 field
--     names; /api-docs ItemDetail declares 133; the sets are IDENTICAL. A loader
--     must not assume `/itemDetails` pages, and must not read `last`/`totalPages`
--     from it — there is no envelope to read them from.
--
-- itemPkey STABILITY, measured rather than assumed (plan §9 Step 3 makes the
-- one-row-per-itemPkey rule conditional on live evidence):
--   26,747 live itemDetails records -> 26,747 distinct `itemPkey`, maximum
--   multiplicity 1, zero null or empty values, and still 26,747 distinct when
--   scoped to (companyCode, divisionCode, itemNo, itemPkey). itemPkey is therefore
--   retained as the SKU key under its parent item, and the parent FK is retained.
--
-- CROSS-DIVISION ITEM NUMBERS ARE REAL, not hypothetical: in the live sample 20
-- item numbers occur under more than one divisionCode within a single companyCode
-- (divisions present: CW001, EH001, EP001, SP001). The three-part item identity
-- (company_code, division_code, item_no) is load-bearing and is preserved
-- unchanged; a two-part key would silently merge those 20 items.
--
-- No source rows, customer identifiers or licensed values are recorded here — only
-- field NAMES and aggregate counts, per §11 (this repository is public).
--
-- =====================================================================================
-- WHAT IS ACTUALLY WRONG WITH THE 20260825023430 SHAPE, AND WHAT THIS FILE CHANGES
-- =====================================================================================
-- 1. coldlion.item_detail stored merchandise groups as FOURTEEN INLINE COLUMNS
--    (merch_group01..merch_group14). The item header already stored its slots as
--    rows in coldlion.item_merch_group, so the same fact was modelled two different
--    ways in the same migration. Inline slot columns cannot satisfy the standing
--    rule that a CLEARED SLOT DISAPPEARS: an upsert writing NULL leaves a row that
--    still claims fourteen slots, and downstream `merch_group05 is null` cannot be
--    told apart from "never loaded". This file MOVES the detail slots into rows.
--
-- 2. coldlion.item_merch_group could only describe HEADER-level slots. ItemDetail
--    carries its own merchGroup01..14 (confirmed live above) and, under owner
--    ruling D16, licensor (slot 05) and property (slot 06) are attributes of the
--    COMPONENT STYLE and are never inherited from the parent assortment. With no
--    detail-level row destination, a loader had only two options, both wrong:
--    drop the component taxonomy, or fall back to the parent's value — which D16
--    forbids outright. item_pkey now scopes the row: NULL = the item-header slot,
--    non-NULL = that specific SKU's slot. Nothing reads one from the other.
--
-- 3. The merchGroupNNDesc family (14 fields on BOTH feeds) and itemDetails.labelDesc
--    are live but carry no row in docs/coldlion-field-decisions-20260819.csv, whose
--    silence is absence and not a decision. The OWNER RULING of 2026-09-03
--    (https://github.com/u2giants/shared-db/issues/2081#issuecomment-5526450180)
--    marks the merchGroupNNDesc family and labelDesc `ingest` on /items and
--    /itemDetails, satisfying D4 for these two feeds IN THEIR OWN RIGHT. It is
--    NOT an extension of D15, whose text answers the history-feed gap list; per
--    the D17 precedent a ruling naming one feed does not travel to another, so
--    this ruling authorises no other field and no other feed.
--    They are DESCRIPTIONS: evidence, never keys. The slot
--    description is therefore stored ON THE SLOT ROW (mg_desc) beside the code it
--    describes, and label_desc inline beside label_code. No key, constraint or
--    index anywhere in this file uses a description.
--
-- 4. Every other approved (`ingest`) field of both feeds was checked column by
--    column against the live field list: items has 78 ingest fields, 14 of which
--    are the merchGroup slots, and all 64 remaining are already columns of
--    coldlion.item_header; itemDetails has 59, 14 slots, and all 45 remaining are
--    already columns of coldlion.item_detail. So NO scalar column is added to
--    either table beyond label_desc, and none is renamed. The declined fields
--    (54 on items, 59 on itemDetails) map nowhere and are still absent.
--
-- NOT DONE HERE, DELIBERATELY: no loader (plan Step 7 owns loaders), no promotion
-- view or grant (Step 8), no row load of any kind, and no taxonomy interpretation.
-- Unknown-field refusal is a loader contract; this file records the sampled shape
-- the refusal must be keyed to, and the tests prove the structure that supports it.

do $$ begin
  if to_regclass('coldlion.item_header') is null
     or to_regclass('coldlion.item_detail') is null
     or to_regclass('coldlion.item_merch_group') is null then
    raise exception
      'Issue #2172 corrects the three ColdLion item tables from 20260825023430; one is missing';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 1. item_merch_group: add SKU scope, add the approved description, and make a
--    cleared slot structurally impossible to store as a blank.
-- -------------------------------------------------------------------------------------
alter table coldlion.item_merch_group
  add column if not exists item_pkey text,
  add column if not exists mg_desc   text;

-- Surrogate key, because the natural key now contains a deliberately nullable
-- column (item_pkey) and a PRIMARY KEY cannot hold NULL. The natural key survives
-- below as a UNIQUE ... NULLS NOT DISTINCT constraint, which is what actually
-- stops a replay from duplicating a header-scoped slot.
alter table coldlion.item_merch_group
  add column if not exists id uuid not null default gen_random_uuid();

alter table coldlion.item_merch_group
  drop constraint if exists item_merch_group_pkey;

alter table coldlion.item_merch_group
  add constraint item_merch_group_pkey primary key (id);

alter table coldlion.item_merch_group
  add constraint item_merch_group_slot_identity
  unique nulls not distinct (company_code, division_code, item_no, item_pkey, slot_no);

-- A cleared slot must be ABSENT, never present-and-blank. Without this a loader
-- could satisfy "the slot disappeared" by writing an empty string, and every
-- consumer downstream would still see fourteen slots.
alter table coldlion.item_merch_group
  add constraint item_merch_group_mg_code_not_blank check (btrim(mg_code) <> '');

-- Detail-scoped rows must hang off a real SKU. MATCH SIMPLE is exactly the
-- behaviour wanted: when item_pkey is NULL the row is header-scoped and this FK is
-- not enforced; when it is present the SKU must exist. The existing three-part FK
-- to item_header continues to cover the header-scoped rows.
alter table coldlion.item_merch_group
  add constraint item_merch_group_detail_fk
  foreign key (company_code, division_code, item_no, item_pkey)
  references coldlion.item_detail (company_code, division_code, item_no, item_pkey)
  on delete cascade;

-- No extra index: the slot-identity unique constraint above already indexes
-- (company_code, division_code, item_no, item_pkey, slot_no), whose four-column
-- prefix serves every SKU-scoped lookup.

comment on table coldlion.item_merch_group is
  'ColdLion merchandise-group slots as ROWS, for both grains. item_pkey IS NULL is the '
  'item-header slot; item_pkey NOT NULL is that SKU''s own slot. All fourteen slots are '
  'representable at each grain. A CLEARED SLOT IS DELETED by the current-state loader in '
  'the same transaction as its parent upsert - upsert-only would preserve stale taxonomy, '
  'and mg_code may not be blank, so a cleared slot cannot be faked as an empty string. '
  'Owner ruling D16: licensor (slot 05) and property (slot 06) describe the COMPONENT '
  'style, never the Master assortment. A detail slot is NEVER defaulted, copied or fallen '
  'back from the item-header slot, in either direction. THIS IS A LOADER RULE, NOT A '
  'SCHEMA GUARANTEE: this table only makes a compliant loader possible by giving each '
  'grain its own row. No constraint here can detect a loader that copies the parent '
  'value onto a SKU, because a SKU may legitimately share its parent licensor (D14 '
  'measured that in a substantial minority of prepack groups), so value-equality '
  'enforcement would reject real data. D16 is enforced by the Step 7 loader and the '
  'Step 8 promotion contract.';

comment on column coldlion.item_merch_group.item_pkey is
  'NULL = item-header grain. NOT NULL = the itemDetails SKU this slot belongs to. The '
  'uniqueness constraint uses NULLS NOT DISTINCT so replaying a header-scoped slot cannot '
  'duplicate it.';

comment on column coldlion.item_merch_group.mg_desc is
  'merchGroupNNDesc for this slot (owner ruling 2026-09-03, issue #2081 comment '
  '5526450180: ingest on /items and /itemDetails). Evidence, never a key: no '
  'constraint or index in this schema uses a description.';

-- -------------------------------------------------------------------------------------
-- 2. item_detail: the fourteen inline slot columns become rows; labelDesc lands.
-- -------------------------------------------------------------------------------------
alter table coldlion.item_detail
  drop column if exists merch_group01, drop column if exists merch_group02,
  drop column if exists merch_group03, drop column if exists merch_group04,
  drop column if exists merch_group05, drop column if exists merch_group06,
  drop column if exists merch_group07, drop column if exists merch_group08,
  drop column if exists merch_group09, drop column if exists merch_group10,
  drop column if exists merch_group11, drop column if exists merch_group12,
  drop column if exists merch_group13, drop column if exists merch_group14;

alter table coldlion.item_detail
  add column if not exists label_desc text;

-- item_merch_group's new FK needs a matching unique constraint on the parent. The
-- primary key already covers exactly these four columns; this asserts it rather
-- than assuming it, so the apply fails loudly if the key was ever collapsed.
do $$
declare v_keydef text;
begin
  select pg_get_constraintdef(oid) into v_keydef
  from pg_constraint where conrelid = 'coldlion.item_detail'::regclass and contype = 'p';
  if v_keydef is distinct from
     'PRIMARY KEY (company_code, division_code, item_no, item_pkey)' then
    raise exception 'coldlion.item_detail natural key is %, expected the four-part SKU key',
      coalesce(v_keydef, '<none>');
  end if;
end $$;

comment on table coldlion.item_detail is
  'One ColdLion SKU keyed by itemPkey under its parent item. itemPkey stability was '
  'MEASURED live on 2026-09-03, not assumed: 26,747 records, 26,747 distinct itemPkey, '
  'no nulls or blanks, maximum multiplicity 1. Merchandise groups are NOT stored here - '
  'they are rows in coldlion.item_merch_group scoped by item_pkey, so a cleared slot can '
  'disappear. Colour and size remain deliberately absent under owner decisions D4/D12. '
  'Live shape note for loaders: /itemDetails returns a BARE ARRAY and IGNORES the size '
  'parameter, so it has no page envelope to page through.';

comment on column coldlion.item_detail.label_desc is
  'labelDesc (owner ruling 2026-09-03, issue #2081 comment 5526450180: ingest on '
  '/items and /itemDetails). Description of label_code; evidence, never a key.';

-- -------------------------------------------------------------------------------------
-- 3. item_header: identity restated, no scalar column added.
-- -------------------------------------------------------------------------------------
comment on table coldlion.item_header is
  'One ColdLion item per company + division + item number. The division is part of the '
  'identity because the SAME item number genuinely occurs in different divisions - 20 such '
  'item numbers were counted in the live sample of 2026-09-03 - and a two-part key would '
  'silently merge them. All 64 non-slot approved (ingest) ItemHeader fields are already '
  'columns here; the 14 merchGroup slots are rows in coldlion.item_merch_group with '
  'item_pkey IS NULL. The 54 declined ItemHeader fields map nowhere and stay absent.';

-- -------------------------------------------------------------------------------------
-- 4. Closed landing posture, re-asserted for the three tables this file touched.
-- -------------------------------------------------------------------------------------
-- Written out literally rather than as a loop of `execute format(...)`: a
-- dynamically executed grant statement cannot be read off the migration file, and
-- the security posture of a landing table is exactly the thing a reviewer must be
-- able to read without running anything.
alter table coldlion.item_header       enable row level security;
alter table coldlion.item_detail       enable row level security;
alter table coldlion.item_merch_group  enable row level security;

revoke all on table coldlion.item_header      from public, anon, authenticated;
revoke all on table coldlion.item_detail      from public, anon, authenticated;
revoke all on table coldlion.item_merch_group from public, anon, authenticated;

grant all on table coldlion.item_header      to service_role;
grant all on table coldlion.item_detail      to service_role;
grant all on table coldlion.item_merch_group to service_role;

-- -------------------------------------------------------------------------------------
-- 5. Verify the apply produced the intended shape, so a partial apply cannot pass.
-- -------------------------------------------------------------------------------------
do $$
declare
  v_n int;
  v_t text;
begin
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'coldlion' and table_name = 'item_detail'
    and column_name like 'merch\_group%';
  if v_n <> 0 then
    raise exception 'item_detail still has % inline merch-group columns', v_n;
  end if;

  foreach v_t in array array['item_pkey','mg_desc','id'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'item_merch_group'
        and column_name = v_t
    ) then
      raise exception 'item_merch_group is missing column %', v_t;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.item_merch_group'::regclass
      and conname = 'item_merch_group_slot_identity'
      and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
  ) then
    raise exception 'item_merch_group slot identity is not NULLS NOT DISTINCT';
  end if;

  foreach v_t in array array['item_header','item_detail','item_merch_group'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'coldlion' and c.relname = v_t and c.relrowsecurity
    ) then
      raise exception 'coldlion.% has row level security disabled', v_t;
    end if;
    if exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'coldlion' and table_name = v_t
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception 'coldlion.% is readable by an application role', v_t;
    end if;
  end loop;

  raise notice 'Issue #2172: item landing structures corrected and verified.';
end $$;

-- Re-review bump (#2172): trivial comment-only change to produce a fresh head
-- for governed round-2 review after a verdict-recording infrastructure fault
-- (issue #2208) made the prior head unrecoverable. No behavior change.

-- Re-review bump 2 (#2172): trivial comment-only change to produce a fresh
-- head after a valid slot-1 APPROVE at the prior head (5438de6a) blocked
-- slot-2 reviewer replacement (same head-wide verdict-guard defect class as
-- issue #2208), following slot 2's original reviewer (kimi-k3) hitting a
-- weekly provider quota limit unrelated to this migration's content. No
-- behavior change.
