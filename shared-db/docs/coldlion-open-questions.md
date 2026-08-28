# ColdLion — every open question, in one place

**Why this exists:** ColdLion questions were scattered across seven documents, a handoff, a
take-over note and two GitHub issues. Sessions were re-asking answered questions and missing live
ones. This is the single register. **Last reviewed: 2026-08-28 (third pass — ColdLion's issue-3 reply).**

**Who answers these:** ColdLion is a third-party ERP Albert does **not** administer. Questions go to
**JamieLynn** (API/data) or **Uma** (division/company codes), **from Albert** — never sent by an AI
session. Some questions are for **Albert** as owner, not for ColdLion; those are marked.

> ### ⛔ Read §4 (ANSWERED) BEFORE drafting any question.
> On 2026-08-19 a session measured the two always-zero quantity fields for an afternoon and
> drafted a question about them. **That question was answered on 2026-08-18 and was already in
> §4.** The session had read four ColdLion documents; none of them pointed here. Those documents
> now carry a banner, and [`coldlion.md`](coldlion.md) is the front door. Re-asking an answered
> question wastes ColdLion's goodwill, which is a finite resource we depend on.

**Rules for this file:**
- When something is answered, **move it to §4 with the answer and the date** — do not delete it, or
  it gets re-asked.
- Anything marked **BLOCKING** stops a specific piece of work. Say which.
- Cite where the evidence lives. A question with no evidence attached wastes their time.
- **Keep the "Sent / awaiting reply since" column current.** It is the difference between a list of
  questions and a chase list. A question Albert has never sent is not "waiting on ColdLion" — say so.
  Never invent a send date; write what is actually known.
- **A question answered unsatisfactorily is not closed.** Move the original to §4 with its answer,
  and open a NEW numbered follow-up in §2 citing both. Entry 2.8 is the worked example: the fields
  ColdLion redirected us to measured 0% populated, exactly like the two we asked about.

---

## 1. BLOCKING — none

> **Cleared 2026-08-19.** The last blocker (the authoritative `stageCode` list) was answered:
> **"all The stages are: ISS, INTRAN, REC."** — ColdLion (JamieLynn). All three verified to carry
> real rows. **Nothing now blocks the historical load.**

The one remaining stage-related nicety, not blocking:

### 1.1 ✅ CLOSED 2026-08-26 — `stageCode` is now IN the API

Answered 2026-08-20 (*"Yes this is called Prod Stage"*), and on 2026-08-26 ColdLion added it:
*"Added SalesOrderLineNo and StageCode."* Verified the same day — `ProdHistory.stageCode` exists
in the live spec and returned `ISS` on 20 of 20 rows of a `stageCode=ISS` request.

**Stop stamping the stage from the request.** Read the returned `stageCode`, and assert it equals
the requested one — that check is now free and catches a mis-stamped loader immediately.

**Evidence:** [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §3;
[`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).

## 2. Open, not blocking — these change how data is modelled or reported

| # | Question | For | Evidence | Sent / awaiting reply since |
|---|---|---|---|---|
| 2.14 | **NOT YET SENT — which of the four documents did this row come from? (goes out as the issue 6 follow-up)** Their 2026-08-28 answer to issue 6 established that `orderHistory` assembles **Sales Order, Prepack Detail, Pick Ticket and Invoice**, and that the line number is re-assigned at pick and at invoice. The feed does not say which document a row came from, so we cannot tell a sales-order row from an invoice row, cannot pick one row per line, and cannot sum anything safely. **This is the single field that would make the feed usable.** Ask for a document-type or source-stage marker on every `orderHistory` row, and — if it exists — the pick-ticket and invoice numbers alongside it. | JamieLynn | [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md), [`business-rules/erp-orders-and-source-meaning.md`](business-rules/erp-orders-and-source-meaning.md) | **NOT SENT. Drafted 2026-08-28 in [`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md), waiting on Albert to send.** |
| 2.15 | ⚠️ **WITHDRAWN 2026-08-28 — the claim was ours and it was wrong.** This entry said `invoiceNoString`, `invoiceDateString`, `lineInvoiceQty`, `shipQty` and `shipAmount` were empty on every historical row, and that ColdLion's issue-2 rule could therefore not be applied. **Re-measured on 10,397 `orderHistory` rows spanning 2019–2026: invoice number and invoice date are populated on 72%–99% of rows in every single year, and `shipAmount` on 100%.** The zero reading came from a probe that read a `content` / `totalElements` envelope which `orderHistory` does not return — it returns a bare JSON array. **Never send this to ColdLion**; it would re-raise issue 1, which we withdrew on 2026-08-27 for the same reason. The envelope inconsistency that caused the misreading is now issue 8 — see [`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md). | — | [`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md) | **Withdrawn 2026-08-28. Do not re-open.** |
| 2.17 | **NEW — `orderHistory` returns a bare array; every other endpoint returns a paged envelope (issue 8).** `/items`, `/divisions` and `/merchGroupHeaders` return `content`, `totalElements`, `totalPages` and `last`. `/orderHistory` returns a plain JSON array, `page` and `size` appear inert, and there is no way to learn a window's row count without pulling it. This is not cosmetic: it caused the false measurement withdrawn in 2.15. Ask for a consistent envelope. | JamieLynn | [`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md) | **NOT SENT. Drafted 2026-08-28 as issue 8, waiting on Albert to send.** |
| 2.12 | **`salesOrderLineNo` = 0 on 103 rows (issue 7) — PARTIALLY answered 2026-08-28, still open.** JamieLynn: *"It looks like in most of these cases the items or orders were canceled. The invoiced orders are strange though. Tech team will look into it. Not sure what caused it."* Canceled items explain most of the 103. **The invoiced ones are unexplained and are with ColdLion's tech team.** Loader consequence: `salesOrderLineNo = 0` is not a usable line key — do not assume the new line key is populated on every row, and quarantine rows where it is 0 with an invoice number. Named examples already sent: orders 7114595, 7124128, 7126086. | JamieLynn | [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md) | **Partially answered 2026-08-28; remainder with their tech team, no date given.** |
| 2.16 | **ColdLion asked US a question (2026-08-28) and we owe the answer (goes out under issue 3).** JamieLynn: *"Maintenance Tables (LabelCode, WarehouseCode, ColorCode, DimCode): Would you like us to create lookup APIs for these, or should we include their descriptions directly in the API response?"* **Our recommendation, for Albert to send: include the description inline in the response, and only for `labelCode` and `warehouseCode`.** Reasons, all verified live 2026-08-28: (a) inline needs no second call and no local copy that can drift out of date; (b) `labelCode` and `warehouseCode` are populated on effectively every `orderHistory` and `prodHistory` row and we already ingest both; (c) `colorCode` and `dimCode` are already marked *ignore* in our field decisions — `dimCode` is empty on 100% of `orderHistory` rows — so building anything for them is wasted work on both sides; (d) **none of the four fields exists on `/items` at all**, so a lookup API would sit beside data we never receive. | **us → JamieLynn** | [`coldlion-issue3-verification-20260828.md`](coldlion-issue3-verification-20260828.md), [`coldlion-field-decisions-20260819.csv`](coldlion-field-decisions-20260819.csv) | **NOT SENT. Drafted 2026-08-28 in [`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md), waiting on Albert to send.** |
| 2.13 | **Issue 3 remainder — LARGELY ANSWERED 2026-08-28, a narrow piece is left.** ColdLion documented `mgTypeCode` (01–14) and `active` (Y/N), built a `/divisions` endpoint, and confirmed `sizeCode` is a single value. See §4. **Still open:** no response field in the seven definitions carries a plain-English description, and the merchandise-group codes `merchGroup01`–`merchGroup06` still have no stated meaning in the spec — they are readable only through `/merchGroupHeaders` and `/merchGroupDetails`, and only if you already know that a code's meaning is scoped by its category. Re-ask together with 2.16, which is a reply they are waiting on. | JamieLynn | [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md) | **Largely answered 2026-08-28. Narrow remainder not yet re-asked.** |
| 2.2 | ✅ **ANSWERED 2026-08-20 — see §4.** Not old data: a merch-group renumbering. | JamieLynn | — | **Answered 2026-08-20.** |
| 2.4 | ✅ **ANSWERED 2026-08-26 — see §4.** *"No hidden dimension."* Plus: use 1-day windows, the call is slow. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §4 | **Answered 2026-08-26.** |
| 2.7 | ✅ **RESOLVED 2026-08-20 — see §4.** Her prepack answer (2.8) explained this one too: `linePrice` is **per component**, not per line. Once that is known, `(salesOrderNo, itemNo, labelCode)` is a clean line key — 196 multi-row groups, and **nothing else varies inside any of them**. The 28 "conflicting" groups were prepack components at different prices. **Step 4 of the landing plan is unblocked.** Remaining ask: expose `Line #` in the API. | JamieLynn | verified on 1,671 rows, 8 windows, 2019-2026 | **Answered 2026-08-20.** Follow-up (expose `Line #`) outstanding. |
| 2.8 | ✅ **ANSWERED 2026-08-26 — see §4.** *"We use the same formulas as report now."* The three fields that measured 0% now carry values — but **re-measured 2026-08-26 over 26 windows / 291 rows / 2019-2026, they are populated ONLY on 2026-08 rows** (4.1% overall). We cannot tell from the API whether older zeros are true closed-order zeros or an un-backfilled history, because `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString` and `invoiceDateString` are **empty on all 291 rows** — nothing in the feed reports shipping or invoicing at all. That question is now item 2 of 2.11. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §1 | **Answered 2026-08-26.** |
| 2.9 | ✅ **STAGECODE HALF CLOSED 2026-08-27.** *"Changed the doc."* On 2026-08-26 `stageCode` only had a description saying **"Example"**. Re-checked 2026-08-27: it now carries a real `enum` of `ISS`, `INTRAN`, `REC` — **closed for stageCode**. Still open: it is the **only** enum in the whole spec, and **no response field has a description** in any of the seven definitions. Narrowed in the next reply to `mgTypeCode`, `divisionCode`, `active`, and the undocumented response fields (`labelCode`, `warehouseCode`, `sizeCode`, `colorCode`, `dimCode`, `merchGroup01-06`). | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §2, [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md) | **Half closed 2026-08-27; remainder re-asked as issue 3.** |
| 2.10 | ✅ **ANSWERED 2026-08-26 — see §4.** *"Added SalesOrderLineNo and StageCode."* Both verified live and populated. Both workarounds retire. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §3 | **Answered 2026-08-26.** |
| 2.11 | **ColdLion asked US a question (2026-08-26): *"Please send us any difference between the api and report, any states you want to add."*** First time they have invited a list. Five items sent — the **seven always-empty `orderHistory` fields** (no row reports shipping or invoicing at all), whether the new quantity formulas were backfilled to history, the "Example" vs allowed-values gap, the malformed 7-day-cap error, negative quantities. The sixth (un-remapped API-created SKUs) was withdrawn as ours to do. **No new stages wanted.** | **us → JamieLynn** | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §5 | **SENT 2026-08-26 15:44 — items 1-5. ⚠️ ITEMS 1 AND 4 WERE BOTH WRONG, and the -564 figure in item 5 was wrong; a correction is owed** (re-tested on 19,008 rows: [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md)). **The correction reply was SENT Thu 2026-08-27 18:34 EST** (v3, with worked examples): it corrected items 1 and 4 and the -564 figure, credited ColdLion for closing the `stageCode` half of issue 3, narrowed the rest of issue 3, and raised **issue 6** (no unique key / duplicate rows, named orders 7109618, 7121891, 7124128) and **issue 7** (`salesOrderLineNo` = 0, named orders 7114595, 7124128, 7126086). Issues 3 (remainder), 6 and 7 are now open and awaiting ColdLion's reply. That re-test also found **no unique key exists** and `salesOrderLineNo` is 0 on 103 rows. ([`coldlion-negative-quantities-evidence-20260827.md`](coldlion-negative-quantities-evidence-20260827.md) §2). ColdLion asked 2026-08-27 for real examples behind the negative quantities; they are in §1 of that doc, and **the -564 figure could not be reproduced — do not repeat it.** **ColdLion replied 2026-08-28 on issues 5, 2 and 6 - all three are answered and moved to §4.** Issue 7 came back partially answered and is now 2.12; the issue 3 remainder went unanswered and is now 2.13. Item 6 (merch-group re-mapping) was **withdrawn before sending: it is our work, not ColdLion's** — see §5. |


### Open on OUR side — not questions for ColdLion

- **The API-created SKU merch-group re-map is waiting on Albert.** 343 items, not the ~20 once
  estimated: 282 have a proposal, 7 have conflicting evidence, 12 abstain, 42 are test records that
  should be deleted rather than mapped, and 123 carry a wrong pre-change value that a load would
  overwrite. Draft delivered to Albert 2026-08-28 as
  `coldlion-api-sku-merch-group-DRAFT-20260828.csv` (not in this repository — it carries licensed
  descriptions and this repository is public). Method and review notes:
  [`coldlion-api-created-sku-merch-group-draft-20260828.md`](coldlion-api-created-sku-merch-group-draft-20260828.md).
  **Nothing may be loaded until Albert rules.**
- **The historical load design must be re-checked against the issue 6 answer.** Any part of the
  landing plan that assumed one row per sales-order line, or a unique key, is now wrong. See
  [`business-rules/erp-orders-and-source-meaning.md`](business-rules/erp-orders-and-source-meaning.md).

## 3. Reported to ColdLion as observations — no answer needed

- **The 7-day-cap refusal is malformed.** HTTP 400 on the wire, `"status": 500` and
  `"Internal Server Error"` in the body. Invites clients to retry a permanent input error forever.
- **`lastProdCost` still fans out** where two production records share the maximum `lastProdDate`
  (order 20872, line 1, component CTZHS0MSC01: 3.09 vs 3.64). Harmless to us since `prodLineSeq`.

## 4. ANSWERED — do not re-ask

| Question | Answer | Who / when |
|---|---|---|
| **Issue 3 — what values may `mgTypeCode` take?** | **01 through 14, and the documentation now says so.** JamieLynn: *"MgTypeCode: Updated the documentation to reflect values from 01 to 14."* This confirms what we had measured: there are 14 merchandise-group slots, of which **01–06 are the live hierarchy** (type, sub-type, material/embellishment, size, licensor, property) and 07–14 are legacy positions kept for pre-renumbering rows. **Loader consequence: none — it confirms existing behaviour.** | JamieLynn, 2026-08-28 |
| **Issue 3 — what values may `active` take?** | **`Y` or `N`.** Now documented. **Loader consequence:** the merchandise-group lifecycle flag is a two-value flag; do not treat blank as a third state without checking. | JamieLynn, 2026-08-28 |
| **Issue 3 — where is the authoritative list of division codes?** | **ColdLion built us an endpoint.** JamieLynn: *"Company Edgehome contains 4 division codes. I have created the /divisions API to get them."* **Verified live the same day: `/divisions` returns exactly 4 — `CW001` POP Creations (Licensed Products), `EH001` Edge Home, `EP001` Edgeucational Publishing, `SP001` Spruce (Licensed Products), all `active = Y`.** It also carries each division's address, country, general-ledger code and DUNS number. **Loader consequence: stop hard-coding division codes.** `EP001` (Edgeucational Publishing) is active in the ERP but **out of scope permanently** — owner ruling, Albert 2026-08-28. Filter it at ingestion; its absence from our renumbering dates is not a gap. See §5. | JamieLynn, 2026-08-28 · verified live |
| **Issue 3 — what values may the size code take?** | **One: `NS`. POP does not sell apparel and does not use the field.** JamieLynn: *"SizeCode: NS is currently the only available option in the system (we don't make apparel, we don't use sizeCode)."* **Verified live on all 19,362 items: `sizeRangeCode` is `NS` on 19,346 and blank on 16 — no other value exists.** Two cautions. First, **the field on `/items` is named `sizeRangeCode`, not `sizeCode`** — there is no `sizeCode` field on the item response. Second, this says nothing about **merchandise group 04**, which is the real product-size axis and is fully populated; do not conflate the two. **Loader consequence: `sizeRangeCode` is dead weight — ignore it. Product size comes from merchandise group 04.** | JamieLynn, 2026-08-28 · verified live |
| **Issue 3 — where do the merchandise-group codes come from?** | *"Merch Groups (01–06): These can be retrieved via /merchGroupHeaders and /merchGroupDetails."* Confirms the two endpoints we already use. **It does not close the gap:** a code's meaning is scoped by its category, so a lookup that ignores `mgCategory` returns the wrong description. That caveat is ours, not documented by ColdLion, and is carried in 2.13. | JamieLynn, 2026-08-28 |
| **Issue 5 — negative quantities: are they real?** | **Yes, both patterns are real and expected.** Seven 2020 lines, customer AAF100: *"I remember those orders from AAFES - believe what happened with these was on the way in customer ordered in cases and stock was in pieces, so we had to manually explode into the pieces and adjust the settings to send the EDI back out the right way. This looks right."* Five lines on one order, customer DY001: *"we were shipping contractual samples and warehouse turned up more units than expected. Your team wanted to ship everything, so we added them to pick. Yes this is something I would expect if an order was changed later or something manual had to be done at a stage other than initial order entry."* **Loader consequence: do not reject or clamp negative quantities.** They record a manual correction after initial order entry. Load them as-is | JamieLynn, 2026-08-28 |
| **Issue 2 — do the new quantity formulas mean anything on historical rows?** | **"If it has an invoice number, unless we shipped short or partial, Open / Unshipped would drop to zero."** So a zero open/unshipped quantity on an invoiced row is a **true** zero, not an un-backfilled history. **Loader consequence: treat zero open/unshipped as real when an invoice number is present — and we CAN apply that test.** Verified 2026-08-28 on 10,397 rows spanning 2019-2026: open and unshipped are zero on effectively every row from 2019 through 2025, and those years carry an invoice number on 72%-99% of rows; the only year with live open/unshipped values is 2026, the orders still in flight. The historical zeros are true zeros. **Fully closed** | JamieLynn, 2026-08-28 |
| **Issue 6 — the feed has no unique key; the same line appears more than once** | **Answered: the feed's grain is finer than the sales-order line, by design.** 6a (order 7109618, same item twice at 41.60 and 39.88): *"the pricing changed at either pick or invoice level, so it split the lines. The 41.60 is from the SO, the 39.88 is from the invoice. They're technically both real."* 6b (order 7121891, line 6 holds two different items): *"Pick ticket and invoice would get their own line numbers as well. The line number doesn't carry forward unless all of the items are shipping on the same pick - on Sales Order 4PSBSE01S was line 6, but we were short this item. On pick & invoice PMABSE01S is line 6."* 6c (order 7124128): *"This is tough because a change at any stage can cause a line split. This report is assembling data from Sales Order, Prepack Detail, Pick Ticket and Invoice."* ⚠️ **Loader consequence, and it is the big one: `orderHistory` is not a sales-order table.** It is a union of four documents - Sales Order, Prepack Detail, Pick Ticket and Invoice - and `salesOrderLineNo` is **re-assigned** at pick and invoice, so it is not stable across the union. `(salesOrderNo, salesOrderLineNo)` is therefore **not** a unique key and never will be. Rows that look like duplicates are the same line seen at different stages, and **both prices are real**. Do not de-duplicate them, and do not sum them - a naive sum double-counts. The landing table must keep every row and carry a stage/source marker, and the feed still does not tell us which of the four documents a row came from. **That is the next question to ask** | JamieLynn, 2026-08-28 |
| Production-order line number to separate real lines from duplicates | **`prodLineSeq` added**; duplicated prod reference number was the cause; ColdLion now selects the maximum `lastProdDate` | ColdLion, 2026-08-17 · verified |
| Rate limits / paging for a bulk pull | **7-day window cap, inclusive**; ~2s per window from their office | ColdLion, 2026-08-17 · verified |
| Is `subUpc` ever populated? | Rarely — UPCs are not usually assigned to prepack components; one Walmart assortment. **Keep the column** | ColdLion, 2026-08-17 · rules §3 |
| What does a `COS` production PO mean? | **Sample production** — extra pieces for the licensor (contractual samples) or internal use (DAVID samples) | Albert, 2026-08-17 · rules §1 |
| Why are `ppkMerchGroup*` blank so often? | `merchGroup*` = assortment SKU, `ppkMerchGroup*` = component SKU. The **assortment** groups are the blank ones; a master is generic | JamieLynn, 2026-08-18 · verified, rules §6 |
| Are `lineInvoiceQty`/`lineOpenQty` populated? | Not carried at component level; use `unshippedQty` / `linePickQty` | JamieLynn, 2026-08-18 · verified, rules §7 |
| What are the valid `stageCode` values? | **Exactly three: `ISS`, `INTRAN`, `REC`.** All verified to carry rows | JamieLynn, 2026-08-19 · verified, rules §4 |
| The 10 recent unlinked AMA030 lines | **AMA030 is Amazon.** Amazon orders are stock for their warehouse, not presold, so they have no customer PO. Verified 10 of 10 unlinked | JamieLynn, 2026-08-19 · verified, rules §8 |
| Why do older lines have `salesOrderNo = 0`? | Hard-linking POs to production orders began ~**2022–2023**; `custPONumber` was manual before, and drops off entirely on `INTRAN`/`REC` | JamieLynn, 2026-08-18 · verified, rules §4–5 |
| **How far back does the history go?** | **2019-01-01.** History starts there; that is the load boundary. Albert has stated this repeatedly and it was already locked as D9 of `plan_coldlion-landing-phases-2-6.md` — the register simply failed to record it, and listed it as open. **Not a ColdLion question and never was.** | **Albert, restated 2026-08-20** |
| **Admit the 66 unmatched ColdLion property codes?** | **YES — admit all 66.** ColdLion's merchandise-group `active` flag now supplies normal lifecycle status. DB Data Admin may still record an explicit higher-authority ruling; signed entitlement schedules also take precedence. See §5 and the licensing Master Data business rule. | **Albert, 2026-08-20; lifecycle answer superseded 2026-08-24** |
| **Is there a field identifying a row's production stage?** | **Yes — "Prod Stage".** But it is **not exposed in the API**: no field containing "stage" exists in any definition of the live spec, `ProdHistory` included. Keep stamping it from the request | JamieLynn, 2026-08-20 · spec verified same day |
| **How do we tell two sales-order lines apart?** | **`(salesOrderNo, itemNo, labelCode)` is the line; add `subItemNo` for the component.** Resolved by her prepack answer: **`linePrice` is per-component, not per-line**, so rows that looked like conflicting duplicate lines are one line's components priced individually. Verified on 1,671 rows across 8 windows 2019-2026: 196 multi-row groups, **no field other than `linePrice` varies within any of them**. ColdLion also has a `Line #` on Sales Order, but it is **not in the API** | JamieLynn 2026-08-20 + our verification |
| **Why are component merch groups blank on some rows?** | **A merch-group POSITION CHANGE, not old data.** JamieLynn 2026-08-20, per sample: order 23049 — *"The merch group positions changed for Generic – I can see the data is in the old fields."* Orders 23239 and 23746 — *"these skus were created through the API around the time of the Merch Group change with the old MGs, but yes the fields are blank, probably need to update with the new MG information."* **So the values still exist in the OLD slot positions on affected rows, and some API-created SKUs were never re-mapped.** This explains why blanks start in 2024 and rise (0% across 624 rows 2019-2023, 11.7% in 2024, 16.1% in 2025) — the opposite of "older stuff", which was her first guess. ⚠️ **Loader consequence: a blank component merch group is NOT missing data.** Do not treat it as absent, and do not backfill it from the master item — check the old slot positions first, and expect a set of API-created SKUs that genuinely need re-mapping at ColdLion's end | JamieLynn, 2026-08-20 |
| **Does ColdLion have an active/inactive flag on merch groups?** | **Yes, and it is live and functioning.** `active` is returned on `/merchGroupDetails` merchandise-group rows. The 2026-08-20 sample found it 100% populated but observed only `Y`; that sampling caveat is superseded by Albert's 2026-08-24 confirmation that the API now exposes functioning active/inactive values. Merged PR #1432 stores the value as typed `source_active` on `plm.erp_licensor` / `plm.erp_property` and synchronizes lifecycle status while abstaining on conflicts, ambiguity, signed entitlement schedules, and explicit higher-authority rulings. | ColdLion verified 2026-08-20; Albert confirmed functioning lifecycle values 2026-08-24 |
| **Where do invoiced and open quantity come from?** | **"We use the same formulas as report now."** The API now applies the report's own formulas, but **only recent rows carry values**: re-measured over 26 windows / 291 rows / 2019-2026, `unshippedQty` and `subQty` are 4.1% populated, `linePickQty` 2.7%, `lineOpenQty` 1.4% — **all of it in 2026-08**, zero everywhere from 2019 through 2026-07. `lineInvoiceQty` is zero on all 291. **The exact formula was never given; we get the computed result instead.** ⚠️ Do not compute an invoiced or shipped quantity from this feed — seven fields including `shipQty` and `invoiceDateString` are empty on every row | JamieLynn, 2026-08-26 · verified same day |
| **Can fixed value-lists go into Swagger?** | **"Changed the doc." — partially.** `prodHistory.stageCode` now reads *"Production stage code. Example: ISS, INTRAN, REC"*. But it says **Example**, not allowed values, and **no `enum` exists anywhere in the spec**, on any field or parameter. **Not closed** — reopened in 2.11 | JamieLynn, 2026-08-26 · spec verified same day |
| **Expose `Line #` and `Prod Stage` in the API** | **Done: "Added SalesOrderLineNo and StageCode."** `OrderHistory.salesOrderLineNo` (int32) non-zero on 24/24 rows; `ProdHistory.stageCode` on 20/20. **Both workarounds retire** — **⚠️ the line-key half of this is SUPERSEDED 2026-08-28 — see the issue 6 row above: the line number is re-assigned at pick and invoice, so `(salesOrderNo, salesOrderLineNo)` is not unique** and the returned stage instead of the stamped one. Reconcile against the old derived key for one load | JamieLynn, 2026-08-26 · verified same day |
| **Does `orderHistory` have a hidden dimension?** | **"No hidden dimension."** Confirmed against the live spec: `companyCode`, `divisionCode`, `fromDate`, `toDate`, `salesOrderNo` and nothing else. They added: **"narrow down the date range to 1 day if the call is slow"** — so plan the historical load on 1-day windows (~2,800 calls), not the 7-day maximum | JamieLynn, 2026-08-26 · verified same day |
| Is `1900-01-01` the empty-date marker? | Yes | Albert, 2026-08-14 |
| Division/company code meanings | Answered in two rounds | Uma, 2026-08-13 and 2026-08-17 · `division-code-*.md` |
| Was `/vendors` the wrong table? | Yes — ColdLion swapped it to the factory table; 97 rows, all active | ColdLion, 2026-07-22 |

## 5. Not questions — owner rulings that keep getting re-litigated

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
  [`coldlion-19k-row-resample-20260827.md`](coldlion-19k-row-resample-20260827.md).

- **History depth is 2019-01-01.** Settled repeatedly by Albert, most recently 2026-08-20. It is D9
  of the landing plan. Stop listing it as an open question.

- **Do NOT ask Albert to rotate the ColdLion API key.** He does not administer ColdLion. Ruling
  2026-08-09; the exposure remains a recorded fact. See `coldlion-erp-api-reference.md`.
- **Scope of the historical load:** capture everything, work backward, stop after twelve months of
  silence. Albert, 2026-08-16, on issue #1031 — **with the correction that windows are now 7 days,
  not one month.**
