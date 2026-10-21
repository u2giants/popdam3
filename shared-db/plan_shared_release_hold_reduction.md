# Shorter, narrower shared database release holds

## STATUS — read first

Original planning baseline: **October 16, 2026, 9:17 AM EDT**, protected main
`778dc192f4a0ede1889c6a595b08b47425657cd1`. This is a **proposal, not activated policy**.
Design revision: **October 16, 2026 EDT**, after the substantive Muse critique of published main `6669538515a8a5813887e9fa98eb422682f9ca4b`. All implementation remains open. The earlier publication approval established safe publication, not implementation readiness.

Tracker: [existing release-preparation outcome #3779](https://github.com/popcre/shared-db/issues/3779).
Planning owner: Codex chat `01a144d8-b318-7ed0-af97-e852be49d231` on `hetz`.
Implementation ownership has not been transferred by this document. Start at **step 1**.
Every implementation row remains open until its evidence is recorded here and on #3779.
Do not mark an implementation done because this plan was published.

| Step | Outcome | Status | Updated | Acceptance artifact |
|---|---|---|---|---|
| 1 | Fresh baseline, ownership and hold-duration inventory | 🟨 partial (merge stage) | 2026-10-20 EDT | Merge stage: [guarded merge baseline](docs/verification/shared-release-holds/2026-10-20-guarded-merge-baseline.md); production/preview stages still open |
| 2 | Bound preparation and release-state contracts | ⬜ open | 2026-10-16 EDT | Required: schema/fixture tests from §10 |
| 3 | Merge preparation outside shared serialization | 🟨 implemented, live proof pending | 2026-10-20 EDT | `prepare`/`merge` job split in `guarded-migration-merge.yml`; `scripts/guarded-merge-preparation-split.test.mjs`; live independent-merge and simultaneous-attempt traces to be linked on #3779 after the merged workflow runs |
| 4 | Production/preview preparation before acquisition | ⬜ open | 2026-10-16 EDT | Required: workflow ordering tests and actual acquisition timeline |
| 5 | Safe early release, independent reporting and cleanup | ⬜ open | 2026-10-16 EDT | Required: failed-upload, crash and authorization-restoration proofs |
| 6 | Proven independence narrows blocking | ⬜ open | 2026-10-16 EDT | Required: positive/negative dependency proofs and protected merge result |
| 7 | Observe stale holders without mutating ownership | ⬜ open | 2026-10-16 EDT | Required: read-only stalled-holder report fixtures |
| 8 | 8a ownership/release safety; 8b isolated fencing experiment; 8c qualified recovery | ⬜ open | 2026-10-16 EDT | Required: stale-writer race tests and controlled recovery evidence |
| 9 | Integrate gates, metrics and operating instructions | ⬜ open | 2026-10-16 EDT | Required: full regression evidence and exact-head AI approval |
| 10 | Guarded landing and live acceptance of all four improvements | ⬜ open | 2026-10-16 EDT | Required: merged SHA, real run links, measured held time and negative results |

Debate and finding dispositions: [design debate ledger](docs/investigations/shared-release-holds-design-debate.md).
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
heads; never equate total job duration with time a lease was held. Release deletes
the ref, so derive release timestamps from the owning Actions step/operation log,
not an assumed retained release ref.

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

For the narrower-freeze outcome, adopt the already-reviewed [#4039 proposal](plan_narrow_promotion_freezes.md) §§8–10 and its investigation/debate, with the explicit choices in §8.1 below. Its investigation is complete, its implementation is unstarted and not transferred by this plan. Reconcile/reopen the existing #4039 through the supported route when that implementation is actually authorized; record one named owner and cross-link #3779. Do not create a second classifier or silently claim the closed investigation implemented the feature.

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
| Same workflow, `merge_lock`, `guarded_merge` and final release | Checks freeze on acquisition and rechecks exact head, required checks, collisions and approval under the held production/merge interlock; revokes failed authority before releasing. Queue admission is not proof of an actual merge. |
| `.github/workflows/shared-supabase-migrations.yml:124–136` | Separate preview/production scheduling groups already exist. Preserve this completed improvement. |
| Same workflow `production-apply`, lines 1801–2169 | Production hold covers setup, repeat qualification, apply, verification and upload. Immediate target for ordering improvements. |
| Same workflow lines 2175–2245 | Freeze release and restoration clear only this run's revocations to pending, never success. Preserve exact owner/run matching. |
| `scripts/lib/lanes/queue-routing.mjs:15` | Preview/recovery/rehearsal share one preview ref; merge and production have separate refs. Preview does not universally exclude production/merge. Do not claim there is one global database lock. |
| `scripts/manage-migration-author-lanes.mjs`, `acquireExclusive`, `releaseExclusive`, `recoverExclusive` | Production and merge interlock; structured holder/generation recovery already exists. CLI legacy SHA-release paths need explicit call-site audit; do not assume the newer function is used everywhere. |
| `scripts/lib/exclusive-lease.mjs:164`, `evaluateRecovery` | Existing terminal-run, later-attempt, grace and fail-closed recovery qualification. Extend, do not replace with age-only expiry. |
| Same manager, `readPromotionFreeze`, `acquirePromotionFreeze`, `assertNoPromotionFreeze` | Optional pre-review freeze has a maximum 180-minute TTL and blocks merge/maintenance authority; expiration does not end a production writer. |
| `scripts/check-main-tip-freshness.mjs` | Already tolerates a narrowly classified inert main advance; production acquisition and downstream readers must remain consistent with it. |
| `scripts/orchestrator-flow/runner-lanes.mjs`, `throughput-report.mjs` | Runner-label routing and pure report formatting respectively; neither collects lease activity. Use existing queue-hygiene collection/schedule for stall observations. |

Pinned source: [main snapshot](https://github.com/popcre/shared-db/tree/778dc192f4a0ede1889c6a595b08b47425657cd1).
Planning branch: `codex/shared-release-holds-design-revision`. Publication is verified by its
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
The #4039-shaped exception freshly admits strict inert prose during the early
qualification freeze only; all merges still block during the production lease.
- Build a second lock service, scheduler or unbounded retry loop: rejected; reuse native
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

**Engineering choices:** the locked receipt, cleanup and admission choices below govern; reuse an existing evidence format where adequate, otherwise
extend the native format with a versioned, strict schema. Determine exact alert and
phase timeout thresholds from observed legitimate operations; no fixed short TTL
is invented here. New modules below are bounded proposed owners, not permission
for a new framework. Safe default is existing serialization until each new route
qualifies. No business decision is outstanding. The connection/fencing feasibility question is an explicit research gate, not a promised implementation mechanism.

### 8.1 Locked implementation decisions after Muse critique

These choices supersede the original underspecified prose in steps 2/4/5/6/8.
They change this proposal only, never current runtime authority.

**A. Terminal evidence uses the existing coordination Git transport.** Reuse native
canonical JSON hashing, strict schema validation, create-only commit/ref publication
and readback machinery. Extend existing release-evidence helpers where ownership
fits; no generic receipt service. Proposed immutable audit refs are
`refs/db-release-evidence/<stage>/<request-id>-g<generation>/<prepared|write-intent-N|terminal|reporting-complete>`.
Stage/request/generation components use a strict allowlist/UUID/positive integer
parser. This is bounded operation evidence, not a new promotion-authorization or
narrowing subsystem. The existing stage lease remains sole mutation exclusion.
No consumer may treat the presence of an evidence ref as review or apply authority.

The prepared receipt is published after acquiring and refreshing target/ledger,
before the first mutating command. It binds schema version, repository, source
PR/head and trusted workflow/policy hashes, target identifier, stage, lease request,
owner/generation, run/attempt, ordered migration versions/content digests, complete
pre-write migration-version inventory and its hash, bounded allowed operations,
verified approval references, and prepared-check results/digests. No credentials,
customer rows, raw private catalog or authenticated traffic may be stored. Each
actual write has a create-only write-intent record, command-kind/ordinal and bound
manifest digest BEFORE launching it. All compliant writers must obey that ordering.

The terminal receipt binds the prepared/write-intent ref SHAs, the exact same
identity, command exit/result, complete post-ledger inventory/digest, catalog
verification outcome/digest, path-specific writer completion evidence and mandatory check results.
On ordinary success this means launched-command exit plus bound post-state
verification, not independent backend-death observation. Recovery instead requires
8c-qualified backend termination evidence. A success receipt cannot substitute for
that observation in takeover, and a backend-idle observation alone cannot prove
a successful apply. Schemas distinguish these two evidence kinds explicitly.
Only `verified` is releasable after a write; negative/unknown results are diagnostic,
not successful terminal authority. Consumers verify actual trusted producer run,
workflow code identity, source/target and generation, immutable binding, current
revocations and any required live state. A job may still be running its reporting
steps: do not require successful whole-run completion to recognize its already
verified critical operation, or create a circular wait. A later cancellation does
not manufacture verification or erase trusted completed-step evidence.

Create-only publication must read back the exact commit+canonical digest. Never
hand-create evidence as an operator shortcut. Git refs retain evidence until an
explicit separately reviewed retention policy exists; verbose Actions artifacts
retain their current policy. Freeze TTL never expires operation evidence. Existing and future janitors must
exclude `refs/db-release-evidence/*` from deletion, pruning and lease cleanup; add
a deletion-selector guard test before introducing the namespace. Normal
retry repeats the same exact payload/ref; changed payload refuses and investigates.
Receipt I/O retries are capped at three attempts/90 seconds total; exhausted or
unreadable readback retains protection and records the exact unresolved state.
This 90-second bound limits retries, not lock lifetime or SQL execution.

**B. Quarantine means retain the existing stage lease, not a new fake status.**
For an operation that may have launched SQL, missing verified terminal evidence,
nonzero apply, unknown writer termination or failed catalog/ledger verification
leaves the exact current lease in place. Its request/generation and immutable
prepared/write-intent history name the quarantine. A best-effort diagnostic may
be added, but failed diagnostic publication cannot accidentally clear protection.
Acquisition already refuses an occupied stage; no new quarantine admission service
is needed. This deliberately retains global production exclusion for ambiguous
writes. The incident is owned on #3779 and, for real releases, the original source
application issue; do not create a leftover-proof ticket.

`production-catalog-verification-recovery.yml` is the named reconciliation route
for production; preview uses its existing recovery/reconciliation route. Before
clearing, prove original/latest/later attempts terminal, actual writer termination,
exact target and complete live ledger/catalog against immutable source/allowlist.
Produce a verified recovery terminal receipt, then perform owner-qualified
mutex-safe release or one qualified generation takeover; never delete refs manually
or replay an applied migration. Native grace alone is not writer termination.

Crash before prepared receipt: no compliant writer has permission to launch;
prove trusted code/run/attempt ordering AND backend-idle through the 8c-qualified
collector chain before safe recovery release. That collector depends on 8b GO;
without qualified observation retain the lease with the named visibility blocker.
Terminal job status or absence of a write-intent alone never proves no writer.
Crash after prepared/write-intent but before terminal: re-derive the full result
from prepared baseline, immutable source/allowlist and fresh ledger/catalog and
termination observations; a missing verbose artifact is not an automatic refusal.
If the preimage/provenance cannot be reconstructed completely, retain quarantine
with an exact named blocker. Never guess the missing baseline or label it success.
Legacy operations without these records keep their conservative existing recovery
contract; new automatic clearing is not retroactively enabled for them.

**C. Cleanup decision table — every cancellation/failure boundary is specified.**

| Observed state, re-proven under current ownership | Required action |
|---|---|
| No lease acquired | No release or restoration of another run's statuses |
| Lease acquired; no write-intent; conclusively no launched writer | Owner-qualified release; clear only this run's revocations to pending |
| Write-intent exists; writer/SQL live or termination unknown | Retain exact lease/quarantine; never invoke ordinary always-release |
| Writer terminated; apply/ledger/catalog result failed or ambiguous | Retain lease; use the named reconciliation route, no automatic replay |
| Mandatory verification passed but terminal receipt absent/unreadable | Bound receipt retries; retain lease if not durably proven; reconstruction route on restart |
| Verified matching terminal receipt exists; reporting incomplete | Release exact owner/generation with readback; report-upload failure creates reporting obligation only |
| Release already absent after proved own successful release | Idempotent completion; do not touch any successor |
| Ref now names a successor/other generation | Refuse stale cleanup; never delete or restore authority for the successor |
| Release completed, then runner cancelled/upload failed | Preserve terminal evidence; missing reporting-complete receipt is an open reporting obligation on #3779 |
| Freeze status restoration fails | Keep an explicit retryable restoration obligation tied to run ID/attempt; pending only, never success |

Restoration remains per-run exact-description matching and cannot erase another
run's status change. A verified critical operation must not retain the mutation
lease for verbose report I/O. Failure to release the lease itself is a real release
failure, not an upload error; expose it and use supported ownership recovery.
Reporting obligations are derived by the existing read-only hygiene report from
terminal without reporting-complete and retained on the same issue checklist;
no new background scheduler or false "operation failed" claim.

**D. Bounded checkout drift policy is refuse-and-redispatch, not rebuild-under-hold.**
Any prepared/live ledger mismatch refuses before apply and releases only if the
cleanup table proves no writer started. The owning automatic-promotion controller
may redispatch once with the same approved source/allowlist inputs and existing
admission/risk/target checks. The NEW run collects its fresh live baseline; the
controller holds no database credential and never collects it itself. A second drift stops automatic retries,
records the causal competing run/source and owner on the same issue, and requires
bounded serialized requalification through the normal workflow. It does not create
a reservation while waiting, repeat a paid review automatically or loop forever.
Reusable tool installations and immutable selected content may be cached; live
ledger, target, approvals/revocation and required checks are always refreshed.
No SQL is rebuilt or retried under the hold merely to avoid a refusal.

Extend the existing `automatic-production-promotion` controller, currently
fire-and-forget, with a bounded dispatched-run observer (ten minutes within its
15-minute job budget, outside all database/protected-merge concurrency). Persist
its exact dispatch run ID/attempt. Before refusing for ledger drift, the child
emits `preapply_refusal=ledger_drift` and a strict, public-safe
`release-preapply-refusal.json` diagnostic artifact binding source, target,
allowlist, run/attempt and `write_started=false`; missing/tampered evidence means
unknown, not retry. The observer authenticates the unique artifact/digest and
trusted producing step, terminal conclusion and no-write cleanup evidence, then
uses the existing dispatch helper once with a bound `drift_retry=1` chain marker.
R2 cannot dispatch R3; concurrent observers share the native create-only attempt
record. A nonterminal run at the observer deadline is recorded on the same issue
with its exact owner/run; no cancellation, lock or speculative redispatch. The
calling coordinator resumes observation through the existing bounded waiter.
For the manual `dispatch-production-apply.mjs` path, that coordinator re-invokes
the same helper once after the same qualified drift refusal; the script does not
invent a database-bearing watcher. Other refusals never trigger this retry.

**E. Admission liveness is an explicit outcome, not an assumed side effect.**
After guarded queue admission releases its short merge protection, use the existing
bounded waiter/GitHub read helper to prove the exact PR head's current queue entry,
synthetic group head and live `merge_group` workflow runs. Initial observation
budget: five minutes, one follow-up bounded confirmation, maximum ten minutes;
this observes event delivery, not a requirement that CI finish within ten minutes.
A queued state or old candidate's green/failing runs is not a run-start proof.
No lock is retained during observation, event delay or runner queueing.

Missing starts produce an actionable same-issue alert with owner, current group
SHA, admission run, triggering identity class and last observation; do not turn
"no jobs" into "checks running". The supported repair is exactly one owner-bound
normal dequeue/requeue of THIS approved PR via the already-authorized authenticated
CLI/app identity, after rechecking head, current compatible main, durable approval,
required statuses, route/collisions/freeze and policy. No administrator merge,
status fabrication, workflow/check disablement or foreign queue removal. Verify
actual new-group jobs start. The existing calling coordinator runs `ai-pr-wait`
for PR-check observation only; it does not observe merge-queue entry or
merge-group status. Automatic callers use a separate trailing observation job
with no protected-job concurrency and no database credential, and that job
must cover merge-queue/merge-group state explicitly (step9). Never leave the guarded
job occupying its scheduling slot for this wait, including before step3 lands.

For repair, re-prove the exact PR/source and original admission-run chain under
the existing coordination mutex (not a shared release lease). Create and read
back one immutable `queue-repair` claim under that admission's merge-operation
evidence prefix before acting; extend §8.1A's strict suffix allowlist for it.
It binds PR/head/original admission/group and the repairing identity. All observers
share that key; an existing claim allows read-only outcome reconciliation, never
a second dequeue after an ambiguous attempt. Release the coordination mutex
before waiting on checks. Invoke GitHub's normal `dequeuePullRequest(input:{id})`
with the freshly read PR node ID; re-read head and all qualification inputs, then
use `gh pr merge --merge --match-head-commit <approved-head> --auto <PR>` through
the existing authorized identity/guarded route. Changed head or unclear dequeue
result parks the attempt for reconciliation; never remove a foreign PR or repeat
repair blindly. Record actual new-group/job identity in the same repair evidence. If re-admission needs fresh guarded authority, run
that workflow first; old status never substitutes for changed-head qualification.
If the configured dispatch identity cannot start downstream checks, keep the PR
parked and record the exact platform/identity blocker; no new credential or role
is authorized by this repair. Persistent event-identity configuration repair is
reviewed in the same tooling scope, never an undocumented credential substitution.

Preserve the observed #3779 publication trace: workflow38912779394 admitted a
candidate without runs; normal authenticated requeue created actual runs38913747108
and peers, and source7139d6e7 merged as66695385. This is an observed signature,
not proof of a permanent root cause. Add deterministic suppressed-event, stale-group,
duplicate-repair and concurrent-head-change tests before admission refactoring.

**F. Rollout/rollback order is fixed.** First land backward-compatible reader/parser
code and mutex-safe cleanup/acquisition identity outputs, with no new config field
or receipt producer yet. In particular upgrade the exact-key activation reader
before changing its record. Then land the compatible schemas/optional config field
(default false), and upgrade every writer/receipt producer and assertion; then qualify the fencing experiment and strict-tail shadow
mode; activate only reviewed, compatible routes with no old active writers and
all prior queue groups drained or revalidated. Use existing configuration and
trusted-main parsing, not a new switching service. Staged readers never imply
activation. Legacy records remain conservative and SHA-bound under the mutex.

Rollback stops new optional admissions first, finishes or reconciles active writes
without cancellation, drains/revalidates queued groups and waits for owned lanes
to be free. Disable the strict-tail exception and takeover automation before
reverting their consumers. Revert consumers before schema/receipt producers;
retain mutex-safe release and point-of-use safety fixes. Evidence and applied
ledger/migrations are never deleted/reverted. If in-flight drain cannot be proven,
rollback pauses with an exact owner; it cannot force release or run an old consumer
against a new unrecognized receipt. Preserve all failed/ambiguous evidence.


## 9. Ordered implementation

### Phase A — baseline and contracts (steps 1–2)

**1. Reconcile source, ownership and timings.** Start fresh `origin/main`; read
AGENTS, the current workflow router and this STATUS. On #3779 record explicit
acceptance for this bounded outcome; check #3781/#3397/#3919 and active PRs for
shared-file owners. Coordinate edits rather than rewriting another branch. Use
the existing `queue-hygiene-report.mjs` collector and Actions step/run evidence
to distinguish queued, preparing, locked, applying, verifying, reporting and
recovered states; `throughput-report.mjs` formats collected data only, while
`runner-lanes.mjs` only routes runner labels. Extend the existing report with run/attempt, stage kind, owner, generation, source/manifest digests and
acquire/release times; missing times are unknown, not zero. Save public-safe baseline
under `docs/verification/shared-release-holds/`; raw logs remain private.
**Gate:** complete timelines from available recent normal/failed runs reproduce
held time independently; every evidence gap is named. No resource is acquired.

**2. Implement the locked receipt contract in §8.1 A–C.** Extend existing release
artifacts consumed by `production_business_risk_gate.py`,
`production_apply_review_evidence.py`,
`check-main-tip-freshness.mjs` and lane admission; create a single bounded helper
`scripts/lib/release-hold-evidence.mjs` only if no shared helper already owns it.
Preparation binds repo, PR, exact head/base, policy/tool/sidecar digests, ordered
migration allowlist and contents, target identity, producer run/attempt, review
inputs and expected ledger. It grants no write authority. The terminal receipt
binds lease owner/generation, actual target, before/after ledgers, applied contents,
verification result and the path-specific completion/termination evidence in §8.1A. Strict schemas reject unknown
fields/versions. Write the minimal durable receipt through §8.1A's chosen immutable coordination
Git transport and read it back before releasing; do not invent an unsigned
local JSON as authority. Dry-run paths must not create refs or receipts.
**Gate:** named adversarial tests below pass; tampered or cross-run evidence refuses.
Dependency: step 1. Cut point: baseline/contracts review; re-read phases B–D.

### Phase B — shorten occupancy (steps 3–5, with 8a prerequisite)

Execute independently specified step8a after step2 and BEFORE steps4–5. Its
backward-compatible release/identity work does not depend on step6, 8b or 8c.
Step3 remains independently buildable after step1. Numbering groups the recovery
family, not a requirement to postpone its foundational safety work until phaseC.

**3. Split merge preparation from the protected merge job.** In
`.github/workflows/guarded-migration-merge.yml`, remove global scheduling from the
preparation stage; retain per-request cancellation rules and bounded protected-job
serialization. Keep native merge lease acquisition as the mutation authority,
not GitHub concurrency. Before acquisition: the actual checkout/setup steps, trusted-source validation, applicability/required-check preflight and existing quota wait. The current merge workflow has no long test suite or static review-packet construction to move; do not invent them. Preparatory job outputs are only exact candidate/base identities and diagnostic results, never transferable write authority. Under acquisition: freshly re-prove
exact candidate, compatible main, effective check authority, reviews/refusals,
claims/collisions, dependency closure, freeze and queue mode; then authorize and
admit/merge. A waiting prep cannot occupy the protected-job queue. A queued PR's
old authorization must not bypass later freeze/dependency checks.
**Gate:** `preparation_wait_does_not_block_independent_merge` and
`simultaneous_merges_admit_one_writer` pass; a real ready independent change
progresses while another request is preparing, with acquire/release evidence.
Dependency: step 1 and existing proofs; step 3 needs no new authoritative preparation artifact and can proceed independently of the new receipt schema. Sequence overlapping #3779 work, never rebuild it blindly.

**4. Move production and preview setup before their exclusive stages, with §8.1 D drift policy.** In
`.github/workflows/shared-supabase-migrations.yml`, move CLI/client qualification,
bounded checkout construction, immutable artifact resolution and static risk
preparation before `production_lock`. Inspect preview acquisition and
`preview-ledger-orphan-reconciliation.yml` similarly; mutate their shared preview
only under its existing lock. Do not hoist credential-bearing writes or mutable
catalog/ledger assertions outside protection and call them fresh. After acquiring:
assert owner/generation, re-prove actual target, selected content/policy,
compatible source, live ledger, approval/risk and dependencies, run the required
fresh bounded dry-run, apply and verify. Reuse preinstalled tools but fail before
acquisition if missing. Repeat only live-state-dependent work under the hold. Record the actual psql version
in preparation; approval/environment waiting is already outside the job-level hold,
so do not claim a new reviewer-wait optimization.
**Gate:** `tool_setup_precedes_stage_acquisition`,
`ledger_drift_after_preparation_refuses` and target/approval-race tests pass;
actual run shows tool setup/download before acquisition; existing approval and
environment waits remain outside the hold, without claiming newly removed review work.
Dependency: steps 2 and 8a; steps 3–4 can be developed independently only if owners and
files do not collide, with one serialized integrator for shared manager changes.

**5. Implement §8.1 B–C cleanup and early release.** Reorder
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
Dependencies: steps 2, 4 and 8a. Cut point: review and accept short-hold behavior
before introducing narrower admission or recovery.

### Phase C — narrow scope and recover safely (steps 6–8)

**6. Adopt #4039's strict early-freeze exception; retain production-held blocking.**
Do not implement a new `release-independence.mjs`. Extend the existing
`check-main-tip-freshness.mjs` with the single `promotionProseTail` strict mode
specified in #4039 §9.2. Ordinary documents/fast-CI classifiers remain unchanged
for their original callers; they are not authority for this exception. The
strict predicate is the intersection of inert content, complete ancestry/tree
proof, unchanged producer/runtime closure and fresh evidence/authority.

Stage-one allows only regular, non-executable `.md`/`.markdown` prose that is not
agent instruction or executable-consumed input. Explicitly deny `.txt`, `.rst`,
`.agent` evidence, tests, policy/config/SQL, instructions, symlinks, mode changes,
renames/deletions and unknown paths. In particular `supabase/tests/ci-quarantine.txt`
refuses. Broader formats/maintenance/SQL are not silently inferred as independent;
they need a later explicit reviewed extension. Existing reviewed #4039 benefit and
binding gates remain prerequisites; insufficient benefit means HOLD, not feature work.

The selected architecture is **revoke all existing merge authority, then freshly
re-admit strictly eligible prose during the early qualification freeze only**.
Every merge still refuses while the actual production lease exists. This is an
explicit scope correction: it shortens the long pre-apply source freeze's impact;
it does not permit merges during the exclusive database operation. The applicable
adversarial test is `independent_documentation_progresses_during_early_freeze`;
`production_held_blocks_even_inert_prose` must remain green. No concurrent applies.

Use #4039 §9.3's complete caller matrix, the existing producer closure from
`production_business_risk_gate.py` (`PREVIEW_PRODUCER_PATHS` and runtime-data dirs),
and `target-queue-identity.mjs` manifest helpers. Reconcile staged
`exclusive-policy.mjs`/#3781 before wiring it. Required consumers: merge acquisition;
repository-maintenance authorization; actual queue-group validation and final
`recheckQueueInterlock`; preview-rehearsal acquisition; qualification;
`dispatch-production-apply.mjs`; production acquisition;
`production-apply-review-evidence.yml`; `production_apply_review_evidence.py`;
`production-catalog-verification-recovery.yml`; producer/risk checks; train
candidate authorization, dispatch and partial recovery. Each consumes the same
strict predicate WHEN the recognized, activated early qualification freeze exists,
with fixed source S, ordered migration versions V, producer/policy identity and
candidate attempt; main T may advance only through the verified strict prose
delta. Never substitute T for approved S. Explicitly change production acquisition
from exact `metadata.headSha === mainSha` to this strict-tail proof ONLY in that
qualified early-freeze case, with final recheck under the mutex. Outside it retain
the current acquisition exact-match rule and each caller's existing freshness
semantics. Name the workflow consumers explicitly: all production
`check-main-tip-freshness.mjs --production` gates in
`shared-supabase-migrations.yml` select the same strict mode during that freeze;
otherwise preserve their current production-inert mode. No-freeze flows must not
newly refuse previously tolerated workflow inputs. Preview-recovery acquisition
is intentionally outside this exception and retains its existing exact target/
source rules; preview-rehearsal is covered as #4039 specifies.

Preserve #4039's two-sided train/candidate exclusion under the existing mutex,
complete generation/history proof on both REST and Git readers, single-member
queue constraint, run/attempt-bound freeze identity, pending-only restoration,
and fresh final group/head/generation rechecks. Legacy/unknown freeze records
retain global blocking. The activation configuration is the existing
`config/production-risk-policy-activation.json`, extended with a strict-schema,
default-false `strict_promotion_prose_tail` field. FIRST land compatible reader
code: `production_business_risk_gate.py::load_activation` currently validates an
exact key set, so accept exactly the original valid schema OR that schema plus
one boolean field; preserve all existing hash/identity/active checks and reject
all other extra fields. Missing field means false/legacy. Inventory and upgrade
all readers, retain unchanged config bytes until old running workflow versions
have drained, THEN add the field as false. Test old-record/new-reader acceptance,
new-record/new-reader acceptance, old-reader/new-record refusal and unknown-field
refusal. Shadow comparison without admission follows compatible deployment,
then activate only from the reviewed merged workflow version after lane/queue
reconciliation. An unknown schema or mixed writer version refuses activation.
No new authority namespace or scheduler is introduced for narrowing.

**Gate:** #4039's binding/benefit gate; complete caller/closure coverage tests;
`early_freeze_strict_predicate_refuses_txt_evidence_and_instructions`,
`production_held_blocks_even_inert_prose`,
`queued_candidate_revalidates_after_freeze`,
`train_candidate_activation_has_one_winner`, and
`independent_documentation_progresses_during_early_freeze`, followed by a genuine
eligible prose event. All dependency and stale-authority negatives still refuse.
Dependencies: phase-B acceptance and #4039 gate; step 7 and step 8a need not wait
for this conditional feature.

**7. Detect stalls read-only.** Host observation in `queue-hygiene-report.mjs` and its existing read-only scheduled workflow; extend the pure throughput formatter only for presentation. Do not treat `runner-lanes.mjs` as a lease scheduler. Extend
`scripts/lib/exclusive-lease.mjs`, not a new janitor. Report stage, exact holder,
generation, job/run/attempt, phase, last verified activity, measured held time and
reason. Separate slow-but-live from terminal-run-with-unknown-writer and safely
recoverable. Activity is the lease acquisition timestamp plus freshly read owning run/job/latest-attempt state, not a new heartbeat. Capture preparation/held/apply/verify phase from real workflow step records, retaining unknowns. Establish per-stage thresholds from the pre-registered step1 sample: report p95 and sample count; the assigned technical reviewer accepts a threshold only when the sample covers a legitimate full run. With insufficient samples, show age/liveness without a timeout verdict. Threshold alerts nominate investigation only. Use existing watcher
wakeups; do not poll or auto-recover based on age. Missing APIs, clock skew or
truncated data yield unknown, never free. Preserve original reviewer/object claims.
**Gate:** `old_live_holder_is_not_recoverable`,
`unknown_run_or_writer_is_unknown` and `reporting_is_read_only` pass. Step 7 can
follow step 2 independently of step 6, with no manager edit collision.

**8. Execute three separate recovery deliverables, not an assumed fence.**

**8a — buildable ownership safety first (after step2, before steps4–5).** Route every `--release-*` CLI branch
through the existing `releaseExclusive` function under the existing coordination
mutex; remove the earlier direct `releaseOwnedRef` CLI fast path. All writers
which replace or delete these lease refs must use that same mutex. Preserve the
recognized lease header and schema. Acquisition already returns holder ID and
generation: expose and retain both as workflow outputs alongside `owner_sha`.
Modern workflow release/assert calls supply `--holder-id` and `--generation`;
legacy SHA callers remain accepted only by resolving the current lease and exact
SHA under the mutex. A legacy lease cannot be taken over automatically or upgraded
implicitly. An absent ref releases idempotently; an ownership/generation change
refuses without touching the successor. Re-read ownership immediately before the
mutation under the mutex and prove absence/readback; do not equate a different
ref SHA with proof we deleted our own lease.

Convert all five existing release sites: guarded merge, merge-queue-gate,
preview recovery/reconciliation, shared preview, shared production. Add point-of-use
`--assert-exclusive` before each mutation, sourced from acquisition outputs:
preview and production `supabase db push`, atomic apply, preview-ledger
reconciliation apply, and protected final merge/queue authorization. Assertions
protect against a resumed old job before it launches another command; they do
not claim to stop an SQL statement already running. Historical evidence recovery
that writes no database is explicitly excluded from SQL-writer fencing.

First land backward-compatible mutex-safe release/parser and outputs; then upgrade
all workflow callers/asserts. Keep existing schema/header and SHA callers working
through the locked adapter. Before enabling recovery/strict modern requirements,
prove no old active writer/attempt remains and revalidate queued candidates; never
activate mixed unfenced/new writers. This safety correction does not authorize
any foreign takeover or new SQL replay.
**Gate:** `release_recovery_interleaving_preserves_successor`,
`legacy_sha_release_is_serialized_and_owner_bound`,
`every_mutating_workflow_asserts_acquired_identity`, plus old/new caller fixtures.

**8b — explicit isolated research gate, before any takeover automation.** Inventory
the actual CLI, atomic psql, preview-reconciliation and train writer paths. Verify
connection count, backend identity and session pinning through the configured
pooler; prove which connection actually executes every SQL statement. A separate
psql coordinator lock does not fence an opaque CLI child's connection. Raw migration
SQL must not be able to drop/reassign the fence; either enforce that boundary or
fail qualification. Test cancellation with a still-running SQL statement, network
loss, connection replacement, a revived runner and a lock-unlock attempt in the
migration itself. No production fault injection or new schema/credential is
allowed by the experiment. Reuse the disposable database test harness.

The report must answer GO/NO-GO for each writer type, citing real backend/session
observations and adversarial tests. CLI support is presently unproved and likely
requires different plumbing; no "same connection" claim is accepted from a probe
connection. If any active writer path cannot qualify, automated takeover stays
unactivated and that outcome remains open. A separate, reviewed design is required
for different plumbing; never silently replace the migration engine or weaken a
claim to mark this step complete.
**Gate:** `separate_probe_connection_does_not_authorize_writer`,
`pooler_backend_change_invalidates_fence`, `migration_cannot_unlock_runtime_fence`,
`cancelled_runner_with_live_sql_blocks_recovery`, with an actual isolated report.

**8c — only qualified recovery.** Keep `recover-exclusive-db-lane.yml` free of
production secrets and database reads. Add termination/reconciliation proof
collection to the existing production catalog-recovery workflow, behind its
existing target/environment/technical-review boundaries; preview uses its existing
qualified preview recovery route. The collector must correlate trusted attempt,
actual writer/backend identities, prepared/write-intent receipts and current
ledger/catalog. Unknown/insufficient database visibility refuses; no unreviewed
new credential privilege. The collector emits a bound immutable observation,
not takeover authority. The native manager independently validates its producer,
exact target/run/attempt/generation and current revocation state.

Before replacement, re-read the lease, latest original and later runs/attempts,
writer-termination and reconciliation evidence under the mutex; the original
current `recoverExclusive` reads run status outside the mutex, so this must be
fixed as part of 8c. Bound the under-mutex read/revalidation section to 30 seconds
and two attempts per API read within that total, using native request deadlines;
no sleep, artifact download, SQL, report upload or long polling under the mutex.
Prefetch immutable evidence outside it and validate its exact identity plus fresh
run/backend/lease observations inside. Timeout/incomplete reads refuse takeover,
release only the coordination mutex and retain the stage lease. Preserve grace as extra protection, never as termination proof.
Create one new generation with readback, with no applied migration replay. Before
any new write, the qualified runtime fence and current generation must both hold.
Old holders cannot assert, renew, release or write in the successor generation.
Receipt-absent recovery follows §8.1's reconstruction rules. If proof is missing,
retain the exact existing lease/quarantine and report a named owner on #3779.
**Gate:** `two_recoverers_only_one_wins`,
`stale_generation_cannot_write_or_release`,
`termination_evidence_changed_under_mutex_refuses`,
`partial_apply_is_reconciled_not_replayed`, and a controlled qualified recovery.
Dependencies: 8a first; 8b GO before 8c activation; steps 2/5/7 supply receipts,
cleanup and reporting. This plan is executable through an explicit research gate;
it does not claim the automatic recovery design has already been proven feasible.

### Phase D — integration, landing and acceptance (steps 9–10)

**9. Integrate operating instructions and measurement, including §8.1 E admission liveness and F rollout/rollback.** Update existing
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
`scripts/check-main-tip-freshness.test.mjs` (extend its strict-mode cases) and
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
| Proposed independent PR | Strict prose during early freeze, never production-held | `independent_documentation_progresses_during_early_freeze` |
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
| Release/recovery | Old cleanup races successor generation | `release_recovery_interleaving_preserves_successor` |
| Legacy caller | Old SHA adapter races modern holder | `legacy_sha_release_is_serialized_and_owner_bound` |
| Writer invocation | Acquired holder/generation not passed to actual write | `every_mutating_workflow_asserts_acquired_identity` |
| Receipt store | Terminal write fails/readback differs, cancellation after apply | `receipt_failure_preserves_quarantine_and_reconstructs_without_replay` |
| Pooler/session | Backend changes or migration attempts unlock | `pooler_backend_change_invalidates_fence`; `migration_cannot_unlock_runtime_fence` |
| Termination proof | Writer status changes after outside-mutex qualification | `termination_evidence_changed_under_mutex_refuses` |
| Freeze predicate | `.txt`, `.agent`, tests, instructions masquerade as prose | `early_freeze_strict_predicate_refuses_txt_evidence_and_instructions` |
| Production lease | Inert prose otherwise qualifies | `production_held_blocks_even_inert_prose` |
| Train state | Truncated history or authorize/dispatch races candidate | `train_listing_incomplete_or_malformed_refuses_candidate`; `train_candidate_activation_has_one_winner` |
| Queue event | Admission succeeds, exact group has no started checks | `admission_without_group_jobs_alerts_and_requeues_once` |
| Queue repair | Head changes or another owner already repaired | `queue_repair_revalidates_head_and_never_double_requeues` |
| Ledger drift | Two consecutive stale preparations | `second_ledger_drift_stops_automatic_redispatch` |
| Evidence deletion | Janitor selector includes audit namespace | `release_evidence_namespace_is_never_pruned` |
| Activation reader | New optional field reaches old exact-key reader | `activation_reader_precedes_config_extension` |
| Receipt proof kind | Success command exit reused as backend termination | `success_receipt_does_not_authorize_backend_takeover` |
| Pre-receipt crash | Terminal job but no qualified backend observation | `absent_prepared_receipt_retains_lease_without_backend_proof` |
| Recovery reads | Under-mutex API exceeds budget | `recovery_read_deadline_retains_stage_lease` |
| Drift observer | Missing marker, duplicate observer or third dispatch | `drift_redispatch_requires_bound_refusal_and_one_attempt` |
| Freshness modes | No-freeze caller or preview recovery accidentally changes | `strict_tail_is_freeze_conditional_and_preserves_legacy_modes` |
| Rollout | Old writer active / old consumer sees new schema | `mixed_version_writer_blocks_activation_and_rollback` |
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
| Acquire later | Actual merge/production/preview timelines show tool setup/download before acquisition and preserve approval/environment waits already outside it; live-state checks still run under protection. |
| Release sooner | Verified terminal receipt precedes release; failed verbose upload does not retain a hold or mark evidence complete; required DB verification never runs after unsafe release. |
| Narrow scope | Strict inert prose progresses during qualified EARLY freeze; all merges still refuse during production-held critical work. #4039 benefit/binding gates and complete callers pass. Unknown, evidence/test/instruction/SQL movement still blocks. |
| Recover safely | Controlled recovery proves old writer termination and generation fencing, including revived runner/live SQL negatives; ambiguous apply remains quarantined. |
| Throughput | Re-derivable before/after sample sizes and median/p95 held time are reported by stage. No invented speed percentage; deterministic fixtures prove avoidable prep/upload occupancy is zero. Small live samples are labeled; do not claim statistical improvement without evidence. |
| Delivery | Owned commits pushed, required CI/reviews green, normal guarded merges, merged workflow SHA executed, direct live evidence linked on #3779, STATUS truthful, router/docs current, zero session-owned abandoned reservations. |

**Risks/rollback:** setup reordering can admit stale evidence; fresh protected-boundary
checks prevent that. Early release can lose recoverability; minimal durable terminal
receipt and quarantine protect it. Scope reduction can miss indirect dependencies;
unknown always serializes. Recovery can create two writers; writer termination and
experimentally qualified runtime fencing are mandatory; do not assume opaque CLI same-connection support. Revert the scoped implementation through a
reviewed PR to the prior conservative admission/order, preserve immutable evidence
and leases, and reconcile in-flight work before switching. Never roll back by
force-pushing, deleting claims, cancelling an unverified foreign writer or running
ad hoc SQL. A failed apply follows existing recovery; do not automatically rerun it.

**Engineering qualification still required:** the receipt store, cleanup state machine, strict prose predicate and caller list are now chosen in §8.1/step6. Step8b must experimentally qualify actual writer connections, pooler behavior, unlock resistance and termination visibility. Step1 inventories legacy callers; closure coverage adopts the existing reviewed #4039/producer manifest. These are evidence gates, not unmade architecture choices or questions delegated to Albert. If the existing runtime cannot provide trustworthy
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

1. **Can a brand-new session execute the specified design and qualification gates without chat or owner questions? Yes.** §§1–8
supply purpose, baseline, meanings and exclusions; §9 gives ordered changes and
cut points; §10 names hostile cases; §§11–13 state access, gates and acceptance.
Source drift is handled by step 1, not assumed away. Automatic recovery is expressly research-gated (8b); this is not a claim that all writer types already support fencing. No missing business decision.
2. **Does it carry relevant background, nuance and rejected paths? Yes.** §§3–8
preserve the trigger, distinct locks, scheduling bottleneck, existing improvements,
terminal-writer caveat and all rejected shortcuts. §4 explicitly excludes old
OrderList/reviewer work; no lost context becomes accidental implementation scope.
3. **Can it guide a correct judgment if a step is wrong? Yes.** §1 makes the business
goal controlling; §8 locks safety invariants, and §§9/13 require stopping when
independence or fencing cannot be proven rather than weakening the capability.

Audit passed after correcting two drafting gaps: the workflow scheduling bottleneck
must be addressed in addition to the explicit lock, and a durable terminal receipt
must precede early unlock rather than relying on a local report. The subsequent Muse critique correctly found missing design decisions; §8.1 and revised steps6–8 supersede the earlier readiness assertion. Publication safety, design completeness, experimental GO and live acceptance are separate gates. Implementation and live acceptance remain unstarted.
