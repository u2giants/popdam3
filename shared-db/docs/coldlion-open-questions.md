---
summary: "ColdLion question register entry: why it exists, last-reviewed status, 2026-09-10 verification, and table of the two part files."
kind: living
status: current
read-when: about to ask ColdLion a question or check whether one is already answered
---

# ColdLion — every open question, in one place

**Why this exists:** ColdLion questions were scattered across seven documents, a handoff, a
take-over note and two GitHub issues. Sessions were re-asking answered questions and missing live
ones. This is the single register. **Last reviewed: 2026-09-29 (tenth pass — ColdLion technical team answered the `/proddetails` identity questions; 2.36 updated; one cost follow-up remains ours).** ColdLion's
response to the nine-section 2026-09-06 reply was verified directly against the live API:
all actionable repairs are live, including inventory company attribution, parameter
validation, complete-result defaults, pick-ticket retrieval, merchandise-group details,
and response schemas. The apparent `SPRUCE`/`SP001` contradiction was reclassified after
checking the actual tenant directory, taxonomy, inventory and record dates: the current
Spruce Licensed source identity is `EDGEHOME`/`SP001`; the 2024 `SPRUCE`/`SP001` item rows
have no stock and are not a basis to alter that identity or re-contact ColdLion. The
earlier zero-row finding for `/merchGroupDetails` is superseded by the 2026-09-09/10 live
read returning 1,384 rows when `active=Y` and `active=N` are requested explicitly. The
`mgCategory` identity answer is recorded in §4 and the remaining clarifications are
recorded as 2.35 below. The draft email is NOT in this repository: it carries item
numbers and licensed item descriptions, and shared-db is public. Separately, the settled
`/vendors` and `/seasons` field rulings and the unfiltered `/seasons` vendor defect were
written into §5.**

**Who answers these:** ColdLion is a third-party ERP Albert does **not** administer. Questions go to
**JamieLynn** (API/data) or **Uma** (division/company codes), **from Albert** — never sent by an AI
session. Some questions are for **Albert** as owner, not for ColdLion; those are marked.

> ### ⛔ Read §4 (ANSWERED) BEFORE drafting any question.
> On 2026-08-19 a session measured the two always-zero quantity fields for an afternoon and
> drafted a question about them. **That question was answered on 2026-08-18 and was already in
> §4.** The session had read four ColdLion documents; none of them pointed here. Those documents
> now carry a banner, and [`coldlion.md`](coldlion.md) is the front door. Re-asking an answered
> question wastes ColdLion's goodwill, which is a finite resource we depend on.

### 2026-09-10 verification — current status of the September reply

This supersedes the “awaiting” labels retained in the historical rows 2.25–2.32 below.

| Item | Verified result | Status |
|---|---|---|
| 2.25 | Inventory now returns company identity and its company/division filters work. | Closed |
| 2.26 | `EDGEHOME`/`SP001` is the current Spruce Licensed identity. The older `SPRUCE`/`SP001` item rows have no inventory; `active=Y` is not saleability proof. | Closed — no vendor action |
| 2.27 | Unknown parameters and invalid `active`, `stageCode`, and `mgTypeCode` values now fail clearly. | Closed |
| 2.28 | Omitted or empty `active` and `stageCode` now return complete results. | Closed |
| 2.29 | Pick tickets return populated results. | Closed |
| 2.30 | Division-qualified merchandise-group details return rows. | Closed |
| 2.31 | `createdTo` is inclusive on pick tickets. Receiving has no available rows to prove separately. | Closed |
| 2.32 | Every GET response now has a typed schema, including both paged history feeds. | Closed |

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

## Where each section lives

The full text was split **verbatim** on 2026-11-11 (size budget; popcre/designflow-backend issue 391). Section numbers and headings are unchanged. Open only the part that holds your section.

| Part | Sections |
|---|---|
| [coldlion-open-questions-part-1.md](coldlion-open-questions-part-1.md) | 1. BLOCKING — one open: 2.36, `/proddetails` row identity<br>1.1 ✅ CLOSED 2026-08-26 — `stageCode` is now IN the API<br>1.2 ✅ CLEARED 2026-09-10 — `/merchGroupDetails` identity is category-scoped<br>2. Open — these change how data is modelled or reported<br>Open on OUR side — not questions for ColdLion<br>3. Reported to ColdLion as observations — no answer needed |
| [coldlion-open-questions-part-2.md](coldlion-open-questions-part-2.md) | 4. ANSWERED — do not re-ask<br>5. Not questions — owner rulings that keep getting re-litigated |
