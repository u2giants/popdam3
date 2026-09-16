# DB Data Admin frontend

This app moved here from `u2giants/shared-db` on 2026-09-16. It is independent of the PopDAM app: its own folder, dependencies, workflow (`.github/workflows/db-data-admin.yml`) and Coolify applications. Database structure it relies on is still changed only through `u2giants/shared-db`.

Administrator application for the shared Customer, Vendor, Licensor, and Property hubs.
The authoritative product and delivery requirements are in [`../../DB_Data_Admin.md`](https://github.com/u2giants/shared-db/blob/main/DB_Data_Admin.md).

Production is `https://data.designflow.app`; development is
`https://data-dev.designflow.app`. The production hostname belongs exclusively
to DB Data Admin. A retired application once used the same DNS name, but no
code, API, credential, database connection, import path, rollback path, or
runtime is shared. See the
[domain-ownership contract](https://github.com/u2giants/shared-db/blob/main/docs/db-data-admin-domain-ownership.md).

## Local preview shell

1. Copy `.env.example` to `.env.local`.
2. Put only the preview project's public Supabase URL/anon key in that ignored file.
3. Run `npm install`, then `npm run dev`.

## Running the browser tests — check port 4173 first

`npx playwright test` starts its own preview server, but `playwright.config.ts`
sets `reuseExistingServer: !process.env.CI` against port 4173 by default.
If anything else is already listening there, Playwright silently reuses it and
the whole suite runs against **the wrong application**.

This is not hypothetical: on 2026-07-28 a POP PIM preview server held 4173, and
all 7 tests failed with locator-not-found errors that looked like real UI
regressions. Nothing was wrong with the code.

Before trusting a red run, confirm what is actually serving the port:

```bash
curl -s http://127.0.0.1:4173/ | grep -o '<title>[^<]*</title>'
```

If it is not DB Data Admin, do not stop another session's server. Re-run on an
isolated free port, for example:

```bash
PLAYWRIGHT_PORT=4187 npm run test:browser
```

A red suite where **`shell.spec.ts` also fails** is the tell: that test touches
almost nothing, so a failure there means the environment is wrong, not the app.

Never use production credentials for local development. Microsoft login uses Supabase Auth's
existing Azure provider and the exact `VITE_AUTH_REDIRECT_URL` allowlisted for the environment.
Production access stays disabled until the preview delivery gates in the specification pass.

Deployed containers receive `DB_DATA_ADMIN_SUPABASE_URL`,
`DB_DATA_ADMIN_SUPABASE_ANON_KEY`, and `DB_DATA_ADMIN_AUTH_REDIRECT_URL` from Coolify.
They are rendered at container startup through `/config.js`; GitHub builds one immutable image
without baking environment-specific configuration into it.

## In-table editing

Customers and Vendors have an **Edit table** button. While edit mode is on,
administrators can edit global Status, CRM, PM/PIM, and DAM status cells
directly. Name is read-only. Global Status is strictly limited to Active,
Potential, or Inactive; each application status is strictly limited to Active
or Inactive. RevoGrid's native copy, paste, and drag-fill behavior is enabled
for those cells. The Undo button reverses up to the last 10 edit actions; one
multi-row drag-fill counts as one action. Refresh clears local undo history.
ERP, PLM, alias count, and timestamp
columns remain read-only. Every changed row is saved immediately through the existing guarded
single-record RPC with optimistic-concurrency checks and the audit reason
`Edited in table`; a failed or stale save reloads the grid instead of leaving an
unsaved value visible.
