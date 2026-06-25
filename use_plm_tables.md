# Using PLM Master Data Tables in DAM

This app shares one Supabase database with CRM, PM/PIM, and PLM. The PLM master-data import is the canonical source for customers, licensors, and properties. Treat these rows as shared identities, not DAM-owned lookup lists.

## Current Source of Truth

PLM data is imported from the live Designflow API into the shared Supabase project.

- Production Supabase project: `qsllyeztdwjgirsysgai`
- Preview Supabase project: `xjcyeuvzkhtzsheknaiu`
- Shared schema repo: `u2giants/shared-db`
- Migration that created the import path: `supabase/migrations/20260624173000_plm_master_data_import.sql`
- Import tool: `tools/sync-plm-master-data.mjs`
- Import source system value: `designflow_plm`

API sources inspected before the schema was finalized:

- Customers: `https://api.designflow.app/api/core/customers/getCustomers`
- Licensors/properties: `https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties`

The PLM API key is read-only and belongs only in server/admin tooling. Never put it in browser code, frontend env, logs, screenshots, fixtures, or committed docs.

## Tables DAM Should Know

Use these tables as the stable master-data identity layer:

- `core.company`: canonical customer/company identity.
- `core.company_source_ref`: PLM customer lineage. For PLM customers, use `source_system = 'designflow_plm'` and `source_table = 'customers'`.
- `core.licensor`: canonical licensor identity.
- `core.property`: canonical property identity. Properties keep their licensor relationship through `licensor_id`.
- `core.taxonomy_source_ref`: PLM lineage for licensors and properties. For PLM rows, use `source_system = 'designflow_plm'` and `source_table = 'merchGroup'`.
- `plm.customer_import`, `plm.licensor_import`, `plm.property_import`: PLM-shaped import snapshots linked to `core` IDs. These are for admin/debugging or server-side reconciliation, not normal DAM UI state.
- `ingest.sync_run`, `ingest.raw_record`: raw import audit trail. Do not query these from the browser.

Production was populated on 2026-06-25 with 55 PLM customers, 37 licensors, 468 properties, and 560 raw ingest records. The import redacts `customers_passw`; stored raw records should not contain that field.

## How DAM Should Use The Data

Use PLM-backed `core` rows when DAM needs customer, licensor, or property identity for assets, style groups, style guides, filters, matching, or metadata review.

For customer matching, join `core.company` to `core.company_source_ref` and preserve DAM's original evidence separately. For example, if a customer came from a NAS path, asset path, style-group folder, or uploaded metadata string, keep that original string in the DAM-owned table and link the resolved customer to `core.company.id`.

For licensor/property matching, use `core.licensor` and `core.property`. Use `core.taxonomy_source_ref` when you need the durable PLM merch-group ID/code.

Example customer lookup shape:

```sql
select
  c.id,
  c.name,
  csr.source_id as plm_customer_id,
  csr.source_code as plm_customer_code
from core.company c
join core.company_source_ref csr on csr.company_id = c.id
where csr.source_system = 'designflow_plm'
  and csr.source_table = 'customers';
```

Example property lookup shape:

```sql
select
  p.id,
  p.name,
  p.licensor_id,
  l.name as licensor_name,
  tsr.source_id as plm_merch_group_id,
  tsr.source_code as plm_property_code
from core.property p
join core.licensor l on l.id = p.licensor_id
join core.taxonomy_source_ref tsr
  on tsr.entity_schema = 'core'
 and tsr.entity_table = 'property'
 and tsr.entity_id = p.id
where tsr.source_system = 'designflow_plm'
  and tsr.source_table = 'merchGroup';
```

If browser access needs a simpler/RLS-safe contract, add an `api.dam_*` view or RPC in `u2giants/shared-db` instead of teaching DAM to read internal import tables directly.

## What Not To Do

- Do not create a DAM-owned duplicate customer/licensor/property master-data table as the new source of truth.
- Do not write to `plm.*_import`, `core.*_source_ref`, or `ingest.*` from DAM UI code.
- Do not change PLM source refs, `source_system`, or `source_table` values. The future PLM database cutover depends on those stable keys.
- Do not expose the PLM API key to the frontend. Import refreshes belong in server/admin tooling.
- Do not read `ingest.raw_record` from browser code.
- Do not use fuzzy names as durable relationships when a PLM source ref exists.
- Do not edit the mirrored `shared-db/` folder inside this app repo. Shared schema changes belong in canonical `u2giants/shared-db`.
- Do not rename/drop shared tables, columns, views, or policies from an app repo.

## If DAM Needs More Fields

If DAM needs an app-specific annotation, add a DAM-owned extension table keyed to the canonical row, for example a table that references `core.company.id`, `core.licensor.id`, or `core.property.id`. Do not add DAM workflow fields to `plm.*_import`; those tables are source-shaped snapshots.

If DAM needs a new shared API contract, make a timestamped migration in `u2giants/shared-db`, apply it to preview first, verify it with the DAM screen, then promote to production through the shared-db workflow.

## Documentation Rule

When changing how DAM uses these PLM tables, document both sides:

- In this repo: update the relevant DAM docs, API notes, or this file.
- In `u2giants/shared-db`: update schema/API docs if the change affects shared tables, RLS, views, RPCs, imports, or cross-app data contracts.

Future sessions should start by checking this file, `AGENTS.md`, and the canonical `shared-db` docs before changing customer/licensor/property behavior.
