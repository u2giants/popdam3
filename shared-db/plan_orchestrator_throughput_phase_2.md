# Implementation plan — orchestrator throughput Phase 2: eliminate cross-issue invalidation

**Repository:** `u2giants/shared-db`
**Tracking issue:** [#1738](https://github.com/u2giants/shared-db/issues/1738)
**Work class:** repository maintenance only
**Created:** 2026-08-28; consensus revision in progress after Grok 4.6 and Claude Opus 5 review
**Evidence session:** Codex task `01a0461f-d1bf-7e02-8c84-ee8783f965b0`, title `shared-db.orch`, observed 2026-08-28 02:08–03:56 UTC with final issue-state audit at 09:47 UTC
**Handoff:** [`HANDOFF.d/2026-08-28T1000Z-edge-dev-codex-throughput-phase-2.md`](HANDOFF.d/2026-08-28T1000Z-edge-dev-codex-throughput-phase-2.md)
**Consensus ledger:** [`docs/verification/orchestrator-throughput-phase-2-consensus-20260828.md`](docs/verification/orchestrator-throughput-phase-2-consensus-20260828.md)

This is Phase 2 of the throughput repair. Phase 1 is [`plan_orchestrator_throughput_guard_truth.md`](plan_orchestrator_throughput_guard_truth.md): it makes guard diagnoses truthful, reproducible and measurable. Phase 2 removes avoidable cross-issue waiting and repeated evidence work. It incorporates Albert's 2026-08-27 instruction in [`plan_author_lane_capacity_five_to_eight.md`](plan_author_lane_capacity_five_to_eight.md): after capacity is separated from protection and reviewer capacity is grown to at least six active rotation providers, the active-author cap becomes eight. It changes coordination scripts, workflows, tests and operating documentation only. It authorizes no migration, preview write, production write, infrastructure mutation or credential change.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Plan, evidence, handoff and tracking issue registered | ✅ done 2026-08-28 | this file; linked handoff; issue #1738 |
| 1 | Freeze a machine-readable transcript baseline and throughput model | ✅ done 2026-08-28 | scrubbed baseline JSON; hermetic schema tests; required CI guarded glob |
| 2 | Separate protected object claims from active author capacity | ✅ done 2026-08-28 | versioned capacity fence; guarded relinquish/resume; collision and audit tests |
| 3 | Add immutable, content-addressed evidence bundles | ✅ done 2026-08-28 | canonical bundle schema/CLI; invalidator discovery; dirty/missing fail-closed tests |
| 4 | Revalidate by proven invalidation class instead of unrelated `main` movement | ✅ done 2026-08-28 | five-class conservative classifier; #1713 integration-only fixture |
| 5 | Add an explicit shared-preview dependency graph and durable ready instruction | ✅ done 2026-08-28 | live repository-variable/ledger reader; deterministic route/ready identity; historical dry-run refusal |
| 6 | Make reviewer allocation concurrent with short per-reviewer reservations | ✅ activated 2026-08-28 | canonical execution-key reservations; ordered durable wait/claim tests; six-reviewer roster approved |
| 7 | Preflight route and verifier compatibility before expensive work | ✅ done 2026-08-28 | thin Node qualification over Python risk/catalog diagnostics; #1684/#1720/#1646 fixtures |
| 8 | Automate blocker transitions, capacity refill and resume | ✅ done 2026-08-28 | marker-bound live adapter; guarded transitions; successor-first ready refs; explicit UNVERIFIABLE exit 2 |
| 9 | Integrate Phase 1 measurement and prove throughput without weakening safety | ✅ schema/report done 2026-08-28 | one ledger schema; separated waits; observed-only n=20 and zero-tolerance safety tests |
| 10 | Full verification, staged rollout, landing and post-merge proof | 🚧 landing | Albert approved Codex GPT-5.6 Sol and DeepSeek; six-reviewer rotation and cap eight activated; merge/post-merge proof pending |

**Fresh implementation starts at Step 1.** Use a fresh session at each phase boundary: Phase A = Steps 1–2, Phase B = Steps 3–4, Phase C = Steps 5–6, Phase D = Steps 7–9, Phase E = Step 10. Re-read the remaining plan and current `origin/main` before each phase.

---

# Part 1 — Why

## 1. Ultimate goal

Albert should be able to run five independent structural workstreams without one issue repeatedly invalidating another issue's review, preview or production proof. A blocked issue must continue protecting its database objects, but it must not falsely consume an active worker slot. Unrelated changes on `main` must trigger integration rechecks, not a complete independent-review replay, when immutable evidence proves the reviewed migration and every safety-sensitive input are unchanged. Shared preview, merge and production remain serialized and fail closed.

When complete:

1. The dashboard distinguishes **protected claims**, **active authors**, **waiting work**, and **deployment-stage ownership**; the active-author cap is eight after its reviewer-capacity prerequisite is proven.
2. Each review and rehearsal is bound to an immutable content bundle, not merely a moving Git commit.
3. A newer `main` commit causes only the revalidation justified by its proven impact class.
4. Preview-only dependencies become an explicit queue edge with durable automatic readiness and an exact manual-dispatch instruction, not a failed workflow and manual diagnosis.
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
| 02:35 | preview applied, but documentation-only merge `ddcdd5da` (PR #1728: `HANDOFF.md` plus the five-to-eight plan) moved `main` | successful evidence became stale although no #1713 migration/test or enforcing input changed |
| 02:35–03:01 | #1713 refreshed and obtained a second independent review although migration SQL remained byte-identical | avoidable review replay |
| 02:49 | #1684 supersession rejected a PR that deleted an obsolete test, not a migration | route compatibility defect discovered late |
| 02:51 | maintenance blocker #1729 filed; #1684 claim remained occupied | valid protection, false capacity use |
| 02:55 | #1720's assigned Kimi route was structurally unusable for that caller (`execution-context-denied`) and had to rotate to Muse | caller-specific eligibility was known only after assignment |
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
2. Review evidence is keyed to an exact Git head even when the reviewed migration, test and safety inputs are byte-identical. PR #1728 changed only `HANDOFF.md` and `plan_author_lane_capacity_five_to_eight.md`, yet #1713 had to merge that `main` movement and repeat review.
3. Preview is one mutable ordered ledger, but its unmerged-version dependencies are discovered by failing workflows instead of represented as queue dependencies.
4. Reviewer selection uses shared coordination and can leave stale global state after interruption. General local/provider qualification correctly remains post-assignment, while the current assigning process must be able to detect its own `execution-context-denied` result for one selection attempt without persisting a caller/provider ban.
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
  - `MAX_AUTHOR_LANES`, `assertLaneAvailable()` and the `--audit` branch in `main()` count every readable claim against capacity, regardless of the existing lease's `active` flag.
  - `parseAuthorLease()`, `claimBody()`, `DEFAULT_LEASE_HOURS` and `renewExpiredClaim()` implement the existing `db-author-lease`. Its expiry is an audit warning and must never become the new capacity signal.
  - `buildDynamicQueues()` groups overlapping object/read components but allocates exactly `MAX_AUTHOR_LANES` queue objects; more protected claims can exhaust `free[0]`. It must be redesigned before protected claims may exceed the active cap.
  - `acquireAuthorLane()` creates claims. `expandActiveClaimFromPr()`, `expandActiveClaimFromIssue()` and `recoverSameOwnerSplit()` contain additional capacity assumptions that must be updated together.
  - `MUTEX_REF` is shared by claim/reviewer coordination and can require recovery after interruption.
  - `assignNextReviewer()` and `replaceFailedReviewer()` bind durable assignments to issue, PR and exact head. Remote review already runs after the mutex is released; the transcript problem was a stale global allocation mutex, not a mutex held throughout review.
  - `githubIo.updateRef()` force-updates with no expected SHA. There is no Git-level compare-and-swap; atomic occupancy comes from `createRef()`/`acquireRef()` plus the mutex.
  - `EXCLUSIVE_REFS` correctly keeps preview, merge and production serialized; preserve it.
  - `--supersede-active-claim-version` is the governed version-recovery route implicated by #1684/#1729.
- `scripts/db-coordination-events.mjs` is the existing append-only lifecycle store. Extend `EVENT_TYPES` for new lifecycle events, but add to `STAGE_PAIRS` only a genuine acquired/released exclusive stage. `preview_wait` and `preview_ready` are never stage pairs. Phase 2 must not create a competing event store.
- `scripts/lib/exclusive-lease.mjs` and `scripts/lib/exclusive-lease.test.mjs` deliberately reject heartbeat/renewal for preview, merge and production because moving a held ref strands release and opens races. Phase 2 must preserve that decision.
- `recoverStaleAuthorMutex()` has a fixed recognized-lock allowlist duplicated in `scripts/lib/exclusive-lease.test.mjs`; every new coordination lock kind must update both in the same PR.
- `scripts/check-dispatch-collision.mjs` independently parses/emits claim bodies and must remain compatible with any new capacity-state fence.
- `scripts/check-migration-pr-lease.mjs` imports `parseAuthorLease()` and is the required `Migration author lease` check. It currently refuses expired leases. Phase 2 must keep it fail-closed: a relinquished or expired-capacity claim cannot merge; resume must reactivate capacity and renew the time lease before required CI/merge.
- `docs/agents/section-4-anti-collision-rules.md`
  - says claims occupy a lane until released;
  - documents five author lanes and explicit queue refill;
  - documents reviewer assignment/replacement;
  - documents preview-ahead failure, post-merge rehearsal and historical preview recovery.
- `.github/workflows/shared-supabase-migrations.yml` owns preview dry-run/apply, merged rehearsal and historical recovery inputs.
- `.github/workflows/guarded-migration-merge.yml` owns exact-head merge gating.
- production workflows consume immutable review and preview artifacts plus current-main evidence.
- `plan_author_lane_capacity_five_to_eight.md` records Albert's 2026-08-27 instruction to raise the author cap to eight, conditional on at least six active rotation reviewers. Phase 2 subsumes that plan: it applies eight to active capacity leases after decoupling, not to the total number of protected claims.
- Phase 1 plan #1680 is merged as documentation but its implementation steps remain open at plan creation. Phase 2 must use its blocker ledger and truth commands when they exist; until then, Phase 2 tests use fixtures and must not invent production measurements.

No Phase 2 implementation exists. Issue #1738 and this documentation are the only work started.

## 6. Key findings and reasoning

### 6.1 Object protection and worker capacity are separate invariants

Releasing #1658 or #1645 merely to free capacity would be unsafe because #1703 or another issue could then claim overlapping objects. Counting them as active authors is also false: the transcript explicitly showed five occupied lanes and only three workers. Therefore a claim must remain authoritative while its active-author lease may be relinquished.

### 6.2 Content identity can preserve review without accepting changed code

The #1713 second review occurred after documentation-only merge `ddcdd5da` changed `HANDOFF.md` and `plan_author_lane_capacity_five_to_eight.md`; its migration and test did not change. A safe reuse rule cannot merely say “the files look unrelated.” It must bind the reviewer verdict to a canonical bundle containing every reviewed migration, rollback/test, sidecar/catalog contract, relevant coordination script/workflow/policy version, object claim and base policy version. If any bundle member changes, independent review is invalid. If only non-invalidating files change, the refreshed PR head must still be based on current `origin/main`, run full CI successfully, and rerun collision/order/integration checks before the unchanged review can be reused.

### 6.3 Shared preview needs a scheduler model, not weaker isolation

#1720 correctly could not proceed while preview contained unmerged #1713. The failure was expected and deterministic. The fix is an explicit dependency edge `#1720 waits-for merge/proof of #1713`, not allowing #1720 to ignore the ledger and not creating concurrent preview writes.

### 6.4 Evidence provenance must be typed

#1720 first selected a normal post-merge route although its version was already on preview. #1646 initially selected a ledger-rename event instead of the original preview apply. Evidence records need types such as `original_preview_apply`, `historical_rebind`, `post_merge_rehearsal`, `ledger_reconciliation`, and `supersession`; validators must accept only a legal type for each route.

### 6.5 Late compatibility checks manufacture rework

#1684's removed-test-file incompatibility, #1720's constraint-only verifier gap and #1646's dependency/supersession incompatibility were properties of the PR/evidence shape before the expensive stages. A read-only qualification command should predict the allowed routes and verification contract before authoring completion.

### 6.6 Serialization is required only around state mutation

Selecting a reviewer needs atomic roster/cursor updates, but remote review execution already occurs outside the mutex. Per-reviewer `createRef()`/`acquireRef()` reservations allow unrelated providers to reserve concurrently. The round-robin cursor either remains inside a very short `MUTEX_REF` critical section or becomes append-only assignment refs read through `listRefs()`; it must not assume `updateRef(force=true)` is compare-and-swap. Preview/merge/production mutation remains globally serialized and receives no heartbeat.

## 7. Approaches considered and rejected

1. **Release blocked claims.** Rejected: it removes collision protection and can dispatch overlapping work.
2. **Raise the cap as a substitute for decoupling.** Rejected: it does not fix false capacity accounting. Albert's separate 2026-08-27 instruction to raise active authors from five to eight remains binding and is incorporated after decoupling plus reviewer-roster growth.
3. **Parallel preview or production applies.** Rejected: one shared ordered ledger/database requires serialization.
4. **Reuse any review when migration SQL alone is unchanged.** Rejected: tests, sidecars, policies, workflows or coordination code may change the risk.
5. **Treat an unrelated filename as automatically safe.** Rejected: shared scripts/workflows and object contracts can affect every migration.
6. **Keep exact-head replay for every `main` movement.** Rejected: #1713 proves it repeats expensive review for byte-identical evidence; replace it with exact-bundle review plus current-main integration proof.
7. **Allow successors to preview over unmerged predecessors.** Rejected: it hides dependency/order and cannot produce truthful isolated evidence.
8. **Add a timeout that deletes stale mutexes blindly.** Rejected: elapsed time cannot prove abandonment. Recovery must verify owner/task liveness, fence on the exact owner SHA, and use the existing serialized recovery marker.
9. **Precompute every SQL dependency semantically.** Rejected: a general SQL analyzer is unsafe and out of scope. Use declared migration dependencies plus observed preview-ledger order and existing object claims.
10. **Close an issue after production SQL even when verification fails.** Rejected: #1720 demonstrates that apply plus failed verification is not completion.
11. **Fold Phase 2 into Phase 1 #1680.** Rejected: truth/measurement and concurrency/evidence architecture have different failure modes, rollout risks and rollback boundaries.
12. **Automatically dispatch preview/production from readiness.** Rejected after multi-round review: admission refs, workflow-to-workflow calls or dispatch-time validators can displace the single pending shared run, attach false required-check failures to a PR head, execute proposed code as authority, or require unsafe permissions. Phase 2 stops at durable readiness and preserves manual dispatch.

## 8. Locked decisions and implementer judgment

### Locked on 2026-08-28

- Preserve exact object claims for every unresolved structural issue, including externally blocked issues.
- Only renewable `active-author` leases count toward the configured active-author cap.
- Preview, merge and production remain single-holder and fail closed.
- Albert's 2026-08-27 five-to-eight instruction is implemented as eight **active-author capacity holders**, never as a limit of eight protected claims, and only after at least six active rotation reviewers are proven.
- Review reuse is keyed to a canonical content bundle, never issue number, PR number, branch name or migration hash alone.
- Any changed bundle member invalidates review; current-main integration checks always rerun.
- `githubIo.updateRef(force=true)` is not compare-and-swap. New concurrency uses create-if-absent refs or the existing short mutex.
- No heartbeat or renewal is added to `EXCLUSIVE_REFS`; the repository's #1366 decision remains controlling.
- A preview dependency wait can never have a GitHub `success` conclusion or artifact that satisfies a required/apply check. Only a real apply or validated rebind produces success evidence.
- A shared/global script, workflow, policy, migration-order or claimed-object overlap is a conservative invalidator.
- Required review coverage is unchanged.
- Preview-ahead state produces a dependency edge and wait status, not acceptance and not a misleading generic failure.
- Phase 2 creates no automatic dispatcher, admission ref/token, workflow-to-workflow call, new check context or concurrency/permission/dispatch-input change. `PREVIEW_WAIT`/`PREVIEW_READY` are coordination events/refs only; existing manual preview/production dispatch remains authoritative.
- Route qualification is read-only. It may refuse or report unavailable; it may not mutate refs, GitHub, preview or production.
- Phase 1 blocker-ledger records are the measurement authority once available.

### Owner decision required before Step 10 cap activation

Albert's 2026-08-27 instruction authorizes the five-to-eight goal and requires at least six active rotation reviewers first. The live roster has four. Before Step 10 activates eight, Albert must approve the exact two providers after real wrapper qualification evidence is available. They must be distinct provider/wrapper identities; retired `glm-5.2` is the same `ai-glm` provider family as active `glm-5.3` and cannot count as another independent slot. At least one genuinely new qualified provider is therefore required even if Qwen is safely un-retired. This does not block Phases A–D, the safety architecture, or shadow implementation; it blocks only roster mutation and cap activation.

### Implementer judgment

- JSON schema/file naming for bundles and state events, provided files are immutable/content-addressed or written under the existing owned mutex/create-if-absent discipline.
- Internal module boundaries remain implementer judgment, but the reviewed operator interface is fixed: `scripts/manage-migration-author-lanes.mjs` exposes the Step 8 reconcile/preparation/repair subcommands and delegates to testable pure functions.
- Exact active-capacity relinquish/resume record shape after fixture-driven analysis. Existing clock expiry may release neither object protection nor active capacity automatically.
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

Change `.github/workflows/migration-author-lease.yml` in this same Phase A PR so its required job runs all `scripts/orchestrator-flow/*.test.mjs`. Use the repository's established guarded-glob pattern: `shopt -s nullglob`, collect the array, fail clearly when empty, require the named `baseline-schema.test.mjs` backstop, then pass the array to `node --test` alongside the existing nine suites. Every later phase adds its newly named test file to the presence-backstop list in the same PR that creates it. Every test in this required glob must be hermetic and fully dependency-injected: no network, live GitHub refs, repository variables, credentials, Management API, database or clock dependence. Live adapters are covered by injected success/failure fixtures; authenticated live checks remain operator activation gates. This CI wiring lands before any Phase A cut; it is not deferred to Step 10.

Also extend `scripts/test_production_migration_guard.py` in Phase A, before Step 5 depends on it. Add dependency-free structural/static assertions for the shared workflow's existing concurrency expression, permissions, dispatch-input schema, required job graph and deliberately-first target checks, plus the existing manual route/evidence obligations in `docs/production-promotion-procedure.md`. Preserve that test's no-PyYAML invariant: extend its existing `_steps()` / `_run_block_commands()` helpers and job-slicing idiom rather than adding an optional parser. These behavioral invariants—not a whole-file or branch-wide diff—prove that Phase 2 cannot weaken either contract while allowing unrelated future maintenance. Step 5 later adds and pins the historical-recovery warning in that same procedure, which already carries preview-rehearsal guidance, and synchronizes it into AGENTS/anti-collision/skill operator instructions.

The JSON carries the issue table and timeline in §3 with source task ID, observation window, event timestamps, issue/PR/workflow IDs, `measurement_kind`, and explicit `unknown` fields. It must distinguish observed wall time from active effort and must not embed transcript text that contains secrets or licensed data. Add rerunnable GitHub proof commands for durable issue/PR/run facts; local transcript timestamps are labeled private-source observations.

Define states independently:

- claim: `protected | released`;
- author lease: `active | relinquished | expired-unconfirmed`; an “idle” dashboard label is derived from an active capacity lease with no live worker, still counts toward the cap, and is never a fence value or a bypass around guarded relinquishment;
- issue flow: `ready | authoring | ci | review-wait | review | preview-wait | preview | merge | production | external-blocked | owner-decision | complete`;
- evidence: `missing | current | stale-by-content | integration-refresh-required | unavailable`.

Extend the existing `scripts/db-coordination-events.mjs` vocabulary for these transitions; do not create a second event store. The baseline schema may define payload validation, but durable lifecycle events remain in that module.

**Dependencies:** none.
**Verification gate:** schema tests reject conflated claim/lease state, invented durations, impossible event order and a “five active workers” assertion when only three worker events exist; the required `Migration author lease` job runs the guarded test array, fails on an empty glob/missing named backstop, includes `baseline-schema.test.mjs` in its output, and runs with all live adapters injected/offline. The production guard test proves the named workflow and promotion-procedure invariants before Step 5 starts.

### Step 2 — separate protected claims from active-author leases

Change `scripts/manage-migration-author-lanes.mjs` around `parseAuthorLease()`, `claimBody()`, `assertLaneAvailable()`, `buildDynamicQueues()`, `acquireAuthorLane()`, `renewExpiredClaim()`, `expandActiveClaimFromPr()`, `expandActiveClaimFromIssue()`, `recoverSameOwnerSplit()`, and the `--audit`/`--queue-audit` branches in `main()`. Also update `scripts/check-dispatch-collision.mjs`, `scripts/db-coordination-events.mjs`, the stale-mutex recognized-kind allowlist in `recoverStaleAuthorMutex()`, and its duplicate assertion in `scripts/lib/exclusive-lease.test.mjs`. Add commands:

- `--relinquish-author-lease --claim <n> --blocked-on <issue-or-artifact>`;
- `--resume-author-lease --claim <n>`;
- `--flow-audit --json`.

A protected claim remains in collision calculations and continues owning its migration version/object set. Extend the existing `db-author-lease` fence with a distinct capacity field (`capacity_state: active | relinquished | expired-unconfirmed`) and optional `blocked_on`; do not use its existing `expires_at`, parsed `lease.active`, or clock expiry as the capacity signal. Relinquishment requires a typed blocker with a durable GitHub issue or immutable artifact, clean worktree proof and no active preview/merge/production holder for that claim. Resume atomically reacquires capacity, renews `expires_at`, and rechecks every collision/version reservation before CI/review/merge. Existing lease expiry releases neither claim nor capacity automatically; it yields `expired-unconfirmed` and blocks mutation until guarded recovery.

Update `scripts/check-migration-pr-lease.mjs` and its test explicitly. The required check stays red for every `capacity_state != active` and every expired time lease. A blocked/relinquished PR is not merge-ready and need not remain green; only guarded resume plus renewal can restore the required check. Never “fix” blocked PR noise by accepting relinquished or expired claims.

`buildDynamicQueues()` must allocate/display collision components independently of the active-author slot array, so any number of protected blocked claims can remain visible without indexing an empty `free[0]`. Remove total-claim-count ambiguity/refusals from expansion and split recovery while preserving collision/version checks. Plan Markdown is evidence/history, never runtime policy input: the enforced cap comes from the code constant plus synchronized `AGENTS.md`/skill authority. The active cap becomes eight only after Albert approves the exact roster change and at least six active reviewers are proven; otherwise it remains five and reports the unmet prerequisite.

Every relinquish/resume/reconcile lock kind is added to the recovery allowlist and `exclusive-lease.test.mjs` in the same change. Extend `db-coordination-events.mjs` with exported constructors/writers for `author_capacity_relinquished`, `author_capacity_resumed`, `issue_blocked`, and `issue_unblocked`; wire manager transitions to those writers. Add `scripts/orchestrator-flow/coordination-audit.mjs` as the explicit CLI over `validateEvent()`/`auditTimeline()`/`renderTimeline()`. There is no second store. Both claim parsers accept the extended fence and continue failing closed on malformed bodies.

Update `docs/agents/section-4-anti-collision-rules.md` and `AGENTS.md` so “five lanes” means five active authors, not five protected claims. Keep queue grouping aware of all claims. Land the matching `shared-db-orchestrator` skill text and drift fixture in the same Phase A change; Phase A cannot complete while the checked-in rule and synchronized skill disagree.

**Dependencies:** Step 1.
**Verification gate:** tests prove at least eight blocked protected claims plus eight non-overlapping active authors are representable when reviewer capacity is approved/proven; the next overlapping issue remains blocked; expansion/supersession/split recovery work with more protected claims than the active cap; existing clock expiry frees zero capacity; `check-migration-pr-lease.mjs` refuses expired active-capacity and all relinquished claims; guarded resume renews/reactivates before the check can pass; releasing only capacity never permits an object/version collision; interrupted relinquish/resume is recoverable and idempotent; both claim parsers accept the new fence; `node scripts/orchestrator-flow/coordination-audit.mjs` replays emitted relinquish→blocked→unblocked→resume events without double-acquisition.

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

Version and publish the global-invalidator inventory in `config/orchestrator-global-invalidators-v1.json`. It includes every file imported, invoked or used as policy by claim/collision, reviewer assignment, preview, guarded merge, production review/risk/catalog verification and evidence recovery. Mandatory starting members include `scripts/manage-migration-author-lanes.mjs`, `scripts/lib/exclusive-lease.mjs`, `scripts/lib/work-dependencies.mjs`, `scripts/check-dispatch-collision.mjs`, `scripts/check-pr-object-collisions.mjs`, `scripts/production_business_risk_gate.py`, `scripts/production_catalog_verification.py`, `scripts/production_apply_review_evidence.py`, their imported helpers, all workflows that dispatch or consume these artifacts, `config/atomic-migration-allowlist.json`, `config/production-risk-policy-activation.json`, `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, and the migration-order digest. A discovery test walks imports, workflow `run`/`uses` references and configured policy inputs; discovered-but-unlisted or listed-but-missing files fail. Inventory uncertainty is `UNVERIFIABLE`.

The bundle ID is the canonical JSON SHA-256. Unknown keys, unstable ordering, absent files, dirty worktrees and mismatched hashes fail. Review artifacts attest the bundle ID. Existing exact-head fields remain during migration and are cross-checked, not silently ignored.

**Dependencies:** Phase A state schema.
**Verification gate:** byte-identical relevant content on a refreshed branch yields the same bundle ID; changing any migration, test, sidecar, claimed object, discovered helper, workflow or policy changes it; `HANDOFF.md` and the five-to-eight plan from real commit `ddcdd5da` do not; deleting a required invalidator or adding an imported-but-unlisted helper fails closed.

### Step 4 — classify `main` movement and run only justified revalidation

Create:

- `scripts/orchestrator-flow/classify-invalidation.mjs`
- `scripts/orchestrator-flow/classify-invalidation.test.mjs`

Integrate it into reviewer validation, `guarded-migration-merge.yml`, the read-only preview route selector/ready artifact, and production evidence generation.

Classes:

1. `CONTENT_INVALIDATED`: a bundle member changed — new review and all downstream evidence required.
2. `GLOBAL_INVALIDATOR`: coordination/guard/workflow/policy/migration-order input changed — new bundle/review unless a specifically versioned compatibility rule proves equivalence.
3. `OBJECT_INTERACTION`: intervening claim/write/read overlaps — new focused review/integration evidence.
4. `INTEGRATION_REFRESH_ONLY`: bundle identical and intervening changes proven disjoint — rerun merge-base, collisions, full CI and migration-order checks; preserve the original independent review verdict.
5. `UNVERIFIABLE`: evidence unavailable or classification ambiguous — fail closed and require full refresh.

The classifier must be conservative. It never uses path names alone: it combines canonical bundle membership, object-claim manifests, migration ordering and the versioned global-invalidator inventory/discovery check.

Review reuse authorization is closed and explicit. After rebasing/merging current `origin/main`, the new PR head may reuse an unchanged bundle verdict only when all are true: the bundle ID is identical; the new head's merge-base is current `origin/main`; every required full-CI check on the new head concludes `success`; collision and migration-order checks rerun on the new head; the invalidation classifier returns only `INTEGRATION_REFRESH_ONLY`; and immutable production evidence names both the reviewed bundle ID and the current integration SHA. `guarded-migration-merge.yml`, `production_apply_review_evidence.py`, `production_business_risk_gate.py`, the ready artifact/selector and historical recovery dual-read exact-head plus bundle fields during shadow rollout; disagreement means existing exact-head enforcement wins. No neutral/wait result can satisfy a required check.

**Dependencies:** Step 3.
**Verification gate:** a fixture built from real commit `ddcdd5da` (`HANDOFF.md` and `plan_author_lane_capacity_five_to_eight.md`) plus #1713's unchanged migration/test returns `INTEGRATION_REFRESH_ONLY`; if either file becomes a discovered invalidator the fixture must not return that class; changed SQL, changed verifier/helper/workflow/policy/sidecar and overlapping object fixtures all invalidate; missing successful full CI, non-current merge-base, bundle/integration-SHA mismatch or unavailable history returns `UNVERIFIABLE` exit 2.

**Fresh-session cut:** freeze bundle schema v1, update STATUS and start Phase C.

### Phase C — explicit preview dependencies and concurrent review allocation

### Step 5 — build the shared-preview dependency graph and deterministic route selector

Create:

- `scripts/orchestrator-flow/preview-graph.mjs`
- `scripts/orchestrator-flow/preview-graph.test.mjs`
- `scripts/orchestrator-flow/select-preview-route.mjs`
- `scripts/orchestrator-flow/select-preview-route.test.mjs`
- `scripts/orchestrator-flow/read-preview-ledger.mjs`
- `scripts/orchestrator-flow/read-preview-ledger.test.mjs`

Modify in the same Step 5 PR:

- `scripts/check-migration-ledger-drift.mjs` and `scripts/check-migration-ledger-drift.test.mjs` while preserving their named exports and required-CI behavior;
- the new named read-only ledger helper/test above;
- `config/orchestrator-global-invalidators-v1.json` plus its discovery/completeness fixture for every new or newly imported helper;
- `.github/workflows/migration-author-lease.yml` to add every new Step 5 test to the guarded named-file backstop;
- `scripts/test_production_migration_guard.py` and `docs/production-promotion-procedure.md` to add/pin the historical-dry-run no-evidence warning;
- `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, the synchronized `shared-db-orchestrator` skill and drift fixtures with the same historical-recovery apply-only warning.

Inputs are read-only: current `main` migration set, preview ledger, active claims, bundle IDs, original preview artifacts and typed recovery records. Output includes ordered nodes, edges, reason, next legal route and blockers.

Runtime preview-ledger truth comes from the existing read-only Management API path, not guesswork or a pinned preview literal. Read the live repository variable `PREVIEW_PROJECT_REF` through the authenticated GitHub variables API or the installed `gh variable` surface after capability discovery; require `^[a-z]{20}$` exactly as the workflow does, refuse unset values, and refuse equality with `PROJECT_REFS.production`. `read-preview-ledger.mjs` exposes injected `readRepoVariable()` and `fetchAppliedVersions(projectRef)` adapters; tests supply both, while runtime adapters own GitHub/auth/fetch. Factor `APPLIED_VERSIONS_SQL` and the existing fetch implementation into that helper while retaining compatible named exports for the drift command/tests. The selector may import `PROJECT_REFS.preview` **only** for the equality cross-check; it must never use that literal as a query target, default or fallback. Identity disagreement returns `UNVERIFIABLE` plus the existing same-change repair instruction. The operator supplies the existing GitHub authentication and `SUPABASE_ACCESS_TOKEN` through protected environment/1Password procedures; the command quotes the validated preview project ref before the single constant SELECT and never writes. Missing API/CLI capability, authentication/token, invalid/production-equal ref, identity disagreement, repository-variable read failure, HTTP failure or malformed rows is `UNVERIFIABLE` exit 2. Prior artifacts/events provide provenance and route evidence but never replace both fresh live-identity and ledger reads immediately before manual dispatch.

Required behavior:

- preview contains an unmerged version from issue A and issue B is next → B becomes `preview-wait` with edge `B -> A merge-and-bind`;
- the read-only selector derives that A's merge/rebind event satisfies the edge; Step 8 alone persists or refreshes B's ready event and optional task wake;
- already-applied exact bytes select historical rebind, not ordinary replay;
- post-merge absent version selects merged rehearsal;
- superseded version, ledger rename and original apply are distinct evidence types;
- ambiguous/missing producer evidence returns `UNVERIFIABLE`, never guesses;
- dependency closure is printed before production dry-run, so #1646-like two-version batches are known early.

Do **not** add an automatic GitHub dispatcher, admission token/ref, workflow-to-workflow call, new check context or concurrency-group change in Phase 2. Those designs were debated and rejected because they can attach false required-check failures to a PR head, displace the one pending shared workflow run, execute proposed validator code from the proposed ref, or require new write permissions in a required PR job.

The selector is read-only and produces one route decision:

- `PREVIEW_WAIT`: dependency edges plus the exact event that can satisfy each edge;
- `PREVIEW_READY`: exact current PR head, bundle ID, preview route, complete **preview-target-only** existing workflow input manifest and a human-readable manual-dispatch instruction; production fields are absent;
- `UNVERIFIABLE`: exit 2 with missing/ambiguous evidence.

A wait creates no workflow/check run, lock or apply/rebind artifact. Step 5 returns typed decisions only; Step 8 adds the durable `preview_wait` and `preview_ready` event writers when it implements persistence. They are lifecycle events, never `STAGE_PAIRS` exclusive-stage pairs.

Step 8 materializes readiness under a matching live marker. The closed route enum is `ordinary_preview_apply | merged_rehearsal | historical_rebind`. Define `ready-id` from issue + exact current PR head + bundle ID + route + route context, encoded as a ref-safe deterministic digest. Route context is empty for ordinary preview and is the exact current-main `commit_sha` for merged rehearsal and historical rebind. Create immutable `refs/db-preview-ready/<ready-id>` containing the full tuple and route-required preview manifest. Create exactly one terminal `refs/db-preview-ready-outcomes/<ready-id>` via create-if-absent, whose payload is `dispatched | superseded | cancelled`; sibling outcome paths are forbidden, so two terminal writers yield one first-writer result. Only marker-bound Step 8 lifecycle handling may persist drift transitions. Its explicit preparation path creates/readbacks the new current ready ref **before** terminalizing stale unresolved refs as `superseded`, so a crash cannot leave no actionable successor; old records are never rewritten.

Closed, merged or cancelled issues cannot leave actionable orphan readiness. Reconciliation derives the terminal fact from live GitHub state and creates the one terminal outcome (`dispatched` when exact dispatch evidence exists, otherwise `cancelled`) without deleting or rewriting the ready ref. The `superseded` payload is written only by marker-bound Step 8 preparation after its successor is created/read back, never by ordinary reconcile or the selector. `--queue-audit` reports malformed records and ready refs whose issue/PR no longer has a live actionable state; it may terminalize them only from exact live proof while a matching sole-orchestrator marker is present. Without that marker it reports only. Ambiguous lifecycle evidence is `UNVERIFIABLE` exit 2.

The ready manifest contains every invariant field required by its preview route: ordinary includes `target=preview`, `preview_allowlist`, `claim_pr`, `claim_head_sha`; merged/historical also include `commit_sha` and their matching `merged_preview_*` or `historical_preview_*` maps. Its mode instruction is route-specific and matches the existing workflow: `ordinary_preview_apply` and `merged_rehearsal` run `mode=dry-run` then `mode=apply`; `historical_rebind` runs the existing recovery `mode=apply` only and must never dispatch a historical-input dry-run. `mode` is a per-run phase, not part of ready identity or frozen-manifest equality. It explicitly omits all fields that are not legal inputs to these manual preview routes: `target=production`, `production_allowlist`, `confirmation`, `review_*`, `owner_decision_*`, `source_pr`, `preview_run_id`, and `preview_artifact_digest`. Do not infer relevance from a YAML human label alone—`commit_sha` is required by preview recovery routes even though its description says production.

The existing workflow can accept historical inputs with `mode=dry-run`; it runs source validation but skips every migration apply, recovery-proof write and instance binding, then can still produce a green ledger-only dry-run artifact. Phase 2 deliberately does not modify that shared workflow; therefore that combination is never sanctioned evidence. The selector must refuse to emit it, and the Step 5 promotion procedure plus AGENTS/anti-collision/skill instructions and their tests/drift fixtures must warn that it proves nothing. A future workflow-level hard refusal is a separate hardening change, not permission to weaken this plan's no-workflow-change boundary.

The orchestrator uses the repository's existing manual `shared-supabase-migrations.yml` dispatch procedure. Immediately before **each run that the route actually requires**, marker-bound Step 8 preparation first refreshes readiness when needed. The orchestrator then re-runs the read-only `select-preview-route.mjs` against fresh repository-variable, ledger and live state and requires the stored head, bundle, route, route context, allowlist and claim/recovery identity fields to match exactly; for both merged rehearsal and historical rebind this includes proving `commit_sha` is still the current `main` tip. Selector mismatch returns `UNVERIFIABLE` with **no ref write**; the operator must return to `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch <issue>`, then perform a second read-only selector check before manual dispatch. `mode` advances only under the existing route procedure. A successful ordinary/merged dry-run is reusable only by apply for that exact ready ID. A successor ready ID starts with no dry-run evidence and must perform its own dry-run before apply. Create terminal `dispatched` only after the route's completing apply or apply-only historical-recovery run has exact successful evidence. A ready item with any existing terminal outcome is never dispatched again. Dispatch remains deliberately manual and serialized. “Automatic resume” means automatic dependency detection, durable readiness and live-task wake-up—not automatic workflow dispatch. If no orchestrator is live, `--queue-audit` derives/reports readiness only and mutates nothing; the next sole-orchestrator with a matching live marker recomputes and creates/readbacks the ready ref once.

The separate ordinary/merged dry-run remains required by the standing merge protocol; the apply run's internal fresh dry-run is an additional immediate-write gate, not a substitute. This preserves the owner's existing two-stage evidence while the new identity rules make stale evidence unusable.

Do not create a new ready ref on every observed `main` commit. Step 8 creates the initial ref when an edge becomes satisfied, after scanning for an existing unresolved ready record for that issue. Thereafter ordinary reconciliation/audit reports a stale derived route without mutation; only marker-bound `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch <issue>` may refresh it immediately before dispatch. Under the existing short mutex it snapshots live identity and creates/readbacks that current successor even when zero existing unresolved refs match—including crash followed by another tip move—then terminalizes every unresolved ref whose readable payload is proven unequal to the snapshot. Deterministic identity means two distinct refs cannot both validly equal live identity; that condition is malformed/corrupt state, not ordinary ambiguity. Successful preparation exits with exactly one unresolved live successor.

Unreadable or identity-inconsistent refs fail closed. Step 8 writes the immutable `preview_ready` event **before** its ready ref; event schema v2 adds `ready_id` plus the full identity tuple to the closed known-field allowlist while retaining a v1 compatibility reader. A crash after the event but before the ref is an idempotent create/readback retry, and every later repair uses that positive durable binding rather than retention-bound absence of a workflow run/artifact.

Marker-bound `--repair-preview-ready <ready-id> --issue <n>` is deliberately narrow. It re-derives current live identity and requires a readable v2 event binding the named ID, issue and complete old tuple. If the named ID differs from the current live digest, the event proves exactly why it is stale; repair creates/readbacks a `superseded` outcome under the mutex and invokes successor-first preparation. If the named ID **equals** the current live digest but its ref payload is unreadable, repair writes no outcome and requires an explicit owner decision—cancelling, rewriting, deleting or inventing a nonce would brick or disguise the only legal current identity. Missing/ambiguous binding also returns `UNVERIFIABLE` for owner decision. Historical refs are never deleted or rewritten. Growth is bounded by real preparation/repair attempts rather than repository commit rate; no new counter, pause state or per-issue index is introduced.

Preserve `.github/workflows/shared-supabase-migrations.yml`, its workflow-level concurrency expression, required check names, permissions, dispatch inputs and all production-promotion mechanics unchanged in Step 5. The procedure's only Step 5 edit is the truthful historical-preview dry-run warning. A future automatic dispatcher is a separate design requiring its own security review and is outside this plan.

**Dependencies:** Steps 3–4.
**Verification gate:** Step 5 tests are read-only. Transcript fixtures reproduce #1720 waiting behind #1713, #1720 historical-route selection and #1646 dependency closure. Selector tests prove the ref-safe `ready-id` changes with issue, head, bundle, route or route-required `commit_sha`; every invocation is read-only; wait creates no Actions/check/lock/apply artifact; route manifests include every ordinary/recovery preview input, explicitly reject `source_pr`, `preview_run_id`, `preview_artifact_digest` and every other production/policy-only field, prove ordinary/merged dry-run is nonterminal, forbid historical dry-run, and identify terminal ready IDs as non-dispatchable. Runtime-ledger fixtures inject `readRepoVariable` and `fetchAppliedVersions`, prove the live ref is re-read before each required run, allow literal import only for equality comparison, forbid any `PROJECT_REFS.preview` query fallback, fail on disagreement with the drift literal, and exit 2 for missing capability/credentials, invalid/unset/production-equal identity, variable/transport failure or malformed rows. Compatibility tests retain the drift module's named exports and required-CI behavior; discovery tests require the new helper in the global invalidator inventory. The Phase A dependency-free `scripts/test_production_migration_guard.py` assertions protect existing workflow invariants without a branch-wide diff assertion or PyYAML; Step 5 extends it for the historical-dry-run warning and Phase C drift tests pin that warning plus the mandatory immediate selector/fresh-ledger recheck in read-only operator instructions. All event writers, ready-ref creation, wake, lifecycle, preparation, supersession, terminal-outcome contention, repair, duplicate recovery and failure-injection tests belong to Step 8.

### Step 6 — replace the global reviewer-assignment critical section

Refactor `assignNextReviewer()`, `replaceFailedReviewer()`, `reviewerExecutionPreflight()` and liveness/recovery helpers in `scripts/manage-migration-author-lanes.mjs`. Factor a read-only `reviewerExecutionContextCheck(reviewer, executionContext)` from the doctor-only portion of preflight; it needs no assignment/head and runs for each candidate outside `MUTEX_REF` before reservation. Full preflight still runs after assignment.

- preserve the existing two-tier roster: active reviewers are considered first; the owner-authorized Codex overflow candidate is considered only when every active execution key is unavailable. A shared `approvedExecutionCandidates()` policy supplies both the doctor-only check and full preflight. Full preflight accepts overflow only when the immutable assignment records `overflow: true` and proves all active keys were unavailable; arbitrary non-active names remain refused;
- exclude retired/paused providers and durable issue-specific prohibitions before selection; local wrapper/doctor failure never silently shrinks the roster;
- add a third, process-local eligibility result. Only a doctor run performed by the current assigning process for its exact execution context, naming the exact approved check `execution-context-denied`, may skip that reviewer for this one selection attempt. Do not persist a standing model/caller prohibition, provider failure or TTL record. A later process whose doctor does not report the check, including a Full Access main task, can select the reviewer. Unknown output cannot skip; every other doctor failure remains post-assignment on the existing local-dependency path;
- define a canonical execution key from the actual provider/wrapper serialization identity, not the display/model name. Reserve `refs/db-reviewer-reservations/<execution-key>` with `createRef()`/`acquireRef()` create-if-absent semantics and store the selected reviewer identity in its payload. Two aliases sharing one wrapper/provider can never execute concurrently;
- advance the round-robin cursor inside a short `MUTEX_REF` critical section, or replace the cursor with append-only assignment refs read through `listRefs()`; never call force `updateRef()` as though it were compare-and-swap;
- persist issue/PR/bundle ID/head metadata;
- release the allocation mutex before remote execution;
- allow other free reviewers to be assigned concurrently;
- if every eligible execution key is reserved, allocate a ref-safe zero-padded monotonic sequence under the short owned mutex and create immutable `refs/db-reviewer-waits/<sequence>-<generation>-<issue>` metadata with issue/PR/bundle/head and eligibility set, then return typed `review-wait`; ordering uses primary sequence then generation, never wall clock, and never falls back to a busy reviewer;
- a waker first snapshots and revalidates the live PR head, canonical bundle and eligibility. On drift, under the owned mutex it creates/readbacks the next generation for that snapshot **before** terminally marking the old generation `superseded`. Recovery re-reads live state: if neither unresolved generation is current (including a second head move), it creates another generation under the same primary sequence for the newest snapshot before terminalizing every stale generation; if live state moves during readback it retries/fails `UNVERIFIABLE`. It exits only with exactly one unresolved current generation. For a current wait, the waker atomically creates `refs/db-reviewer-wait-claims/<wait-id>` before allocation. Release and reconciliation contend on that claim, so one wins. Outcomes are append-only; completed generations are excluded. A dead claimant requires liveness/fenced proof;
- recover only a specific reviewer reservation after proving no verdict/artifact and dead/interrupted owner state;
- release a reservation normally when its verdict lands, PR closes/merges, or assigned head moves, preserving today's self-healing derived-busy semantics. If the releasing process dies after one of those terminal facts, reconciliation may release from that positive immutable proof. Dead-owner/no-verdict recovery is the separate stricter path; a landed verdict must never make a reservation unrecoverable;
- never replace a substantive `REVISE` or reduce coverage.

Keep exact-head metadata during rollout, but make bundle ID the review-content identity. `reviewerExecutionPreflight()` remains after durable assignment for general wrapper/provider/local checks. A local doctor failure follows the existing local-dependency path unless the current process's doctor-only context check reports exact `execution-context-denied` for that selection attempt. Only durable roster pause/retirement and issue-specific policy persist across attempts. Add reviewer reservation/wait/recovery lock kinds to the central and duplicated recovery allowlists.

During shadow/dual-run, legacy derived busy state remains authoritative. An unreadable reservation namespace never diverts to paid overflow, never assumes free, and never becomes ordinary `review-wait`; it records `UNVERIFIABLE`/shadow mismatch and preserves the legacy assignment decision without enabling new allocator behavior. After activation, unreadable reservation truth fails closed with no assignment. Activation requires the shadow corpus to prove readable parity.

**Dependencies:** Step 3 bundle identity. Can be implemented in parallel with Step 5 after schema freeze.
**Verification gate:** concurrency tests prove distinct execution keys reserve concurrently; aliases sharing a wrapper/provider serialize; interruption holds no `MUTEX_REF`; active reviewers precede overflow and arbitrary inactive names fail. Verdict/PR-close/head-move releases normally and remains recoverable after a dead releaser; no-verdict recovery stays stricter. All-busy creates a ref-safe monotonic wait; two wakers yield one claim/assignment/outcome; terminal waits never wake again; failure injection before/after successor creation and old-generation terminalization always leaves exactly one current queue generation with original priority. Unreadable reservation truth preserves legacy shadow behavior and fails closed after activation without paid overflow.

Before the Phase C fresh-session cut, update `docs/agents/section-4-anti-collision-rules.md`, `AGENTS.md`, the `shared-db-orchestrator` skill and drift fixtures for read-only preview dependency decisions, the mandatory immediate read-only selector/fresh-ledger recheck, the historical-dry-run refusal/warning, unchanged manual dispatch, execution-key reservation, overflow and durable review-wait lifecycle. Do not document Step 8's mutating preparation or repair commands before that implementation lands.

**Fresh-session cut:** prove doc/skill drift green, update STATUS and start Phase D.

### Phase D — early qualification, durable readiness and measurement

### Step 7 — add route/verifier qualification before author completion

Create `scripts/orchestrator-flow/qualify-change.mjs` and tests. It is a thin Node CLI over existing Node coordination exports and narrow Python diagnostic entrypoints added to `production_business_risk_gate.py` and `production_catalog_verification.py`; Python remains sole owner of risk/catalog rules and canonical hashing. Malformed, missing or nonzero Python output passes through as `UNVERIFIABLE` exit 2. The command is read-only and runs at claim/resume, before reviewer assignment and before preview. It reports:

- PR file-shape compatibility with claim split/supersession/recovery commands;
- migration dependency closure and ordered promotion batch;
- expected preview route from Step 5;
- historical evidence compatibility (original apply versus reconciliation versus supersession);
- whether catalog verification derives at least one valid target or a hash-bound Phase 1 sidecar/contract covers the change;
- global invalidators and required review coverage;
- `QUALIFIED`, `WAITING`, `BLOCKED`, or `UNVERIFIABLE` with one next action.

Do not duplicate enforcing logic. Add diagnostic modes/pure functions to the owning language modules. Static tests reject copied risk/catalog rule tables or regexes in Node. Qualification cannot approve a later stage; every enforcing workflow reruns its own live checks. If Phase 1 sidecars are not implemented, “no derived target and no existing sidecar/contract” is a safe early refusal rather than a reason to defer qualification.

**Dependencies:** Steps 3–5 and Phase 1 sidecar contract where available.
**Verification gate:** fixtures detect #1684 removed-test supersession incompatibility, #1720 constraint-only missing verifier contract, #1646 two-version dependency and divergent supersession evidence before review/preview; known supported shapes qualify; Python failure/malformed output remains exit 2; static tests prove Node does not reimplement risk/catalog decisions.

### Step 8 — automate blocker transitions, refill and resume

Create `scripts/orchestrator-flow/reconcile.mjs` and tests; expose `--reconcile-flow`, `--prepare-preview-dispatch <issue>` and the fenced `--repair-preview-ready <ready-id> --issue <n>` from `scripts/manage-migration-author-lanes.mjs`. The manager validates arguments, resolves the matching sole-orchestrator marker to the calling task, and delegates mutex/marker-bound preparation/repair to the same reconciler implementation. Modify `scripts/manage-migration-author-lanes.test.mjs`, `scripts/db-coordination-events.mjs`, `scripts/db-coordination-events.test.mjs`, `.github/workflows/migration-author-lease.yml`, both new lock-kind recovery allowlists/tests, `config/orchestrator-global-invalidators-v1.json` and its discovery/completeness fixture in this same Step 8 PR for schema-v2 events, new CLI, test backstop, mutex recovery and imported implementation. It performs guarded coordination-ref/GitHub state transitions only, never database writes:

1. verify marker and current claims;
2. classify each issue state;
3. relinquish active-author lease for a durable external blocker while preserving claim;
4. fill free active-author capacity with highest-priority non-overlapping ready work;
5. detect blocker resolution or dependency-edge satisfaction;
6. for a newly satisfied preview edge, re-run `select-preview-route.mjs`, create/readback the initial immutable ready ref/event, and optionally wake the live sole-orchestrator task with that exact record; later main movement is report-only during ordinary reconciliation and refreshes only through this Step 8 command's explicit `--prepare-preview-dispatch` mode; never dispatch a workflow automatically;
7. reacquire an author lease when capacity exists and emit a resumable work item;
8. release reviewer reservations from verdict/PR-close/head-move proof and scan unresolved waits; revalidate current head/bundle/eligibility, atomically claim the oldest compatible sequence and invoke the guarded allocator when an execution key is free;
9. refuse if owned-mutex readback proves state changed before mutation.

There is no repository coordination heartbeat, and none is added to `EXCLUSIVE_REFS`. The live sole-orchestrator session invokes reconciliation explicitly after queue/stage events and from `--queue-audit`; an optional Codex task wake-up may prompt that session but is not coordination authority. With no live matching marker, audit derives/reports readiness but mutates nothing; the next live matching orchestrator recomputes and creates the ready ref. Overlapping reconciliations use the existing short mutex/create-if-absent pattern, not invented compare-and-swap. Reconciliation may always report `REFILL REQUIRED NOW`; it may create/resume a structural author only through the same guarded `--claim`/resume dispatch path after resolving the live sole-orchestrator marker to the calling task.

The same reconcile implementation adds exported `preview_wait`/`preview_ready` writers to `scripts/db-coordination-events.mjs::EVENT_TYPES`, never `STAGE_PAIRS`, and closes readiness lifecycle gaps. Event schema v2/known fields carry `ready_id` and the complete tuple; v1 remains readable. Exact issue/PR close, merge, cancellation or dispatch evidence creates the sole terminal outcome. Ordinary reconcile reports stale head/bundle/route/context without mutation; only marker-bound `--prepare-preview-dispatch` performs successor-first supersession. Corrupt-ref repair follows Step 5's fenced contract. Malformed or ambiguous state without positive durable proof remains `UNVERIFIABLE`. Historical ready refs are never deleted.

In the same Step 8 PR, update `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, the synchronized `shared-db-orchestrator` skill and drift fixtures with one exact operator interface: resolve the live marker → run `node scripts/manage-migration-author-lanes.mjs --prepare-preview-dispatch <issue>` → run the read-only selector/fresh-ledger check → manually dispatch the stored matching instruction. Document `node scripts/manage-migration-author-lanes.mjs --repair-preview-ready <ready-id> --issue <n>` only for stale wrong-digest records and the live-digest owner-decision boundary. This is the first phase that documents the mutating commands. Because these standing-instruction and reconciler changes are global bundle invalidators, every in-flight bundle verdict is stale at the Step 8 cut and must be recomputed; no review is reused across this PR.

**Dependencies:** Steps 2, 5 and 7.
**Verification gate:** a fixture with #1658/#1645/#1684/#1720/#1646 all protected but externally blocked reports zero active authors and five protected claims, fills up to the proven active cap, then resumes correctly without losing claims. A newly satisfied preview edge writes/readbacks its v2 event before creating one exact ready ref and no workflow run; no marker or a marker resolving elsewhere reports readiness without mutation; crash after event-before-ref retries idempotently. Later main movement reports stale without creating another ref; explicit preparation owns refresh. Preparation tests cover manager CLI argument/delegation, mutex contention, marker absence/mismatch, create/readback-successor before stale terminalization, crash after every event/ref/outcome write, a second tip move with zero current unresolved matches, convergence of multiple provably stale refs, malformed duplicate refusal and exactly one unresolved current successor on success. Both merged and historical current-main movement produce a new ID with no inherited dry-run. Two terminal writers contend on one outcome ref; ordinary/merged apply or apply-only historical recovery alone records `dispatched`, while dry-run never does. Repair tests prove v2 full-tuple event binding; stale wrong-digest supersession plus successor creation; refusal with no write for a corrupt live-digest ref, v1/missing/ambiguous binding or unavailable evidence; explicit owner routing; and no historical deletion/rewrite. Absence of retention-bound runs/artifacts is never proof. Event tests import `EVENT_TYPES`/schema, verify v1 compatibility/v2 known fields and behaviorally audit multiple `preview_wait`/`preview_ready` histories without double acquisition; `STAGE_PAIRS` stays private. Closing/cancelling/merging the issue each produce the single correct terminal outcome. Overlapping reconciliation and reviewer claim/outcome recovery are idempotent under two wakers, terminal reservations, stale heads and dead claimants; preview/merge/production refs never gain heartbeat writers. Skill/AGENTS drift tests require the exact manager command sequence and repair boundary. Required CI, mutex-recovery and invalidator discovery tests prove every Step 8 file is backstopped; the Step 8 cut invalidates and recomputes existing bundles.

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
3. **Reviewer/cap:** completed 2026-08-28. Albert approved Codex GPT-5.6 Sol (`ai-codex-review`) and DeepSeek (`ai-deepseek-agent`) after both wrappers qualified. The active rotation now has six providers, per-reviewer reservations plus `review-wait` remain enabled, and active-author capacity is eight. Historical assignment refs remain readable.
4. **Preview scheduler:** convert known dependency failures to durable waits and emit exact ready work for manual dispatch; keep one preview lock.
5. **Evidence reuse:** enable `INTEGRATION_REFRESH_ONLY` review preservation last, after shadow corpus proves no false reuse.

Audit the Phase A CI wiring: every created orchestrator-flow test must appear through the guarded array and named-file backstop in the required `Migration author lease` job, remain fully offline/injected, and have passed there since its creation. Do not repair missing coverage only at landing—each earlier phase PR must already have been blocked. Issue #731 is the regression case. Re-run the Phase A `scripts/test_production_migration_guard.py` assertions for unchanged dispatch concurrency, permissions, inputs, required contexts, deliberately-first steps and manual promotion-procedure semantics.

Run focused tests after each step and the repository-required suites on a frozen tree. Update `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, the orchestrator skill/drift fixtures and issue #1738. Obtain one independent reviewer for repository-maintenance implementation. Open a PR, wait for all code checks, merge, verify merge SHA and post-merge checks, then observe at least one shadow/live transition fixture or non-production rehearsal without database mutation.

**Dependencies:** all prior steps.
**Verification gate:** main contains the merged implementation; required checks and skill drift are green; shadow report has no unsafe mismatches; no migration file changed; no database write occurred; rollback flags can restore old scheduling without deleting claims/evidence.

## 10. Required tests

- Existing `scripts/manage-migration-author-lanes.test.mjs` remains green after intentionally updating its hard-coded cap, exact-roster, roster-length and boundary-arithmetic assertions. Production assertions remain cap five/current roster until Albert's Step 10 gate passes; parameterized fixtures exercise the proposed cap-eight/approved-roster configuration beforehand. Collision, lease, reviewer replacement, stale recovery, supersession and exclusive-stage coverage remains intact.
- `scripts/check-migration-pr-lease.test.mjs` proves relinquished, expired and non-active-capacity leases remain merge-blocking until guarded resume renews/reactivates them.
- `scripts/coordination-scenarios.test.mjs` remains green and gains end-to-end blocked/relinquish/resume and wait-context scenarios.
- `scripts/orchestrator-flow/baseline-schema.test.mjs`: source provenance, state separation, timestamp order, unknown duration handling.
- `scripts/orchestrator-flow/evidence-bundle.test.mjs`: canonicalization, every invalidator, dirty/missing file refusal, identical bundle across unrelated base movement.
- `scripts/orchestrator-flow/classify-invalidation.test.mjs`: all five classes and the real #1713/`ddcdd5da` byte-identical fixture.
- `scripts/orchestrator-flow/preview-graph.test.mjs` and `select-preview-route.test.mjs`: dependency cycles, #1713/#1720 order, historical route, evidence-type mismatch, #1646 closure, no-run wait, deterministic ready decision/digest, stale-head refusal and proof that every selector path is read-only.
- `scripts/orchestrator-flow/read-preview-ledger.test.mjs`: injected repository-variable and Management API adapters, exact ref validation/cross-check, no literal query fallback, compatibility exports and every exit-2 capability/transport/malformed case.
- `scripts/test_production_migration_guard.py` preserves `.github/workflows/shared-supabase-migrations.yml` concurrency, permissions, required contexts, dispatch inputs, literal production needs and deliberately-first safety steps; it pins the procedure's historical-dry-run no-evidence warning; Step 5 introduces no mutation to the shared migrations workflow.
- Reviewer concurrency tests: parallel assignment by canonical execution key, aliases sharing a provider/wrapper serialize, no global stall, exact recovery, prohibited-provider preflight, and context doctor outside `MUTEX_REF`.
- Reviewer supply tests: all six active reviewers busy creates a durable ordered `review-wait`, never a duplicate; release and independent reconciliation each wake exactly one compatible waiter through the allocator; a dead releaser strands nothing; cap 8 does not imply eight simultaneous reviewers.
- `scripts/orchestrator-flow/qualify-change.test.mjs`: #1684/#1720/#1646 late-failure fixtures and supported controls.
- `scripts/orchestrator-flow/reconcile.test.mjs` plus manager/event/recovery tests: idempotence, exact CLI validation/delegation, overlapping reconciliation under the owned mutex, blocked-claim capacity, priority/collision refill, exact resume, event-first ready emission/retry, marker-bound preparation, report-only ordinary drift, successor-first failure injection, zero-match second-tip recovery, stale-duplicate convergence/malformed refusal, wrong-digest repair/live-digest owner routing, terminal outcome contention and mode-specific `dispatched`, v1/v2 event compatibility and non-exclusive behavioral audit, lock-kind recovery, terminal reservation release, and interrupted reviewer-generation rollover.
- Phase 1 ledger/report tests extended for new timing classes and minimum sample rules.
- Workflow contract tests prove preview/merge/production refs remain exclusive and a `WAITING` dependency cannot reach apply.
- `scripts/test_production_business_risk_gate.py` remains green and every new `config/` file is pinned or precisely exempted through its existing filesystem-completeness rule; keep it in the existing `scripts/test_*.py` glob.
- Static tests prove no code path releases an object claim on author-lease relinquishment/expiry.
- Static tests prove existing `expires_at`/`lease.active` never decides active capacity and no exclusive-stage heartbeat/renewal writer exists.
- Recovery tests cover every new lock kind in both the manager allowlist and `scripts/lib/exclusive-lease.test.mjs`.
- `scripts/db-coordination-events.test.mjs` covers every new transition and rejects a parallel event store/double acquisition.
- `scripts/orchestrator-flow/coordination-audit.test.mjs` exercises `--json`, malformed histories and double-acquisition refusal; manager CLI tests prove `--flow-audit --json` delegates to the same implementation and output contract.
- Both claim parsers accept the versioned capacity fence and reject malformed state.
- Failure injection after every ref write proves retry/recovery is idempotent.
- Run the repository workflow's exact existing coordination baseline: `node --test scripts/check-migration-pr-lease.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/historical-migration-restorations.test.mjs scripts/lib/work-dependencies.test.mjs scripts/agent-work-contract.test.mjs scripts/db-coordination-events.test.mjs scripts/coordination-scenarios.test.mjs scripts/lib/exclusive-lease.test.mjs scripts/apply-lane-advisory-lock.test.mjs`.
- Required CI runs that baseline plus `scripts/orchestrator-flow/*.test.mjs`; run the identical combined command locally, plus repository-required Python suites and `node scripts/check-skill-drift.mjs --require-skills`.

## 11. Constraints, standing rules and gotchas

- This plan is repository maintenance; never dispatch it through the structural orchestrator.
- Work in isolated worktrees from current `origin/main`; stage only owned files.
- Claims protect objects until explicit completion/reversion. Lease expiry is never claim expiry.
- Existing `db-author-lease` clock expiry is not capacity relinquishment. Capacity changes only through a typed, durable transition.
- Preview, merge and production writes remain single-holder.
- Never add a heartbeat or renewal writer to `EXCLUSIVE_REFS`.
- Never treat force `updateRef()` as compare-and-swap.
- Bundle reuse never covers changed content, uncertain classification or unavailable evidence.
- Bundle reuse requires successful full CI on the current integration head and immutable evidence naming both bundle ID and integration SHA.
- A preview dependency wait is coordination state that creates no GitHub run/check/apply artifact; required pull-request jobs and the existing manual preview/production dispatch route remain unchanged.
- A reviewer verdict covers one bundle ID and declared coverage. `REVISE` is never replaced.
- Qualification is advisory/refusal-only; enforcement reruns live at each irreversible gate.
- Existing refs and artifacts require a compatibility/migration period; never rewrite historical refs in place.
- GitHub rate limits matter: reconciliation must batch reads and avoid polling every claim continuously.
- Windows reviewer wrappers and current doctor semantics must remain supported.
- Do not log secrets, connection strings, licensed rows or transcript contents beyond scrubbed operational events.
- Do not treat overall issue age as throughput evidence.
- A change to `AGENTS.md` must be mirrored through the repository's skill-drift mechanism.
- Once scripts/workflows change, the PR is not documentation-only.
- Plan and handoff Markdown are never runtime policy inputs; executable policy comes only from versioned code/config plus synchronized standing instructions.
- Every AGENTS.md/skill semantic change and its drift fixture lands in the same phase; do not cross a fresh-session cut with contradictory synced instructions.

## 12. Access and environment

- Repository: authenticated `git`/`gh`, `u2giants/shared-db`, base `main`.
- Runtime: repository Node and Python on Windows; use project-supported commands.
- Coordination truth: GitHub refs under `refs/db-*`, GitHub issues/PRs/runs, live branch-protection state, and existing workflow artifacts.
- Skill synchronization: authenticated `popcre/ai-devops` checkout resolved through `AI_DEVOPS_DIR`/the repository's drift tooling; no skill edit is attempted without that checkout, and Phase A stops before its cut if synchronization cannot be proven.
- Database: implementation needs no database write. Step 5 runtime reads authenticated repository variable `PREVIEW_PROJECT_REF`, validates `^[a-z]{20}$` and inequality to `PROJECT_REFS.production`, then uses the existing `SUPABASE_ACCESS_TOKEN` protected environment/1Password `vibe_coding` procedure for one read-only preview-ledger SELECT through the factored Management API helper; never expose the token/rows, and treat unavailable evidence as exit 2. No production ledger read is needed for route selection.
- Private transcript source: local Codex archive for task `01a0461f-d1bf-7e02-8c84-ee8783f965b0`; do not commit the raw JSONL.
- Planning branch/worktree: `codex/issue-1738-phase2-consensus` / `C:\repos\shared-db-worktrees\issue-1738-phase2-consensus`.

---

# Part 4 — Landing it

## 13. Definition of done, risks and open questions

### Definition of done

- [ ] Protected claims and active-author leases are distinct, audited states.
- [ ] Blocked claims never consume author capacity and never lose collision protection.
- [ ] Active capacity reaches eight only after two distinct provider/wrapper identities are qualified, Albert approves the exact recommendation, at least six active rotation reviewers are proven, and all-busy review safely waits.
- [ ] Reviews and downstream proof bind to canonical evidence bundle IDs.
- [ ] Unrelated `main` movement triggers integration refresh only; changed/uncertain inputs fail closed.
- [ ] Preview dependencies are explicit and ordered; a matching sole orchestrator persists one exact durable ready instruction and may receive an optional task wake, without a red apply attempt or automatic dispatch.
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
| Two reviewers assigned same serialized provider/wrapper | per-execution-key create-if-absent reservation | disable new allocator; retain old assignment refs |
| Review wait is double-woken or binds stale content | monotonic wait sequence, atomic claim/outcome refs, live head/bundle revalidation | disable durable waits; return to explicit manual assignment |
| Preview wait false-greens or displaces a real dispatch | selector is read-only; readiness wake creates no Actions run/check and preserves existing manual serialized dispatch | disable automatic wake; retain manual queue audit and dispatch |
| Main churn accumulates ready refs or invalidates a dry-run | initial edge materialization plus marker-bound pre-dispatch refresh only; successor-first recovery may briefly hold multiple unresolved refs but exits with exactly one current; new ID needs new dry-run | disable ready persistence; derive route manually from live state |
| Corrupt readiness ref wedges a live issue | fenced marker-bound repair uses positive v2 event identity only: a wrong-digest ref may be superseded and followed by successor preparation; a corrupt live-digest ref receives no write and requires owner decision; run or artifact absence is never proof | disable ready persistence and preserve corrupt evidence for owner-led recovery |
| Automatic resume races changed state | marker proof plus owned mutex/readback and live requalification | disable reconcile mutation; keep read-only audit |
| Qualification disagrees with enforcing workflow | enforcing workflow always wins; mismatch recorded as blocker | disable qualification gating, retain diagnostics |
| Legacy refs/artifacts become unreadable | versioned schema and compatibility readers | revert new writers; keep compatibility reader |
| More capacity overwhelms reviewer/preview stages | waiting states remain outside author cap; measure queues | lower active-author lease cap without changing claims |

### Open questions

The owner gate is resolved. On 2026-08-28 Albert approved Codex GPT-5.6 Sol and DeepSeek as the two additional active rotation providers after wrapper qualification; the roster is six and the cap is eight. `glm-5.2` remains retired historical evidence and does not count separately from active `glm-5.3`. The first shadow report may reveal a class that cannot safely be proven disjoint; classify it `UNVERIFIABLE` and retain full exact-head replay rather than asking for a safety exception. Any proposal to parallelize database writes or reduce reviewer coverage is outside this plan and requires a separate owner decision.

## Self-audit

1. **Can a brand-new session execute this without chat context? Yes.** §§1–4 define the business goal, repository, trigger, complete transcript evidence and scope. §§5–8 give code anchors, root cause, rejected approaches and locked decisions. §9 names ordered files/functions, dependencies, phase cuts and verification gates.
2. **Does the plan carry every relevant background, nuance and reasoning? Yes.** §3 preserves every material timeline event and requested-queue finding used in the diagnosis; §6 explains why each design follows; §7 prevents repeating unsafe or ineffective alternatives.
3. **Is the goal sufficient for judgment calls? Yes.** §1 makes five safe productive workstreams, immutable proof and unchanged deployment serialization controlling. §§8, 11 and 13 require ambiguity to fail closed and provide rollback boundaries.

All 13 required sections are present. Tests are behavior-specific, access names locations without secrets, every step has a verification gate, and the definition of done includes commit, push, CI, merge and post-merge proof.
