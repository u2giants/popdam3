---
summary: "Open work: read shared data instead of copying it — plan written 2026-11-23, no stage started"
kind: handoff
status: current
read-when: "Continuing the 'read shared data instead of copying it' effort (parent issue in u2giants/popdam3)"
---
# Handoff — read shared data instead of copying it (2026-11-23, hetz, Claude)

## Goal
POP's apps share one database so they never copy each other's data. A 2026-11-23 audit (asked by Albert) found copies in PopDAM (production orders, characters, licensor/property lists, style-group names, two empty placeholders) and DesignFlow (second ColdLion customer download). The fix is planned per repository.

## Plan for this repo
[plan_shared_data_no_copies.md](plan_shared_data_no_copies.md) — read its STATUS table first; do not re-plan.

## State
Nothing implemented yet. Earlier the same day PopDAM's copy sync was made durable (popdam3 PRs #1278–#1290, designflow-tracking PR #236); those are what the plans retire. PopDAM PR #1294 was closed unmerged.

## Next action
The coordinator (parent issue in u2giants/popdam3, plan `plan_shared_data_no_copies.md`) starts stages whose prerequisites are met: S1, C1, N1 (shared-db) and D2 (designflow-data-syncing).
