# Unified Supabase Schema Map

Date: 2026-06-20

Target Supabase project: `qsllyeztdwjgirsysgai`

This document is the canonical first-pass schema map for moving DAM, CRM, PM, and the operational PLM crossover data into one Supabase project. It is a planning artifact only: no migrations, no production reads, and no database writes were performed.

## Source Baseline

Fresh `main` checkouts were cloned into `/tmp/unified-schema-sources-20260620172820` so existing local worktrees were not disturbed.

| Domain | Repo | Branch | Commit |
|---|---|---:|---|
| DAM | `u2giants/popdam3` | `main` | `e6af4c468aa27c5ad3165a2c329a1a72660dcc49` |
| CRM | `u2giants/popcrm-web` | `main` | `827410d43cc0a1c8ecca4bcbb4796c3ad575a623` |
| PM | `u2giants/poppim-web` | `main` | `bdd5d55f8af97db139e8d4dd38579c132e0e8113` |
| PLM BFF | `popcre/designflow-bff` | `main` | `c5fa8eb4ba179e225257113129486690dd1db8ee` |
| PLM frontend | `popcre/designflow-frontend` | `main` | `34c70677c88157c4e7c97f03d563db5adec3dba2` |
| PLM core backend | `popcre/designflow-backend` | `main` | `5bb41cce44a8c9616da71e7b3a09f0ee9f52cc15` |
| PLM item master | `popcre/designflow-item-master` | `main` | `9fec2cd07a45cf5e3ed5feee8627ad82192a3371` |
| PLM tracking | `popcre/designflow-tracking` | `main` | `08aef686e4d51468f0af9ddd9dbcd43bf45687a0` |
| PLM data sync | `popcre/designflow-data-syncing` | `main` | `5cb7213d6922792b6760ecb4b580087ad500e35c` |

Important branch note: older local PLM `sandbox-albert` checkouts include docs and sample-tracking tables that are not present on authoritative `main`. This map treats `main` as truth and flags sample tracking as absent from the selected PLM baseline.

## Target Schemas

Use one Supabase project with logical schemas. PopDAM currently lives in `public`; do not physically move its live tables during the first mapping/migration pass. Instead, create compatibility views or gradual schema moves later.

| Target schema | Purpose | Browser exposure |
|---|---|---|
| `app` | Shared users, profiles, roles, app access, comments, activity, shared files, audit, notifications | selective RLS and RPCs |
| `core` | Shared companies/customers, contacts, licensors, properties, characters, factories/vendors, product taxonomy | yes through views/RLS |
| `dam` | Assets, style groups, style guides, render/processing queues, helper/agent state | yes for library data; admin queues restricted |
| `pim` | PM products, projects, designs, workflow, submissions, samples, revisions, orders, saved views | yes |
| `crm` | Opportunities, departments, email routing, meetings, notes, tasks, approval threads | yes |
| `plm` | Item master, production orders, RFQ references, licensing status, operational ERP/Coldlion records | mostly service-role or restricted views |
| `ingest` | Raw imports, external snapshots, sync runs, transient staging | no direct browser access |
| `api` | Stable browser-facing views and RPC contracts | yes |

## Canonical Entity Map

Status values:

- `shared`: canonical cross-app business data.
- `app-owned`: belongs to one app, but may reference shared data.
- `staging/import`: raw source, sync, or migration data.
- `cache/generated`: derived, queue, view, rollup, or operational cache.
- `deprecated`: keep only for compatibility or audit.

| Business area | Current source tables/collections | Target owner | Status | Notes |
|---|---|---|---|---|
| People and auth | PopDAM `profiles`, `user_roles`, `invitations`, `app_access`; PM/CRM `directus_users`; PLM `users`, `Roles`, `RolePermissions`, `UIElements`, `auth_token`, `quote_auth_token` | `app.profile`, `app.role`, `app.user_role`, `app.app_access` | shared | Supabase Auth should own identity. PLM and Directus users need cross-reference tables, not copied auth systems. |
| Companies and customers | PM/CRM `retailer`, `ingested_domains`; PLM `customers`, `externalCustomer`; DAM `style_groups.customer`, `assets.customer`, `prod_order_headers_current.customer_*` | `core.company`, `core.company_source_ref` | shared | One canonical company/customer model. Preserve PLM customer ids, Directus ids, and DAM path customer strings as source refs. |
| Contacts and buyers | PM/CRM `buyer`, `ingested_contact`; CRM department primary buyers; PLM users/vendors where acting as contacts | `core.contact`, `core.contact_company` | shared | Buyer/contact should be unified. Keep role/scope/title fields as CRM attributes. |
| Departments/accounts | CRM `crm_department`; PM project/buyer context; PLM customer divisions where relevant | `crm.department` plus FK to `core.company` | app-owned with shared FK | CRM owns operational departments. PM may read department context through `api` views later. |
| Licensors, properties, characters | DAM `licensors`, `properties`, `characters`; PM `licensor`, `property`; PLM `licenseList`, `properties_and_characters`, `property_character_associations`, `item_character_associations` | `core.licensor`, `core.property`, `core.character`, `core.character_ref` | shared | This is one of the biggest duplicate areas. DAM's existing taxonomy should be matched to PLM/PM by external ids/codes/name aliases. |
| Product taxonomy | DAM `product_categories`, `product_types`, `product_subtypes`, `product_category_predictions`; PM `product_type`; PLM `ProductCategory`, `itemType`, `merchGroup`, `merchGroupHeaders`, MG fields | `core.product_category`, `core.product_type`, `core.product_subtype`, `core.merch_group` | shared | Keep PLM MG hierarchy and DAM category predictions. Predictions remain audit/support data. |
| Factories and vendors | PM/CRM `factory`; PLM `Factory`, `vendor`, `vendorGroup`, `externalVendor`, `StandardizedVendor`; DAM `style_groups.factory/vendor` only if derived from ERP/path later | `core.factory`, `core.vendor_contact`, `core.factory_group` | shared | PLM has factory/vendor semantics; PM/CRM need the same rows for row scoping and production visibility. |
| PM projects/offers | PM `project`; CRM opportunities link to `project` | `pim.project` | app-owned with shared FKs | Use `core.company`, `core.contact`, `core.licensor/property`, `pim.design_collection`. |
| PM products/SKUs | PM `product`; ClickUp fields; PLM `itemHeader`; DAM `style_groups.sku`, `assets.sku`, `erp_items_current.style_number` | `pim.product` plus `core.sku_ref` | shared boundary | PM product is workflow/business item. PLM item master is authoritative for production/item details. Link by style/SKU/code and source refs. |
| Designs and design collections | PM `design`, `design_collection`; DAM `assets`, `style_groups`; PLM `artPiece`, `artPieceAttachment` | `pim.design`, `pim.design_collection`, `dam.asset`, `dam.style_group` | shared boundary | PM design records should link to DAM assets/style groups, not duplicate files. |
| DAM assets | PopDAM `assets`, `asset_tags`, `asset_characters`, `asset_path_history`, `style_groups`, `sku_files_used`, `pdf_text_samples`, `scanner_ai_ignores` | `dam.*` | app-owned with shared taxonomy | Existing PopDAM tables remain the live base. Link `assets/style_groups` to `core` taxonomy and `pim.product/design` over time. |
| Style guides / PopSG | PopDAM `style_guide_files`, `style_guide_crawl_runs`, `style_guide_render_queue`, `style_guide_file_groups`, `style_guide_folders`, `sg_archive_usage` | `dam.style_guide_*` | app-owned | Useful to PM/licensing via `sku_files_used`, but still DAM/PopSG-owned. |
| Processing, agents, helper | PopDAM `agent_registrations`, `agent_pairings`, `processing_queue`, `render_queue`, `tiff_optimization_queue`, `helper_devices`, `helper_tokens`, `asset_checkouts` | `dam.*` or `app.device` later | cache/generated | Operational state. Do not expose broadly to PM/CRM. |
| ERP enrichment in DAM | PopDAM `erp_items_current`, `erp_items_raw`, `erp_sync_runs`, `erp_enrichment_log`, `prod_order_headers_current`, `prod_order_headers_raw`, `prod_order_sync_runs` | `ingest.*` raw, `plm.production_order_ref` current views | staging/import | These are snapshots into PopDAM. Long-term, production orders should come from PLM-owned tables or a shared ingest pipeline. |
| CRM pipeline | CRM `crm_opportunity`, `crm_licensor_approval_thread` | `crm.opportunity`, `crm.licensor_approval_thread` | app-owned with shared FKs | Opportunities link to `core.company/contact`, `crm.department`, `core.factory`, `pim.project`, and possibly `pim.product`. |
| CRM communications | CRM `crm_email_message`, `crm_meeting_note`, `crm_note`, `crm_task`, `crm_ignore_rule`, `crm_ai_model_config` | `crm.*` | app-owned/staging | Email bodies/routing are sensitive. Store raw ingested mail separately from curated CRM records. |
| PM workflow | PM `stage`, `stage_history`, `product_submission`, `product_sample`, `revision_request`, `checklist_item`, `subtask`, `product_assignee` | `pim.*` plus `app.comment/activity` | app-owned | `product_sample` is PM workflow, distinct from PLM sample tracking, which is absent on selected PLM `main`. |
| PM collaboration and ClickUp parity | PM `product_file`, `product_update`, `product_tag`, `product_field`, `product_activity`, `product_link`, `product_time_entry`, ClickUp fields on `product` | `pim.*` or `ingest.clickup_*` | staging/import | Preserve fields for parity and audit. Do not make ClickUp metadata the long-term app model. |
| PM saved views | PM `pm_saved_view`, `pm_view_pref` | `pim.saved_view`, `pim.view_pref` | app-owned | Belongs to PM UI, but may reuse `app.profile/role`. |
| PLM item master | PLM `itemHeader`, `itemDetail`, `itemAttachment`, `itemSize`, `itemDepth`, `itemType`, `artPiece`, `artPieceAttachment`, `productUserAssignment` if present | `plm.item`, `plm.item_detail`, `plm.item_attachment`, `plm.art_piece` | shared operational | PLM item master should be referenced by PM product and DAM style group rather than merged directly into them. |
| PLM production tracking | PLM `ProdOrderHeader`, `ProdOrderDetail`, `ProdPaymentTerms`, `ProdShipmentTransitTime`, `ShippingPort`, `item_prod_order_detail_associations` | `plm.production_order`, `plm.production_order_line` | shared operational | Primary crossover with PM orders and DAM style groups. |
| PLM licensing tracking | PLM `licensingStatus`, `licensingMilestone`, `LicenseFeedBacks`, `licensingFeedbackReply`, `itemLicenseImage`, `groups` | `plm.licensing_status`, `plm.licensing_milestone` | shared operational | Link to `core.licensor/property`, `plm.item`, and PM submissions/revisions where possible. |
| PLM RFQ | PLM `RFQItem`, `RFQVendor`, `RFQGroup`, `RFQStep`, `RFQContainer`, `RFQWhse`, `RFQItemStatus`, `RFQItemDivision` | `plm.rfq_*` | app-owned/shared read | Keep as PLM operational data; CRM/PM may read summaries. |
| PLM standardized products | PLM `Standardized*`, `UDF*`, `AgeGroup`, `ArtTypes`, `Artist`, `ArtistTypes`, `SeasonCode`, `FOBCountry`, `deliveryLocation`, `divisionCode`, `companyCode`, `productions` | `plm.*` or `core.reference_*` | app-owned/shared reference | Promote only true master data into `core`; keep PLM UI/config tables under `plm`. |
| PLM grid/view/admin | PLM `GridLayout`, `GridChildrenLayout`, `GridChildrenLayoutOrder`, `GridAccessLevel`, `GridViewState`, `GridCellNote`, `viewlayout`, `comments`, `user_notification`, `AuditLog`, `email_logs`, `AppSetting`, `AiCacheEvent` | `app.*` for generic concepts, `plm.*` for PLM-only | cache/generated/app-owned | Do not mix PLM grid layouts with PM saved views unless a shared view framework is intentionally designed. |
| Supabase/extension support | PopDAM `part_config`, `part_config_sub`, `table_privs`, `template_public_smon_*`, `graphql_public.graphql`, pg_partman functions, smon functions | leave in `public` or extension-owned schema | cache/generated | Not business schema. Account for them in backup/restore, but do not model as app entities. |

## Current DAM Inventory

Generated from `popdam3/src/integrations/supabase/types.ts` and migrations.

Tables in the selected PopDAM Supabase project:

`admin_config`, `agent_pairings`, `agent_registrations`, `ai_sentinel_cleanup_log`, `app_access`, `asset_characters`, `asset_checkouts`, `asset_path_history`, `asset_tags`, `assets`, `characters`, `erp_enrichment_log`, `erp_items_current`, `erp_items_raw`, `erp_sync_runs`, `helper_devices`, `helper_tokens`, `hygiene_findings`, `invitations`, `licensors`, `part_config`, `part_config_sub`, `pdf_text_samples`, `processing_queue`, `prod_order_headers_current`, `prod_order_headers_raw`, `prod_order_sync_runs`, `product_categories`, `product_category_predictions`, `product_subtypes`, `product_types`, `profiles`, `properties`, `render_queue`, `scanner_ai_ignores`, `sku_files_used`, `style_groups`, `style_guide_crawl_runs`, `style_guide_files`, `style_guide_render_queue`, `template_public_smon_container_status`, `template_public_smon_logs`, `template_public_smon_metrics`, `template_public_smon_storage_snapshots`, `tiff_optimization_queue`, `user_roles`.

Views/materialized views:

`sg_archive_usage`, `style_guide_file_groups`, `style_guide_folders`, `table_privs`.

Important RPC/function families:

`claim_jobs`, `claim_render_jobs`, `claim_sg_render_jobs`, `claim_tiff_jobs`, `get_filter_counts`, `get_path_facets`, `infer_path_attrs`, `set_style_group_cover`, `refresh_style_group_counts*`, `refresh_style_group_primaries`, `rebuild_style_groups_batch`, `reconcile_style_group_stats_batch`, `propagate_group_tags_batch`, `resolve_sku_files_used*`, `parse_pdf_files_used`, `bulk_insert_pdf_text_samples`, `get_sg_preview_stats`, `get_sg_render_queue_stats`, `refresh_style_guide_matviews`, `has_role`, `has_app_access`, `execute_readonly_query`.

Enums:

`file_type`, `asset_status`, `queue_status`, `asset_type`, `art_source`, `workflow_status`, `app_role`, `app_name`, `checkout_status`.

Realtime:

Migrations add `admin_config`, `agent_registrations`, and `render_queue` to `supabase_realtime`; a later migration drops `render_queue`. Frontend hooks subscribe to `admin_config` scan/crawl progress and `agent_registrations` status.

Storage:

DigitalOcean Spaces remains canonical for PopDAM thumbnails/files through `admin_config` keys and agent/worker code. Do not migrate object storage at the same time as the schema merge unless a separate storage rehearsal is completed.

## Current CRM Inventory

Generated from `popcrm-web/src/lib/types.ts` and `src/features/crm/api.ts`.

Collections used by the CRM frontend:

`retailer`, `ingested_domains`, `buyer`, `ingested_contact`, `factory`, `project`, `crm_department`, `crm_opportunity`, `crm_email_message`, `crm_meeting_note`, `crm_ignore_rule`, `crm_ai_model_config`, `crm_note`, `crm_task`, `crm_licensor_approval_thread`, `directus_users`.

Target placement:

- Shared: `retailer`/`ingested_domains` -> `core.company`; `buyer`/`ingested_contact` -> `core.contact`; `factory` -> `core.factory`; `directus_users` -> `app.profile`.
- CRM-owned: `crm_department`, `crm_opportunity`, `crm_email_message`, `crm_meeting_note`, `crm_ignore_rule`, `crm_ai_model_config`, `crm_note`, `crm_task`, `crm_licensor_approval_thread`.
- PM crossover: `project` remains `pim.project`; CRM opportunities can link to it.

## Current PM Inventory

Generated from `poppim-web/src/lib/types.ts` and feature API usage.

Collections used by the PM frontend:

`product`, `project`, `design`, `design_collection`, `stage`, `stage_history`, `retailer`, `buyer`, `licensor`, `property`, `factory`, `product_type`, `season`, `order`, `product_submission`, `product_sample`, `revision_request`, `checklist_item`, `subtask`, `product_assignee`, `product_file`, `product_update`, `product_tag`, `product_field`, `product_activity`, `product_link`, `product_time_entry`, `pm_saved_view`, `pm_view_pref`, `directus_users`, `directus_roles`, `directus_files`, `directus_comments`.

Target placement:

- Shared: `retailer`, `buyer`, `licensor`, `property`, `factory`, `product_type`, and user/file/comment concepts move into `core` or `app`.
- PM-owned: `product`, `project`, `design`, `design_collection`, `stage`, `stage_history`, workflow collections, collaboration collections, order history, saved views.
- Ingest/parity: ClickUp fields and `product_*` work-data collections should remain preserved but not become the canonical long-term business model.

## Current PLM Inventory

Generated from Sequelize models in the selected `main` PLM repos.

Model ownership:

| Model | Repos |
|---|---|
| `AdditionalUserEmail` | `designflow-backend`, `designflow-data-syncing` |
| `AgeGroup` | `designflow-backend`, `designflow-item-master` |
| `AiCacheEvent` | `designflow-backend` |
| `AppSetting` | `designflow-backend` |
| `ArtTypes` | `designflow-backend`, `designflow-item-master` |
| `Artist` | `designflow-backend`, `designflow-item-master` |
| `ArtistTypes` | `designflow-backend` |
| `AuditLog` | `designflow-backend`, `designflow-item-master` |
| `DesignTeamTime` | `designflow-tracking` |
| `Factory`, `vendor`, `vendorGroup`, `externalVendor` | factory/vendor family across core/sync/item/tracking |
| `GridLayout`, `GridAccessLevel`, `GridCellNote`, `GridViewState`, `viewlayout` | grid/view metadata across PLM services |
| `itemHeader`, `itemDetail`, `itemAttachment`, `itemSize`, `itemDepth`, `itemType` | item master family across backend/sync/item/tracking |
| `licensingStatus`, `licensingMilestone`, `LicenseFeedBacks`, `licensingFeedbackReply`, `itemLicenseImage`, `groups` | licensing tracking family |
| `ProdOrderHeader`, `ProdOrderDetail`, `ProdPaymentTerms`, `ProdShipmentTransitTime`, `ShippingPort`, `item_prod_order_detail_associations` | production order family |
| `RFQItem`, `RFQVendor`, `RFQGroup`, `RFQStep`, `RFQContainer`, `RFQWhse`, `RFQItemStatus`, `RFQItemDivision` | RFQ family |
| `StandardizedDetail`, `StandardizedGroup`, `StandardizedProductElement`, `StandardizedProductElementValue`, `StandardizedProductType`, `StandardizedSize`, `StandardizedVendor`, `StandardizedVersion` | standardized product family |
| `UDFComponent`, `UDFElement`, `UDFElementType`, `UDFGroup`, `UDFTable` | configurable field/table metadata |
| `customers`, `externalCustomer` | customer family |
| `licenseList`, `properties_and_characters`, `property_character_associations`, `item_character_associations` | licensing taxonomy family |
| `comments`, `user_notification`, `email_logs`, `auth_token`, `quote_auth_token`, `Roles`, `RolePermissions`, `UIElements`, `users` | PLM app support |

Selected `main` does not include sample models. If PLM sample tracking is required, pull it from a branch that contains `sample`, `sample_event`, `sample_comments`, `sample_attachment`, `sample_factory_group`, `sample_box`, and `sample_shipment_item`, then re-run this map.

## First Migration Shape

1. Leave PopDAM live tables in place.
2. Add new schemas and shared `core/app` tables in a rehearsal project.
3. Create source-reference tables for every imported id before merging duplicates:
   - `core.company_source_ref`
   - `core.contact_source_ref`
   - `core.licensor_source_ref`
   - `core.property_source_ref`
   - `core.character_source_ref`
   - `core.factory_source_ref`
   - `core.sku_source_ref`
4. Migrate CRM and PM into namespaced tables/views that reference shared `core` rows.
5. Link PopDAM `assets/style_groups` to `core` and `pim/plm` entities without moving object storage.
6. Build `api.*` views/RPCs for browser-facing contracts after raw tables are stable.

