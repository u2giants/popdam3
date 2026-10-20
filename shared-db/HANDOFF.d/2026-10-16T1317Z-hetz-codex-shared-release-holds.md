---
issue: 3779
status: OPEN
owner: codex/shared-release-holds-plan
---

# Shared release holds: planning publication only

## 0. Business decisions only the owner can make

None. Albert requested a plan for all four hold-reduction improvements and its
publication to GitHub. Technical implementation/review choices go to the assigned
AI reviewer, not Albert. Do not ask again whether to include narrower blocking or
safe recovery. Both are required. Do not resume unrelated OrderList/reviewer work.

Already settled October 16, 2026: this chat concerns shared release holds only;
no safety reduction, no automatic lock stealing, no implementation in this publication.

## 1. What this application is

[popcre/shared-db](https://github.com/popcre/shared-db) is POP Creations' canonical
shared database structure and coordination repository, serving CRM, DAM, PIM and
DesignFlow. Node.js/Python tools and GitHub Actions manage reviewed migration,
preview, guarded merge and production-promotion operations. Production is the
Virginia Supabase project `qsllyeztdwjgirsysgai`; preview comes from the configured
repository variable, never a remembered ID. No database mutation is needed for planning.

## 2. Goal and trigger

Reduce how long unrelated work is blocked by shared database releases, preserving
all verification and single-writer safeguards. Albert asked to implement a plan
for all four recommendations: acquire later, release sooner, narrow blocking on
proven independence, and recover genuinely stalled holders safely.

The complete build specification is the [linked implementation plan](../plan_shared_release_hold_reduction.md).
Read its STATUS first; it has all 13 sections, ten steps, named adversarial tests,
phase boundaries, current source evidence, delivery requirements and self-audit.

## 3. Current state

Original planning publication merged through [PR4393](https://github.com/popcre/shared-db/pull/4393)
as `6669538515a8a5813887e9fa98eb422682f9ca4b`. This revision changes the plan,
this same owned handoff and the linked debate ledger only. Revision publication
is not yet verified; re-check GitHub before reporting it complete. No code
has changed, no release behavior is activated, no migration/deploy has occurred.
The plan's implementation STATUS remains all open after publication.

Investigation baseline: [protected main 778dc192](https://github.com/popcre/shared-db/commit/778dc192f4a0ede1889c6a595b08b47425657cd1).
Existing [#3779](https://github.com/popcre/shared-db/issues/3779) owns the release
preparation outcome. This plan proposes coordinated extension of that outcome,
not ownership of other sessions' branches. Check live activity before implementation.

## 4. Dead ends and rejected shortcuts

Do not shorten TTL and steal a live writer's lock; remove production serialization;
restore statuses to success; release before catalog/ledger verification; trust a
local report as durable recovery authority; or classify independence by table names
alone. All are rejected, not implementation options. Moving only acquisition is
insufficient because scheduling itself can serialize preparation. A GitHub job
cancellation is not proof that SQL or a child operation stopped. Nothing was
experimentally deployed or deliberately failed in production during planning.

## 5. Findings and evidence

The [production workflow](https://github.com/popcre/shared-db/blob/778dc192f4a0ede1889c6a595b08b47425657cd1/.github/workflows/shared-supabase-migrations.yml#L1801)
acquires before tool installation and bounded preparation, and uploads verbose
artifacts before releasing. The [guarded merge workflow](https://github.com/popcre/shared-db/blob/778dc192f4a0ede1889c6a595b08b47425657cd1/.github/workflows/guarded-migration-merge.yml#L25)
has a repository-wide scheduling group even outside the explicit lock.

The [existing recovery evaluator](https://github.com/popcre/shared-db/blob/778dc192f4a0ede1889c6a595b08b47425657cd1/scripts/lib/exclusive-lease.mjs#L164)
already checks terminal runs, attempts and grace. Extend it; do not replace with
expiry-only recovery. The [lease map](https://github.com/popcre/shared-db/blob/778dc192f4a0ede1889c6a595b08b47425657cd1/scripts/lib/lanes/queue-routing.mjs#L15)
has separate merge/production stages and one shared preview stage. There is no
single lock whose deletion safely frees everything. Full analysis: plan §§5–8.

## 6. Exact next steps

1. Verify publication state from GitHub, then start at plan step 1 on fresh upstream
in a new isolated worktree. Gate: exact current source and overlapping owners recorded.
2. Reconcile [#3779](https://github.com/popcre/shared-db/issues/3779),
[#3781](https://github.com/popcre/shared-db/issues/3781),
[#3397](https://github.com/popcre/shared-db/issues/3397) and
[#3919](https://github.com/popcre/shared-db/issues/3919). Record bounded acceptance
on the same tracker, without adopting others' unfinished outcomes. Gate: no duplicate
work or shared-file collision.
3. Execute plan phases A–D in order; each step has files, behavior, dependencies and
verification gates. Gate: named negative/race tests pass before activating its route.
4. Preserve same-issue live-proof obligations and re-derive actual held times.
Gate: all four outcomes accepted from real run/commit/test evidence, not merely code
landing. Update the plan STATUS as work occurs. Keep it open if runtime acceptance
is unavailable; never create a leftover-proof issue or manufacture a production fault.

## 7. Constraints

No schema/app/provider changes in this planning scope. Single production writer,
shared-preview exclusion, target proof, exact-head review, claims, required checks,
freeze and owner-qualified generation fencing remain mandatory. Unknown dependency
or writer termination means refusal. Never hand-author native authority or release
foreign reservations. Use normal PR/guarded queue, no admin bypass or force push.
All public times are labeled EDT/EST; no private rows, credentials or raw traffic
in Git. No other session's handoff was edited; root handoff remains unchanged.

## 8. Access and environment

Git/gh were authenticated for the repository on `hetz`; Node/Python/reviewed task
tooling were available. Recheck current access without exposing tokens. Secrets,
if later required, remain in the existing workflow stores and 1Password vault
`vibe_coding`, resolved via the repository credential runbook and dedicated skill.
There is no browser login or production SSH step. The
[plan §12](https://github.com/popcre/shared-db/blob/codex/shared-release-holds-plan/plan_shared_release_hold_reduction.md#12-access-and-environment)
gives access boundaries; §10 gives exact local regressions.

## 9. Risks, questions and final audit

No outstanding business question. Receipt transport, cleanup, admission and
closure architecture are now chosen in the revised plan. Actual writer-connection
fencing remains experimentally unproved; step8b defines its GO/NO-GO criteria. If trustworthy fencing cannot be demonstrated,
keep safe recovery blocked; do not silently substitute auto-expiry.

Audit answers:
1. A newcomer can continue: §§1–3 locate purpose, baseline and complete plan; §6
names ordered actions and gates. No planning chat is needed.
2. Relevant context is preserved: §§4–5 carry rejected shortcuts, current behavior,
scheduling bottleneck, separate leases and existing recovery; the plan adds full detail.
3. Every execution category is covered: §§6–8 plus plan §§9–13 provide steps, tests,
authority, access, acceptance, rollback and ownership. No deployment is claimed.
4. Owner-question sweep passed: reading §§1–9 found no business choice requiring
Albert. All technical decisions use stated engineering criteria/reviewer gates;
§0 explicitly states none and preserves the settled scope.

Posted by Codex chat 01a144d8-b318-7ed0-af97-e852be49d231 on hetz

## Design revision after substantive Muse critique — October 16, 2026 EDT

The original plan publication merged as `66695385`. Muse subsequently found six
implementation-design blockers; safe publication was not feasibility approval.
The owner requested corrections and another Muse debate. Revised plan §8.1
chooses receipt/quarantine/cleanup, drift, event-liveness and rollout contracts;
step6 adopts #4039 without permitting merges under a production lease; step8
splits buildable safety fixes from an explicitly gated fencing experiment.
[Debate ledger](../docs/investigations/shared-release-holds-design-debate.md)
contains all finding dispositions, substantive disagreements and follow-up outcome.
Muse round2 completed at10:59 AM EDT over source `73e5f794`: all six original
blockers resolved, with a bounded new punch list. The plan and ledger now address
N1–N11, including reader-before-config rollout, freeze-conditional freshness,
8a dependency order, distinct termination evidence, bounded drift/event repair
and conservative crash cleanup. No runtime feature is implemented. Next gate:
same-session verification of these corrections, then exact-head publication review
and normal PR merge; all implementation/live acceptance remains open on #3779.



### Current state — refreshed October 20, 2026, 11:30 AM EDT

Revision branch `codex/shared-release-holds-design-revision` contains local owned
commits `73e5f794`, `d35663b7`, `3eda5c30` and `c6f5d8d0`. All three changed paths
are prose: plan, this handoff, debate ledger. Existing main publication `66695385`
remains authoritative until a normally approved revision lands.

The October 16 pre-provider failure was recovered through the supported path
(ai-devops [PR #1879](https://github.com/popcre/ai-devops/pull/1879), issue
[#1876](https://github.com/popcre/ai-devops/issues/1876)). Same-session Muse round-3
verification over `3eda5c30` completed and is recorded in the debate ledger:
N1–N11 present, draft publishable. Native exact-head publication approval and
normal PR merge remain the next gate. Runtime implementation remains entirely
open; this is not acceptance of any of the four optimizations. No stage lease is
held. Original blocker owner Codex chat `01a144d8-b318-7ed0-af97-e852be49d231`.

Posted by Codex chat 01a144d8-b318-7ed0-af97-e852be49d231 on hetz
