# Owner ruling "R5" — written down at last, and marked UNCONFIRMED

**Status: DRAFT — RECONSTRUCTED FROM CITATIONS, NOT YET CONFIRMED BY THE OWNER.**
**Date written:** 2026-08-11 · **Issue:** [#734](https://github.com/u2giants/shared-db/issues/734)

> **Read this line before you use anything below.** Every word of the ruling in §2 was
> reverse-engineered from four documents that *cite* R5. Nobody has produced the original. Until
> Albert reads §2 and says yes or no, **R5 is not a ruling — it is an AI-authored summary of a
> ruling that may or may not have been given.** Do not cite this file as owner authority. Cite it
> as "the reconstruction awaiting confirmation".

---

## 1. Why this document exists

Four planning documents in this repository treat "R5" as a settled owner ruling and build their
whole strategy on it. **R5 exists in no file, in no commit, and in no issue.** It was searched for
on 2026-08-11 across the full working tree and the full history of this repository
(`git log --all -S"R5" --pickaxe-all`, plus a grep of the retired `COORDINATOR_INTAKE.md` at three
historical revisions). Every hit is either one of the four citations below, or an unrelated string
— a review finding numbered R5 in `docs/production-migration-lane-design-20260802.md:631`, a smoke
test named R5 in `docs/app-migration-notes/oracle-macro-understanding-20260702.md:68`, a rejected
option R5 in `plan_dispatch-collision-hardening.md:331`, and a ColdLion merch-group code `R5`
("Specialty Fabric w Attachment") that appears in captured reference data.

A plan cannot be reconciled against a quotation of a document that does not exist. This file makes
the claim inspectable so the owner can confirm, correct, or reject it in one reading.

### 1.1 A naming collision you must know about

**"R5" is ambiguous in this repository, and the collision is live.** `AGENTS.md` §6.10 records
*five numbered owner rulings given on 2026-08-06*, and **its ruling 5 is a different ruling
entirely** — "STOP THE DATA LOSS FIRST", the ordering ruling that says ship quarantine/triage
before settling the ownerless-property storage model (`AGENTS.md:1603-1606`). A third numbering
also exists: `AGENTS.md:1357` and `:1359` refer to "the orchestrator intake as ruling 4" and
"ruling 6".

Three unrelated numbering schemes, one label. **Whatever the owner decides, the label `R5` should
be retired in favour of a name.** This document proposes calling the subject of §2, if confirmed,
**"the core-is-canonical ruling"**.

---

## 2. The reconstructed statement of R5

Assembled from the four citations in §3. Each clause is marked **[QUOTED]** where the words appear
in a citation, or **[INFERRED]** where no citation says it and the clause was deduced.

> **1.** The shared Supabase `core.*` tables become the single source of truth for every
> application. **[QUOTED — appears in near-identical words in two independent citations.]**
>
> **2.** DesignFlow's private `dflow.*` copies of that same master data get **retired**.
> **[QUOTED — "the `dflow.*` tables get retired", "retires `dflow.*`".]**
>
> **3.** The retirement happens **table by table**, not in one movement.
> **[INFERRED.]** No citation contains the phrase "table by table". It is deduced from the
> citations' shape: they plan a "first domino", a "rehearsal" on "the least dangerous table", and
> an ordering in which DesignFlow is cut over "last, deliberately". The 2026-08-10 handoff
> (`HANDOFF.d/2026-08-10T2110Z-…:217`) calls it "shared-db's table-by-table ruling R5" — but that
> is a later AI restatement, not a source.
>
> **4.** The owner's stated top priority within the programme is **licensors and properties** — the
> licensing hierarchy that drives royalties and product filtering.
> **[QUOTED — `docs/age-group-cloudsql-migration-plan-20260804.md:54-55`.]** Note this is a
> priority statement attributed to Albert, and it may have been given separately from R5 itself.
>
> **5.** "Retired" here means the DesignFlow copy stops being written and stops being read, with
> DesignFlow's screens repointed at the shared source. **[INFERRED]** — from
> `docs/dflow-parent-logic-and-curation-home-20260803.md:299`, which describes "pointing
> DesignFlow's property picker at the shared source once R5 retires `dflow.*`".

**What R5 does NOT say, in any citation.** No citation gives R5 a date, an author quotation with
quote marks, a scope limit, a deadline, or an ordering relative to the Cloud SQL platform move.
No citation says R5 forbids a lift-and-shift. **The claim that R5 and `SUPABASE-MIGRATION.md`
contradict each other is itself an inference** — see the reconciliation document.

---

## 3. Every citation, quoted with a file:line anchor

### 3.1 `docs/cloudsql-first-migration-candidate-20260803.md:53-54`

> "**Why it is the right *first* domino and not a dead end.** Albert's R5 ruling says `core.*` in
> Supabase becomes the source of truth for every application and the `dflow.*` tables get retired."

Same file, `:79`:

> "**Rejected**: moving dead tables proves nothing and advances R5 not one inch."

First appearance anywhere: commit `ba4b6f6`, **2026-08-03 16:26 -0400**.

### 3.2 `docs/age-group-cloudsql-migration-plan-20260804.md:52-55`

> "The strategic goal (owner ruling R5) is that the shared Supabase `core.*` tables become the
> single source of truth for every application, and DesignFlow's private `dflow.*` copies get
> retired. Albert's stated top priority for that programme is **licensors and properties** — the
> licensing hierarchy that drives royalties and product filtering."

Introduced by commit `21201ce`.

### 3.3 `docs/dflow-parent-logic-and-curation-home-20260803.md:299` and `:311`

> ":299 — DesignFlow: retiring or type-restricting `PATCH /api/admin/updateMerchGroup`, and
> pointing DesignFlow's property picker at the shared source once **R5** retires `dflow.*`."

> ":311 — keeps working off `merchGroup.parent_id` until **R5** completes, so during the
> transition the two stores can disagree."

Introduced by commit `db874a1` / `56e142f`, **2026-08-03 16:22 -0400** — four minutes *before*
§3.1, and therefore the earliest surviving use of the label.

### 3.4 `docs/licensor-property-cloudsql-cutover-plan-20260806.md:530`

> "**DesignFlow** | It *is* the current source. Cutting it over is the actual retirement of
> `dflow.*` (owner ruling R5). | Last, deliberately."

Introduced by commit `50dc0b4`.

### 3.5 The two secondary restatements (not sources)

- `HANDOFF.d/2026-08-10T2110Z-al8960ofc-claude-orchestrator-first-production-promotion.md:217` —
  "shared-db's table-by-table ruling R5. Both are written as canonical."
- `HANDOFF.d/2026-08-11T0118Z-al8960ofc-claude-orchestrator-709-unblocked-disney-built.md:178` —
  records the finding that R5 "exists in **no file in this repo**".

**Provenance summary.** All four primary citations were written by AI sessions between 2026-08-03
and 2026-08-06, and the two earliest were written **four minutes apart on the same afternoon**,
which is consistent with a single session coining the label and a sibling session copying it. Every
later citation could be downstream of that one afternoon. **This is a reason for caution, not
proof of fabrication** — the sessions may have been quoting a real conversation held that day.

---

## 4. What the owner is being asked to do with this file

Read §2. Then one of:

- **Confirm it** — it becomes a real ruling, this header changes to CONFIRMED, and the label `R5`
  is replaced by "the core-is-canonical ruling" throughout.
- **Correct it** — say which clause is wrong.
- **Reject it** — the four citing documents get a dated pointer saying their stated strategic goal
  was never ruled, and their reasoning has to be re-derived.

Until then, treat every plan that rests on R5 as resting on an unconfirmed premise.
