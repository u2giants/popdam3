# PLM Master Data API Shape

Date: 2026-06-24

This verifies the read-only Designflow PLM master-data API shape used by
`tools/sync-plm-master-data.mjs` and
`supabase/migrations/20260624173000_plm_master_data_import.sql`.

## Endpoints

- Licensors/properties: `GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties`
- Customers: `GET https://api.designflow.app/api/core/customers/getCustomers`
- Auth header: `x-api-key`, read from 1Password item `DesignFlow PLM Canonical Master Data API`

## Observed Shape

Licensors/properties returned a top-level JSON array with 37 licensors and 468
nested properties. Licensor and property rows use the same merch-group-style shape:

```text
id, title, mg_code, parent_id, divisionCode, mgCode2, mgCategory
```

Licensors additionally include:

```text
properties
```

Customers returned a top-level JSON array with 55 rows. Customer rows use:

```text
customers_id, customers_name, customers_email, customers_level,
customers_notes, customers_passw, customers_expire, customers_status,
customers_auditlog, customers_dilution, customers_lastname,
customers_phonenum, customers_subscription, customers_logistic_load,
customers_subleveladmin, customers_notificationsms,
customers_notificationemail, customers_airbyte_emitted_at,
customers_airbyte_customers_hashid, customers_code, customers_logo
```

The import sanitizes `customers_passw` out of stored raw JSON before writing
`ingest.raw_record`, `core.company_source_ref.raw`, or `plm.customer_import.raw`.

The 505 merch-group IDs observed across licensor and property rows were unique,
so `source_table = 'merchGroup'` plus `source_id = id` is safe for the shared
`core.taxonomy_source_ref` uniqueness rule.

## Source Reference Mapping

- `source_system = 'designflow_plm'`
- Customers use `source_table = 'customers'` and `source_id = customers_id`.
- Licensors use `source_table = 'merchGroup'`, `entity_table = 'licensor'`, and `source_id = id`.
- Properties use `source_table = 'merchGroup'`, `entity_table = 'property'`, and `source_id = id`.

The API payload looks merch-group-shaped for licensors/properties, so `merchGroup`
is used as the durable PLM table name for future full database import matching.

## Canonical Targets

- Customers upsert into `core.company`.
- Licensors upsert into `core.licensor`.
- Properties upsert into `core.property`.
- PLM source-shaped rows are retained in `plm.customer_import`,
  `plm.licensor_import`, and `plm.property_import`.
- Raw sanitized API snapshots are retained in `ingest.raw_record`.

## Preview Validation

Validated against preview branch `xjcyeuvzkhtzsheknaiu` on 2026-06-24:

- `scripts/check-sql.sh` static checks passed via Git Bash.
- `supabase branches list --project-ref qsllyeztdwjgirsysgai` confirmed preview branch
  `shared-db-schema-rehearsal` with project ref `xjcyeuvzkhtzsheknaiu`.
- Pre-existing preview migration-ledger drift was resolved by adding local no-op
  marker files for preview-only remote versions `20260621105831` through
  `20260621110336`, then repairing the preview ledger to mark already-present
  local shared-db baseline migrations as applied.
- `20260622043000_crm_contact_segments.sql` was genuinely missing on preview,
  so it was applied with `supabase db push --include-all`.
- A normal `supabase db push --dry-run` now reports: `Remote database is up to date.`
- The additive migration was applied to preview with `supabase db query --linked`
  for validation only.
- `node tools/sync-plm-master-data.mjs --apply --linked` imported the live API
  payload into preview twice. Both runs reported 55 customers, 37 licensors,
  468 properties, and 560 raw records upserted.
- Post-import preview counts were:
  - `plm.customer_import`: 55
  - `plm.licensor_import`: 37
  - `plm.property_import`: 468
  - PLM customer source refs: 55
  - PLM licensor source refs: 37
  - PLM property source refs: 468
  - PLM raw records: 560
  - raw records still containing `customers_passw`: 0
