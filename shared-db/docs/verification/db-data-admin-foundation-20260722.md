# DB Data Admin foundation and extension verification — 2026-07-22

## Scope

Delivery Step 4 of `DB_Data_Admin.md`, applied to the persistent preview branch
`rjyboqwcdzcocqgmsyel` only. Production was not changed.

The additive migrations create:

- explicit `admin` app-access authorization without the administrator shortcut;
- immutable audit storage and per-profile grid state with RLS and no direct browser grants;
- CRM and PM/PIM Customer and Vendor status extensions;
- the inventory-required DAM Vendor status extension;
- controlled shared Channels and many-to-many Customer assignments.

No PLM/ERP object, existing serving view, or consumer behavior changed. PLM status remains
Cloud-SQL-owned under the single-writer decision in `docs/db-data-admin-inventory.md`.

## Verification evidence

1. The in-flight check found no open shared-db pull requests before authoring, and it was
   repeated for each extension migration. The separate ERP relocation files were untouched.
2. `bash scripts/check-sql.sh` passed.
3. Preview dry-run listed only `20260722002500` for the foundation apply, then only
   `20260722003000` through `20260722003500` for the extension/Channel apply.
4. All seven migrations applied successfully to preview.
5. `supabase/tests/db_data_admin_foundation.sql` passed against preview and rolled back its
   fixtures. It verifies explicit-grant acceptance, revoked-grant denial, RLS, absence of
   direct authenticated table grants, grid-state storage, and audit update/delete rejection.
6. `supabase/tests/db_data_admin_extensions.sql` passed against preview and rolled back its
   fixtures. It verifies RLS, read-only app grants, absence of direct browser DML, inactive
   status evidence requirements, Channel assignment uniqueness, and protected Channel
   storage.
7. A final preview dry-run must be empty before the PR is merged.

## Production gate

These migrations are intentionally not applied to production. Production promotion remains
subject to the approved-window rule and the later delivery gates in `DB_Data_Admin.md`.

