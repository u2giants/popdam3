# ColdLion — every open question, in one place

**Why this exists:** ColdLion questions were scattered across seven documents, a handoff, a
take-over note and two GitHub issues. Sessions were re-asking answered questions and missing live
ones. This is the single register. **Last reviewed: 2026-08-19.**

**Who answers these:** ColdLion is a third-party ERP Albert does **not** administer. Questions go to
**JamieLynn** (API/data) or **Uma** (division/company codes), **from Albert** — never sent by an AI
session. Some questions are for **Albert** as owner, not for ColdLion; those are marked.

**Rules for this file:**
- When something is answered, **move it to §4 with the answer and the date** — do not delete it, or
  it gets re-asked.
- Anything marked **BLOCKING** stops a specific piece of work. Say which.
- Cite where the evidence lives. A question with no evidence attached wastes their time.

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

**Evidence:** [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).

## 2. Open, not blocking — these change how data is modelled or reported

| # | Question | For | Evidence |
|---|---|---|---|
| 2.2 | **~12–16% of component rows have `ppkMerchGroup*` blank**, after the assortment-vs-component split is accounted for. Expected, or worth a look? | JamieLynn | shape §5.7, rules §6 |
| 2.3 | **How far back does the history go?** June 2019 returns data; no earlier boundary searched. Answering it sizes the one-time load instead of us scanning backwards. | JamieLynn | shape §7 |
| 2.4 | **Does `orderHistory` have a hidden dimension too?** It has no `stageCode`, but nobody has proved its default response is complete. After §1.1, assume nothing. | us first, then JamieLynn | verification doc §8 |
| 2.5 | **Admit the 66 unmatched ColdLion property codes?** 51 still active. ColdLion has **no expiry flag**, so a blanket admission resurrects lapsed licences. Includes `EX` (THE EXORCIST) and `LB` (THE LOST BOYS). | **Albert (owner decision)** | `coldlion-unmatched-properties-by-licensor-20260731.md`; do **not** re-ask Laura, she already answered |
| 2.6 | **Do lapsed licences need an expiry/active flag from ColdLion at all?** The absence is the root cause behind 2.5 and behind repeated taxonomy churn. Currently worked around, never asked. | JamieLynn | `merch-group-taxonomy-architecture.md` |

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
| Is `1900-01-01` the empty-date marker? | Yes | Albert, 2026-08-14 |
| Division/company code meanings | Answered in two rounds | Uma, 2026-08-13 and 2026-08-17 · `division-code-*.md` |
| Was `/vendors` the wrong table? | Yes — ColdLion swapped it to the factory table; 97 rows, all active | ColdLion, 2026-07-22 |

## 5. Not questions — owner rulings that keep getting re-litigated

- **Do NOT ask Albert to rotate the ColdLion API key.** He does not administer ColdLion. Ruling
  2026-08-09; the exposure remains a recorded fact. See `coldlion-erp-api-reference.md`.
- **Scope of the historical load:** capture everything, work backward, stop after twelve months of
  silence. Albert, 2026-08-16, on issue #1031 — **with the correction that windows are now 7 days,
  not one month.**
