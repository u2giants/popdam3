---
issue: 4414
status: OPEN
owner: codex/reviewer-assignment-hold-plan
---

# Reviewer-assignment holds — plan and independent review

## 0. Business decisions only the owner can make

None. Albert requested a plan and independent review. Keep assignment safety,
unlimited provider concurrency and existing technical reviewer gates. Do not ask
him to approve technical actions or revisit settled provider-concurrency policy.
Runtime implementation is not completed or authorized by publication of this plan.

## 1. Application

[popcre/shared-db](https://github.com/popcre/shared-db) coordinates shared database
structure and review/claim tooling for POP apps. This outcome concerns GitHub/Node
coordination, not Supabase structure, application rows, production or a browser UI.

## 2. Goal and trigger

Protect assignment records briefly while other sessions prepare and run independent
reviews. Albert questioned whether the reviewer lock exists to keep two sessions
from using one provider; current policy allows parallel reviews by the same provider.
He asked for a plan and reviewer feedback, not an immediate runtime change.

Complete build specification: [implementation plan](../plan_reviewer_assignment_hold_reduction.md).
Intended portable publication link: [plan on publication branch](https://github.com/popcre/shared-db/blob/codex/reviewer-assignment-hold-plan/plan_reviewer_assignment_hold_reduction.md).
Read its STATUS first and start step1; all seven implementation rows remain open.

## 3. Current state

Baseline [main b31e17c0](https://github.com/popcre/shared-db/commit/b31e17c02194c6006a1bd256d6154a324a5114d7).
The plan, this handoff and literal discovery links are newly prepared prose.
GLM completed a substantive native plan review on October 18, 2026, 9:39 AM EDT:
APPROVE at source `12dcc287`, with four low findings now corrected. Final-check
and push/PR/merge are not yet verified; consult
[owning issue #4414](https://github.com/popcre/shared-db/issues/4414) for actual
publication/review receipts. No runtime source, schema, ref format or credential
was changed; no shared release stage or structural object claim was acquired.

## 4. Dead ends and rejected shortcuts

Do not remove assignment serialization, reserve one provider at a time, rename
just the draw mutex, move all fresh checks outside, raise budgets, ignore timeout
or retry an ambiguous mutation. Expiry never proves a holder stopped. Existing
[API-budget plan](https://github.com/popcre/shared-db/blob/main/plan_reviewer_assignment_api_budget.md)
is completed history, not work to repeat. The broader old Muse release-hold debate
is a different workstream; its fenced continuation is not replaced by this review.

## 5. Findings

[Current workflow](https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md)
permits unlimited review concurrency. The shared author-acquisition mutex is used
for short reviewer bookkeeping; actual provider execution follows assignment.
Current transport already has finite child timeouts and one attempt while locked;
aggregate critical-section time and today's delay attribution remain unmeasured.
The plan's §5 carries pinned source locations; §6 explains separate admission cost,
mutable-state revalidation, atomic record binding and cleanup ambiguity.

## 6. Exact next steps

For the publishing session: obtain exact-head final-check after the accepted
low findings and root audit corrections, commit/push/PR/normal merge, and record exact report/source/
merge evidence on #4414. Never infer acceptance from a stale or partial response.
For an authorized implementing session: plan step1 inventories all callers and
related owners; step2 derives timing/budgets; steps3–5 implement/test safe boundaries;
steps6–7 govern landing and actual normal-use proof. Every step names a gate.

## 7. Constraints

No database mutation, object claim, stage lease, credential or host change. Keep
all required checks/review independence, unlimited concurrency, exact record state,
owner-qualified cleanup and native request budgets. Keep unrelated worktrees and
handoffs. Stage only owned prose. Root HANDOFF remains its static pointer.

## 8. Access and environment

Git/gh and Node/task tooling verified for planning on hetz. No database secret,
browser login or production SSH is needed. Native review tools supply their own
protected provider access. [Plan §12](https://github.com/popcre/shared-db/blob/codex/reviewer-assignment-hold-plan/plan_reviewer_assignment_hold_reduction.md#12-access-and-environment)
sets revalidation requirements. Private raw reports remain outside public commits.

## 9. Risks, owner sweep and audit

No current measurement proves lock duration or today's causal blocker; do not
invent improvement percentages. Shared-lock separation is deliberately excluded
without cross-domain writer/recovery proof. The existing safe brief transaction
is preserved while slow avoidable work moves outside.

Audit: newcomer continuation is supported by§§1–3/6 and the complete linked plan;
all current context/dead ends are in§§4–5/9; execution/gates/access/risks are in
§§6–9 and plan §§8–13. A line-by-line owner-question sweep found no business choice:
all technical evidence/approval requirements have named native gates, and§0 says
None. Publication completion is distinct from still-open runtime implementation.

Posted by Codex chat 01a144d8-b318-7ed0-af97-e852be49d231 on hetz

Publication branch links above are intended pre-merge locations. After merge use
[main plan](https://github.com/popcre/shared-db/blob/main/plan_reviewer_assignment_hold_reduction.md)
and the actual merge/source links recorded on #4414; do not infer a branch still
exists. All implementation/live-proof acceptance remains on the same issue.
