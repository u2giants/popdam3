# Workflow refactor implementation baseline

Captured 2026-09-20 19:32–19:34 UTC against current GitHub state and main
`20641bc6bbcd`. Implementation owner: Codex chat
`01a0c04c-509a-7721-a6f1-4fc61f39a07e`, 916-ALIEN. This is non-orchestrator
repository maintenance; no database mutation is authorized by this report.

## Reproducible census

The bounded read used `gh issue list --state open --limit 1000 --json
number,createdAt,labels,body`, open PR metadata, branch protection and repository
rulesets, and the twelve latest guarded-migration-merge runs. Classifications are
declared scope, not independently re-admitted business outcomes. Age uses creation
time and the capture time; bot updates are not productive activity. Private raw
issue bodies are not published here.

- 106 open issues: 59 repository maintenance, 29 structural, 6 curated Master
  Data, 2 documentation, 1 coordination, 1 source data, 1 security settings,
  and 7 without a declared classification. 97 carried `db-work`.
- Nested age buckets: 56 older than seven days, 28 older than fourteen days,
  and 2 older than thirty days. These are not undelivered-outcome counts.
- 36 open PRs. Latest twelve guarded merges: 3 successes and 9 failures.
  This is a diagnostic sample, not a measured historical failure rate.
- Main protection: 13 required contexts, strict freshness false, administrator
  enforcement true; zero repository rulesets returned. No settings changed.

Required contexts: Promotion contract tests (offline); Cross-PR object collision;
Tools offline tests; SQL migration guards; Domain ownership; Intake pointer guard;
Handoff contract; Migration author lease; Orchestrator marker guard; Cancelled work
guard; Agent work contract; Queue-sensitive checks (aggregate); Migration guarded
merge authorization.

## Ownership and acceptance map

Every numbered issue below is non-orchestrator work unless explicitly called
structural. The program tracker is an index, never an application prerequisite.

| Step | Verified baseline and owner | Acceptance still required |
|---|---|---|
| 0 | This session owns baseline and sequential integration | Persist this report and keep scope/ownership current |
| 1 | PR [3323](https://github.com/popcre/shared-db/pull/3323), merged `843bc60de498edadbb3276b2fffa30a5898aab05`; issue 2708 closed. Followup 3324 remains with Claude `2e3c24d5` | Audit all resolver boundaries and two independent real delivery traces; do not duplicate the active reader repair |
| 2 | PR [3330](https://github.com/popcre/shared-db/pull/3330), merged `473ba697d5d449721de113fc0cd82acc6a052eb2`; issue 2832 closed | Verify 310 historical dispositions remain equivalent and independent-source coverage meets the plan |
| 3 | Typed maintenance PR 3344, scope writer PR 3326 and lifecycle PR 3317 absorbed by PR 3354 | Stage contracts, crash recovery and real accepted maintenance completion beyond narrower fixes |
| 4 | Same-repo loop PR 3315 absorbed by PR 3354; self-service 3199 delivered | Proven-stage dependency and durable resume implementation and real acceptance |
| 5 | Instructions overlap PRs 3354, 3352, 3320 and 3279 | Consolidate after accepting their actual behavior; canonical skills and policy tests |
| 6 | No dedicated active PR discovered; this session owns remaining scope | Effective required-check authority, shadow comparison and refusal tests |
| 7 | Incident repairs PRs 3277 and 3293 already merged | Entire pre-promotion qualification contract; serialize shared probe-reader edits |
| 8 | PR [3279](https://github.com/popcre/shared-db/pull/3279), Claude `2e3c24d5`, last activity 17:37:56Z | Existing transfer plan steps 7–11, including activation and genuine delivery evidence |
| 9–10 | This session integrates after queue acceptance | Narrow preparation locks and separate targets with race/refusal proof |
| 11 | Existing conservative isolated route remains available | Baseline closure, probe binding, idempotent recovery and eligible genuine delivery |
| 12 | PR 3338 absorbed by PR 3354 | Full packet gap assessment and governed review trace |
| 13 | This session owns evidence-backed decision | Retain two absent adequate evidence; no review-count activation inferred |
| 14 | This session owns measurement and final accounting | Fourteen-day before/after windows and twenty comparable completions per aggregate, plus individual functional traces |

PR [3354](https://github.com/popcre/shared-db/pull/3354) is actively recovered by
Codex chat `01a0bf00-fa7b-73d1-b447-fc4c89c50b96`. At 19:31:56Z its head was
`a4f268d9e63b763010bfb9fc0d2144d461e5a1a7`. Its latest recorded state was:
“Fresh governed review remains mandatory; no approval is claimed.” It owns the
lane manager, lifecycle, review runner, related tests and instructions. This
session does not edit those active surfaces concurrently.

Other active overlaps: issue 2596 / PR 2607 (Codex, September 17 activity),
issue 3273 / PR 3274 (Kimi, 17:51Z), issue 3002 / PR 3352 (Claude, 17:55Z).
Resolve current state before incorporating them. PR 3320 carries an alternative
plan at the same filename; Albert specifically selected PR 3318 as the source.
Its unrelated conflict-dirty-check documentation must not be lost by replacement.

## Corrections to the earlier audit

The earlier audit's maintenance examples 3245, 3235, 3229 and 3222 are now closed
(2026-09-20 15:18Z). Their old open state is not a current defect. Closed issue
3027's acceptance followups 3241 and 3242 are also closed, with production hold
[run 35177165797](https://github.com/popcre/shared-db/actions/runs/35177165797) and
unattended reroute [PR 3286](https://github.com/popcre/shared-db/pull/3286).

## Measurement limits and safety

Creation, readiness, review, rehearsal, merge, application, verification and
completion timestamps require per-outcome evidence. Missing stages are unknown;
this census does not impute them from issue closure or update times. No latency
improvement or causal percentage is claimed. Existing historical audit evidence
is preserved. New checks must preserve object locks, unique migration versions,
one writer per target, guarded merging and production promotion, independent
review, target identity and live acceptance. No concurrency count is introduced.
