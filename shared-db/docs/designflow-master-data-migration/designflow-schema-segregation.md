# DesignFlow Cloud SQL → Supabase Schema Segregation

**Status:** Analysis complete — ready for landing-schema load and phased `ALTER TABLE ... SET SCHEMA` moves.

**Last updated:** 2026-07-08

**Source:** Cloud SQL schema `designflow` (103 base tables), confirmed via owner export.

**Companion docs:**

- [Master data migration plan](./README.md) — MG01–MG10, customers, division semantics, import rules
- [Unified schema map](../unified-supabase-schema-map.md) — target schema purposes
- [Shared database vision](../shared-database-vision.md) — canonical ownership rules

---

## 1. Purpose

DesignFlow data will first land in a Supabase **`designflow` staging schema** (full copy of Cloud SQL tables + data). This document defines **where each table belongs** in the shared Supabase logical schemas after segregation:

| Target schema | Role |
|---|---|
| `core` | Canonical shared master data (customers, factories, taxonomy, art/age reference) |
| `app` | Shared app support (users, roles, audit, notifications, settings) |
| `plm` | PLM operational data (items, orders, RFQ, licensing workflow, grids, samples, PLM config) |
| `pim` | PM workflow tables *(none in current DesignFlow export)* |
| `crm` / `dam` | App-owned workflow — *no DesignFlow source tables in this export* |
| `ingest` | Raw sync snapshots only — *no DesignFlow business tables* |
| `api` | Views/RPCs only — *no physical table moves* |

**Not in scope for this pass:** rewriting `merchGroup` rows into typed `core.product_type` / `core.licensor` tables — that is Phase B+ per [README.md](./README.md). This doc assigns **whole-table** placement first.

---

## 2. Agreed decisions (owner-confirmed)

| Topic | Decision |
|---|---|
| `DesignTeamTime`, `DesignTeamTimes` | **`plm`** — production/design-time tracking, not PM workflow |
| `age_group`, `artists`, `art_types`, `artist_types` | **`core`** — promoted from PLM config to shared canonical reference |
| `merchGroup` MG05/MG06 labels | Div **01**/**08**: Licensor/Property; div **09**: Big Theme/Little Theme (see README) |
| Division codes | Document as **01**, **08**, **09** (DB FK integers 1, 8, 9) |

---

## 3. Summary counts

| Target schema | Tables | Notes |
|---|---:|---|
| **`core`** | **18** | Shared master data + art/age taxonomy |
| **`app`** | **13** | Users, roles, audit, notifications |
| **`plm`** | **72** | Operational PLM + config/reference remaining in PLM |
| **`pim`** | **0** | No DesignFlow tables in this export |
| **Total** | **103** | Matches `information_schema` table list |

---

## 4. Full table mapping

### 4.1 `core` — shared master data (18 tables)

| # | `designflow` table | Supabase target | Notes |
|---:|---|---|---|
| 1 | `customers` | `core.customer` (+ `plm.customer_import` staging) | 55 rows; `customers_status='ACTIVE'` for API parity |
| 2 | `externalCustomer` | `core.customer` lineage via `core.company_source_ref` | ERP-shaped customer rows |
| 3 | `Factory` | `core.factory` | Shared factory identity |
| 4 | `vendor` | `core.factory` / vendor contact pattern | PLM vendor accounts; map to `core` factory/vendor model |
| 5 | `vendorGroup` | `core` (factory group metadata) | Vendor grouping |
| 6 | `externalVendor` | `core` source-shaped staging | ERP vendor export |
| 7 | `product_category` | `core.product_category` | PM/DAM/PLM shared taxonomy |
| 8 | `merchGroup` | Typed `core.*` tables per `mgTypeCode` | See [README.md](./README.md) §3–§9 |
| 9 | `merchGroupHeaders` | `core` metadata / `plm.merch_group_import` | MG header grouping by division |
| 10 | `merchGroupMaster` | `core` lineage | Master MG tree (relations use this) |
| 11 | `merchGroupRelations` | `core` hierarchy metadata | Parent/child MG relations |
| 12 | `licenseList` | `core.licensor` | Legacy licensor list; reconcile with MG05 |
| 13 | `properties_and_characters` | `core.property` + `core.character` | Discriminated by `type` column |
| 14 | `property_character_associations` | `core` junction metadata | Property ↔ character ↔ licensor |
| 15 | `age_group` | `core.age_group` | **Owner: move to core** |
| 16 | `artists` | `core.artist` | **Owner: move to core** |
| 17 | `art_types` | `core.art_type` | **Owner: move to core** (MG07 Art Type div 09) |
| 18 | `artist_types` | `core` reference | **Owner: move to core** |

### 4.2 `app` — shared application support (13 tables)

| # | `designflow` table | Supabase target | Notes |
|---:|---|---|---|
| 1 | `users` | `app.profile` + Supabase Auth cross-ref | Do not copy `passw` to production |
| 2 | `Roles` | `app.role` | |
| 3 | `RolePermissions` | `app` permissions | Links users/roles/UI elements |
| 4 | `UIElements` | `app` UI permission tree | |
| 5 | `auth_token` | `app` session tokens | Service-role only |
| 6 | `quote_auth_token` | `app` quote session tokens | |
| 7 | `AdditionalUserEmail` | `app` user emails | |
| 8 | `AuditLog` | `app.activity` / audit store | |
| 9 | `comments` | `app.comment` | Item comments; polymorphic link to PLM item |
| 10 | `user_notification` | `app.notification` | |
| 11 | `email_logs` | `app` / operational log | |
| 12 | `app_settings` | `app` settings | |
| 13 | `ai_cache_events` | `app` telemetry cache | |

### 4.3 `plm` — PLM operational + config (72 tables)

#### Production & logistics

| # | `designflow` table | Notes |
|---:|---|---|
| 1 | `ContainerHeader` | Container/shipment logistics |
| 2 | `ProdOrderHeader` | Production order header |
| 3 | `ProdOrderDetail` | Production order lines |
| 4 | `ProdPaymentTerms` | Payment terms reference |
| 5 | `ProdShipmentTransitTime` | Transit time reference |
| 6 | `ShippingPort` | Port reference |
| 7 | `item_prod_order_detail_associations` | Item ↔ prod order line bridge |

#### Design / factory / licensing time tracking

| # | `designflow` table | Notes |
|---:|---|---|
| 8 | `DesignTeamTime` | Production tracking (owner: **plm**) |
| 9 | `DesignTeamTimes` | Legacy parallel table |
| 10 | `FactoryTime` | Factory lead-time reference |
| 11 | `FactoryTimes` | Legacy parallel table |
| 12 | `LicensingTime` | Licensor submission timing |
| 13 | `LicensingTimes` | Legacy parallel table |
| 14 | `OrderLeadTime` | Computed lead-time rollup |

#### Item master

| # | `designflow` table | Notes |
|---:|---|---|
| 15 | `itemHeader` | PLM item master header |
| 16 | `itemDetail` | SKU/size-level detail |
| 17 | `itemAttachment` | Item file attachments |
| 18 | `itemSize` | Size reference |
| 19 | `itemDepth` | Depth reference |
| 20 | `itemType` | Standardized item type templates |
| 21 | `itemLicenseImage` | Licensing phase images |
| 22 | `item_character_associations` | Item ↔ character links |
| 23 | `productUserAssignment` | Item user role assignments |
| 24 | `ProductNickname` | Product nickname config (MG FK refs) |

#### Art pieces (operational)

| # | `designflow` table | Notes |
|---:|---|---|
| 25 | `art_piece` | Operational art records; FKs to `core` + `merchGroup` |
| 26 | `art_piece_attachment` | Art piece files |

#### Licensing workflow

| # | `designflow` table | Notes |
|---:|---|---|
| 27 | `licensingStatus` | Item licensing status thread |
| 28 | `licensingMilestone` | Licensing milestones |
| 29 | `licensingFeedbackReply` | Feedback replies |
| 30 | `LicenseFeedBacks` | Feedback phase definitions |
| 31 | `groups` | Tagged user groups (Teams integration) |

#### RFQ

| # | `designflow` table | Notes |
|---:|---|---|
| 32 | `RFQItem` | RFQ line items |
| 33 | `RFQVendor` | Vendor quotes per RFQ item |
| 34 | `RFQGroup` | RFQ grouping |
| 35 | `RFQStep` | RFQ workflow steps |
| 36 | `RFQContainer` | RFQ container pricing |
| 37 | `RFQWhse` | RFQ warehouse pricing |
| 38 | `RFQItemDivision` | RFQ item ↔ division |
| 39 | `RFQItemStatus` | RFQ status codes |

#### Sample tracking

| # | `designflow` table | Notes |
|---:|---|---|
| 40 | `sample` | Sample tracking |
| 41 | `sample_attachment` | Sample files |
| 42 | `sample_box` | Sample boxes |
| 43 | `sample_comments` | Sample comments |
| 44 | `sample_event` | Sample status events |
| 45 | `sample_factory_group` | Factory sample groups |
| 46 | `sample_shipment_item` | Sample shipment items |

#### Grid / view config (PLM UI)

| # | `designflow` table | Notes |
|---:|---|---|
| 47 | `GridLayout` | Column layout |
| 48 | `GridChildrenLayout` | Child column layout |
| 49 | `GridChildrenLayoutOrder` | Column order |
| 50 | `GridAccessLevel` | Column access levels |
| 51 | `GridViewState` | Saved AG Grid state |
| 52 | `grid_cell_notes` | Cell-level notes |

#### Standardized products (PLM config)

| # | `designflow` table | Notes |
|---:|---|---|
| 53 | `StandardizedDetail` | |
| 54 | `StandardizedGroup` | |
| 55 | `StandardizedProductElement` | |
| 56 | `StandardizedProductElementValue` | |
| 57 | `StandardizedProductType` | |
| 58 | `StandardizedSize` | |
| 59 | `StandardizedVendor` | |
| 60 | `StandardizedVersion` | |

#### UDF config (PLM)

| # | `designflow` table | Notes |
|---:|---|---|
| 61 | `UDFComponent` | |
| 62 | `UDFElement` | |
| 63 | `UDFElementType` | |
| 64 | `UDFGroup` | |
| 65 | `UDFQuery` | |
| 66 | `UDFTable` | |

#### PLM reference / scope tables

| # | `designflow` table | Notes |
|---:|---|---|
| 67 | `companyCode` | Company scope (EDGEHOME) |
| 68 | `divisionCode` | Divisions **01**, **08**, **09** |
| 69 | `deliveryLocation` | Delivery locations |
| 70 | `SeasonCode` | Season reference |
| 71 | `FOBCountry` | FOB country reference |
| 72 | `externalApi` | External API config |

---

## 5. Cross-schema FK hotspots (after move)

When tables move out of `designflow`, these FKs become **cross-schema** and must be recreated explicitly:

| Child (schema) | Column | Parent (schema) |
|---|---|---|
| `plm.art_piece` | `age_group_id`, `art_source_id`, `art_type_id`, `artist_id`, `licensor_id`, `property_id`, `style_guide_id`, … | `core.*` or `core.merchGroup` lineage |
| `plm.art_piece` | `divisioncode_id` | `plm.divisionCode` |
| `plm.art_piece` | `created_by`, `updated_by` | `app.users` |
| `core.artists` | `art_source_id` | `core` (merchGroup MG08 lineage) |
| `core.artists` | `artist_type_id` | `core.artist_types` |
| `core.artists` | `divisioncode_id` | `plm.divisionCode` or promoted `core` ref |
| `plm.itemHeader` | `udf_merchgroup*_id` | `core` merchGroup lineage |
| `plm.item_character_associations` | `character_id` | `core.properties_and_characters` |
| `plm.properties_and_characters` | `licensor_id` | `core.licenseList` |
| `plm.sample_comments` | `user_id` | `app.users` |
| `app.RolePermissions` | `UserId` | `app.users` |

**Note:** While data still lives in unified `designflow` staging, all FKs are same-schema. Run segregation in **dependency order** (parents before children).

---

## 6. Recommended move order

```
1. designflow  (landing — load all 103 tables + data here first)

2. core        (18 tables — master data, no FK deps on plm children)
   → companyCode, divisionCode could move to core later; currently plm

3. app         (13 tables — users/roles first within app)

4. plm         (72 tables — operational, in dependency order):
   a. Reference: companyCode, divisionCode, SeasonCode, FOBCountry, ...
   b. Item master: itemHeader → itemDetail → itemAttachment
   c. Art: art_piece → art_piece_attachment
   d. Production: ProdOrderHeader → ProdOrderDetail → associations
   e. Licensing, RFQ, samples, grids
```

---

## 7. `merchGroup` import reminder (does not change table placement)

Whole `merchGroup` table stays mapped to **`core`** (typed import). Import rules from [README.md](./README.md):

| Rule | Detail |
|---|---|
| Import filter | `mgTypeCode IN ('01'…'10')` only |
| MG04, MG05 | Import **all rows** regardless of `is_active` |
| MG03 orphan | **Exclude** 1 row |
| MG02 inactive orphans | **Skip** 54 rows |
| Expected import | **~2,660 rows** into typed `core.*` tables |

---

## 8. What is NOT migrated from this list

| Schema | Why empty |
|---|---|
| `pim` | No DesignFlow source tables — PM data comes from Directus/PM app |
| `crm` | No DesignFlow source tables — CRM has its own workflow tables |
| `dam` | No DesignFlow source tables — PopDAM legacy stays in `public` for now |
| `ingest` | Populated by import jobs (`ingest.raw_record`), not by moving DesignFlow tables |

---

## 9. Next steps

1. Load all 103 tables into Supabase **`designflow`** staging schema (preview branch first).
2. Validate row counts match Cloud SQL.
3. Generate `ALTER TABLE designflow.<table> SET SCHEMA <target>;` script in dependency order (§6).
4. Recreate cross-schema FKs and verify grants/RLS.
5. Begin typed master-data import (`merchGroup` → `core.*`) per [README.md](./README.md) Phase B.

---

## 10. Document history

| Date | Change |
|---|---|
| 2026-07-08 | Initial full 103-table segregation map |
| 2026-07-08 | `DesignTeamTime(s)` → `plm`; `age_group`/`artists`/`art_types`/`artist_types` → `core` |
