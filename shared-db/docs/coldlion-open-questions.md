# ColdLion — every open question, in one place

**Why this exists:** ColdLion questions were scattered across seven documents, a handoff, a
take-over note and two GitHub issues. Sessions were re-asking answered questions and missing live
ones. This is the single register. **Last reviewed: 2026-08-19.**

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

### 1.1 Is there a field identifying which stage a row is in? *(ColdLion / JamieLynn)*

Nothing in the payload distinguishes an `ISS` row from an `INTRAN` or `REC` row; the stage is known
only from the request. We stamp it on load, so this is a safety net, not a need. **Related and more
important than it sounds:** row keys do **not** collide across stages, so a table without a stage
column accepts all three and silently triples-counts quantities with no key violation to warn you.

**Sent / awaiting reply since:** sent in the email JamieLynn answered on 2026-08-18/19; she gave the stage LIST but did not address whether a field identifies the stage. **Re-sent in the 2026-08-20 email.**

**Evidence:** [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).

## 2. Open, not blocking — these change how data is modelled or reported

| # | Question | For | Evidence | Sent / awaiting reply since |
|---|---|---|---|---|
| 2.2 | **~12–16% of component rows have `ppkMerchGroup*` blank**, after the assortment-vs-component split is accounted for. Expected, or worth a look? | JamieLynn | shape §5.7, rules §6 | Sent — in the email JamieLynn answered on 08-18/08-19; this part was not addressed. **Re-sent in the 2026-08-20 email.** |
| 2.4 | **Does `orderHistory` have a hidden dimension too?** It has no `stageCode`, but nobody has proved its default response is complete. After §1.1, assume nothing. | us first, then JamieLynn | verification doc §8 | **Not sent — ours to answer first.** Prove it ourselves before asking. |
| 2.6 | **Do lapsed licences need an expiry/active flag from ColdLion at all?** The absence is the root cause behind 2.5 and behind repeated taxonomy churn. Currently worked around, never asked. | JamieLynn | `merch-group-taxonomy-architecture.md` | **SENT by Albert — no reply ever received.** Date not recorded. An earlier version of this file wrongly said "never sent"; that was this session guessing. **Re-sent in the 2026-08-20 email.** |
| 2.7 | **How do we tell two sales-order lines apart?** `orderHistory` has no line number — confirmed against the live spec, 59 fields, none of them a sequence. `(salesOrderNo, itemNo, labelCode, subItemNo)` is unique across 1,671 rows spanning 2019-2026, so the **component** grain is solved. But 28 groups sharing `(salesOrderNo, itemNo, labelCode)` carry genuinely different `linePrice` or `lineQty` — either ColdLion allows two lines of the same item at different prices with no field to distinguish them, or those are duplicate rows. **This is the sales-side twin of the question they solved for production with `prodLineSeq` on 2026-08-17.** | JamieLynn | `plan_coldlion-landing-phases-2-6.md` step 4; measurements in this session's evidence | **In the 2026-08-20 email.** Awaiting reply. |
| 2.8 | **The alternatives given for the invoiced/open quantity question are also always zero.** Follow-up to the 2026-08-18 answer in §4 ("not carried at component level; use `unshippedQty` / `linePickQty`"). Measured across 1,671 rows, 8 windows, 2019-2026: `lineInvoiceQty` 0%, `lineOpenQty` 0%, **`linePickQty` 0%, `unshippedQty` 0%, `subQty` 0%**. Only `lineQty` (100%) and `lineCancelledQty` (17.2%) carry signal. So the redirect did not resolve it — where does invoiced and open quantity actually live? | JamieLynn | this session's 1,671-row sample; original answer in §4 | **In the 2026-08-20 email.** Awaiting reply. |
| 2.9 | **Could fixed value-lists go into Swagger?** Prompted by the `stageCode` list: a stage we do not know about is one we would never request and never notice was missing. Applies to any field with a fixed set of valid values. Convenience, not a blocker. | JamieLynn | §4 stageCode answer | **In the 2026-08-20 email.** Awaiting reply. |

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
| **Admit the 66 unmatched ColdLion property codes?** | **YES — admit all 66.** Paired with a requirement: the **DB Data Admin** application (`data.designflow.app`) gets a control to mark a property inactive **on our side**, since ColdLion has no expiry flag and never will. Admitting without that control is what everyone was afraid of. See §5 | **Albert, 2026-08-20** |
| Is `1900-01-01` the empty-date marker? | Yes | Albert, 2026-08-14 |
| Division/company code meanings | Answered in two rounds | Uma, 2026-08-13 and 2026-08-17 · `division-code-*.md` |
| Was `/vendors` the wrong table? | Yes — ColdLion swapped it to the factory table; 97 rows, all active | ColdLion, 2026-07-22 |

## 5. Not questions — owner rulings that keep getting re-litigated

- **The 66 unmatched ColdLion property codes ARE admitted (Albert, 2026-08-20).** All 66, including
  the 51 still marked active in ColdLion. The long-standing objection — that ColdLion has no licence
  expiry flag, so admitting them resurrects lapsed licences such as `EX` (THE EXORCIST) and `LB`
  (THE LOST BOYS) — is answered by owning the flag ourselves rather than by refusing the rows.
  **The paired requirement is not optional:** the **DB Data Admin** application (`data.designflow.app`) must gain a control to set a
  property inactive on our side. `core.property.status` already supports it — it is an
  `entity_status` enum accepting `active, inactive, archived, deleted, potential`, and all 256 live
  rows are currently `active` (verified read-only against production 2026-08-20). **So this needs no
  schema change**, only the UI control and whatever guard decides who may flip it. Do not queue it as
  structural database work.
- **History depth is 2019-01-01.** Settled repeatedly by Albert, most recently 2026-08-20. It is D9
  of the landing plan. Stop listing it as an open question.

- **Do NOT ask Albert to rotate the ColdLion API key.** He does not administer ColdLion. Ruling
  2026-08-09; the exposure remains a recorded fact. See `coldlion-erp-api-reference.md`.
- **Scope of the historical load:** capture everything, work backward, stop after twelve months of
  silence. Albert, 2026-08-16, on issue #1031 — **with the correction that windows are now 7 days,
  not one month.**
