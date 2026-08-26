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

**Verified — the fields are alive.** They were 0% populated across 1,671 rows when we measured
them. On the 2026-08-04..05 window, of 24 `orderHistory` rows:

| Field | Populated |
|---|---|
| `unshippedQty` | 8 / 24 |
| `linePickQty` | 8 / 24 |
| `subQty` | 8 / 24 |
| `lineInvoiceQty` | 0 / 24 |
| `lineOpenQty` | 0 / 24 |

So the API now applies the report's own formulas to `unshippedQty` / `linePickQty` / `subQty`.
`lineInvoiceQty` and `lineOpenQty` remain zero, consistent with their 2026-08-18 answer that
those two are not carried at component level.

**Loader consequence:** use `unshippedQty` and `linePickQty` as the open/unshipped quantities and
stop treating them as dead fields. **Re-measure population before the historical load** — our
earlier 0% readings were taken before this change, so any conclusion drawn from them about older
windows must be re-taken, not inherited.

**Still not answered in words:** the exact allocation formula. We now get the computed result
instead, which is what we needed; if a number ever looks wrong we have no formula to check it
against.

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

1. **`lineInvoiceQty` and `lineOpenQty` are still always zero** on `orderHistory` (0 / 24 on the
   verification window, 0 across 1,671 earlier rows). Their 2026-08-18 answer was to use
   `unshippedQty` / `linePickQty` instead. Ask them to confirm this is intended and permanent, so
   we can drop the two columns rather than carry two dead fields forever.
2. **`stageCode` is documented as an example, not an allowed-value list** — ask for the complete
   set, and for the same treatment on every other fixed-choice field and parameter (no `enum`
   appears anywhere in the spec today).
3. **The 7-day-cap refusal is malformed** — HTTP 400 on the wire with `"status": 500` /
   `"Internal Server Error"` in the body. Already reported as an observation; worth repeating
   here since it invites clients to retry a permanent input error forever.
4. **Negative quantities and costs** — `linePickQty`, `unshippedQty` and `subQty` reach -564.
   Confirm these are genuine reversals rather than a report artefact, since we will be loading
   them as-is.
5. **Blank component merch groups on API-created SKUs** — their 2026-08-20 answer said some SKUs
   created through the API around the merch-group change still hold values in the *old* slot
   positions and "probably need to update with the new MG information". Ask whether they intend to
   re-map those at their end; if not, we need the old-slot rule in writing.

**No new states requested.** `ISS`, `INTRAN` and `REC` cover everything we have seen; we are
asking for the list to be authoritative, not longer.

**Before sending:** re-run the field-population measurement across several windows spanning
2019-2026, not just one recent day. A one-window sample is enough to prove a field is alive; it is
not enough to tell ColdLion a field is dead.
