# Shared Database Vision

This repo exists to move POP from several overlapping app backends into one shared Supabase database that powers four enterprise applications:

- DAM: digital asset management, style groups, style guides, render/processing work, and asset-to-product links.
- CRM: customers, contacts, departments, opportunities, communication workflow, approvals, notes, and tasks.
- PM/PIM: projects, products, designs, design collections, licensing workflow, samples, revisions, orders, assignments, and saved views.
- PLM: operational item master, production orders, factories/vendors, licensing status, RFQ/ERP references, and production-facing workflow data.

The intention is not four separate databases that sync occasionally. The intention is one large shared database, with logical schemas and carefully controlled API contracts, so the same business objects can be used everywhere in realtime.

## Why One Database

The four apps overlap heavily:

- CRM customers are PM customers and PLM customers.
- CRM contacts are PM buyers and customer stakeholders.
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
| Customer (potential or active) | `core.customer` |
| CRM ingested email domain (NOT a customer) | `crm.ingested_domain` |
| Factory / vendor (a company, but not a customer) | `core.factory` |
| Licensor (a company, but not a customer) | `core.licensor` |
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

## Customer vs. Company vs. Ingested Domain

This distinction is easy to get wrong, and getting it wrong pollutes the shared
database, so it is spelled out here as the rule for all four apps.

**"Company" is not a useful shared bucket.** A factory is a company. A licensor is
a company. A spammer is a company. None of those belong in a list of customers.
So there is no `core.company`; the shared hub is **`core.customer`**, and the
other kinds of company have their own homes (`core.factory`, `core.licensor`).

**There are three different concepts. They are not the same thing.**

| Concept | What it is | Where it lives | Who sees it |
|---|---|---|---|
| **Ingested domain** | A domain that merely *appeared in an ingested email*. We receive email from ~1000 kinds of companies — recruiters, vendors, spam, partners. Email **noise** / a CRM triage inbox, not a business relationship. | `crm.ingested_domain` | **CRM only.** No other app reads it or FKs to it. |
| **Potential customer** | A company we have **not yet done business with** but are tracking and may transact with in the future. | `core.customer` with `is_potential = true` (no ERP/PLM source ref) | Shared, but it is a `core.customer` row. |
| **Active customer** | A company we **have actually done business with**. Authoritative source is PLM/ERP (ColdLion) only. | `core.customer` with `is_potential = false` **and** a `designflow_plm` / `coldlion` source ref | Shared (CRM, PM, PLM, DAM). |

Key rules:

- **An ingested domain is not a customer.** It must never be written into
  `core.customer` by the email worker. The worker calls
  `crm.record_ingested_domain(...)`, which only touches `crm.ingested_domain`.
  Other apps must never join to `crm.ingested_domain` — it is CRM-private.
- **Garbage never enters the important table.** Ingested domains must never
  create, promote into, source-ref, FK to, or otherwise associate with
  `core.customer`. There is no ingested-domain promotion path.
- **Active customers come only from PLM/ERP.** A customer becomes active only
  when ColdLion/PLM confirms the relationship and an ERP/PLM source ref is
  attached. The `is_potential` flag is the shared signal every app uses; it is
  kept authoritative by the `core.sync_customer_potential` trigger, which flips it
  to `false` the moment a `designflow_plm`/`coldlion` source ref lands.
- The CRM `customer_status` column (`ACTIVE_CUSTOMER` / `POTENTIAL_CUSTOMER` /
  `OTHER` / `UNASSIGNED`) is CRM's *subjective* triage opinion and is a different
  axis from the factual `is_potential` (owned by ERP).

Customer-logo contract:

- Logo inventory belongs to **customers**, not ingested domains. Do not derive or
  assign customer logos from `crm.ingested_domain`; those rows are email evidence
  only and must not be promoted into `core.customer`.
- `plm.customer_import.logo_url` carries the PLM/ERP `customers_logo` value when
  the source provides one. That stored URL is the intended source for full-width
  customer logos.
- Domain-derived logo services such as logo.dev are only a convenience fallback
  for compact token marks keyed on `core.customer.domain`. They are not a
  substitute for the stored full-width logo, because resizing the same provider
  image can show the same mark in both slots.
- Browser apps that need full logos should read a stable customer-named API
  field, e.g. `api.crm_customer_list.logo_url`, sourced from
  `plm.customer_import.logo_url`.
  CRM-specific customer screens should use `api.crm_customer_list`, not legacy
  account-named compatibility views.

### Lifecycle: customer identity

```txt
crm.ingested_domain (email noise)
   │
   └─ no customer FK, no promotion, no source ref, no picker use

core.customer  (customer candidate from CRM/PM customer workflow, not email-domain ingestion)
   │  plm.import_master_data()        — ColdLion confirms we transacted
   ▼
core.customer  (active: SAME row, is_potential = false, now has an ERP source ref)
```

The critical property: **a potential customer and the active customer it becomes
are the same `core.customer` row.** Going active is a metadata change — attach an
ERP source ref, the trigger flips `is_potential` — **not** a move between tables.
So nothing that already points at the customer (opportunities, projects, emails,
PLM items, DAM assets) ever has to be re-pointed.

### Do NOT build a separate "CRM/PM customer" table to union with PLM's

A tempting design is: potential customers in their own `crm`/`pim` table, ERP
customers in PLM's canonical table, joined by a union view, with a dedupe job that
re-points everything when a potential customer graduates into the ERP list.
**Don't.** That recreates the exact pain it tries to avoid: when a potential
customer becomes active you must re-point every FK across CRM/PM from the old id
to the ERP id, and you can never have a single FK column that means "either
table."

Instead, the shared model uses **one hub (`core.customer`) + source refs +
entity-resolution on ERP import** — and this is already implemented:
`plm.import_master_data()` (in `20260624173000_plm_master_data_import.sql`), for
each incoming ERP customer:

1. **Already linked?** Look up `core.company_source_ref` for the ERP id → update
   in place.
2. **Not linked → fuzzy match** (`core.match_customer`). ERP and CRM spell the
   same company differently, so this is **not** an exact match. Strongest signal
   first: exact normalized name → exact domain (from the ERP email) → trigram
   name similarity ≥ 0.85. A match is almost always a potential customer CRM/PM
   already created.
3. **Confident match → activate in place:** attach the ERP source ref to that
   existing `core.customer`. The trigger flips `is_potential` to false. No FK
   re-pointing — every existing reference already points at this row.
4. **Ambiguous match (similarity 0.55–0.85) → do NOT auto-merge.** Create the ERP
   customer as its own row and file an `ingest.dedupe_candidate` for a human to
   confirm/merge. Silent auto-merge on a weak match would corrupt the shared hub.
5. **No match → create** a new active `core.customer` with the ERP source ref.

The matcher uses `pg_trgm` similarity with a trigram index on
`core.customer.normalized_name`; thresholds are parameters on
`core.match_customer` so they can be tuned without touching the import. When PLM's
full database lands in this Supabase project, the ERP customer mirror
(`plm.customer_import` today) becomes the authoritative `plm.customer` table and
the same source-ref linkage carries over unchanged.

> Naming note: this was a **hard rename** — there is no object named
> `core.company` anymore, not even a compatibility view. The table rename carries
> its FKs, indexes, RLS, grants, and rowtype automatically; views that referenced
> it follow by object id; only PL/pgSQL functions that named it directly had to
> be recreated against `core.customer`. CRM now exposes customer-named
> `api.crm_customer_*` contracts; legacy `api.crm_account_*` names are
> compatibility objects only. The satellite table
> `core.company_source_ref` and the `company_id` FK columns keep their names for
> now to limit churn; only the hub table was renamed.

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
