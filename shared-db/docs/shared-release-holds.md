# Shared release hold reduction proposal

The [implementation plan](../plan_shared_release_hold_reduction.md) covers later
acquisition, earlier release, proven-independent progress and safely fenced recovery.
Read its STATUS table first. This document activates no exception, lease change
or production behavior.

Progress on the merge stage is recorded on the issue and in
[the merge-stage baseline](verification/shared-release-holds/2026-10-20-guarded-merge-baseline.md):
plan step 3 (merge preparation outside the serial merge lane) is implemented in
`guarded-migration-merge.yml` as a per-request `prepare` job and a short protected
`merge` job; its live proof is linked from the issue once the merged workflow has run.
Steps 2 and 4-10 remain open.

The existing operating contract remains the authority:
[workflow route map](agents/current-workflow.md),
[merge protocol](agents/merge-protocol.md), and
[production promotion](production-promotion-procedure.md).
The plan is the focused continuation of existing outcome
[#3779](https://github.com/popcre/shared-db/issues/3779), coordinated with other
owners identified in its scope. Its
[handoff](../HANDOFF.d/2026-10-16T1317Z-hetz-codex-shared-release-holds.md)
carries continuation context. Do not infer implementation from publication.

## Reviewer-assignment bookkeeping

The separate [reviewer-assignment hold plan](../plan_reviewer_assignment_hold_reduction.md)
([#4414](https://github.com/popcre/shared-db/issues/4414)) measures and shortens
reviewer bookkeeping under the shared coordination mutex. Read STATUS first.
It preserves unlimited provider concurrency and does not change database release
leases or activate a new mutex. All seven steps are done; #4414 closed 2026-10-19 and its handoffs are retired.
