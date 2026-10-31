# Workflow-refactor end-to-end acceptance — 2026-09-28T22:40Z

Tracker: [#3306](https://github.com/popcre/shared-db/issues/3306) (non-orchestrator work).
Proof issue: [#3770](https://github.com/popcre/shared-db/issues/3770).
Owner: session **workflow-refactor PR queue, close #3306** (MiMo, edge-dev).

This report measures delivery and safety from the Step 0 baseline onward. It
**separates measured findings from unmeasured claims**. It does **not** close
#3306 and does **not** activate any reviewer-count or production-route change.

## 1. Latency and time split (insufficient samples preserved)

| Aggregate | Window | Comparable samples | Result |
|---|---|---|---|
| Ready-to-live latency median / p90 by change class | 14-day | **n=0** normalized completions per class | **INSUFFICIENT_SAMPLE** |
| Preparation vs protected-lock time | 14-day | lock holds observed live (guarded merge ~2–3 min); preparation not separately metered in normalized corpus | **INSUFFICIENT_SAMPLE** for median/p90 |
| Preview waits due solely to unrelated versions | — | historical examples exist in plans; no normalized 14-day corpus | **UNPROVEN / insufficient** |
| Evidence-only refresh / review loops | — | observed qualitatively (content-equivalence carry-forward; re-review after head change) | qualitative only |
| Administrative closure lag | — | not metered | **INSUFFICIENT_SAMPLE** |
| Verified-but-open tasks | live | queue hygiene reports unique undelivered outcomes; exact count is a live reading, not a frozen number | live report only |
| Required vs advisory refusals | live | required-check preflight refuses failed/missing required; advisories shadow without veto (Step 6 #3712) | **measured behavior** |
| Unique confirmed review defects | 14-day | no normalized unique-defect corpus | **INSUFFICIENT_SAMPLE** |
| Safety regressions | session | none observed in Steps 3/6/7/12/13 proofs | **none observed** (not “zero risk”) |

Minimum-sample rule (PR 3368 helpers): **20 comparable completed samples per
aggregate**, 14-day before/after window where history exists. Those floors are
**not met**. Small or zero-defect samples **never** imply improvement.

## 2. Seven behaviors — real traces or explicit unproven

| Behavior | Status | Evidence |
|---|---|---|
| Task-evidence independence | **PROVEN live** | Step 1 proof #3631 (closed): two unrelated PRs landed after PR3445 without evidence collision |
| Per-source disposition independence | **PROVEN (partial live)** | Step 2 proof #3638 has owner; disposition catalogues migrate per source without a global digest (truth-audit green) |
| Maintenance completion | **PROVEN live** | Step 3 proof #3677: #3343/#3354 `--complete-work` record; structural lifecycle still refuses merge-as-completion |
| Dependency resume | **UNPROVEN** | Step 4 — PR3396 still draft/conflicting; dependent-resume live proof not run (owner #3388) |
| Qualified live proof | **PROVEN live** | Step 7 proof #3716: production probes #2863/#3191, one-row `passed=true` under `read_only: true` |
| Queue / lock exclusion | **PROVEN (partial)** | Guarded merge serializes; self-service boundary refuses out-of-scope PRs before the lane; merge-queue mode currently active |
| Eligible isolated delivery | **UNPROVEN** | Step 11 — PR3447 superseded by PR3590; isolated rehearsal adapters and delivery trace not proven (owner #3397) |

Required-check authority (Step 6 #3712) and governed-review packets (Step 12
#3720) are also proven live and feed the safety picture above.

## 3. Cold-start recovery, API failures, required-check integrity

- **Cold-start / crash resume (completion records):** proven in Step 3 — second
  `--complete-work` is immutable; unreadable readback refuses before close.
- **API failures:** governed transports fail closed (`github-transport` 404 is
  not transient; authority reads fail closed — Step 6 probe names missing permission).
- **Substantive required checks:** live authority read lists **16** required
  contexts; preflight refuses any missing/failed/wrong-producer result (Step 6).
  `required_status_checks.strict` remains **false** (owner ruling #1286).

## 4. Negatives (never imply improvement)

- `INSUFFICIENT_SAMPLE` is preserved where n < 20 or the window is short.
- Missing timestamps / bot `updatedAt` are not treated as progress (plan §3 rule).
- Duplicate outcomes / malformed stages refuse (completion immutability; stage events do not replace final records).
- Small/zero-defect samples do not justify one-review tier (Step 13 #3763: **retain two**).
- Unknown/mixed/destructive/permission/RLS/shared-function stay under two-review and conservative production classification.

## 5. Measured improvement vs unmeasured claims

**Measured (behavior, not throughput numbers):** evidence independence, maintenance
completion truth, required-check authority, live-probe shape, governed-review
packets, retain-two decision.

**Unmeasured / insufficient:** end-to-end latency distributions, lock vs
preparation split, unique second-reviewer defect yield, preview-wait attribution.
**No throughput improvement claim is made.**

## 6. Disposition

| Item | Result |
|---|---|
| Step 14 acceptance | **ACCEPTED as an honest insufficient-sample + proven-behavior report** |
| End-to-end latency claim | **NOT claimed** (INSUFFICIENT_SAMPLE) |
| Tracker #3306 | **remains open** — not closed from this report |
| Reviewer-count / production activation | **none** |

Posted by MiMo chat unknown on edge-dev
