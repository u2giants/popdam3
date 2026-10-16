# Shorter, narrower shared database release holds

## STATUS — read first

Planning baseline: **October 16, 2026, 9:17 AM EDT**, protected main
`778dc192f4a0ede1889c6a595b08b47425657cd1`. This is a **proposal, not activated policy**.
Tracker: [existing release-preparation outcome #3779](https://github.com/popcre/shared-db/issues/3779).
Planning owner: Codex chat `01a144d8-b318-7ed0-af97-e852be49d231` on `hetz`.
Implementation ownership has not been transferred by this document. Start at **step 1**.
Every implementation row remains open until its evidence is recorded here and on #3779.
Do not mark an implementation done because this plan was published.

| Step | Outcome | Status | Updated | Acceptance artifact |
|---|---|---|---|---|
| 1 | Fresh baseline, ownership and hold-duration inventory | ⬜ open | 2026-10-16 EDT | Required: redacted run/lease timeline and accepted scope on #3779 |
| 2 | Bound preparation and release-state contracts | ⬜ open | 2026-10-16 EDT | Required: schema/fixture tests from §10 |
| 3 | Merge preparation outside shared serialization | ⬜ open | 2026-10-16 EDT | Required: workflow ordering/race tests and live independent-merge proof |
| 4 | Production/preview preparation before acquisition | ⬜ open | 2026-10-16 EDT | Required: workflow ordering tests and actual acquisition timeline |
| 5 | Safe early release, independent reporting and cleanup | ⬜ open | 2026-10-16 EDT | Required: failed-upload, crash and authorization-restoration proofs |
| 6 | Proven independence narrows blocking | ⬜ open | 2026-10-16 EDT | Required: positive/negative dependency proofs and protected merge result |
| 7 | Observe stale holders without mutating ownership | ⬜ open | 2026-10-16 EDT | Required: read-only stalled-holder report fixtures |
| 8 | Fenced recovery after verified writer termination | ⬜ open | 2026-10-16 EDT | Required: stale-writer race tests and controlled recovery evidence |
| 9 | Integrate gates, metrics and operating instructions | ⬜ open | 2026-10-16 EDT | Required: full regression evidence and exact-head AI approval |
| 10 | Guarded landing and live acceptance of all four improvements | ⬜ open | 2026-10-16 EDT | Required: merged SHA, real run links, measured held time and negative results |

Companion: [this session's handoff](HANDOFF.d/2026-10-16T1317Z-hetz-codex-shared-release-holds.md).
Read its current state, then the downstream phases before each phase. At phase cut points
use the `fresh-session` skill if context is insufficient; preserve evidence and re-read STATUS.

## 1. Ultimate goal

Allow teams to prepare and deliver unrelated work without waiting for a database
release that is installing tools, waiting for a review, uploading a report, or
recovering from a stopped session. Reserve shared resources only while a protected
operation actually needs them. A shorter hold must never permit two database
writers, stale approval, a wrong target, lost evidence, or an unverified recovery.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

The four required outcomes are: acquire later, release sooner, narrow the scope
of blocking when independence is proven, and recover genuinely stalled holds safely.
An optimization that merely hides a hold, disables checks or abandons verification fails.

## 2. What this application is

[popcre/shared-db](https://github.com/popcre/shared-db) is the canonical database
structure and coordination repository for POP Creations' CRM, DAM, PIM and DesignFlow
applications. It contains PostgreSQL migrations, Node.js coordination tools, Python
production guards and GitHub Actions workflows. Protected target branch: `main`.
This is repository-maintenance work, not a migration or application feature.

Production Supabase is `qsllyeztdwjgirsysgai` (Virginia). Never use the retired Ohio
project. Preview identity comes from repository variable `PREVIEW_PROJECT_REF`,
re-proven immediately before a write; a remembered project ID is not authority.
GitHub Actions owns automatic preview/promotion; local sessions do not apply SQL
or edit a server. DAM's customer UI is https://dam.designflow.app, but no UI change
or application deploy is part of this work.

Vocabulary: an **object claim** protects the exact database objects/version assigned
to an author; an **exclusive stage lease** reserves preview, merge or production;
a **promotion freeze** pauses merges while production qualification depends on a
stable source; a **GitHub concurrency group** serializes workflow scheduling.
They are distinct. Releasing one does not establish that the others are free.
Reviewer leases are separate and must not be swept as database release holds.

## 3. Trigger and reproducible observation

Albert said: “this chat has only to do with `shared release` holds” and asked to
reduce their scope and duration “without sacrificing safety” because they were
holding back work. He then requested a plan for **all** four recommendations and
publication to GitHub. This publication authorizes no implementation or live mutation.

At the pinned baseline, inspect `production-apply` in
`.github/workflows/shared-supabase-migrations.yml`: acquisition at line 1801 precedes
CLI setup at 1966, PostgreSQL-client setup at 1969, bounded-checkout preparation at
2030 and artifact upload at 2148; release is at 2164. These orderings prove potential
avoidable occupancy, not a measured claim about how many minutes were wasted.
The guarded merge workflow also has a repository-wide concurrency group at lines
25–27, covering preparation even before the actual merge lease.

Reproduce without a database write: inspect those ordered steps, then reconstruct
start/acquire/critical-operation/release/end times from existing successful and
failed GitHub Actions runs and owner commits. Use run IDs, attempt IDs and exact
heads; never equate total job duration with time a lease was held.

## 4. Scope: in and out

In: all four outcomes, preparation/critical-section separation for merge, preview
and production; narrowly proven nonconflicting progress; stalled-holder detection
and safe recovery; truthful evidence and lock-duration metrics; regression and live
acceptance; discoverable operating documentation.

NOT in this plan: OrderList PR #417, session-label PR #4346, review-receipt recovery
PR #4388, their branches or any database feature; provider credentials, reviewer
rotation/capacity changes; direct production commands; cloud/organization settings;
removing the owner-required production pause; concurrent production migrations;
parallel mutation of the same preview database; author-claim abandonment or broad
cleanup. Do not resume the earlier OrderList work from this chat.

This is a focused execution specification under #3779, not a replacement for the
whole [workflow-refactor program](plan_shared_db_workflow_refactor.md). Reconcile
its steps 9–11 and existing #3781/#3397 owners before editing shared workflows.
[#3919](https://github.com/popcre/shared-db/issues/3919) establishes the existing
promotion freeze; preserve its reviewer-reuse work and remaining proof obligations.
Do not turn any tracker into a prerequisite for unrelated application delivery.

## 5. Current code and exact delivery state

All references below are repository-relative at the pinned baseline; inspect the
named functions after any upstream drift. Publication adds prose only; no behavior
has been implemented, activated or deployed by this plan.

| Existing source | Current behavior and evidence |
|---|---|
| `.github/workflows/guarded-migration-merge.yml:25` | One workflow-wide `shared-db-guarded-merge` scheduling group; quota preparation already occurs outside the explicit lock around lines 168–193. Do not rebuild that completed separation. |
| Same workflow, `merge_lock`, `guarded_merge` and final release | Rechecks exact head, required checks, collisions, approval and freeze under lock; revokes failed authority before releasing. Queue admission is not proof of an actual merge. |
| `.github/workflows/shared-supabase-migrations.yml:124–136` | Separate preview/production scheduling groups already exist. Preserve this completed improvement. |
| Same workflow `production-apply`, lines 1801–2169 | Production hold covers setup, repeat qualification, apply, verification and upload. Immediate target for ordering improvements. |
| Same workflow lines 2175–2245 | Freeze release and restoration clear only this run's revocations to pending, never success. Preserve exact owner/run matching. |
| `scripts/lib/lanes/queue-routing.mjs:15` | Preview/recovery/rehearsal share one preview ref; merge and production have separate refs. Preview does not universally exclude production/merge. Do not claim there is one global database lock. |
| `scripts/manage-migration-author-lanes.mjs`, `acquireExclusive`, `releaseExclusive`, `recoverExclusive` | Production and merge interlock; structured holder/generation recovery already exists. CLI legacy SHA-release paths need explicit call-site audit; do not assume the newer function is used everywhere. |
| `scripts/lib/exclusive-lease.mjs:164`, `evaluateRecovery` | Existing terminal-run, later-attempt, grace and fail-closed recovery qualification. Extend, do not replace with age-only expiry. |
| Same manager, `readPromotionFreeze`, `acquirePromotionFreeze`, `assertNoPromotionFreeze` | Optional pre-review freeze has a maximum 180-minute TTL and blocks merge/maintenance authority; expiration does not end a production writer. |
| `scripts/check-main-tip-freshness.mjs` | Already tolerates a narrowly classified inert main advance; production acquisition and downstream readers must remain consistent with it. |
| `scripts/orchestrator-flow/runner-lanes.mjs`, `throughput-report.mjs` | Existing scheduling/reporting owners; extend these rather than introduce a second scheduler or generic metrics service. |

Pinned source: [main snapshot](https://github.com/popcre/shared-db/tree/778dc192f4a0ede1889c6a595b08b47425657cd1).
Planning branch: `codex/shared-release-holds-plan`. Publication is verified by its
GitHub PR/commit, not by this paragraph's prediction. Implementation starts from
fresh upstream in a separate worktree; never use an older integration checkout.

## 6. Findings and root causes

1. Preparation can block through **scheduling** even without holding an explicit
lease: the guarded-merge workflow-level concurrency group covers all jobs. Moving
only acquisition later will not resolve that bottleneck.
2. Production acquisition is earlier than tool installation and bounded checkout.
Those steps can run beforehand, while target identity, current ledger, source
compatibility, required authorization and dry-run are re-proven inside the lease.
3. Reporting is mixed with protected verification: catalog verification is safety
critical; network artifact upload after it need not prolong mutation exclusion.
A local verified result is not yet durable recovery evidence, so a minimal durable
receipt must exist before releasing; uploading verbose reports can happen later.
4. A stable-main dependency creates broad freezes. Proven content independence must
cover migration bytes **and** policy/tools/sidecars/producer inputs and effective
checks; “different tables” or “same filenames” alone proves little.
5. Run completion and elapsed time do not prove database-writer termination.
Recovery needs both holder-generation fencing and trustworthy writer/session
termination evidence; a Git ref by itself cannot fence an already-running SQL call.
6. The existing freezer invalidates every open PR authorization then restores its
own revocations. Narrowing the freeze requires updating this whole protocol,
including queued work and required-check consumers, not just deleting an interlock.
7. Existing #3779, #3781, #3397 and #3919 overlap. Their historical STATUS and owners
must be checked live. Do not duplicate their implementation or claim acceptance
from a closed issue alone.

## 7. Rejected approaches and failed paths

- Remove the production pause or allow two production applies: rejected; violates
serialization and the owner's October 2 ruling, “assign someone to pause merges
during production runs.” This plan shortens its justified interval, not its protection.
- Shorten TTL and automatically steal expired locks: rejected; the original SQL
writer may still be running. Expired timestamps nominate investigation only.
- Treat a completed/cancelled GitHub job as proof the database connection died:
rejected; remote work can outlive its caller. Termination must be established.
- Release before catalog/ledger verification: rejected; unknown or partial apply
must remain quarantined until reconciliation. A red upload is different from an
unverified database result.
- Only move explicit acquisition: insufficient; workflow-wide queuing still
serializes preparation. Only split jobs: insufficient if the top-level global
group remains.
- Permit a merge based on paths, table names or an old green check: rejected;
indirect dependencies, generated inputs, policy and queued candidates can change.
- Restore revoked statuses to success: rejected; only the protected admission path
can grant fresh authority. Reuse the existing pending restoration protocol.
- Build a second lock service, scheduler or retry loop: rejected; reuse native
lease, queue and recovery machinery. Do not reset reviewer budgets or delete refs.

These are design rejections, not claims that experimental fixes were deployed.
No deliberate production failure has been induced for this planning work.

## 8. Decisions (October 16, 2026)

**Locked:** all four outcomes are required. Preserve exact-head AI review, effective
required checks, target proof, object/version claims, one production writer,
shared-preview exclusion and atomic owner-qualified ownership operations. Unknown
independence blocks. Unknown writer termination blocks recovery. No human technical
approval is requested. No safety capability may be removed to make a wait disappear.

**Locked sequencing:** measure first; implement acquire-later/release-sooner first;
activate narrower blocking only after full dependency and queue-consumer proof;
activate recovery only after writer-fencing proof. Keep each independently reviewable.

**Engineering choices:** reuse an existing evidence format where adequate; otherwise
extend the native format with a versioned, strict schema. Determine exact alert and
phase timeout thresholds from observed legitimate operations; no fixed short TTL
is invented here. New modules below are bounded proposed owners, not permission
for a new framework. Safe default is existing serialization until each new route
qualifies. No business decision is outstanding.

## 9. Ordered implementation

### Phase A — baseline and contracts (steps 1–2)

**1. Reconcile source, ownership and timings.** Start fresh `origin/main`; read
AGENTS, the current workflow router and this STATUS. On #3779 record explicit
acceptance for this bounded outcome; check #3781/#3397/#3919 and active PRs for
shared-file owners. Coordinate edits rather than rewriting another branch. Use
`runner-lanes.mjs` and `throughput-report.mjs` to distinguish queued, preparing,
locked, applying, verifying, reporting and recovered states. Extend the existing
report with run/attempt, stage kind, owner, generation, source/manifest digests and
acquire/release times; missing times are unknown, not zero. Save public-safe baseline
under `docs/verification/shared-release-holds/`; raw logs remain private.
**Gate:** complete timelines from available recent normal/failed runs reproduce
held time independently; every evidence gap is named. No resource is acquired.

**2. Define immutable preparation and terminal receipts.** Extend existing release
artifacts consumed by `production_business_risk_gate.py`,
`production_apply_review_evidence.py`,
`check-main-tip-freshness.mjs` and lane admission; create a single bounded helper
`scripts/lib/release-hold-evidence.mjs` only if no shared helper already owns it.
Preparation binds repo, PR, exact head/base, policy/tool/sidecar digests, ordered
migration allowlist and contents, target identity, producer run/attempt, review
inputs and expected ledger. It grants no write authority. The terminal receipt
binds lease owner/generation, actual target, before/after ledgers, applied contents,
verification result and remote-writer termination. Strict schemas reject unknown
fields/versions. Write a minimal durable receipt through the established trusted
artifact/evidence path and read it back before releasing; do not invent an unsigned
local JSON as authority. Dry-run paths must not create refs or receipts.
**Gate:** named adversarial tests below pass; tampered or cross-run evidence refuses.
Dependency: step 1. Cut point: baseline/contracts review; re-read phases B–D.

### Phase B — shorten occupancy (steps 3–5)

**3. Split merge preparation from the protected merge job.** In
`.github/workflows/guarded-migration-merge.yml`, remove global scheduling from the
preparation stage; retain per-request cancellation rules and bounded protected-job
serialization. Keep native merge lease acquisition as the mutation authority,
not GitHub concurrency. Before acquisition: downloads, long tests, quota waits,
static packet construction and initial checks. Under acquisition: freshly re-prove
exact candidate, compatible main, effective check authority, reviews/refusals,
claims/collisions, dependency closure, freeze and queue mode; then authorize and
admit/merge. A waiting prep cannot occupy the protected-job queue. A queued PR's
old authorization must not bypass later freeze/dependency checks.
**Gate:** `preparation_wait_does_not_block_independent_merge` and
`simultaneous_merges_admit_one_writer` pass; a real ready independent change
progresses while another request is preparing, with acquire/release evidence.
Dependency: step 2; sequence overlapping #3779 work, never rebuild it blindly.

**4. Move production and preview setup before their exclusive stages.** In
`.github/workflows/shared-supabase-migrations.yml`, move CLI/client qualification,
bounded checkout construction, immutable artifact resolution and static risk
preparation before `production_lock`. Inspect preview acquisition and
`preview-ledger-orphan-reconciliation.yml` similarly; mutate their shared preview
only under its existing lock. Do not hoist credential-bearing writes or mutable
catalog/ledger assertions outside protection and call them fresh. After acquiring:
assert owner/generation, re-prove actual target, selected content/policy,
compatible source, live ledger, approval/risk and dependencies, run the required
fresh bounded dry-run, apply and verify. Reuse preinstalled tools but fail before
acquisition if missing. Repeat only live-state-dependent work under the hold.
**Gate:** `tool_setup_precedes_stage_acquisition`,
`ledger_drift_after_preparation_refuses` and target/approval-race tests pass;
actual run shows no install/download/reviewer wait while held.
Dependency: step 2; steps 3–4 can be developed independently only if owners and
files do not collide, with one serialized integrator for shared manager changes.

**5. Release after verified terminal state, before verbose reporting.** Reorder
production's `Save apply evidence` and cleanup so mandatory ledger/catalog checks
and a minimal durable, verified terminal receipt precede release; large uploads,
summaries and notifications follow. Preserve cleanup for success, refusal,
cancellation and partial acquisition. Release only exact current holder/generation;
update legacy CLI callers safely, preserving supported legacy refusal. Restore
only this run's revoked statuses to pending. Make cleanup retryable even if an
upload or restoration API fails; a completed database operation must not retain a
mutation lease merely because reporting failed. Conversely, an ambiguous apply
retains a named quarantine and cannot be treated as successful release. Preserve
an open evidence-upload obligation on #3779 if the large report is missing.
**Gate:** `report_upload_failure_does_not_retain_verified_lease`,
`missing_durable_terminal_receipt_retains_quarantine`,
`cancellation_at_every_boundary_preserves_single_owner`, and
`restore_only_this_runs_revocations_to_pending` pass. Demonstrate idempotent
cleanup and clear distinction between operation success and reporting failure.
Dependencies: steps 2 and 4. Cut point: review and accept short-hold behavior
before introducing narrower admission or recovery.

### Phase C — narrow scope and recover safely (steps 6–8)

**6. Admit only proven-independent work during the protected interval.** Extend
`check-main-tip-freshness.mjs`, `check-pr-object-collisions.mjs`,
`merge-queue-contract.mjs`, `acquireExclusive`, `assertNoPromotionFreeze`,
repository-maintenance authorization and `runner-lanes.mjs` around **one shared
independence classifier**, proposed `scripts/lib/release-independence.mjs`.
Its immutable manifest covers the exact production bundle, target, policy,
verification sidecars, tools, review inputs and dependency closure. Start with
proven inert documentation/evidence or maintenance outside that closure. Same-table
or changed-policy work blocks; schema-disjoint SQL alone does not qualify. Do not
allow concurrent production applies or shared-preview writers. A non-overlapping
schema PR may prepare/review; its merge still waits unless the entire protected
production closure and every downstream consumer demonstrably tolerate it.

Update acquisition's current-main rule, production freshness/risk/evidence
consumers and freeze revocation/queue admission together: no caller may retain a
contradictory global-main assertion or allow a stale queued candidate through.
Reuse the existing documentation classifiers in `scripts/lib/documents-only-change.mjs`
and `check-documents-only-pull-request.mjs`; preserve `check-documents-ci-route.test.mjs`.
Do not invent a second definition of inert documentation.
Use a versioned route that defaults to old serialization; activate only after
exact-head reviewer approval and negative live/fixture proof. No broad file-prefix
allowlist. Preserve the production writer lock and owner-required pause for
conflicting/unknown merges. Requalify substantive/unknown drift instead of freezing
everything throughout a lengthy reviewer wait.
**Gate:** `independent_documentation_progresses_during_production`,
`hidden_policy_dependency_blocks`, `dependency_changes_after_admission_refuse`
and `queued_candidate_revalidates_after_freeze` pass; live independent progress
coexists with a preserved refusal for an overlapping candidate. No undocumented
exception can activate itself. Dependencies: steps 2–5.

**7. Detect stalls read-only.** Extend the existing throughput/queue report and
`scripts/lib/exclusive-lease.mjs`, not a new janitor. Report stage, exact holder,
generation, job/run/attempt, phase, last verified activity, measured held time and
reason. Separate slow-but-live from terminal-run-with-unknown-writer and safely
recoverable. Threshold alerts nominate investigation only. Use existing watcher
wakeups; do not poll or auto-recover based on age. Missing APIs, clock skew or
truncated data yield unknown, never free. Preserve original reviewer/object claims.
**Gate:** `old_live_holder_is_not_recoverable`,
`unknown_run_or_writer_is_unknown` and `reporting_is_read_only` pass. Step 7 can
follow step 2 independently of step 6, with no manager edit collision.

**8. Strengthen and integrate native fenced recovery.** Extend `evaluateRecovery`,
`recoverExclusive`, `scripts/lib/lanes/exclusive-locks.mjs` and current workflow
assert/release call sites. Preserve live terminal-run/later-attempt/grace checks;
add evidence that the protected database writer/session and child operations are
terminated, not merely that GitHub says cancelled. Use a session-scoped database
advisory exclusion held on the same connection for the whole critical operation,
or an existing equivalent authoritative writer fence, only after testing actual
CLI connection semantics. A separate psql probe cannot guard another CLI's write.
Prefer a session lock over a new schema/table; any required structural primitive
must use its own explicitly scoped shared-db migration route, never hidden DDL.

Before takeover: read exact lease and run/attempt, verify terminal/termination
proof, re-read under the native mutex, atomically advance generation and verify
readback. Re-prove target/ledger/catalog and reconcile partial apply; never replay
an ambiguous migration. Old holder cannot assert, renew, release or resume writes
in the new generation. Cover both a still-connected SQL writer and a revived
runner; every write path must honor the writer fence. Automatic action is limited
to a fully proven safe path; everything else remains visibly blocked with evidence.
Do not reuse a freeze TTL as authority for recovery or cancel a foreign run.
**Gate:** `cancelled_runner_with_live_sql_blocks_recovery`,
`stale_generation_cannot_write_or_release`, `two_recoverers_only_one_wins`,
`partial_apply_is_reconciled_not_replayed` pass, followed by controlled isolated
recovery. No production fault injection. Dependencies: steps 2, 5 and 7; step 6
must be rechecked against the final fencing contract.

### Phase D — integration, landing and acceptance (steps 9–10)

**9. Integrate operating instructions and measurement.** Update existing
`docs/agents/section-4-anti-collision-rules.md`, `docs/agents/merge-protocol.md`,
`docs/production-promotion-procedure.md`, `docs/deployment.md`, current workflow/router and this STATUS.
Keep the [topic entry point](docs/shared-release-holds.md) current; when retiring the
plan, redirect its topic/router links to the accepted operating instructions.
Extend `throughput-report.mjs` to show scheduling wait, preparation, exclusive held
time, apply, verification and reporting separately, with sample size and unknowns.
Document each stage's owner, acquisition/release boundary, safe recovery and
quarantine. Preserve same-issue live-proof checklist on #3779; link other owners'
evidence without claiming their outcomes. Run §10, obtain native assigned AI
exact-head APPROVE and satisfy task gates; never self-approve production changes.
**Gate:** full regression suites green, hold timeline derivable from artifacts,
all trust-boundary cases covered, documentation matches actual callers.
Dependencies: all previous steps. Re-read all downstream acceptance before landing.

**10. Land normally and prove all four outcomes.** Commit only owned paths, push
feature PRs, wait with the bounded native PR waiter, use guarded merge/queue, never
`--admin` or force push. Code/CI/settings changes retain normal review/checks.
Use approved existing preview/automatic promotion routes and genuine ready changes;
do not create a fake migration just for throughput proof. Verify Actions executed
the merged workflow SHA, exact target/content/policy and operator-visible results.
Recover a controlled stopped writer in an isolated environment first; production
acceptance may use a genuine safely recoverable incident, never manufacture one.
If no genuine production event is available, keep that specific acceptance open,
with named owner on #3779, rather than claim completion.
**Gate:** acceptance matrix in §13 has direct run/commit/test links, no leaked holds,
no bypass, no original capability lost. Update STATUS and #3779; do not close
#3919/#3781/#3397 or unrelated issues on their owners' behalf.

## 10. Required tests and adversarial cases

Add named tests below to the closest existing suite. Proposed focused suites are
`scripts/lib/release-hold-evidence.test.mjs`,
`scripts/lib/release-independence.test.mjs` and
`scripts/release-hold-workflow-order.test.mjs`; create only the ones not already
owned by an equivalent helper. No network or real database credentials in unit tests.

| External input / race | Hostile case | Required named test |
|---|---|---|
| Preparation artifact | Wrong repo, PR, head, target or producer attempt | `cross_run_preparation_is_rejected` |
| Artifact contents | Tampered bytes, unknown fields/version, path traversal | `tampered_or_unsafe_preparation_is_rejected` |
| Live ledger | Changes after preparation | `ledger_drift_after_preparation_refuses` |
| Target configuration | Preview resolves to production or target changes | `target_swap_before_write_refuses` |
| Approval / checks | Withdrawn approval, missing required status, stale head | `approval_or_check_drift_under_lock_refuses` |
| Workflow scheduler | One prep waits on quota, another ready | `preparation_wait_does_not_block_independent_merge` |
| Competing merge requests | Both reach acquisition together | `simultaneous_merges_admit_one_writer` |
| Setup dependency | Slow installation after acquisition | `tool_setup_precedes_stage_acquisition` |
| Terminal receipt | Missing durable readback despite local success | `missing_durable_terminal_receipt_retains_quarantine` |
| Reporting service | Upload fails after verified terminal receipt | `report_upload_failure_does_not_retain_verified_lease` |
| Cancellation | Kill before/after acquire, apply, verify, receipt, release | `cancellation_at_every_boundary_preserves_single_owner` |
| Status restoration | Another run has changed status, prefix-matching run ID | `restore_only_this_runs_revocations_to_pending` |
| Independence manifest | Same migration name but changed tool/sidecar/policy | `hidden_policy_dependency_blocks` |
| Proposed independent PR | Proven inert change with protected closure unchanged | `independent_documentation_progresses_during_production` |
| Dependency closure | New transitive dependency after initial qualification | `dependency_changes_after_admission_refuse` |
| Queued candidate | Authorization predates production freeze | `queued_candidate_revalidates_after_freeze` |
| Old lease | Old timestamp while holder still live | `old_live_holder_is_not_recoverable` |
| GitHub API | 403, timeout, incomplete attempts, unknown conclusion | `unknown_run_or_writer_is_unknown` |
| Observer | Report attempts to write/renew/release | `reporting_is_read_only` |
| Cancelled job | SQL connection or child operation remains active | `cancelled_runner_with_live_sql_blocks_recovery` |
| Recovered generation | Original holder wakes, attempts write or release | `stale_generation_cannot_write_or_release` |
| Recovery contenders | Two candidates observe same old generation | `two_recoverers_only_one_wins` |
| Partially applied SQL | Ledger/result ambiguous at recovery | `partial_apply_is_reconciled_not_replayed` |
| Fence connection | Probe lock ends before separate CLI writes | `separate_probe_connection_does_not_authorize_writer` |
| Preview lease | Rehearsal and recovery try same shared target | `preview_modes_keep_one_shared_writer` |
| Existing ownership | Malformed/legacy lease or foreign claim | `foreign_or_unreadable_ownership_is_not_released` |

Required regression commands (from repository root; verify filenames on fresh main):

```sh
node --test scripts/lib/exclusive-lease.test.mjs scripts/manage-migration-author-lanes.test.mjs
node --test scripts/orchestrator-flow/runner-lanes.test.mjs scripts/orchestrator-flow/throughput-report.test.mjs
node --test scripts/check-main-tip-freshness.test.mjs scripts/dispatch-production-apply.test.mjs scripts/check-current-workflow-policy.test.mjs
node --test scripts/check-merge-queue-workflows.test.mjs scripts/check-guarded-merge-sync-dispatch.test.mjs scripts/check-dispatch-collision.test.mjs scripts/mutex-release-on-refusal.test.mjs scripts/merged-review-lease-liveness.test.mjs
node --test scripts/check-workflow-preview-mode-guard.test.mjs scripts/check-workflow-preview-ref.test.mjs scripts/target-queue-identity.test.mjs scripts/check-documents-ci-route.test.mjs
node --test scripts/documents-only-merge-authorization.test.mjs scripts/check-documents-only-merge-authorization.test.mjs scripts/check-migration-pr-lease.test.mjs
python3 -m unittest discover -s scripts -p 'test_production_business_risk_gate*.py'
python3 -m unittest discover -s scripts -p 'test_production_apply_review_evidence.py'
python3 -m unittest discover -s scripts -p 'test_production_catalog_verification*.py'
node scripts/check-current-workflow-policy.mjs
node scripts/check-throughput-truth-audit.mjs
git diff --check
```

Also run the repository's actual production-risk/catalog Python suites and workflow
contract suites for every changed consumer, discovered with `rg --files scripts`
and existing CI commands; record their exact commands/results in STATUS, not a
vague “all tests.” Update native invalidator/throughput inventories through their
existing reviewed process when shared helpers are added. Do not edit generated
inventories blindly or weaken tests to match a proposed ordering.

## 11. Constraints and gotchas

- Canonical checkout is landing-only; current-upstream isolated worktrees for edits.
Check concurrent source/PR ownership before shared-file edits; stage owned paths only.
- Task declaration: planning is `prose`; implementation must redeclare the actual
class and run `ai-task-gates check` before review, ship and protected actions.
- Feature branches/PRs only; committer Albert Hazan
`u2giants@users.noreply.github.com`; normal queue/guarded merge, never admin bypass.
- Native allocator and exact-head durable AI verdict gate technical changes. Do not
write approvals, receipts, check-ins, ownership refs or completion evidence by hand.
- No database shape/row change is needed for the initial ordering phases. Any later
structural fence requires a separately reviewed minimum migration and target proof.
- A completed GitHub workflow does not prove frontend deployment, database success
or remote SQL termination. Verify the relevant outcome directly.
- Do not expand throughput scope into provider review-recovery, credential rotation,
old worktree cleanup or other sessions' handoffs. Preserve unique source and evidence.
- All human-facing clock times use America/New_York, labeled EST/EDT. Machine ISO
keys and handoff filename may be UTC. Redact private paths/traffic and row data.
- No automatic production-lock expiration; a timeout triggers diagnosis. Freeze
TTL expiry cannot grant permission while the independent production lease exists.
- No CI failure suppression, blanket status restoration, lost authorization-revocation
handling, or shortened verification as a substitute for shorter hold duration.

## 12. Access and environment

Planning used authenticated Git and `gh` for `popcre/shared-db`; recheck with
`gh auth status` without printing credentials. Node.js, Python 3 and repository
CLI/test helpers are available on `hetz`. A future machine must qualify installed
reviewed `ai-devops` tools and read AGENTS' credential runbook. No production
credential, login or remote host access is required to write/validate this plan.

For implementation, GitHub repository variables/secrets supply preview/production
workflow target access; 1Password vault is `vibe_coding`. Resolve the exact existing
item from the credential runbook through the `secrets-to-1password` skill only when
needed; never guess an item name, print a value, embed credentials in arguments,
or add a new secret copy. Browser login is N/A: there is no UI to serve or edit.
No production SSH is authorized. Local verification is the Node/Python suites in
§10; isolated database tests use the existing disposable CI test environment.

GitHub artifact download is untrusted input: use authenticated provenance/digests,
strict schemas and safe extraction. A planning-session API result is not reusable
write authority for a later session.

## 13. Definition of done, risks and remaining engineering questions

| Required outcome | Acceptance, not just preparation |
|---|---|
| Acquire later | Actual merge/production/preview timelines show downloads/install/review waits occur before acquisition; live-state checks still run under protection. |
| Release sooner | Verified terminal receipt precedes release; failed verbose upload does not retain a hold or mark evidence complete; required DB verification never runs after unsafe release. |
| Narrow scope | Genuine independent work progresses with evidence of unchanged protected closure; conflicting, unknown, stale and queued bypass cases still refuse. Production/preview writer count never exceeds one per shared target. |
| Recover safely | Controlled recovery proves old writer termination and generation fencing, including revived runner/live SQL negatives; ambiguous apply remains quarantined. |
| Throughput | Re-derivable before/after sample sizes and median/p95 held time are reported by stage. No invented speed percentage; deterministic fixtures prove avoidable prep/upload occupancy is zero. Small live samples are labeled; do not claim statistical improvement without evidence. |
| Delivery | Owned commits pushed, required CI/reviews green, normal guarded merges, merged workflow SHA executed, direct live evidence linked on #3779, STATUS truthful, router/docs current, zero session-owned abandoned reservations. |

**Risks/rollback:** setup reordering can admit stale evidence; fresh protected-boundary
checks prevent that. Early release can lose recoverability; minimal durable terminal
receipt and quarantine protect it. Scope reduction can miss indirect dependencies;
unknown always serializes. Recovery can create two writers; writer termination and
same-connection fencing are mandatory. Revert the scoped implementation through a
reviewed PR to the prior conservative admission/order, preserve immutable evidence
and leases, and reconcile in-flight work before switching. Never roll back by
force-pushing, deleting claims, cancelling an unverified foreign writer or running
ad hoc SQL. A failed apply follows existing recovery; do not automatically rerun it.

**Engineering questions resolved during step 1/2:** which existing evidence store
can durably record a minimal terminal receipt before unlock; which actual CLI
connection can own the writer fence; which sidecars/tools are in the protected
closure; which workflows still use legacy release callers. Criteria are specified
above, not delegated to Albert. If the existing runtime cannot provide trustworthy
writer fencing, preserve safe manual/native recovery and mark step 8 blocked;
that is not completion of all four outcomes. No business choice is outstanding.

Planning delivery is complete when this audited document and its discoverability
links are committed, pushed and normally merged. That is distinct from implementation
acceptance: all ten STATUS rows stay open. Keep #3779 open and leave its live-proof
checklist unfulfilled until each required outcome is observed. Do not open a second
“leftover proof” issue. Any genuinely different application need keeps its own owner.

### Final self-audit of this plan

- All 13 required sections are present; STATUS covers every executable step.
- Goal, application, trigger and explicit exclusions: §§1–4. Current state and exact
baseline/function evidence: §§5–6. Rejections and locked/open decisions: §§7–8.
- Every step in §9 names target files, behavior, dependencies and a verification gate.
Every external trust/race case in §10 has a named test; regressions are explicit.
- Rules, access, secrets references, delivery, rollback and unresolved engineering
criteria: §§11–13. Plan↔handoff links and router/topic registration are required in
this publication. No portable-memory file is modified without a direct memory request.

1. **Can a brand-new session execute without chat or owner questions? Yes.** §§1–8
supply purpose, baseline, meanings and exclusions; §9 gives ordered changes and
cut points; §10 names hostile cases; §§11–13 state access, gates and acceptance.
Source drift is handled by step 1, not assumed away. No missing business decision.
2. **Does it carry relevant background, nuance and rejected paths? Yes.** §§3–8
preserve the trigger, distinct locks, scheduling bottleneck, existing improvements,
terminal-writer caveat and all rejected shortcuts. §4 explicitly excludes old
OrderList/reviewer work; no lost context becomes accidental implementation scope.
3. **Can it guide a correct judgment if a step is wrong? Yes.** §1 makes the business
goal controlling; §8 locks safety invariants, and §§9/13 require stopping when
independence or fencing cannot be proven rather than weakening the capability.

Audit passed after correcting two drafting gaps: the workflow scheduling bottleneck
must be addressed in addition to the explicit lock, and a durable terminal receipt
must precede early unlock rather than relying on a local report. All checklist
items now have evidence above; implementation and live acceptance remain unstarted.
