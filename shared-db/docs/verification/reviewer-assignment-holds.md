# Reviewer-assignment holds — mutator inventory and causal baseline

**Issue:** [#4414](https://github.com/popcre/shared-db/issues/4414)  
**Plan:** `plan_reviewer_assignment_hold_reduction.md` (PR #4419)  
**Baseline commit:** `7da9a3ff6dee9a366e05f33471ed1c61aaea7af4` (`origin/main`)  
**Inventory created:** October 18, 2026 EDT by MiMo chat `ses_ffe5eaf988841ffeyWs7yCi5D5` on `edge-dev`  
**Task class:** `reviewer-safety` (repo-maintenance; no database shape change)

This file is the step-1 acceptance artifact: every shared mutator and caller of the author-acquisition mutex has a row, with phase boundaries, request/Git-child estimates from existing derivation docs, and named evidence gaps. Unknown stays unknown. A commit timestamp alone is not acquisition duration.

## Resource under study

| Resource | Identity | Meaning |
|---|---|---|
| Author-acquisition mutex | `refs/db-coordination/author-acquisition` (`MUTEX_REF`) | Short exclusive right to change shared coordination records |
| Recovery guard | `refs/db-coordination/author-acquisition-recovery-active` | Blocks acquisition while recovery runs |
| Review lease | `refs/db-review-active/*` and parallel slot namespaces | Durable assignment for one issue/PR/head/slot; **not** the mutex |
| Stage lease | preview / merge / production exclusive refs | Different resource; out of scope for hold reduction |

Mutex wait, owned duration, review-lease age, provider time, and stage-lease time are separate clocks. Only owned duration of `MUTEX_REF` is the hold this plan reduces.

## Phase model (step 2 trace schema)

| Phase | Meaning | Holds mutex? |
|---|---|---|
| `prepare` | Static parse, immutable packet/tool resolution, wrapper health/eligibility discovery, quota readiness, pre-mutex peer/busy snapshots | No |
| `acquisition_wait` | Time from acquire request to create-only ownership (or refusal) | Waiting |
| `fresh_validation` | Re-prove issue/PR/head/route/verdict/failure/revocation/peer/rotation/exclusions under ownership | Yes |
| `ref_commit_readback` | Atomic multi-ref CAS (mutex, lease, cursor, assignment) + exact readback | Yes |
| `release` | Owner-qualified delete + release proof ladder | Yes (release itself) |
| `post_release_execution` | Provider preflight/invocation, reporting | No |
| `cleanup` | Residual release/recovery after a primary result | Yes (only if still owned) |

Trace fields (schema version 1): `schema`, `operation`, `sourceTuple`, `invocation`, `phase`/`durationMs` rows, `releaseState` (`not_acquired` \| `proved_released` \| `unknown` \| `successor_seen`), `foreignMutexOwner` (observed SHA/ref only), `startedAt`/`endedAt` wall times (public reports use EDT/EST), `totalHeldMs` (owned phases only — **not** `acquisition_wait`), `totalWaitMs` (queue to acquire).

After release or a recovery-required decision, `withReviewRequestBudget` writes one stderr line `review-phase-trace …` via `formatPhaseTraceSummary`. Sink failures are swallowed; lost telemetry never invents release.

## Shared mutator inventory

Request ceilings are **derived**, not widened (issue #2075). `REVIEW_OPERATION_REQUEST_LIMIT = 25`, `REVIEW_MUTEX_SECTION_RESERVE = 15` (see constant commentary and `docs/verification/reviewer-assignment-api-budget-2026-08-28.md`).

| # | Operation | Call site (baseline `7da9a3ff6`) | Mutex acquire / release | Pre-mutex phase | In-mutex phase | Request/Git-child estimate | Time bounds today | Resource held | Evidence gap |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `assignNextReviewerOperation` (fresh draw / retry / cursor adopt) | `scripts/manage-migration-author-lanes.mjs` ~2205–2500; entry `assignNextReviewer` ~2520 | `acquireReviewMutex` ~2173; `finalizeReviewMutexPreservingResult` ~2437 | Peer slots, busy snapshot, allowlist, owner-commit message, wire capacity reserve | Fresh eligibility/peer/exclusion/terminal evidence; atomic 4-ref CAS; readback | Slot1 ≈ 7 pre + 15 reserve; slot2 ≈ 10 pre + 15 reserve (derived) | Finite child timeout in transport; **no measured hold distribution** | `MUTEX_REF` + review lease/cursor/assignment refs | Acquisition→release wall time not recorded; unknown p95 |
| 2 | `replaceFailedReviewer` paths (idempotent retry + new replacement) | same file ~3179 (retry) and ~3461 (new); public wrapper ~3530 | `acquireReviewMutex` ~3179 / ~3461; finalize preserving result | Replacement parse, peer policy, busy preflight, failure evidence | Fresh states, admission, atomic replacement batch | Reserve 11–12 in-lock + preflight | Same finite transport bounds | `MUTEX_REF` + replacement/lease/cursor refs | Hold time unmeasured; sibling of #1 |
| 3 | `releaseFailedReviewer` | same file ~3071 | `acquireReviewMutex` ~3071; finalize | Failure message/owner commit prepared outside | Fresh states; release CAS | Reserve 8 | Finite transport | `MUTEX_REF` + failure/lease refs | Hold time unmeasured |
| 4 | `excludeReviewerForPr` / return path | same file ~1619 | `acquireReviewMutex` ~1619 | Exclusion parse, doctor proof digest (where applicable) | Concurrent exclusion check; atomic exclusion+return | Reserve 15 | Finite transport | `MUTEX_REF` + exclusion/return refs | Hold time unmeasured |
| 5 | `reinstateReviewerExclusion` | same file ~1415 | `acquireReviewMutex` ~1415 | Doctor PASS evidence outside | Concurrent reinstatement check | Reserve 15 | Finite transport | `MUTEX_REF` + reinstatement ref | Hold time unmeasured |
| 6 | `reclaimSilentReviewer` | same file ~1957 | `acquireReviewMutex` ~1957 | Activity fingerprint + probe outside | Fresh fingerprint re-proof; atomic release | `REVIEW_SILENT_RECLAIM_*` limits | Finite transport | `MUTEX_REF` + silence-release refs | Hold time unmeasured |
| 7 | `reapAbandonedReviewLeases` | same file ~2008 | `acquireReviewMutex` ~2008 | Candidate scan outside | Fresh confirm under lock | Reserve 20 | Finite transport | `MUTEX_REF` + lease reap refs | Hold time unmeasured |
| 8 | `archiveOldReviewVerdicts` (apply) | same file ~2038 | `acquireReviewMutex` ~2038 | Scan outside | Fresh reopen/lease/verdict re-proof | Unspecified archive reserve | Finite transport | `MUTEX_REF` + archive refs | Hold time unmeasured |
| 9 | `ensureReviewerQueueTurn` (compatibility queue; default `enableReviewerQueue:false`) | same file ~2123 | `acquireReviewMutex` ~2123 | Ticket commit outside | Queue ticket create/renew | Queue assignment limit when enabled | Finite transport | `MUTEX_REF` + queue ticket | Not live in production default; still an inventory row |
| 10 | `activateReviewCutover` | same file ~3607 | `acquireReviewMutex` ~3607 | Candidate listing/filter outside | Replacement pages under lock (comment: measured in-lock spend 9; reserve 11) | Reserve 11 | Finite transport | `MUTEX_REF` + cutover refs | Hold time unmeasured |
| 11 | `probeSilentReviewer` | same file ~1924 (budget wrapper) | No mutex (read-only) | Activity fingerprint | — | Capacity limit | Read-only | none | N/A |
| 12 | `reviewerCapacityReport` / `reviewerStartWatchLeases` | same file ~2071–2073 | No mutex (read-only) | Snapshot reads | — | Capacity limit | Read-only | none | N/A |

### Non-reviewer shared-mutex writers (inventory/causal comparison only — not refactor targets)

| # | Operation | Call site | Acquire / release | Notes |
|---|---|---|---|---|
| N1 | Expired-claim blocker rebind | `scripts/rebind-expired-claim-blocker.mjs` ~92–119 | `acquireMutex` (holds-and-refs) | Uses same `MUTEX_REF`; blocks/competes with reviewer assignment |
| N2 | Preview maintenance lock | `scripts/manage-preview-maintenance-lock.mjs` ~33–49 | `acquireMutex` / `releaseOwnedRef` | Stage lease work under the shared mutex |
| N3 | Expired merged-claim adoption | `scripts/lib/lanes/expired-merged-claim-adoption.mjs` ~90–118 | `acquireMutex` / `releaseOwnedRef` | Claim recovery under the shared mutex |

These three explain cross-domain waits. Reviewer-only elapsed time cannot prove who caused another session's wait; traces must preserve observed foreign owner SHA/ref and keep unknown attribution unknown.

### Callers (not mutators)

| Caller | Path | Role |
|---|---|---|
| `assignNextReviewer` → `run-governed-review.mjs` | Provider execution **after** assignment and proved release | Must stay outside ownership |
| `scripts/lib/lanes/review-assignment.mjs` | Thin wrapper over `assignNextReviewer` | No extra lock |
| `scripts/db-flow/reviewer-start-watch.mjs` | Invokes reclaim / probes via lane CLI | Indirect; child may hit occupied mutex |
| Workflows / Actions | `.github/workflows/recover-author-mutex.yml`, PR guards | Recovery is serialized and owner-qualified |

## Causal boundaries (from plan §6, verified in source)

1. Assignment operations share the author-acquisition mutex with claim/preview coordination. Slow critical-section I/O can block unrelated coordination even though provider execution is outside it. **Possible mechanism; not measured attribution of production delays.**
2. Rotation, assignment, active lease, peer independence, terminal failures/verdicts, and recovery can race. Removing the lock or isolating only the draw leaves other mutators unsynchronized.
3. Fresh issue/PR/head/revocation/peer checks belong at the write boundary. A pre-lock snapshot is preparatory only.
4. Individual finite child timeouts do not establish a short aggregate hold: sequential calls may each consume full timeout. Git children and cleanup count.
5. While locked, `runGitHubCommand` already forces one attempt. Admission uses a separate budget context (`withoutReviewRequestBudget`); do not conflate ceilings.
6. Cleanup is not blind ref deletion. Timed-out write may have committed; a successor may own the mutex. Keep exact result/identity; never redraw solely because a command returned an error.

## Already-fixed historical defect (do not rediscover as new)

Issue #3791: unbounded GitHub child held the author mutex for hours. Current transport has finite child timeouts (`scripts/lib/github-transport.mjs`). Offline fault fixtures must reproduce delayed I/O safely; do not reproduce that outage live.

## What step 2 must measure (not yet present at baseline)

- Monotonic elapsed: prepare, acquisition wait, fresh validation, ref commit/readback, release, post-release execution.
- Request class/count per phase and Git-child count (gh + git).
- Release state truthfulness: `unknown` is never reported as zero duration.
- No extra remote reads for telemetry; no secrets in traces.
- Flush only after release or recovery-required decision; never block the owned section on stderr/pipes.

## Evidence gaps (named, not guessed)

| Gap | Why it matters | How it closes |
|---|---|---|
| No acquisition→release distribution | Cannot claim the mutex causes today's delays | Step 2 traces + step 7 natural runs |
| No per-phase request attribution | Cannot set honest phase budgets | Step 2 counters on existing wire budget |
| Foreign-owner attribution | Cross-domain waits may be claim/preview, not reviewer | Trace `foreignMutexOwner` + step 1 cross-domain rows |
| Aggregate remaining-deadline | Per-child timeout ≠ short hold | Step 4 budget table from measured inventory |
| Sample size | Small samples cannot establish statistical speedup | Step 7 honest median/p95; HOLD if inconclusive |

## Gate (step 1)

- [x] Every shared mutator and caller has an inventory row above (reviewer + non-reviewer).
- [x] Baseline commit named; symbols re-resolvable (`acquireReviewMutex`, `finalizeReviewMutex`, `MUTEX_REF`).
- [x] Phase tracer lands with this change (`scripts/lib/lanes/phase-trace.mjs`); acquisition→release re-derivation is completed by step 7 natural runs.
- [x] No resource acquired by measurement (inventory is read-only).

## Implementation progress (this branch)

| Plan step | Status | Artifact |
|---|---|---|
| 1 Inventory + causal baseline | **done** | this file |
| 2 Secret-safe phase timing | **done** | `scripts/lib/lanes/phase-trace.mjs` + tests; wired into `assignNextReviewerOperation`, `acquireReviewMutex`, `finalizeReviewMutex` |
| 3 Preparation outside ownership | **partial** | `assertPaidReviewCapacity` (immutable paid-start + Git provenance) moved **before** mutex in assignment; request ceiling unchanged (25/15). Fresh mutable checks stay under the lock. Sibling ops (exclude/replace/reap) still hold classification work — next after measured traces. |
| 4 Bounded critical I/O deadlines | open | needs step-2 samples to set remaining-deadline table |
| 5 Hostile/interleaving matrix | **partial** | `phase-trace.test.mjs`, `assignment-hold-phases.test.mjs`; full matrix remains |
| 6 Reviewed integration | open | this PR is the landing vehicle |
| 7 Normal-run live proof | open | requires merged tooling + natural assignment |

## Related owners (do not steal their obligations)

| Issue | Owner scope | Overlap with this work |
|---|---|---|
| #4297 | Review service-failure recovery and independent slot policy | May share `manage-migration-author-lanes.mjs`; serialize integrator edits |
| #3617 | Preview-ready GitHub request cost / queue throughput | Budget accounting adjacent; this plan must not widen ceilings |
| #3779 | Merge-preparation outside serial mutation lane | Different stage resource; no handoff of that outcome |
| #4414 | This assignment-hold outcome | Owns steps 1–7 and live proof checklist |

## Step 4 — bounded owned-section I/O (October 19, 2026 EDT)

- One **operation deadline** per owned mutex section on a monotonic clock: `REVIEW_MUTEX_SECTION_DEADLINE_MS` (5 min) from acquisition; release/cleanup gets its own reserved `REVIEW_MUTEX_CLEANUP_ALLOWANCE_MS` (2 min) starting when cleanup begins. Provisional values; step 7 measurements may tighten them. Request ceilings are unchanged (25 / 15).
- The deadline is module state started by `acquireReviewMutex`, so every reviewer-mutex holder gets it — including `archiveOldReviewVerdicts`, which runs without a request budget, and the bulk `reapAbandonedReviewLeases`.
- Bounded while owned: every gh child (`runGitHubCommand`); git children in `gitRemoteRefs` (remote proof and ls-remote), `readGitCommits`, `atomicReviewRefs` (hydrate and push), `paidReviewGitReader`, the paid-content comparison fetch and contract reads, `mergeTouchesMigrations`, `prepareNonclosingEvidenceGit`, and the nonclosing-binding git runner. Each uses `min(per-call bound, remaining)` (calls that were unbounded outside ownership stay unbounded there). Zero or unreadable remaining time refuses **before** launch with a named deadline error that is never rewritten into a generic failure. Ref reads under ownership are one attempt.
- Release, failed-acquire cleanup and the ambiguous-batch readback run on the reserved cleanup allowance, never on the exhausted section.
- The deadline is checked before a multi-ref batch launches, never mid-batch; it is not a lease TTL and no timer deletes a ref.
- A failed or timed-out atomic assignment batch is reconciled by one readback of **every** intended ref (`reconcileAtomicReviewBatch`): all desired → assignment preserved (no redraw); all expected → retryable no-write refusal; partial/unreadable → RECOVERY REQUIRED.
- Lock-free quota waiting stays outside ownership even when `GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS` is inherited (one attempt, no probe).
- Tests: `scripts/lib/lanes/section-deadline.test.mjs` (fake clock, fake io).

## Step 5 — hostile matrix traceability (October 19, 2026 EDT)

Every plan §10 proof name maps to a named test. HM, SD, PT, AH, LM and (since step 6) MR run in the `pr-guards.yml` lane-manager unit-test step; before step 6, MR ran in no workflow. `HM` = `scripts/lib/lanes/assignment-hostile-matrix.test.mjs`, `SD` = `scripts/lib/lanes/section-deadline.test.mjs`, `PT` = `scripts/lib/lanes/phase-trace.test.mjs`, `AH` = `scripts/lib/lanes/assignment-hold-phases.test.mjs`, `LM` = `scripts/manage-migration-author-lanes.test.mjs`, `MR` = `scripts/mutex-release-on-refusal.test.mjs`. Shared fake io: `scripts/test-fixtures/review-assignment-io.mjs` (real CAS semantics).

| §10 proof | Test |
|---|---|
| `fresh_head_change_refuses_draw` | HM same name |
| `peer_policy_change_under_lock_refuses` | HM same name (peer slot taken by the same reviewer after prepare); policy widening: LM `#4297 slot 2 first anchors task policy…`, `#3291 … refuses widening` |
| `author_engine_remains_excluded` | LM `the orchestrator engine is never eligible to review its own work`; `a GLM-engine (ZCode) orchestrator never draws the glm reviewers (#3232)` |
| `fresh_terminal_evidence_prevents_assignment_resurrection` | LM `assignment retry refuses a terminal release completed after preflight but before mutex acquisition`; `assignment retry cannot recreate a terminally released replacement reviewer lease` |
| `same_provider_parallel_reviews_allowed` | LM `#2694 exact-head assignments let one reviewer hold concurrent independent reviews…`; `#3291 one allowlisted reviewer still holds more than eight concurrent exact-head reviews` |
| `concurrent_draws_preserve_one_tuple_and_cursor` | HM same name; LM `concurrent orchestrator cannot advance reviewer cursor without the mutex` |
| `slow_preparation_does_not_hold_author_mutex` | AH same name |
| `provider_execution_starts_after_mutex_release` | HM same name |
| `slow_report_holds_no_mutex` | HM same name |
| `owned_section_never_sleeps_for_quota_or_retries` | SD same name |
| `owned_git_and_gh_children_have_remaining_deadlines` | SD same name; SD `production gitRemoteRefs refuses before launch…` |
| `ambiguous_commit_recovers_same_assignment_without_redraw` | SD same name |
| `partial_or_unreadable_transaction_is_recovery_required` | SD same name; SD `timed-out push with an exhausted section still reconciles…` |
| `cleanup_never_deletes_successor_mutex` | MR `a successor-owned mutex is never deleted by the git fallback`; LM `GitHub coordination delete never replays after response loss and preserves a new owner` |
| `completed_assignment_survives_cleanup_failure` | HM same name |
| `all_contexts_accounted_and_cleanup_reserve_preserved` | LM `wire budget always preserves enough requests to release an acquired mutex`; `#2802 the structural-admission gate is not charged…`; AH `derived request ceilings are unchanged` |
| `unknown_release_is_not_zero_duration` | PT same name |
| `trace_is_monotonic_and_secret_safe` | HM same name; PT `phase trace records monotonic durations and release state` |
| `wait_trace_preserves_observed_owner_and_unknown_attribution` | HM same name |
| `trace_output_never_blocks_owned_section` | PT same name |
| `trace_failure_does_not_repeat_or_hide_completed_assignment` | HM same name |
| `legacy_review_callers_remain_compatible` | LM `legacy short-head protocol cannot store a second lease for one reviewer`; `cursor-only legacy assignment recreates its missing permanent and active refs`; `#3291 legacy slotless returned slot-two replacement…` |
| `phase_trace_has_no_extra_github_reads` | PT same name |
| `trace_preserves_stdout_contract` | PT same name |

Also closed in step 5: the Muse Low residual from PR #4501 — the paid-content comparison's local digest helpers (`verifiedEvidencePaths`, `prContentDigest`) now run through the owned-section bound.

## Step 7 — live proof on merged tooling (October 19, 2026 EDT)

Source: naturally authorized reviewer draws this work needed for its own PRs, run from Claude chat sessions on `edge-dev` with `node scripts/manage-migration-author-lanes.mjs --assign-reviewer`; no review was created to fill metrics. Each row is the verbatim `review-phase-trace` stderr line's fields. "Merged tooling" = step 4 (#4501, `ab9f1224d`) already on `main`.

| PR / head | Code | Result | held_ms | prepare | wait | fresh_validation | commit+readback | release | Durable records |
|---|---|---|---|---|---|---|---|---|---|
| #4501 `e029512b` | step-4 branch | refused after lock (provenance), `proved_released` | 6756 | 11769 | 785 | 4563 | — | 2193 | none (refusal) |
| #4501 `cac21cb2` (attempt 1) | step-4 branch | `not_acquired`, `foreign_mutex=32b5a3fbdfad` | 0 | 18906 | 766 | — | — | — | none |
| #4501 `cac21cb2` (attempt 2) | step-4 branch | assigned Muse, `proved_released` | 11373 | 21187 | 1278 | 5405 | 4090 | 1878 | `refs/db-review-verdicts/4414-4501-cac21cb2…` |
| #4504 `ea111cd0` (attempt 1) | merged | `not_acquired` (owner held by other work) | 0 | 12596 | 862 | — | — | — | none |
| #4504 `ea111cd0` (attempt 2) | merged | assigned DeepSeek, `proved_released` | 12595 | 12525 | 813 | 5430 | 4151 | 3014 | `refs/db-review-assignments/4414-4504-ea111cd0…`, verdict `4a3feb4e` |
| #4505 `a51d0e51` | merged | assigned StepFun, `proved_released` | 12312 | 13110 | 969 | 5366 | 4647 | 2298 | `refs/db-review-assignments/4414-4505-a51d0e51…`, verdict `ead4e329` |

- **Merged-tooling successful draws: n = 2**, held 12312 and 12595 ms (median 12454 ms; p95 is not meaningful at n = 2). All successful draws in this session (n = 4 incl. branch code: 11373, 11809, 12312, 12595) held 11.4–12.6 s, versus a 5-minute section deadline. No statistical speedup is claimed; there is no comparable pre-change held-time measurement (step 1 recorded that gap).
- **No preparation, provider or reporting occupancy:** `prepare` (12.5–21.2 s) ran unowned in every row; each provider review (StepFun, Muse, DeepSeek, StepFun) started only after the draw returned with `release=proved_released`, through `run-governed-review.mjs`.
- **Overlapping independent work proceeded:** three contended attempts observed other owners of `refs/db-coordination/author-acquisition` (`6cf2167bc37e`, `32b5a3fbdfad`, and one unnamed on #4504); each refused without writing and the identical re-run succeeded once that work released. Attribution of those owners stays unknown.
- **Release proved in every acquired row**; no `release=unknown`, no recovery used, no ambiguous-write reconciliation occurred live (that path is covered by fixtures only, per plan).
- Traces contain issue/PR/short head/durations/observed owner SHA only; no tokens or child output.
