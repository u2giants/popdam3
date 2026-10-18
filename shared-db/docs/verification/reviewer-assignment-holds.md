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
