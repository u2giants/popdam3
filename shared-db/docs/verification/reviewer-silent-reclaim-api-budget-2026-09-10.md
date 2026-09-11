# Reviewer silent-reclaim API-budget derivation — 2026-09-10

Issue: #2697. Scope: repository coordination only; no database, migration, preview, production, or application data change. Companion to `reviewer-assignment-api-budget-2026-08-28.md`, which derives the ceiling for assignment and replacement; this document derives the ceiling for `--reclaim-silent-reviewer`, which that document never measured.

## Successor re-verification against 2026-09-11 main

The historical trace below remains the original measurement. After #2694 introduced assignment-specific lease keys, the refreshed fixture measured 30 requests for a current key and 32 for a legacy key under parallel mode. Resolving the selected lease then reread the same ref. The successor removes that redundant read using a snapshot local to each resolution call; the in-mutex resolution still makes its own fresh snapshot.

The re-measured current-key path is **28 requests (14 before mutex, 14 held)**. The legacy compatibility path is **30 requests (15 before mutex, 15 held)**: it proves the v2 key absent before selecting the legacy key, once outside and once inside the mutex. The operation ceiling is therefore **30**, with **15** reserved at mutex entry. The shared assignment/replacement ceiling stays **25**. No safety proof or compatibility path is removed.

Regression tests exercise all three routes: serial legacy, parallel current key, and parallel legacy fallback. The longest route asserts exact total 30, exact pre-mutex 15, and exact held section 15; the other two assert exact total 28. A deliberately added pre-mutex request refuses without taking the mutex or deleting the lease. Full refreshed manager suite: **509 pass, 0 fail, 0 skipped**.

## What was wrong

`--reclaim-silent-reviewer` was added after `REVIEW_OPERATION_REQUEST_LIMIT` had been derived, and it was charged against that shared ceiling without anyone counting what it spends. Every attempt therefore ended at the same deterministic place:

```
REFUSED: GitHub command failed: reviewer operation request budget exhausted before request 24
```

The consequence is structural, not cosmetic: a dead reviewer lease classified `silence-reclaimable` could never be released, so the pool only ever lost capacity. The refusal also came from `consumeReviewWireRequest` *after* the operation had started spending, because the reclaim path — unlike assignment and replacement — had no `requireReviewWireCapacity` entry gate before `acquireReviewMutex`.

**The ceiling was not widened to make the refusal go away.** The path was measured, the one redundancy the measurement exposed was removed, and the enforced number is the measured total for this operation only. `REVIEW_OPERATION_REQUEST_LIMIT` remains **25** and is untouched.

## Method

Identical to the derivation in the 2026-08-28 document: a wire-attempt fixture in `scripts/manage-migration-author-lanes.test.mjs` wraps every `io` method that reaches GitHub so each call runs one counted `runGitHubCommand` attempt through the real budget, and labels it. Nothing was measured against live GitHub and no shared coordination state was mutated: the fixture builds an in-memory lease, probes it, and reclaims it. `io.getRateLimit` is charged 2 requests, as production charges for the REST and GraphQL quota reads.

Initial current-key test: `silent reviewer reclaim costs exactly its derived 28-request budget (issue #2697)`. The refreshed compatibility test derives and enforces 30 for the longer legacy fallback route.

## Initial current-key measurement — 28 requests

Before the redundancy was removed the same current-key fixture measured **29**. Verbatim label trace of the measured current-key 28:

| # | Request | Section |
|---|---|---|
| 1-2 | `getRateLimit` (REST + GraphQL quota) | pre-mutex |
| 3 | `readRef refs/db-review-assignments/<issue>-<pr>-<head>` | pre-mutex |
| 4 | `getCommit` (durable assignment record) | pre-mutex |
| 5 | `listRefs refs/db-review-replacements/<issue>-<pr>-<head>` | pre-mutex |
| 6 | `readRef refs/db-review-active/<reviewer>` | pre-mutex |
| 7 | `readRef refs/db-review-silence/...` (the immutable prior probe) | pre-mutex |
| 8 | `readRef refs/db-review-silences/...` (prior release absence) | pre-mutex |
| 9 | `getCommit` (probe evidence commit) | pre-mutex |
| 10 | `getPr` | pre-mutex |
| 11 | `readLeaseActivity` | pre-mutex |
| 12 | `listRefs refs/db-review-verdict` (durable verdict listing, #2075) | pre-mutex |
| 13 | `makeOwnerCommit` (silence-release evidence) | pre-mutex |
| 14 | `makeOwnerCommit` (mutex owner) | pre-mutex |
| 15 | `createRef refs/db-coordination/author-acquisition` (mutex) | mutex section |
| 16 | `readReviewRefs` (acquisition readback) | mutex section |
| 17 | `readRef` mutex (`requireOwnedRef`) | mutex section |
| 18 | `readRef` assignment ref (in-mutex lease re-resolution) | mutex section |
| 19 | `readRef` active lease ref (in-mutex lease re-resolution) | mutex section |
| 20 | `getPr` **fresh** (uncached, via the activity fingerprint) | mutex section |
| 21 | `readLeaseActivity` (fresh fingerprint) | mutex section |
| 22 | `listRefs refs/db-review-verdict` **uncached** re-listing | mutex section |
| 23 | `readReviewRefs` (locked ownership check) | mutex section |
| 24 | `atomicReviewRefs` (mutex + release ref + lease delete) | mutex section |
| 25 | `readReviewRefs` (post-transition readback) | mutex section |
| 26 | `readRef` mutex (`requireOwnedRef`, cleanup) | mutex section |
| 27 | `atomicReviewMutexRelease` | mutex section |
| 28 | `readReviewRefs` (release proof) | mutex section |

**Current-key path: pre-mutex 14; mutex-held section 14; total 28.** The compatibility route adds one legacy-key proof on each side of the mutex, producing the controlling 15 + 15 = 30 ceiling documented above.

## The redundancy that was removed rather than paid for

The post-mutex recheck read the PR fresh **twice** for the same PR in the same statement: `io.__freshGetPr(request.pr)`, and then `activityFingerprintForLease(..., {freshPr:true})`, which reads it fresh again and records `prState` and `currentHead` in its own `facts`. Two uncached reads of one PR, microseconds apart, that could never disagree. The state and head check now uses the fingerprint's facts. That is 29 to 28. A regression assertion requires exactly one fresh `getPr` inside the mutex section, so the second read cannot come back.

## Why this path legitimately costs more than an assignment (23)

The reclaim deletes a live lease on the strength of *absence* — no verdict, no artifact, no activity. Its safety property is that everything it proved before taking the mutex is proved **again**, fresh, while holding it: the exact durable assignment, the exact active lease SHA, the PR state and head, the activity fingerprint against the immutable probe, and the durable verdict listing. That in-mutex re-proof is the whole guard against reclaiming a reviewer who woke up during mutex acquisition. It cannot be dropped, so it is derived and declared rather than trimmed.

## What is now enforced

```js
export const REVIEW_SILENT_RECLAIM_REQUEST_LIMIT = 30, REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE = 15
```

- The ceiling equals the measured total exactly — no undeclared headroom, asserted by the fixture.
- `reclaimSilentReviewer` runs under this budget by name; `REVIEW_OPERATION_REQUEST_LIMIT` (25) is unchanged and a regression assertion holds it at 25.
- `requireReviewWireCapacity(REVIEW_SILENT_RECLAIM_MUTEX_SECTION_RESERVE)` now gates mutex acquisition, so a reclaim that cannot complete its mutex-held section refuses **before** the mutex exists instead of dying inside it. Proved by a fixture that adds one pre-mutex request and asserts no mutex ref was ever created and the lease is untouched.
- The mutex-release reserve is unchanged: `cleanupReserve` is 2 when `atomicReviewMutexRelease` exists and 8 otherwise, and release runs in cleanup mode against the full ceiling.

## The refusal now names its own budget (ask 3 of #2697)

Old, and equally true of every operation:

```
reviewer operation request budget exhausted before request 24
```

New:

```
reviewer operation 'reclaim-silent-reviewer' exhausted its derived 30-request budget before request 31. This ceiling is DERIVED for this operation, not a global default: see the derivation cited beside its constant in scripts/manage-migration-author-lanes.mjs. Re-derive it from a written measurement rather than widening it (issue #2075)
```

It names the operation, its derived ceiling, how much (if any) is held back as the mutex-release reserve, and where the derivation lives. Asserted by `an exhausted reviewer budget names the operation and its derived ceiling (issue #2697)`.

## Tests

`node --test scripts/manage-migration-author-lanes.test.mjs`

Refreshed result: **509 passed, 0 failed, 0 skipped, 0 todo, 0 cancelled.**

Red-first proof. With the derived budget unwired from `reclaimSilentReviewer` (the pre-fix behaviour, the operation charged against the shared 25), all three new tests fail, verbatim:

```
Historical pre-refresh example (superseded by the measured 30/15 compatibility ceiling): `Error: reviewer operation cannot fit 14 remaining requests inside the 25-request budget; refused before mutex acquisition; calls=quota,quota,readRef:refs/db-review-assignments/...,commit,commit`
```

## Not done, deliberately

No live reclaim was run. No lane-manager mutation, workflow dispatch, migration apply, or production command was executed. The `glm-5.3` lease on PR #2607 is untouched by this change; reclaiming it is an operational step for whoever holds that work, now that the command can complete.
