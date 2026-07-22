# DB Data Admin Step 7 verification — 2026-07-22

## Scope

Read-only RevoGrid Core prototype for Customers and Vendors. Production database objects
were not changed. `fix_impl_visual_admin_page.md` was not modified or deleted.

## Delivered

- Customers and Vendors tabs backed by the protected `api.db_data_admin_*` RPCs.
- Explicit administrator access probe and a clear access-denied screen.
- Global, canonical-status, application, application-status, inactive, and Customer Channel
  filters. Inactive rows remain hidden by default.
- RevoGrid Core `4.23.22` public `columnTemplate` header inputs with 300 ms debounced row
  filtering, focus/caret retention, resizing, keyboard navigation, and virtualization.
- Client mode retrieves cursor pages up to 5,000 rows; server mode retrieves one cursor page
  at a time with an explicit **Load more** action.
- Database-backed per-user query state with local storage used only as a startup cache.
- Lazy Customer/Vendor detail panels for aliases and source references.
- PLM tri-state presentation: Active, Inactive, Unknown, or Not linked. Vendors do not offer
  the unsupported PLM filter/column.
- Narrow-screen horizontal grid behavior.

Step 7 is intentionally read-only. Editing/audit display is Step 8; merge is Step 9; the
Licensor/Property tree is Step 10.

## Automated evidence

From `apps/db-data-admin/`:

- `npm run lint` — passed.
- `npm test` — 5 files, 9 tests passed.
- `npm run build` — passed.
- `npm run test:browser` — Chromium, 3 tests passed.
- `scripts/check-sql.sh` — no SQL migration is part of this PR; run at the repository gate.

The browser suite mocks only transport/auth so rendering uses the production React and
RevoGrid code. It proves signed-in grid rendering, row content, tab isolation, persistent
header focus after debounce, lazy detail rendering, and narrow viewport behavior.

## Visual evidence

- [Customer grid and lazy detail panel](db-data-admin-step7-customer-detail.png)
- [Vendor grid](db-data-admin-step7-vendor-wide.png)
- [Narrow Customer grid](db-data-admin-step7-narrow.png)

## Deployment gate

Merge through a `shared-db` PR. GitHub Actions must publish the immutable GHCR image and
Coolify must deploy the development host. Verify the live build SHA, Microsoft SSO,
authorized behavior, and denied behavior on `https://data-dev.designflow.app` before this
step is considered deployed. Production `https://data.designflow.app` remains gated until
Step 13.
