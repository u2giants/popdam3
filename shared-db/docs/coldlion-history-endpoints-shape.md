# ColdLion `prodHistory` / `orderHistory` — data shape

**Purpose:** what these two endpoints actually return, verified against live calls, so the
historical load can be designed without re-probing. Companion to
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (auth, base URL, the other
16 endpoints, and the merch-group rules that apply here too).

**Verified:** 2026-08-14, live calls against `http://x5.coldlion.com/EhpApi`,
`companyCode=EDGEHOME`. Nothing below is copied from the spec without being seen in a real
response.

**Evidence base:** the full-field census sampled **seven one-month windows** spread across the
history — 2019-06, 2021-03, 2022-09, 2023-11, 2024-07, 2025-04, 2026-01 — giving
**5,874 `orderHistory` rows** and **3,411 `prodHistory` rows**. Prepack findings additionally
draw on 1,985 order-side and 1,774 production-side component rows in the same windows. Every
percentage in this document comes from that sample. It is a sample, not the whole history:
treat the *patterns* as established and the *exact percentages* as indicative.

---

## 1. What each endpoint is

| | `prodHistory` | `orderHistory` |
|---|---|---|
| Business meaning | Orders **we placed with factories** (buying) | Orders **customers placed with us** (selling) |
| Grain | one row per production-order line **× prepack component** | one row per sales-order line **× prepack component** |
| Fields | 132 | 59 |
| Key | `prodOrderNo` (+ `prodReferenceNo`) | `salesOrderNo` (+ `poNumber`) |
| Links to the other | `salesOrderNo` | `salesOrderNo` |

Both carry `itemNo`, `itemDesc`, `divisionCode`, merch-group codes and their descriptions, so
they tie to the item and taxonomy data already in `core.*`.

## 2. Request contract

Both are `GET`, both need `X-API-Key` (see the reference doc for the 1Password location — never
paste the value). Missing key returns **HTTP 400**, not 401.

```
GET /EhpApi/prodHistory?companyCode=EDGEHOME&fromDate=2026-01-01&toDate=2026-01-10
GET /EhpApi/orderHistory?companyCode=EDGEHOME&fromDate=2026-01-01&toDate=2026-01-10
```

Parameters, from the live spec (`/EhpApi/v2/api-docs`, API v1.5.1) and confirmed by call:

| Endpoint | Required | Optional |
|---|---|---|
| `prodHistory` | `companyCode`, `fromDate`, `toDate` | `stageCode` |
| `orderHistory` | `companyCode`, `fromDate`, `toDate` | `divisionCode`, `salesOrderNo` |

> ### ⚠️ There is no paging on these two endpoints
> Unlike `/items` and the other paged endpoints, these return a **plain JSON array**, not the
> `content` / `last` / `totalElements` envelope. `page` and `size` are **silently ignored** —
> sending `size=5` still returned 265 rows. The response schema in the spec confirms it:
> `{"type":"array","items":{"$ref":"#/definitions/ProdHistory"}}`.
>
> **Consequence:** chunking must be done by **date window**, and a window is all-or-nothing.
> Do not write a paging loop; it will silently re-fetch the same rows forever.

**Division scope is wider than it first looks.** `companyCode=EDGEHOME` returns **four**
divisions — `CW001`, `EH001`, `EP001`, `SP001` — on both endpoints. A short window can show
only `EH001` and give the false impression that the feed is single-division. `orderHistory`
can be narrowed with `divisionCode`; **`prodHistory` cannot** (no such parameter).

## 3. Volume and timing

| Window | `prodHistory` | `orderHistory` |
|---|---|---|
| 10 days (2026-01-01..10) | 265 rows, 0.8 MB | 149 rows, 0.2 MB |
| 1 month (2026-01) | 347 rows, 1.1 MB | 477 rows, 0.6 MB |
| 1 month (2020-01) | 536 rows, 1.6 MB | 1,061 rows, 1.3 MB |
| Busiest month sampled | 1,260 rows (2021-03) | 1,435 rows (2024-07) |

Roughly **0.5–1.5 MB per endpoint per month**, so a full multi-year history is plausibly low
hundreds of MB, not gigabytes.

**Response times are unpredictable and that is the real constraint.** Most calls returned in
1–4 seconds. Two outliers: `orderHistory` 2020-01 took **18 seconds** and 2019-06 took
**51 seconds** — the same endpoint and window size that elsewhere returns in under two.
There is no way to predict which window will be slow.

Practical consequences for the bulk load:
- Use **one request at a time**, never parallel. A slow window plus a parallel fan-out is how
  we would disrupt their users.
- Allow a **per-request timeout of at least 120 seconds** before treating a window as failed.
- Pause between requests (3 seconds was used for all probing here without complaint).
- Note that the MCP-driven `op_run` path has its **own timeout** that a long run will hit.
  Bulk pulls must run as background tasks writing each chunk to disk, so a stall loses one
  window rather than the whole run.

## 4. Assortments / prepacks — how a master item carries its component styles

This is the single most important structural feature of both payloads, and the two endpoints
express it differently.

### 4.1 Sales side (`orderHistory`) — clean and self-checking

The line holds the **master** item; the assortment is named in `prePackCode`; `prepackQty` is
how many pieces are in one pack. The endpoint then returns **one row per component style**,
each carrying a `sub*` block (`subItemNo`, `subColorCode`, `subSizeCode`,
`subMerchGroup01`–`06`), with `quantity` = how many of that style are in one pack.

Real example (sales order 7127367):

```
master AAH6601  prePackCode=PPK2536  prepackQty=6  lineQty=1680  linePrice=2.07
  AAP66ABMVT01  x1   Abstract / Motivational
  AAQ66FPFRA01  x1   Floral / Framed
  AAQ66WMPPC01  x1   Wall Metal
  AA166WMFSH01  x1   Wall Metal / Fish
  AAH66ABSKY01  x1   Abstract / Sky
  AAH66PHSAN01  x1   Photo / Sand
```

**The recipe is trustworthy.** Across **413 packs** in the sample, the component `quantity`
values summed to the stated `prepackQty` in **413 cases and failed in 0**. This is a usable
integrity check on load: if a pack does not sum, something is wrong with our extraction, not
with their data.

Component merch groups **differ from the master's** — that is the whole point of an
assortment. The master is generic ("16x16 canvas"); the styles inside are specific. Do not
inherit the master's taxonomy onto the components.

Non-assortment lines are unambiguous: `prePackCode` is `""` **and** `subItemNo` is `""`.
About **34%** of sales rows are assortment components.

### 4.2 Production side (`prodHistory`) — same idea, different field names

Component block is `prepackItemNo` / `prepackQty` / `ppkDetailQty` / `ppkDetailQty2` /
`ppkDetailCost`, with `totalPpkQty` on the master and `ppkMerchGroup01`–`14` for taxonomy.
Example: production order 23825, master AAW2A02, 800 packs × 4 pieces = `totalPpkQty` 3,200,
pack cost 1.71 split evenly at 0.4275 per piece. About **52%** of production rows are
assortment components.

### 4.3 ⚠️ The repeated-row trap — read before writing any loader

`prodHistory` returns the same `(prodOrderNo, itemNo, prepackItemNo)` combination more than
once, and **there are two different causes that look identical in shape**.

**Cause A — genuine duplicate fan-out.** The rows are the same purchase, differing only in the
`last*` lookup fields. Production order 23825 / AAW2A02 returned 8 rows for 4 components; each
pair differed **only** in `lastProdDate` (2026-01-04 vs 2026-01-08). Loading both double-counts.

**Cause B — two real buy lines on one order.** Production order 20907 / VSZ4803 / PPK1020 also
returned 8 rows for 4 components, but one set is **1,600 packs** and the other **3,000 packs**
(`prodOrderQty`, `totalPpkQty` 6400 vs 12000, `extCost` 3840 vs 7200). Both are real and both
must be counted. Collapsing them erases a 3,000-pack purchase.

Measured across the sample: **261 repeated groups — 131 cause A, 130 cause B.** Almost an even
split, so neither "always collapse" nor "never collapse" is acceptable.

> **There is no line-number field to separate them.** Confirmed against the spec: `ProdHistory`
> has no line/sequence property. The only discriminator available is whether the quantities
> differ.

**Rule to implement, and its known hole:**

1. Group by `(prodOrderNo, itemNo, prePackCode, prepackItemNo, salesOrderNo, prodReferenceNo,
   colorCode, sizeCode)`.
2. Within a group, if copies differ **only** in `last*` fields
   (`lastProdRefNo`, `lastDueDate`, `lastProdDate`, `lastWarehouseCode`, `lastVendorCode`,
   `lastVendorDesc`, `lastProdCost`) → collapse to one row.
3. If copies differ in quantity or cost → keep them all; they are separate lines.
4. **If copies are identical in every field including quantity → we cannot tell.** Log it
   loudly for human review rather than silently picking one. Per rule 11 (no silent failures),
   this must alert, not shrug.

Case 4 has not been observed yet, but nothing in the data prevents it. The permanent fix is a
line number from ColdLion — asked for in
[`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md).

## 5. Field-level findings that change the data model

### 5.1 Fields that are always empty — do not create columns for them

**`orderHistory` (4 of 59):** `invoiceNoString`, `invoiceDateString`, `subDimCode`, `itemImage`.

**`prodHistory` (31 of 132):** `seasonCode`, `freightForwarderCode`, `udf02`, `udf03`, `udf04`,
`udfDate01`, `udfDate02`, `merchGroup11`–`14`, `merchGroup09Desc`–`14Desc`, `prepackDimCode`,
`ppkMerchGroup11`–`14`, `ppkMerchGroup07Desc`–`14Desc`, `itemImage`.

`subUpc` on `orderHistory` deserves its own line: **0 populated out of 1,985** component rows
across seven years. It is a dead field, not sparse data.

Every field the spec declares was returned, and no undeclared field appeared — the spec and the
payload agree exactly on both endpoints.

### 5.2 ⚠️ Two quantity fields are always zero

On `orderHistory`, **`lineInvoiceQty` and `lineOpenQty` were 0 in all 5,874 rows.** Despite the
names, they carry no signal in this feed. The quantity fields that *do* carry signal:

- `lineQty` — always populated, 1 to 20,016. This is the real order quantity.
- `lineCancelledQty` — non-zero on 1,405 of 5,874 rows.
- `linePickQty` / `unshippedQty` / `subQty` — non-zero on only 8 rows.

Any report built on "open" or "invoiced" quantity from this endpoint would silently read zero
for everything. Added as a question to ColdLion.

Same pattern on `prodHistory`: **`depositPerc` is 0 in all 3,411 rows** and `totalProdCost` is
0 in 3,218 of them, while `extCost` is populated and meaningful.

### 5.3 `1900-01-01` is the empty-date marker — CONFIRMED

> **Owner confirmation (Albert Hazan, 2026-08-14):** `1900-01-01` is the empty-date marker.
> This is settled, not an open question. Do not re-raise it with ColdLion.

Observed across both endpoints, consistent with that confirmation. Rates in the sample: `udfDate01`/`udfDate02` 100% sentinel;
`shipCancelDate` 99%; `origShipCancelDate` 95%; `shipDate` 25%; `origShipDate` 21%;
`receiveDate` 10%. Store these as NULL, never as a real 1900 date, or every date-range report
will be wrong.

### 5.4 Nulls appear only on the production side

`prodHistory` returns actual JSON `null` (not `""`) for `custPONumber`, `custStartDate` and
`custCancelDate` on **1,518 of 3,411** rows, and `lastVendorDesc` on 167. `orderHistory`
returned **no nulls at all** — it uses `""`. A loader must handle both empty conventions.

### 5.5 `salesOrderNo = 0` means "not tied to a sales order"

On `prodHistory`, `salesOrderNo` is 0 on **1,510 of 3,411** rows — closely tracking the 1,518
rows with null customer fields, which is consistent with stock production not raised against a
specific customer order. Reading 0 as a foreign key would create 1,500 broken links per sample.
Treat 0 as "no link". Being confirmed with ColdLion.

### 5.6 Negative quantities and costs are real

`linePickQty`, `unshippedQty` and `subQty` reach **-564**; `prodCost`, `extCost` and
`lastProdCost` reach **-85**. Returns or credits. Do not add non-negative constraints.

### 5.7 Production-side prepack taxonomy is unreliable; use the sales side

`ppkMerchGroup01`–`06` were **completely blank on 140 of 1,774** production component rows and
partially blank on another 243 — including styles whose groups are fully populated on the order
side. Order-side `subMerchGroup01`–`06` was never completely blank (219 of 1,985 partially).

**Therefore:** treat `orderHistory` as the better source for what a component style *is*, and
do not treat the two sides as equal authorities on taxonomy. This is consistent with the
standing merch-group rules — see
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md), and remember
that `mgTypeCode` meaning varies by division, which matters more here now that we know the feed
spans four divisions.

## 6. Open questions with ColdLion

Drafted in [`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md),
not yet sent.

1. **Production-order line number** — the only true blocker (§4.3).
2. `subUpc` never populated — dead field or missing request? (§5.1)
3. `ppkMerchGroup*` blank rate on production — known gap? (§5.7)
4. `lineInvoiceQty` / `lineOpenQty` always zero — not exposed here? (§5.2)
5. Max date range / row count per request, and a preferred window and rate for a bulk pull (§3).
6. Confirm `salesOrderNo=0` means "no linked sales order" (§5.5).

**Already settled, not to be asked:** `1900-01-01` as the empty-date marker — confirmed by the
owner 2026-08-14 (§5.3).

## 7. What has NOT been checked

Stated plainly so the next session does not assume more coverage than exists.

- **How far back the history goes.** Earliest window probed is 2019-06 and it returned data;
  no earlier boundary was searched.
- **`stageCode` on `prodHistory`** — never exercised. Values and meaning unknown.
- **`divisionCode` / `salesOrderNo` filters on `orderHistory`** — never exercised.
- **Whether the endpoints are stable over time.** Every window was fetched once; nothing was
  re-fetched to see whether the same window returns the same rows on a later call. That matters
  for incremental re-pulls and should be tested before designing the recurring sync.
- **The five months between sampled windows.** Patterns held in all seven windows across seven
  years, but the sample is 10 months of roughly 80.
- **Anything about loading this into Supabase.** No schema, no migration, no target tables.
  Per the shared-DB rules, any structure for this is authored in `u2giants/shared-db` first.
