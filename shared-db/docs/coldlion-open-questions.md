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

## 1. BLOCKING — answer before the historical load runs

### 1.1 What is the authoritative list of `stageCode` values? *(ColdLion / JamieLynn)*

**Why it blocks:** `GET /prodHistory` without `stageCode` returns **only `ISS` lines**;
`stageCode=REC` returns receipt rows that appear nowhere in the default response. A stage we do not
know about is one we would never fetch **and never miss** — the load would look complete and be
missing an entire category of rows.

Confirmed to return data: `ISS`, `REC`. Named by ColdLion but 0 rows so far: `INTRAN`. Probed and
empty: `OPEN`, `CLOSED`, `SHIP`, `CAN`, `PEND`, `NEW`, `COMP`, `WIP`, `APPR`.

**Evidence:** [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md).
**Drafted in:** [`_drafts/coldlion-history-endpoints-questions.md`](_drafts/coldlion-history-endpoints-questions.md) Q1.

### 1.2 Is there a field identifying which stage a row is in? *(ColdLion / JamieLynn)*

Nothing in the payload distinguishes an `ISS` row from a `REC` row; the stage is known only from the
request. We will stamp it on load, but a real field would be safer. **Related and equally
important:** row keys do **not** collide across stages, so a table without a stage column accepts
both and silently double-counts quantities.

## 2. Open, not blocking — these change how data is modelled or reported

| # | Question | For | Evidence |
|---|---|---|---|
| 2.1 | **10 recent unlinked lines the historical explanation misses** — `ISS` stage, not `COS`, customer AMA030, refs D3568/D3569, ordered 2026-08-05, qty 152–1,200, no `salesOrderNo`. Another route to an unlinked recent line, or something specific? | JamieLynn | shape §5.5 |
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
