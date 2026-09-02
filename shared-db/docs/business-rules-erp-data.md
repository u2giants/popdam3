# Business rules for reading ERP data

**What this is:** the *business meaning* behind ColdLion ERP fields and codes — the things no
amount of querying can tell you, because they live in how POP Creations actually operates.

**Why it exists:** as of 2026-08-17 this repo had extensive documentation of ERP data *shape*
(field names, types, populations) and none of its *meaning*. That gap caused a real mistake: a
session inferred from field populations that a class of production orders was "stock production
not raised against a customer order", which was **wrong**. Shape tells you what a field contains;
only the business can tell you what it means.

**How to use it:** every rule here is stated by the owner or a named source, dated, with what it
implies for reporting. Do not add an inferred rule to this file. Inferences belong in the shape
docs, clearly labelled as inferences, until someone with authority confirms them.

Related: [`coldlion-open-questions.md`](coldlion-open-questions.md) (what is still unanswered),
[`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md) (data shape),
[`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) (the API itself),
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) (taxonomy).

---

## 1. Production PO numbers ending `COS` — sample production

> **Owner ruling (Albert Hazan, 2026-08-17), relaying POP Creations' own practice:**
>
> "If a Production PO # (`prodReferenceNo`) has a COS at the end it means we are making extra
> pieces of those items (that are going to the customer) not for the customer but for the licensor
> (called **contractual samples**) and/or our internal purposes (called **'DAVID' samples**)."

**What it means.** A `COS` production order is an *add-on run of an item that is already being made
for a customer*, produced for someone other than that customer:

- **Contractual samples** — pieces owed to the **licensor** (Disney, Marvel, Warner and so on) under
  the licensing agreement, typically for approval or record.
- **DAVID samples** — pieces retained for **POP Creations' own internal purposes**.

**What it implies for reporting — this matters:**

1. **`COS` lines are a real cost with no corresponding customer revenue.** They are goods we pay a
   factory to make and then give away or keep. Counting them as ordinary purchases understates
   margin on the customer order; ignoring them entirely understates the true cost of servicing that
   licensed product. They should be **classifiable separately**, not silently merged into either.
2. **They are legitimately unlinked to a sales order.** `salesOrderNo = 0` on a `COS` line is
   correct and expected, not missing data — see §2 of the shape doc's §5.5 discussion.
3. **The customer named on a `COS` line is the customer of the *original* order**, not the recipient
   of the samples. The recipient is the licensor or ourselves. Do not report `COS` quantities as
   shipped to that customer.
4. The distinction between contractual and DAVID samples is **not visible in the ERP payload** —
   both share the `COS` suffix. If we ever need to split them, that is a new question for ColdLion.

**Evidence in the data (verified 2026-08-17, 1,047 rows across five weeks spanning 2019–2026):**

- `prodReferenceNo` ending `COS` appeared on **95 rows / 95 distinct order-lines**, and on
  **zero** rows that had a sales order. The rule is clean in both directions.
- **Quantities are tiny and unmistakable:** `COS` lines run **min 3, median 4, max 15**, against a
  median of **2,000** on ordinary customer-linked lines. Sample runs look like sample runs.
- They concentrate in `FOBCHINA` (83 of 95) and warehouse `FOB` — consistent with pieces peeled off
  a factory-direct shipment.

**A second, older sample marker exists — do not assume `COS` is the only one.** Two rows carried the
marker in the **item code** instead: `AAA111BBBBCONTR` and `AAA111CCCCCONTR` (synthetic values, real shape) (`CONTR` suffix,
"<LICENSED> CANVAS SAMPLES"), both quantity 15, both unlinked, and **neither had a `COS` reference**.
A third case put it in the item itself: `SAMPLECHRG` / "SAMPLE CHARGE". So sample-related production
is identifiable by **at least three** different conventions. Any "is this a sample?" rule must
account for that, and a `COS`-only rule will miss cases.

## 2. What `COS` does NOT explain

Of **550 unlinked rows** in the same sample, `COS` accounts for **95**. The remaining **455 rows
(248 distinct order-lines)** have no sales order and no `COS` marker, and they do **not** look like
samples:

- **Quantities are ordinary production volumes** — min 1, **median 430**, max 15,600.
- They are dominated by `POECA` and `POE` production types (380 of 455) and by division `CW001`.
- A customer is still named on nearly all of them.

Example (synthetic values, real shape): order 90020, line 1, reference `d0000`, 1,500 units of a
licensed long canvas for customer `CUS011`, with no sales order attached.

**This is still an open question with ColdLion** and is the sharpened version of the original
`salesOrderNo = 0` query. Until it is answered, do not classify these rows as samples, as stock
production, or as customer orders. See
[`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md).

## 3. `subUpc` on prepack components — sparse by practice, not unused

> **ColdLion, relayed by Albert Hazan, 2026-08-17:**
>
> "you don't often assign UPCs to prepack components. I can remember one instance of an assortment
> we shipped for Walmart where we did but that's it"

**What it means.** Component-level barcodes are the exception, not the rule. POP Creations barcodes
the assortment (the master item the customer buys), not usually each style inside it. A component
UPC appears only when a customer demands it — the known case being a **Walmart** assortment.

**What it implies for reporting:**

1. **Keep the field.** An empty `subUpc` is the normal, correct state and means "no component-level
   barcode was assigned", not "data missing".
2. **A populated `subUpc` is a signal worth noticing** — it marks an assortment where a retailer
   required component barcoding, which is a customer-requirement fact, not just a code.
3. **Never make it required, and never key on it.** Any join or match that assumes it is present
   will match almost nothing.

**Corrects an earlier inference.** Measuring 0 populated out of 1,985 component rows, an earlier
version of the shape doc concluded `subUpc` was "a dead field, not sparse data" and told loaders to
drop the column. **Wrong** — and a good illustration of why this file exists: no amount of counting
empty values distinguishes "never used" from "used once, for Walmart, five years ago". Only the
business knows.

## 4. Production orders have lines in different STAGES, and the API hides most of them

> **ColdLion (JamieLynn), relayed by Albert, 2026-08-18:**
>
> "if you're getting prod stages INTRAN or REC, the custPONumber drops off / doesn't carry down,
> so it would only be on lines in stage ISS."

**What it means.** A production order's lines move through stages — `ISS` (issued: what we ordered),
`INTRAN` (in transit), `REC` (received: what actually arrived). Later-stage lines **do not carry the
customer PO or the sales-order link**. That is by design in ColdLion, not data loss.

> ### ⚠️ CRITICAL FOR ANY LOADER — the default response is INCOMPLETE
> **`GET /prodHistory` without `stageCode` returns only the `ISS` lines.** Verified 2026-08-18:
> for 2026-08-03..09 the default returned **67 rows, byte-identical to `stageCode=ISS`**, while
> `stageCode=REC` returned **21 further rows that appear nowhere in the default response** (zero key
> overlap). Same for 2024-07-01..07: default 144 rows, `REC` a further 159.
>
> **A loader that omits `stageCode` silently loses every receipt line** — that is, everything about
> what actually *arrived* as opposed to what was ordered. For a purchase-history dataset that is a
> hole in the middle of the subject.

**`REC` lines are different lines of the same orders, not duplicates.** Example, production order
90003 (2024-07-01, item ZZF20AAAA01, customer CUS770 — synthetic values, real shape):

| Stage | Line | Qty | `salesOrderNo` | `custPONumber` | Meaning |
|---|---|---|---|---|---|
| `ISS` | 1 | 5,000 | <order redacted> | populated | what we ordered |
| `REC` | 2 | 4,748 | **0** | empty | what we received |

Ordered 5,000, received 4,748. **That difference is a real business fact** — short shipment — and it
is invisible unless `REC` is fetched deliberately.

**What it implies:**

1. **Fetch all three stages explicitly — the list is now AUTHORITATIVE.**
   > **ColdLion (JamieLynn), 2026-08-19: "all The stages are: ISS, INTRAN, REC."**
   >
   > There are exactly three. No other stage code exists, so nothing is being silently missed.

   All three carry real rows. `INTRAN` was invisible in early probing (0 rows in four windows) but
   **does return data** — 7 rows for 2026-07-27 and **129** for 2024-07-01, verified 2026-08-19. It
   is a transient state, so whether a window has `INTRAN` rows depends on when you ask. Like `REC`,
   every `INTRAN` row tested was unlinked with no `custPONumber`.
2. **Record which stage each row came from.** Nothing in the payload itself says — the stage is only
   known from the request that fetched it. Without it, ordered and received quantities are
   indistinguishable and will be double-counted as one purchase.
3. **`salesOrderNo = 0` on a `REC` line is expected and correct** — the link does not carry down.
   To attribute a receipt to a customer order, join back to the `ISS` line of the same
   `prodOrderNo`, not to `salesOrderNo`.

## 5. Sales-order linking only became reliable around 2022–2023

> **ColdLion (JamieLynn), 2026-08-18:** "even from the production order number I can see that these
> are very old. I don't believe we started hard-linking POs to production orders until maybe
> 2022 / 2023. Before then, custPONumber was a manual entry field, and earliest, didn't really
> exist."

**What it means.** The absence of a sales-order link on older production lines is **historical
practice, not corruption**. Before roughly 2022–2023 the customer PO was typed in by hand, and
earlier still the field was not really used.

**The data agrees.** Share of `ISS` rows with no `salesOrderNo`, by week sampled:

| Week | Unlinked | Reading |
|---|---|---|
| 2019-06-03 | **125 of 138 (91%)** | before hard linking |
| 2021-03-01 | 318 of 662 (48%) | transitional |
| 2023-11-06 | 13 of 31 (42%) | transitional |
| **2024-07-01** | **0 of 144 (0%)** | hard linking in force |
| 2026-01-05 | 1 of 74 (1%) | hard linking in force |

**What it implies:**

1. **Do not treat old unlinked rows as a data-quality defect** to be cleaned or chased. They are
   what the ERP recorded at the time.
2. **Any report joining purchases to sales orders is progressively less complete the further back
   it reaches.** State the cut-off rather than letting a chart imply we bought nothing for
   customers before 2022. Confirm the exact year with ColdLion before publishing one.
3. **`custPONumber` is only meaningful on `ISS` lines**, and only after linking began.

## 6. Merch groups on `prodHistory`: assortment level vs component level

> ### ⚠️ SUPERSEDED 2026-09-01 — `ppkMerchGroup*` no longer exists
> Checked against the live spec (`GET /EhpApi/v2/api-docs`) on 2026-09-01: `ProdHistory` has **105**
> properties and `OrderHistory` **63**, and a name search for `ppkMerchGroup` or `subMerchGroup`
> returns **nothing on either feed**. `ProdHistory` carries a single `merchGroup01`–`14` family (plus
> `Desc` twins) and a `prepack*` family that is identity and cost only — `prePackCode`,
> `prepackItemNo`, `prepackColorCode`, `prepackDimCode`, `prepackSizeCode`, `prepackLabelCode`,
> `prepackQty`, `prepackDivisionCode`, `prepackItemPKey`, `ppkDetailCost` — **no merch groups**.
>
> **What this means.** The two-family split described below was real when measured on 2026-08-18 but
> the payload changed on or before 2026-08-31 (the same change that introduced paging). **Both feeds
> now carry ONE merch-group family on the exploded component row, and on prepack rows it holds the
> COMPONENT's values** — see §9. The measured populations below are kept as history; the instruction
> "read component taxonomy from `ppkMerchGroup*`" is **void, and no code may be written against it**.
> The rest of the section stands as a record of what the old payload looked like.


ColdLion's read (JamieLynn, 2026-08-18) is **confirmed structurally**: `merchGroup01`–`14` describe
the **assortment (master) SKU** and `ppkMerchGroup01`–`14` describe the **component (sub) SKU**.
Verified on 139 multi-component lines: `merchGroup01`–`04` were **identical across every component
of a line in 139 of 139 cases** (so they describe the line, not the piece), while
`ppkMerchGroup01`–`04` **varied between components in 61** of them.

**But the gap runs the opposite way to the one suggested.** On prepack rows it is the
*assortment-level* groups that are mostly empty:

| On prepack rows | `merchGroup` (assortment) | `ppkMerchGroup` (component) |
|---|---|---|
| Group 01 | 14% populated | **88%** |
| Group 02 | 14% | **84%** |
| Group 03 | 14% | **84%** |
| Group 04 | **97%** | 88% |
| Group 05 | 12% | **86%** |
| Group 06 | 3% | **86%** |

**What it implies:** an assortment master SKU is deliberately generic — it carries the size
(group 04) and little else, because the licensor, theme and artwork differ per piece inside the
pack. **Read component taxonomy from `ppkMerchGroup*`, and do not fall back to `merchGroup*` when it
is blank** — blank there is the normal state for an assortment, not missing data. The genuinely
unexplained gap is the ~12–16% of component rows where `ppkMerchGroup*` is also blank.

## 7. `lineInvoiceQty` and `lineOpenQty` on `orderHistory` are not the shipped/unshipped fields

> **ColdLion (JamieLynn), 2026-08-18:** "Because this report is breaking down the data into the
> component values, I don't believe these fields would be populated. Are there fields called Shipped
> and Unshipped quantity or something like that that you're seeing?"

**What it means.** These endpoints report at component level, and invoice/open quantities are not
carried down to that level. The fields that *do* carry shipment reality are **`unshippedQty`** and
**`linePickQty`**.

**Measured (442 rows across four weeks, 2021–2026):**

| Field | Non-zero | Notes |
|---|---|---|
| `lineQty` | 442 of 442 | the order quantity; always present |
| `lineInvoiceQty` | **0 of 442** | not carried at component level |
| `lineOpenQty` | 11 of 442 | rare but **real** — up to 250 |
| `unshippedQty` | 66 of 442 | mostly on prepack rows (54 of 105) |
| `linePickQty` | 55 of 442 | mostly on prepack rows (54 of 105) |
| `lineCancelledQty` | 60 of 442 | mostly on plain rows (57 of 337) |

**What it implies:** build shipment reporting on `unshippedQty` and `linePickQty`, not on
`lineInvoiceQty`. Treat `lineInvoiceQty` as unavailable here; if invoiced quantity is ever needed it
must come from elsewhere.

**Corrects an earlier claim.** This repo stated that `lineInvoiceQty` **and** `lineOpenQty` were
"zero in all 5,874 sampled rows". That held for that sample but is **false in general**:
`lineOpenQty` is populated on 11 of 442 rows in a different sample. `lineInvoiceQty` remains
all-zero everywhere tested. A second illustration of the rule at the top of this file — absence in
a sample is not absence in the data.

## 8. Amazon orders are stock production and legitimately have no sales order

> **ColdLion (JamieLynn), relayed by Albert, 2026-08-19:**
>
> "customer code AMA030 is Amazon. Amazon orders are stock (not presold, for inventory) and do not
> have customer POs. They're stock to Amazon's warehouse."

**What it means.** Goods for Amazon are produced **to stock, not against a customer order**. We
manufacture, ship into Amazon's warehouse, and the sale happens later. There is no customer PO to
record, so `salesOrderNo = 0` and `custPONumber` empty are **correct**, not a broken link.

**Verified 2026-08-19:** across four sampled weeks, **10 of 10** `AMA030` production lines were
unlinked, none had a `custPONumber`, all were `prodTypeCode = StockCa` into warehouse `AMACN`.
Every other major customer in the same sample was at 0% unlinked (the four next-largest customers
contributed 120, 94, 16 and 10 rows — all linked).

**What it implies for reporting:**

1. **Three economically different things now share `salesOrderNo = 0`** and must not be lumped
   together:
   - **`COS` samples** (§1) — cost with **no revenue ever**.
   - **Stock production for Amazon** — cost with **revenue later**, once Amazon sells it.
   - **Historical rows** (§5) and **`INTRAN`/`REC` lines** (§4) — linked in reality, just not
     recorded as such.
   A margin report that treats all four the same will be wrong in three different directions.
2. **Unsold stock is inventory, not a loss.** Amazon production without a matching sales order is
   the normal state at the moment of manufacture.
3. **Do not use `customerCode` alone to decide "was this presold".** Amazon is named as the customer
   on lines that were never presold to anyone.

> ### ⚠️ Do NOT infer stock production from `prodTypeCode`
> The obvious-looking shortcut is wrong. `prodTypeCode` starting with `Stock` (`StockCa`, `StockCA`,
> `StockNY`) does **not** mean unlinked: in 2024+ data, **130 `Stock*` rows produced only 10
> unlinked ones (8%)** — one non-Amazon customer alone has **120 linked `Stock*` rows**. The Amazon
> arrangement is a **customer-level business fact**, not a production-type flag. Note also that the
> same code appears as both `StockCa` and `StockCA` — case varies.

**A partial vindication, honestly recorded.** The first version of the shape doc guessed these
unlinked rows were "stock production not raised against a specific customer order". That was
retracted on 2026-08-17 as an unfounded inference, and retracting it was right — it was applied to
all 550 unlinked rows, most of which are historical or sample lines. For the **Amazon subset
specifically** the guess turns out to describe reality. A guess that happens to be right about one
slice is still not a documented rule; this one is now a rule because ColdLion said so.

**Residue after all four causes:** in 2024+ `ISS`, non-`COS`, non-Amazon data, **6 unlinked lines
out of 803 (0.7%)** remain unexplained — orders 90010 (CUS770, qty 3,000 and 4,000), 90011/90012
(CUS160, qty 1 each), 90013 (CUS030, qty 1) and 90014 (CUS011, `ZZGCORNER`, qty 7,500) —
synthetic order, customer, item and quantity values, real shape. The qty-1
lines look like charges rather than production. Not worth chasing unless a report trips over them.

## 9. Licensor and property are meaningless at the assortment (Master) level

> **Albert (owner), 2026-09-01:** "In one Master assortment we have 4 different designs with 4
> different licensors/properties. A licensor and property at the Master level is meaningless. It's
> only useful for the sub-items."

**Vocabulary.** What ColdLion calls a **prepack** is what we call a **Master assortment**: one
sellable master SKU that contains several different component styles. `itemNo` is the Master;
`subItemNo` (with `subColorCode` and `subLabelCode`) is the component actually manufactured and
licensed.

**The rule.** Licensor (`merchGroup05`) and property (`merchGroup06`) are **attributes of the
component style, never of the Master**. A Master assortment routinely spans several licensors and
several properties at once, so any single licensor or property value stamped on the Master is at
best one of four and at worst wrong. This is a business fact about how assortments are built, not a
data-quality problem to be cleaned up.

**What it implies:**

1. **Never read licensor or property from a Master assortment record**, and never fall back to the
   Master when the component value is blank. Blank at assortment level is the normal state, not
   missing data — §6 measured that on the pre-2026-08-31 payload, and it is quoted here as the
   original evidence, not as a current field map.
2. **Any report grouped by licensor or property must explode assortments to components first.**
   Grouping at Master grain attributes the whole assortment to whichever single licensor happens to
   sit on the Master and silently drops the rest — on a four-design Master, three of the four.
3. **A Master's licensor set is derived, not stored** — it is the distinct set of its components'
   licensors, and it is a set, not a value.
4. **Royalty and licence-expiry logic runs at component level only.** A lapsed licence retires the
   component styles that use it; the Master survives with fewer components.
5. **Both history feeds now carry ONE merch-group family, and on an exploded prepack row it holds
   the COMPONENT's values.** Measured on `orderHistory`, 2026-09-01: inside a single prepack line
   `merchGroup05` varies across component rows in 135 of 176 groups and `merchGroup06` in 162 of
   176. This is why owner ruling **D14** keeps `merchGroup01`-`06` on prepack component rows.
   The separate `ppkMerchGroup*` family that §6 documented on `prodHistory` **no longer exists** —
   see the superseded box at the top of §6. Do not write code against it, and do not treat the two
   feeds as using different conventions any more.

## 10. Prepacks — how one sales-order line becomes many SKU rows

> **Read this before building any order-history loader.** It is the full prepack model,
> reconstructed here on 2026-09-01 from the withdrawn `coldlion-prepack-sku-mapping.md`, which was
> removed because its worked examples carried real customer transaction data. **Every value below
> is synthetic**; the field names, the arithmetic and the rules are the real ones.
>
> Source: ColdLion tech team via JamieLynn, 2026-09-01, plus a live verification pull of 1,823
> `orderHistory` rows across 409 sales orders spanning 2019–2026.

This model exists because the largest misreading we ever made of the ColdLion feed — the
"quantities are multiplied 49×" fault we reported as issue 7 on 2026-08-31 — **was not a fault.**
It was us summing parent-level totals as if they were per-SKU totals.

### 10.1 What a prepack is

A **prepack** (what we call a Master assortment) is a pre-assembled assortment sold to a retailer
as one thing. The retailer orders N units of a prepack code, and each unit contains a fixed recipe
of component SKUs.

The ERP records the customer's intent as **one sales-order line** (item, label, prepack code). The
API does **not** return that line. It returns the line **exploded: one row per component SKU**. The
parent line never appears as its own row. Seven rows all showing the same large quantity are not
seven copies of a quantity — they are seven different products, each repeating the same **parent**
total in the parent-level fields.

### 10.2 The real SKU is not `itemNo`

On an exploded row, `itemNo` is the **parent prepack's** item number and is identical on every row
of the group. The product actually shipped is identified by `subItemNo` (the real SKU),
`subColorCode` and `subLabelCode` together. `subDimCode`, `subSizeCode` and `subUpc` follow the
same rule.

ColdLion's instruction: **use the sub-item fields as the SKU whenever they are not blank; fall back
to `itemNo` when they are.**

**Loader rule:** the SKU key is `COALESCE(NULLIF(subItemNo,''), itemNo)`, and the same pattern for
colour and label. Never key on `itemNo` alone — on a prepack order it collapses several distinct
products into one.

### 10.3 Which quantity fields are per-SKU and which are parent totals

| Field | Level | Trust for a SKU-level loader? |
|---|---|---|
| `lineQty` | **parent line total** | No |
| `lineInvoiceQty` | **parent line total** | No |
| `prepackQty` | units of the assortment implied by the recipe (denominator) | context only |
| `quantity` | the component's multiplier within the recipe | context only |
| **`orderQty`** | **per SKU, already computed by ColdLion** | **Yes — use this** |
| **`invoiceQty`** | **per SKU, already computed by ColdLion** | **Yes — use this** |
| `shipQty`, `orderAmount`, `shipAmount` | per SKU, follow `orderQty` | Yes |

ColdLion states the arithmetic as:

    orderQty   = (lineQty        / prepackQty) * quantity
    invoiceQty = (lineInvoiceQty / prepackQty) * quantity

**Verified live on 751 prepack rows: the formula reproduces `orderQty` and `invoiceQty` exactly on
734 of them (97.7%).** The 17 exceptions are all one order and are explained in §10.6. On the 1,072
**non-prepack** rows in the same sample, `orderQty` = `lineQty` and `invoiceQty` = `lineInvoiceQty`
on **100%** of rows. So the two fields simply mean "the quantity of this row's SKU", prepack or
not. **Read only those two; ignore `lineQty`/`lineInvoiceQty` entirely.**

**Worked example — synthetic values, real shape.** Prepack `PPK0003`, parent item `ZZJ0601`, label
`BC`, seven component SKUs. Parent fields repeat on every one of the seven rows:
`lineQty` = `lineInvoiceQty` = **1,750**, `prepackQty` = 7, `quantity` = 1. Per-SKU result on every
row: `orderQty` = `invoiceQty` = **250** = (1750 / 7) × 1.

| `subItemNo` | Component | Unit price | Line value |
|---|---|---|---|
| ZZJ06AAAA01 | Linen hamper | 7.0000 | 1,750.00 |
| ZZJ04BBBB01 | Canvas w/ EVA bin | 2.0000 | 500.00 |
| ZZJ09CCCC02 | Canvas w/ EVA bin 13x9" | 2.5000 | 625.00 |
| ZZJ12DDDD01 | Canvas w/ EVA bin 16x12" | 3.0000 | 750.00 |
| ZZJ1SEEEE01 | Linen hamper | 4.0000 | 1,000.00 |
| ZZJ4RFFFF01 | Linen hamper | 5.0000 | 1,250.00 |
| ZZJ52GGGG01 | Linen hamper | 8.0000 | 2,000.00 |

250 units of the assortment — not 1,750, and certainly not 12,250.

### 10.4 `salesOrderLineNo` = 0 means "prepack component row"

Reported as issue 7. **It is not a defect and needs no fix.** In the verification sample, 12 of the
13 line-0 rows carry a `prePackCode`; the thirteenth matches ColdLion's 2026-08-28 explanation that
most line-0 rows are cancelled items or orders. A line number of 0 is the ERP saying *this row has
no line of its own — it is a piece of its parent's line.*

**Loader rule:** treat `salesOrderLineNo` = 0 as a prepack-explosion marker, not as missing data.
The earlier instruction to quarantine line-0 rows is **withdrawn.**

### 10.5 There is still no unique key, but the rows are no longer ambiguous

`(salesOrderNo, salesOrderLineNo)` repeats on **179** groups in the sample. Adding the item and
sub-item makes it unique: **`(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)`** has **zero**
duplicates across all 1,823 rows.

**Loader rule:** that four-part tuple is the natural key for an order-history row. It is an
empirical result on our sample, not a guarantee from ColdLion, so the loader must still detect and
report a collision rather than assume one cannot happen.

### 10.6 The rounding edge — a fractional component quantity truncates to zero

One order in the sample contributes all 17 exceptions: four prepack lines where `lineQty` = 1,
`prepackQty` = 4 or 5 and `quantity` = 1. The true per-SKU quantity is 0.25 or 0.2 — a quarter of a
prepack cannot be shipped — and ColdLion returns `orderQty` = **0**.

This is arithmetic, not corruption. **Loader consequence: a prepack row with `orderQty` = 0 and a
non-zero parent `lineQty` is a rounding artefact of a partial prepack, not an empty line.** Do not
filter these rows out as junk.

### 10.7 Fields that are lists, not scalars

`invoiceNoString` and `pickTicketNoString` can hold a **comma-separated list** — one sampled order
returns three invoice numbers in one field. **31 rows in the 1,823-row sample carry a comma in
each.** The `String` suffix on the field name was the clue and we missed it.

**Loader rule:** split on comma. A schema typing these as a single integer will truncate or fail.
Assume `invoiceDateString` has the same shape.

### 10.8 An invoice number does not prove the row was invoiced

Sampled orders carry invoice numbers on lines whose `invoiceQty` is 0. Across the sample, 58 rows
have a pick ticket but no invoice, and 336 have neither.

**Loader rule:** fulfilment state must be read from the **quantities** (`invoiceQty`, `shipQty`),
never from the presence of a document number.

### 10.9 A Master assortment has no single licensor or property

See **§9** — licensor and property are meaningless at the Master level and belong only to the
sub-items. Explode assortments to components before grouping any report by licensor or property.
