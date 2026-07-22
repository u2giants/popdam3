# DB Data Admin Step 9 UI verification — 2026-07-22

The Customer and Vendor detail panels now open a protected merge workflow. The selected
detail record is always the survivor; the administrator chooses the duplicate to absorb.
The dialog fetches a fresh server preview, displays every non-zero affected-link count,
requires an explicit choice for each per-app business-field conflict, requires an audit
reason, and requires a separate irreversible-action confirmation.

The browser never calls `core.merge_customer` or `core.merge_factory`. It calls only the
protected preview and execution RPCs. A stale preview is shown loudly and cannot merge.
After success, the loser disappears from the grid, the survivor projection is refreshed,
and the permanent audit history is reloaded.

Verification from `apps/db-data-admin/`:

- `npm run lint`: passed.
- `npm test`: 7 files and 15 tests passed.
- `npm run build`: passed.
- `npm run test:browser`: 4 Chromium tests passed.
- Visual review: `db-data-admin-step9-merge-preview.png` shows the survivor/loser direction,
  affected counts, conflict choice, reason, irreversible warning, and destructive action.

Production remains untouched. The database `merge_execute` gate is enabled only on preview
after the schema PR merges so this development UI can be exercised through Microsoft SSO.


> **Correction 2026-07-22:** gaps in this step were subsequently closed. See [db-data-admin-steps8-10-corrections-20260722.md](db-data-admin-steps8-10-corrections-20260722.md) and the corrected preview [db-data-admin-step9-moving-detail-preview.png](db-data-admin-step9-moving-detail-preview.png) for the authoritative evidence (29 unit + 6 Chromium tests, preview-verified migration `20260722210000`). The test counts above reflect the pre-correction state.
