# Using PLM Master Data Tables for Master Data

This file is for Master Data work that lives in the `u2giants/popdam3` repo. It is separate from DAM's `use_plm_tables.md` because DAM and Master Data share the repo but should not share one set of app instructions.

The shared Supabase PLM master-data import is designed as a bridge: today it imports from the live Designflow PLM API, and later PLM can cut over to using the same Supabase database as its backend without creating new canonical IDs.

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

## Tables Master Data Should Know

Use these tables as the shared identity layer:

- `core.company`: canonical customer/company identity. PLM customers import here.
- `core.company_source_ref`: PLM customer lineage. For PLM customers, use `source_system = 'designflow_plm'` and `source_table = 'customers'`. `source_id` is the durable PLM `customers_id`; `source_code` is the PLM `customers_code`.
- `core.licensor`: canonical licensor identity.
- `core.property`: canonical property identity, linked to `core.licensor` by `licensor_id`.
- `core.taxonomy_source_ref`: PLM lineage for licensors and properties. For PLM rows, use `source_system = 'designflow_plm'` and `source_table = 'merchGroup'`. `source_id` is the merch-group `id`; `source_code` is the relevant merch-group code.
- `plm.customer_import`: PLM-shaped customer import row linked to `core.company.id`.
- `plm.licensor_import`: PLM-shaped licensor import row linked to `core.licensor.id`.
- `plm.property_import`: PLM-shaped property import row linked to `core.property.id` and `core.licensor.id`.
- `ingest.sync_run`, `ingest.raw_record`: raw import audit trail for each sync. Do not query these from the browser.

Production was populated on 2026-06-25 with 55 PLM customers, 37 licensors, 468 properties, and 560 raw ingest records. The import redacts `customers_passw`; stored raw records should not contain that field.

## How Master Data Should Use The Data

For read-only master-data screens, prefer canonical `core` rows plus PLM source refs. Use the `plm.*_import` tables only when the screen needs a source-shaped PLM field that does not belong in `core`.

For customer identity:

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

For licensor/property identity:

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

If Master Data needs direct browser reads, create an RLS-safe `api.*` view or RPC in `u2giants/shared-db` first. Do not make the browser depend on internal import tables unless that contract has been explicitly reviewed and documented.

## Write Path Guidance

Today, the existing PLM API remains the operational write path for these entities unless a shared-db contract says otherwise. The Supabase `plm.*_import` tables are import snapshots, not a CRUD surface for app code.

If a Master Data screen needs to edit customers/licensors/properties against Supabase, decide backend ownership first and implement the contract in `u2giants/shared-db`. Future PLM cutover should reuse these existing canonical IDs by matching source refs first, then backfilling richer PLM operational tables.

## Future PLM Cutover Rules

The source refs are the bridge between today's API rows and tomorrow's PLM-on-Supabase tables. Keep them stable.

- Match future PLM imports on `core.company_source_ref` or `core.taxonomy_source_ref` first.
- Reuse existing `core.company`, `core.licensor`, and `core.property` IDs.
- Backfill richer `plm.*` operational tables around those IDs.
- If old API/table shapes are needed later, create compatibility views or service-layer mapping over `core` plus `plm` tables.
- Do not create a second canonical identity set during cutover.

## What Not To Do

- Do not treat `plm.*_import` as the live editable PLM backend until an explicit shared-db contract says so.
- Do not generate new canonical IDs for rows that already have PLM source refs.
- Do not change PLM source refs, `source_system`, or `source_table` values. The future PLM database cutover depends on those stable keys.
- Do not expose the PLM API key to the frontend.
- Do not read `ingest.raw_record` from browser code.
- Do not store UI/workflow-only state in `core` or in import snapshot tables.
- Do not edit the mirrored `shared-db/` folder inside this app repo. Shared schema changes belong in canonical `u2giants/shared-db`.
- Do not rename/drop shared tables, columns, views, or policies without the shared-db preview-first workflow.

## Documentation Rule

When changing how Master Data uses these PLM tables, document both sides:

- In this repo: update the relevant Master Data docs, API notes, or this file.
- In `u2giants/shared-db`: update schema/API docs if the change affects shared tables, RLS, views, RPCs, imports, or cross-app data contracts.

Future sessions should start by checking this file, DAM's separate `use_plm_tables.md`, `AGENTS.md`, and the canonical `shared-db` docs before changing customer/licensor/property behavior.
