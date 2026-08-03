-- UPC storage and exposure — the shared-database half.
--
-- PROBLEM
-- `dflow."itemDetail"` holds ColdLion UPC/EAN/GTIN data (21,841 rows, 10,774 with a
-- non-empty UPC on production 2026-08-03) but carries NO item-number column and no
-- foreign key to `dflow."itemHeader"`. Its only key is `item_pk` (ColdLion `itemPkey`).
-- Nothing in the `dflow` schema can join a UPC row to the item shown on screen, which
-- is why this data has never been visible to a user.
--
-- The identifying value is NOT lost at source: ColdLion's `GET /EhpApi/itemDetails`
-- returns `itemNo`, `companyCode` and `divisionCode` alongside `itemPkey`.
-- `remapItemDetail` in `designflow-data-syncing/helpers/utility.js` simply never mapped
-- them. This migration creates the columns that mapping needs to land in.
--
-- WHY THE IDENTITY IS A TRIPLE, NOT JUST THE ITEM NUMBER
-- `dflow."itemHeader".item_num_id` is NOT unique: 19,459 header rows carry only 17,898
-- distinct item numbers, and real item numbers repeat across divisions
-- (e.g. `0GP66DYMM01` appears twice, in two divisions). Joining a UPC row to an item by
-- item number alone can therefore bind it to the WRONG item. The join key is the full
-- ColdLion identity triple `(item_num_id, compan_code_fk, div_code_fk)`, which is unique
-- in `itemHeader` for every real item (only two junk groups collide: `'awda'` and
-- `'ddxdd'`, 14 rows total, all with empty company/division).
--
-- WHY THERE IS NO FOREIGN KEY AND NO BACKFILL
-- A real FK is impossible: the triple has no unique constraint in `itemHeader` because
-- of those junk rows, and `itemHeader` has no single-column natural key to point at.
-- A data backfill is deliberately NOT performed here. The only in-database candidate is
-- `whse_sku_id`, which `remapItemDetail` populates from ColdLion's `warehouseSKU` — a
-- warehouse SKU, not an item number. Measured on production 2026-08-03, of the 21,736
-- rows that have one, only 7,383 (34%) match exactly one `item_num_id`, 336 match more
-- than one (i.e. would bind to the wrong item), and 14,017 (64%) match none at all.
-- Prefix-splitting on '-' is worse, not better: `17K4CA4`, `17K4CA-CONT` and
-- `17K4CA-DAV` are sibling rows whose "base" cannot be recovered by any string rule.
-- Guessing the identity is exactly the failure mode this work exists to prevent, so
-- these columns are left NULL and the authoritative values are re-synced from ColdLion.
--
-- CORRECTION PATH (the insert-only sync)
-- `Customer.getItemDetailFromCL` writes with
-- `sql.itemDetail.bulkCreate(rows, { ignoreDuplicates: true })`, so an existing row is
-- NEVER updated and a UPC that changes in ColdLion never reaches us. That is app code
-- and is fixed in `designflow-data-syncing`, not here. No schema change is needed to
-- make the fix possible: `item_pk` is already the PRIMARY KEY of `dflow."itemDetail"`
-- (constraint `itemDetail_pkey`), so `ON CONFLICT (item_pk) DO UPDATE` — Sequelize
-- `updateOnDuplicate: [...]` — works today. This migration adds `coldlion_synced_at`
-- so that a re-sync is observable and staleness is provable rather than invisible:
-- every row currently in the table predates 2023-12-12 and the column will read NULL
-- until a corrected sync writes it.
--
-- Additive only. No existing column is changed, renamed or dropped. No rows are written.

alter table dflow."itemDetail"
  add column if not exists item_num_id       varchar(50),
  add column if not exists compan_code_fk    integer,
  add column if not exists div_code_fk       integer,
  add column if not exists coldlion_synced_at timestamptz;

comment on column dflow."itemDetail".item_num_id is
  'ColdLion itemNo. Populated by designflow-data-syncing remapItemDetail. NULL means the row predates that mapping and its item is unknown — never guess it from whse_sku_id.';
comment on column dflow."itemDetail".compan_code_fk is
  'ColdLion companyCode. Part of the (item_num_id, compan_code_fk, div_code_fk) identity triple used to join to dflow."itemHeader".';
comment on column dflow."itemDetail".div_code_fk is
  'ColdLion divisionCode. Part of the (item_num_id, compan_code_fk, div_code_fk) identity triple used to join to dflow."itemHeader".';
comment on column dflow."itemDetail".coldlion_synced_at is
  'When this row was last written from ColdLion. NULL = never re-synced since the mapping was added; the UPC on such a row is a pre-2024 snapshot and must not be presented as current.';

-- Query shape this serves: "give me every UPC row for the item on screen", i.e.
--   select ... from dflow.item_detail_upc
--    where item_num_id = $1 and compan_code_fk = $2 and div_code_fk = $3;
-- Partial, because every row is NULL until the corrected sync runs and unresolved rows
-- are never a query target.
create index if not exists idx_itemdetail_coldlion_identity
  on dflow."itemDetail" (item_num_id, compan_code_fk, div_code_fk)
  where item_num_id is not null;

-- Read contract for the item detail UPC tab. Exists so the join rule above is written
-- down once instead of being reinvented (and mis-derived) by each caller.
--
-- security_invoker is set for consistency with the anon-read lockdown convention in
-- AGENTS.md §10.2. It has no practical effect here: dflow."itemDetail" has RLS disabled,
-- the `dflow` schema is not exposed through PostgREST (AGENTS.md §8.1), and `dflow` is
-- granted to `postgres` only — DesignFlow reaches it over a direct Postgres connection.
create or replace view dflow.item_detail_upc
with (security_invoker = true) as
select
  d.item_pk,
  d.item_num_id,
  d.compan_code_fk,
  d.div_code_fk,
  d."UPC"   as upc,
  d."EAN"   as ean,
  d."GTIN"  as gtin,
  d.color_code_fk,
  d.size_code_fk,
  d.size_seq,
  d.whse_sku_id,
  d.item_active_status,
  d.coldlion_synced_at
from dflow."itemDetail" d
where d.item_num_id is not null
  and coalesce(d."UPC", '') <> '';

comment on view dflow.item_detail_upc is
  'One row per ColdLion itemDetail record that has a UPC AND a resolved item identity. Join to dflow."itemHeader" on (item_num_id, compan_code_fk, div_code_fk). Fails closed: returns zero rows until designflow-data-syncing maps itemNo/companyCode/divisionCode and re-syncs, which is deliberate — showing a 2023 UPC as current is worse than showing nothing.';
