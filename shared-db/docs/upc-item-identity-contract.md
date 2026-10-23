# UPC storage and exposure — the shared-database contract

**Migration:** `supabase/migrations/20260803150000_itemdetail_coldlion_item_identity_and_upc_contract.sql`
**Historical legacy apply:** preview on 2026-08-03. The legacy `dflow` migration is not the production contract; current preview identity comes from `PREVIEW_PROJECT_REF`.
**Audience:** the DesignFlow app session that owns `designflow-data-syncing`, `designflow-item-master`,
`designflow-bff` and `designflow-frontend`.

---

## Current production read contract (#4659)

The production source is `dflow_prod."itemDetail"`, projected through the new
`dflow_prod.item_detail_upc` security-invoker view. Its migration is
`20261022232130_dflow_prod_item_upc_read_contract.sql`; delivery remains pending
until its qualified preview/apply evidence and live production read are recorded
on #4659. Do not infer production delivery from this document or the legacy view.
The production view preserves all thirteen legacy output columns and the exact
item/company/division identity and nonempty-UPC predicate. It grants the existing
Item Master group only those thirteen underlying columns and view SELECT; no
business rows, writes, browser access or role memberships are added.

Fresh read-only production metadata on October22 confirms the deployed backend
identity currently inherits all four service grant groups, including Item Master,
as documented by the unresolved #4475 service-identity cutover. The actual deployed
Item Master production service revision `popcre-item-prod-00030-c95` identifies as
`designflow_prod_backend_runtime`; its legacy UPC query returned SQLSTATE42501 at
5:20 PM EDT on October22. A subsequent read-only catalog check confirms the new
production view remains absent and the Item Master group has no whole-table SELECT
on the production source. The intended isolated identity remains
`designflow_prod_item_master_runtime`. This change does not bless the temporary
backend membership drift: the #2873 membership/effective-access checks remain strict
and continue to expose #4475. Production release readiness independently requires
the actual configured runtime's read, in addition to the intended Item Master read.
When #4475 isolates the runtime, update the app's configured identity and release
contract together. A missing bridge never creates new membership or backend grants.

App schema selection: existing multi-schema environments retain `dflow`; the
single-schema production environment uses configured `dflow_prod`. Select only the
allowlisted schema before issuing the query. Always filter the full identity triple
and preserve ordered warehouse/item output. Do not route production reads to the
legacy `dflow.item_detail_upc` view. No supporting triple index is added: the source
has about21841 rows and a sequential-scan estimate, with no measured latency problem.
A later measured lookup regression belongs to a separately claimed index change;
the legacy index described below is not a production performance guarantee.

The remaining sections record the August legacy contract and historical data
measurements; their row counts and sync state are not current production evidence.

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

4. **BFF/UI:** read the environment-specific view (`dflow_prod.item_detail_upc` in production, legacy `dflow.item_detail_upc` in multi-schema environments) and join on the full triple. Surface
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
