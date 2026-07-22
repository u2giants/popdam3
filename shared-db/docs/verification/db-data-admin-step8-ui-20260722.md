# DB Data Admin Step 8 UI verification — 2026-07-22

The development UI adds protected Customer/Vendor single-record editing and immutable audit
history to the Step 7 read-only grids.

## Behavior

- Explicit **Edit record** action from the lazy detail panel; the virtualized grid remains
  read-only, preventing accidental edits or unrestricted paste.
- Whitelisted form controls for curated display name, global active/potential/inactive status,
  one CRM/PM/DAM status change, and Customer Channels.
- Required audit reason and visible saving, saved, validation-error, backend-error, and stale
  concurrency conflict states.
- Global status warning explains that the change affects every application.
- The detail panel reloads the returned row and protected actor-labelled audit history after a
  successful save.
- The PM/PIM filter and editor send the canonical API value `pm`; the physical `pim` schema is
  handled only inside the database RPC.

## Automated evidence

From `apps/db-data-admin/`:

- `npm run lint` — passed.
- `npm test` — 6 files, 12 tests passed, including required-reason and stale-token conflict UI.
- `npm run build` — passed.
- `npm run test:browser` — Chromium, 3 tests passed, including editor save/audit and narrow UI.

Transport/auth are mocked only in browser automation; production React/RevoGrid/editor code is
rendered. Database behavior is independently proven against preview by
`db-data-admin-single-record-updates-20260722.md`.

## Visual evidence

- [Customer detail with audit history](db-data-admin-step8-detail-audit.png)
- [Whitelisted Customer editor](db-data-admin-step8-editor.png)

Production writes remain disabled. `fix_impl_visual_admin_page.md` remains untouched.
