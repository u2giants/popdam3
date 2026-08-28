---
issue: 1767
status: OPEN
owner: codex/reviewer-lease-index-plan
---

# Reviewer assignment API-budget implementation handoff

Implementation plan: [`../plan_reviewer_assignment_api_budget.md`](../plan_reviewer_assignment_api_budget.md)

## 0. Decisions only the owner can make

None — nothing in this workstream currently needs Albert. Already settled on 2026-08-28: preserve all historical reviewer evidence; use one active lease per reviewer; fewer than 20 API calls with 10,000 historical assignments; check quota and budget before locking; clear leases on verdict, failure, moved head, merged/closed PR; and implement outside the structural orchestrator. Do not re-ask these.

If implementation would require more than 19 requests, deleting history, changing reviewer policy, weakening exact-head rules, or bypassing mutex cleanup, stop and put the entire conflict to Albert in one message.

## 1. What this application is

`u2giants/shared-db` owns shared-database structure and repository coordination. `scripts/manage-migration-author-lanes.mjs` assigns independent AI reviewers through GitHub refs and the authenticated local `gh` CLI. This task changes repository tooling only—no database, Supabase, preview, production, or application data.

## 2. What this planning session set out to do

Write a fresh-session implementation plan for the 2026-08-28 GitHub quota incident. Reviewer availability scanned permanent assignment history and multiplied each record into commit, PR, comment, and review reads, exhausting the shared 5,000-request/hour allowance. The goal is a bounded five-reviewer live index with strict quota/request controls and complete mutex cleanup.

## 3. Current state

Planning is complete; implementation has not started. Issue [#1767](https://github.com/u2giants/shared-db/issues/1767) is the repository-maintenance tracker. The complete build specification is `plan_reviewer_assignment_api_budget.md`; its STATUS rows are all open.

The current root cause is in `findBusyReviewers()`, which calls `listRefs(REVIEW_ASSIGNMENT_REF_PREFIX)` and then reads each assignment commit, PR, issue/PR comments, and PR reviews. `assignNextReviewer()` prepares a lock commit and acquires `MUTEX_REF` before bounded availability is known. `hasVerdictForHead()` has no operation cache. Permanent assignment/replacement/failure refs are correct evidence and must stay.

Planning files are on branch `codex/reviewer-lease-index-plan` in isolated worktree `C:\repos\shared-db-reviewer-lease-plan`. They are documentation only. No database, coordination ref, reviewer assignment, or orchestrator state was changed.

## 4. What did not work / rejected approaches

- Better pagination still scales with permanent history.
- Deleting/compacting history destroys audit evidence.
- Recent-only windows and TTLs can free a reviewer whose work is still live.
- The round-robin cursor cannot represent all active reviewers.
- Background cleanup adds quota use and eventual-consistency gaps.
- Silent continuation on unreadable quota/evidence can lock and then fail or misroute paid review.
- Cross-process caches become stale; cache only within one command.

## 5. Root causes and key findings

Availability uses an append-only archive as a live index. The scan cost grows with history and repeats identical PR/verdict reads. The bounded state is the reviewer roster: fixed refs under a new active prefix can cap live reads at five. Quota sufficiency and a lowest-boundary request counter are separate protections. Cleanup failure is itself a safety failure and must name exact guarded recovery evidence.

## 6. Exact next steps

1. Start a fresh isolated repository-maintenance session after verifying quota, current `origin/main`, issue #1767, and Git identity. **Worked when:** preflight passes without any orchestrator marker or historical scan.
2. Implement command-scoped request counting, cache, quota preflight, a maximum-19 budget, and pre-lock refusal. **Worked when:** low/unreadable quota and request 20 issue zero lock mutations.
3. Add one strict active lease per assignable reviewer and bounded batched reconciliation. **Worked when:** 10,000 history records do not change request count and the complete command stays below 20.
4. Update assignment/replacement transactions and release leases for verdict, failure, moved head, merged/closed PR. **Worked when:** state-machine and idempotency tests pass.
5. Inject failure at every GitHub boundary and centralize mutex finalization. **Worked when:** every row proves no owned leaked mutex, preserves a successor, or reports exact recovery ref/SHA.
6. Update docs/evidence, push, open and merge the PR after required CI, close #1767, update plan STATUS, and delete this handoff in the closing PR. **Worked when:** merge SHA is on `origin/main` and issue completion is proven.

Every file/function, test name, gate, rollback rule, and Definition of Done is specified in the linked plan. Re-read the whole plan before Step 1.

## 7. Constraints and gotchas

This is repository maintenance outside the structural orchestrator. Preserve dirty/linked worktrees. Stage only owned files. Do not scan live historical refs to test scale. Count pagination pages, retries, writes, and readbacks—not helper calls. Fail closed on partial/unreadable evidence. Preserve rotation, overflow, exact-head rules, and immutable history. Never delete a mutex after ownership changes. No secrets, licensed data, database writes, or production actions.

## 8. Access and environment

Use a new clean worktree from current `origin/main`, branch prefix `codex/`, Node.js, Git, and the authenticated local `gh` CLI. Target repository is `u2giants/shared-db`, branch `main`. Required identity is `Albert Hazan <u2giants@users.noreply.github.com>`. No secret retrieval, database credential, browser login, or test account is required.

## 9. Open questions and risks

GraphQL versus bounded REST and module extraction are implementation choices; select the simpler design that validates complete results and remains below 20 total calls. Main risks are missing a pre-cutover live review, partial GraphQL data, rollback contradictions, and stale-lease races. The plan provides cutover, fail-closed, failure-injection, and mutex-fencing mitigations. Safe rollback never restores the historical scan; it fails assignment closed while a forward fix is prepared.

## Handoff self-audit

1. **Fresh developer can continue without context: yes.** §§1–6 define the system, incident, code state, root cause, rejected paths, and exact gated steps.
2. **All planning-session knowledge is carried: yes.** §§3–5 and the linked 13-section plan preserve function-level evidence and locked design decisions.
3. **Every execution detail is included: yes.** §§6–9 plus the plan cover actions, tests, access, constraints, risks, rollback, shipping, and proof.
4. **Owner-decision sweep passes: yes.** §§1–9 contain no unresolved owner choice; all settled decisions and escalation boundaries are consolidated in §0.
