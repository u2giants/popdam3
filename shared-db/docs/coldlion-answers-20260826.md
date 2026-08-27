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

> **⚠️ CORRECTED 2026-08-27 — this paragraph was wrong, and it was wrong in the email we sent.**
> It said `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString` and `invoiceDateString` are
> empty on every row, so nothing reports shipping or invoicing. On a **3,981-row** sweep those
> fields are **68-70% populated, in every year 2019-2026**. The 291-row sample was drawn from 26
> single days and simply landed on light ones. Only `subDimCode` and `itemImage` are genuinely
> always empty. See
> [`coldlion-negative-quantities-evidence-20260827.md`](coldlion-negative-quantities-evidence-20260827.md)
> §2 — **a correction is owed to ColdLion.**

Because invoicing *is* populated throughout, the "older orders are closed, so zero is correct"
reading is the more likely one — but it still needs their confirmation, since the historical load
depends on it.

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

> **⚠️ SUPERSEDED 2026-08-27.** `salesOrderLineNo` is **not** a safe primary key. On 19,008 rows
> it is 0 on 103 of them (51 in 2026), and `(salesOrderNo, salesOrderLineNo, subItemNo)` collides
> on 395 rows (2.08%), with 138 rows byte-identical across all 59 fields. No combination of the
> returned fields is unique. Keep the derived key until ColdLion tells us what makes a row unique.

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

1. ❌ **RETRACTED 2026-08-27 — sent in error.** This claimed seven fields are empty on every row and
   that nothing reports shipping or invoicing. **False:** on 3,981 rows the invoice and ship fields
   are 68-70% populated across every year. Only `subDimCode` and `itemImage` are always empty, and
   neither matters to us. **Correct this with ColdLion.**
2. **Are the open/unshipped quantities backfilled?** After the formula change, `unshippedQty`,
   `linePickQty`, `lineOpenQty` and `subQty` are populated **only on 2026-08 rows** and zero on
   every window from 2019 through 2026-07. Ask them to confirm whether older rows are genuinely
   zero because those orders are closed, or whether history was simply not recalculated. This
   decides whether our historical load can trust the value or must ignore it.
3. **`stageCode` is documented as an example, not an allowed-value list** — ask for the complete
   set, and for the same treatment on every other fixed-choice field and parameter (no `enum`
   appears anywhere in the spec today).
4. ❌ **RETRACTED 2026-08-27 — sent in error.** This claimed the 7-day-cap refusal is
   malformed (HTTP 400 with `"status": 500` in the body). **False:** re-tested live on both
   endpoints with 8-day and 31-day ranges, the response is a clean 400 in both the wire status
   and the body, with a clear message naming the rule. **Correct this with ColdLion.** See
   [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md).
5. **Negative quantities and costs** — `linePickQty`, `unshippedQty` and `subQty` reach -564.
   Confirm these are genuine reversals rather than a report artefact, since we will be loading
   them as-is. **None appeared in the 291-row re-measure** — they are in the production feed, not
   this one.
6. **Blank component merch groups on API-created SKUs** — their 2026-08-20 answer said some SKUs
   created through the API around the merch-group change still hold values in the *old* slot
   positions and "probably need to update with the new MG information". Ask whether they intend to
   re-map those at their end; if not, we need the old-slot rule in writing.

**Item 6 was withdrawn as ours to do (register §5). No new states requested.** `ISS`, `INTRAN` and `REC` cover everything we have seen; we are
asking for the list to be authoritative, not longer.

**Done 2026-08-26:** the field-population measurement was re-run across 26 windows spanning
2019-2026 before drafting the list above. Items 1 and 2 come from it and would have been wrong if
written from the single-day sample.

---

## 6. Draft reply to ColdLion — for Albert to send

**Status: SENT 2026-08-26 15:44, items 1-5. Awaiting reply.** Every number comes from the 26-window
re-measure in §1.

**Item 6 below was withdrawn before sending.** Albert: re-mapping those SKUs is our responsibility,
not ColdLion's, and AI attempts at deciding a product's merch group from its description have not
been good enough to use. It is now an owner ruling in the register §5 — **leave the paragraph here
for the record, but it was not sent.**

> **Subject:** API vs report — differences we see, and one question back
>
> Hi JamieLynn,
>
> Thank you — we have verified all three changes on our side. `SalesOrderLineNo` and `StageCode`
> are both coming through and populated, and the report formulas are visible on the quantity
> fields. That removes two workarounds we were relying on, so it is a real help.
>
> You asked for any differences between the API and the report. We sampled 26 individual days
> spread across 2019 to August 2026 — 291 order-history lines — and here is everything we found.
> We are not asking for any new stages; `ISS`, `INTRAN` and `REC` cover everything we see.
>
> **1. Nothing in `orderHistory` reports shipping or invoicing.** Seven fields are empty on all
> 291 lines, across every year: `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString`,
> `invoiceDateString`, `subDimCode` and `itemImage`. Is that intended? If invoiced and shipped
> quantities appear on the report, how should we be getting them from the API?
>
> **2. Were the new quantity formulas applied to history?** After your change, `unshippedQty`,
> `linePickQty`, `lineOpenQty` and `subQty` carry values only on our August 2026 samples. Every
> window from 2019 through July 2026 returns zero for all four. We cannot tell whether those older
> zeros are correct because the orders are closed, or whether history simply was not recalculated
> — and because of item 1 there is nothing in the row to tell us. We are loading the full history
> back to 2019-01-01, so this decides whether we can trust the value or must ignore it.
>
> **3. `stageCode` in Swagger says "Example", not the allowed values.** Thank you for adding the
> description. Could it state the complete allowed list instead? An example does not tell us a
> fourth stage has not been added, which is the case we cannot detect on our own. Same request for
> any other field or parameter with a fixed set of values — there are no declared value lists
> anywhere in the spec today.
>
> **4. The 7-day-window refusal returns two different error codes.** The response is HTTP 400 on
> the wire but the body says `"status": 500` and `"Internal Server Error"`. A client that reads the
> body will treat a permanent input error as a temporary server fault and retry it forever. Not
> urgent for us — we know the rule — but worth correcting.
>
> **5. Negative quantities on production history.** `linePickQty`, `unshippedQty` and `subQty` go
> as low as -564 there. Please confirm those are genuine reversals rather than a reporting
> artefact; we will be loading them as they come.
>
> **6. [WITHDRAWN — NOT SENT] The SKUs affected by the merch-group change.** From your note on 20 August: some SKUs
> created through the API around that time still hold their values in the old merch-group
> positions, and you thought they probably need updating to the new ones. Do you plan to re-map
> those at your end? If not, we will read the old positions instead — we would just like that
> confirmed in writing so we do not treat a blank as missing data.
>
> **One operational note:** we have moved to one-day windows for the historical pull, as you
> suggested. That is roughly 2,800 calls to cover 2019 to date. If a larger window would be easier
> on your side at some hour of the day, tell us and we will schedule around it.
>
> Thanks again,
> Albert
