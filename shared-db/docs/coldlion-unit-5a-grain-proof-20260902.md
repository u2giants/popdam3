# ColdLion unit 5a — live grain proof for `/inventory` and `/prodtracking`

Measured 2026-09-02 against `http://x5.coldlion.com/EhpApi`. Issue #2175, tracker #2081,
plan `plan_coldlion_landing_schema_completion.md` §9 Step 6. Migration
`20260905104449_coldlion_landing_unit_5a_inventory_prod_tracking.sql`, test
`supabase/tests/coldlion_remainder_landing_contracts.sql`.

Field names, counts, shapes and distinct-key counts only. No row values, no customer or
vendor identifiers, no licensed data.

## 0. Why the spec is not used at all

`GET /EhpApi/v2/api-docs` types **both** of these feeds as a bare `{"type":"object"}`.
14 of its 16 GET feeds are untyped, and where it does type a feed it is **wrong**: both
history feeds are declared as raw arrays and live-return a Spring `Page` envelope. The
spec is stale documentation, not a contract.

**Everything below comes from live sampling, and a loader's unknown-field refusal must be
keyed to this sampled shape, never to `/api-docs`.** These counts are the 2026-09-02
measurement; re-derive them before the loader lands.

## 1. `/inventory` — 12 fields, paged envelope, whole-population grain proof

Request: `GET /inventory?companyCode=EDGEHOME&size=2000&page=0..4`.

- Envelope: Spring `Page` — `content, first, last, number, numberOfElements, size, sort,
  totalElements, totalPages`.
- `totalElements` 8,754 across 5 pages. **All 8,754 rows were fetched**, so the key
  measurements below are population-wide, not a sample.
- `size=2000` was honoured here (2,000 rows returned). The silent 200-row cap confirmed on
  `/orderHistory` did **not** apply to this feed on this date. A loader must still read
  `numberOfElements` rather than assume the requested size.

Union of field names across all 8,754 rows — exactly 12, **zero nulls in any field**:

`colorCode, dimCode, divisionCode, inventoryCost, inventoryQty, itemNo, itemPkey,
labelCode, prepackCode, sizeCode, warehouseCode, warehouseSku`

`itemPkey` and `inventoryQty` arrive as integers, `inventoryCost` as a float, the other
nine as strings.

### Grain

| candidate key | distinct | of 8,754 | verdict |
|---|---|---|---|
| `itemPkey` | 7,412 | 8,754 | **not unique** — one item is stocked in many warehouses |
| `itemPkey + warehouseCode` | 8,754 | 8,754 | **unique** |
| `itemPkey + warehouseCode + warehouseSku` | 8,754 | 8,754 | unique, but `warehouseSku` adds nothing |
| `divisionCode + itemNo + colorCode + sizeCode + dimCode + labelCode + prepackCode + warehouseCode` | 8,499 | 8,754 | **not unique** |

The last row is the important one: the descriptive attributes **describe** the row, they do
not identify it. `itemPkey` does.

The payload carries **no `companyCode`**, so `company_code` is stamped from the request and
leads the primary key — otherwise two companies could collide on one `itemPkey`.

**Chosen grain: `(company_code, item_pkey, warehouse_code)`.**

### Disposition — all 12 fields land

Three identity columns (`company_code` stamped, `item_pkey`, `warehouse_code`) and nine
descriptive columns. Nothing is dropped and nothing is invented.

### Live values a loader must tolerate

- Blanks, not nulls: `dimCode` blank on 1,891 rows, `prepackCode` on 1,593, `labelCode` on
  732, `warehouseCode` on 1 (of 8,754).
- `inventoryQty` is signed — 8 rows are negative. Recorded as sent, not clamped.
- `divisionCode` includes **`EP001`**, and both casings `CW001` and `cw001` are live.

## 2. `/prodtracking` — 51 fields, bare array, and the filters do nothing

Request: `GET /prodtracking` with and without parameters.

### The finding that changes the loader design: **the filter parameters are inert**

| probe | body size | SHA-256 |
|---|---|---|
| `?companyCode=EDGEHOME&fromDate=2026-06-01&toDate=2026-06-07` | 4,885,440 | `346c765ece71e11b…` |
| `?companyCode=SPRUCE&fromDate=2019-01-01&toDate=2019-01-07` | 4,885,440 | `346c765ece71e11b…` |
| no parameters at all | 4,885,440 | `346c765ece71e11b…` |

Three byte-identical bodies. `companyCode` is ignored (all three company codes come back
every time) and the date window is ignored (`prodOrderDate` spans 2019-05-03 to
2026-09-02 in every response).

Consequences:

- Every pull is a **complete replacement snapshot** of 3,922 rows. There is no incremental
  window, so `coldlion.window_ledger` has nothing to record for this feed.
- **No page envelope.** The response is a bare JSON array, unlike `/inventory`. Paging is
  not uniform across this API.
- A loader must not report "n rows for company X" from this feed — it never filtered.

### Field census

Union across all 3,922 rows: **51 fields**. The #2081 census of the same day reported 52;
re-derived at authoring time it is 51, and neither number is a contract.

`arrivalPortCode, cancelDate, companyCode, containerNo, createdTime, createdUser,
currencyCode, customerCode, customerDesc, customerPONo, depositBalance, depositPaid,
divisionCode, dueDate, femaExpDate, freightForwarderCode, ftySalesRep,
hangTagOrderedDate, hangTagReceived, hangTagReceivedDate, hangTagsOrdered, lcno, modTime,
modUser, nbcExpDate, orderDate, origDueDate, origShipCancelDate, origShipDate,
payTermCode, prodCostType, prodCountry, prodOrderDate, prodOrderNo, prodQty,
prodReferenceNo, prodRevDate, prodRevNo, prodTypeCode, salesOrderNo, seasonCode,
shipCancelDate, shipDate, shipPortCode, startDate, vendorCode, vendorConfirm,
vendorConfirmDate, vendorDesc, warehouseCode, wipQty`

`prodOrderNo`, `salesOrderNo`, `prodQty` and `wipQty` arrive as integers,
`depositPaid`/`depositBalance` as floats, and the sixteen `*Date`/`*date` fields as
`YYYY-MM-DD` strings; `createdTime`/`modTime` carry a time component.

### Grain

`prodOrderNo` alone gives **3,917 distinct over 3,922 rows** — five collisions. Every one of
those five is a **pair of rows with zero differing fields**: byte-identical duplicate
emissions, not two versions of one order. Adding `prodRevNo`, `salesOrderNo`,
`prodReferenceNo` or `divisionCode` does not separate them, which confirms they are the
same record emitted twice.

**Chosen grain: `(company_code, prod_order_no)`** — a *measured* natural key, not a guessed
one. Company leads it because the feed genuinely mixes `EDGEHOME`, `SPRUCE` and `UCI`.

**The one collapse this table performs, and its limit.** Upserting on that key collapses the
five identical pairs. That collapse is explained: the payloads are equal, so nothing is
lost. It does **not** license collapsing a differing payload. If a future pull ever yields
two rows sharing `(companyCode, prodOrderNo)` with different content, the grain is
disproven and the load must stop rather than overwrite. The contract test asserts this by
requiring a differing payload on that key to raise a visible unique violation.

### Disposition — all 51 fields land

Every sampled field has a column. Two are renamed for readability and both are recorded in
a column comment: `customerPONo` → `customer_po_no`, `lcno` → `lc_no`.

`customerDesc` is a customer **name**. It lands as landing-layer evidence only; the
`coldlion` schema has no application grants and no promotion may expose it without an owner
ruling.

### Live values a loader must tolerate

- **The `1900-01-01` empty-date marker dominates this feed**: `cancelDate`, `startDate` and
  `orderDate` carry it on 3,911 of 3,922 rows, and `shipDate` on 790. Typed date columns
  store NULL for it. A loader that stores it as a real date turns "no date" into "shipped in
  1900" on 99.7% of the table.
- Blank on **all** 3,922 rows: `lcno`, `freightForwarderCode`, `seasonCode`. Frequently
  blank: `prodCostType` (3,918), `customerPONo` (3,637), `arrivalPortCode` (3,088),
  `shipPortCode` (3,166), `hangTagReceived` (2,671), `currencyCode` (2,590),
  `payTermCode` (2,509), `containerNo` (2,506).
- Genuinely null (not blank) on some rows: `customerDesc` (245), `femaExpDate`,
  `nbcExpDate`, `ftySalesRep` and `vendorDesc` (53 each).
- `divisionCode` includes **`EP001`**, and both casings `CW001` and `cw001` are live.

## 3. Why no EP001 exclusion check

The phases 2–6 landing tables carry `check (division_code <> 'EP001')`. **Both** of these
feeds contain live `EP001` rows, so the same check here would fail the load rather than
filter it, and faithful landing would be impossible. EP001 handling stays a loader
contract. The contract test asserts that no such structural exclusion was copied in.

## 4. Not covered by this unit

`/pickticket`, `/receiving`, `/prepackDetail` and `/proddetails` remain unauthorable — see
the #2081 census and its correction. No row has ever been observed from the first two, and
the last two are only reachable through keys harvested from feeds not yet loaded. They are
unit 5b.

No image-content table exists or may be created; PopDAM remains the image source.
