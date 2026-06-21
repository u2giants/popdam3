# Unified Supabase Migration Gaps

Date: 2026-06-20

This document lists conflicts, missing links, risky tables, and decisions required before creating migration SQL for the shared Supabase project `qsllyeztdwjgirsysgai`.

## Source Gaps

| Gap | Impact | Recommendation |
|---|---|---|
| PM/CRM backend schema repo was not part of the requested GitHub source list. | PM/CRM maps are based on frontend consumption, not every backend-only Directus field/policy/flow. | Before migration DDL, include the backend schema source or a live schema dump/readiness audit. |
| PLM selected branch is `main`; older local `sandbox-albert` has more architecture docs and sample tracking. | Sample tracking is listed in docs/feature matrices but not present in `designflow-tracking` `main` models/routes. | Do not design PLM sample tables unless those files are merged to `main` or the authoritative branch changes. |
| PopDAM AGENTS in `popdam3` references an older project id, but user selected `qsllyeztdwjgirsysgai`. | Repo docs may be stale around project identifiers. | Treat user-provided Supabase URL as authoritative and verify linked project before any migration. |
| PopDAM generated types contain extension/admin tables (`part_config`, `template_public_smon_*`, `table_privs`). | These can pollute business schema maps. | Keep them in backup/restore inventories but exclude them from domain models. |

## Duplicate Business Objects

| Duplicate | Current sources | Risk | Resolution |
|---|---|---|---|
| Customer/company | CRM `retailer`, `ingested_domains`; PM `retailer`; PLM `customers`, `externalCustomer`; DAM path/PO customer fields | Split accounts break realtime and reporting. | Create `core.company` plus source refs; do not keep app-specific customer tables as peers. |
| Contact/buyer | CRM `buyer`, `ingested_contact`; PM `buyer`; PLM users/vendors as contacts | Multiple buyer records per account, broken email routing. | Create `core.contact`; keep CRM fields like scope/contact type as CRM or bridge attributes. |
| Licensor/property/character | DAM taxonomy, PM taxonomy, PLM `licenseList` and property/character association tables | Assets, PM products, and PLM approvals will not join reliably. | Create shared `core` taxonomy with alias/code/source-ref tables. |
| Product/item/style/SKU | PM `product`; DAM `style_groups/assets/erp_items_current`; PLM `itemHeader`; ClickUp task ids | Wrong joins can merge different records with similar names or missing style numbers. | Use `core.sku_ref` and explicit match confidence; only hard-link on verified stable SKU/item ids. |
| Factory/vendor | PM/CRM `factory`; PLM `Factory`, `vendor`, `externalVendor`; DAM ERP PO vendor data | Vendor row scoping and pricing exposure risks. | Use `core.factory` and separate vendor contacts/representatives. Preserve PLM factory id. |
| Order/production order | PM `order`; DAM `prod_order_headers_current`; PLM `ProdOrderHeader/Detail` | Duplicate PO status and quantities. | PLM production order should become canonical; PM/DAM rows link to it. |
| Files/assets | PM `product_file/directus_files`; DAM `assets`; PLM `itemAttachment/artPieceAttachment/itemLicenseImage`; Spaces URLs | Treating DAM files as generic attachments loses asset workflow metadata. | Keep DAM assets first-class. Use shared files only for generic attachments. |
| Saved views/layouts | PM `pm_saved_view`; PLM `Grid*`/`viewlayout`; CRM frontend state | Premature generic view system will overfit. | Keep separate until a shared view product requirement exists. |

## Sensitive Or Risky Areas

| Area | Risk | Required control |
|---|---|---|
| Pricing/cost fields | PM designer field-hiding and PLM/RFQ cost data can leak through broad table grants. | Use RLS plus role-specific views/RPCs; do not expose base tables with pricing to general authenticated users. |
| Vendor access | Vendor role has known row-scoping needs. PLM vendor/factory access is also sensitive. | Implement user-to-factory/vendor mapping before any vendor product/order access. |
| Raw email/meeting data | CRM emails and meetings may contain private content and third-party addresses. | Store raw ingest in `ingest`; expose curated CRM views only. |
| Service-role functions | DAM workers and PLM sync jobs use privileged operations. | Browser clients must never call worker/admin RPCs directly unless RLS and role checks are explicit. |
| Queue tables | DAM render/processing queues and helper tokens are operational state. | Keep admin/service-only. Do not put queues in shared `api` views except status summaries. |
| Auth migration | Directus, PopDAM Supabase Auth, and PLM JWT users differ. | Supabase Auth should be the target identity layer; import app profiles and source refs separately. |
| Object storage | DAM and PLM use DigitalOcean Spaces; PM has Spaces URLs from Directus migrations. | Do not move storage during schema migration. Preserve URLs and bucket metadata first. |
| Realtime | Cross-app instant updates require one project, but not every table should be realtime-enabled. | Enable realtime only for user-facing state: PM board/workflow, CRM opportunity/task, DAM asset/style-group linking, selected progress/status tables. |

## Missing Links To Add

| Link | Why it matters | Proposed table/field |
|---|---|---|
| Product to DAM asset/style group | PM needs live previews/files; DAM needs product context. | `pim.product_style_group`, `pim.design_asset`, or FK after verified one-to-one matches. |
| Product to PLM item | Production, item metadata, and orders must join to PM pipeline. | `pim.product.plm_item_id` plus `core.sku_ref`. |
| Production order to PM order/product | PM order history and PLM production tracking overlap. | `pim.order.production_order_line_id`. |
| CRM opportunity to PM project/product | Sales pipeline should trigger PM work and reflect progress. | `crm.opportunity.project_id`, optional opportunity-product join. |
| CRM company to PLM customer | Customer status and production/order history need one account graph. | `core.company_source_ref` with PLM customer ids. |
| DAM PO snapshot to PLM PO | DAM current PO rows are snapshots. | `dam.prod_order_headers_current.plm_order_line_id` during transition. |
| Licensor approval to PM submission/revision | CRM approval threads and PM workflow can duplicate approvals. | Link approval thread to `pim.product_submission`/`pim.revision_request` when specific. |
| Directus/ClickUp external ids | Needed for dedupe and rollback. | Preserve all `external_id`, `external_source`, ClickUp task ids in source-ref tables. |

## Tables To Keep Out Of Browser Contracts

Do not expose these directly through public browser views:

- PopDAM queues and helpers: `processing_queue`, `render_queue`, `style_guide_render_queue`, `tiff_optimization_queue`, `helper_tokens`, `agent_pairings`, privileged parts of `agent_registrations`.
- PopDAM admin/config/raw: `admin_config` secrets/config keys, `erp_items_raw`, `prod_order_headers_raw`, `ai_sentinel_cleanup_log`, `scanner_ai_ignores`, extension tables.
- CRM raw ingest: `ingested_domains`, `ingested_contact`, raw email content if present.
- PLM tokens/auth/audit internals: `auth_token`, `quote_auth_token`, `email_logs`, broad `AuditLog`, raw role/permission internals.
- PLM RFQ/cost base tables unless behind role-specific views.

## Realtime Plan Gaps

Enable realtime only after RLS is correct.

| Domain | Candidate realtime tables/views | Notes |
|---|---|---|
| PM | `pim.product`, `pim.stage_history`, `pim.product_submission`, `pim.product_sample`, `pim.revision_request`, `pim.order`, `pim.product_assignee` | Drives boards and workflow movement. |
| CRM | `crm.opportunity`, `crm.task`, `crm.note`, `crm.email_message` routing status | Do not stream raw email bodies unnecessarily. |
| DAM | `dam.assets`, `dam.style_groups`, asset-product link tables, scan/crawl progress summaries | Keep queue tables admin-only. |
| PLM | Production order status views, item status views | Prefer `api` views/materialized summaries over raw PLM tables. |
| App | `app.comment`, `app.notification`, `app.activity` | Shared collaboration layer. |

## Migration Order Risks

1. Identity and roles must come before RLS testing.
2. `core` dedupe/reference tables must exist before importing PM/CRM/PLM business rows.
3. DAM live tables should remain stable while links are added; avoid physical table moves first.
4. Object storage should remain in DigitalOcean Spaces until database parity is proven.
5. Frontends should switch through `api` views/RPCs or a compatibility layer, not raw table rewrites all at once.
6. PLM model duplication across repos means a model name alone is not enough. Diff columns by repo before writing PLM DDL.
7. Sample tracking must be re-evaluated because it is not in the selected `main` PLM checkout.

## Acceptance Checklist For The Next Phase

Before migration SQL is written:

- Verify live Supabase project ref and obtain a schema-only dump of `qsllyeztdwjgirsysgai`.
- Add the backend Directus schema source or dump for PM/CRM if frontend usage is insufficient.
- Generate column-level inventories for PopDAM tables and PLM Sequelize models.
- Decide whether PLM sample tracking should be included and from which branch.
- Define exact RLS roles and pricing/vendor field exposure rules.
- Define source-reference table structures and matching rules for company/contact/taxonomy/SKU/factory/order.
- Run dry-run dedupe reports before merging any shared rows.

