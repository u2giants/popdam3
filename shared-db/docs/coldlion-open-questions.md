# ColdLion — every open question, in one place

**Why this exists:** ColdLion questions were scattered across seven documents, a handoff, a
take-over note and two GitHub issues. Sessions were re-asking answered questions and missing live
ones. This is the single register. **Last reviewed: 2026-08-26.**

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
| 2.2 | ✅ **ANSWERED 2026-08-20 — see §4.** Not old data: a merch-group renumbering. | JamieLynn | — | **Answered 2026-08-20.** |
| 2.4 | ✅ **ANSWERED 2026-08-26 — see §4.** *"No hidden dimension."* Plus: use 1-day windows, the call is slow. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §4 | **Answered 2026-08-26.** |
| 2.7 | ✅ **RESOLVED 2026-08-20 — see §4.** Her prepack answer (2.8) explained this one too: `linePrice` is **per component**, not per line. Once that is known, `(salesOrderNo, itemNo, labelCode)` is a clean line key — 196 multi-row groups, and **nothing else varies inside any of them**. The 28 "conflicting" groups were prepack components at different prices. **Step 4 of the landing plan is unblocked.** Remaining ask: expose `Line #` in the API. | JamieLynn | verified on 1,671 rows, 8 windows, 2019-2026 | **Answered 2026-08-20.** Follow-up (expose `Line #`) outstanding. |
| 2.8 | ✅ **ANSWERED 2026-08-26 — see §4.** *"We use the same formulas as report now."* The three fields that measured 0% now carry values — but **re-measured 2026-08-26 over 26 windows / 291 rows / 2019-2026, they are populated ONLY on 2026-08 rows** (4.1% overall). We cannot tell from the API whether older zeros are true closed-order zeros or an un-backfilled history, because `lineInvoiceQty`, `shipQty`, `shipAmount`, `invoiceNoString` and `invoiceDateString` are **empty on all 291 rows** — nothing in the feed reports shipping or invoicing at all. That question is now item 2 of 2.11. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §1 | **Answered 2026-08-26.** |
| 2.9 | ⚠️ **PARTIALLY ANSWERED 2026-08-26 — see §4.** *"Changed the doc."* `stageCode` now has a description, but it says **"Example"**, not "allowed values", and **no `enum` exists anywhere in the spec**. Not closed; goes back in the next reply. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §2 | **Answered 2026-08-26, unsatisfactorily.** |
| 2.10 | ✅ **ANSWERED 2026-08-26 — see §4.** *"Added SalesOrderLineNo and StageCode."* Both verified live and populated. Both workarounds retire. | JamieLynn | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §3 | **Answered 2026-08-26.** |
| 2.11 | **ColdLion asked US a question (2026-08-26): *"Please send us any difference between the api and report, any states you want to add."*** First time they have invited a list. Five items sent — the **seven always-empty `orderHistory` fields** (no row reports shipping or invoicing at all), whether the new quantity formulas were backfilled to history, the "Example" vs allowed-values gap, the malformed 7-day-cap error, negative quantities. The sixth (un-remapped API-created SKUs) was withdrawn as ours to do. **No new stages wanted.** | **us → JamieLynn** | [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §5 | **SENT 2026-08-26 15:44 — items 1-5 only. Awaiting reply.** Item 6 (merch-group re-mapping) was **withdrawn before sending: it is our work, not ColdLion's** — see §5. |

## 3. Reported to ColdLion as observations — no answer needed

- **The 7-day-cap refusal is malformed.** HTTP 400 on the wire, `"status": 500` and
  `"Internal Server Error"` in the body. Invites clients to retry a permanent input error forever.
- **`lastProdCost` still fans out** where two production records share the maximum `lastProdDate`
  (order 20872, line 1, component CTZHS0MSC01: 3.09 vs 3.64). Harmless to us since `prodLineSeq`.

## 4. ANSWERED — do not re-ask

| Question | Answer | Who / when |
|---|---|---|
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
| **Expose `Line #` and `Prod Stage` in the API** | **Done: "Added SalesOrderLineNo and StageCode."** `OrderHistory.salesOrderLineNo` (int32) non-zero on 24/24 rows; `ProdHistory.stageCode` on 20/20. **Both workarounds retire** — use `(salesOrderNo, salesOrderLineNo)` as the line key (`subItemNo` for the component) and the returned stage instead of the stamped one. Reconcile against the old derived key for one load | JamieLynn, 2026-08-26 · verified same day |
| **Does `orderHistory` have a hidden dimension?** | **"No hidden dimension."** Confirmed against the live spec: `companyCode`, `divisionCode`, `fromDate`, `toDate`, `salesOrderNo` and nothing else. They added: **"narrow down the date range to 1 day if the call is slow"** — so plan the historical load on 1-day windows (~2,800 calls), not the 7-day maximum | JamieLynn, 2026-08-26 · verified same day |
| Is `1900-01-01` the empty-date marker? | Yes | Albert, 2026-08-14 |
| Division/company code meanings | Answered in two rounds | Uma, 2026-08-13 and 2026-08-17 · `division-code-*.md` |
| Was `/vendors` the wrong table? | Yes — ColdLion swapped it to the factory table; 97 rows, all active | ColdLion, 2026-07-22 |

## 5. Not questions — owner rulings that keep getting re-litigated

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

- **History depth is 2019-01-01.** Settled repeatedly by Albert, most recently 2026-08-20. It is D9
  of the landing plan. Stop listing it as an open question.

- **Do NOT ask Albert to rotate the ColdLion API key.** He does not administer ColdLion. Ruling
  2026-08-09; the exposure remains a recorded fact. See `coldlion-erp-api-reference.md`.
- **Scope of the historical load:** capture everything, work backward, stop after twelve months of
  silence. Albert, 2026-08-16, on issue #1031 — **with the correction that windows are now 7 days,
  not one month.**
