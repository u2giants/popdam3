---
summary: "Open implementation plans for the CSV and SQL export review findings (#1129, #1147, #1149, #1150)."
kind: handoff
status: open
read-when: "implementing fixes to the CSV/SQL export scripts or the export edge functions"
---

# Handoff — export script plans (#1129, #1147, #1149, #1150)

Written 2026-11-25 by a Claude Code plan session on al8960ofc. Only plans were written; no fix is implemented.

Plans (read each plan's STATUS table first; do not re-plan):

- [docs/plans/issue-1147-sql-dump-snapshot-restore-download.md](../docs/plans/issue-1147-sql-dump-snapshot-restore-download.md) — SQL dump: covers [#1147](https://github.com/u2giants/popdam3/issues/1147), [#1149](https://github.com/u2giants/popdam3/issues/1149), [#1150](https://github.com/u2giants/popdam3/issues/1150). Starts with one shared-db migration (`asset_characters.created_at`).
- [docs/plans/issue-1129-csv-export-stale-and-empty-files.md](../docs/plans/issue-1129-csv-export-stale-and-empty-files.md) — CSV export: covers [#1129](https://github.com/u2giants/popdam3/issues/1129).

Order: the SQL plan first (it creates the shared cutoff/cursor helpers and the PowerShell test harness the CSV plan reuses). Neither needs an owner decision.

Facts established while planning (origin/main `787c20b8`):
- #1149 finding 1 (DELETE cascading from `public.characters`) is already fixed by #1301/#1311; the other #1149 findings are open.
- #1129 finding 1 (Out-File) is already fixed; findings 2–5 are open, plus a silent duplicate/skip risk from offset paging.
- Every reviewer text was truncated in all stored copies; each plan's live-proof step includes a re-read of the original PR diff.

Close this file when both plans' STATUS tables are all done.
