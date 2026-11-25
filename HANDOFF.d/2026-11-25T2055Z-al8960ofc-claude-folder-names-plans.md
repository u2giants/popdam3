---
summary: Plan-only session — six implementation plans for the folder-shortening review findings and exact NAS file/folder names (14 issues); no code changed.
kind: handoff
status: open
read-when: picking up any of u2giants/popdam3 #970 #973 #979 #985 #1007 #1008 #1012 #1013 #1015 #1310 #1328 #1188 #1236 #1238
---

# Handoff — plans for folder-shortening findings and exact NAS names

Written 2026-11-25 3:55 PM EST by Claude on al8960ofc. Plan-only work: nothing implemented, nothing on the NAS or in the database changed.

## Open plans (each is unfinished work; read its STATUS first)

| Plan | Issues |
|---|---|
| [docs/plans/issue-1310-folder-rename-engine-and-executor.md](../docs/plans/issue-1310-folder-rename-engine-and-executor.md) | #1310, #985, #1007, #1012, #1328 findings 4–6 |
| [docs/plans/issue-1015-folder-names-admin-screen.md](../docs/plans/issue-1015-folder-names-admin-screen.md) | #1015, #1008, #1013 |
| [docs/plans/issue-973-snapshot-restore-hardening.md](../docs/plans/issue-973-snapshot-restore-hardening.md) | #973 |
| [docs/plans/issue-1328-folder-shortening-records-and-path-rules.md](../docs/plans/issue-1328-folder-shortening-records-and-path-rules.md) | #1328 (+#1354), #979 (+#968), #970, #1007 finding 3 |
| [docs/plans/issue-1236-exact-nas-file-names.md](../docs/plans/issue-1236-exact-nas-file-names.md) | #1236, #1238 |
| [docs/plans/issue-1188-windows-agent-short-name-resolution.md](../docs/plans/issue-1188-windows-agent-short-name-resolution.md) | #1188 |

## Order and urgency

1. **issue-1310 first**: the rename tool would abort on the Concept Approved and top-folder batches (it re-queues already-renamed folders), and several name rules produce junk such as `(Feb )` in rows not yet renamed. The next production batch (Phase 5.4, see [2026-11-25T1545Z close-nested handoff](2026-11-25T1545Z-hetz-claude-close-nested-folder-shortening-batches.md)) should wait for it.
2. issue-1015 and issue-1328 touch shared files with issue-1310 (`core.mjs`, the parent plan STATUS) — rebase onto it.
3. issue-973, issue-1236, issue-1188 are independent.

Superseded handoffs for folder shortening (do not follow their "next steps"): `2026-11-11T1846Z-hetz-claude-folder-shortening-snapshot-restore.md`, `2026-11-13T1645Z-hetz-claude-folder-shortening-phase4-freeze.md`, `2026-11-13T1645Z-hetz-claude-close-nested-folder-shortening.md`. Current: the 2026-11-25 1511Z and 1545Z files.

## Not verified here

Two production reads could not be run (database access was not available in this session): whether `admin_config.WORKFLOW_FOLDER_MAP` exists (issue-1328 step 7) and how many assets store a trimmed `filename` (issue-1236 step 1). Each plan makes that read its first action.

Parent plan (unchanged by this session): [plan_folder_shortening_snapshot_restore.md](../plan_folder_shortening_snapshot_restore.md).
