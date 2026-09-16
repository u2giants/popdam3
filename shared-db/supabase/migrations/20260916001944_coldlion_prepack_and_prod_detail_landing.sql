-- =====================================================================================
-- Issue #2863 - ColdLion landing UNIT 5b: /prepackDetail and /proddetails.
--
-- Split from #2179 on 2026-09-13 at the owner's direction. Tracker: #2081. Plan:
-- plan_coldlion_landing_schema_completion.md section 9 Step 6. Author lane claim: #3006.
-- Structure only; this migration loads no rows and creates no loader.
--
-- WHAT THIS ADDS
-- --------------
--   coldlion.prepack_detail  GET /prepackDetail  - prepack recipe lines, BARE ARRAY
--   coldlion.prod_detail     GET /proddetails    - production-order lines, BARE ARRAY
--
-- Both hang off the phase-1 spine (20260818232639) and follow the unit 5a conventions
-- (20260905104449): ColdLion field names transliterated to snake_case, no per-row raw
-- archive (D5), no foreign keys outside coldlion, no application grants, a source_hash
-- over the complete fetched record before projection, and first_seen_at / last_seen_at
-- bookkeeping.
--
-- WHY THESE TWO ARE AUTHORABLE NOW
-- --------------------------------
-- Unit 5a recorded both feeds as unauthorable because each needs a key we could not
-- obtain. That was our error, withdrawn on 2026-09-03 (coldlion-open-questions.md item
-- 2.33): prodOrderNo comes off /prodHistory rows and prepackCode off /inventory rows and
-- off /proddetails itself. Nothing is needed from ColdLion. Both were re-sampled live on
-- 2026-09-15 for this migration.
--
-- EVIDENCE. Live sampling on 2026-09-15, recorded in
-- docs/coldlion-unit-5b-grain-proof-20260915.md. Unlike the unit 5a feeds, /v2/api-docs
-- DOES type these two (PrepackDetail, ProdOrderDetail) and the live field union matched
-- the typed definition exactly on both - 18 and 21 fields. The spec is still not the
-- contract: a loader's unknown-field refusal must be keyed to the sampled shape.
--
-- GRAIN PROOF 1 - /prepackDetail. 120 prepack codes harvested from /inventory and
-- /proddetails, every one returning rows; 456 rows in total, 18 fields in the union.
--   * (companyCode, prePackCode, sequence) is unique across all 456 rows.
--   * The full descriptive tuple (company, division, prepack, item, colour, size, dim,
--     label) is ALSO 456/456 here, so it does not disprove the key - but it describes
--     the row and does not identify it. The vendor sequence is the line identity and is
--     what the primary key uses.
--   * There is NO vendor row id on this feed - no pkey - so the key above is the
--     smallest proven source identity, and the surrogate is the key itself, not a UUID.
--   * companyCode IS present in this payload. EDGEHOME on all 456 rows; it still leads
--     the key so a second tenant cannot collide on one prepack code.
--
-- GRAIN PROOF 2 - /proddetails. 45 production orders harvested from /prodHistory across
-- seven windows, every one returning rows; 166 rows, 21 fields in the union.
--   * pkey is a REAL vendor row id and is unique on its own: 166 distinct over 166.
--   * (prodOrderNo, prodLineSeq) is independently unique as well: 166 distinct over 166.
--     Both are asserted - the second as a unique constraint - so a future pull that
--     breaks either one fails visibly instead of collapsing two lines into one.
--   * ZERO duplicate collapse was observed on either key. Nothing here is a guessed
--     natural key and nothing is silently de-duplicated.
--   * The payload carries NO companyCode (it is a required REQUEST parameter), so
--     company_code is stamped from the request and leads the primary key.
--
-- SOURCE RULES CARRIED FORWARD FROM THE SPINE
-- -------------------------------------------
--   * 1900-01-01 is ColdLion's empty-date marker. NOT ONE row of either sample carried
--     it: every createdTime and modTime was a real timestamp (earliest 2019-04-17). The
--     rule still holds for a loader; it simply has no instance here yet.
--   * ColdLion sends the empty string where other systems send null. Blank on all 456
--     prepack rows: detailPrepack and dimCode; labelCode blank on 446. Blank on the 166
--     prod_detail rows: dimCode on all 166, prepackCode on 126, merchGroup05Desc on 54,
--     custPONumber on 31, labelCode on 6. Text columns are therefore nullable and are
--     NOT check-constrained non-blank: the landing layer records what arrived.
--   * divisionCode is recorded exactly as sent. CW001, EH001 and SP001 are live in both
--     feeds; nothing here normalises casing.
--
-- THREE THINGS DELIBERATELY NOT DONE
-- ----------------------------------
--   * NO EP001 EXCLUSION CHECK, for the unit 5a reason: these are transactional feeds,
--     not curated masters, and an exclusion would fail a load rather than filter it.
--   * NO CHILD TABLES. Neither feed contains a repeated group; each is already flat at
--     one row per line. Plan Step 6 requires a child table only where one exists.
--   * NO LOADER AND NO ROWS. Loaders are Step 7, under their own claim.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception 'ColdLion phase 1 spine is required before unit 5b';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- coldlion.prepack_detail - GET /prepackDetail?companyCode=..&prepackCode=.. (bare array)
-- -------------------------------------------------------------------------------------
create table coldlion.prepack_detail (
  -- Identity. See GRAIN PROOF 1 above. All three come from the payload.
  company_code text    not null,
  prepack_code text    not null,
  sequence_no  integer not null,

  -- The real SKU this prepack line resolves to, plus the recipe multiplier.
  division_code text,
  item_no       text,
  color_code    text,
  size_code     text,
  dim_code      text,
  label_code    text,
  -- LOADER NOTE: integer, unlike prod_detail.prod_qty / wip_qty which are numeric.
  -- The live sample only ever showed whole 1..3. Confirm quantity never arrives
  -- fractional before loading: a fractional value will fail the insert loudly
  -- rather than silently truncate, which is the intended fail-closed behaviour.
  quantity      integer,

  detail_prepack text,

  item_cost              numeric,
  item_price             numeric,
  item_price_capitalized numeric,

  created_time timestamptz,
  created_user text,
  mod_time     timestamptz,
  mod_user     text,

  run_id      uuid        not null references coldlion.sync_run(id),
  fetched_at  timestamptz not null,
  source_hash text        not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,

  primary key (company_code, prepack_code, sequence_no),
  check (last_seen_at >= first_seen_at)
);

comment on table coldlion.prepack_detail is
  'ColdLion GET /prepackDetail landing table (issue #2863, unit 5b). One row per company + prepackCode + sequence, proven unique over 456 rows drawn from 120 distinct prepack codes on 2026-09-15 with ZERO duplicate collapse. Bare JSON array - no page envelope; prepackCode is a required request parameter, so the feed is enumerated by harvesting codes from /inventory and /proddetails, not by paging. Eighteen source fields. Contains no vendor row id. Grain proof: docs/coldlion-unit-5b-grain-proof-20260915.md.';

comment on column coldlion.prepack_detail.prepack_code is
  'ColdLion prePackCode (capital P in the payload). The request key for this feed. Values look like PPK2601; harvest them from /inventory.prepackCode or /proddetails.prepackCode.';
comment on column coldlion.prepack_detail.sequence_no is
  'ColdLion sequence, renamed only to keep a bare SQL keyword out of the column list. It is the vendor line identity within one prepack (observed 1..12) and completes the primary key. This feed emits NO row id, so this key is the smallest proven source identity, not a guess.';
comment on column coldlion.prepack_detail.item_no is
  'The REAL SKU on the prepack line, together with color_code, size_code, dim_code and label_code. Descriptive: it does not identify the row.';
comment on column coldlion.prepack_detail.quantity is
  'Recipe multiplier - how many of this SKU are in one prepack. Observed 1..3 in the sample.';
comment on column coldlion.prepack_detail.detail_prepack is
  'Blank on all 456 sampled rows. A nested-prepack marker never observed populated; recorded as sent, never interpreted.';
comment on column coldlion.prepack_detail.item_price_capitalized is
  'ColdLion emits BOTH itemPrice and ItemPrice on every row of this feed - a genuine duplicate-cased property, present in /v2/api-docs as well. They were equal on all 456 sampled rows, but nothing in the source guarantees that, so both land and neither is dropped. item_price is itemPrice; this column is ItemPrice. A loader must not fold them.';
comment on column coldlion.prepack_detail.division_code is
  'Recorded exactly as sent. CW001, EH001 and SP001 are all live in this feed; nothing here normalises casing.';

-- -------------------------------------------------------------------------------------
-- coldlion.prod_detail - GET /proddetails?companyCode=..&prodOrderNo=.. (bare array)
-- -------------------------------------------------------------------------------------
create table coldlion.prod_detail (
  -- Identity. company_code is request-stamped: the payload does not carry it.
  company_code text   not null,
  pkey         bigint not null,

  -- The second, independently proven identity. Constrained unique below.
  prod_order_no bigint  not null,
  prod_line_seq integer not null,

  division_code text,
  item_pkey     bigint,
  item_no       text,
  item_desc     text,
  color_code    text,
  size_code     text,
  dim_code      text,
  label_code    text,
  prepack_code  text,

  prod_qty  numeric,
  wip_qty   numeric,
  prod_cost numeric,

  cust_po_number      text,
  merch_group_05_desc text,

  created_time timestamptz,
  created_user text,
  mod_time     timestamptz,
  mod_user     text,

  run_id      uuid        not null references coldlion.sync_run(id),
  fetched_at  timestamptz not null,
  source_hash text        not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,

  primary key (company_code, pkey),
  unique (company_code, prod_order_no, prod_line_seq),
  check (last_seen_at >= first_seen_at)
);

comment on table coldlion.prod_detail is
  'ColdLion GET /proddetails landing table (issue #2863, unit 5b). One row per production-order LINE. Two identities were proven independently over 166 rows from 45 production orders on 2026-09-15, each 166 distinct over 166 with ZERO duplicate collapse: the vendor row id pkey, which is the primary key, and (prodOrderNo, prodLineSeq), which is a unique constraint so a future pull that breaks it fails visibly. Bare JSON array - no page envelope; prodOrderNo is a required request parameter, so the feed is enumerated by harvesting order numbers from /prodHistory. Twenty-one source fields plus the request-stamped company_code. Grain proof: docs/coldlion-unit-5b-grain-proof-20260915.md.';

comment on column coldlion.prod_detail.company_code is
  'Stamped from the request, NOT from the payload - /proddetails returns no companyCode even though it requires one. It leads the primary key so two companies cannot collide on one pkey.';
comment on column coldlion.prod_detail.pkey is
  'ColdLion pkey - a REAL vendor row id for the production-order line, unique on its own across the whole sample. This is not a guessed natural key.';
comment on column coldlion.prod_detail.prod_line_seq is
  'ColdLion prodLineSeq. With prod_order_no it is a second, independently proven identity for the same row, asserted as a unique constraint. If a pull ever produces two rows sharing it, the load must stop and the grain be re-proven rather than collapse two lines.';
comment on column coldlion.prod_detail.prepack_code is
  'Blank on 126 of 166 sampled rows - most production lines are not prepacks. When populated it is the /prepackDetail request key (PPK....), which is how coldlion.prepack_detail is enumerated.';
comment on column coldlion.prod_detail.item_desc is
  'Free-text item description as sent, and merch_group_05_desc is a LICENSOR/property label. Landing-layer evidence only: this schema has no application grants and no promotion may expose either without an owner ruling.';
comment on column coldlion.prod_detail.wip_qty is
  'Work-in-progress quantity as sent. Zero on most sampled rows; recorded, never derived.';
comment on column coldlion.prod_detail.division_code is
  'Recorded exactly as sent. CW001, EH001 and SP001 are all live in this feed; nothing here normalises casing.';

-- No secondary indexes. The declared write scope for issue #2863 is these two tables and
-- nothing else, both are empty until a loader exists, and every other ColdLion landing
-- table carries none either. Index them when a loader or consumer shows a real access
-- path, under its own claim.

-- -------------------------------------------------------------------------------------
-- No application role may read or mutate the landing layer (spine rule, unchanged).
-- Written statically, one statement per table, so every grant is readable in the diff
-- and verifiable in the catalog by name.
-- -------------------------------------------------------------------------------------
alter table coldlion.prepack_detail enable row level security;
revoke all on table coldlion.prepack_detail from public, anon, authenticated;
grant all on table coldlion.prepack_detail to service_role;

alter table coldlion.prod_detail enable row level security;
revoke all on table coldlion.prod_detail from public, anon, authenticated;
grant all on table coldlion.prod_detail to service_role;
