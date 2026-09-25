# Workflow-refactor measurement coverage — 2026-09-20

Status: **INSUFFICIENT_SAMPLE**. Instrumentation is available; programme functional
acceptance, a fourteen-day post-change window and twenty comparable completed
outcomes per class/period are not claimed. Root integration owns subsequent
measurement and numbered acceptance; safe application delivery does not wait on
this reporting threshold.

## Observed source coverage

- Historical baseline: six outcomes, August 28 02:08–03:56 UTC (108 minutes),
  one explicitly production-verified. Source:
  [baseline JSON](orchestrator-throughput-phase-2-baseline-20260828.json).
- Existing legacy throughput report on those unmodified records:
  `INSUFFICIENT_SAMPLE`, n=0; all six wait samples zero. Missing normalized fields
  are not proof of missing work.
- Existing blocker ledger: one estimated, unresolved incident; the guard reporter
  returns zero observed resolved diagnosis, wall, active and recurrence samples.
- Bounded GitHub merged-PR query for September 6–20: 375 PRs, below the 1,000
  ceiling. Earliest merge `2026-09-06T00:38:19Z`, latest
  `2026-09-20T19:23:25Z`. This is historical merge-event coverage, not 375 completed
  live outcomes, not comparable risk classes and not ready-to-live timestamps.
- Fourteen days of post-refactor observation do not yet exist. Unique confirmed
  review defects and safety-regression rates are unknown. No latency improvement
  or causal percentage is supported.

Reproduce the public metadata census with `gh pr list --repo popcre/shared-db
--state merged --search 'merged:2026-09-06..2026-09-20' --limit 1000 --json
number,mergedAt,createdAt`; retain dated results because live counts can change.
No raw issue bodies, private rows or transcripts are included.

## Strict reporting contract

`buildWorkflowRefactorReport` is a separate reporting-only API in the existing
throughput module; `buildThroughputReport` and its consumers remain compatible.
Use explicit before/after windows with observed UTC start/end and evidence
references. Windows must not overlap, end in the future or lack fourteen days of
observations. Boundaries are start-inclusive/end-exclusive.

Each observation names one unique business outcome and comparable change class,
`estimate:false`, `completed:true`, and evidence-backed `stages.ready_at` and
`stages.live_verified_at`. Duplicate outcomes are excluded in full, including
cross-period replay. A full ready-to-live interval must fall within one window.
Timestamps must be valid UTC calendar values. Supplied optional stages need
references and obey causal stage ordering; unavailable stages remain unknown.
`updatedAt` is never substituted for readiness, live verification or closure.
Evidence references locate sources; this pure collector does not authenticate
sources or prove comparability. Collection and independent acceptance must do that.

Median/p90 latency is published only with twenty accepted outcomes in that class
and period. Improvement remains null until both periods have fourteen-day windows,
twenty outcomes and explicit safety observations for every outcome. Every wait
metric independently requires twenty values before publishing a median/p90.
Missing measurements remain null. Observed safety reports survive exclusion from
latency calculations, prohibit improvement claims and produce REGRESSION; the raw
report count is not a deduplicated defect rate. A lower median with non-increasing
p90 is reported only as measured latency improvement, never causal attribution.

This bounded change instruments ready-to-live latency, coverage, existing wait
metrics and safety reports. It does not claim automated collection of evidence-only
review loops, unrelated-version waits, closure lag, required/advisory refusals,
unique review defects or functional live traces. Those remain root-owned Step 14
acceptance inputs and must not be inferred from these aggregates.

## Verification

The required negative test was run first and failed because the strict collector
was absent. Tests now cover insufficient samples, absent and bot-only timestamps,
duplicate outcomes, impossible/reversed stages, missing evidence, short/overlapping/
future windows, class mixing, unknown safety, malformed wait metrics, and excluded
safety reports. Existing legacy tests remain unchanged.

[Issue 3365](https://github.com/popcre/shared-db/issues/3365) is non-orchestrator
repository maintenance. This report does not close the programme tracker.
