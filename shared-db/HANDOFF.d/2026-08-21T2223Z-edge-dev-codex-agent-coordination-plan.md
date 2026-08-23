---
issue: 1366
status: OPEN
owner: repo-maintenance/issue-1366
---

# Handoff — implement provider-neutral multi-agent database coordination hardening

## 0. Decisions only the owner can make

### Blocking

None now. The implementation can begin with Step 1 of the plan.

Two later actions may require Albert, but the implementation session must first exhaust its authenticated access and produce the exact evidence:

1. **GitHub branch-protection administration.** Recommendation: add only the exact existing `Orchestrator marker guard` and `Cancelled work guard` contexts while preserving every other field, especially `required_status_checks.strict: false`. This blocks completion of plan Step 1 only if the active authenticated identity lacks repository-admin permission.
2. ~~**A paid Supabase Branching requirement.**~~ **Resolved 2026-08-23:** Steps 7 and 8B are deferred to a follow-up issue, so no Supabase Branching decision is needed to finish this plan. Nothing is to be purchased or upgraded.

### A wrong guess is recoverable

None. Compatibility, conflict rules, and recovery proof are locked in the plan. Lease *timing* no longer exists as a concept: the 2026-08-23 revision removed heartbeats and lease durations entirely.

### Outside this workstream and currently unowned

None found.

### Already settled — do not re-ask

- **2026-08-21, Albert Hazan:** the shared-db orchestrator's only job is database structure and schema. Repository-maintenance work is not an orchestrator job.
- **2026-08-19, Albert Hazan, issue #1286:** keep `required_status_checks.strict: false` because forcing every branch current repeatedly restarted the full check suite and cost roughly 50 minutes per day. Reconsider only under issue #1286's measured failure criterion, outside this plan.
- The shared preview remains the final integration rehearsal.
- No concurrent `supabase db push` to one target.
- No Claude Agent Teams control plane.
- No TTL-only automatic lock expiry.
- **2026-08-23, GLM-5.3 review:** the apply-time advisory lock prevents two concurrent live applies; it does **not** close the dying-backend window, which is grace-bounded. Never claim the stronger guarantee. Author-claim renewal stays; only stage heartbeats were removed. Active author claims live in editable issue bodies and are a known unfixed limitation.
- **2026-08-23, Grok 4.6 review:** no heartbeats and no lease clock; liveness is a live GitHub run query. Contract authority is a Git ref, not an issue comment. One completion schema. An apply-time Postgres advisory lock is required. Steps 7/8B are deferred. Do not restore any of these from the 2026-08-21 text.
- The dispatcher publishes an agent's work contract to a create-if-absent Git ref before execution; the worker cannot widen it. This bounds widening and backdating; with one shared GitHub identity it does not prove publisher identity.
- Core coordination activation does not wait for the optional Supabase branch pilot.

If an owner decision becomes necessary, put the whole updated list to Albert in one message, not one item at a time.

## 1. What this application is

`u2giants/shared-db` is the source of truth for the shared Supabase database structure used by POP Creations applications. It stores SQL migrations, database contracts, coordination scripts, GitHub Actions, and the rules that prevent concurrent AI sessions from colliding.

The implementation specification is [`../plan_multi_agent_database_coordination_hardening.md`](../plan_multi_agent_database_coordination_hardening.md). Read its STATUS table **and its 2026-08-23 revision list** first, and do not re-research or re-plan completed steps.

**Code citations in that plan are function names, not line numbers.** The 2026-08-21 version carried six stale line numbers, three pointing into unrelated functions. Re-anchor with `grep -n "^export function <name>"` on current `origin/main` before editing anything.

## 2. What this session set out to do and why

Albert asked for a comprehensive implementation plan applying current Codex, Claude, Supabase, and distributed-locking guidance to this repository's multi-agent database workflow.

This session initially misrouted the plan to the shared-db orchestrator. Albert clarified that the orchestrator handles structure/schema only. The mistaken handover issue was closed, then issue #1366 was repurposed as the normal repository-maintenance implementation tracker and explicitly states the corrected ownership.

The first plan merged through PR #1367. Albert then asked Codex to run it by Claude and debate it out. After three adversarial rounds, both agreed the architecture is sound but the plan required three corrections: preserve the owner-authorized `strict: false` setting, make the dispatcher the pre-work contract authority, and decouple core activation from the optional Supabase pilot. The linked plan now includes those corrections and the rejected alternatives.

## 3. Current state

- Revised plan at `plan_multi_agent_database_coordination_hardening.md`.
- This handoff is the plan's required open-workstream registration.
- Tracking issue #1366 is OPEN, labeled `db-work`, with `work_type: repo-maintenance` and `route: repo-maintenance`.
- The first plan merged through PR #1367 as `563240c7832595d44e08952cfe31f44f1c252535`.
- The Claude/Codex review correction merged through PR #1368 as `4d2ad3c62d1b242d59740b9a0a2e1f53b73a06a6`.
- A second independent review by GLM-5.3 on 2026-08-23 checked Grok's corrections against the code and confirmed all twelve, then found eight internal contradictions the fast revision had left behind and one overclaimed guarantee. All were applied. Its report is at `.ai/reviews/glm-coordination-hardening-plan-review-20260823T150517Z.md` (git-ignored). Its verdict was APPROVE conditional on those fixes.
- An independent Grok 4.6 review on 2026-08-23 found the plan stale against `origin/main` and found two claimed guarantees undelivered. Twelve corrections were applied; see the plan's 2026-08-23 revision list. The review is saved at `.ai/reviews/grok-coordination-hardening-plan-review-20260823T133248Z-145771.md` (git-ignored) and cost $0.18.
- No database, preview, production, migration, application row, branch-protection setting, or secret was changed.
- The plan is not implemented. All STATUS rows are open.

## 4. Everything tried that did not work

1. **Incorrect orchestrator handover.** Issue #1366 was first opened as `HANDOVER: plan multi-agent database coordination hardening`. That was wrong because the orchestrator handles database structure/schema only. The issue was closed, the owner corrected the scope, and the issue was reopened as a repo-maintenance implementation tracker. Do not send it back to the orchestrator.
2. **First GitHub issue command used a long PowerShell here-string.** The command runner rejected it before GitHub received anything because quoting was ambiguous. The retry used an exact temporary body file and succeeded. No duplicate issue was created.
3. **A root `package.json` was assumed during test discovery.** This repository has no root `package.json`; tests run directly with `node --test`. Do not waste time looking for npm scripts.
4. **The first plan treated `strict: false` as unexplained drift.** Claude challenged the missing root-cause investigation. Live issue research found #1286, which records Albert's explicit throughput decision and exact reconsideration threshold. Do not restore strict mode from the old plan text or from older archived docs.
5. **Claude initially proposed new mutex, squash-merge, rate-limit, and stale-base machinery.** Repository inspection disproved those as missing controls: the atomic Git-ref mutex and squash ancestry code already exist; heartbeat volume is negligible; and guarded migration merge already rechecks current `main` twice. Do not duplicate them.
6. **Heartbeat-renewed exclusive leases (2026-08-21 design, removed 2026-08-23).** Renewal moves the exclusive ref's SHA, but `releaseOwnedRef` and every calling workflow release with the SHA captured at acquisition, so the first heartbeat would have made the lane permanently unreleasable. A heartbeat write outside `MUTEX_REF` could also overwrite an incremented generation. Do not reintroduce it.
7. **Issue comments as contract authority (2026-08-21 design, removed 2026-08-23).** Comments are editable and all sessions share one GitHub identity, so a comment cannot establish who dispatched work. Authority is now a create-if-absent ref.
8. **A mandatory `invalidates` event was considered.** It was rejected because a later forward migration does not make the earlier successful completion false, and semantic invalidation is domain-specific. The revised plan permits an advisory pointer only.

## 5. Root causes and key findings

- `NON_STRUCTURAL_EXITS` in `scripts/manage-migration-author-lanes.mjs` currently labels repo maintenance/documentation/security as `fork`, and `buildDynamicQueues` reports them to the orchestrator. That conflicts with the 2026-08-21 owner ruling and is Step 1's first correction.
- `parseQueueScope` has one flat `objects:` set; the `overlaps` comparison inside `buildDynamicQueues` cannot distinguish readers from writers.
- Dependencies in `buildDynamicQueues` are satisfied whenever their number is not open; there is no success proof or cycle validation.
- `scripts/check-pr-object-collisions.mjs` explicitly admits different-object semantic dependencies are invisible.
- Exclusive refs are declared in `EXCLUSIVE_REFS`; acquisition is `acquireExclusive`. They carry ownership but no generation or run-identity recovery metadata. Note `preview`, `preview-recovery`, and `preview-rehearsal` share one ref, so the new metadata must record the exact kind.
- Live branch protection on 2026-08-21 omitted `Orchestrator marker guard` and `Cancelled work guard`. Its `required_status_checks.strict: false` value is intentional per issue #1286 and must be preserved.
- `.github/workflows/guarded-migration-merge.yml` already proves a structural migration head contains current `main` before and while the merge lock is held; `Migration guarded merge authorization` is required.
- `MUTEX_REF`, `MUTEX_RECOVERY_ACTIVE_REF`, `createRefWithReadback`, `acquireMutex`, `requireOwnedRef`, and `recoverStaleAuthorMutex` are the existing atomic, fenced mutex primitives. Extend them; do not invent a second lock. `updateRef` PATCHes with `force=true` and no expected-SHA, so there is no Git compare-and-swap: the mutex is the only serialization.
- `assertMergeCommitInMainHistory` already handles GitHub's actual squash or merge commit SHA.
- A contract hash is not authority if the worker can issue the contract after starting. The dispatcher must publish first; completion validation must reject self-issued, late, or broadened contracts.
- Step 8A core activation depends only on Steps 1-6. Step 7/8B pilot work is independently gated and may wait for a genuine migration without delaying core safety.
- `docs/owner-rulings.md` and `plan_orchestrator-workflow-gaps.md` still contain the older `strict: true` instruction. Step 1 must preserve that history while adding the later issue #1286 ruling and removing the stale present-tense command.
- Official sources and their design implications are captured in plan §6. Re-open those current URLs before implementing product-dependent details.

## 6. Exact next steps

1. Start a fresh repository-maintenance session in a new isolated worktree from current `origin/main`; do not use the schema orchestrator. You'll know it worked when its branch/worktree are unique and issue #1366 remains open.
2. Read the plan STATUS table **and its 2026-08-23 revision list**, then execute Step 1 only. Note Step 1 no longer moves `curated-master-data` off the orchestrator — that extended an owner ruling Albert did not make. You'll know it worked when the orchestrator reports structure/schema only and live branch protection includes both missing contexts, retains all existing contexts and fields, reports `required_status_checks.strict: false`, and keeps `Migration guarded merge authorization` required.
3. At every phase cut, update the plan STATUS/evidence, merge the phase PR, and start a fresh session for the next phase. You'll know it worked when no phase relies on chat history and every done row cites a commit plus rerunnable evidence.
4. After Steps 1-6, execute Step 8A. Steps 7 and 8B are deferred to a follow-up issue and are not part of this plan's completion. You'll know it worked when core enforcement is live and the deferred pilot is tracked separately rather than holding #1366 open.
5. When Steps 1-6, 8A, and 9 are merged and live, open the follow-up issue for deferred Steps 7/8B, then use the validated completion path to close #1366 and delete this handoff in that final PR. You'll know it worked when the follow-up issue exists, #1366 is closed with a valid completion record, and the handoff-contract guard passes.

## 7. Constraints and gotchas

- The orchestrator does structure/schema only. Never route this repo-maintenance implementation to it.
- Use isolated worktrees and stage only owned files.
- Shared-db uses branch + PR; do not commit directly to `main`.
- Before a first commit, verify `git var GIT_COMMITTER_IDENT` is `Albert Hazan <u2giants@users.noreply.github.com>`.
- No database write is authorized by this handoff.
- Do not enable paid services, rotate secrets, remove required checks, hard-code preview refs, or change `strict: false`.
- Do not let a worker publish or widen its own contract. Scope changes return to the dispatcher and restart against a newly published contract.
- Do not add workflow `paths:` filters to required repository-wide checks.
- Do not make Step 8A wait for Step 7.
- Do not edit another session's handoff, worktree, branch, claim, or migration.
- A GitHub/API empty response is unknown, never proof of absence.

## 8. Access and environment

- `gh` is authenticated for issue operations and branch-protection reads as of 2026-08-21.
- Local shell is PowerShell; workflow baseline is Node.js 22 on Ubuntu.
- Shared checkout: `C:\repos\shared-db` (read/coordination only).
- No implementation worktree exists yet. The next session creates its own unique worktree from current `origin/main`.
- Supabase access is through existing GitHub secrets. Secret values were not read.
- If local credentials are later necessary, use 1Password vault `vibe_coding`; discover an existing descriptive item and never print its value.

## 9. Open questions and risks

- Supabase Branching availability/cost is unknown and now out of scope; it moves with deferred Step 7 to the follow-up issue.
- The current GitHub credential's ability to add the two branch-protection contexts is unknown; Step 1 must try only after snapshotting, preserve `strict: false`, and stop that sub-step if admin permission is absent.
- The largest safety risk is split ownership during stale lease recovery. The plan requires live terminal-run proof, grace, generation fencing, global-mutex-serialized transitions, and immediate pre-write assertion. The remaining database-side overlap is bounded by the grace period, not eliminated.
- Static SQL cannot prove every indirect read. Explicit declarations remain necessary.
- Whether `--publish-contract` can be restricted to a distinct publisher identity such as `github-actions[bot]` without a new secret is unknown; decide in Step 4. If not, the contract layer is a cooperative protocol and the plan must say so rather than overstate it.
- The remaining database-side split-write window is closed by an apply-time Postgres advisory lock, not by GitHub fencing. If that lock is not added in Step 6, the window stays open.

## Handoff self-audit

1. **Can a brand-new developer continue without context? Yes.** Sections 1-3 explain the repo, goal, plan path, issue, branch, base, and exact state; §6 gives the next actions.
2. **Can they continue as effectively as this session? Yes.** Sections 4-5 preserve the routing error, command dead end, test-layout discovery, three-round debate, retracted proposals, exact controls, and live owner ruling; the linked plan contains the complete revised design.
3. **Is every detail needed for execution included? Yes.** Sections 6-9 cover the ordered actions, verification, contract authority, independent pilot path, constraints, access, risks, and blocked/waiting outcomes; the plan provides per-file implementation detail and tests.
4. **Would Albert see every decision in section 0? Yes.** A line-by-line sweep of §§1-9 found only branch-protection admin access and possible paid Supabase Branching as future owner actions; both are consolidated in §0 with recommendations. The orchestrator boundary, `strict: false`, dispatcher authority, and pilot independence are listed as already settled and must not be re-asked.

**Handoff self-audit result: PASS.**
