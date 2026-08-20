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

### 1.1 ✅ ANSWERED 2026-08-20 — *"Yes this is called Prod Stage"* (JamieLynn)

**But it is NOT in the API.** Verified against the live spec (`GET /EhpApi/v2/api-docs`) on
2026-08-20: **no field whose name contains "stage" exists in ANY definition**, `ProdHistory`
(133 fields) included. So `Prod Stage` exists inside ColdLion but is not exposed to us.

This is the same shape as the `Line #` gap in 2.7 — the field exists in their system, not in
their API. Both are now one ask: **expose them.** Until then we keep stamping the stage
ourselves from the request, which works but relies on the loader never getting it wrong.

Why it matters: row keys do **not** collide across stages, so a table without a stage column
accepts `ISS`, `INTRAN` and `REC` copies of the same row and silently triples the quantities
with no key violation to warn anyone.

**Evidence:** [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](verification/coldlion-prodhistory-stage-discovery-20260819/README.md); live-spec check 2026-08-20.

## 2. Open, not blocking — these change how data is modelled or reported

| # | Question | For | Evidence | Sent / awaiting reply since |
|---|---|---|---|---|
| 2.2 | **Blank component merch groups are a 2024-onward change, NOT old data.** JamieLynn 2026-08-20: *"Expected for older stuff."* Re-measured on **1,185 component rows from 35 windows, 5 per year 2019-2025**: 2019 **0%**, 2020 **0%**, 2021 **0%**, 2022 **0%**, 2023 **0%** — **624 old rows, not one blank** — then 2024 **11.7%** (52/443) and 2025 **16.1%** (19/118). The trend is the exact reverse of her explanation and it is **rising**. Also telling: **69 of the 71 blank-component rows have the MASTER `merchGroup01` populated**, so the data is not simply missing — the component groups specifically stopped being filled. Something changed in 2024. Samples to send: order **23049** seq 1 (`VSZ2FECST01`, `VSZ2FNFRN01`, `VSZ2FWFRN01`, 2024-11-08), order **23239** seq 1 (`GFZ14DCJK01`, `GFZ14PNUT01`, 2025-02-10), order **23746** seq 1 (`VSQ93SSSS02`, 2025-11-10). | JamieLynn | 1,185 component rows, 35 windows, 2019-2025 | **Awaiting reply since 2026-08-20.** Sample set ready to send. |
| 2.4 | **Does `orderHistory` have a hidden dimension too?** It has no `stageCode`, but nobody has proved its default response is complete. After §1.1, assume nothing. | us first, then JamieLynn | verification doc §8 | **Not sent — ours to answer first.** Prove it ourselves before asking. |
| 2.6 | **Do lapsed licences need an expiry/active flag from ColdLion at all?** The absence is the root cause behind 2.5 and behind repeated taxonomy churn. Currently worked around, never asked. | JamieLynn | `merch-group-taxonomy-architecture.md` | **SENT by Albert — no reply ever received.** Date not recorded. An earlier version of this file wrongly said "never sent"; that was this session guessing. **Re-sent in the 2026-08-20 email.** |
| 2.7 | ✅ **RESOLVED 2026-08-20 — see §4.** Her prepack answer (2.8) explained this one too: `linePrice` is **per component**, not per line. Once that is known, `(salesOrderNo, itemNo, labelCode)` is a clean line key — 196 multi-row groups, and **nothing else varies inside any of them**. The 28 "conflicting" groups were prepack components at different prices. **Step 4 of the landing plan is unblocked.** Remaining ask: expose `Line #` in the API. | JamieLynn | verified on 1,671 rows, 8 windows, 2019-2026 | **Answered 2026-08-20.** Follow-up (expose `Line #`) outstanding. |
| 2.8 | **Invoiced / open quantity — with ColdLion's team.** JamieLynn 2026-08-20: *"the way this works on the report (because most orders are placed at assortment level) is there are summary expressions where if there's a Prepack, system takes line quantity, divides it into the component quantities and shows the quantity and pricing of each component. Speaking to the guys about this one."* So the report computes these; the API returns the raw rows. **This answer already solved 2.7** — it is why `linePrice` varies per component. Still open: where invoiced and open quantity actually come from. | JamieLynn (with her team) | 1,671 rows: `linePickQty`, `unshippedQty`, `subQty` all 0% | **Awaiting reply since 2026-08-20.** She is consulting her team. |
| 2.9 | **Could fixed value-lists go into Swagger?** Prompted by the `stageCode` list: a stage we do not know about is one we would never request and never notice was missing. Applies to any field with a fixed set of valid values. Convenience, not a blocker. | JamieLynn | §4 stageCode answer | **In the 2026-08-20 email.** Awaiting reply. |
| 2.10 | **Expose `Line #` and `Prod Stage` in the API.** Both exist inside ColdLion — she confirmed `Line #` on Sales Order and `Prod Stage` on production — and **neither appears anywhere in the live spec.** We have worked around both (a derived line key, and stamping the stage from the request), so this is robustness, not a blocker. But a derived key is a guess that holds until it doesn't, and a stamped stage is only as good as the loader. | JamieLynn | live-spec checks 2026-08-20 | **Not sent yet.** Draft for the next email. |

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
| **Is there a field identifying a row's production stage?** | **Yes — "Prod Stage".** But it is **not exposed in the API**: no field containing "stage" exists in any definition of the live spec, `ProdHistory` included. Keep stamping it from the request | JamieLynn, 2026-08-20 · spec verified same day |
| **How do we tell two sales-order lines apart?** | **`(salesOrderNo, itemNo, labelCode)` is the line; add `subItemNo` for the component.** Resolved by her prepack answer: **`linePrice` is per-component, not per-line**, so rows that looked like conflicting duplicate lines are one line's components priced individually. Verified on 1,671 rows across 8 windows 2019-2026: 196 multi-row groups, **no field other than `linePrice` varies within any of them**. ColdLion also has a `Line #` on Sales Order, but it is **not in the API** | JamieLynn 2026-08-20 + our verification |
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
