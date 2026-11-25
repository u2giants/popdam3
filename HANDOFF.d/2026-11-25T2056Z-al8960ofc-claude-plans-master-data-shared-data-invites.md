---
summary: "Open plans (none started): Master Data Size picker + cutover STATUS (#1276/#1293/#1303), shared-data no-copies STATUS repair (#1307), admin-api set-user-apps service-role fix (#830)"
kind: handoff
status: current
read-when: "Implementing #830, #1276, #1293, #1303 or #1307"
---

# Handoff — implementation plans for five review-finding issues (2026-11-25, al8960ofc, Claude)

Plans only were written; no implementation has started. Each plan's STATUS table is the source of truth.

| Issue(s) | Plan | Where to start |
|---|---|---|
| #1276, #1293, #1303 | [docs/plans/issue-1276-1293-1303-master-data-size-picker-and-cutover-status.md](../docs/plans/issue-1276-1293-1303-master-data-size-picker-and-cutover-status.md) | Phase A and step B0 in parallel |
| #1307 (+ folded #1335) | [docs/plans/issue-1307-shared-data-no-copies-status-repair.md](../docs/plans/issue-1307-shared-data-no-copies-status-repair.md) | Step 1 |
| #830 | [docs/plans/issue-830-set-user-apps-service-role.md](../docs/plans/issue-830-set-user-apps-service-role.md) | Step 1 |

Facts verified at planning time (origin/main 787c20b8, 2026-11-25 3:56 PM EST):
- #830 bug still present: `supabase/functions/admin-api/index.ts:527` `granted_by: _userId`.
- #1307: T1 really is done (signed proof on popcre/designflow-tracking#239); only the plan row cites S2's evidence. `docs/SCHEMA.md` §2.15 still documents dropped tables.
- #1293/#1303: Size picker drops retired labels; rows store Size as text with no id, so a retired non-dimension label on an existing row fails validation.

Parent work item for the Size plan remains u2giants/popdam3#1273 with [plan_master_data_designflow_reference_cutover.md](../plan_master_data_designflow_reference_cutover.md).
