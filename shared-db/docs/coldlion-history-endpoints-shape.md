# ColdLion `prodHistory` / `orderHistory` — data shape

**Purpose:** what these two endpoints actually return, verified against live calls, so the
historical load can be designed without re-probing. Companion to
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (auth, base URL, the other
16 endpoints, and the merch-group rules that apply here too).

**Verified:** 2026-08-14, re-verified after ColdLion's changes on **2026-08-17**, live calls
against `http://x5.coldlion.com/EhpApi`, `companyCode=EDGEHOME`. Nothing below is copied from the
spec without being seen in a real response.

> ## ✅ 2026-08-17 — ColdLion changed BOTH endpoints. Two things you may have read here before are now wrong.
>
> Albert relayed these from ColdLion and both are **verified live**:
>
> 1. **`prodLineSeq` has been added to `prodHistory`** (133 fields now, was 132) and the
>    duplicate-row problem is resolved upstream: ColdLion now selects the maximum `lastProdDate`.
>    **The ambiguity that used to block the loader is GONE** — see §4.3, rewritten.
> 2. **`fromDate`/`toDate` must now be within 7 days (inclusive).** Anything wider is refused.
>    Month-window calls that worked on 2026-08-14 now fail — **including the ones used to gather
>    the census below**. See §2 and §3.
>
> Any document, plan, or code that says "no line number exists" or fetches a month at a time is
> stale as of 2026-08-17. This is the only place that carries the corrected version.

**Evidence base:** the full-field census sampled **seven one-month windows** spread across the
history — 2019-06, 2021-03, 2022-09, 2023-11, 2024-07, 2025-04, 2026-01 — giving
**5,874 `orderHistory` rows** and **3,411 `prodHistory` rows**. Prepack findings additionally
draw on 1,985 order-side and 1,774 production-side component rows in the same windows. Every
percentage in this document comes from that sample. It is a sample, not the whole history:
treat the *patterns* as established and the *exact percentages* as indicative.

> **The census can no longer be reproduced as run.** It used one-month windows, which the
> 7-day cap introduced on 2026-08-17 now refuses. The findings stand — they were observed in real
> responses — but re-running them means stitching ~4–5 seven-day windows per month. The field
> census was **re-verified against the spec on 2026-08-17**: `prodHistory` now has 133 properties
> (`prodLineSeq` added), `orderHistory` still 59, and spec and payload still agree exactly with no
> undeclared or missing fields on either.

**Post-change verification (2026-08-17):** nine 7-day windows spanning 2019-06 to 2026-01,
**1,475 `prodHistory` rows**, used to confirm `prodLineSeq` is always populated and to re-test
row uniqueness (§4.3).

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
| `prodHistory` | `companyCode`, `fromDate`, `toDate` | `prodOrderNo`, `stageCode` |
| `orderHistory` | `companyCode`, `fromDate`, `toDate` | `divisionCode`, `salesOrderNo` |

(`prodOrderNo` on `prodHistory` appeared with the 2026-08-17 changes; it was not in the spec on
2026-08-14. Useful for spot-checking one order without scanning a window.)

> ### ⚠️ Hard 7-day window cap (since 2026-08-17)
> `fromDate` and `toDate` **must be within 7 days, inclusive**, on **both** endpoints. This is
> ColdLion's own limit, set deliberately at our request so a bulk pull cannot overload them.
> A wider window is refused outright — no partial data, no truncation.
>
> Verified: `2026-01-01..2026-01-07` → **HTTP 200**. `2026-01-01..2026-01-08` → **refused**.
> A full month → **refused**. A single day (`from == to`) → **HTTP 200**, so equal dates are fine.
>
> **The error contract is malformed — handle it deliberately.** The refusal arrives as
> **HTTP 400 on the wire**, but the JSON body says `"status": 500` and
> `"error": "Internal Server Error"`, with the real explanation only in `message`:
>
> ```json
> {"timestamp":"2026-08-17","message":"fromDate and toDate must be within 7 days (inclusive)",
>  "error":"Internal Server Error","status":500,"path":"uri=/EhpApi/prodHistory"}
> ```
>
> A loader that trusts the body's `500` will classify a permanent, self-inflicted input error as a
> transient server fault and **retry it forever**. Branch on the wire status and on the `message`
> text, never on the body's `status`.

> ### ⚠️⚠️ The default `prodHistory` response is INCOMPLETE — fetch every `stageCode`
> **Without `stageCode`, `prodHistory` returns only the `ISS` (issued) lines.** Verified 2026-08-18:
> for 2026-08-03..09 the default returned 67 rows, identical to `stageCode=ISS`, while
> `stageCode=REC` returned **21 rows with ZERO key overlap** — rows that appear nowhere in the
> default. For 2024-07-01..07: default 144, `REC` a further 159.
>
> `REC` lines are the **receipts** (what actually arrived), carried as separate lines of the same
> production orders. Order 22717: line 1 `ISS` ordered 4,800; line 2 `REC` received 4,548. Omitting
> `REC` loses every short shipment and every receipt date in the dataset.
>
> **Fetch `ISS`, `REC` and `INTRAN` explicitly and record which stage each row came from** — the
> payload does not say. `INTRAN` returned 0 rows in the windows tested but is named by ColdLion.
> `OPEN`, `CLOSED`, `SHIP`, `CAN`, `PEND`, `NEW`, `COMP`, `WIP`, `APPR` all returned nothing. **The
> authoritative list of stage codes has not been confirmed — ask ColdLion before the full load.**
> Business meaning: [`business-rules-erp-data.md`](business-rules-erp-data.md) §4.

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

**Current shape of the work, post-cap.** ColdLion's stated expectation: *"about 2 seconds to load
7 days of data from our office."* Measured from al8960ofc across nine 7-day `prodHistory` windows
spanning 2019–2026: **18 to 662 rows per window**, typically **0.1–1.4 seconds**, with one outlier
at **6.4 seconds**. That matches their figure; our earlier 18s and 51s outliers were month-window
calls that are no longer permitted, so the very slow responses may well have been the width of the
request rather than the server.

Sizing the full pull: 7 years of history at ~52 windows per year is roughly **370 windows per
endpoint, ~740 requests total**. At a few seconds each plus a courtesy pause, that is a couple of
hours of wall-clock — comfortably a weekend job, and far smaller than feared.

Historic per-month figures, gathered before the cap and kept for volume estimation only (these
window widths are now refused):

| Window | `prodHistory` | `orderHistory` |
|---|---|---|
| 1 month (2026-01) | 347 rows, 1.1 MB | 477 rows, 0.6 MB |
| 1 month (2020-01) | 536 rows, 1.6 MB | 1,061 rows, 1.3 MB |
| Busiest month sampled | 1,260 rows (2021-03) | 1,435 rows (2024-07) |

Roughly **0.5–1.5 MB per endpoint per month**, so a full multi-year history is plausibly low
hundreds of MB, not gigabytes.

Practical consequences for the bulk load:
- **Iterate in 7-day windows.** Anything wider is refused (§2). Do not "optimize" by widening.
- Use **one request at a time**, never parallel. The 7-day cap exists so we do not overload them;
  firing 20 capped windows at once defeats its purpose and breaks the spirit of the agreement.
- Keep a **generous per-request timeout** (≥60s) even though windows are now fast — one 6.4s
  outlier was seen at this width, and a timeout that is too tight turns a slow window into a
  spurious failure.
- Pause between requests (2–3 seconds was used throughout probing without complaint).
- Note that the MCP-driven `op_run` path has its **own timeout** that a long run will hit.
  Bulk pulls must run as background tasks writing each chunk to disk, so a stall loses one
  window rather than the whole run.
- **Windows must not overlap**, or rows land twice: the cap makes a 7-day stride the natural
  increment, so advance `fromDate` by exactly 7 days and set `toDate = fromDate + 6`.

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

### 4.3 The repeated-row trap — ✅ RESOLVED UPSTREAM 2026-08-17, rule is now simple

> **What changed.** ColdLion added **`prodLineSeq`** and now selects the maximum `lastProdDate`.
> Albert's relay: *"Coldlion has adjusted the logic and added prodLineSeq. The duplicated prod
> reference number caused the problem; we just select the maximum lastProdDate now."*
>
> **Verified live 2026-08-17.** `prodLineSeq` is present on every row (1,475 rows across nine
> 7-day windows, **zero** null or missing), integer, 1..31 within a window. The old
> cause-A example — order **23825** / AAW2A02, which returned **8 rows for 4 components** on
> 2026-08-14 — now returns **exactly 4**, all `prodLineSeq = 3`, all `lastProdDate = 2026-01-08`
> (the maximum of the two that used to fan out). The duplication is gone at the source.

**The rule to implement now:**

- **Row identity is `(prodOrderNo, prodLineSeq, prepackItemNo)`** — plus `itemNo` for non-prepack
  lines, where `prepackItemNo` is empty.
- **Distinct `prodLineSeq` = distinct real buy lines. Never merge them.** This is what used to be
  indistinguishable; it no longer is.
- **Any remaining duplicate differs only in `last*` fields and is safe to collapse.** Verified: in
  the two 2021-03 windows, **98 duplicate keys, 98 of which differ ONLY in `last*` fields, and 0
  in anything else.** Adding every other field to the key removed **no** duplicates, which proves
  the remaining fan-out is entirely `last*`.

**Residual quirk worth knowing:** the surviving fan-out is now on **`lastProdCost`**, not
`lastProdDate` — two historical production records share the same maximum date but carry different
costs (e.g. order 20872, line 1, component CTZHS0MSC01: `lastProdCost` 3.09 vs 3.64). Only legacy
data showed it: **0 duplicates in any window from 2019-06, 2020-01, 2022-09, 2023-11, 2024-07,
2025-04 or 2026-01** — all 98 came from March 2021.

**Therefore: the `last*` block is a "most recent production" lookup, not part of the purchase.**
Either drop those seven fields on load, or pick one copy deterministically. Do **not** aggregate or
sum across the copies, and do not let `lastProdCost` reach a cost report — it is not this order's
cost (`prodCost` / `extCost` / `ppkDetailCost` are).

**The blocking ambiguity is closed.** The old worry — two real lines with identical quantities
being indistinguishable from a duplicate — cannot happen now, because `prodLineSeq` separates real
lines regardless of their quantities. The alert-on-ambiguity safeguard is still worth keeping as a
cheap tripwire (if a `(prodOrderNo, prodLineSeq, prepackItemNo)` group ever differs in a
non-`last*` field, something changed upstream and we want to hear about it), but it is no longer
load-blocking.

---

**Historical record — why this section exists, and what it cost.** Keep this: a future session
that loses the *why* could cheerfully "simplify" the dedupe and re-introduce the bug.

Before 2026-08-17, `prodHistory` returned the same `(prodOrderNo, itemNo, prepackItemNo)` more than
once with **two causes that were indistinguishable in shape**.

**Cause A — genuine duplicate fan-out.** The rows are the same purchase, differing only in the
`last*` lookup fields. Production order 23825 / AAW2A02 returned 8 rows for 4 components; each
pair differed **only** in `lastProdDate` (2026-01-04 vs 2026-01-08). Loading both double-counts.

**Cause B — two real buy lines on one order.** Production order 20907 / VSZ4803 / PPK1020 also
returned 8 rows for 4 components, but one set is **1,600 packs** and the other **3,000 packs**
(`prodOrderQty`, `totalPpkQty` 6400 vs 12000, `extCost` 3840 vs 7200). Both are real and both
must be counted. Collapsing them erases a 3,000-pack purchase.

Measured across the sample: **261 repeated groups — 131 cause A, 130 cause B.** Almost an even
split, so neither "always collapse" nor "never collapse" is acceptable.

At the time, `ProdHistory` had **no line/sequence property** — confirmed against the spec, not
assumed — so the only discriminator was whether the quantities differed. That left a hole: two real
lines with *identical* quantities would have been indistinguishable from a duplicate, and we would
have silently undercounted a purchase. Measured then: **261 repeated groups — 131 cause A, 130
cause B**, an almost even split, so no blanket rule was safe.

**Asking the vendor was the right move and it worked.** Rather than building a heuristic around the
hole, we asked ColdLion for a line number (question 1 of the draft note). They added `prodLineSeq`
and fixed the fan-out at the source within days. **The heuristic was never built** — do not go
looking for it in the code, and do not resurrect the quantity-comparison logic; `prodLineSeq` makes
it obsolete and strictly worse.

## 5. Field-level findings that change the data model

### 5.1 Fields that are always empty — do not create columns for them

**`orderHistory` (4 of 59):** `invoiceNoString`, `invoiceDateString`, `subDimCode`, `itemImage`.

**`prodHistory` (31 of 132 as sampled; the field count is now 133 with `prodLineSeq`, which is
always populated):** `seasonCode`, `freightForwarderCode`, `udf02`, `udf03`, `udf04`,
`udfDate01`, `udfDate02`, `merchGroup11`–`14`, `merchGroup09Desc`–`14Desc`, `prepackDimCode`,
`ppkMerchGroup11`–`14`, `ppkMerchGroup07Desc`–`14Desc`, `itemImage`.

> ### ⚠️ `subUpc` is RARE, not dead — keep the column (ANSWERED 2026-08-17)
> Measured: **0 populated out of 1,985** component rows across seven years, which an earlier
> version of this doc called "a dead field, not sparse data" and told loaders to drop.
> **That was wrong.** ColdLion's answer, relayed by Albert:
>
> > "you don't often assign UPCs to prepack components. I can remember one instance of an
> > assortment we shipped for Walmart where we did but that's it"
>
> So the field is genuinely **sparse by business practice**, not broken and not unused. A real
> value can appear, and when it does it is meaningful — a customer (Walmart) required
> component-level barcodes on an assortment.
>
> **Keep `subUpc` on load.** Dropping it would silently discard the rare case, and the rare case is
> exactly the interesting one. Do not build anything that *depends* on it being populated. Business
> rule: [`business-rules-erp-data.md`](business-rules-erp-data.md) §3.

Every field the spec declares was returned, and no undeclared field appeared — the spec and the
payload agree exactly on both endpoints.

### 5.2 ⚠️ `lineInvoiceQty` is always zero; `lineOpenQty` is RARE, not zero

On `orderHistory`, **`lineInvoiceQty` was 0 in every row tested** (5,874 in the census, 442 in a
later four-week sample). Despite the name it carries no signal here.

> **CORRECTION 2026-08-18.** This section previously said `lineOpenQty` was zero in all 5,874 rows
> too, and treated that as a property of the field. **It is not.** A later 442-row sample found
> `lineOpenQty` **non-zero on 11 rows, up to 250**. The original measurement was right about its
> sample and wrong as a general claim. Keep the field and expect occasional values.

ColdLion's explanation (JamieLynn, 2026-08-18): these endpoints break data down to component level,
and invoice/open quantities are not carried down that far. The fields that *do* carry shipment
reality are **`unshippedQty`** and **`linePickQty`**. Full table and reporting guidance:
[`business-rules-erp-data.md`](business-rules-erp-data.md) §7.

Measured across 442 rows (2021–2026): `lineQty` 442/442 non-zero; `lineCancelledQty` 60;
`unshippedQty` 66; `linePickQty` 55; `lineOpenQty` 11; `lineInvoiceQty` **0**.

Same pattern on `prodHistory`: **`depositPerc` is 0 in all rows tested** and `totalProdCost` is 0 in
3,218 of 3,411, while `extCost` is populated and meaningful.

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

### 5.5 `salesOrderNo = 0` — largely EXPLAINED 2026-08-18

Treat 0 as **"no linked sales order"**: never join on it. Beyond that, ColdLion has now explained
most of it, and there are **three distinct causes**:

1. **Age.** Hard-linking customer POs to production orders began around **2022–2023**; before that
   `custPONumber` was manual, and earlier still barely used. Unlinked share by week: 91% (2019-06),
   48% (2021-03), 42% (2023-11), **0%** (2024-07), 1% (2026-01). Not a defect — rules §5.
2. **Stage.** `INTRAN` and `REC` lines never carry the customer PO or the sales-order link; it does
   not carry down from `ISS`. Every `REC` row tested was unlinked with an empty `custPONumber`.
   Attribute a receipt via `prodOrderNo` back to its `ISS` line — rules §4.
3. **`COS` sample production**, which legitimately has no customer order — rules §1.

**What is still unexplained:** a small recent residue. In 2026-08-03..09, of 43 unlinked `ISS` rows,
**33 are `COS`** and **10 are not** — all customer AMA030, references D3568/D3569, ordered
2026-08-05, quantities 152–1,200. Recent, ordinary-looking, and unlinked. That is the remaining
question with ColdLion.

> **Correction, 2026-08-17.** An earlier version called these rows "stock production not raised
> against a specific customer order". **Wrong and retracted.** `customerCode` is populated on
> **534 of 550** such rows — a customer *is* named; only the sales order is absent.

**Practical guidance:** carry `customerCode` through (on a `COS` line it names the customer of the
*original* order, not the sample recipient). Record the stage each row came from, so an unlinked
`REC` receipt is never confused with an unlinked `ISS` order. Report pre-2022 purchase-to-sales
joins as progressively incomplete rather than as zero.

### 5.6 Negative quantities and costs are real

`linePickQty`, `unshippedQty` and `subQty` reach **-564**; `prodCost`, `extCost` and
`lastProdCost` reach **-85**. Returns or credits. Do not add non-negative constraints.

### 5.7 Merch groups: `merchGroup*` is the assortment, `ppkMerchGroup*` is the component

**Structure confirmed by ColdLion (2026-08-18) and verified here:** `merchGroup01`–`14` describe the
**assortment (master) SKU**; `ppkMerchGroup01`–`14` describe the **component (sub) SKU**. Across 139
multi-component lines, `merchGroup01`–`04` were identical for every component in **139 of 139**
cases, while `ppkMerchGroup01`–`04` varied in **61**.

> **CORRECTION 2026-08-18.** This section previously framed the production side as simply
> "unreliable" next to the order side. That was the wrong diagnosis. On prepack rows it is the
> **assortment-level** groups that are mostly blank — `merchGroup01`/`02`/`03` populated on only
> **14%**, against `ppkMerchGroup01`–`06` on **84–88%**. `merchGroup04` (size) is the exception at
> **97%**. An assortment master is deliberately generic; licensor, theme and artwork live on the
> pieces inside.

**Therefore: read component taxonomy from `ppkMerchGroup*`, and never fall back to `merchGroup*`
when it is blank** — blank there is correct for an assortment, not missing data. Reporting rule:
[`business-rules-erp-data.md`](business-rules-erp-data.md) §6.

The genuinely unexplained residue is the **~12–16% of component rows where `ppkMerchGroup*` is also
blank** (140 of 1,774 fully blank in the census). Still open with ColdLion.

Order-side `subMerchGroup01`–`06` remains the cleanest source of all — never completely blank in the
census (219 of 1,985 partially). `mgTypeCode` meaning varies by division, which matters more here
now that the feed is known to span four divisions — see
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md).

## 6. Questions with ColdLion — answered and outstanding

### ✅ Answered (2026-08-17, relayed by Albert, verified live)

| Question | Answer | Verified |
|---|---|---|
| **Production-order line number** (was the one true blocker) | `prodLineSeq` **added**; the duplicated prod reference number was the cause; ColdLion now selects the maximum `lastProdDate` | Yes — §4.3. Present on 1,475/1,475 rows; order 23825 went from 8 rows to 4 |
| **Paging / rate limits for a bulk pull** | `fromDate`–`toDate` must be **within 7 days (inclusive)**; ~2 seconds per 7-day window from their office | Yes — §2 (8 days refused, 7 accepted) and §3 (0.1–1.4s typical here) |
| **Is `subUpc` ever populated?** | Rarely. UPCs are not usually assigned to prepack components; one known case, a Walmart assortment | Consistent with 0/1,985 measured — **keep the column**, see §5.1 |
| **What does a `COS` production PO mean?** | Sample production: extra pieces of a customer's item made for the licensor (contractual samples) or internally (DAVID samples) | Yes — quantities 3–15, median 4, all unlinked. [`business-rules-erp-data.md`](business-rules-erp-data.md) §1 |

**Also settled, not to be asked again:** `1900-01-01` as the empty-date marker — confirmed by the
owner 2026-08-14 (§5.3).

**Full register, including older non-endpoint questions:**
[`coldlion-open-questions.md`](coldlion-open-questions.md).
**Stage-discovery evidence:**
[`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).

### ⬜ Still outstanding

Drafted in [`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md).
**None of these blocks the load.**

1. **The authoritative list of `stageCode` values.** New and the most useful of these — we know
   `ISS` and `REC` are real and `INTRAN` is named, but a stage we do not know about is a stage we
   silently never fetch (§2, [`business-rules-erp-data.md`](business-rules-erp-data.md) §4).
2. **The ~12–16% of component rows where `ppkMerchGroup*` is blank**, after the assortment-vs-
   component structure is accounted for (§5.7).
3. **Recent non-`COS` unlinked lines.** ColdLion's historical explanation covers the old ones, but
   10 rows in 2026-08 are `ISS`-stage, not `COS`, recent, and unlinked — all customer AMA030,
   references D3568/D3569, ordered 2026-08-05 (§5.5).
4. **How far back the history goes**, to size the one-time load (§7).

### ✅ Answered by ColdLion (JamieLynn), 2026-08-18 — all verified here

| Question | Answer | Where |
|---|---|---|
| `ppkMerchGroup*` blank rate | `merchGroup*` = assortment SKU, `ppkMerchGroup*` = component SKU. Confirmed: master groups identical across components 139/139; component groups vary in 61 | §5.7, rules §6 |
| `lineInvoiceQty`/`lineOpenQty` always zero | Not carried at component level; use `unshippedQty`/`linePickQty` instead | §5.2, rules §7 |
| Non-`COS` `salesOrderNo = 0` | Hard-linking POs to production orders began ~2022–2023; `custPONumber` was manual before that, and drops off entirely on `INTRAN`/`REC` stages | §5.5, rules §4–§5 |

## 7. What has NOT been checked

Stated plainly so the next session does not assume more coverage than exists.

- **How far back the history goes.** Earliest window probed is 2019-06 and it returned data;
  no earlier boundary was searched.
- **`stageCode` and `prodOrderNo` on `prodHistory`** — never exercised. Values and meaning unknown.
- **`divisionCode` / `salesOrderNo` filters on `orderHistory`** — never exercised.
- **Whether the endpoints are stable over time.** Windows were re-fetched on 2026-08-17 only to
  confirm ColdLion's two changes, and the row counts for a given window are **not** directly
  comparable across the change (month windows are now refused). Nothing yet proves that the same
  7-day window returns the same rows on two different days. That matters for incremental re-pulls
  and should be tested before designing the recurring sync — and it now has a cheap test, since a
  7-day window costs about a second.
- **Whether the `lastProdCost` fan-out is confined to 2021.** It appeared in both March 2021
  windows and in none of the other seven. Not proven absent elsewhere, only unobserved.
- **The five months between sampled windows.** Patterns held in all seven windows across seven
  years, but the sample is 10 months of roughly 80.
- **Anything about loading this into Supabase.** No schema, no migration, no target tables.
  Per the shared-DB rules, any structure for this is authored in `u2giants/shared-db` first.
