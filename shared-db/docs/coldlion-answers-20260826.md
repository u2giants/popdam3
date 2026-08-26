# ColdLion answers — 2026-08-26

**What this is:** ColdLion's replies to the four questions Albert sent (register entries 2.4,
2.8, 2.9, 2.10), each one checked against the live API the same day, plus the one question
ColdLion asked us back. The register
([`coldlion-open-questions.md`](coldlion-open-questions.md)) is still the front door — this page
is the evidence behind its §4 entries.

**Verification method:** live spec `GET http://x5.coldlion.com/EhpApi/v2/api-docs`, and live
calls to `GET /EhpApi/orderHistory` and `GET /EhpApi/prodHistory` for
`companyCode=EDGEHOME`, `fromDate=2026-08-04`, `toDate=2026-08-05`. Note the working base path is
`/EhpApi` — `/EhpApi/v2/...` is the **spec** path only and returns 404 for data endpoints.

---

## 1. Invoiced and open quantity — register 2.8

**Asked:** where the report's invoiced quantity and open quantity come from, whether they are
stored or computed, the exact prepack allocation, and whether the inputs are exposed.

**ColdLion:** *"We use the same formulas as report now."*

**Verified — but the fields are NOT broadly populated.** They were 0% across 1,671 rows when we
measured them before. Re-measured 2026-08-26 across **26 one-day windows, 291 rows, spanning
2019-03 to 2026-08**:

| Field | Populated | Where |
|---|---|---|
| `unshippedQty` | 12 / 291 (4.1%) | **2026-08 windows only** |
| `subQty` | 12 / 291 (4.1%) | **2026-08 windows only** |
| `linePickQty` | 8 / 291 (2.7%) | **2026-08-04 only** |
| `lineOpenQty` | 4 / 291 (1.4%) | **2026-08-18 only** |
| `lineInvoiceQty` | 0 / 291 | nowhere |
| `lineQty`, `orderQty`, `salesOrderLineNo` | 291 / 291 | everywhere |

**Every window from 2019-03 through 2026-07 returns zero for all five.** Only the two most recent
windows carry values. Two readings fit that equally well and the API cannot separate them:

1. **Legitimate.** Open, unshipped and picked quantities are only non-zero while an order is still
   open. Everything older is closed, so zero is the true answer, and there is nothing to fix.
2. **The change is forward-only.** The report formulas are applied as rows are written, so history
   was never backfilled.

**We cannot tell which from the API**, because the fields that would settle it are themselves
empty: `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString` and `invoiceDateString` are
**empty on all 291 rows**, so no row carries any evidence of having shipped or been invoiced. This
is now the single most important thing to ask ColdLion (§5, item 1).

**Loader consequence:** treat `unshippedQty` / `linePickQty` / `lineOpenQty` as **live but
overwhelmingly zero**. Do not drop the columns, and do not compute an invoiced or shipped quantity
from this feed — nothing in it reports one. No negative values appeared anywhere in the 291 rows.

**Still not answered in words:** the exact allocation formula. We get the computed result instead;
if a number ever looks wrong we have no formula to check it against.

**Method:** 26 single-day `GET /EhpApi/orderHistory` calls, `companyCode=EDGEHOME`, roughly two per
year 2019-2026 plus the two most recent. Raw payloads are customer order data and are deliberately
**not** committed to this repo; the calls are reproducible from the dates above.

---

## 2. Fixed value lists in Swagger — register 2.9

**Asked:** publish the complete allowed values for fixed-choice parameters and fields.

**ColdLion:** *"Changed the doc."*

**Verified — partially done.** `prodHistory.stageCode` now carries a description:
`"Production stage code. Example: ISS, INTRAN, REC"`.

Two gaps remain, and they matter for exactly the reason we asked:

- It says **"Example"**, not "the allowed values". An example list does not tell us a fourth stage
  has not appeared, which was the whole point of the request.
- **No `enum` exists anywhere in the spec** — zero enums across all definitions and all request
  parameters. No other fixed-value field or parameter was documented.

This is an improvement, not a close. It belongs in our reply (§5).

---

## 3. Sales Order Line # and Prod Stage — register 2.10

**Asked:** expose the internal Sales Order Line # on `orderHistory` and the Prod Stage on
`prodHistory`.

**ColdLion:** *"Added SalesOrderLineNo and StageCode."*

**Verified — both are real and populated.**

| Field | Definition | Live result |
|---|---|---|
| `salesOrderLineNo` (int32) | `OrderHistory` | non-zero on 24 / 24 rows |
| `stageCode` (string) | `ProdHistory` | `ISS` on 20 / 20 rows of a `stageCode=ISS` request |

**Loader consequence — both workarounds can retire:**

- The derived sales-order line key `(salesOrderNo, itemNo, labelCode)` is replaced by the
  authoritative `(salesOrderNo, salesOrderLineNo)`, with `subItemNo` still identifying the
  prepack component. Keep the derived key alongside for one load and **reconcile the two**; a
  silent disagreement is the cheapest possible proof that one of them is wrong.
- Stamping the production stage from the request parameter is replaced by the returned
  `stageCode`. Keep asserting that the returned value equals the requested one — that assertion
  is now free and catches a mis-stamped loader immediately.

---

## 4. Does `orderHistory` have a hidden dimension? — register 2.4

**Asked:** whether the default `orderHistory` response is complete, the way `prodHistory` is not
without `stageCode`.

**ColdLion:** *"No hidden dimension. Please narrow down the date range to 1 day if the call is
slow."*

**Answer accepted.** `orderHistory` takes `companyCode`, `divisionCode`, `fromDate`, `toDate`,
`salesOrderNo` — verified against the live spec; there is no undocumented selector to miss.

**Operational note, new:** ColdLion is telling us the call is slow at the top of our window. The
7-day cap is a maximum, not a target — **use 1-day windows for the historical load.** That is
~2,800 calls for 2019-01-01 to today, at a couple of seconds each. Plan the load around that,
and keep the window size configurable rather than hardcoded.

---

## 5. ColdLion's question back to us

> *"Please send us any difference between the api and report, any states you want to add."*

This is now **ours to answer**, and it is the first time ColdLion has invited a list. Tracked as
register entry 2.11. What we owe them, from the evidence above and in
[`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md):

1. **Seven `orderHistory` fields are empty on every one of 291 rows spanning 2019-2026:**
   `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString`, `invoiceDateString`, `subDimCode`
   and `itemImage`. **The consequence is the important part: no row in the feed carries any
   evidence that an order shipped or was invoiced.** Ask whether that is intended — and if invoiced
   and shipped quantities exist on the report, how we are meant to obtain them.
2. **Are the open/unshipped quantities backfilled?** After the formula change, `unshippedQty`,
   `linePickQty`, `lineOpenQty` and `subQty` are populated **only on 2026-08 rows** and zero on
   every window from 2019 through 2026-07. Ask them to confirm whether older rows are genuinely
   zero because those orders are closed, or whether history was simply not recalculated. This
   decides whether our historical load can trust the value or must ignore it.
3. **`stageCode` is documented as an example, not an allowed-value list** — ask for the complete
   set, and for the same treatment on every other fixed-choice field and parameter (no `enum`
   appears anywhere in the spec today).
4. **The 7-day-cap refusal is malformed** — HTTP 400 on the wire with `"status": 500` /
   `"Internal Server Error"` in the body. Already reported as an observation; worth repeating
   here since it invites clients to retry a permanent input error forever.
5. **Negative quantities and costs** — `linePickQty`, `unshippedQty` and `subQty` reach -564.
   Confirm these are genuine reversals rather than a report artefact, since we will be loading
   them as-is. **None appeared in the 291-row re-measure** — they are in the production feed, not
   this one.
6. **Blank component merch groups on API-created SKUs** — their 2026-08-20 answer said some SKUs
   created through the API around the merch-group change still hold values in the *old* slot
   positions and "probably need to update with the new MG information". Ask whether they intend to
   re-map those at their end; if not, we need the old-slot rule in writing.

**No new states requested.** `ISS`, `INTRAN` and `REC` cover everything we have seen; we are
asking for the list to be authoritative, not longer.

**Done 2026-08-26:** the field-population measurement was re-run across 26 windows spanning
2019-2026 before drafting the list above. Items 1 and 2 come from it and would have been wrong if
written from the single-day sample.
