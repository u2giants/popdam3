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
marker in the **item code** instead: `VSZ851MABPCONTR` and `VSZ851WAJGCONTR` (`CONTR` suffix,
"DC COMICS CANVAS SAMPLES"), both quantity 15, both unlinked, and **neither had a `COS` reference**.
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

Example: order 20016, line 1, reference `d0561`, 1,600 units of a Marvel long canvas for customer
MOD010, with no sales order attached.

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
22717 (2024-07-01, item VSZ20ATRN01, customer HLL770):

| Stage | Line | Qty | `salesOrderNo` | `custPONumber` | Meaning |
|---|---|---|---|---|---|
| `ISS` | 1 | 4,800 | 7123801 | populated | what we ordered |
| `REC` | 2 | 4,548 | **0** | empty | what we received |

Ordered 4,800, received 4,548. **That difference is a real business fact** — short shipment — and it
is invisible unless `REC` is fetched deliberately.

**What it implies:**

1. **Fetch every stage explicitly.** Confirmed live so far: `ISS` and `REC`. `INTRAN` is named by
   ColdLion but returned 0 rows in the windows tested — treat it as valid and fetch it. Probing
   `OPEN`, `CLOSED`, `SHIP`, `CAN`, `PEND`, `NEW`, `COMP`, `WIP`, `APPR` returned nothing; the full
   list of valid codes has **not** been confirmed by ColdLion and should be.
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
