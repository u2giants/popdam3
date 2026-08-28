# Implementation plan — orchestrator throughput Phase 2: eliminate cross-issue invalidation

**Repository:** `u2giants/shared-db`
**Tracking issue:** [#1738](https://github.com/u2giants/shared-db/issues/1738)
**Work class:** repository maintenance only
**Created:** 2026-08-28
**Evidence session:** Codex task `01a0461f-d1bf-7e02-8c84-ee8783f965b0`, title `shared-db.orch`, observed 2026-08-28 02:08–03:56 UTC with final issue-state audit at 09:47 UTC
**Handoff:** [`HANDOFF.d/2026-08-28T1000Z-edge-dev-codex-throughput-phase-2.md`](HANDOFF.d/2026-08-28T1000Z-edge-dev-codex-throughput-phase-2.md)

This is Phase 2 of the throughput repair. Phase 1 is [`plan_orchestrator_throughput_guard_truth.md`](plan_orchestrator_throughput_guard_truth.md): it makes guard diagnoses truthful, reproducible and measurable. Phase 2 removes avoidable cross-issue waiting and repeated evidence work. It changes coordination scripts, workflows, tests and operating documentation only. It authorizes no migration, preview write, production write, infrastructure mutation or credential change.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Plan, evidence, handoff and tracking issue registered | ✅ done 2026-08-28 | this file; linked handoff; issue #1738 |
| 1 | Freeze a machine-readable transcript baseline and throughput model | ⬜ open | — |
| 2 | Separate protected object claims from active author capacity | ⬜ open | — |
| 3 | Add immutable, content-addressed evidence bundles | ⬜ open | — |
| 4 | Revalidate by proven invalidation class instead of unrelated `main` movement | ⬜ open | — |
| 5 | Add an explicit shared-preview dependency graph and automatic resume | ⬜ open | — |
| 6 | Make reviewer allocation concurrent with short per-reviewer reservations | ⬜ open | — |
| 7 | Preflight route and verifier compatibility before expensive work | ⬜ open | — |
| 8 | Automate blocker transitions, capacity refill and resume | ⬜ open | — |
| 9 | Integrate Phase 1 measurement and prove throughput without weakening safety | ⬜ open | — |
| 10 | Full verification, staged rollout, landing and post-merge proof | ⬜ open | — |

**Fresh implementation starts at Step 1.** Use a fresh session at each phase boundary: Phase A = Steps 1–2, Phase B = Steps 3–4, Phase C = Steps 5–6, Phase D = Steps 7–9, Phase E = Step 10. Re-read the remaining plan and current `origin/main` before each phase.

---

# Part 1 — Why

## 1. Ultimate goal

Albert should be able to run five independent structural workstreams without one issue repeatedly invalidating another issue's review, preview or production proof. A blocked issue must continue protecting its database objects, but it must not falsely consume an active worker slot. Unrelated changes on `main` must trigger integration rechecks, not a complete independent-review replay, when immutable evidence proves the reviewed migration and every safety-sensitive input are unchanged. Shared preview, merge and production remain serialized and fail closed.

When complete:

1. The dashboard distinguishes **protected claims**, **active authors**, **waiting work**, and **deployment-stage ownership**.
2. Each review and rehearsal is bound to an immutable content bundle, not merely a moving Git commit.
3. A newer `main` commit causes only the revalidation justified by its proven impact class.
4. Preview-only dependencies become an explicit queue edge with automatic resume, not a failed workflow and manual diagnosis.
5. Reviewer allocation never holds a global mutex while a remote reviewer runs or while local liveness is probed.
6. Unsupported PR, supersession, dependency-batch and catalog-verification shapes fail during qualification, before review/preview/production time is spent.
7. Every wait and replay has a typed cause and measured duration.

No safety coverage is reduced. Exact object exclusivity remains. Migration bytes applied to preview and production must still match reviewed bytes. Preview, merge and production writes remain one at a time. Required independent reviewers remain required. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this repository and orchestrator are

`u2giants/shared-db` is the public source of truth for the structure and cross-application contracts of POP Creations' shared Supabase/PostgreSQL database. Structural changes are authored as forward-only migrations in isolated worktrees, checked by GitHub Actions, rehearsed on shared preview, merged to `main`, and promoted through evidence-gated production workflows.

The single orchestrator coordinates up to five author workstreams using Git refs and `scripts/manage-migration-author-lanes.mjs`. Object claims prevent conflicting schema work. Reviewer assignments, preview, merge and production have durable coordination refs. Preview is one shared mutable database; merge and production are serialized. The relevant operating contract is `AGENTS.md` §0.0-C and `docs/agents/section-4-anti-collision-rules.md`.

This plan is repository-maintenance work. A separate repository session implements it; the structural orchestrator only consumes the finished tooling after it lands.

## 3. Trigger and transcript evidence

### 3.1 Measurement method and limits

The source was the complete local JSONL archive for Codex task `01a0461f-d1bf-7e02-8c84-ee8783f965b0`, corroborated through the Codex task reader. The transcript began at 02:08 UTC, the active orchestration ended at 03:56 UTC, and a later read-only audit at 09:47 UTC confirmed final issue states. Times below are observed wall-clock boundaries from coordinator messages and workflow events; they are not estimates of human effort. “Loop” means a material repeat or recovery of review, preview, merge or production evidence, not an ordinary first-pass gate.

### 3.2 Issue-level results

| Issue | Observed active interval | Outcome in transcript | Material loops | Blockers/rework evidenced |
|---|---:|---|---:|---|
| #1713 | 02:10–03:15, about 65 min | merged, preview proof rebound, production verified, closed | 3 | interrupted reviewer mutex; `main` advanced after preview; fresh review plus historical preview rebind |
| #1720 | 02:10–03:40, about 90 min to production-side failure | migration applied in production, issue left open behind #1732 | 5 | reviewer replacement; preview blocked by unmerged #1713; refresh/re-review after `main` movement; wrong post-merge route then historical recovery; catalog verifier could not interpret constraint-only SQL |
| #1646 | 03:05–03:56, about 51 min | merged and preview-verified; production unapplied, claim held behind #1733 | 6 | baseline test noise; test-role visibility defect; preview ahead after #1720; one migration could not promote without predecessor; historical proof initially pointed to ledger rename; supersession history diverged from risk gate |
| #1684 | 02:10–02:51, about 41 min before durable block | claim protected; blocked behind #1729 | 3 | false collision inference; reviewer-assignment mutex waits; supersession manager rejected deletion of a test file although no migration was deleted |
| #1658 | entire observed run | no active worker progress; claim protected | 0 work loops | pre-existing repository-maintenance prerequisite kept one of five reported lanes occupied |
| #1645 | entire observed run | no active worker progress; claim protected | 0 work loops | pre-existing repository-maintenance prerequisite kept one of five reported lanes occupied |

The original requested queue also contained #1662, #1676, #1669, #1722, #1692, #1656, #1657 and #1703. The 02:12 audit established that #1662, #1676 and #1657 were already closed; #1692 and #1709 were repository-maintenance prerequisites; #1669 was dependency-blocked; #1703 conflicted with #1645's protected object claim; #1722 was structurally eligible but initially lacked its mandatory scope block. The 09:47 audit confirmed production proof for #1657, #1676 and #1713, while #1662's issue record proved merge/preview but not production.

### 3.3 Complete causal timeline used for this plan

| UTC | Evidence from `shared-db.orch` | Consequence |
|---|---|---|
| 02:10 | Marker #1725 resolved; four claimed lanes inherited; #1720 filled the fifth | safe handover worked |
| 02:12 | Five lanes reported occupied, but only three workers active; #1658 and #1645 were blocked | claim protection was conflated with worker capacity |
| 02:16 | #1713 reviewer assignment serialized against #1684 supersession | unrelated operations shared one acquisition mutex |
| 02:17 | apparent #1684/#1720 migration collision proved false; interrupted #1713 review left stale mutex | diagnosis and recovery consumed time without issue work |
| 02:21 | guarded stale-mutex recovery completed | safety worked, throughput stopped while recovering |
| 02:23 | #1713 assignment finally bound; #1684 restarted; #1720 could only then acquire reviewer | reviewer allocation was serialized across issues |
| 02:28 | #1713 received exact-head approval | first review completed |
| 02:30 | #1713 preview dry-run passed; apply began | normal gate |
| 02:35 | preview applied, but newer maintenance merge moved `main` | successful evidence became stale because commit identity, not content identity, was controlling |
| 02:35–03:01 | #1713 refreshed and obtained a second independent review although migration SQL remained byte-identical | avoidable review replay |
| 02:49 | #1684 supersession rejected a PR that deleted an obsolete test, not a migration | route compatibility defect discovered late |
| 02:51 | maintenance blocker #1729 filed; #1684 claim remained occupied | valid protection, false capacity use |
| 02:55 | #1720's assigned Kimi route was prohibited and had to rotate to Muse | reviewer qualification happened after assignment |
| 02:58 | #1720 approved at refreshed head | review completed |
| 03:00 | #1720 preview dry-run failed because preview already contained unmerged #1713 | known dependency presented as a failed run |
| 03:01–03:04 | #1713 merged and historical preview proof was rebound | prerequisite completion manually unblocked #1720 |
| 03:05 | released #1713 author slot filled with #1646 | refill worked when a claim truly released |
| 03:08–03:13 | #1713 production dry-run/apply succeeded | serialized production gate worked |
| 03:16–03:21 | #1646 encountered baseline failures and then a test role that could not observe the unchanged row | test qualification and focused evidence were not separated early |
| 03:21–03:25 | #1720 repeated exact-head approval, preview dry-run and apply after `main` movement | second evidence replay |
| 03:28 | #1646 preview refused because preview was ahead of its branch | cross-issue preview/main coupling repeated |
| 03:30 | #1720 merged; #1646 refreshed again | dependency was handled manually through ordering |
| 03:33 | normal post-merge route refused because #1720 was already on preview; coordinator selected historical recovery | route selection could have been deterministic before dispatch |
| 03:39 | #1720 production migration applied, but final verifier could not interpret constraint-only SQL | verifier coverage defect discovered after the irreversible statement |
| 03:40 | blocker #1732 filed; #1720 remained open and claimed | safety proof incomplete; capacity remained occupied |
| 03:42 | #1646 merged and historical preview binding began | normal progression after refresh |
| 03:46 | #1646 production dry-run refused partial promotion because its corrective migration required its predecessor | dependency closure discovered late |
| 03:51 | two-migration batch passed dry-run | manual batch reconstruction |
| 03:54 | historical proof corrected to reference the original apply rather than the ledger rename | evidence provenance was not typed strongly enough at selection time |
| 03:55 | production risk gate refused because the legacy preview commit diverged during version supersession | valid safety refusal, but incompatibility was knowable before promotion |
| 03:56 | #1646 and #1720 held behind #1733/#1732; #1684, #1658 and #1645 also held | all five claimed lanes could be occupied while no authoring slot was productively available |

### 3.4 Root cause

The root cause is not slow coding and not excessive safety. It is **identity and capacity coupling across stages**:

1. A claim has two jobs: object exclusivity and one-of-five author capacity. Those lifetimes differ. An issue blocked for hours still needs exclusivity but no active author.
2. Review evidence is keyed to an exact Git head even when the reviewed migration, test and safety inputs are byte-identical. Any unrelated `main` merge can force a complete replay.
3. Preview is one mutable ordered ledger, but its unmerged-version dependencies are discovered by failing workflows instead of represented as queue dependencies.
4. Reviewer selection uses shared coordination and can leave stale global state after interruption. Qualification can occur after a reviewer has been durably selected.
5. Route and verifier capabilities are checked at the stage that needs them, so unsupported shapes survive authoring, CI and review before failing.
6. Recovery evidence has several identities—author head, merge tip, original preview apply, ledger rename and superseded version—but route inputs do not make invalid combinations impossible early.

Phase 1 shortens diagnosis and prevents false explanations. It does not by itself remove these couplings. Phase 2 does.

## 4. Scope

### In scope

- Separate durable object claims from renewable active-author leases.
- Keep all object collisions enforced across active, waiting and externally blocked claims.
- Content-addressed evidence bundles for review, CI, preview and production provenance.
- A conservative invalidation classifier for changes between reviewed base and current `main`.
- Explicit preview dependency edges and deterministic next-route selection.
- Short per-reviewer reservations and qualification before durable assignment.
- Qualification checks for supersession, migration dependency closure, preview-history compatibility and catalog verification coverage.
- Automatic blocked/resumable state transitions, queue refill and wake-up.
- Phase 1 blocker-ledger integration and causal throughput reporting.
- Tests, workflows and operating documentation needed for the above.

### Out of scope

- More than one simultaneous preview write, merge, or production write.
- Parallel database migrations against shared preview or production.
- Removing object claims while an issue remains capable of changing those objects.
- Accepting review for changed migration bytes or changed safety-sensitive inputs.
- Skipping required reviewers, CI, preview proof, risk derivation or catalog verification.
- Changing database structure/data, replaying SQL, or repairing #1645/#1658/#1684/#1720/#1646 directly.
- Building a general SQL semantic analyzer.
- Treating table-name disjointness alone as proof of independence.
- Replacing Phase 1; Phase 2 consumes its truth and blocker-ledger outputs.

---

# Part 2 — What is already known

## 5. Current code state

Re-anchor line numbers before editing. Durable anchors and starting behavior on `origin/main` at planning SHA `4433467af5e40a82f1a8def381efa1d5a9cc52c7`:

- `scripts/manage-migration-author-lanes.mjs`
  - `MAX_AUTHOR_LANES` and `claimLane()` count every active claim against capacity.
  - `buildCollisionAwareQueues()` already groups overlapping object/read sets and is the correct basis for keeping blocked claims collision-visible.
  - `MUTEX_REF` is shared by claim/reviewer coordination and can require recovery after interruption.
  - `assignReviewer()` and `replaceFailedReviewer()` bind durable assignments to issue, PR and exact head.
  - `EXCLUSIVE_REFS` correctly keeps preview, merge and production serialized; preserve it.
  - `--supersede-active-claim-version` is the governed version-recovery route implicated by #1684/#1729.
- `docs/agents/section-4-anti-collision-rules.md`
  - says claims occupy a lane until released;
  - documents five author lanes and explicit queue refill;
  - documents reviewer assignment/replacement;
  - documents preview-ahead failure, post-merge rehearsal and historical preview recovery.
- `.github/workflows/shared-supabase-migrations.yml` owns preview dry-run/apply, merged rehearsal and historical recovery inputs.
- `.github/workflows/guarded-migration-merge.yml` owns exact-head merge gating.
- production workflows consume immutable review and preview artifacts plus current-main evidence.
- Phase 1 plan #1680 is merged as documentation but its implementation steps remain open at plan creation. Phase 2 must use its blocker ledger and truth commands when they exist; until then, Phase 2 tests use fixtures and must not invent production measurements.

No Phase 2 implementation exists. Issue #1738 and this documentation are the only work started.

## 6. Key findings and reasoning

### 6.1 Object protection and worker capacity are separate invariants

Releasing #1658 or #1645 merely to free capacity would be unsafe because #1703 or another issue could then claim overlapping objects. Counting them as active authors is also false: the transcript explicitly showed five occupied lanes and only three workers. Therefore a claim must remain authoritative while its active-author lease may be relinquished.

### 6.2 Content identity can preserve review without accepting changed code

The #1713 second review occurred after a maintenance merge while its migration SQL was reported byte-identical. A safe reuse rule cannot say “the files look unrelated.” It must bind the reviewer verdict to a canonical bundle containing every reviewed migration, rollback/test, sidecar/catalog contract, relevant coordination script/workflow version, object claim and base policy version. If any bundle member changes, independent review is invalid. If only unrelated `main` files change, rerun integration/collision checks against current `main` without asking the reviewer to reread identical content.

### 6.3 Shared preview needs a scheduler model, not weaker isolation

#1720 correctly could not proceed while preview contained unmerged #1713. The failure was expected and deterministic. The fix is an explicit dependency edge `#1720 waits-for merge/proof of #1713`, not allowing #1720 to ignore the ledger and not creating concurrent preview writes.

### 6.4 Evidence provenance must be typed

#1720 first selected a normal post-merge route although its version was already on preview. #1646 initially selected a ledger-rename event instead of the original preview apply. Evidence records need types such as `original_preview_apply`, `historical_rebind`, `post_merge_rehearsal`, `ledger_reconciliation`, and `supersession`; validators must accept only a legal type for each route.

### 6.5 Late compatibility checks manufacture rework

#1684's removed-test-file incompatibility, #1720's constraint-only verifier gap and #1646's dependency/supersession incompatibility were properties of the PR/evidence shape before the expensive stages. A read-only qualification command should predict the allowed routes and verification contract before authoring completion.

### 6.6 Serialization is required only around state mutation

Selecting a reviewer needs atomic roster/cursor updates, but remote review execution does not. A per-reviewer reservation plus short cursor compare-and-swap prevents duplicate assignment while allowing unrelated reviewers to be assigned concurrently. Preview/merge/production mutation remains globally serialized.

## 7. Approaches considered and rejected

1. **Release blocked claims.** Rejected: it removes collision protection and can dispatch overlapping work.
2. **Raise the five-lane cap.** Rejected: blocked claims and shared deployment gates still dominate; it increases pressure without fixing false capacity accounting.
3. **Parallel preview or production applies.** Rejected: one shared ordered ledger/database requires serialization.
4. **Reuse any review when migration SQL alone is unchanged.** Rejected: tests, sidecars, policies, workflows or coordination code may change the risk.
5. **Treat an unrelated filename as automatically safe.** Rejected: shared scripts/workflows and object contracts can affect every migration.
6. **Keep exact-head replay for every `main` movement.** Rejected: #1713 proves it repeats expensive review for byte-identical evidence; replace it with exact-bundle review plus current-main integration proof.
7. **Allow successors to preview over unmerged predecessors.** Rejected: it hides dependency/order and cannot produce truthful isolated evidence.
8. **Add a timeout that deletes stale mutexes blindly.** Rejected: elapsed time cannot prove abandonment. Recovery must verify owner/task liveness and compare-and-swap the exact stale ref.
9. **Precompute every SQL dependency semantically.** Rejected: a general SQL analyzer is unsafe and out of scope. Use declared migration dependencies plus observed preview-ledger order and existing object claims.
10. **Close an issue after production SQL even when verification fails.** Rejected: #1720 demonstrates that apply plus failed verification is not completion.
11. **Fold Phase 2 into Phase 1 #1680.** Rejected: truth/measurement and concurrency/evidence architecture have different failure modes, rollout risks and rollback boundaries.

## 8. Locked decisions and implementer judgment

### Locked on 2026-08-28

- Preserve exact object claims for every unresolved structural issue, including externally blocked issues.
- Only renewable `active-author` leases count toward the five-worker cap.
- Preview, merge and production remain single-holder and fail closed.
- Review reuse is keyed to a canonical content bundle, never issue number, PR number, branch name or migration hash alone.
- Any changed bundle member invalidates review; current-main integration checks always rerun.
- A shared/global script, workflow, policy, migration-order or claimed-object overlap is a conservative invalidator.
- Required review coverage is unchanged.
- Preview-ahead state produces a dependency edge and wait status, not acceptance and not a misleading generic failure.
- Route qualification is read-only. It may refuse or report unavailable; it may not mutate refs, GitHub, preview or production.
- Phase 1 blocker-ledger records are the measurement authority once available.

### Implementer judgment

- JSON schema/file naming for bundles and state events, provided files are immutable/content-addressed or guarded compare-and-swap records.
- Whether the CLI is one new `orchestrator-flow.mjs` entrypoint or subcommands in `manage-migration-author-lanes.mjs`; preserve one documented operator interface and testable pure functions.
- Exact lease duration and heartbeat cadence after a fixture-driven failure/recovery analysis. No lease expiry may release object protection.
- Optional automated GitHub comments, only if existing token permissions suffice.

---

# Part 3 — How to build it

## 9. Ordered implementation

### Phase A — establish truth and separate capacity

### Step 1 — freeze the transcript baseline and state model

Create:

- `docs/verification/orchestrator-throughput-phase-2-baseline-20260828.json`
- `scripts/orchestrator-flow/baseline-schema.mjs`
- `scripts/orchestrator-flow/baseline-schema.test.mjs`

The JSON carries the issue table and timeline in §3 with source task ID, observation window, event timestamps, issue/PR/workflow IDs, `measurement_kind`, and explicit `unknown` fields. It must distinguish observed wall time from active effort and must not embed transcript text that contains secrets or licensed data. Add rerunnable GitHub proof commands for durable issue/PR/run facts; local transcript timestamps are labeled private-source observations.

Define states independently:

- claim: `protected | released`;
- author lease: `active | idle | relinquished | expired-unconfirmed`;
- issue flow: `ready | authoring | ci | review | preview-wait | preview | merge | production | external-blocked | owner-decision | complete`;
- evidence: `missing | current | stale-by-content | integration-refresh-required | unavailable`.

**Dependencies:** none.
**Verification gate:** schema tests reject conflated claim/lease state, invented durations, impossible event order and a “five active workers” assertion when only three worker events exist.

### Step 2 — separate protected claims from active-author leases

Change `scripts/manage-migration-author-lanes.mjs` around `claimLane()`, `auditLanes()`, `buildCollisionAwareQueues()` and capacity checks. Add commands:

- `--relinquish-author-lease --claim <n> --blocked-on <issue-or-artifact>`;
- `--resume-author-lease --claim <n>`;
- `--flow-audit --json`.

A protected claim remains in collision calculations and continues owning its migration version/object set. Only claims with a live `active-author` lease count toward `MAX_AUTHOR_LANES`. Relinquishment requires a typed blocker with a durable GitHub issue or immutable artifact, clean worktree proof and no active preview/merge/production holder for that claim. Resume reacquires capacity and rechecks every collision and version reservation. Lease expiry never releases a claim; it yields `expired-unconfirmed` and blocks mutation until guarded recovery.

Update `docs/agents/section-4-anti-collision-rules.md` and `AGENTS.md` so “five lanes” means five active authors, not five protected claims. Keep queue grouping aware of all claims.

**Dependencies:** Step 1.
**Verification gate:** tests prove five blocked protected claims plus five non-overlapping active authors are representable; an overlapping sixth issue remains blocked; releasing only an author lease never permits an object/version collision; interrupted resume is idempotent.

**Fresh-session cut:** commit Phase A on its feature branch, update STATUS, and start Phase B from current `origin/main` plus the Phase A branch/PR as appropriate.

### Phase B — reusable evidence and bounded invalidation

### Step 3 — add immutable content-addressed evidence bundles

Create:

- `scripts/orchestrator-flow/evidence-bundle.mjs`
- `scripts/orchestrator-flow/evidence-bundle.test.mjs`
- `config/orchestrator-evidence-schema-v1.json`

The canonical bundle includes:

- schema/policy version;
- issue, PR and claim IDs as metadata, not identity;
- ordered migration version plus LF-normalized SHA-256;
- rollback/focused-test files and hashes;
- verification sidecars/catalog contracts and hashes;
- exact claimed objects and reads;
- relevant coordination/guard/workflow file hashes;
- independent reviewer identity, verdict artifact hash and coverage declaration;
- CI run/artifact identities;
- base-main SHA and migration-order digest.

The bundle ID is the canonical JSON SHA-256. Unknown keys, unstable ordering, absent files, dirty worktrees and mismatched hashes fail. Review artifacts attest the bundle ID. Existing exact-head fields remain during migration and are cross-checked, not silently ignored.

**Dependencies:** Phase A state schema.
**Verification gate:** byte-identical relevant content on a refreshed branch yields the same bundle ID; changing any migration, test, sidecar, claimed object, relevant workflow or policy changes it; unrelated prose does not.

### Step 4 — classify `main` movement and run only justified revalidation

Create:

- `scripts/orchestrator-flow/classify-invalidation.mjs`
- `scripts/orchestrator-flow/classify-invalidation.test.mjs`

Integrate it into reviewer validation, `guarded-migration-merge.yml`, preview dispatch validation and production evidence generation.

Classes:

1. `CONTENT_INVALIDATED`: a bundle member changed — new review and all downstream evidence required.
2. `GLOBAL_INVALIDATOR`: coordination/guard/workflow/policy/migration-order input changed — new bundle/review unless a specifically versioned compatibility rule proves equivalence.
3. `OBJECT_INTERACTION`: intervening claim/write/read overlaps — new focused review/integration evidence.
4. `INTEGRATION_REFRESH_ONLY`: bundle identical and intervening changes proven disjoint — rerun merge-base, collisions, full CI and migration-order checks; preserve the original independent review verdict.
5. `UNVERIFIABLE`: evidence unavailable or classification ambiguous — fail closed and require full refresh.

The classifier must be conservative. It never uses path names alone: it combines canonical bundle membership, object-claim manifests, migration ordering and a fixed global-invalidator set discovered from repository configuration.

**Dependencies:** Step 3.
**Verification gate:** a fixture matching #1713's byte-identical migration plus unrelated maintenance merge returns `INTEGRATION_REFRESH_ONLY`; changed SQL, changed verifier, changed workflow, changed sidecar and overlapping object fixtures all invalidate; unavailable base history returns `UNVERIFIABLE` exit 2.

**Fresh-session cut:** freeze bundle schema v1, update STATUS and start Phase C.

### Phase C — explicit preview dependencies and concurrent review allocation

### Step 5 — build the shared-preview dependency graph and deterministic route selector

Create:

- `scripts/orchestrator-flow/preview-graph.mjs`
- `scripts/orchestrator-flow/preview-graph.test.mjs`
- `scripts/orchestrator-flow/select-preview-route.mjs`

Inputs are read-only: current `main` migration set, preview ledger, active claims, bundle IDs, original preview artifacts and typed recovery records. Output includes ordered nodes, edges, reason, next legal route and blockers.

Required behavior:

- preview contains an unmerged version from issue A and issue B is next → B becomes `preview-wait` with edge `B -> A merge-and-bind`;
- A merge/rebind event atomically marks the edge satisfied and wakes B;
- already-applied exact bytes select historical rebind, not ordinary replay;
- post-merge absent version selects merged rehearsal;
- superseded version, ledger rename and original apply are distinct evidence types;
- ambiguous/missing producer evidence returns `UNVERIFIABLE`, never guesses;
- dependency closure is printed before production dry-run, so #1646-like two-version batches are known early.

Integrate the selector with `.github/workflows/shared-supabase-migrations.yml`; the workflow validates the declared route against live state before taking the preview lock. A wait is a neutral queued state, not a red CI failure.

**Dependencies:** Steps 3–4.
**Verification gate:** transcript-derived fixtures reproduce #1720 waiting behind #1713, automatic resume after #1713 rebind, #1720 historical-route selection, and #1646 dependency-closure detection without a failed preview/production run.

### Step 6 — replace the global reviewer-assignment critical section

Refactor `assignReviewer()`, `replaceFailedReviewer()` and liveness/recovery helpers in `scripts/manage-migration-author-lanes.mjs`:

- run wrapper availability/doctor qualification before durable selection;
- reserve `refs/db-reviewer-reservations/<reviewer>` with compare-and-swap;
- advance the round-robin cursor in a short compare-and-swap transaction;
- persist issue/PR/bundle ID/head metadata;
- release the allocation mutex before remote execution;
- allow other free reviewers to be assigned concurrently;
- recover only a specific reviewer reservation after proving no verdict/artifact and dead/interrupted owner state;
- never replace a substantive `REVISE` or reduce coverage.

Keep exact-head metadata during rollout, but make bundle ID the review-content identity. Prohibited/unqualified providers are excluded before cursor selection, preventing the #1720 Kimi rotation.

**Dependencies:** Step 3 bundle identity. Can be implemented in parallel with Step 5 after schema freeze.
**Verification gate:** concurrency tests launch assignments for at least three issues and prove distinct reviewers reserve concurrently; interruption of one does not block others; duplicate assignment to one reviewer is impossible; stale recovery touches only that reviewer; all existing reviewer-replacement refusal tests remain green.

**Fresh-session cut:** update STATUS and start Phase D.

### Phase D — early qualification, automatic resume and measurement

### Step 7 — add route/verifier qualification before author completion

Create `scripts/orchestrator-flow/qualify-change.mjs` and tests. It is read-only and runs at claim/resume, before reviewer assignment and before preview. It reports:

- PR file-shape compatibility with claim split/supersession/recovery commands;
- migration dependency closure and ordered promotion batch;
- expected preview route from Step 5;
- historical evidence compatibility (original apply versus reconciliation versus supersession);
- whether catalog verification derives at least one valid target or a hash-bound Phase 1 sidecar/contract covers the change;
- global invalidators and required review coverage;
- `QUALIFIED`, `WAITING`, `BLOCKED`, or `UNVERIFIABLE` with one next action.

Do not duplicate enforcing logic. Call pure functions exported by the existing manager, production risk gate and catalog verifier, or add diagnostic modes to those modules. Qualification cannot approve a later stage; every enforcing workflow reruns its own live checks.

**Dependencies:** Steps 3–5 and Phase 1 sidecar contract where available.
**Verification gate:** fixtures detect #1684 removed-test supersession incompatibility, #1720 constraint-only missing verifier contract, #1646 two-version dependency and divergent supersession evidence before review/preview; known supported shapes qualify.

### Step 8 — automate blocker transitions, refill and resume

Create `scripts/orchestrator-flow/reconcile.mjs` and tests; expose `--reconcile-flow` from the main manager. It performs guarded coordination-ref/GitHub state transitions only, never database writes:

1. verify marker and current claims;
2. classify each issue state;
3. relinquish active-author lease for a durable external blocker while preserving claim;
4. fill free active-author capacity with highest-priority non-overlapping ready work;
5. detect blocker resolution or dependency-edge satisfaction;
6. reacquire an author lease when capacity exists and emit a resumable work item;
7. refuse if state changed during compare-and-swap.

The existing heartbeat calls reconciliation. It must be idempotent and safe when two heartbeats overlap. No background automation may create a structural claim without the live sole-orchestrator marker.

**Dependencies:** Steps 2, 5 and 7.
**Verification gate:** a fixture with #1658/#1645/#1684/#1720/#1646 all protected but externally blocked reports zero active authors and five protected claims, fills five safe non-overlapping issues, then resumes the correct original issue when its blocker closes without losing its claim.

### Step 9 — integrate Phase 1 blocker ledger and define success

Extend the Phase 1 blocker ledger/report rather than create a competing store. Add event fields or linked immutable records for:

- claim-protected minutes;
- active-author minutes;
- external-blocked minutes;
- reviewer-allocation wait;
- review execution wait;
- preview dependency wait;
- full review replays avoided/performed;
- route qualification catches;
- failed workflow runs avoided;
- invalidation class and evidence bundle IDs.

Backfill the §3 transcript as `estimate=false` only for observed event timestamps; leave active effort unknown. Headline post-rollout comparison requires at least 20 comparable issues and prints `n=`. Safety regressions are zero-tolerance and reported separately.

Success targets after 20 comparable post-rollout issues:

- zero object-claim collisions and zero weakened gates;
- blocked protected claims consume zero active-author slots;
- zero generic red runs for a known preview dependency;
- zero reviewer replays caused solely by `INTEGRATION_REFRESH_ONLY` changes;
- at least 50% reduction in median material loops per completed issue;
- every production verifier incompatibility caught by qualification before apply;
- p90 reviewer allocation under two minutes when a qualified reviewer is free.

**Dependencies:** Phase 1 Step 6 ledger plus Steps 1–8 here. If Phase 1 is not merged, land schema-compatible fixtures but do not publish comparative claims.
**Verification gate:** report tests exclude unknown/estimated data, separate wait classes, print sample sizes and refuse a success verdict if any safety regression exists.

### Phase E — staged rollout and landing

### Step 10 — verify, shadow, enable and ship

Roll out in reversible stages:

1. **Shadow:** commands compute new state/bundles/route/invalidation but existing enforcement remains authoritative. Record mismatches; any unsafe disagreement blocks enablement.
2. **Capacity:** enable claim/author-lease separation while collision enforcement remains dual-checked against old claims.
3. **Reviewer:** enable per-reviewer reservations; retain recovery compatibility for old assignment refs.
4. **Preview scheduler:** convert known dependency failures to waits and auto-resume; keep one preview lock.
5. **Evidence reuse:** enable `INTEGRATION_REFRESH_ONLY` review preservation last, after shadow corpus proves no false reuse.

Run focused tests after each step and the repository-required suites on a frozen tree. Update `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, the orchestrator skill/drift fixtures and issue #1738. Obtain one independent reviewer for repository-maintenance implementation. Open a PR, wait for all code checks, merge, verify merge SHA and post-merge checks, then observe at least one shadow/live transition fixture or non-production rehearsal without database mutation.

**Dependencies:** all prior steps.
**Verification gate:** main contains the merged implementation; required checks and skill drift are green; shadow report has no unsafe mismatches; no migration file changed; no database write occurred; rollback flags can restore old scheduling without deleting claims/evidence.

## 10. Required tests

- Existing `scripts/manage-migration-author-lanes.test.mjs` remains green, including collision, lease, reviewer replacement, stale recovery, supersession and exclusive-stage tests.
- `scripts/orchestrator-flow/baseline-schema.test.mjs`: source provenance, state separation, timestamp order, unknown duration handling.
- `scripts/orchestrator-flow/evidence-bundle.test.mjs`: canonicalization, every invalidator, dirty/missing file refusal, identical bundle across unrelated base movement.
- `scripts/orchestrator-flow/classify-invalidation.test.mjs`: all five classes and #1713 byte-identical fixture.
- `scripts/orchestrator-flow/preview-graph.test.mjs`: dependency cycles, #1713/#1720 order, automatic wake, historical route, evidence-type mismatch, #1646 closure.
- Reviewer concurrency tests: parallel assignment, per-reviewer exclusion, no global stall, exact recovery, prohibited-provider preflight.
- `scripts/orchestrator-flow/qualify-change.test.mjs`: #1684/#1720/#1646 late-failure fixtures and supported controls.
- `scripts/orchestrator-flow/reconcile.test.mjs`: idempotence, overlapping heartbeat compare-and-swap, blocked-claim capacity, priority/collision refill, exact resume.
- Phase 1 ledger/report tests extended for new timing classes and minimum sample rules.
- Workflow contract tests prove preview/merge/production refs remain exclusive and a `WAITING` dependency cannot reach apply.
- Static tests prove no code path releases an object claim on author-lease relinquishment/expiry.
- Failure injection after every ref write proves retry/recovery is idempotent.
- Run `node --test scripts/orchestrator-flow/*.test.mjs` plus repository-required Node/Python suites and `node scripts/check-skill-drift.mjs --require-skills`.

## 11. Constraints, standing rules and gotchas

- This plan is repository maintenance; never dispatch it through the structural orchestrator.
- Work in isolated worktrees from current `origin/main`; stage only owned files.
- Claims protect objects until explicit completion/reversion. Lease expiry is never claim expiry.
- Preview, merge and production writes remain single-holder.
- Bundle reuse never covers changed content, uncertain classification or unavailable evidence.
- A reviewer verdict covers one bundle ID and declared coverage. `REVISE` is never replaced.
- Qualification is advisory/refusal-only; enforcement reruns live at each irreversible gate.
- Existing refs and artifacts require a compatibility/migration period; never rewrite historical refs in place.
- GitHub rate limits matter: reconciliation must batch reads and avoid polling every claim continuously.
- Windows reviewer wrappers and current doctor semantics must remain supported.
- Do not log secrets, connection strings, licensed rows or transcript contents beyond scrubbed operational events.
- Do not treat overall issue age as throughput evidence.
- A change to `AGENTS.md` must be mirrored through the repository's skill-drift mechanism.
- Once scripts/workflows change, the PR is not documentation-only.

## 12. Access and environment

- Repository: authenticated `git`/`gh`, `u2giants/shared-db`, base `main`.
- Runtime: repository Node and Python on Windows; use project-supported commands.
- Coordination truth: GitHub refs under `refs/db-*`, GitHub issues/PRs/runs, and existing workflow artifacts.
- Database: implementation should need no database write. Read-only preview/production queries, if a test genuinely requires them, use the existing Management API and 1Password vault `vibe_coding`; never expose values.
- Private transcript source: local Codex archive for task `01a0461f-d1bf-7e02-8c84-ee8783f965b0`; do not commit the raw JSONL.
- Planning branch/worktree: `codex/issue-1738-throughput-phase-2` / `C:\repos\shared-db-worktrees\issue-1738-throughput-phase-2`.

---

# Part 4 — Landing it

## 13. Definition of done, risks and open questions

### Definition of done

- [ ] Protected claims and active-author leases are distinct, audited states.
- [ ] Blocked claims never consume author capacity and never lose collision protection.
- [ ] Reviews and downstream proof bind to canonical evidence bundle IDs.
- [ ] Unrelated `main` movement triggers integration refresh only; changed/uncertain inputs fail closed.
- [ ] Preview dependencies are explicit, ordered and automatically resumed without a red apply attempt.
- [ ] Reviewer assignment is concurrent across providers and interruption-isolated.
- [ ] Qualification catches every transcript-derived late incompatibility before the expensive/irreversible stage.
- [ ] Blocker/resume/refill reconciliation is idempotent and marker-bound.
- [ ] Phase 1 measurement reports causal waits/replays with sample sizes.
- [ ] All existing and new tests pass; no migration/database mutation occurred.
- [ ] Documentation and skill drift are synchronized.
- [ ] PR merged, post-merge checks green, issue #1738 current/closed, and this handoff retired with completion.

### Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Claim lost while author lease is released | separate refs/state, static invariant tests, dual-read shadow | disable lease separation; claims remain untouched |
| Review reused across meaningful change | canonical bundle, conservative invalidator, `UNVERIFIABLE` fail-closed | disable evidence reuse; return to exact-head replay |
| Preview dependency graph is wrong | ledger/main/claim cross-check, cycle refusal, shadow mode | disable scheduler; return to serialized manual dispatch |
| Two reviewers assigned same provider | per-reviewer compare-and-swap reservation | disable new allocator; retain old assignment refs |
| Automatic resume races changed state | marker proof plus compare-and-swap and live requalification | disable reconcile mutation; keep read-only audit |
| Qualification disagrees with enforcing workflow | enforcing workflow always wins; mismatch recorded as blocker | disable qualification gating, retain diagnostics |
| Legacy refs/artifacts become unreadable | versioned schema and compatibility readers | revert new writers; keep compatibility reader |
| More capacity overwhelms reviewer/preview stages | waiting states remain outside author cap; measure queues | lower active-author lease cap without changing claims |

### Open questions

No owner decision is required to begin implementation. The implementer may choose module boundaries and lease cadence under §8. The first shadow report may reveal a class that cannot safely be proven disjoint; classify it `UNVERIFIABLE` and retain full exact-head replay rather than asking for a safety exception. Any proposal to parallelize database writes or reduce reviewer coverage is outside this plan and requires a separate owner decision.

## Self-audit

1. **Can a brand-new session execute this without chat context? Yes.** §§1–4 define the business goal, repository, trigger, complete transcript evidence and scope. §§5–8 give code anchors, root cause, rejected approaches and locked decisions. §9 names ordered files/functions, dependencies, phase cuts and verification gates.
2. **Does the plan carry every relevant background, nuance and reasoning? Yes.** §3 preserves every material timeline event and requested-queue finding used in the diagnosis; §6 explains why each design follows; §7 prevents repeating unsafe or ineffective alternatives.
3. **Is the goal sufficient for judgment calls? Yes.** §1 makes five safe productive workstreams, immutable proof and unchanged deployment serialization controlling. §§8, 11 and 13 require ambiguity to fail closed and provide rollback boundaries.

All 13 required sections are present. Tests are behavior-specific, access names locations without secrets, every step has a verification gate, and the definition of done includes commit, push, CI, merge and post-merge proof.
