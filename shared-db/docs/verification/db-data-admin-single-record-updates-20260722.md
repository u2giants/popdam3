# DB Data Admin Step 8 database verification — 2026-07-22

Status: applied and verified on preview only. Production is unchanged and the
`single_record_write` feature gate remains disabled by default.

## Contract

Migration `20260722170000_db_data_admin_single_record_updates.sql` adds protected,
administrator-only Customer and Vendor update RPCs. The whitelist is limited to curated
display name, global active/potential/inactive status, CRM/PM/DAM binary status, and Customer
Channels. Canonical names/codes, PLM state, aliases, source references, Vendor relationships,
merge, bulk, deletion, and taxonomy remain read-only.

Every call requires the existing Administrator role plus an explicit non-revoked `admin`
app-access row. Writes use the row `updated_at` token, a client operation UUID, structured
expected-failure results, and the immutable audit ledger. Reactivation clears the current
per-app reason while history remains in audit.

## Preview-first evidence

- Preview project: `rjyboqwcdzcocqgmsyel`.
- The initial concurrency check found another session had applied this migration as
  `20260722170000` while separately landing the Vendor mirror migration as `20260722171500`.
  The duplicate ledger drift was inspected and reconciled; no schema or data was removed.
- Final preview dry-run: `Remote database is up to date.`
- `scripts/check-sql.sh`: passed.
- Rollback-safe preview suites passed:
  - `db_data_admin_foundation.sql`
  - `db_data_admin_extensions.sql`
  - `db_data_admin_merge_coverage.sql`
  - `db_data_admin_read_contracts.sql`
  - `app_serving_status_contracts.sql`
  - `db_data_admin_contract_errata.sql`
  - `db_data_admin_single_record_updates.sql`

The Step 8 suite proves authorization denial, gate-disabled behavior, validation, Customer
and Vendor parity, display/status/channel changes, PM-to-`pim` mapping, reason/actor/time,
reactivation, stale tokens, idempotent replay, no-op and not-found results, immutable success
and failure audit rows, and actor-labelled audit reads.

## Gate

Do not enable production writes. Preview may enable the single row
`app.db_data_admin_feature_gate(feature='single_record_write')` operationally after PR A is
merged so the Step 8 frontend can be exercised. Production enablement remains Step 13 and is
blocked on Step 11 consumer enforcement or explicit owner approval.
