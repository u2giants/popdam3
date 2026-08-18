# Business-rule content migration inventory

**Audit date:** 2026-08-18  
**Scope:** `u2giants/shared-db`, `u2giants/popdam3`, `u2giants/popcrm-web`, `u2giants/poppim-web`, `popcre/designflow-frontend`, `popcre/designflow-backend`, and `popcre/designflow-item-master`.

## Method

**Publication state:** consumer cleanup is published. PopDAM commit [`d482b9a`](https://github.com/u2giants/popdam3/commit/d482b9a), PopCRM commit [`30d3eaa`](https://github.com/u2giants/popcrm-web/commit/30d3eaa), and PopPIM commit [`fb7aa38`](https://github.com/u2giants/poppim-web/commit/fb7aa38) are on `main`. DesignFlow frontend commit [`e1c6c7c9`](https://github.com/popcre/designflow-frontend/commit/e1c6c7c9) is in [PR #156](https://github.com/popcre/designflow-frontend/pull/156), backend commit [`d7afb56`](https://github.com/popcre/designflow-backend/commit/d7afb56) is in [PR #69](https://github.com/popcre/designflow-backend/pull/69), and Item Master commit [`e7dd0b6`](https://github.com/popcre/designflow-item-master/commit/e7dd0b6) is in [PR #41](https://github.com/popcre/designflow-item-master/pull/41). Uma owns the DesignFlow merges.

Every Markdown file in the scoped repositories was included in a path inventory, excluding generated dependencies and the read-only `shared-db/` mirrors when auditing consumer repos. Candidate files were identified through headings and language concerning business rules, authority, identity, status, workflows, approvals, pricing, royalty, margin, Customers, Contacts, Factories/Vendors, Licensors, Properties, merchandise groups, products, Items, Samples, orders, production, assets, tags, and permissions.

Each candidate was classified as:

- **Business authority:** its current rule was moved or summarized into the companywide topic library.
- **Implementation evidence:** it may retain field names, screens, formulas-as-code, technical safeguards, or historical measurements, but now points to the companywide rule.
- **Proposed:** it contains unapproved product or workflow ideas and is clearly prevented from acting as Settled authority.
- **Historical:** it explains old data or decisions and is clearly non-controlling.
- **Technical only:** programming, deployment, schema, testing, or incident guidance that does not define how POP does business.

The audit does not delete technical documentation merely because it contains words such as “rule,” “status,” or “source of truth.” Those phrases often describe software behavior rather than business policy.

## Canonical topic results

| Business area | Companywide authority |
|---|---|
| Customers, Contacts, Departments, Factories/Vendors, and ingested domains | [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md) |
| Licensing Master Data | [`licensing-master-data.md`](licensing-master-data.md) |
| Merchandise groups, `mgCategory`, and Product Types | [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md) |
| Products, Items, SKUs, style numbers, and identifiers | [`product-items-and-identifiers.md`](product-items-and-identifiers.md) |
| ERP, orders, and source meaning | [`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) |
| RFQ pricing, royalty, margin, readiness, and quote ownership | [`rfq-pricing.md`](rfq-pricing.md) |
| Product-development workflow | [`product-development-workflow.md`](product-development-workflow.md) |
| Samples, inventory, Boxes, Shipments, and custody | [`samples-inventory-and-shipping.md`](samples-inventory-and-shipping.md) |
| Production milestone dates | [`production-milestones-and-dates.md`](production-milestones-and-dates.md) |
| Tariff and HTS classification | [`tariff-and-hts-classification.md`](tariff-and-hts-classification.md) |
| Source-file integrity | [`digital-assets-and-file-integrity.md`](digital-assets-and-file-integrity.md) |
| Asset classification and tags | [`digital-asset-classification-and-tags.md`](digital-asset-classification-and-tags.md) |

## Shared-db findings

| Source | Classification and action |
|---|---|
| `docs/shared-database-vision.md` | Customer/organization rules moved to the central topic; file retained as architecture and migration evidence. |
| `docs/core-master-data-consolidation-aim.md` | Licensing rules moved to the central topic; detailed authority matrix and structural design retained as evidence. |
| `docs/merch-group-taxonomy-architecture.md` | Merchandise and `mgCategory` rules moved to the central topic; workbook/schema evidence retained. |
| `docs/business-rules-erp-data.md` | ERP/order meaning moved to the central topic; field-by-field interviews and source audit retained. |
| `docs/item-description-mg-classification-process.md` | Detailed active remediation method retained and routed from the taxonomy topic. It implements the business classification rule rather than owning a separate taxonomy. |
| `docs/app-migration-notes/popdam-order-list*.md` | Source/formula evidence retained and routed from the ERP/order topic. |
| Licensing, ColdLion, Character, Style Guide, source-capture, migration, verification, and incident plans | Historical evidence, implementation plans, or structural database work. Current authority is the licensing topic; conflicting old authority statements are superseded by the 2026-08-16 ruling. |
| `AGENTS.md` | Repository and database governance, not the business-rule library. Its router now starts business work at the central map. |

## PopDAM and PopSG findings

| Source | Classification and action |
|---|---|
| `use_plm_tables.md`, `use_master_data_plm_tables.md` | Replaced with central-map pointers in PopDAM commit `d482b9a`. |
| `docs/MASTER_DATA.md` | Authority corrected in PopDAM commit `d482b9a`. |
| `docs/PROJECT_BIBLE.md`, `docs/WORKER_LOGIC.md`, `docs/PATH_UTILS.md`, `docs/SCHEMA.md`, `docs/API_CONTRACTS.md`, `docs/architecture.md`, `README.md` | Repeated-rule cleanup published in PopDAM commit `d482b9a`. |
| `fix_add_tags.md` | Proposed-implementation label and central links published in PopDAM commit `d482b9a`. |
| `fix_popsg_tagging_handoff.md` | Historical label and central links published in PopDAM commit `d482b9a`. |
| `docs/POPSG.md` | Technical crawl, render, and source-resolution behavior retained. Licensing identity and tagging meaning come from central topics. |
| `docs/KNOWN_QUIRKS.md` and `AGENTS.md` | Technical incidents and safeguards retained. Embedded customer/licensing/taxonomy facts now route through the central map. |
| Search, batch, model, deployment, infrastructure, and extraction plans | Technical or Proposed implementation material, not business authority. |

## PopCRM findings

| Source | Classification and action |
|---|---|
| `use_plm_tables.md` | Central pointer published in PopCRM commit `30d3eaa`. |
| `docs/architecture.md` | Customer vs. ingested-domain correction published in PopCRM commit `30d3eaa`. |
| `AGENTS.md` | Central-map route published in PopCRM commit `30d3eaa`. |
| `docs/overview-aggregate-inventory.md` | Reporting predicates and performance evidence retained as application implementation. It does not define Customer identity. |
| Design handoff files | UI design evidence. Labels such as Account/Prospect are not permitted to supersede central Customer definitions. |
| Audit, deployment, configuration, and remediation plans | Technical or historical, not business authority. |

## PopPIM / PM findings

| Source | Classification and action |
|---|---|
| `use_plm_tables.md` | Central pointer published in PopPIM commit `fb7aa38`. |
| `docs/architecture-update-implementation-plan.md` | Proposed/Historical label and central links published in PopPIM commit `fb7aa38`. |
| `gaps.md` | Current application state and missing implementation, not business authority. |
| `AGENTS.md`, `docs/architecture.md` | Central-map route published in PopPIM commit `fb7aa38`. |
| ClickUp, schema, and secondary-screen documents | Technical integration or implementation evidence. |

## DesignFlow frontend findings

| Source | Classification and action |
|---|---|
| `docs/sample-tracking-restructure-spec.md` | Central authority banner published in frontend commit `e1c6c7c9`; active implementation evidence retained. |
| Sample Tracking plans | Central links published in frontend commit `e1c6c7c9`. |
| `docs/rfq-math.md`, `src/app/pages/rfq/README.md`, RFQ buyer-margin/generic-royalty plans | Authority separation published in frontend commit `e1c6c7c9`. |
| `src/app/pages/prod_tracking/README.md` | Central link published in frontend commit `e1c6c7c9`. |
| `docs/ai-classification.md` | Central link and authority separation published in frontend commit `e1c6c7c9`. |
| `docs/item-library-redesign.md` | Central links published in frontend commit `e1c6c7c9`. |
| `AGENTS.md`, architecture, dependency, and system maps | Business-authority labels and central routes published in frontend commit `e1c6c7c9`. |
| Performance, grid, SSRM, theming, saved-view, and QA plans | Technical behavior or test evidence. |

## DesignFlow backend findings

| Source | Classification and action |
|---|---|
| `AGENTS.md` | Central RFQ route published in backend commit `d7afb56`. |
| `docs/api-reference.md` | Endpoint contract only. Route names do not establish business meaning. |
| `HTS_RAG.md`, `HTS_RAG_PILOT.md` | Proposed/implementation labels and central links published in backend commit `d7afb56`. |
| Architecture, dependency, and system maps | Business-authority labels and central routes published in backend commit `d7afb56`. |
| Security, performance, migration, MCP, and deployment plans | Technical only. |

## DesignFlow Item Master findings

| Source | Classification and action |
|---|---|
| `AGENTS.md` | Central routes published in Item Master commit `e7dd0b6`. |
| `docs/app-migration-notes/coldlion-style-number-validation-20260716.md` | Central Product/Item link published in Item Master commit `e7dd0b6`. |
| Architecture, dependency, API, and system maps | Business-authority labels and central routes published in Item Master commit `e7dd0b6`. |

## Conflicts resolved

1. CRM ingested domains can never become Customers. Older promotion language was removed.
2. Authorized licensor sources, not DesignFlow, own official licensing names, ownership, and direct relationships. ColdLion owns Property Active/Inactive only.
3. Merchandise taxonomy no longer claims authority over licensing identities.
4. PM/PIM's old named-person workflow and detailed transition plan is Proposed/Historical, not current authority.
5. RFQ formulas and permissions are companywide, not frontend- or backend-owned.
6. Sample custody and shipping rules are companywide, not DesignFlow-frontend-owned.
7. Source-file date preservation is companywide, not PopDAM-owned.
8. Tagging evidence cannot create official licensing or taxonomy truth.
9. Purchase-Order-level production dates displayed under SKUs are not independent SKU dates.
10. Application status labels cannot redefine shared business identities.

## Remaining Unknowns, not silently resolved

- The complete current POP and Spruce product-development transition sequence.
- Final role ownership and exception authority for each product-development transition.
- Several unapproved asset-tag vocabulary, propagation, permission, and threshold choices.
- Whether and how true per-SKU production dates will be recorded.
- Implementation-only Sample Tracking identifiers and data shapes.

These Unknowns are visible in their topics. They require owner or named business-authority decisions before implementation as Settled behavior.

## Completion rule for future changes

A future audit is complete only when a repository-wide search finds no application document presenting a competing current business authority. Historical and Proposed material may remain only when labeled at the point a reader encounters it, and implementation documents must link to the applicable companywide topic.
