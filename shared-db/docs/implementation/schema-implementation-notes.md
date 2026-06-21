# Schema Implementation Notes

Date: 2026-06-21

These migrations implement the first migration-ready version of the unified Supabase schema described in the mapping docs. They are intentionally DDL-only and have not been applied to the live Supabase project.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/20260621000100_foundation.sql` | Extensions, logical schemas, shared enums, timestamp trigger helper, and schema comments. |
| `supabase/migrations/20260621000200_app_core.sql` | Shared app/profile/role tables, canonical `core` business objects, source-reference spines, SKU refs, and auth helper functions. |
| `supabase/migrations/20260621000300_domain_tables.sql` | DAM, CRM, PIM/PM, PLM, ingest, and cross-domain bridge tables. |
| `supabase/migrations/20260621000400_api_rls_realtime.sql` | Browser-facing `api` views, RLS scaffolding, grants, and selected realtime publication tables. |

## What This Implements

- One Supabase project with logical schemas: `app`, `core`, `dam`, `pim`, `crm`, `plm`, `ingest`, and `api`.
- Shared canonical owners for duplicate business objects:
  - customers/accounts in `core.company`
  - buyers/contacts in `core.contact`
  - licensors/properties/characters in `core`
  - factories/vendors in `core.factory`
  - product/category/merch/SKU matching in `core`
- App-owned domain tables for DAM, CRM, PM/PIM, and PLM.
- Explicit source-reference tables instead of overwriting Directus, PopDAM, PLM, ClickUp, or ERP ids.
- Bridge tables for the important crossover points:
  - `pim.product.plm_item_id`
  - `pim.product_style_group`
  - `pim.design_asset`
  - `crm.opportunity.project_id`
  - `crm.opportunity_product`
  - `pim.customer_order.production_order_id`
- Stable first-pass `api` views for frontend contracts.
- RLS enabled across app/domain tables, with conservative policies.
- Realtime publication candidates for user-facing movement, not worker/admin queues.

## What This Does Not Do Yet

- It does not migrate data.
- It does not physically move existing PopDAM public tables.
- It does not import Directus system metadata.
- It does not migrate files from DigitalOcean Spaces or Directus storage.
- It does not implement final vendor row scoping.
- It does not expose pricing-safe role-specific PLM/RFQ views yet.
- It does not include PLM sample tracking because the selected `main` source does not contain those models.

## Rehearsal Order

1. Apply these migrations only to a disposable Supabase branch/project.
2. Restore or load source data into staging/import tables.
3. Populate `core.*_source_ref` and `core.sku_ref` before merging duplicates.
4. Backfill canonical `core` rows.
5. Load domain tables with preserved `external_source` and `external_id`.
6. Run dedupe reports and reject uncertain matches before hard-linking DAM/PM/PLM entities.
7. Test RLS with real Supabase Auth users and app access rows.
8. Enable/write frontend adapters against `api` views or RPCs.
9. Only then plan a production migration or cutover.

## RLS Notes

The policies are a scaffold, not final authorization.

- `administrator` can write most shared/domain data.
- PM writes are limited to administrator/licensing/designer/sales roles.
- CRM writes are limited to administrator/sales/licensing roles.
- DAM writes are limited to administrator/designer/licensing roles for library data.
- PLM writes are administrator-only because PLM data should normally come from service-side syncs.
- Worker queues, raw ingest, source refs, and admin helper tables are admin-only or service-role-only.

Before production use, add field-safe views for pricing/cost data and implement user-to-factory/vendor mapping before granting vendor product/order access.
