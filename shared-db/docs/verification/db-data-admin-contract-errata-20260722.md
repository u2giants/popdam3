# DB Data Admin Step 6 contract errata verification

Date: 2026-07-22
Preview project: `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`)
Production: unchanged

## Why this was required

The pre-Step 7 Kimi K3/Codex review found three gaps in the first read contract:

1. PLM filtering tested any historical import row while display used a latest row.
2. The required detail panel had alias counts but no protected alias-detail path.
3. Customer Channels could display but could not filter in server mode.

Migration `20260722163000_db_data_admin_contract_errata.sql` completes that
preview-only, consumerless contract without editing applied history.

## Binding behavior

- One PLM row wins deterministically by `updated_at desc`, `imported_at desc`,
  then `plm_customer_id desc`.
- `ACTIVE` is active; any other non-null value is inactive; null/missing is
  unknown and matches neither filter.
- `api.db_data_admin_customer_list(...)` now accepts `p_channel_id uuid`.
- Protected Customer/Vendor detail RPCs return ordered alias metadata and source
  references on demand. Vendor source references never invent `source_name`.
- The obsolete nine-argument Customer-list signature was atomically replaced;
  no application or production consumer existed.

## Verification evidence

- `scripts/check-sql.sh`: passed.
- Initial preview dry-run listed only `20260722163000_db_data_admin_contract_errata.sql`.
- Migration applied successfully to preview.
- Rollback-safe preview suites passed:
  - `db_data_admin_foundation.sql`
  - `db_data_admin_extensions.sql`
  - `db_data_admin_merge_coverage.sql`
  - `db_data_admin_read_contracts.sql`
  - `app_serving_status_contracts.sql`
  - `db_data_admin_contract_errata.sql`
- `fix_impl_visual_admin_page.md` was not modified.

## Next gate

Merge this schema PR after CI, then implement Delivery Step 7 on a fresh branch:
read-only Customer/Vendor RevoGrids, protected access-denied state, persistent
header filters, saved grid state, and lazy detail panels against preview.
