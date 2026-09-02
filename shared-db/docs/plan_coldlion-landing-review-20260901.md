# Fresh review of `plan_coldlion-landing-phases-2-6.md` — 2026-09-01

**Verdict: the plan is still directionally right and steps 1, 2, 3 and 6 are safe to build as
written. Step 4 (sales history) must not be built as written — its resolved key is wrong, its
verification is invalidated, and one of its two design corrections rests on fields that do not
exist. Step 7's loader contract contains two rules that are now false.**

Every claim below was checked against the live ColdLion spec (`GET /EhpApi/v2/api-docs`) or against
a paged pull of **1,823 `orderHistory` rows across 409 sales orders, 2019–2026**, both on
2026-09-01. Nothing here is inferred from the plan's own text.

---

## A. What is still valid — do not re-litigate

- **The whole "Why".** DesignFlow's 29-field projection is still the only path ColdLion item data
  takes into our database, division is still empty because of it, and the `UNIQUE (external_id)`
  key on `erp_items_current` is still wrong. Findings 1–3 stand.
- **Finding 6 — 26% of order lines have no item master row.** This is the load-bearing finding for
  step 4 and it survives; it is the reason the history tables can carry no foreign key to
  `item_header`, and (see §B4) it now also argues against dropping a field the plan drops.
- **Finding 7 — sparse is not dead.** Reinforced this week: we nearly declared four item flags
  usable on population counts alone, and ColdLion told us three are simply not maintained.
- **Owner decisions D1, D3–D13.** All still sound. D5 (no raw JSON archive) is the reason the
  defects below matter: a field dropped now cannot be recovered without re-pulling seven years.
- **Step order.** Merch groups and items first is still correct — everything else references them.
- **The prepack sum assertion in step 4 holds, restated.** `sum(quantity) = prepackQty` within a
  prepack group: **176 of 176 groups, zero violations.** Keep it as a post-load assertion.

## B. What is now wrong — six defects

### B1. The step-4 line key is wrong and its verification is invalidated (severity: high)

The plan carries a green "✅ RESOLVED 2026-08-20 — the line key is known. Do not re-derive it" box
giving the key as `(salesOrderNo, itemNo, labelCode)`, verified on 1,671 rows with the claim that
**"no field other than `linePrice` varies inside any group."**

On 1,823 rows that key **collides on 181 of 1,243 groups**, and the "only `linePrice` varies" claim
is false by a wide margin. Fields that vary inside those groups:

| Field | Groups where it varies (of 181) |
|---|---|
| `itemDesc` | 176 |
| `subItemNo` | 176 |
| `merchGroup06` | 162 |
| `brandAssuranceNo` | 158 |
| `merchGroup05` | 135 |
| `linePrice` | 7 |

The 2026-08-20 verification was not wrong when it was made — it was made before ColdLion exposed
`salesOrderLineNo`, `subItemNo`, `orderQty` and `invoiceQty`, and against a payload that did not
distinguish parent from component. **It is now stale, and the ✅ marker makes it dangerous**: it
explicitly tells the next session not to re-derive.

**Correct key, measured 2026-09-01:** `(salesOrderNo, salesOrderLineNo, itemNo, subItemNo)` —
**zero duplicates across all 1,823 rows.** Adding `subColorCode` and `subLabelCode` does not change
that, so they are not needed in the key.

### B2. The two-table line/component split no longer matches what the API returns (severity: high)

Step 4 specifies `order_history_line` (one sales-order line) and `order_history_component` (one
component style). **The API never returns a line row.** It returns only exploded component rows;
the parent line exists solely as fields repeated identically across its children.

That does not make the split wrong, but it changes it from *unpacking a nested payload* into
*synthesising a parent by de-duplicating repeated fields*. That synthesis needs its own rule and its
own assertion (every field assigned to the parent must be constant within the group, or the load
fails). **The plan currently describes neither, and a session following it as written will assume a
parent row arrives from ColdLion.**

A single flat table keyed as in B1, with the parent-level columns simply repeating, is the
lower-risk option and should be reconsidered on merit rather than inherited from the design doc.

### B3. `subMerchGroup*` and `ppkMerchGroup*` do not exist (severity: high)

The plan carries a prominent warning box — *"D2 does NOT extend to component merch groups —
corrected 2026-08-19 after external review"* — which keeps `subMerchGroup*` on the sales side and
`ppkMerchGroup*` on the production side, and raises the field counts from 25 → **31** and
55 → **83** on that basis. Those field counts drive the step-4 and step-5 table widths.

**Neither field family exists.** Live spec, 2026-09-01: `OrderHistory` has **63** properties and
`ProdHistory` has **105**; a name search for `subMerchGroup` or `ppkMerchGroup` returns **nothing**
in either. `ProdHistory` does have a `prepack*` family (`prepackItemNo`, `prepackColorCode`,
`prepackDimCode`, `prepackLabelCode`, `prepackSizeCode`, `prepackQty`, `prepackDivisionCode`,
`prepackItemPKey`, `ppkDetailCost`), which is probably what was meant — but those are identity and
cost fields, **not merchandise groups**.

So a correction that was itself the product of an external review is built on fields that were never
in the payload, and the field counts it produced are unreliable. **Both step-4 and step-5 field
counts must be re-derived from the live spec before either table is written.**

### B4. D2 is unsafe for prepack rows, and only the owner can change it (severity: high — needs Albert)

D2 drops line-level `merchGroup01`–`06` from both history feeds, on evidence that they were
identical to the item master on 519 of 519 lines.

**Within a single prepack line — same parent `itemNo`, same order, same line number —
`merchGroup05` (licensor) varies across the component rows in 135 of 176 groups, and
`merchGroup06` (property) in 162 of 176.** A single parent item cannot have five licensors. These
fields therefore describe **the component SKU on that row**, not the parent. `itemDesc` varies in
176 of 176 groups, confirming the same thing.

The 519/519 evidence was almost certainly measured on non-prepack rows, where the row *is* the item
and the duplication is real. It does not generalise.

Consequence: on prepack rows, `merchGroup01`–`06` are the feed's only record of what the component
actually is — and under finding 6, 26% of lines have no item master row to recover it from, and
under D5 there is no raw archive to go back to. **Dropping them is a permanent, one-way loss of
seven years of assortment taxonomy.**

This is an owner ruling and this review does not overturn it. It goes to Albert as a narrow
question: *keep `merchGroup01`–`06` on prepack component rows only, and continue to drop them on
non-prepack rows where they genuinely duplicate the item master?*

### B5. Step 7's loader contract has two rules that are now false (severity: medium)

| Plan rule | Reality on 2026-09-01 |
|---|---|
| "**No paging** on the two history endpoints; `page`/`size` silently ignored" | **Wrong since 2026-08-31.** Both endpoints return the standard envelope and honour `page`/`size`. A loader built to the plan's rule will pull 200 rows per window and believe it has them all |
| §7's rejected approach "Paging the two history endpoints" | Same — must be un-rejected |

And a rule the plan does not have and needs: **the page size caps silently at 200.** A request with
`size=5000` returns 200 rows and no error. This exact trap cost us a wrong row count this week
(1,375 reported against a true 1,823). **Always loop until `last` is true.**

The 7-day window cap, the HTTP-400-with-`status:500` refusal contract, the `EP001` filter and the
one-request-at-a-time pacing are all unchanged and still correct.

### B6. Field-level gaps that will bite the loader (severity: medium)

- **`invoiceNoString` and `pickTicketNoString` can hold comma-separated lists** (order <order redacted>:
  `<invoice A>,<invoice B>,<invoice C>` — three comma-separated numbers; 31 of 1,823 rows). Any typed integer column truncates or fails.
  Assume `invoiceDateString` behaves the same.
- **An invoice number does not mean the row was invoiced** — order <order redacted> carries invoice numbers
  on lines with `invoiceQty` = 0. Fulfilment state comes from quantities only.
- **`orderQty` = 0 on a prepack row is a rounding artefact, not an empty line** (order <order redacted>,
  17 rows: `lineQty` 1 ÷ `prepackQty` 4). Do not filter these out as junk.
- **Eight fields are new since the decisions CSV was written** — `orderQty`, `invoiceQty`,
  `pickTicketNoString`, `prepackQty`, `quantity`, `labelDesc`, `warehouseDesc`, and
  `merchGroup01Desc`–`14Desc`. **D4 says only fields marked `ingest` get a column, and none of these
  are marked at all.** They are not optional: `orderQty` and `invoiceQty` are now the only correct
  quantities. The CSV needs an owner pass before step 4 is built.
- **Stale counts:** finding 1 says 18,875 items; the catalogue is now 19,362. Cosmetic, but the
  plan invites re-derivation and the number should not read as current.

## C. Is the plan still optimal?

Mostly yes, with two changes to sequencing.

1. **Steps 2 and 3 (merch groups, items) are unaffected by everything above and should start now.**
   Nothing in this review touches them.
2. **Step 4 must be re-designed before it is built**, not patched mid-build. The three things it
   needs — the corrected key, a decision on flat-vs-split, and Albert's answer on B4 — are all
   cheap, and all of them are expensive to discover halfway through a migration.
3. **Step 5 (production history) inherits B3** and needs its field count re-derived, but its key
   (`prod_order_no, prod_line_seq`) is ColdLion-supplied and unaffected.
4. **One structural weakness the plan has always had:** every "✅ RESOLVED — do not re-derive" box is
   a permanent instruction written from a temporary measurement. B1 is exactly that failure. Those
   boxes should carry the payload version or field list they were measured against, so a later
   session can tell whether the ground moved. **This is the single most useful change to make to the
   plan's form, independent of its content.**

## D. What this review does not cover

- The `core.*` promotion layer, deliberately out of scope in the plan.
- Where the loaders run (step 7 names it an open decision; it still is).
- The price question on order <order redacted>, where collapsing the old duplicate rows left a single
  `linePrice` matching neither of the two prices previously returned. **We cannot re-verify this
  against the pre-change payload and it is not being reported to ColdLion as a defect.** It is
  recorded here only so a later session does not rediscover it as new.

---

## Related

- [`plan_coldlion-landing-phases-2-6.md`](plan_coldlion-landing-phases-2-6.md) — the plan under review
- [`business-rules-erp-data.md` §10](business-rules-erp-data.md) — the prepack model this review rests on
- [`coldlion-open-questions.md`](coldlion-open-questions.md) — the question register
