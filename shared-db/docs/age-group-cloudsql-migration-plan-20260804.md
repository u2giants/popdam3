# Plan — move `age_group` from Cloud SQL to Supabase (the rehearsal move)

**Date:** 2026-08-04
**Author:** sub-agent `age-group-plan`, dispatched by the `u2giants/shared-db` coordinator session.
**Status:** **PLAN ONLY.** No migration was written. No database was touched, read or written, by
this agent. Nothing here is approved for production.
**Branched from:** `origin/main` at `93c495e1c4b8e6196f41a2d046ccd43ec2f63e16`.

**Who this is written for.** Two readers. (1) Albert Hazan, the owner, who is not a programmer.
(2) A developer who joined this morning and knows nothing about this project. Every technical
term gets a short plain-English tag in brackets the first time it appears.

> **READ §8 BEFORE §3.** This agent was asked to verify the claims behind the `age_group`
> recommendation rather than repeat them. Most of them held. **One did not**, and it changes what
> this rehearsal can honestly claim to prove. That finding is new as of 2026-08-04 and is not in
> any earlier document.

---

## 0. The short version

`age_group` is a two-row list ("Adult", "Juvenile") in DesignFlow's production database. The plan
is to stop DesignFlow reading its own private copy and have it read the shared copy that already
exists in Supabase instead.

It was chosen because almost nothing can go wrong. That is also its weakness: **verification this
session found the DesignFlow screens do not read the `age_group` table at all.** They read
merch-group data and label it "Age Group". So the table is even safer to move than we thought,
and proves even less than we hoped.

The move **cannot reach production today**, for two independent reasons that have nothing to do
with `age_group`: the production promotion lane is broken, and the preview database is dirty.
Both are covered in §5.

---

## 1. What `age_group` is, in business terms

POP Creations designs licensed merchandise. Artwork inside DesignFlow (the product-development
system, "PLM") is tagged with who the product is for: an **Adult** item or a **Juvenile** item.

`age_group` is the little reference list [a lookup table — a short fixed list of allowed choices]
that holds those two options. Two rows. Created 2025-06-20. Never changed since.

A second, identical copy of that list already exists in the shared Supabase database as
`core.age_group`. Same two rows, same names, same internal numbers, same creation date. Nobody
built that copy as part of this plan — it has been sitting there since the shared database was
first laid out.

### Why it was chosen as the rehearsal

The strategic goal (owner ruling R5) is that the shared Supabase `core.*` tables become the single
source of truth for every application, and DesignFlow's private `dflow.*` copies get retired.
Albert's stated top priority for that programme is **licensors and properties** — the licensing
hierarchy that drives royalties and product filtering.

Licensors and properties are the hardest table set in the building. Three live applications depend
on them, the sync that feeds them has been dead since 2026-07-08, 111 properties have no parent,
9 are filed under the wrong licensor, and there is currently no screen anywhere where a human can
correct any of it.

So the reasoning was: do the same manoeuvre once on the least dangerous table in the system first,
to prove the machinery works, then do the dangerous one with a proven procedure. `age_group` is
the rehearsal; licensor/property is the performance.

**§8 challenges how well that reasoning survives verification.** Read it.

---

## 2. The exact end state

**Where the data lives afterwards.** In `core.age_group` in the shared Supabase database
(project `qsllyeztdwjgirsysgai`). The two rows are already there. **No data is copied, moved,
transformed or deleted by this plan.** The old `dflow.age_group` / production Cloud SQL table is
left exactly where it is, untouched, and simply stops being read.

**Which application reads it.** DesignFlow only. Poppim, PopCRM, PopDAM and monitor do not touch
this table today and are not affected in any way.

**What changes for a person using the applications.** **Nothing.** Not "almost nothing" —
nothing. Per the verification in §8, no DesignFlow screen currently reads this table, so there is
no screen whose behaviour can change. The visible "Age Group" dropdown that users see is fed from
merch-group data and is untouched by this plan.

**What changes for the system.** One configuration pointer and one code path in DesignFlow's
back-end move from the private copy to the shared copy. That is the whole change.

---

## 3. The sequence

Each step says what is done, where, by whom, and how you know it worked. **"You know this worked
when" is always an observable outcome, never "the migration applied."** A migration recording
itself in the ledger [the database's own list of migrations it has run] is a statement about the
list, not about the database. This repository has already seen a ledger row whose object was
absent (preview, 2026-07-23), and a fix that "looked right and did nothing" (PR #406). Assert the
behaviour and check the object exists.

### Phase A — close the gates that do not need production access

**Step A1 — Confirm `core.age_group` actually exists and holds the right two rows.**
*Where:* Supabase **preview** `rjyboqwcdzcocqgmsyel`, then production `qsllyeztdwjgirsysgai`,
read-only.
*Who:* a shared-db sub-agent with read access.
*You know this worked when:* `select to_regclass('core.age_group');` returns a non-null value
**and** `select id, name, is_active from core.age_group order by id;` returns exactly
`1 = Adult`, `2 = Juvenile`, both active. Paste the actual rows into the PR. Not the row count —
the rows.
*Changes anything?* No. Read-only. No rollback needed.

**Step A2 — Confirm nothing else in Supabase depends on `core.age_group` in a way we have not seen.**
*Where:* preview, read-only.
*Who:* same agent.
*You know this worked when:* a sweep of `pg_constraint` for foreign keys pointing **at**
`core.age_group` returns only the audit columns already known (`created_by` / `updated_by` →
`app.users`), and a sweep of `pg_views` / `pg_get_viewdef` and `pg_proc` for the string
`age_group` returns nothing unexpected. Publish the full result, including the empty ones.
*Changes anything?* No.

**Step A3 — Re-confirm the DesignFlow code finding in §8 against the current branch.**
*Where:* the six DesignFlow repositories, current `sandbox-albert` / `develop`, read-only.
*Who:* a sub-agent with the repos checked out fresh.
*Why this is a step and not a footnote:* the checkout used for §8 on this host is dated
2026-07-14 and is roughly three weeks stale.
*You know this worked when:* someone states, in writing, against a named commit SHA, either
"confirmed, no screen reads `age_group`" or "corrected, screen X does read it". If it is
corrected, **stop and re-plan** — the risk profile of the whole move changes.
*Changes anything?* No.

### Phase B — the two hard blockers (see §5)

**Step B1 — Establish the true state of the preview database, and clean it.**
This is a **gate before the rehearsal, not a cleanup after it.** Detail in §5.2.
*You know this worked when:* the unacknowledged-alert count is zero **and** each one was closed
with a stated reason, the circuit breaker [an automatic stop that halts a sync after repeated
failures] reads closed with an authorised reset recorded, and a fresh health observation passes
on its own merits rather than on a pinned hash. Read those back with live queries and paste them.
*Rollback:* acknowledging an alert and resetting a breaker are forward-only administrative acts.
They cannot be un-done, and they should not need to be. If the state was closed wrongly, the
correct response is to let the underlying condition raise a **new** alert, not to reopen the old
one.

**Step B2 — Fix the production promotion lane.**
It currently aborts at file 3 of 14, which would leave production **half promoted**. Detail in
§5.1. Owned by whoever picks up agent `prod-lane-design` / PR #403.
*You know this worked when:* a dry run of the promotion produces a **complete** plan naming every
file it intends to apply, from first to last, with no abort — and the plan names only the files
intended. A partial plan is a failure, not progress.
*Rollback:* none needed; producing a plan changes nothing.

### Phase C — the rehearsal, in the three environments that already run on Supabase

DesignFlow's **dev, staging and sandbox** environments already run on Supabase. Only production
runs on Cloud SQL. That is the single most useful fact in this plan: **the rehearsal can be run
three times, for real, before anything approaches production.**

**Step C1 — Point DesignFlow's `age_group` read path at `core.age_group` in the `sandbox-albert`
environment.**
*Where:* DesignFlow sandbox (already Supabase). Code change in the `popcre` DesignFlow repos, on
Albert's sandbox branch, PR to `develop` — never to `main`, never self-merged.
*Who:* a DesignFlow sub-agent.
*You know this worked when:* calling `GET /api/admin/getAgeGroups` against the deployed sandbox
returns the two rows **and** the database's own statement log / query plan shows the read hit
`core.age_group`, not `dflow.age_group`. Getting the right answer is not proof — both tables hold
identical rows, so a read from the wrong table returns the correct-looking result. **Prove the
target, not the output.** Temporarily renaming or revoking on the old table during the check is
the cheapest way to make the proof real.
*Rollback:* revert the one commit and redeploy. The old table was never dropped, so the previous
behaviour returns intact. Rollback time: one deploy.

**Step C2 — Run the same change through `develop` and `staging`.**
*You know this worked when:* the same proof from C1 passes in both, **and** the DesignFlow
end-to-end test suite passes with no new failures, **and** somebody opens the artwork screens and
confirms the "Age Group" dropdown still shows its usual values. Per §8 that dropdown is fed by
merch groups and should be completely unaffected — **if it changes, something is wrong and you
should stop**, because it means the two systems are more entangled than we believe.
*Rollback:* revert and redeploy, per environment.

**Step C3 — Write down what the rehearsal actually demonstrated, before anyone talks about
production.** Grade the claims in §7 honestly, one by one, marking each PROVED, NOT PROVED, or
NOT TESTED. A rehearsal nobody graded is a rehearsal that proves whatever the next person wants
it to prove.
*You know this worked when:* §7's table is filled in and merged, and at least one row says NOT
PROVED — because §8 already guarantees at least one will.

### Phase D — production. NOT APPROVED. NOT SCHEDULED.

Listed for completeness only. **Do not start Phase D.** It requires, at minimum: B1 and B2 done,
Phase C graded, the production Cloud SQL read access from §6 obtained and used, and an explicit
per-change instruction from Albert naming the environment.

**Step D1 — Read the real production `age_group` rows from Cloud SQL** and confirm they match
`core.age_group` exactly: same ids, same names, no extra rows. *Blocked* — see §6.
*You know this worked when:* the actual production rows are pasted into the PR and match
row-for-row. Anything else — a third row, different numbering — halts the move.

**Step D2 — Read the production `art_piece.age_group_id` distribution** and check every value
present exists in `core.age_group`. Per §8 **expect this to fail**, because those ids appear to be
merch-group ids. If it fails, that is not a blocker on the pointer move; it is the discovery that
the column was never really an `age_group` reference. Record it and re-plan.

**Step D3 — Check whether production has a foreign key on `art_piece.age_group_id`** that the
sandbox lacks. Databases drift.
*You know this worked when:* a `pg_constraint` sweep on production names every constraint on that
column, and the answer is written down either way.

**Step D4 — Promote.** Only after everything above. Use the bounded temp-checkout recipe in
`AGENTS.md` §5.1. **Never `--include-all` against the full repository set** — production carries
pending migrations from other workstreams that other people have deliberately kept off
production.
*You know this worked when:* the object is verified live in production with `to_regclass` /
`pg_get_viewdef` / `pg_constraint`, **and** a DesignFlow production read is shown hitting
`core.age_group`, **and** the artwork screens are opened by a human and look normal.
*Rollback:* revert the DesignFlow deploy. `dflow.age_group` stays in place, unread, for at least
one full release. **Do not delete the old table in the same change as the cutover.** Deleting it
is a separate, later, separately-approved step — and once deleted it is not rollback-able by
redeploy.

### The one step that cannot be rolled back — stated loudly

> **Dropping the old `age_group` table is NOT reversible by redeploying.** Every other step in
> this plan is undone by reverting a commit. That one is undone only by restoring from a backup.
> It is deliberately **not** part of this plan. If anyone proposes bundling it into the cutover
> "since it's only two rows", the answer is no: the whole value of leaving it is that rollback
> stays cheap.

---

## 4. Rollback summary

| Step | Changes something? | How to undo | Cost |
|---|---|---|---|
| A1–A3 | No | n/a | — |
| B1 preview cleanup | Yes | **Forward-only.** Alert acknowledgements and breaker resets are not reversible; a new alert must be raised instead. | Low |
| B2 promotion lane fix | Code only | Revert the PR | Low |
| C1–C2 read-path switch | Yes, per environment | Revert one commit, redeploy | One deploy |
| C3 grading | Docs only | Edit the doc | — |
| D1–D3 | No, read-only | n/a | — |
| D4 production cutover | Yes | Revert the deploy; old table still present | One deploy |
| Dropping the old table | Yes | **NOT REVERSIBLE by redeploy.** Restore from backup only. | **Not in this plan** |

---

## 5. Dependencies and blockers

### 5.1 HARD BLOCKER — the production promotion lane cannot produce a plan

Found by agent `prod-lane-design` (PR #403). The batch **aborts at file 3 of 14**. If run, it
would leave production **partially promoted** — some changes applied, some not, and no clean way
back.

**Where it sits in the sequence:** it blocks **all of Phase D** and nothing else. Phases A, B1 and
C can all proceed while it is broken.

**Say this plainly: the `age_group` move cannot reach production until this is fixed.** Not
"should not" — cannot, safely. This is not a blocker created by `age_group`; it blocks every
production promotion in this repository today, whatever the table.

**A second, related limitation (AGENTS.md §6.7).** Branch protection on `main` is on and the four
required checks are genuinely enforced, including for admins. **But** the two workflows that
actually touch the database are path-filtered, and a path-filtered workflow reports no check at
all on a PR that misses its paths — so neither can be made required without deadlocking every
unrelated PR. The consequence, stated honestly because it is the opposite of reassuring:
**the riskiest lane in this repository — migrations — is the one guard that cannot block a merge.**
Backlog item B2. Unfixed.

### 5.2 HARD BLOCKER — the preview database is not clean

Preview `rjyboqwcdzcocqgmsyel` carries rehearsal residue from earlier work, roughly 15
unacknowledged alerts, and a **tripped circuit breaker**.

**Why this is a gate and not a chore.** A rehearsal run against a dirty environment proves
nothing. If the breaker is already tripped and alerts are already stacked up, then "no new alert
appeared" and "nothing broke" are indistinguishable from "the alerting was already saturated and
could not have told us". You cannot measure a change against an unknown baseline.

This has already bitten this project once, in the opposite direction: five preview alerts were
chased as a live fault for considerable effort and turned out to be residue from a fault fixed
days earlier (§4.2 of the 2026-08-03 coordinator handover). Residue costs real time whichever way
you read it.

**Where it sits in the sequence:** Step **B1**, before Phase C. Not after. Not "while we're in
there".

*(This agent did not query preview — the task forbids database calls. The preview state above is
taken from the coordinator's briefing and the 2026-08-03 handover, and is stated as reported, not
as verified by me.)*

### 5.3 DEPENDENCY, NOT YET SATISFIED — read access to production DesignFlow Cloud SQL

We cannot currently read production DesignFlow. The one read-only credential we hold reaches an
instance that contains no DesignFlow data. A request for proper read-only access has gone to the
developer (Uma) and is expected back tomorrow (2026-08-05).

**What this blocks:** Steps **D1, D2, D3** — every claim about what production actually contains.
**Do not substitute sandbox numbers for production numbers.** Every row count in the
recommendation document came from Supabase, which is DesignFlow's *sandbox* data. Some of those
numbers are visibly implausible as production values (`itemType` = 1 row).

**What proceeds without it:** all of Phase A, all of Phase B, all of Phase C. That is the
majority of the work, and it is the part that actually rehearses anything.

### 5.4 Other dependencies

- Owner ruling **§6.5**: PR #408 is held and ships as one production change with the FR-removal
  work. Any production window for `age_group` must not disturb that pairing.
- The DesignFlow change goes to `develop` by PR, from Albert's sandbox branch, never self-merged,
  never to `main`.
- The shared-db side of any change is authored in `u2giants/shared-db` first — branch, PR,
  preview, then merge — **before** app code. Never as an app-repo inline migration.

---

## 6. What could go wrong

### 6.1 The honest case against this rehearsal: it may teach us nothing about licensor/property

This deserves to be argued properly, not waved at.

**`age_group` and licensor/property are not comparable in any of the ways that make
licensor/property hard.** Line them up:

| What makes licensor/property hard | Does `age_group` have it? |
|---|---|
| Hub for three live applications at once | **No.** DesignFlow only. |
| Fed by an upstream sync (ColdLion) that is currently dead | **No.** No sync touches it. |
| Real data to reconcile, match and clean | **No.** Two identical rows, nothing to reconcile. |
| Parent/child hierarchy with 111 orphans | **No.** Flat list of two. |
| Multiple code paths that overwrite curated values | **No.** Nothing writes it at all. |
| Wrong values in production needing human curation | **No.** |
| Needs a human curation screen that does not exist | **No.** |
| Enforced foreign keys to respect during cutover | **No.** None. |
| Row volume where a bad migration is slow or unrecoverable | **No.** Two rows. |

That table is nine "no"s. The properties that make `age_group` safe are **exactly** the
properties that make it unrepresentative. A rehearsal on a table with no dependants, no writers,
no sync, no hierarchy and no data to reconcile does not rehearse dependants, writers, syncs,
hierarchies or reconciliation. It rehearses **the promotion machinery and the deployment
sequence** — and that is a genuinely narrower claim than "it de-risks the licensor move".

**The fair counter-argument.** The promotion machinery is *also* currently broken (§5.1), and it
is broken for every table equally. Discovering that on `age_group` costs a wasted afternoon.
Discovering it half-way through a licensor promotion costs a partially-promoted production
licensing hierarchy — the thing that drives royalty reporting. So the rehearsal has real value,
but the value is **"we exercised the lane end to end on something we do not care about"**, not
**"licensor/property is now de-risked."** Anyone who says the second thing after this rehearsal is
overclaiming, and §7 exists to stop them.

**Where that leaves the decision.** The rehearsal is still worth doing, cheaply, in Phase C only —
but it should be explicitly time-boxed, and it must not be allowed to become the reason
licensor/property waits. The licensor/property blockers in §9.1 of the 2026-08-03 handover are
almost entirely *independent* of the promotion lane and can be worked in parallel starting today.

### 6.2 Proving the wrong thing — reading the right answer from the wrong table

Both tables contain identical rows. A read from the *old* table returns exactly the result a
correct cutover would return. **Every "it works" check in Phase C is therefore worthless unless it
proves which table was read.** This is the single most likely way this rehearsal produces a false
pass. Step C1 addresses it; do not soften it.

### 6.3 The stale-checkout risk

The DesignFlow code findings in §8 come from a checkout dated 2026-07-14. Three weeks of commits
are unaccounted for. Step A3 exists to close this. If the code has changed and a screen now reads
`age_group`, this stops being a zero-risk move.

### 6.4 Production schema drift

The production Cloud SQL schema may differ from the Supabase sandbox schema — an extra foreign
key, extra rows, different id numbering. We cannot see it (§5.3). Steps D1–D3 exist for exactly
this and none of them can run yet.

### 6.5 Momentum risk

The most likely real-world failure is not technical. It is that a successful two-row rehearsal
gets written up as "the Cloud SQL migration is proven", and the genuinely hard work is scheduled
on that basis. §7 is the defence.

### 6.6 Opportunity cost

Every hour on `age_group` is an hour not spent on the owner's stated top priority. This is a real
cost and should be stated to him rather than absorbed silently. The mitigation is that Phase C is
small and the licensor/property blockers can be worked in parallel — they need different people
looking at different things.

---

## 7. What this rehearsal is meant to PROVE — graded afterwards

Fill in the right-hand column at Step C3. Each claim is written so it can actually fail.

| # | Claim | Verdict |
|---|---|---|
| P1 | A `core.*` Supabase table can be made the read source for DesignFlow, with the read **proved** to hit `core.*` and not the old table. | *pending* |
| P2 | The change deploys cleanly through all three already-Supabase DesignFlow environments (sandbox, develop, staging) with no new test failures. | *pending* |
| P3 | Rollback works: reverting one commit returns the previous behaviour, verified by observation and not by assumption. | *pending* |
| P4 | The old table can be left in place, unread, without side effects. | *pending* |
| P5 | The shared-db authoring flow (branch → PR → preview → merge) carries a DesignFlow-facing change end to end without a collision with another agent's work. | *pending* |
| P6 | The preview environment can be brought to, and **shown** to be in, a known-clean state — and stays clean through a rehearsal. | *pending* |
| P7 | The production promotion lane produces a **complete** plan. | *pending — currently expected to FAIL, see §5.1* |
| **P8** | **This rehearsal materially de-risks the licensor/property move.** | *pending — §6.1 argues this will be NOT PROVED, and it should be graded honestly* |

**Claims this rehearsal explicitly does NOT make**, so nobody infers them later: it says nothing
about reconciling real data, nothing about parent/child hierarchies, nothing about competing
writers, nothing about a dead upstream sync, nothing about tables with enforced foreign keys, and
nothing about tables with more than two rows.

---

## 8. Verification of the claims behind the recommendation

The task was to verify, not repeat. Source under review:
`docs/cloudsql-first-migration-candidate-20260803.md` (PR #435).

**Method.** Read-only inspection of the DesignFlow repositories present on this host at
`/worksp/designflow-*`. They are root-owned; `sudo` was used for read-only `grep`/`sed` only.
**Checkout date: 2026-07-14 (`designflow-backend` `bf8b44b`, `designflow-frontend` `f41d255`).**
No database of any kind was contacted.

| # | Claim | Verdict | How |
|---|---|---|---|
| 1 | `age_group` is a two-row table used by DesignFlow | **Partly confirmed** | Model confirmed at `designflow-backend/models/db/AgeGroup.js` — `sequelize.define('AgeGroup', …)`, `tableName: 'age_group'`. Row count is a database fact and was **not** verifiable by me. |
| 2 | The back-end has create / update / delete plumbing for it | **CONFIRMED** | `designflow-backend/services/admin.service.js` lines 377, 410, 437, 460 (`getAgeGroups`, `createAgeGroup`, `updateAgeGroup`, `deleteAgeGroup`), routed at `routes/admin.router.js:68,71,74,77`, controllers at `controllers/admin.controller.js:227,240,254,269`. |
| 3 | There is no admin screen for it | **CONFIRMED** | `designflow-frontend/src/app/pages/editor/` contains 15 editor screens (`fob-country`, `delivery-location`, `item-size-aggrid`, `item-depth-aggrid`, `license-list`, `merch-group-dialog`, `tariffs`, …). **No age-group screen.** |
| 4 | "The UI never calls it" | **CONFIRMED, AND STRONGER THAN STATED** | The Angular client declares `getAgeGroups()` at `helpers/services/admin.service.ts:158`. A repo-wide search for that symbol across `designflow-frontend/src` returns **only its own definition — zero call sites.** There is no create/update/delete client method at all. So even the *read* endpoint is dead: the table is not reachable from the user interface in any direction. |
| 5 | **"Usage is real — 974 of 981 `art_piece` rows set `age_group_id`", implying the `age_group` list is genuinely in use** | **DISPROVED as evidence of `age_group` usage** | See below. This is the finding that changes the plan. |
| 6 | Identical two rows already in `core.age_group` (same ids, names, dates, author) | **NOT VERIFIABLE BY ME** | Database fact; this agent is forbidden database calls. Left as Step A1. Original evidence looks sound but must be re-read live before the move. |
| 7 | No enforced foreign key on `art_piece.age_group_id` | **NOT VERIFIABLE BY ME** | Database fact. Left as Steps A2 and D3. |
| 8 | Not fed by ColdLion / no Airbyte columns | **CONSISTENT with what I could see** | No `age_group` reference outside the five admin files listed above (`routes/admin.router.js`, `services/admin.service.js`, `models/db/AgeGroup.js`, `models/db/init-models.js`, `controllers/admin.controller.js`). No sync path. |
| 9 | DesignFlow is Cloud SQL in production only; dev/staging/sandbox are Supabase | **NOT VERIFIABLE FROM THIS CHECKOUT — reported honestly** | The recommendation cites `designflow-backend/config/database-connection-contract.js`. **That file does not exist in the 2026-07-14 checkout on this host** — `config/` holds only `brevo.config.js`, `db.config.js`, `digitalocean.config.js`, `env.js`, `graph.config.js`, and `db.config.js` reads plain `DB_*` environment variables with no provider assertion. A repo-wide search for the quoted strings (`DB_PROVIDER must be cloud-sql`, `cloud-sql-socket`) across four DesignFlow repos returned **nothing**. The most likely explanation is that the contract file was added after 2026-07-14 and this host's copy predates it. **I could not confirm it, and I am not going to pretend I did.** It is corroborated independently by the 2026-08-03 coordinator handover §4.4. **Close this in Step A3 against a current checkout.** |

### 8.1 The finding — `art_piece.age_group_id` is populated from MERCH GROUPS, not from `age_group`

Three separate Angular screens build their "Age Group" dropdown from **merch-group** data, not
from the `age_group` table:

`designflow-frontend/src/app/pages/art-piece/art-piece-detail/art-piece-detail.component.ts:248-255`

```ts
} else if (mgTypeDesc === "Age Group") {
  for (const merchGroup of merchGroups) {
    if (merchGroup.is_active) {
      this.ageGroupOptions.push({
        title: merchGroup.mg_desc,
        id:    merchGroup.mg_id,      // <- a MERCH GROUP id
        mg_code: merchGroup.mg_code
      });
```

and that value is what gets written back to the artwork record:

- `art-piece-detail.component.ts:403` — `artPieceToSave.age_group_id = this.selectedAgeGroup?.id;`
- `newArtPiece.component.ts:436` — `age_group_id: this.form.controls.ageGroupControl?.value?.id`
- and read back at `art-piece-detail.component.ts:367` —
  `findOptionById(this.ageGroupOptions, currentArtPiece.age_group_id)`

The same merch-group-sourced pattern appears in `itemDetail.component.ts:422`,
`newItem-dialog.component.ts:803` and `newArtPiece.component.ts:369`.

**In plain English.** The column is *named* `age_group_id` but the numbers stored in it come from
the merch-group list, filtered to the merch-group type whose description is the text
`"Age Group"`. The two-row `age_group` table plays no part in it.

**What this means, in three consequences:**

1. **Lower risk than claimed.** The `age_group` table is not merely unedited — it is completely
   orphaned from the application. Moving it genuinely cannot affect a user.
2. **Less value than claimed.** The recommendation's strongest "this is really in use" evidence
   (974 of 981 rows) does not support the conclusion drawn from it. There is no live read path to
   switch, so §7's claim P1 has to be proved with a deliberately constructed read, not with an
   existing screen. This is a rehearsal of the *mechanism* on a table nothing uses.
3. **It quietly touches the hard problem after all.** The real "age group" data lives inside the
   **merch-group taxonomy** — the same structure as licensors and properties, and the one where
   the meaning of a type code varies by division, there is no hierarchy or active flag upstream in
   ColdLion, and codes are unique only per division-plus-type. Any *later* attempt to make
   `age_group` genuinely authoritative runs straight into the licensor/property problem. That is
   worth knowing before somebody promises otherwise.

**Recommendation arising.** None of this vetoes the plan. `age_group` is still a fine, cheap
mechanism rehearsal. But claim **P8** should be graded **NOT PROVED** unless something unexpected
happens, and `docs/cloudsql-first-migration-candidate-20260803.md` should be corrected: its
"usage is real, not dead" evidence for `age_group` is wrong. That correction belongs to whoever
owns that file; **this agent did not edit it** (single-file ownership).

---

## 9. What Albert needs to decide

One question, with options.

**Should the `age_group` rehearsal run at all, given §6.1 and §8?**

- **(a) Run Phases A–C only, time-boxed, and start licensor/property blocker work in parallel now.**
- **(b) Run the full plan including production, once the two blockers clear.**
- **(c) Skip the rehearsal and put everyone on licensor/property.**

**Recommended: (a).** It is cheap, it exercises the promotion lane on something nobody cares
about, and it does not delay the priority work — because the licensor/property blockers are
mostly independent and can be worked at the same time by different people.

---

## 10. Scope statement

This agent wrote this file and nothing else. No migration was authored. No database — production,
preview, or otherwise — was contacted in any way. Nothing here is approved for production, and
Phase D must not be started.
