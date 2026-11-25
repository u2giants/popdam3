---
issue: "#791 #802 #819 #849 #861 #949 #976 #977 #1176 #1179 #1285 #1287"
status: OPEN
owner: unassigned — any implementing session picks one plan
---
# Handoff: plans for the deploy, CI, review-fixer and docs-health issue group (written 2026-11-25)

Written Nov 25, 2026, about 4:06 PM EST on `al8960ofc` by Claude, branch
`claude/objective-kapitsa-374d7c`, as one of several parallel plan-writing sessions.

## 0. Business decisions only the owner can make
None. Every choice in these plans is technical and reversible.

## 1. What this application is
PopDAM (u2giants/popdam3) — see `AGENTS.md`.

## 2. What we set out to do
Give every open issue in this group a self-standing implementation plan (implementation-plan-writer
standard), or close it with evidence if already fixed, superseded, or in conflict with the owner
rulings (reviews advisory; only safety checks block merges; no wait over 30 minutes).

## 3. Current state
No issue in the group was fully fixed or in conflict with the owner rulings, so none was closed; parts
already fixed are recorded in each plan's STATUS note. Pairs on the same files were planned together.
Plans only — no code changed. Every STATUS row is open.

| Issues | Plan |
|---|---|
| #791, #1287 | [issue-791-1287-worker-railway-config.md](../docs/plans/issue-791-1287-worker-railway-config.md) |
| #1285 | [issue-1285-worker-node-runtime.md](../docs/plans/issue-1285-worker-node-runtime.md) |
| #802, #949 | [issue-802-949-frontend-and-sandbox-deploy-proof.md](../docs/plans/issue-802-949-frontend-and-sandbox-deploy-proof.md) |
| #819, #849 | [issue-819-849-review-fixer-caller-and-leftovers.md](../docs/plans/issue-819-849-review-fixer-caller-and-leftovers.md) |
| #861, #1179 | [issue-861-1179-db-data-admin-workflow.md](../docs/plans/issue-861-1179-db-data-admin-workflow.md) |
| #1176 | [issue-1176-preview-audit-reporter-races.md](../docs/plans/issue-1176-preview-audit-reporter-races.md) |
| #976, #977 | [issue-976-977-documentation-health.md](../docs/plans/issue-976-977-documentation-health.md) |

## 4. What to do next
Pick one plan, read its STATUS first, and run its lead launch prompt. Plans are independent; the
Railway plan (#791/#1287) and the Node plan (#1285) both touch the worker — land them one at a time.
Stale automatic branches `review-fix/802` and `review-fix/1179` exist; the #802 plan deletes the first;
delete `review-fix/1179` when the #1179 plan lands (its finding 1 was fixed by PR #1180).

## 5. Gotchas
Workflow files are protected from the automatic review fixer, which is why most of these stayed open;
normal sessions may edit them through a PR. Keep every new check advisory.
