---
issue: 1366
status: OPEN
owner: codex/plan-agent-coordination-hardening
---

# Handoff — implement provider-neutral multi-agent database coordination hardening

## 0. Decisions only the owner can make

### Blocking

None now. The implementation can begin with Step 1 of the plan.

Two later actions may require Albert, but the implementation session must first exhaust its authenticated access and produce the exact evidence:

1. **GitHub branch-protection administration.** Recommendation: add the exact existing `Orchestrator marker guard` and `Cancelled work guard` contexts and restore `required_status_checks.strict: true` without changing unrelated protection settings. This blocks completion of plan Step 1 only if the active authenticated identity lacks repository-admin permission.
2. **A paid Supabase Branching requirement, if one exists.** Recommendation: do not purchase or upgrade automatically. Commit the readiness report and mark the pilot blocked. This blocks only plan Step 7, not Steps 1-6 or 8-9.

### A wrong guess is recoverable

None. Lease timing, compatibility, conflict rules, and pilot role are already locked in the plan.

### Outside this workstream and currently unowned

None found.

### Already settled — do not re-ask

- **2026-08-21, Albert Hazan:** the shared-db orchestrator's only job is database structure and schema. Repository-maintenance work is not an orchestrator job.
- The shared preview remains the final integration rehearsal.
- No concurrent `supabase db push` to one target.
- No Claude Agent Teams control plane.
- No TTL-only automatic lock expiry.

If an owner decision becomes necessary, put the whole updated list to Albert in one message, not one item at a time.

## 1. What this application is

`u2giants/shared-db` is the source of truth for the shared Supabase database structure used by POP Creations applications. It stores SQL migrations, database contracts, coordination scripts, GitHub Actions, and the rules that prevent concurrent AI sessions from colliding.

The implementation specification is [`../plan_multi_agent_database_coordination_hardening.md`](../plan_multi_agent_database_coordination_hardening.md). Read its STATUS table first and do not re-research or re-plan completed steps.

## 2. What this session set out to do and why

Albert asked for a comprehensive implementation plan applying current Codex, Claude, Supabase, and distributed-locking guidance to this repository's multi-agent database workflow.

This session initially misrouted the plan to the shared-db orchestrator. Albert clarified that the orchestrator handles structure/schema only. The mistaken handover issue was closed, then issue #1366 was repurposed as the normal repository-maintenance implementation tracker and explicitly states the corrected ownership.

## 3. Current state

- Plan written at `plan_multi_agent_database_coordination_hardening.md`.
- This handoff is the plan's required open-workstream registration.
- Tracking issue #1366 is OPEN, labeled `db-work`, with `work_type: repo-maintenance` and `route: repo-maintenance`.
- Planning branch: `codex/plan-agent-coordination-hardening`.
- Planning worktree: `C:\repos\shared-db-worktrees\plan-agent-coordination`.
- Base when drafted: `36a04b2fc8905e61f3b9b3a7d3202d9ca4b3da2b` from `origin/main`.
- No database, preview, production, migration, application row, branch-protection setting, or secret was changed.
- The plan is not implemented. All STATUS rows are open.

## 4. Everything tried that did not work

1. **Incorrect orchestrator handover.** Issue #1366 was first opened as `HANDOVER: plan multi-agent database coordination hardening`. That was wrong because the orchestrator handles database structure/schema only. The issue was closed, the owner corrected the scope, and the issue was reopened as a repo-maintenance implementation tracker. Do not send it back to the orchestrator.
2. **First GitHub issue command used a long PowerShell here-string.** The command runner rejected it before GitHub received anything because quoting was ambiguous. The retry used an exact temporary body file and succeeded. No duplicate issue was created.
3. **A root `package.json` was assumed during test discovery.** This repository has no root `package.json`; tests run directly with `node --test`. Do not waste time looking for npm scripts.

## 5. Root causes and key findings

- `scripts/manage-migration-author-lanes.mjs:165-182` currently labels repo maintenance/documentation/security as `fork`; lines 264-278 report them to the orchestrator. That conflicts with the 2026-08-21 owner ruling and is Step 1's first correction.
- `parseQueueScope` at `scripts/manage-migration-author-lanes.mjs:203-241` has one flat `objects:` set; the queue overlap at lines 284-297 cannot distinguish readers from writers.
- Dependencies at lines 280-281 are satisfied whenever their number is not open; there is no success proof or cycle validation.
- `scripts/check-pr-object-collisions.mjs:75-77` explicitly admits different-object semantic dependencies are invisible.
- Exclusive refs are declared at `scripts/manage-migration-author-lanes.mjs:127-142`; `acquireExclusive` starts at line 1409. They carry ownership but no heartbeat/generation recovery protocol.
- Live branch protection on 2026-08-21 omitted `Orchestrator marker guard` and `Cancelled work guard` and returned `required_status_checks.strict: false`; the gap plan records the missing checks at `plan_orchestrator-workflow-gaps.md:314-319` and `:382-385`, while the collision workflow explains why up-to-date enforcement is required.
- Official sources and their design implications are captured in plan §6. Re-open those current URLs before implementing product-dependent details.

## 6. Exact next steps

1. Merge this documentation-only plan PR after all required checks pass. You'll know it worked when `origin/main` contains the plan, this handoff, the AGENTS router link, and the anti-collision topic link.
2. Start a fresh repository-maintenance session in a new isolated worktree from current `origin/main`; do not use the schema orchestrator. You'll know it worked when its branch/worktree are unique and issue #1366 remains open.
3. Read the plan STATUS table, then execute Step 1 only. You'll know it worked when the orchestrator reports structure/schema only and live branch protection includes both missing contexts, retains all existing contexts, and reports `required_status_checks.strict: true`.
4. At every phase cut, update the plan STATUS/evidence, merge the phase PR, and start a fresh session for the next phase. You'll know it worked when no phase relies on chat history and every done row cites a commit plus rerunnable evidence.
5. When all plan completion criteria are satisfied, use the validated completion path to close issue #1366 and delete this handoff in that final PR. You'll know it worked when the issue is closed with success evidence and the handoff-contract guard passes its deletion.

## 7. Constraints and gotchas

- The orchestrator does structure/schema only. Never route this repo-maintenance implementation to it.
- Use isolated worktrees and stage only owned files.
- Shared-db uses branch + PR; do not commit directly to `main`.
- Before a first commit, verify `git var GIT_COMMITTER_IDENT` is `Albert Hazan <u2giants@users.noreply.github.com>`.
- No database write is authorized by this handoff.
- Do not enable paid services, rotate secrets, remove required checks, or hard-code preview refs.
- Do not edit another session's handoff, worktree, branch, claim, or migration.
- A GitHub/API empty response is unknown, never proof of absence.

## 8. Access and environment

- `gh` is authenticated for issue operations and branch-protection reads as of 2026-08-21.
- Local shell is PowerShell; workflow baseline is Node.js 22 on Ubuntu.
- Shared checkout: `C:\repos\shared-db` (read/coordination only).
- Planning worktree: `C:\repos\shared-db-worktrees\plan-agent-coordination`.
- Supabase access is through existing GitHub secrets. Secret values were not read.
- If local credentials are later necessary, use 1Password vault `vibe_coding`; discover an existing descriptive item and never print its value.

## 9. Open questions and risks

- Supabase Branching availability/cost is unknown; plan Step 7 defines a no-purchase blocked outcome.
- The current GitHub credential's ability to edit branch protection is unknown; Step 1 must try only after snapshotting, and must stop that sub-step if admin permission is absent.
- The largest safety risk is split ownership during stale lease recovery. The plan requires terminal-run proof, grace, generation fencing, compare-and-swap, and immediate pre-write assertion.
- Static SQL cannot prove every indirect read. Explicit declarations remain necessary.

## Handoff self-audit

1. **Can a brand-new developer continue without context? Yes.** Sections 1-3 explain the repo, goal, plan path, issue, branch, base, and exact state; §6 gives the next actions.
2. **Can they continue as effectively as this session? Yes.** Sections 4-5 preserve the routing error, command dead end, test-layout discovery, exact gaps, and live findings; the linked plan contains the complete design.
3. **Is every detail needed for execution included? Yes.** Sections 6-9 cover the ordered actions, verification, constraints, access, risks, and blocked outcomes; the plan provides per-file implementation detail and tests.
4. **Would Albert see every decision in section 0? Yes.** A line-by-line sweep of §§1-9 found only branch-protection admin access and possible paid Supabase Branching as future owner actions; both are consolidated in §0 with recommendations. The orchestrator boundary and other decisions are listed as already settled.

**Handoff self-audit result: PASS.**
