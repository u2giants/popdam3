# Workflow review-tier decision — 2026-09-28T20:55Z

Decision: **RETAIN TWO independent reviewers.** Review count was **not** shown
dispable. This is the Step 13 accepted disposition for [#3306](https://github.com/popcre/shared-db/issues/3306)
(non-orchestrator work). It **does not activate** any reviewer-count change.

Predecessor record: [workflow-review-tier-decision-20260920.md](workflow-review-tier-decision-20260920.md)
(merged with PR 3368). That record left final acceptance to integration after
sufficient measurement. This dated record is that acceptance.

## Measured evidence (insufficient samples preserved)

| Measure | Observed | Source |
|---|---|---|
| Unique confirmed defects found only by reviewer two | **not measured** (corpus absent) | throughput baseline / blocker ledger — no normalized unique-defect fields |
| Duplicate / false-positive findings | **not measured** | same |
| Review / replacement waiting | partial; replacement waits observed in live refs (e.g. silent-worker and out-of-credit replacements) | live `db-coordination` failure/replacement refs |
| Re-review with unchanged implementation | observed as content-equivalence carry-forward (#2758), not as a defect-yield sample | `scripts/lib/pr-content-equivalence.mjs` |
| Brief quality | live rounds this session produced complete packets (Step 12 #3720) | #3366 DeepSeek, #3369 Muse |
| Min samples per throughput report | **20 comparable completed outcomes per aggregate**, 14-day window | Step 14 contract / throughput helpers (PR 3368) |

**Result of the collector on existing records:** `INSUFFICIENT_SAMPLE` (n=0
normalized comparable completions per risk class). That is a **valid recorded
outcome**, not “zero defects.” A zero-defect or tiny sample **never** claims
improvement.

Risk-class separation: no class has the 20-sample floor. Unknown, mixed,
destructive, permission, RLS, shared-function and unsupported changes stay under
**two-review** policy.

## Negatives proven (fixtures bound to merged PR 3368 / #3361 path)

- Small / zero-defect / missing-timestamp / bot-update-as-progress samples do **not**
  yield a one-review tier (`INSUFFICIENT_SAMPLE` preserved).
- A recorded **refusal outranks** an approval at the same head; a durably returned
  slot that was never re-drawn **refuses** the merge gate — refusals cannot be
  reclassified away (`scripts/check-exact-head-approval.test.mjs`).
- **Two durable approvals from the same reviewer never satisfy independent slots.**

## Disposition

| Item | Result |
|---|---|
| Adopted one-review tier | **REJECTED** — not justified by measurement |
| Retain two independent reviewers | **ADOPTED** |
| Remaining delay work | brief quality, evidence reuse, replacement behavior (not fewer reviewers) |
| Reviewer-count activation | **none** — separate policy adoption required |
| Destructive / mixed / unknown / permission / RLS / shared-function | remain **two** |

Owner of this acceptance: session **workflow-refactor PR queue, close #3306**
(MiMo, edge-dev), proof issue [#3763](https://github.com/popcre/shared-db/issues/3763).

Posted by MiMo chat unknown on edge-dev
