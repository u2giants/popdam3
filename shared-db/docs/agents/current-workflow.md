# Current shared-db workflow

This is the current route map. Historical incident reports explain decisions;
they do not override the current implementation or Albert's later rulings.
The matrix below is checked by `scripts/check-current-workflow-policy.mjs`.
It documents existing authority; it does not activate a new release route.

## Policy matrix

| Policy | Current value | Authority |
|---|---|---|
| scope | structure-and-curated-master-data | AGENTS.md owner rulings 2026-08-13 and 2026-08-21 |
| ordinary-rows | application-owner | AGENTS.md section 0.0-B |
| authors | unlimited | Owner ruling 2026-09-16 |
| reviewer-concurrency | unlimited | Owner ruling 2026-09-16 |
| migration-reviews | 1 | scripts/check-exact-head-approval.mjs |
| governed-code-reviews | 1 | scripts/check-exact-head-approval.mjs |
| standalone-plans | documentation | scripts/lib/documents-only-change.mjs |
| agent-instructions | guarded | scripts/lib/documents-only-change.mjs |
| automatic-production-policy | active | config/production-risk-policy-activation.json |
| preview-target | repository-variable-PREVIEW_PROJECT_REF | AGENTS.md target identity rule |
| exclusive-mutation-lanes | preview,merge,production | scripts/manage-migration-author-lanes.mjs EXCLUSIVE_REFS |
| completion-closure | issue-opener-or-explicit-authority | AGENTS.md closure authority |

## Select the route once

**Ordinary maintenance:** code, tools, tests, monitoring and reports belong to
the repository session that owns the outcome. Use an isolated upstream worktree,
the task gate, the applicable scoped evidence and independent code review, and
the guarded merge path. A maintenance change does not claim database objects or
wait for structural intake. A merged loader repair still requires
its stated runtime acceptance; merged code is not automatically delivered work.

**Landing a ready pull request (do not skip):** green required checks and an
exact-head approval do **not** merge the PR by themselves. The required
`Migration guarded merge authorization` status is published only by the
**Guarded Merge** workflow (`guarded-migration-merge.yml`) after it re-proves
the head under the merge lock. Auto-merge / the merge queue stays blocked until
that status exists. When a PR is ready, dispatch Guarded Merge with the PR
number and the **full 40-character** head SHA (a short SHA is checked out as a
branch name and fails). Observed live on PR #4473 (2026-10-18): the queue sat
idle for hours after checks were green until Guarded Merge ran.

**Documentation:** a change containing only prose, including standalone
`plan_*.md` proposals, uses the documentation route. Albert authorizes merging
proven documentation-only changes without full engineering CI or reviewer waits.
Check the complete diff, including renames and modes. Behavior-changing agent
instructions, scripts, configurations, workflows and migrations keep their
engineering protections. Literal routing links have the existing narrow
base-owned classifier; a Markdown extension alone does not exempt instructions.

**Structural work:** claim-first (AGENTS.md §0.0-D) — claim the exact objects on
the existing issue and start; no orchestrator, marker, or dispatch. Preserve exact-object claims and migration-version
reservation, independent review, qualified rehearsal, guarded merge, and the
existing serial production lane. Do not infer a routing destination from an old
handoff or invent a migration to test a workflow.

**Self-service additive work:** an eligible additive change wholly inside the
existing `crm`, `pim`, `dam` or `plm` boundary may use the implemented self-service
route. The current classifier decides eligibility; shared references, other
schemas, destructive changes and uncertain SQL retain the conservative route.
Self-service removes central intake, not object/version protection or review.

## Concurrency and production

Authors and reviewers have no count ceiling or provider-busy queue. Parallelize
independent files and preparation. Shared preview apply, guarded merge and
production promotion remain exclusive protected operations. Preserve the
merge/production interlock and ownership-aware lock recovery. Expiry alone does
not authorize taking a live lock or discarding recoverable work.

Automatic production policy is active for its existing qualified route. A
successful qualifying merged-main preview can advance through the existing
production workflow's independent checks. Any AI session may launch that merged-main
preview run for an approved, merged change (owner ruling 2026-10-02, `docs/owner-rulings.md`
§6.25). This does not authorize a session-made
production dispatch, a new isolated-to-production trigger, or an unverified
target. Re-prove the configured target immediately before every write. Resolve
preview from `PREVIEW_PROJECT_REF`; historical project IDs are not authority.

## DesignFlow code and database release requirements

For the six DesignFlow applications, keep each code release's
`.release/database.json` aligned with the required canonical source migrations and
runtime table/column/access contracts. Update the reviewed central policy in
`config/designflow-db-releases.json` with contract changes. Sandbox-only SQL is not
a recorded production prerequisite. The source author/application session owns the
manifest update as part of the same application need; do not close its acceptance
while the required production proof is missing.

[DesignFlow release readiness](../designflow-db-release.md) defines the strict
manifest, authenticated central publisher, existing-promotion integration and
pre-main enforcement checks. It creates no new SQL executor or application merge
authority. Its source implementation, six manifest publication and live enforcement
are separate deliveries tracked on #4655 / popcre/designflow-backend#232. Do not
claim activation from source publication alone. Keep this operating rule canonical;
consumer copies mirror it instead of maintaining six competing agent guides.

## Completion and recovery

Use the acceptance contract appropriate to the outcome: reviewed publication,
merged implementation, database application, live verification, and application
acceptance are distinct facts. Only verified required stages release a dependency;
issue closure alone does not prove them. Keep final completion evidence immutable,
and keep administrative closure with the issue opener or explicitly authorized
successor. Preserve negative findings and explain unverifiable evidence.

For a blocked external issue, use the existing blocker watcher and its durable
resume path. Do not introduce a second scheduler, bulk-close historical issues,
or turn the workflow-refactor program tracker into an application prerequisite.

## Authoritative references

- [AGENTS.md](../../AGENTS.md)
- [Scoped maintenance evidence](agent-work-contract-repo-maintenance-evidence.md)
- [Coordination details and incident rationale](section-4-anti-collision-rules.md)
- [Workflow refactor implementation plan](../../plan_shared_db_workflow_refactor.md)
