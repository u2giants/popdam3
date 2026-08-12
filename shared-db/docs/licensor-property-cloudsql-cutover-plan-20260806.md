# Plan — move Licensors and Properties off Cloud SQL onto the shared Supabase database

**Date:** 2026-08-06
**Author:** sub-agent `cutover-plan`, dispatched by the `u2giants/shared-db` coordinator session.
**Status:** **PLAN ONLY.** No migration was written. No database was read or written by this agent —
not preview, not production, not Cloud SQL. Nothing here is approved for production.
**Branched from:** `origin/main` at `8db1959116b2caa8c38247ae9a00d3bb5f82afa6`.

**Who this is written for.** Two readers. (1) Albert Hazan, the owner, who is not a programmer.
(2) A developer who joined this morning and knows nothing about this project. Every technical term
gets a short plain-English tag in brackets the first time it appears.

> **READ §2 BEFORE §5.** This agent was asked to verify the nine blockers rather than repeat them.
> Seven held exactly as written. **One (blocker 8) is materially mis-stated in both the handover and
> the intake**, and one (the "almost entirely independent" claim used to justify working them in
> parallel) **is false**. Both findings change the order of work. They are new as of 2026-08-06.
>
> **This plan was independently reviewed by Grok 4.5 and revised as a result.** Two material defects
> it found — a wrong rollback story after phase 4, and a missing write-authority model for the
> dual-write window — are fixed in phase 5 and the new §5A. The full debate, including one Grok
> finding rejected as factually wrong and one it withdrew after challenge, is recorded at the end.

---

## 0. The short version

Licensors and Properties are the list of who owns a brand (the **licensor** — Disney, Warner) and
the individual brands underneath it (the **property** — Harry Potter, NASA). That two-level list
drives royalty reporting, product filtering and asset tagging across four applications.

Today the master copy lives in DesignFlow's own production database (Cloud SQL). Albert wants it to
live in the shared Supabase database instead, with one curated source of truth.

**This plan says: the move is achievable, but not in one step, and not in the order previously
implied.** Nine things block it. They are **not** independent of each other — one of them
(the broken production promotion lane) blocks *every other one from reaching production*, and one
of them (the overwriting import function) must be fixed *before* three others, or those three get
silently undone the first time the sync runs again.

The plan is **six phases**. Phases 1 and 2 are the trunk and cannot be parallelised. Phases 3 and 4
have genuine parallelism inside them. Phase 5 is the app-by-app cutover. Phase 6 retires the old
copy.

**Nothing in phases 1–4 changes what any user sees.** The first user-visible change is phase 5.

---

## 1. Verification statement — what this agent checked, and against what

Every citation in the dispatch brief was re-read at commit `8db1959116b2caa8c38247ae9a00d3bb5f82afa6`.
Where a claim is repeated below without comment, it verified as written.

| Claim | Verified? | Where checked |
|---|---|---|
| The nine blockers as listed | **Yes, verbatim** | `HANDOFF.d/2026-08-03T2359Z-t16-coordinator-licensor-property-priority.md:539-548`; restated `COORDINATOR_INTAKE.md:1779-1787` |
| 614 properties, 519 active, 111 unparented, 51 active-and-unparented | **Yes** | `docs/dflow-parent-logic-and-curation-home-20260803.md:120-138` (PR #433) |
| Master-data feed dead since 2026-07-08, silently (502) | **Yes** | `docs/licensor-property-parent-child-design-20260802.md:186-192` |
| The feed structurally cannot express an unparented property | **Yes** | same, `:160-185`; the payload is nested JSON, so a parentless property has nowhere to sit |
| `plm.import_master_data()` overwrites `licensor_id`, forces `status='active'` | **Yes** | `docs/google-sheets-import-authority-20260803.md` §2.1–2.2 |
| Three further overwrite paths | **Yes — and they are §2.6, §2.8, §2.9**, not §2.3/2.4 as the line numbers in the brief imply | `docs/google-sheets-import-authority-20260803.md:160,190,212` |
| Promotion lane aborts at file 3 of 14 | **Yes** | `docs/production-migration-lane-design-20260802.md:303-311` |
| Parent-child tree "does not gate the cutover" | **Technically accurate, but out of date and about a different workstream.** See §3. | `docs/master-data-cutover-scoreboard.md:211-213` |
| "Parent written by an unvalidated DesignFlow endpoint open to 5 roles" | **PARTLY FALSE — see §2. The number is right, the cited file is wrong, and the conclusion is unproven.** | See §2 |
| The nine blockers are "almost entirely independent" | **FALSE — see §4.** | `docs/age-group-cloudsql-migration-plan-20260804.md:349-351` |

**What this agent did NOT verify.** Nothing was checked against a live database of any kind. All
row counts quoted here are taken from PR #433's 2026-05-07 production snapshot and are re-quoted,
not re-measured. §9 lists what remains unknowable and what closes it.

---

## 2. Correction — blocker 8 is mis-stated, in a way that matters

The handover and the intake both say:

> *"The parent is written by an unvalidated DesignFlow endpoint open to 5 roles"*, citing
> `designflow-item-master\services\item_library.service.js:71-138`
> (`HANDOFF.d/…t16….md:305,548,874`; `COORDINATOR_INTAKE.md:1783,1889`).

Checked against the actual DesignFlow source at `C:\repos\dflow plm`:

**(a) The cited file is a READ endpoint, not a write endpoint.**
`item_library.service.js:71` is `getLicensorsWithProperties`, served at
`GET /api/item_master/lib/getLicensorsWithProperties`
(`designflow-item-master/routes/item_library.router.js:25`). It is the master-data feed that
shared-db *consumes*. It writes nothing. This is the same function
`docs/licensor-property-parent-child-design-20260802.md:160-185` correctly describes as the feed
that drops rows in three places.

**(b) The "5 roles" number is real, but it comes from a different file.**
The read endpoint is `authRole(['sourcing_manager','designer','vendor','sales','production'])` —
five roles. The *write* endpoint is a different route entirely:
`PATCH /api/admin/updateMerchGroup/`, `designflow-backend/routes/admin.router.js:87`,
`authRole(['designer','sourcing_manager','sales','production','admin'])` — also five roles, a
**different** five (`vendor` out, `admin` in). Whoever wrote the handover appears to have taken the
count from one route and the citation from the other. **The correct citation for "an unvalidated
write endpoint open to 5 roles" is `designflow-backend/routes/admin.router.js:87`.**

**(c) The claim that DesignFlow "DOES set the parent" is explicitly NOT VERIFIED in its own source
document.** `docs/dflow-parent-logic-and-curation-home-20260803.md:150-160` (§3) states, in terms:
*"Claim NOT VERIFIED: that the 503 existing edges were written by a human doing direct SQL … rather
than through `PATCH /api/admin/updateMerchGroup`."* The same document's §1.2 concludes the opposite
of the handover's summary: *"in DesignFlow, the Licensor → Property edge is hand-curated directly in
the database by a human with SQL access. There is no 'logic' to port."*

**(d) The endpoint is type-blind, which is the real defect.**
`designflow-backend/services/admin.service.js:510-554` fires only when
`!productSubType.parent_id && productSubType.is_active === false`, and its only UI
(`merch-group-dialog.component.ts`) offers Material / Construction / Feature — product types only,
no Licensor or Property branch. **But the service takes raw ids and never checks `mgTypeCode`.** A
direct API call from any of the five roles can pass a property (`mgTypeCode='06'`) as
`productSubType` and a licensor (`'05'`) as `productType`, and it will write the parent edge and
flip `is_active` to true. So the hazard is real; it is a **latent, reachable, unvalidated write
path**, not the routine writer of the 503 existing edges.

**Why this matters for the plan.** Under the handover's wording, blocker 8 reads as "an app is
actively corrupting the parent edge right now, stop it first." Under the verified facts it reads as
"an unused but open side door exists; close it before you make the shared copy authoritative, but it
is not urgent and it is DesignFlow app work, not shared-db work." That moves blocker 8 **out of the
critical path** and into phase 5. It also means the "five different roles are writing parents today"
sentence at `HANDOFF.d/…:308-309` should not be repeated; it is not supported.

### 2.1 Where the wrong wording still survives — and why it is not edited out

*Updated 2026-08-12 (issue #518). The original "recommended forward correction" here told a
stale-sweep agent to fix the citation in `COORDINATOR_INTAKE.md`. That instruction is dead:
`COORDINATOR_INTAKE.md` was retired on 2026-08-07 and is now a 38-line pointer that no longer
contains the blocker-8 text at all.*

Every editable document in this repository now either states blocker 8 correctly or points here.
Re-verified 2026-08-12: the mis-statement survives in exactly **one** file —

| File | Lines |
|---|---|
| `HANDOFF.d/2026-08-03T2359Z-t16-coordinator-licensor-property-priority.md` | 307, 308-309, 548, 874 |

(The later `HANDOFF.d/2026-08-06T0330Z-al8960ofc-coordinator-session-handover.md` already carries
the correction at its lines 268-272 and 344-346. It is not a source of the error.)

That file is a **write-once session record.** `AGENTS.md` forbids one session editing another's
`HANDOFF.d/` file, and rewriting a historical record to say something it did not say is the wrong
repair in any case. **This section is the correction of record**, together with issue #518.

**If you arrived from that file:** the endpoint it cites —
`designflow-item-master\services\item_library.service.js:71-138` — is a **READ** endpoint. The real
writer is `PATCH /api/admin/updateMerchGroup` at `designflow-backend/routes/admin.router.js:87`, and
its defect is **type-blindness** (§2(d)), not unvalidated routine parent-writing. The sentence
*"five different roles are writing parents today"* is **not supported** — do not repeat it.

**The endpoint fix itself is NOT shared-db work.** It lives in `designflow-backend`, a repo in the
`popcre` org, and follows the dflow process: branch `sandbox-albert`, PR to `develop`, never `main`,
never self-merged. It is sequenced at the DesignFlow cutover (phase 5, table row 4(a)), not on the
critical path. Nothing in this repository can close it.

---

## 3. Resolving the scoreboard contradiction

`docs/master-data-cutover-scoreboard.md:211-213` says:

> *"Sequencing decision (Albert, 2026-07-23): point at the new tables first, migrate the
> relationships afterwards. The licensor→property tree does not gate the cutover — it is a second,
> separable step sourced from dflow. Do not hold the sync hostage to it."*

This appears to contradict blockers 3 (111 orphans) and 4 (no curation path). **It does not, once
scoped — but it must not be quoted in support of this plan.** Three reasons:

1. **It is about a different cutover.** Read in context (§6 of that document, items 1–4), the
   "cutover" being sequenced is the **ColdLion source-of-truth repointing** — building
   `plm.erp_licensor` / `plm.erp_property` mirrors and repointing promotion at them. Its item 3 is
   *"migrate the licensor→property relationship from dflow as its own change"*. It is sequencing two
   shared-db-internal steps against each other. It says nothing about the four applications moving
   off Cloud SQL, which is what this plan is.
2. **It predates the facts.** The decision is dated **2026-07-23**. The 111 orphans were measured on
   **2026-08-03** (PR #433) and explicitly *"overturned the previously-held 'zero orphans' claim"*.
   The absence of any curation path was established **2026-08-02** (PR #427). A sequencing decision
   cannot have accounted for evidence discovered eleven days later.
3. **What it says remains true and useful.** The tree is separable *from the ColdLion sync work*, and
   the sync should not be held hostage to it. That is compatible with the tree gating **the point at
   which apps are told the shared copy is authoritative**, which is what blockers 3 and 4 assert.

**Ruling for this plan:** the tree does **not** gate phases 1–3. It **does** gate phase 5 (app
cutover), because the moment an app is told "read the shared copy instead", 51 active properties with
no parent become 51 properties that vanish from a cascading picker. **The scoreboard line should be
annotated, not deleted** — it is correct about the sync and wrong if generalised. That annotation is
owned by whoever owns `docs/master-data-cutover-scoreboard.md`, not by this agent.

---

## 4. The dependency graph — and why "almost entirely independent" is false

### 4.1 Where the claim comes from

`docs/age-group-cloudsql-migration-plan-20260804.md:349-351` ends its otherwise-excellent §6.1 with:

> *"The licensor/property blockers in §9.1 of the 2026-08-03 handover are almost entirely
> independent of the promotion lane and can be worked in parallel starting today."*

Note the precise wording: independent **of the promotion lane**. That narrower claim is *half* true
— design and authoring work does not need the lane. But the sentence has since been quoted as if it
said the nine blockers are independent **of each other**, which is a different and false claim. This
plan tests it properly.

### 4.2 The hard edges (X must precede Y, and why)

**Edge 1 — B5/B6 (stop the overwrites) → B2 (revive the dead sync). NON-NEGOTIABLE.**
This is stated as an explicit prohibition in the design's own out-of-scope list
(`docs/google-sheets-import-authority-20260803.md`, "Out of scope, deliberately"):
*"Repairing the dead `plm_master_data_api` endpoint — **that must not be done first**; repairing it
before Steps 1–3 re-arms the overwrite."* The sync being dead is currently the **only thing
protecting curated data**. Fixing blocker 2 before blocker 5 actively makes the system worse.

**Edge 2 — B5/B6 → B7 (fix the 9 wrong parents). NON-NEGOTIABLE.**
Correcting Harry Potter and NASA out from under DISNEY writes `core.property.licensor_id`. While
`plm.import_master_data()` still re-derives `licensor_id` from the feed's nesting, the next
successful run reverts the correction. Doing B7 first means doing it twice.

**Edge 3 — B5/B6 → B4 (curation path). NON-NEGOTIABLE.**
Same mechanism, stated at `docs/dflow-parent-logic-and-curation-home-20260803.md:320-322`:
*"Step 0 (disarming the `licensor_id` overwrite in `plm.import_master_data()`) still blocks
everything, and still must land before any revival of the master-data feed — otherwise the first
successful run reverts every curated ruling."*

**Edge 4 — B4's audit table → B7. STRUCTURAL.**
The design requires every parent change to carry a named human and evidence
(`…design-20260802.md:346-380`, principle P1, enforced by CHECK constraints). A backfill correcting
9 rows is itself a parent change. It needs `core.property_parent_audit` to exist, with
`source_channel = 'owner_ruling'` (already in the CHECK list at `…design-20260802.md:355`). It does
**not** need the RPC, the proposal table, or any UI. So B7 depends on a *fragment* of B4, not all
of it — this is the single most useful parallelism in the whole graph.

**Edge 5 — B3's measurement → B3's decision → B4's health view. STRUCTURAL.**
`…design-20260802.md:459-476` (§5.6) recommends *"do nothing here until the count is known"* and
offers Option A (sentinel `UNASSIGNED` licensor) vs Option B (relax `NOT NULL`). The count is now
obtainable (see §9). Until it is decided, `is_orphan` in the health view
(`docs/dflow-parent-logic-and-curation-home-20260803.md:243`) is hardcoded false — the doc says so:
*"once step 5 makes orphans representable — until then always false"*. A curation screen that cannot
show the orphans is a curation screen that cannot fix them.

**Edge 6 — B9 (promotion lane) → production delivery of B5, B6, B7 and B4. NON-NEGOTIABLE, and it
is the one the "independent" claim misses entirely.**
Every one of those blockers closes with a migration. A migration that cannot reach production has
not closed anything. The lane aborts at file 3 of 14
(`docs/production-migration-lane-design-20260802.md:303-311`), and worse, it aborts *after* applying
and recording files 1 and 2 — leaving a **partially promoted production database**. So B9 is not a
peer of the other eight; **it is the trunk they all pass through.** Design work parallelises; delivery
does not.

**Edge 7 — B2, B3, B4, B7 → B1 (app cutover). NON-NEGOTIABLE.**
You cannot tell four applications to read the shared copy while the shared copy is a frozen,
incomplete snapshot (256 of 614 properties, 26 of 82 licensors — `…20260803.md:135-138`) that nobody
can correct.

**Edge 8 — B8 → B1, but only for DesignFlow.** Closing the type-blind write endpoint matters at the
moment DesignFlow stops being the owner of the edge, not before.

**Edge 9 — B3's *representation decision* (not merely its measurement) → B1. NON-NEGOTIABLE.**
*(Added after Grok review; this plan originally understated it as "B3 → B1".)* Measuring the orphans
changes nothing on its own. Until the schema can **hold** an ownerless property — sentinel or
nullable — 51 active properties fall out of every cascading picker the moment an app is told the
shared copy is authoritative. The decision, not the count, is the gate.

**Edge 10 — P4 (data correction) → the *limits* of every P5 rollback. STRUCTURAL, and it changes
what "rollback" means.** *(Added after Grok review.)* Once the shared copy holds corrected parents
and `FR` is gone, the Cloud SQL copy is **no longer a clean mirror** — it still holds the known-bad
parents. Repointing back therefore reinstates data we deliberately fixed. See §5, phase 5.

**Edge 11 — the owner ruling on Harry Potter / NASA → B7 *execution*, though not its
evidence-gathering.** Desk research parallelises; the write does not.

**Edge 12 — the `FR`-removal window couples P2 and P4 as a delivery constraint.** PR #408 must ship
in the same production window as the `FR` removal (`AGENTS.md` §6.5). This is a scheduling edge, not
a design edge, but it is hard.

### 4.3 What genuinely runs in parallel

| Can run at the same time | Why it is safe |
|---|---|
| **B9 lane repair** ∥ **B5/B6 function rewrite** ∥ **B4 object authoring** | Three different files, three different agents, no shared object. The lane touches `.github/workflows/` and `scripts/`; B5/B6 touches `plm.import_master_data()`; B4 adds new `core.*` objects. |
| **B3 measurement** ∥ **everything** | Two `SELECT count(*)` statements against a read-only Cloud SQL account. Cannot affect anything. |
| **B7 evidence-gathering** ∥ **B5/B6** | Establishing *which* licensor Harry Potter and NASA belong under is desk research and an owner ruling. Only the *write* is gated. |
| **B1 app-code survey** ∥ **everything** | Reading four repositories to find every read of licensor/property. Nobody has done this and it is on the critical path for phase 5. |
| **B8 DesignFlow endpoint fix** ∥ **phases 1–4** | Different repository, different team, different release train. |

### 4.4 The graph in one picture

```
                    ┌──────────────────────────────────────────┐
                    │  B9  promotion lane repair               │  ← TRUNK: everything
                    │  (blocks PRODUCTION delivery of all)     │    below must pass through
                    └────────────────────┬─────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
   B5 + B6                          B4 (part 1)                      B3 (measure)
   stop the overwrites              audit table                      count orphans
        │                                │                                │
        │                                ├──────────┐                     │
        ├────────────────┬───────────────┘          │            B3 (decide: sentinel
        │                │                          │             vs nullable) ← ALBERT
        ▼                ▼                          ▼                     │
   B2 revive sync    B7 fix 9 wrong parents    B4 (part 2)                │
   (MUST be after)   (owner ruling first)      RPC + proposals + view ◄───┘
        │                │                          │
        └────────────────┴──────────┬───────────────┘
                                    ▼
                        B1  app-by-app cutover  ◄──── B8 (DesignFlow only)
                        PopDAM → poppim → popcrm → DesignFlow
```

**Verdict on the "independent" claim:** of the 36 possible pairs among nine blockers, **eight are
hard-ordered** (edges 1–5, 7, 9, plus 6 as a delivery gate) and one blocker (B9) gates the
production delivery of four others. That is not
"almost entirely independent". The accurate statement is: **the design and authoring work
parallelises across three or four agents; the delivery is a single-file queue behind a lane that
does not currently work.**

---

## 5. The phased plan

Every phase names one deliverable. Every step says how you know it worked in terms of an observable
outcome, never "the migration applied" — this repository has already seen a ledger row whose object
was absent (preview, 2026-07-23) and a fix that looked right and did nothing (PR #406).

### Phase 1 — Make production reachable at all
**Deliverable:** a production promotion run that applies an approved list end-to-end and is proven by
object existence, not by the ledger.

| Step | What |
|---|---|
| 1.1 | Implement the lane fix designed at `docs/production-migration-lane-design-20260802.md` §2.3 — the `--include-all` change against a bounded checkout, plus the §2.3-C **closure check** that would have caught the file-3 abort. Acceptance gate is that document's §9. |
| 1.2 | Resolve the `20260726180000` predecessor problem. Files `20260727221500` and `20260728134500` need `20260726180000`, which is in `HARD_BLOCKED`. Either the owner unblocks phase4/phase6 (making it an 18-version list, `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000` inserted at positions 3–6) or those two versions come out of the list. **This is an Albert decision — see §8, decision 1.** |
| 1.3 | Clean the preview database first: unacknowledged alerts to zero each with a stated reason, circuit breaker closed with an authorised reset recorded, a fresh health observation passing on its own merits and not on a pinned hash. (Lifted from `docs/age-group-cloudsql-migration-plan-20260804.md` step B1 — this gate is table-independent and applies here unchanged.) |
| 1.4 | Optionally run the `age_group` rehearsal (`docs/age-group-cloudsql-migration-plan-20260804.md`) **time-boxed to one afternoon.** See the honesty note below. |
| 1.5 | **Write the mid-promote failure runbook.** *(Added after Grok review — this was the thinnest part of the first draft.)* See below; this is a deliverable, not a note. |
| 1.6 | **Run track 3B in parallel here, not in phase 3.** *(Moved after Grok review.)* The orphan measurement and the representation decision (§8, decision 3) gate app cutover design, not just the health view, and they cost two `SELECT`s plus one owner ruling. Start them on day one. |

**Note on current production state.** Production is **clean**. Files 1 and 2 of the fourteen are
**not** applied. `docs/production-migration-lane-design-20260802.md:303-311` describes what *would*
happen **if** the lane were run to apply today — it is the hazard the closure check exists to
prevent, not a condition to be repaired. There is no partial state to reconcile before phase 1.
*(Recorded because a reviewer misread it as current state; see the review section.)*

**Step 1.5 — the mid-promote failure runbook.** Required content, because the usual answer is
forbidden here:
- **PITR is excluded, explicitly and in writing.** Restoring production would discard every
  application write across all four apps since the restore point.
- **Forward repair only.** A migration that fails mid-batch is corrected by a new migration with a
  later version, never by editing or re-running the failed one.
- **Object-level verification, not ledger verification.** After every promotion, assert each
  expected object with `to_regclass` / a `pg_proc` count. A ledger row is a statement about the
  list, not about the database.
- **Stated stop rules.** On the first failure the operator stops, publishes the exact set of applied
  versions, and does not attempt the remainder. A half-applied batch that someone keeps pushing
  through is how a recoverable failure becomes an unrecoverable one.

**Exact versions in scope of the current 14-version list:** `20260724060000`, `20260724061000`,
`20260727221500`, `20260727223000`, `20260727224500`, `20260728134500`, `20260729230000`,
`20260729234500`, `20260729235500`, `20260730000500`, `20260731163000`, `20260731180000`,
`20260731190000`, `20260731200000`.
**Hard-blocked and excluded:** `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000`.

**Honesty note on the rehearsal.** `docs/age-group-cloudsql-migration-plan-20260804.md` §6.1 lines
up nine properties that make licensor/property hard and answers "no" to all nine for `age_group`.
That document is right and this plan adopts its conclusion without softening it: **the rehearsal
proves the promotion machinery and the deployment sequence. It does not de-risk licensor/property.**
Its own §8 further found that no DesignFlow screen reads `age_group` at all, so it does not even
rehearse a repointed read. Do it because the lane is broken for every table equally and finding that
out on a two-row table costs an afternoon. Do not let it become the reason licensor/property waits,
and do not let anyone report "licensor/property is now de-risked" afterwards.

**Rollback.** Steps 1.1–1.2 are code and CI changes; revert the commit. Step 1.3 is forward-only —
acknowledging an alert and resetting a breaker cannot be undone, and should not need to be; if state
was closed wrongly, let the underlying condition raise a **new** alert. Step 1.4's rollback is to
repoint DesignFlow config back at `dflow.age_group`, which is untouched throughout.
**Note the rollback that does NOT exist:** `docs/production-migration-lane-design-20260802.md:515-519`
states that Supabase PITR would discard every application write across all four apps since the
restore point, and **must not be proposed as a rollback for a partial migration batch.** The only
real protection is not producing a partial batch — which is what step 1.1 buys.

---

### Phase 2 — Stop the shared copy destroying curated data
**Deliverable:** `plm.import_master_data()` can no longer overwrite a human's decision, proven by a
regression test that fails if anyone re-adds an unguarded assignment.

Implements `docs/google-sheets-import-authority-20260803.md` §5, steps 1–3b and 5.

| Step | What | Closes |
|---|---|---|
| 2.1 | Promote `20260802170000` (status durability) and `20260802171000` (FRIENDS TV / FRIDA KAHLO ruling) to production. Both are merged to `main` and absent from production. **Smallest possible first move.** ⚠️ `20260802171000` only marks `FR` inactive and is **SUPERSEDED** by Albert's 2026-08-03 ruling that `FR` must be **removed entirely** — promote it for the FRIDA KAHLO half, then supersede it forward. | part of B5 |
| 2.2 | Stop writing `core.property.licensor_id` on an existing row. INSERT-only. Disagreements land as evidence in a quarantine row, following the `plm.coldlion_promotion_quarantine` pattern — never silently reconciled. | B5 |
| 2.3 | Fix the match scoping **in the same migration as 2.2**. Making `licensor_id` INSERT-only does not close §2.8 and can worsen it: a disagreement that used to re-parent will instead fall through to an INSERT and create a live duplicate. Un-scope keys 2–3 so a curated row under a different parent is still found, and treat key disagreement as a **possible match to quarantine**, not an absence to insert. | B6 |
| 2.4 | `name`: allow rewrite only when normalized-equivalent (case/whitespace), refuse otherwise. `code`: INSERT-only — a code is an identifier, and a "normalized-equivalent" code change is a re-key, not a cosmetic fix. | B6 |
| 2.5 | `core.taxonomy_source_ref.confidence`: `coalesce(existing, 'verified')` on conflict, or drop it from the `do update` set. All 505 of 505 production rows are currently `verified`, so nothing is being destroyed today — this forecloses the path before anyone starts curating link confidence. | B6 |
| 2.6 | Regression test asserting `plm.import_master_data` contains no unguarded `licensor_id =` / `status =` / `name =` assignment in an UPDATE branch, mirroring `tools/coldlion-licensor-property-phase*.test.mjs`. | B5+B6 guard |

**Deliberately NOT in this phase:** Step 4 of that document (a per-field `curated_fields` marker).
Steps 1–3b satisfy the ruling on their own, and the doc marks Step 4 as undesigned. **Constraint
carried forward:** do not put any curation record in `core.licensor.metadata` /
`core.property.metadata` — the import stamps that jsonb on every matched row and would overwrite the
very marker meant to restrain it.

**Standing rule to state in the migration comment — "the feed is not authoritative for absence."**
*(Adopted from the Grok review; it is a stronger and more general statement of the rule than
anything currently written down in this programme.)* **A row being omitted from the feed does not
mean delete, does not mean deactivate, and does not mean re-parent.** The importer must not touch
rows it did not match. This matters more here than anywhere else, because the feed *structurally
cannot* send an unparented property — so under any absence-implies-something rule, every orphan the
curation path creates would be destroyed by the next successful import.

**Acceptance test.** Run the importer twice in preview against a row whose `licensor_id`, `status`,
`name`, `code` and `confidence` have each been deliberately set to a value the feed disagrees with.
All five survive both runs. A quarantine row exists for each disagreement. Paste the rows.

**Three additional regression cases, added after the Grok review.** Making `licensor_id`
INSERT-only is not sufficient on its own; these are the paths that would silently reinstate the
overwrite, and each must have a test that fails against the old function:
1. **A leftover `UPDATE` of `licensor_id`** anywhere in the function — including in a branch the
   happy path does not reach.
2. **A DELETE-then-re-INSERT path**, which changes the parent without ever issuing an `UPDATE` and
   therefore passes a naive "no UPDATE" assertion.
3. **Any auto-apply from quarantine.** A quarantine row that promotes itself is the overwrite
   wearing a review queue as a disguise — the same trap already named for the proposal table.

**Rollback.** Every step here **removes a write**. None adds one. None can break a reading
application. Rollback is reverting to the prior function definition, which is strictly *more*
destructive — so the rollback is worse than the failure it would undo. Prefer forward fix.

---

### Phase 3 — Build the curation path (three tracks in parallel)
**Deliverable:** a named human can change a parent, with evidence, and the change is recorded
structurally — plus the orphan question is answered and decided.

**Track 3A — the database objects.** Per `…design-20260802.md` §5.2–5.5 and
`…curation-home-20260803.md` §5.2, in this order:
1. `core.property_parent_audit` (append-only; `decided_by` and `decision_evidence` both CHECK
   non-blank; `source_channel` CHECK in `owner_ruling | curator_ui | migration_backfill |
   db_data_admin | out_of_band`; plus `decided_by_uid` from `auth.uid()`).
2. **The unconditional trigger** on `core.property` that writes an audit row whenever `licensor_id`
   changes, tagging anything not arriving via the RPC as `out_of_band`. Without this, a
   `service_role` UPDATE leaves no trace — and `service_role` is currently the *only* role that can
   write at all.
3. `core.set_property_licensor(...)` — `SECURITY DEFINER`, gated on
   `app.require_db_data_admin_access()` (**not** `public.app_role`, which is `admin | user` only and
   cannot express a curator), with optimistic concurrency (`p_expected_updated_at` →
   `code='stale_token'`), idempotency (`p_operation_id`), and a returned **stale-pair consequence
   list** of `dam.asset` / `dam.style_guide` rows whose stored pair no longer agrees. Warn and list;
   never auto-rewrite.
4. `core.property_parent_proposal` — landing pad only. **No trigger ever promotes an accepted
   proposal into `core.property`.** Accepting a proposal and moving an edge are two separate acts.
5. `api.db_data_admin_property_parent_health` and `api.licensor_property_picker`, both
   `security_invoker = true` (three views in this repo leaked ~16,600 rows to `anon` by omitting it).
   Filter predicate `status in ('active','potential')`, not `= 'active'` — there are 5 `potential`
   licensors and a picker that hides them breaks prospective-licensor workflows.

**Standing prohibition to restate in the migration comment:** `authenticated` must never be granted
`INSERT`/`UPDATE`/`DELETE` on `core.property`. Curation goes through the RPC or it does not happen.
Also restate `revoke execute … from public, anon; grant execute … to authenticated, service_role;`
explicitly — silence is not a grant.

**Track 3B — the orphan measurement and ruling.** Now unblocked by the read-only Cloud SQL account
(1Password item `tcaf3o3u2cx52g6ivvczxbhola`, user `albert_read_only`, SELECT only, schema
`designflow`) reached through the Cloud SQL Auth Proxy service account (item
`zjrrpl4yyotjbrfu56zayaj63i`, `roles/cloudsql.client` only). Run the two queries already written at
`docs/dflow-parent-logic-and-curation-home-20260803.md:165-185` — Q1 (`pg_trigger` / `pg_proc` for
anything inside the database writing `parent_id`) and Q2 (the live counts plus `modUser`
distribution). Then Albert rules sentinel vs nullable (§8, decision 3).

**Track 3C — the DB Data Admin UI.** Application work, not shared-db. Replaces the
`apps/db-data-admin/src/LicensorTree.tsx:152` copy that currently tells the user *"The relationship
is DesignFlow-owned; do not repair it here"*, and forward-corrects
`20260722170000`, which lists "Licensor/Property" under "Refused here". Both statements become wrong
the moment track 3A lands, and **corrections are forward only — never edit an applied migration.**

**Acceptance test.** In preview: call `core.set_property_licensor` as a user without the DB Data
Admin gate → rejected. With blank evidence → rejected. Against a collision → plain-English error
naming both properties. Successfully → the edge moves, one audit row exists with `curator_ui`. Then
change the same edge by direct `service_role` UPDATE → a second audit row exists tagged
`out_of_band`. That last one is the test that proves the trigger, and it is the one most likely to be
skipped.

**Rollback.** Tracks 3A steps 1–5 are purely additive — new tables, one function, two views, one
trigger. Rollback is `drop`, and nothing existing changes type, nullability or meaning, so nothing
else breaks. **Exception:** the trigger is the one object with a live blast radius, because it fires
on an existing table. If it misbehaves, drop the trigger alone; the audit table survives with its
history intact.

---

### Phase 4 — Correct the data
**Deliverable:** the shared copy is complete and correct enough for an application to trust it.

| Step | What | Notes |
|---|---|---|
| 4.1 | Fix the 9 wrong parents — 34 Harry Potter products and 38 NASA products currently filed under DISNEY. | Backfill migration writing through the audit trail with `source_channel = 'owner_ruling'`. **Needs the owner ruling on the correct parent first** (§8, decision 4). Note the wording in the intake is ambiguous: "9 properties" against "34 + 38 products" — 34 and 38 are **product counts**, not property counts. Confirm the actual property count before writing the migration. |
| 4.2 | Execute the 7-step mapping sequence in the exact order Albert fixed on 2026-08-03: import `FK`, `NA`, `ZG`; re-point property `FK`; re-home anything under `FR`; reconcile `X-NASA` → `NA`; **remove `FR` LAST**. | ⚠️ Rulings are FINAL after two reversals — do not re-litigate. `FR` is **removed entirely**, not marked inactive. FRIDA KAHLO **stays** as a real licensor. X-NASA **goes**. |
| 4.3 | Record every ruling in `core.taxonomy_owner_ruling`. | |
| 4.4 | Revive the master-data feed (the dead 502 endpoint). **ONLY after phase 2 is in production.** | This is the edge that must not be crossed early. |
| 4.5 | Backfill an audit row for each of the existing 256 parented properties with `source_channel = 'migration_backfill'` and `previous_licensor_id` null. | Makes the audit trail complete from day one rather than starting mid-history. |

**⚠️ Standing constraint on 4.1 and 4.2:** division attribution in ColdLion is **UNRELIABLE and must
not be used as evidence.** Parent-child links are hand-curated, never inferred from product
co-occurrence. Co-occurrence may only produce a `core.property_parent_proposal` row for a human to
rule on.

**⚠️ Pairing constraint:** PR #408 is merged to `main` but **HELD from production** and must ship as
one production change with the `FR` removal work (`AGENTS.md` §6.5). Any production window in this
phase must respect that pairing.

**Acceptance test.** `FR` does not exist. `X-NASA` does not exist. FRIDA KAHLO exists and is a
licensor. No property's `licensor_id` points at a removed row. Every one of the 9 corrections has an
audit row with a named decider and non-blank evidence. A snapshot of all property statuses was taken
**before** 4.2 started and is stored — there is no history table, so without it "go back and
inactivate again" is guesswork.

**⚠️ The `FR` snapshot is a mandatory gate, not a note.** *(Raised after Grok review.)* Before step
4.2 begins, a snapshot of the status of all 256 properties must be **taken, timestamped, stored at a
named path, and verified readable by a second person.** There is no history table; without the
snapshot, "go back and inactivate the ones we had turned off" is guesswork. A step 4.2 that starts
without a verified snapshot is a step that has no rollback at all.

**Rollback.** 4.1 and 4.5 are reversible: the audit table records `previous_licensor_id`, so the
prior state is recoverable row by row. **4.2 is NOT reversible** — removing `FR` destroys a row, and
the correct rollback is the pre-taken snapshot, not a database restore. Take the snapshot or do not
start.

**⚠️ What this phase does to every later rollback.** From the moment 4.1 and 4.2 land, the Cloud SQL
copy still holds the known-bad parents and the `FR` row. It has stopped being a clean mirror of the
truth. **Every rollback in phase 5 is therefore a connection rollback, not a data rollback** — see
phase 5. 4.4 is reversible by disabling the feed again.

---

### Phase 5 — App-by-app cutover (blocker 1)
**Deliverable:** each application reads licensor and property from the shared Supabase copy, one
application at a time, with a working rollback between each.

Nobody has ever sequenced this. The order below is derived from coupling strength, ordered
**weakest coupling first** so that the riskiest application cuts over last against machinery already
proven three times.

**Step 5.0 — the survey that must come first.** For each of the four applications, produce a written
list of every place licensor or property is read or stored, against a named commit SHA. This does
not exist for any application. Two known gaps: `poppim-web` and `popdam3` were never checked for
client-side status filtering (`docs/parent-child-answers-20260803.md` "What I could not verify",
row 2), and both repositories **do** exist on this machine now (`C:\repos\poppim-web`,
`C:\repos\popdam3`, `C:\repos\popcrm-web`), so the reason that check was skipped no longer applies.

**Order and rationale:**

| # | App | Coupling today | Why here |
|---|---|---|---|
| 1 | **popcrm-web** | Weakest. Reaches the edge only through `api.global_search`. | Cheapest possible real cutover. One query surface. If it breaks, one search result set is wrong and nobody's data moves. Proves the read path with near-zero blast radius. |
| 2 | **poppim-web** | Reads via `api.pm_product_board` / `api.pm_product_assets`. `pim.product`, `pim.product_submission` and `pim.project` all carry **real FKs** to `core.licensor` / `core.property` — i.e. they **already reference the shared tables**, not Cloud SQL. `pim.product.property_id` currently holds **0 rows**. | ⚠️ **This may not be a cutover at all.** If the FKs already target `core.*`, poppim is structurally on the shared copy already and there is no Cloud SQL dependency to sever — only read paths to confirm. **Phase 5.0 must settle this.** If it confirms, poppim drops out of the sequence and becomes a read-path verification, and the order becomes popcrm → PopDAM → DesignFlow. |
| 3 | **PopDAM** | **Highest data exposure.** Hard FKs on `dam.asset.licensor_id/property_id` and `dam.style_guide.licensor_id/property_id`, populated. | Every re-parent makes a stored `(licensor_id, property_id)` pair potentially stale. Requires the phase 3A stale-pair consequence list to be live and the DB Data Admin panel to warn on it. ⚠️ **PopDAM Master Data open writes are INTENTIONAL — never restrict them** (`AGENTS.md` §0.4). |
| 4 | **DesignFlow** | It *is* the current source. Cutting it over is the actual retirement of `dflow.*` (owner ruling R5). | Last, deliberately. Three things must land with it, all app-team work: (a) `PATCH /api/admin/updateMerchGroup` rejects `mgTypeCode` `'05'`/`'06'` outright or is retired — **this is blocker 8**; (b) the client-side cascade at `newItem-dialog.component.ts:1227-1228` repoints at `api.licensor_property_picker`; (c) `itemReferenceGuard.js:123-130` starts validating that the property actually belongs to the licensor, which it has never done. |

**Where the "closing window" actually belongs.** *(Corrected after Grok review — the first draft used
it as a phase 5 ordering argument, and both parties agreed that was wrong.)* `pim.product.property_id`
holding zero rows is a **phase 4 deadline, not a phase 5 ordering argument**: finish the Harry
Potter / NASA and `FR` corrections **before** poppim starts writing `property_id` rows, so that
product rows never accumulate against a tree still known to be wrong. It says nothing about which
app to cut over first.

**The dual-writer window is the real risk of phase 5.** Between steps 1 and 4, DesignFlow still
writes `merchGroup.parent_id` and shared-db holds the curated edge. Two writers of one fact is the
exact condition that produces silent drift. Two mitigations, both required:
- The `parent_edge_hash` drift detector (`20260726180000`) will flag **every legitimate curation as
  drift** unless it is taught to recognise a ruled change. That teaching is an owner decision already
  outstanding. **Do not start phase 5 with an alarm that cries wolf on every correct action** — this
  repo already has a documented incident where a correct action was indistinguishable from an
  accident because nothing recorded it.
- Keep the window short. Do not park between step 2 and step 3 for weeks.

**Rollback, per step — and the correction that matters most in this document.**
Each of steps 1–4 is a configuration/read-path repoint with the Cloud SQL copy left **completely
untouched**, so repointing back is always mechanically available. **But after phase 4, repointing
back is a CONNECTION rollback, not a DATA rollback.** *(This was wrong in the first draft and is the
sharpest finding of the independent review.)*

Concretely: Cloud SQL still holds Harry Potter and NASA under DISNEY, and still holds `FR`. Rolling
an app back onto it therefore **reinstates the exact data we deliberately corrected.** So:

- **Valid reason to roll back:** the app cannot read the shared copy — a connection, permission,
  view-shape or performance failure. Roll back freely.
- **NOT a valid reason to roll back:** the data looks wrong. Rolling back makes it *more* wrong, not
  less. A data-quality failure after phase 4 is fixed **forward**, through the curation RPC.
- **State this in the runbook and in each cutover PR**, because "roll it back" is the reflex, and
  here the reflex is harmful.

Step 4 carries one addition: if DesignFlow's endpoint was already retired, restoring it is a code
revert on the app team's release train, not an instant switch — so **retire the endpoint in a
separate, later release than the read repoint**, so the two rollbacks stay independent.

---

### 5A. The dual-write authority model

*(This section did not exist in the first draft. The independent review identified its absence as
the single largest unaddressed risk in the plan, and the model below is adopted from that review.)*

Between the first app cutover and the DesignFlow cutover, two databases hold the same fact and both
are being written. The plan previously named that risk and stopped. This is the missing model.

**Who may change a parent, during the window**

| Actor | May change `core.property.licensor_id`? |
|---|---|
| A curator, via `core.set_property_licensor` | **Yes**, for existing rows. Always audited. |
| The PLM feed, after phase 2 | **INSERT of new rows only. Never an UPDATE of a parent.** |
| Direct SQL / any non-RPC write | Physically possible for `service_role`; the trigger tags it `out_of_band`. **Treat as an incident, not a process.** |
| DesignFlow UI / the `PATCH` endpoint | Cloud SQL only. **Not authority** for any app already cut over. |

**Shared is the parent authority** for every app already on the shared copy. Cloud SQL remains
DesignFlow's working copy until its own cutover. **The consequence is accepted deliberately:
DesignFlow users may see a different parent than the other three apps, for the duration of the
window.** Albert should be told this in advance rather than discovering it as a bug report.

**What wins on conflict**

1. **Existing shared row vs the next import:** the shared parent wins, always. The import never
   overwrites; it writes a quarantine row recording the shared parent, the feed parent, the match
   keys and the import run id.
2. **Quarantine vs a human:** only a human, via `core.set_property_licensor`, can promote a
   quarantined disagreement into a change. **No auto-accept, ever.**
3. **Cloud SQL vs shared:** shared wins for cut-over apps. Do not "fix" the shared copy to match
   DesignFlow without a ruled curation.
4. **The drift alarm:** silence it only for channels that are trusted by construction —
   `owner_ruling`, the curator RPC, and `plm_feed_insert` for genuinely new rows. It must still
   alarm on an unruled `out_of_band` write, on quarantine growth, and on any feed `UPDATE` of
   `licensor_id` (which after phase 2 should be impossible, and therefore means phase 2 regressed).

**Kill criteria — any one of these stops the feed and freezes parent writes except emergency curation**

- Any import run that **updates** `licensor_id` at all (a phase 2 regression).
- Quarantine open count above an agreed number, or rising across consecutive imports with nothing
  being cleared.
- `parent_edge_hash` drift that cannot be matched to an audit row.
- The window running past an agreed wall-clock date with DesignFlow still not cut over. **Pick the
  date before the window opens, not during it.**
- Properties active in DesignFlow but absent from the shared copy rising above a threshold — the
  feed cannot carry unparented rows, so this gap grows silently by design.
- A business check failing: a royalty or licensee report mismatch beyond an agreed tolerance.

**How orphans survive a feed that structurally cannot represent them**

This is the hardest part of the window, and the plan had no answer for it before the review.
The rule, in one line:

> **`UNASSIGNED` is a shared-side holding pen. The feed can only ever *propose to leave* it, via
> quarantine. The feed can never *assert* it and never *clear* it by omission.**

Which unpacks to six rules:

1. `UNASSIGNED` is a real `core.licensor` row, used **only** in the shared copy. Do not attempt to
   round-trip it through the feed.
2. **The feed is not authoritative for absence.** Omitted from the feed does not mean delete,
   deactivate or re-parent. The importer must not touch rows it did not match. (Also stated as a
   standing rule in phase 2.)
3. **Match, then disagree — never twin.** If the feed later sends a property that already exists
   under `UNASSIGNED`, match it on its durable keys. `UNASSIGNED` versus the feed's nested licensor
   is a **quarantine**, not an INSERT and not a silent UPDATE.
4. **New DesignFlow orphans will never appear in the feed at all**, because the payload structure
   cannot express them. They stay DesignFlow-only until either someone parents them in DesignFlow
   (at which point the feed delivers them on its next run) or a human creates and links them in the
   shared copy. Monitor the gap explicitly: "active in DesignFlow, absent from shared".
5. **Every app on the shared copy must show `UNASSIGNED`** — as a bucket in the cascading picker or
   an explicit "unassigned" filter — so the 51 active orphans do not silently vanish. No app may
   assume every property has a real brand parent.
6. **Exit criteria for the window:** quarantine at zero (or each remaining row waived by a named
   owner), the `UNASSIGNED` policy signed off, and DesignFlow's read path switched — so that exactly
   one tree remains.

---

### Phase 6 — Retire the old copy
**Deliverable:** `dflow.*` licensor/property is decommissioned and `plm.licensor_import` /
`plm.property_import` are dropped (zero consumers, per the scoreboard's item 4).

Do not start this until all four applications have run on the shared copy for a stated period with no
incidents. **The old copy is the rollback for phases 1–5.** Deleting it deletes the rollback. Say so
in the PR.

---

## 6. Blocker-by-blocker table

| # | Blocker | Current state | Work required | Albert decision? | Acceptance test that proves it closed |
|---|---|---|---|---|---|
| 1 | Hub for three live apps | **Nothing written.** Only a blast-radius table at `…design-20260802.md:564`. No app has been sequenced or surveyed. | Phase 5.0 survey, then phases 5.1–5.4. | **Yes** — approve the order and each production window. | All four apps read the shared copy; the Cloud SQL copy has had zero reads for a stated period, proven by query logs, not by assumption. |
| 2 | PLM sync dead since 2026-07-08 (silent 502) | Diagnosed, not fixed. Most recent `ingest.sync_run` of any kind on production is 2026-07-22 19:10:49-04. | Phase 4.4. **Must not be done before phase 2 reaches production.** | No, but timing is his. | A `ingest.sync_run` row dated after the fix, **and** a deliberate failure produces a failure row — the silent-failure gap (15 runs, zero failure rows) is what made this invisible for a month. |
| 3 | 111 unparented properties (51 active) | Measured 2026-08-03 against a 2026-05-07 snapshot. Design fragment exists and is **gated** (`…design-20260802.md:459-476`). | Phase 3B measure, then decide, then implement Option A or B. | **Yes** — decision 3. | Live counts published. The chosen representation exists. `is_orphan` in the health view returns a real number, not a hardcoded false. |
| 4 | No human curation path | Real design, fully specified, **zero lines implemented**. `authenticated` holds `SELECT` only on `core.property` and `core.licensor`, so the `admin_write` RLS policy is unreachable from a browser. | Phase 3A (database) + 3C (UI). | Only via decision 3. | A named human changes a parent through the UI and an audit row appears with their evidence. A direct `service_role` UPDATE also appears, tagged `out_of_band`. |
| 5 | `import_master_data()` overwrites `licensor_id`, forces `status='active'` | **Live in production.** Scoped proposal at `…import-authority-20260803.md:286-366`; nothing implemented. `20260802170000` is merged but absent from production. | Phase 2.1–2.2. | Production window only. | Deliberately-set `licensor_id` and `status` survive two importer runs. |
| 6 | Three further overwrite paths | §2.6 `confidence` force-set (structural, all 505 rows already `verified`, nothing destroyed today); §2.8 duplicate INSERT (**latent and closer than it looks — 6 of 26 `core.licensor` rows have no `designflow_plm` ref**); §2.9 `lower(name)` false match. | Phase 2.3–2.5, shipped with 2.2. | Choice between the two `name` options — recommend normalized-equivalent. | Each of the three has a preview test that fails against the old function and passes against the new. |
| 7 | 9 properties under the wrong licensor | **One-line stub only** (`COORDINATOR_INTAKE.md:1837-1860`). No evidence gathered, no correct parent identified. Wording is ambiguous: 34 and 38 are product counts. | Phase 4.1, after evidence-gathering (parallelisable now). | **Yes** — decision 4. | The 9 rows point at the ruled licensor; each has an audit row with named decider and evidence; product counts under DISNEY drop by 34 and 38. |
| 8 | Unvalidated write endpoint open to 5 roles | **Mis-stated everywhere — see §2.** Correct citation `designflow-backend/routes/admin.router.js:87`. The endpoint is type-blind and reachable, but is **not proven** to be the writer of the 503 edges; its own source doc marks that NOT VERIFIED. | Phase 5.4(a), DesignFlow app work in the `designflow-backend` repo — **nothing in shared-db can close it.** The documentation half is DONE: §2.1 is the correction of record (issue #518). **Residual risk after the feed is revived (4.4):** because phase 2 makes `licensor_id` INSERT-only, this path can no longer re-parent an **existing** shared row — a disagreement quarantines instead. What survives is that a **new** property's *first* parent can still enter the shared copy unaudited via Cloud SQL. Mitigate by tagging feed-originated INSERTs `source_channel = 'plm_feed_insert'`, not by blocking the revive. | No. | A direct API call passing an MG06 as `productSubType` returns a rejection. |
| 9 | Promotion lane aborts at file 3 of 14 | Designed in full, not implemented. Aborts **after** applying and recording files 1 and 2 — a partial production database. | Phase 1.1–1.2. | **Yes** — decision 1. | The lane applies an approved list end to end, and every object is verified to exist by `to_regclass` / `pg_proc`, not by the ledger. |

---

## 7. Sequence summary

| Phase | Name | Deliverable | Gated by |
|---|---|---|---|
| **1** | Make production reachable | A promotion run that completes and is proven by object existence, **plus a mid-promote failure runbook** | Albert decision 1 |
| **1 (parallel)** | Orphan measurement + representation decision (track 3B) | A live orphan count and a signed decision on how an ownerless property is stored | Albert decision 3 |
| **2** | Stop the overwrites | An importer that cannot destroy a human decision | Phase 1 |
| **3** | Build the curation path | A named human can change a parent, with evidence, recorded structurally | Phase 2 (delivery); track 3B decision |
| **4** | Correct the data | A complete, correct shared copy | Phase 3 audit table; decisions 2 and 4 |
| **5** | App-by-app cutover | Four apps reading the shared copy, under the §5A authority model | Phases 2, 3, 4 |
| **6** | Retire the old copy | `dflow.*` decommissioned | Phase 5 stable |

---

## 8. What Albert must decide

**Decision 1 — Do we unblock the four held migrations, or drop two files from the promotion list?**
Two of the fourteen changes waiting to go live depend on an earlier change that is deliberately held
back. Either we release the held ones too (making it eighteen changes instead of fourteen), or we
take those two out and promote twelve. Releasing them is more work to review; dropping them means
two fixes wait longer.
*Versions concerned:* `20260726030000`, `20260726031000`, `20260726032000`, `20260726180000`.

**Decision 2 — When do we take the production windows?**
This plan needs at least four separate moments where changes go live: the promotion lane, the
importer fix, the curation tables, and the data corrections. Each is small. They cannot all be one
window, because each proves the previous one worked. One constraint is already fixed: PR #408 and the
`FR` removal must go live together, in the same window.

**Decision 3 — How should a property with no owner be stored?**
Right now every property is required to have an owner, and 111 of them do not really have one. Two
options. **A: invent a placeholder owner** called something like UNASSIGNED and put them all under it
— nothing else in the system breaks, but every screen that lists owners has to learn to hide a fake
one. **B: allow a property to have no owner at all** — more honest, but it changes the meaning of
every screen that joins the two lists, across four applications. *Recommendation: A, and only after
we have the live count, which we can now get.*

**Decision 4 — Where do Harry Potter and NASA actually belong?**
Thirty-four Harry Potter products and thirty-eight NASA products are currently filed under Disney.
Nobody has written down who they should be filed under instead. This needs your answer before we can
correct it, and your answer gets recorded as the evidence for the change.

**Decision 5 — What happens to the drift alarm during the changeover?**
There is an automatic check that compares the old copy and the new copy and raises an alarm when they
disagree. Once people start correcting the new copy on purpose, that alarm will fire on every correct
action. Either we teach it to recognise an approved correction, or we accept a noisy alarm for the
duration. *Recommendation: teach it — a noisy alarm is how the 2026-07-31 incident became invisible.*

**Decision 6 — Do we do the two-row rehearsal at all?**
It proves the release machinery works, on a table nothing reads. It proves nothing about licensors
and properties, and the document that recommended it says so itself. It costs about an afternoon.
*Recommendation: yes, time-boxed to one afternoon, and nobody is allowed to say afterwards that the
real move is now de-risked.*

---

## 9. What is not yet knowable, and what would make it knowable

| Not knowable today | Why | What closes it |
|---|---|---|
| **The live count of unparented and inactive `mgTypeCode='06'` merch groups.** The 111/51 figures are from a 2026-05-07 snapshot, three months stale. This gates decision 3. | Required a query against DesignFlow's Cloud SQL production database, which nobody had read access to. | **Now closed in principle.** A read-only account exists (1Password `tcaf3o3u2cx52g6ivvczxbhola`, `albert_read_only`, SELECT only, schema `designflow`) reachable via the Cloud SQL Auth Proxy service account (`zjrrpl4yyotjbrfu56zayaj63i`, `roles/cloudsql.client`). Run Q1 and Q2 from `…curation-home-20260803.md:165-185`. This agent did not use them — no database calls were permitted in its brief. |
| **Who or what actually wrote the 503 existing parent edges.** Trigger, stored procedure, scheduled job, human SQL, or the type-blind endpoint. | Same access gap. | Q1 above (`pg_trigger` + `pg_proc` scan for `parent_id`). If Q1 returns nothing and Q2's `modUser` values are all ColdLion logins, it is settled as human SQL. |
| **Whether DesignFlow's real database has any FK, unique or cascade on `merchGroup.parent_id`** beyond the Sequelize model. | DesignFlow has no migration directory and no SQL DDL outside the vendored mirror. | One `pg_constraint` query on the same connection. |
| **How many properties (not products) are the "9 wrong parents".** The number 9 and the numbers 34/38 are not the same kind of thing. | The stub never distinguished them. | A `select count(distinct property_id)` on the affected products. Blocks writing the 4.1 migration. |
| **Whether poppim-web or popdam3 filter status client-side.** | Neither repository was checked out when the question was asked. | Both now exist on this machine. Grep for `status` near `property`/`licensor`. Cannot change the verdict — a client-side filter is cosmetic by definition — but it is on the phase 5.0 survey list. |
| **What each application actually breaks on if the shared copy is incomplete.** No app has been surveyed. This is the largest unknown in the plan and it sits directly under blocker 1. | Nobody has done it. | Phase 5.0. It needs a person reading four repositories, not a query. |
| **Whether the promotion lane fix works.** It is designed, not built or run. | Not implemented. | Phase 1, and its own §9 acceptance gate. |

**One honest structural note.** Phases 1 and 2 have high confidence — the work is specified down to
the line, and the failure modes are understood. Phase 5 has the lowest confidence in this document,
because it rests on a survey nobody has performed. **Do not treat the phase 5 ordering as settled
until 5.0 is done.** It is a reasoned first draft based on coupling strength, and the survey may
reorder it.

---

## 10. What this agent deliberately did NOT do

- **No database call of any kind.** No `execute_sql`, no Supabase MCP, no psql, no Cloud SQL, no
  preview, no production. Every number here is quoted from an existing document and attributed.
- **No migration authored**, and none proposed as a deliverable of this document.
- **No 1Password secret read.** The two items are referenced by ID only; neither was fetched.
- **No change to any existing file.** This document is the only file this agent created. In
  particular `HANDOFF.md`, `COORDINATOR_INTAKE.md` and every existing `docs/` file are owned by
  another live agent and were read only.
- **No push and no PR** — GitHub was unreachable from this machine for the duration.
- **No dflow repository change** — `C:\repos\dflow plm` was read only; no branch switched, no file
  touched.

---

## Independent review (Grok 4.5)

**Reviewer:** Grok 4.5 (`grok-4.5-build`) via Grok CLI 0.2.112, session
`019fd4ee-49a3-7ae2-b805-155055b32196`, three turns, read-only (`--deny Edit --deny Bash
--deny Read`). It was given a compact self-contained brief with the plan inline and **no repository
access** — every finding below is a judgement on the stated design, not on the code.
**Cost:** 98,223 total tokens across three turns, $0.190 USD.

**Outcome: converged.** Grok raised nine substantive points. **Six accepted**, two of which changed
the plan materially. **One rejected as factually wrong** and withdrawn by Grok. **One conceded by
Grok after challenge.** **One narrowed** by agreement. Grok's closing turn: *"no remaining
objection."*

### Points Grok raised, and the disposition of each

| # | Grok's point | Disposition | Why |
|---|---|---|---|
| 1 | **The plan has no write-authority model for the dual-write window.** It names dual-write and drift, then stops — it never says who may change a parent, what wins on conflict, what the kill criteria are, or how orphans survive a feed that cannot represent them. Grok called this "the single largest risk not addressed" and "a multi-week split brain with four live apps, not a cutover." | **ACCEPTED — largest single change.** Adopted essentially verbatim as new §5A. | It is simply true. The first draft named the risk and then moved on. The `UNASSIGNED`-versus-feed problem in particular is one this agent raised as unsolved and could not answer; Grok's "the feed can only propose to leave the holding pen, never assert or clear it by omission" is a genuinely better formulation than anything in the existing documentation. |
| 2 | **The phase 5 rollback is wrong after phase 4.** Once shared holds corrected parents and `FR` is gone, "repoint back to Cloud SQL" reinstates the known-bad parents. Rollback is valid for connection failures, not data-quality failures. | **ACCEPTED — sharpest finding.** Rewrote the phase 5 rollback; added edge 10; added a warning at the end of phase 4. | Correct and load-bearing. The first draft said "the Cloud SQL copy is left untouched, so rollback is repointing back" without noticing that *untouched* is exactly the problem once the shared copy has been deliberately corrected. |
| 3 | **A mid-promote failure runbook is missing.** "Prove by object existence" is a success check, not a recovery plan, and PITR is banned. | **ACCEPTED.** Added as step 1.5 with required content. | True. The source design excludes PITR but never says what replaces it. |
| 4 | **Missed edge: B3's *representation decision*, not just its measurement, gates cutover.** | **ACCEPTED.** Added as edge 9. | Correct — the plan had it as "B3 → B1", which lets someone satisfy it by producing a count. |
| 5 | **Move 3B (orphan measurement + decision) to run parallel with P1**, not inside P3. | **ACCEPTED.** Added as step 1.6. | Cheap, and it gates cutover design rather than only the health view. |
| 6 | **The `FR` snapshot must be a mandatory, timed, verified gate, not a note.** Also: state phase 2's forward-only rollback in the runbook so nobody "rolls back" by re-enabling the overwrites. | **ACCEPTED.** Both added. | Fair. A rollback that exists only as prose is not a rollback. |
| 7 | **"Partial promotion state (files 1–2 already applied) → all of P1. Reconcile before any new promote; not optional cleanup."** | **REJECTED — factually wrong. Grok withdrew it.** | Verified against `docs/production-migration-lane-design-20260802.md:303-311`. That passage is headed *"What actually happens **if** the fixed lane is run to apply today"* and is a **hypothetical** describing why the closure check must land first. Production is clean; nothing has been promoted. Grok's reply: *"I accept the correction. I misread a hypothetical as current production state."* A note recording this was added to phase 1, because the misreading is an easy one to repeat. |
| 8 | **Flip the cutover order to poppim first** — its `property_id` is empty today, a closing window, whereas popcrm has no clock. | **CHALLENGED, and Grok conceded.** Order stays popcrm → poppim → PopDAM → DesignFlow, with a new caveat. | The counter-argument: poppim's FKs from `pim.product` / `product_submission` / `project` **already point at `core.licensor` / `core.property`** — the shared tables. So poppim has no Cloud SQL dependency to sever, and putting it first would make the first rehearsal a non-rehearsal, the same trap the `age_group` rehearsal already fell into. Grok conceded both halves: the empty-`property_id` window is a **phase 4 data-correctness deadline**, not a phase 5 ordering argument. Both changes are in the plan. Grok's caveat, which is fair and recorded: weak *technical* coupling is not the same as low *business* pain — a broken tree in `global_search` still hurts sales, it just fails more safely than a hard FK. |
| 9 | **Escalate blocker 8 to medium-high after the feed is revived**, because the unvalidated `PATCH` path can feed the shared tree through sync and bypass the curation RPC and its audit trail. | **NARROWED by agreement.** Blocker 8 stays sequenced at DesignFlow cutover. | The narrowing put to Grok: phase 2 makes `licensor_id` **INSERT-only**, so for a property that already exists in the shared copy the revived feed cannot change its parent regardless of what the `PATCH` endpoint wrote into Cloud SQL — the disagreement quarantines. What survives is only a **new** property's *first* parent entering unaudited on INSERT. Grok agreed: *"the narrowing holds for existing rows … no path in the stated design where the revived feed updates an existing property's parent after P2, unless P2 is incomplete."* Mitigation is therefore tagging feed INSERTs `plm_feed_insert`, **not** blocking the revive on a DesignFlow app change. Grok added a valuable rider — the **logical-twin** risk, where a failed match creates a new row under the feed's parent alongside the curated original — and correctly noted that phase 2's match-key fix, not the endpoint, is what closes it. That is already step 2.3. |

### Things Grok contributed that were not corrections

- Three named regression cases for phase 2 that a naive "no `UPDATE`" assertion would miss: a
  leftover `UPDATE` in an unreached branch, a DELETE-then-re-INSERT path, and auto-apply from
  quarantine. Added as explicit acceptance tests.
- The formulation **"the feed is not authoritative for absence — omitted from the feed does not mean
  delete, deactivate or re-parent."** Adopted as a standing rule in phase 2. It is a stronger and
  more general statement of the rule than anything currently written down in this programme, and it
  is the rule that protects orphans from the next successful import.

### Where this agent and Grok still disagree

**Nothing substantive.** Grok's final turn was *"no remaining objection"* against the full list of
changes above.

One residual difference of emphasis, recorded rather than resolved: after conceding the poppim
point, Grok suggested the first cutover should be *"the first app that actually changes authority"*
and was non-committal about whether popcrm qualifies. This plan keeps popcrm first while flagging in
phase 5 that **the phase 5.0 survey may show poppim needs no cutover at all**, in which case the
order becomes popcrm → PopDAM → DesignFlow. Neither position can be settled without the survey, and
both agents agree the survey is the deciding evidence. That is recorded honestly in §9 as the reason
phase 5 remains the lowest-confidence part of this document.

### Reviewer limitations worth stating

Grok had **no repository access** and worked entirely from the inline brief. It therefore could not
independently verify any citation, any row count, or the blocker 8 source reading — it accepted this
agent's account of the code. Its value was in the design reasoning, which is where it found the two
real defects. **Point 7 is a live demonstration that a second-opinion model can state a false fact
confidently**, and it was caught only because the underlying document was re-read rather than
trusted. Do not accept a Grok finding into this programme without checking it against the source.
