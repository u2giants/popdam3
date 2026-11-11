---
summary: ColdLion question register part 2 of 2: 4. ANSWERED — do not re-ask / 5. Not questions — owner rulings that 
kind: living
status: current
read-when: about to ask ColdLion something or relying on a ColdLion answer in these sections
---

# ColdLion — every open question, in one place — part 2 of 2

> Moved **verbatim** from [`coldlion-open-questions.md`](coldlion-open-questions.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

## 4. ANSWERED — do not re-ask

| Question | Answer | Who / when |
|---|---|---|
| **Issue 3 follow-up - `/prodHistory` returns only part of a week unless `stageCode` is given** | **Not a defect - documented. `stageCode` carries `default: ISS` in the Swagger parameter block.** We reported it as silent truncation on 2026-08-26 and again in draft on 2026-09-03; both times we had read the response schema and not the parameter block. **Withdrawn with an apology.** The cost is real but it is ours to work around: on one measured week (EDGEHOME, 2026-04-20 to 2026-04-26) the default returned 85 of 881 records - ISS 85, INTRAN 0, REC 796. **Loader consequence: always iterate the three stages, or ask ColdLion to change the default (open, 2.28).** | ColdLion, 2026-09-03 - spec verified same day |
| **`active` filters return only active rows unless `active` is given** | **Not a defect - documented. `active` carries `default: Y` on `/customers`, `/divisions`, `/merchGroupDetails`, `/salespersons`, `/seasons` and `/vendors`.** Reported as a fault, withdrawn 2026-09-03. Same root cause as the row above: response schemas read, parameter blocks not. **Loader consequence: pass `active` explicitly on all six endpoints, or accept the active-only subset.** | ColdLion, 2026-09-03 - spec verified same day |
| **Issue 8 follow-up - what is the real page-size cap?** | **2,000 on most endpoints; 200 on `/prodHistory` and `/orderHistory`.** ColdLion stated it and we verified live: `size=2000` honoured on `/items`, `/inventory` and `/customers`, `size=2001` and `size=5000` silently clamped to 2,000, and `/prodHistory` clamped to 200. **This supersedes the earlier register entry that recorded a flat 200-row cap** - that measurement was taken on `/orderHistory`, one of the two capped endpoints, and generalised wrongly. **Loader consequence: page size 2,000 everywhere except the two history endpoints; still always loop on the envelope's `last`/`totalPages`.** | ColdLion, 2026-09-03 - verified live |
| **Is `itemPkey` missing from `/items` a bug?** | **No - by design, and ColdLion gave us the intended workflow: query item detail by `companyCode` + `divisionCode` + `itemNo`.** Verified over a 500-item random sample (337 resolved, 163 returned nothing). **`itemPkey` is not absent from the API, only from `/items`** - `/inventory` populates it on every row (500 of 500) and `/itemDetails?itemPkey=` resolves. **Loader consequence: use the three-part key for item detail; keep `itemPkey` only as the inventory-row fallback described in 2.25.** | JamieLynn, 2026-09-03 - verified live |
| **Why do some items return no detail record?** | **Because some items genuinely have none - JamieLynn told us so, and the evidence backs her.** Matched 200 + 200 subsample split by whether the item carries inventory rows: items **with** inventory returned a detail record 200 of 200 times; items **without** inventory returned one 113 of 200 times. Every miss fell among items with no stock. **Loader consequence: treat a missing item-detail record as an expected state, not an ingestion error.** **Closed from our side.** | JamieLynn, 2026-09-03 - verified live |
| **Issue 7 — prepack SKU mapping: how one order line becomes many rows** | **The most important correction to our model of this feed — it closed a fault we reported that was never a fault.** ColdLion: the actual SKU is in `subItemNo` + `subColorCode` + `subLabelCode`; `lineQty`/`lineInvoiceQty` are **parent-line totals**; per-SKU quantity is `(lineQty / prepackQty) * quantity`, and they have now returned it precomputed as **`orderQty`** and **`invoiceQty`** — *"use orderQty and invoiceQty, actual SKU when it's not blank."* **Verified live on 1,823 rows / 409 orders: the formula reproduces `orderQty` and `invoiceQty` on 734 of 751 prepack rows (the 17 exceptions are one order's fractional rounding), and on non-prepack rows `orderQty` = `lineQty` on 100%.** **Loader consequence: read only `orderQty`/`invoiceQty`; key the SKU off the sub-item fields; never sum `lineQty`.** Full model: [`business-rules-erp-data.md` §10](business-rules-erp-data.md). | JamieLynn / tech team, 2026-09-01 · verified live |
| **Issue 7 — `salesOrderLineNo` = 0, and the "invoiced quantities are multiplied" report** | **Both explained by the prepack explosion. Line 0 = a prepack component row (12 of 13 line-0 rows in the sample carry a `prePackCode`); the 49× multiplication was us summing parent totals.** ColdLion also removed the phantom zero-quantity rows — order <order redacted> now returns 7 rows, not 14. **We owe ColdLion a correction on the 2026-08-31 multiplication claim.** | JamieLynn / tech team, 2026-09-01 · verified live |
| **Issue 6 — which document did this order-history row come from?** | **No document-type marker, but the problem is solved anyway.** ColdLion: *not sure the document type*, and they added **`pickTicketNoString`**. The per-stage duplicate rows are gone (order <order redacted>: 6 rows → 3). Two new cautions: these `...NoString` fields can be **comma-separated lists**, and an invoice number can be present with `invoiceQty` = 0. | JamieLynn, 2026-09-01 · verified live |
| **Issue 3 — can the merchandise group be read straight off the order-history response?** | **Yes.** ColdLion: *"you could use the merch group from response."* Confirms the inline `merchGroupNNDesc` fields are the intended way to read a code's meaning, and that no `/merchGroupDetails` round-trip is needed. **JamieLynn later confirmed the underlying business scope on 2026-09-10: division and `mgCategory`, with MG01, constrain MG02/MG03.** Whether every inline description is guaranteed to match the category-scoped detail lookup remains the non-blocking remainder in 2.13/2.35. | JamieLynn, 2026-09-01 and 2026-09-10 |
| **Issue 9 — which of the four item lifecycle flags means "stop selling"?** | **`active` (Y/N) is the only one in use — and ColdLion volunteered that it is not well maintained: "even that one we're not actively maintaining like we should."** `itemStatus`, `itemAvailable` and `itemDiscontinued` are **not in use**; their values are residue. **Loader consequence: drop the other three entirely; treat `active = N` as a trustworthy suppression signal but never treat "not N" as proof an item is sellable** — see 2.24. | JamieLynn, 2026-09-01 |
| **Issue 8 follow-up — the page-size cap** | ⚠️ **SUPERSEDED 2026-09-03 — the 200-row cap applies only to `/prodHistory` and `/orderHistory`; everywhere else it is 2,000. See the 2026-09-03 page-size row above.** Original text follows. **Undocumented cap of 200 rows per page.** A request with `size=5000` returns 200 rows and no error, silently. Found the hard way: a scan reported 1,375 rows where the true figure was 1,823. **Loader consequence: always loop on the envelope's `last`/`totalPages`; never trust a single large-`size` request.** | our own live testing, 2026-09-01 |
| **Issue 3 — put maintenance-table descriptions inline instead of a lookup API (2.16)** | **Done exactly as recommended.** ColdLion: *"Added label desc and warehouse desc to order, prod history."* **Verified live 2026-08-31:** `orderHistory` and `prodHistory` rows now carry `labelDesc` alongside `labelCode` and `warehouseDesc` alongside `warehouseCode`. `colorCode`/`dimCode` were not touched, which matches what we asked for — we told them not to bother. **Loader consequence: the description columns can be ingested directly; no second lookup call is needed for label or warehouse.** | JamieLynn, 2026-08-31 · verified live |
| **Issue 3 — merchandise-group code descriptions (`merchGroup01`–`06`, no stated meaning in spec)** | **ColdLion went further than asked.** *"Added merchgroup 01 to 14 desc to items, itemdetails."* **Verified live 2026-08-31 on `/items`:** `merchGroup01Desc` through `merchGroup14Desc` are all present alongside every `merchGroup01`–`14` code — covering the two "legacy" slots 07–14 too, not just the live 01–06 hierarchy. (Could not independently re-verify the `itemDetails` claim: a live `/itemDetails` query by `itemNo`+`divisionCode` returned zero rows in this session — likely a parameter mismatch on our side, not evidence the fields are missing there.) **Loader consequence: a code's description can now be read directly off the item, without a separate `/merchGroupHeaders`/`/merchGroupDetails` call or manual `mgCategory` scoping logic.** Whether the inline `Desc` already resolves the `mgCategory`-scoping question for slots 01–03 is not yet confirmed — carried forward in 2.13. | JamieLynn, 2026-08-31 · verified live on `/items` |
| **Issue 8 — `orderHistory` returns a bare array while other endpoints return a paged envelope** | **Fixed, and ColdLion paged `prodHistory` too.** ColdLion: *"Added paging to order, prod history."* **Verified live 2026-08-31:** both `/orderHistory` and `/prodHistory` now return the standard `{content, totalElements, totalPages, number, first, last}` envelope, and `page`/`size` are genuinely honored — a `page=1` request returned a different set of rows with `number=1`, `first=false`. **Loader consequence: the bare-array pull loop (and the 2026-08-27 fault it caused, see 2.15) can retire. Any code still reading these two endpoints as a plain array should be updated to read `.content`, and can now ask `totalElements` for a window's row count instead of pulling everything to find out.** The 7-day window cap on both endpoints is unchanged and still applies. | JamieLynn, 2026-08-31 · verified live |
| **Issue 3 — what values may `mgTypeCode` take?** | **01 through 14, and the documentation now says so.** JamieLynn: *"MgTypeCode: Updated the documentation to reflect values from 01 to 14."* This confirms what we had measured: there are 14 merchandise-group slots, of which **01–06 are the live hierarchy** (type, sub-type, material/embellishment, size, licensor, property) and 07–14 are legacy positions kept for pre-renumbering rows. **Loader consequence: none — it confirms existing behaviour.** | JamieLynn, 2026-08-28 |
| **Issue 3 — what values may `active` take?** | **`Y` or `N`.** Now documented. **Loader consequence:** the merchandise-group lifecycle flag is a two-value flag; do not treat blank as a third state without checking. | JamieLynn, 2026-08-28 |
| **Issue 3 — where is the authoritative list of division codes?** | **ColdLion built us an endpoint.** JamieLynn: *"Company Edgehome contains 4 division codes. I have created the /divisions API to get them."* **Verified live the same day: `/divisions` returns exactly 4 — `CW001` POP Creations (Licensed Products), `EH001` Edge Home, `EP001` Edgeucational Publishing, `SP001` Spruce (Licensed Products), all `active = Y`.** It also carries each division's address, country, general-ledger code and DUNS number. **Loader consequence: stop hard-coding division codes.** `EP001` (Edgeucational Publishing) is active in the ERP but **out of scope permanently** — owner ruling, Albert 2026-08-28. Filter it at ingestion; its absence from our renumbering dates is not a gap. See §5. | JamieLynn, 2026-08-28 · verified live |
| **Issue 3 — what values may the size code take?** | **One: `NS`. POP does not sell apparel and does not use the field.** JamieLynn: *"SizeCode: NS is currently the only available option in the system (we don't make apparel, we don't use sizeCode)."* **Verified live on all 19,362 items: `sizeRangeCode` is `NS` on 19,346 and blank on 16 — no other value exists.** Two cautions. First, **the field on `/items` is named `sizeRangeCode`, not `sizeCode`** — there is no `sizeCode` field on the item response. Second, this says nothing about **merchandise group 04**, which is the real product-size axis and is fully populated; do not conflate the two. **Loader consequence: `sizeRangeCode` is dead weight — ignore it. Product size comes from merchandise group 04.** | JamieLynn, 2026-08-28 · verified live |
| **Issue 3 — where do the merchandise-group codes come from?** | *"Merch Groups (01–06): These can be retrieved via /merchGroupHeaders and /merchGroupDetails."* Confirms the two endpoints we already use. JamieLynn's 2026-09-10 answer now confirms the business rule behind the lookup: a code's meaning is scoped by division and `mgCategory`, with MG01 constraining MG02/MG03. A loader must include `mgCategory` when identifying detail rows; the separate question of whether inline descriptions always agree with the lookup remains in 2.13/2.35. | JamieLynn, 2026-08-28 and 2026-09-10 |
| **`/merchGroupDetails` identity and MG01–MG03 hierarchy scope** | **`mgCategory` must be included.** Rows with the same company, division, type and code but different categories are separate ColdLion records; use `(companyCode, divisionCode, mgTypeCode, mgCategory, mgCode)`. MG01–MG03 are the standards implemented in early 2025; code values may recur across categories but should be unique within division/category. Division and category, with MG01, constrain the valid MG02 and MG03 values. This clears the identity blocker and does not authorize collapsing category-specific rows. The exact code-reuse and placeholder-use details remain in 2.35. | JamieLynn, 2026-09-10 |
| **Issue 5 — negative quantities: are they real?** | **Yes, both patterns are real and expected.** Seven 2020 lines, one retailer customer: *"I remember those orders from [retailer] - believe what happened with these was on the way in customer ordered in cases and stock was in pieces, so we had to manually explode into the pieces and adjust the settings to send the EDI back out the right way. This looks right."* Five lines on one order, a second customer: *"we were shipping contractual samples and warehouse turned up more units than expected. Your team wanted to ship everything, so we added them to pick. Yes this is something I would expect if an order was changed later or something manual had to be done at a stage other than initial order entry."* **Loader consequence: do not reject or clamp negative quantities.** They record a manual correction after initial order entry. Load them as-is | JamieLynn, 2026-08-28 |
| **Issue 2 — do the new quantity formulas mean anything on historical rows?** | **"If it has an invoice number, unless we shipped short or partial, Open / Unshipped would drop to zero."** So a zero open/unshipped quantity on an invoiced row is a **true** zero, not an un-backfilled history. **Loader consequence: treat zero open/unshipped as real when an invoice number is present — and we CAN apply that test.** Verified 2026-08-28 on 10,397 rows spanning 2019-2026: open and unshipped are zero on effectively every row from 2019 through 2025, and those years carry an invoice number on 72%-99% of rows; the only year with live open/unshipped values is 2026, the orders still in flight. The historical zeros are true zeros. **Fully closed** | JamieLynn, 2026-08-28 |
| **Issue 6 — the feed has no unique key; the same line appears more than once** | **Answered: the feed's grain is finer than the sales-order line, by design.** 6a (order <order redacted>, same item twice at two different prices — synthetic illustration: 40.00 and 38.00): *"the pricing changed at either pick or invoice level, so it split the lines. The [higher price] is from the SO, the [lower price] is from the invoice. They're technically both real."* 6b (order <order redacted>, line 6 holds two different items): *"Pick ticket and invoice would get their own line numbers as well. The line number doesn't carry forward unless all of the items are shipping on the same pick - on Sales Order [document A] was line 6, but we were short this item. On pick & invoice [document B] is line 6."* 6c (order <order redacted>): *"This is tough because a change at any stage can cause a line split. This report is assembling data from Sales Order, Prepack Detail, Pick Ticket and Invoice."* ⚠️ **Loader consequence, and it is the big one: `orderHistory` is not a sales-order table.** It is a union of four documents - Sales Order, Prepack Detail, Pick Ticket and Invoice - and `salesOrderLineNo` is **re-assigned** at pick and invoice, so it is not stable across the union. `(salesOrderNo, salesOrderLineNo)` is therefore **not** a unique key and never will be. Rows that look like duplicates are the same line seen at different stages, and **both prices are real**. Do not de-duplicate them, and do not sum them - a naive sum double-counts. The landing table must keep every row and carry a stage/source marker, and the feed still does not tell us which of the four documents a row came from. **That is the next question to ask** | JamieLynn, 2026-08-28 |
| Production-order line number to separate real lines from duplicates | **`prodLineSeq` added**; duplicated prod reference number was the cause; ColdLion now selects the maximum `lastProdDate` | ColdLion, 2026-08-17 · verified |
| Rate limits / paging for a bulk pull | **7-day window cap, inclusive**; ~2s per window from their office | ColdLion, 2026-08-17 · verified |
| Is `subUpc` ever populated? | Rarely — UPCs are not usually assigned to prepack components; one Walmart assortment. **Keep the column** | ColdLion, 2026-08-17 · rules §3 |
| What does a `COS` production PO mean? | **Sample production** — extra pieces for the licensor (contractual samples) or internal use (DAVID samples) | Albert, 2026-08-17 · rules §1 |
| Why are `ppkMerchGroup*` blank so often? | `merchGroup*` = assortment SKU, `ppkMerchGroup*` = component SKU. The **assortment** groups are the blank ones; a master is generic | JamieLynn, 2026-08-18 · verified, rules §6 |
| Are `lineInvoiceQty`/`lineOpenQty` populated? | Not carried at component level; use `unshippedQty` / `linePickQty` | JamieLynn, 2026-08-18 · verified, rules §7 |
| What are the valid `stageCode` values? | **Exactly three: `ISS`, `INTRAN`, `REC`.** All verified to carry rows | JamieLynn, 2026-08-19 · verified, rules §4 |
| The 10 recent unlinked CUST003 lines | **CUST003 is Amazon.** Amazon orders are stock for their warehouse, not presold, so they have no customer PO. Verified 10 of 10 unlinked | JamieLynn, 2026-08-19 · verified, rules §8 |
| Why do older lines have `salesOrderNo = 0`? | Hard-linking POs to production orders began ~**2022–2023**; `custPONumber` was manual before, and drops off entirely on `INTRAN`/`REC` | JamieLynn, 2026-08-18 · verified, rules §4–5 |
| **How far back does the history go?** | **2019-01-01.** History starts there; that is the load boundary. Albert has stated this repeatedly and it was already locked as D9 of `plan_coldlion-landing-phases-2-6.md` — the register simply failed to record it, and listed it as open. **Not a ColdLion question and never was.** | **Albert, restated 2026-08-20** |
| **Admit the 66 unmatched ColdLion property codes?** | **YES — admit all 66.** ColdLion's merchandise-group `active` flag now supplies normal lifecycle status. DB Data Admin may still record an explicit higher-authority ruling; signed entitlement schedules also take precedence. See §5 and the licensing Master Data business rule. | **Albert, 2026-08-20; lifecycle answer superseded 2026-08-24** |
| **Is there a field identifying a row's production stage?** | **Yes — "Prod Stage".** But it is **not exposed in the API**: no field containing "stage" exists in any definition of the live spec, `ProdHistory` included. Keep stamping it from the request | JamieLynn, 2026-08-20 · spec verified same day |
| **How do we tell two sales-order lines apart?** | **`(salesOrderNo, itemNo, labelCode)` is the line; add `subItemNo` for the component.** Resolved by her prepack answer: **`linePrice` is per-component, not per-line**, so rows that looked like conflicting duplicate lines are one line's components priced individually. Verified on 1,671 rows across 8 windows 2019-2026: 196 multi-row groups, **no field other than `linePrice` varies within any of them**. ColdLion also has a `Line #` on Sales Order, but it is **not in the API** | JamieLynn 2026-08-20 + our verification |
| **Why are component merch groups blank on some rows?** | **A merch-group POSITION CHANGE, not old data.** JamieLynn 2026-08-20, per sample (synthetic values, real shape): order 90005 — *"The merch group positions changed for Generic – I can see the data is in the old fields."* Orders 90006 and 90007 — *"these skus were created through the API around the time of the Merch Group change with the old MGs, but yes the fields are blank, probably need to update with the new MG information."* **So the values still exist in the OLD slot positions on affected rows, and some API-created SKUs were never re-mapped.** This explains why blanks start in 2024 and rise (0% across 624 rows 2019-2023, 11.7% in 2024, 16.1% in 2025) — the opposite of "older stuff", which was her first guess. ⚠️ **Loader consequence: a blank component merch group is NOT missing data.** Do not treat it as absent, and do not backfill it from the master item — check the old slot positions first, and expect a set of API-created SKUs that genuinely need re-mapping at ColdLion's end | JamieLynn, 2026-08-20 |
| **Does ColdLion have an active/inactive flag on merch groups?** | **Yes, and it is live and functioning.** `active` is returned on `/merchGroupDetails` merchandise-group rows. The 2026-08-20 sample found it 100% populated but observed only `Y`; that sampling caveat is superseded by Albert's 2026-08-24 confirmation that the API now exposes functioning active/inactive values. Merged PR #1432 stores the value as typed `source_active` on `plm.erp_licensor` / `plm.erp_property` and synchronizes lifecycle status while abstaining on conflicts, ambiguity, signed entitlement schedules, and explicit higher-authority rulings. | ColdLion verified 2026-08-20; Albert confirmed functioning lifecycle values 2026-08-24 |
| **Where do invoiced and open quantity come from?** | **"We use the same formulas as report now."** The API now applies the report's own formulas, but **only recent rows carry values**: re-measured over 26 windows / 291 rows / 2019-2026, `unshippedQty` and `subQty` are 4.1% populated, `linePickQty` 2.7%, `lineOpenQty` 1.4% — **all of it in 2026-08**, zero everywhere from 2019 through 2026-07. `lineInvoiceQty` is zero on all 291. **The exact formula was never given; we get the computed result instead.** ⚠️ Do not compute an invoiced or shipped quantity from this feed — seven fields including `shipQty` and `invoiceDateString` are empty on every row | JamieLynn, 2026-08-26 · verified same day |
| **Can fixed value-lists go into Swagger?** | **"Changed the doc." — partially.** `prodHistory.stageCode` now reads *"Production stage code. Example: ISS, INTRAN, REC"*. But it says **Example**, not allowed values, and **no `enum` exists anywhere in the spec**, on any field or parameter. **Not closed** — reopened in 2.11 | JamieLynn, 2026-08-26 · spec verified same day |
| **Expose `Line #` and `Prod Stage` in the API** | **Done: "Added SalesOrderLineNo and StageCode."** `OrderHistory.salesOrderLineNo` (int32) non-zero on 24/24 rows; `ProdHistory.stageCode` on 20/20. **Both workarounds retire** — **⚠️ the line-key half of this is SUPERSEDED 2026-08-28 — see the issue 6 row above: the line number is re-assigned at pick and invoice, so `(salesOrderNo, salesOrderLineNo)` is not unique** and the returned stage instead of the stamped one. Reconcile against the old derived key for one load | JamieLynn, 2026-08-26 · verified same day |
| **Does `orderHistory` have a hidden dimension?** | **"No hidden dimension."** Confirmed against the live spec: `companyCode`, `divisionCode`, `fromDate`, `toDate`, `salesOrderNo` and nothing else. They added: **"narrow down the date range to 1 day if the call is slow"** — so plan the historical load on 1-day windows (~2,800 calls), not the 7-day maximum | JamieLynn, 2026-08-26 · verified same day |
| Is `1900-01-01` the empty-date marker? | Yes | Albert, 2026-08-14 |
| Division/company code meanings | Answered in two rounds | Uma, 2026-08-13 and 2026-08-17 · `division-code-*.md` |
| Was `/vendors` the wrong table? | Yes — ColdLion swapped it to the factory table; 97 rows, all active | ColdLion, 2026-07-22 |

## 5. Not questions — owner rulings that keep getting re-litigated

> ### ⛔ SETTLED — `/vendors` field dispositions are RULED. Do not re-open them.
>
> **All 29 `/vendors` fields were ruled by the owner on 2026-08-19** in
> [`coldlion-field-decisions-20260819.csv`](coldlion-field-decisions-20260819.csv):
> **10 ingest, 19 DECLINED.** The ruling was **re-verified against the live feed on
> 2026-09-03** — the live field-name set is **identical** to the CSV's 29 rows, so the
> August ruling applies in full and nothing about it is stale.
>
> **DECLINED (ruled out — not pending, not undisposed):** `address1`, `address2`,
> `address3`, `zipCode`, `state`, `email`, `phoneNo`, `faxNo`, `createdUser`, `modUser`,
> `udf01`–`udf04`, `udfDate01`, `udfDate02`, `payTermCode`, `glCode`, `separateCheck`.
> Vendor **addresses, zip, state, email and phone are DECLINED**. Never describe any of
> these as pending, undisposed, or an open owner decision, and never re-ask Albert for them.
>
> **`/seasons` is now ALSO ruled** — see the next block. Issues #2180 and #2081 were written
> as though no `/vendors` ruling existed; they are wrong on that point, and #2180's
> owner-decision blocker is fully resolved.

> ### ⛔ SETTLED — `/seasons` field dispositions are RULED (2026-09-03). Do not re-open them.
>
> **All eight currently-unstored `/seasons` fields are DECLINED** by owner ruling on
> **2026-09-03**: `seasonDesc`, `startDate`, `endDate`, `shipStartDate`, `shipEndDate`,
> `active`, `createdUser`, `modUser`. **Nothing new is to be added to `coldlion.season`.**
> The five stored columns — `company_code`, `division_code`, `season_code`, `created_time`,
> `mod_time` — stand as the **complete approved projection**.
>
> Evidence, from a full live read of all 21 of 21 rows on 2026-09-03: `seasonDesc` merely
> repeats `seasonCode` on every row except `NONE`, whose description is empty; all four date
> fields are the `1900-01-01` empty-date sentinel on every row; `active` carries the same
> single value on every row; and `createdUser` / `modUser` are ColdLion record-audit stamps
> naming one internal staff login, identical to each other on every row — personal data about
> a named individual, which we do not land.
>
> Never describe any of these eight as pending, undisposed, or an open owner decision, and
> never re-ask Albert for them. **Revisit only if ColdLion begins populating them.**

> ### ⛔ VENDOR DEFECT — the unfiltered `/seasons` call DROPS 13 of the 21 records. Never use it.
>
> **The other divisions' records are MISSING, not mislabelled.** A company-wide (unfiltered)
> `/seasons` query returns the **CW001 record in place of every other division's record
> entirely** — division code, description, `createdUser`, `createdTime`, `modUser` and
> `modTime` all come from the CW001 row. **All 13 non-CW001 records (4 SP001, 1 EP001,
> 8 EH001) are ABSENT from the response.**
>
> The row *count* is correct — 8 + 4 + 1 + 8 = 21 — but the row *content* is duplicated from
> CW001: each affected season code is repeated three or four times, and each repetition is
> byte-identical. It reads as a lookup keyed on `seasonCode` alone, ignoring division.
>
> **There is no workaround.** A loader author who reads "mislabelled" might think the division
> code can be re-derived from elsewhere and the response otherwise trusted. It cannot: the
> other divisions' data is simply not in the response. **Any `/seasons` loader MUST query per
> division and MUST NEVER use the unfiltered call.**
>
> The failure is silent: nothing in the response envelope signals it, the response looks
> complete and well-formed, and paging is not involved (single page, 21 of 21, page size 50).
>
> Confirmed against the live feed on **2026-09-03**, from a full 21-of-21 read re-verified
> three times, with a positive control that fires — so the check can fail and is trustworthy.
>
> **This is a `/seasons` fault, not how their API is designed to behave.** For contrast,
> unfiltered `/merchGroupHeaders?companyCode=EDGEHOME` returns 37 rows correctly spanning all
> four division codes.

- **Two of our own merchandise-group beliefs were wrong, corrected 2026-08-28.** (a) Slots 07–14
  were recorded here and in Business Rules as "legacy positions left by the renumbering". They are
  not: 07–10 are named axes (Style Guide, Art Source, Artist, Demographic) carrying real data, and
  only 11–14 are empty. (b) Slot 03 was recorded as "material or embellishment"; ColdLion calls it
  Sub-Sub-Type. (c) Slot meanings are **not** division-blind — EH001 reads 05/06/07 as Big Theme /
  Little Theme / Art Type. **Never read slot 05 as "licensor" without checking the division's
  headers.** Verified live against `/merchGroupHeaders`.

- **Edgeucational Publishing (`EP001`) is out of scope, permanently (Albert, 2026-08-28).** The
  new `/divisions` endpoint shows four active divisions. Only three are ours: POP Creations
  (Licensed Products), Edge Home, and Spruce (Licensed Products). *"Ignore Edgeucational
  Publishing EP001. That will never be a part of this system."* Filter `EP001` at the point of
  ingestion so it does not travel downstream and get filtered over and over. Its absence from our
  merchandise-group renumbering dates is **not** a gap and must not be raised as one again.

- **The 66 unmatched ColdLion property codes ARE admitted (Albert, 2026-08-20).** The original
  decision assumed ColdLion had no lifecycle flag and therefore required us to own inactivity.
  **That premise was superseded on 2026-08-24:** Albert confirmed that merchandise groups now have
  functioning active/inactive flags exposed by the API. ColdLion therefore normally owns Licensor
  and Property lifecycle status. Signed entitlement schedules and explicit owner rulings remain
  higher authority, and disagreement or ambiguity must abstain rather than overwrite. This is the
  canonical rule in `docs/business-rules/licensing-master-data.md` and is implemented by PR #1432.
- **Re-mapping the API-created SKUs to the new merch-group codes is OURS, not ColdLion's.**
  Albert, 2026-08-26, withdrawing item 6 from the reply before it was sent: *"that would be our
  responsibility to do and I can't seem to get AI to do a good enough job understanding a product
  and how it should map to the new MG codes."* Two consequences, and neither is optional:
  1. **Do not ask ColdLion to fix these rows.** They will not, and it is not their job.
  2. **An AI-generated merch-group mapping is not acceptable output on its own.** It has been
     attempted and it was not good enough. Anything proposed here is a **draft for Albert to
     review**, never a load. The blocker is understanding what a product actually is from its
     description — see [`item-description-mg-classification-process.md`](item-description-mg-classification-process.md)
     and the `item-description-taxonomy` skill, which exist for exactly this problem.

  Until the re-map happens, **the old merch-group slot positions remain the source for affected
  rows** (ColdLion, 2026-08-20). A blank component merch group is not missing data.

- **Every problem we report to ColdLion carries named examples, and issue numbers never change.**
  Albert, 2026-08-27: *"you can't just say you found a problem, YOU MUST GIVE ACTUAL EXAMPLES."*
  A count is not a report. Each issue gets a sales order number, customer, date, PO and item, and
  keeps the number it was first given so a thread can be followed across emails — the duplicate-row
  and line-number-zero problems are **issues 6 and 7**, continuing the 2026-08-26 list of 1-5.

- **Never send an outward claim measured on a thin sample.** Albert, 2026-08-27: *"if so, we have
  to increase the sample size."* Two of the five items emailed to ColdLion on 2026-08-26 were
  false, and a third quoted an unreproducible figure from our own notes. All three came from a
  291-row sample drawn from 26 single days. Size a population sample by **rows, not calls or
  dates**; use the widest window the API allows; and reproduce any figure quoted from our own
  documents before repeating it to a vendor. See
  `coldlion-19k-row-resample-20260827.md` *(withdrawn 2026-09-01 — deleted as customer transaction evidence)*.

- **History depth is 2019-01-01.** Settled repeatedly by Albert, most recently 2026-08-20. It is D9
  of the landing plan. Stop listing it as an open question.

- **Do NOT ask Albert to rotate the ColdLion API key.** He does not administer ColdLion. Ruling
  2026-08-09; the exposure remains a recorded fact. See `coldlion-erp-api-reference.md`.
- **Scope of the historical load:** capture everything, work backward, stop after twelve months of
  silence. Albert, 2026-08-16, on issue #1031 — **with the correction that windows are now 7 days,
  not one month.**
