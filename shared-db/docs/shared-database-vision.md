# Shared Database Vision

This repo exists to move POP from several overlapping app backends into one shared Supabase database that powers four enterprise applications:

- DAM: digital asset management, style groups, style guides, render/processing work, and asset-to-product links.
- CRM: companies, contacts, departments, opportunities, communication workflow, approvals, notes, and tasks.
- PM/PIM: projects, products, designs, design collections, licensing workflow, samples, revisions, orders, assignments, and saved views.
- PLM: operational item master, production orders, factories/vendors, licensing status, RFQ/ERP references, and production-facing workflow data.

The intention is not four separate databases that sync occasionally. The intention is one large shared database, with logical schemas and carefully controlled API contracts, so the same business objects can be used everywhere in realtime.

## Why One Database

The four apps overlap heavily:

- CRM accounts are PM customers and PLM customers.
- CRM contacts are PM buyers and account stakeholders.
- PM products become DAM style groups/assets and PLM items.
- DAM assets should appear inside PM product/design workflows without file duplication.
- PM orders and PLM production orders need to describe the same operational reality.
- Licensors, properties, characters, factories, vendors, product taxonomy, and SKUs need one canonical identity.

If each app owns a separate database, every app has to invent its own customer, contact, product, factory, asset, and order records. That creates duplicate rows, stale syncs, uncertain joins, and delayed cross-app actions.

In the shared model, apps communicate by reading and writing canonical database rows in the same Supabase project. Realtime updates come from one database state, not from frontend-to-frontend messaging.

## Architectural Shape

The shared database uses logical schemas:

| Schema | Role |
|---|---|
| `app` | shared app support: profiles, roles, app access, comments, activity, notifications, generic files |
| `core` | canonical shared business objects: companies, contacts, licensors, properties, characters, factories, product taxonomy, SKU refs |
| `dam` | DAM-owned assets, style groups, style guides, helper/agent state, queues, DAM snapshots |
| `crm` | CRM-owned opportunities, departments, email/meeting workflow, tasks, notes, approval threads |
| `pim` | PM/PIM-owned products, projects, designs, workflow, submissions, samples, revisions, orders, saved views |
| `plm` | PLM-owned item master, production orders, licensing/RFQ/ERP operational data |
| `ingest` | raw imports, sync runs, source snapshots, dedupe candidates |
| `api` | stable browser-facing views and RPC contracts |

The key split is:

- shared identity and reference objects go in `core`;
- app workflow tables stay in their app schema;
- raw imports and sync records go in `ingest`;
- frontend-facing joined shapes go in `api`.

## Canonical Ownership

These objects should have one canonical owner:

| Business object | Canonical owner |
|---|---|
| Customer/account/company | `core.company` |
| Contact/buyer/person | `core.contact` |
| Company-contact relationship | `core.contact_company` |
| Licensor | `core.licensor` |
| Property | `core.property` |
| Character | `core.character` |
| Factory/vendor identity | `core.factory` |
| Product category/type/subtype | `core.product_category`, `core.product_type`, `core.product_subtype` |
| SKU/style/item reference spine | `core.sku_ref` |
| CRM opportunity | `crm.opportunity` |
| PM product/project/design workflow | `pim.product`, `pim.project`, `pim.design` |
| DAM asset/style group | `dam.asset`, `dam.style_group` |
| PLM item/production order | `plm.item`, `plm.production_order` |

Apps can own workflows, but they should not duplicate shared identity tables.

## Realtime Intention

The desired user experience is cross-app immediacy:

- A CRM opportunity can create or update PM work.
- PM product movement can be visible to CRM account teams.
- DAM asset links can appear on PM product/design screens.
- PLM production/order state can inform PM and CRM views.
- Shared comments, activity, and notifications can reflect work across apps.

That does not mean every table is realtime-enabled. Realtime should be enabled only for user-facing state, with RLS in place first. Worker queues, raw ingest tables, helper tokens, and sensitive PLM/RFQ/cost data should not be broadly streamed to browsers.

## Migration Principle

Move carefully:

1. Build and test schema changes on the Supabase preview branch.
2. Keep existing PopDAM production tables stable while shared schemas are added.
3. Preserve all source ids through source-reference tables.
4. Dedupe canonical objects before hard-linking app data.
5. Switch frontends through `api` views/RPCs or stable table contracts.
6. Promote to production only from committed migrations in this repo.

The first successful milestone is not "all apps rewritten." The first milestone is: the shared schemas exist, PopDAM still works, and CRM/PM can be tested against the preview branch without creating another silo.
