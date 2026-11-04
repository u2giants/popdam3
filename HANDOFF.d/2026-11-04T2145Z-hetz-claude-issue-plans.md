---
issue: none (index of plans; each plan names its own issue)
status: OPEN
owner: unassigned — any implementing session picks one plan
---
# Handoff: implementation plans for every open popdam3 issue (written 2026-11-04)

Written Nov 4, 2026, about 4:45 PM EST on `hetz` by Claude. Branch `claude/github-issues-implementation-plans-09bb39`.

## 0. Business decisions only the owner can make
None for this handoff itself. Each plan's section 13 lists the owner questions it carries; the only one that blocks spend is in [issue-680](../docs/plans/issue-680-full-ai-tagging-run.md): Albert's go for the paid full tagging run.

## 1. What this application is
PopDAM (and PopSG, same codebase) — see `AGENTS.md`. Repo u2giants/popdam3.

## 2. What we set out to do
Albert asked for a detailed, self-standing implementation plan for every open GitHub issue, written to the `implementation-plan-writer` standard, so any fresh session can pick an issue and build it without chat context.

## 3. Current state
Every open issue as of Nov 4, 2026, 6:02 PM EST has a plan under [`docs/plans/`](../docs/plans/) named `issue-<number>-<slug>.md`. Each plan opens with a STATUS table (all rows open — no implementation has started) and ends with its self-audit. No code was changed. Plans are indexed in `AGENTS.md` → Active plans.

## 4. What did not work
N/A — planning only.

## 5. Findings
Each plan's section 5–6 records whether the issue's work is already landed on `main` (several review-finding issues are) with `file:line` evidence; those plans reduce to verify + regression test + close.

## 6. Exact next steps
1. Pick an issue; open its plan; read STATUS first.
2. Implement on a new feature branch in a fresh worktree; update the plan's STATUS as steps land.
3. Delete the plan file and this handoff's reference to it when the issue closes with live proof.

## 7. Constraints
Standing rules in `AGENTS.md` and each plan's section 11.

## 8. Access
Each plan's section 12.

## 9. Open questions and risks
Plans were written by subagents from the issue text and code at commit `01fcfc34`; re-verify `file:line` references before editing if `main` has moved.
