# UPC storage and exposure — the shared-database contract

**Migration:** `supabase/migrations/20260803150000_itemdetail_coldlion_item_identity_and_upc_contract.sql`
**Applied to:** preview `rjyboqwcdzcocqgmsyel` on 2026-08-03. **NOT promoted to production** (owner gate).
**Audience:** the DesignFlow app session that owns `designflow-data-syncing`, `designflow-item-master`,
`designflow-bff` and `designflow-frontend`.

---

## 1. What the app session gets

Four new **nullable** columns on `dflow."itemDetail"`, one partial index, one view. Nothing else
changed; no row was written.

| Object | Type | Meaning |
|---|---|---|
| `dflow."itemDetail".item_num_id` | `varchar(50)` | ColdLion `itemNo` |
| `dflow."itemDetail".compan_code_fk` | `integer` | ColdLion `companyCode` |
| `dflow."itemDetail".div_code_fk` | `integer` | ColdLion `divisionCode` |
| `dflow."itemDetail".coldlion_synced_at` | `timestamptz` | when this row was last written from ColdLion |
| `dflow.idx_itemdetail_coldlion_identity` | partial btree | `(item_num_id, compan_code_fk, div_code_fk) where item_num_id is not null` |
| `dflow.item_detail_upc` | view | the read contract for the item-detail UPC tab |

### How a caller joins a UPC row to an item

**The join key is the ColdLion identity triple, NOT the item number.**

```sql
select v.upc, v.ean, v.gtin, v.whse_sku_id, v.item_active_status, v.coldlion_synced_at
  from dflow.item_detail_upc v
 where v.item_num_id   = $1   -- itemHeader.item_num_id
   and v.compan_code_fk = $2  -- itemHeader.compan_code_fk
   and v.div_code_fk    = $3; -- itemHeader.div_code_fk
```

`EXPLAIN` on preview confirms this uses `Index Scan using idx_itemdetail_coldlion_identity`.

**Joining on `item_num_id` alone binds UPCs to the wrong item.** `dflow."itemHeader"` has 19,459 rows
but only 17,898 distinct `item_num_id`; real item numbers repeat across divisions (`0GP66DYMM01`
appears twice, in two divisions). This is the single most likely way to get this wrong.

There is **no foreign key**, and none is possible: the triple cannot carry a unique index because two
junk header groups (`'awda'`, `'ddxdd'`, 14 rows with empty company/division) collide on it. The app
must ignore header rows with empty company/division.

---

## 2. Existing rows are NOT backfilled — and why

All 21,841 rows have `item_num_id = NULL`. **0 rows resolve today**, by design. The view therefore
returns 0 rows until the app re-syncs. It fails closed on purpose.

The only in-database candidate for deriving the identity is `whse_sku_id`, which `remapItemDetail`
populates from ColdLion's `warehouseSKU` — **a warehouse SKU, not an item number**. Measured on
production 2026-08-03, of the 21,736 rows that have one:

| Outcome of matching `whse_sku_id` against `itemHeader.item_num_id` | Rows |
|---|---|
| matches exactly one item | 7,383 (34%) |
| matches **more than one** item — would bind to the WRONG item | 336 |
| matches no item at all | 14,017 (64%) |

Prefix-splitting on `-` is worse, not better: `17K4CA4`, `17K4CA-CONT` and `17K4CA-DAV` are sibling
rows whose "base" no string rule recovers. A backfill here would be a guess, written durably, into a
column the UI presents as fact. **The identity is re-synced from ColdLion, which returns it.**

---

## 3. What the app session must do

1. **`designflow-data-syncing/helpers/utility.js` → `remapItemDetail`:** map the three fields the
   ColdLion `GET /EhpApi/itemDetails` response already returns and the function currently discards —
   `item_num_id: itemDetail.itemNo`, `compan_code_fk: itemDetail.companyCode`,
   `div_code_fk: itemDetail.divisionCode` — plus `coldlion_synced_at: new Date()`.
   (Note: `companyCode`/`divisionCode` arrive as ColdLion codes; `remapItemHeader` in the same file
   already maps them to the integer `compan_code_fk`/`div_code_fk` via `COMPANY_ID_TO_NAME` /
   `DIVISION_ID_TO_CODE`. Reuse that mapping — do not invent a second one.)

2. **`designflow-data-syncing/models/lib.model.js` → `Customer.getItemDetailFromCL`:** replace
   `bulkCreate(rows, { ignoreDuplicates: true })` with an upsert. **No schema change is needed for
   this** — `item_pk` is already the PRIMARY KEY (`itemDetail_pkey`) and is declared
   `primaryKey: true` in `models/db/itemDetail.js`, so Sequelize
   `updateOnDuplicate: ['UPC','EAN','GTIN','item_num_id','compan_code_fk','div_code_fk','coldlion_synced_at', …]`
   works today. **Include `"UPC"` in that list** — an upsert that refreshes identity but not the
   barcode leaves the original defect in place.

3. **Put the route on a schedule.** `GET /getItemDetailFromCL/` appears to be manually triggered.
   Without a schedule, a corrected UPC still only arrives when someone remembers to press the button.

4. **BFF/UI:** read `dflow.item_detail_upc` and join on the full triple. Surface
   `coldlion_synced_at` — a row whose value is NULL or old is a stale snapshot, not current truth.

---

## 4. Two things the owner needs to know before this ships

### 4.1 The "one row per colour/size SKU" outcome is NOT achievable from this table

`color_code_fk` and `size_code_fk` are populated but **constant**: **all 21,841 rows are `'NC'`/`'NS'`**
(no colour / no size). There is no colour/size dimension in this data. What the table actually holds
is roughly one row per item per **warehouse/company variant** — the `-CONT`, `-DAV`, `-BC`, `-AM`…
suffixes on `whse_sku_id`. And 5,022 of 5,035 `whse_sku_id` bases carry exactly **one** distinct UPC.

So the tab can honestly show *the item's barcode rows*, but it cannot show a colour/size matrix,
because ColdLion is not sending one into this table.

### 4.2 The mirror is a 2023 snapshot

The newest row in `dflow."itemDetail"` was created **2023-12-12**; zero rows in the last year. Combined
with the insert-only sync, everything in this table is a pre-2024 snapshot. This is exactly the
"looks right, is wrong" failure the owner warned about, which is why the view fails closed rather
than showing what is already there.

**Open question for the app session to answer, not to assume:** the sync does a full unfiltered pull,
so either it has not been run since 2023-12-12, or ColdLion has emitted no new `itemDetail` rows since
then. Which one it is decides whether a re-sync recovers the 10,774 historical UPC rows or leaves them
permanently dark. Verify against ColdLion before promising coverage.

---

## 5. Blast radius

**None for CRM, DAM or PM/PIM.** The change is additive; the `dflow` schema is not exposed through
PostgREST (AGENTS.md §8.1) and is granted to `postgres` only; RLS is off on the table and unchanged.
No other application reads `dflow."itemDetail"`. Startup DDL is not a risk either: DesignFlow no
longer runs `sequelize.sync()` at boot (removed by `20260717163500_reconcile_dflow_backend_startup_contract.sql`),
so nothing can strip these columns.

---

## 6. Verified behaviour on preview (not ledger rows)

| Assertion | Result |
|---|---|
| `to_regclass` for table, view, index | all three non-null |
| all four columns present, nullable | yes |
| no backfill happened | 21,841 rows, **0** non-null in every new column |
| view fails closed | **0** rows |
| a resolved row becomes visible and binds to exactly one item | 1 row returned, `headers_matched = 1` |
| intended query shape uses the index | `Index Scan using idx_itemdetail_coldlion_identity` |
| verification left preview clean | rolled back; view back to 0 rows |

Times: the migration was applied 2026-08-03 ~15:00 America/New_York. The database runs
`America/New_York`, so a midnight-UTC timestamp reads back through `::date` as the previous day.
