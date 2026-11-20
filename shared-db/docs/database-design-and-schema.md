---
summary: "Canonical entry point for the shared database: live structure, target ownership, planned changes, retired assumptions, and open decisions."
kind: living
status: current
read-when: "Starting any work that reads, writes, or changes the shared database or its application contracts."
---

# Shared database design and schema

This is the starting reference for DesignFlow PLM, PopDAM, PopCRM, and other consumers of the POP Creations shared Supabase database. It links to the records that own each detail. Update this reference when ownership or a major transition changes. The shared-db maintainers own it.

## Live structure and source of truth

| Area | Ownership and use |
| --- | --- |
| `app` | Shared profiles, roles, application access, audit and notifications. DesignFlow PLM owns user administration across apps. Supabase Auth supplies login. |
| `core` | Shared customers, contacts, factories, licensors, properties, characters and taxonomy. Ownership and source precedence vary by business object. |
| `api` | Stable application-facing views and functions. |
| `crm`, `pim`, `dam`, `plm` | Application domains. CRM owns sales work; PIM owns its product workflows; DAM owns asset workflows; PLM owns item and production workflows. The `dam` schema is deliberately absent from the REST exposure list. Check current contracts for each application's actual access path. |
| `coldlion`, `ingest` | ERP landing and import staging. Follow the owning feed contract for grain, keys and refresh behavior. |
| `dflow_prod`, `dflow` | DesignFlow runtime areas during the transition. Production runs on Supabase using `dflow_prod` for its legacy-shaped tables. Nonproduction uses `dflow` for its application merchandise list. The production `dflow` snapshot was retired separately. |
| `public` | Compatibility objects and existing PopDAM tables. Check the individual contract before assuming anything is public or available anonymously. |

For exact tables, columns and relationships, follow [architecture and contracts](architecture.md), [generated database types](../types/database.types.ts), and [versioned migrations](../supabase/migrations/). Generated types describe a generation snapshot; a merged migration alone does not prove an environment has applied it. For changes or production claims, reconcile the target's actual catalog, migration history and delivery evidence through the [current workflow](agents/current-workflow.md).

Use the [Business Logic Library](business-rules/application-map.md) for source authority, identifiers, and business meanings. ColdLion supplies ERP-owned names and codes. In licensed divisions CW001 and SP001, MG05 identifies licensors and MG06 identifies properties; resolve the parent within the same division. The shared property values refresh from ColdLion daily. Licensed submission identities and contract placement have their own rules. See [owner rulings](owner-rulings-part-4.md) and [licensing master data](business-rules/licensing-master-data.md).

## Settled direction and remaining delivery

- The [adopted DesignFlow plan](designflow-cloudsql-to-supabase-plan.md) moves appropriate DesignFlow data into permanent shared and application areas after the host move. The sample cluster stays together. Preserve existing shared records and application compatibility during cutover. See [host move evidence](https://github.com/popcre/shared-db/issues/770) and [production snapshot retirement](https://github.com/popcre/shared-db/issues/6325).
- [Production multi-schema cutover](https://github.com/popcre/shared-db/issues/4251) and [shared master data consolidation](https://github.com/popcre/shared-db/issues/4253) track remaining delivery. Follow the DesignFlow user administration ruling and the existing `app` identity contracts when reconciling older plan wording about shared users.
- [Merchandise groups](https://github.com/popcre/shared-db/issues/4706#issuecomment-7019958704) use current ColdLion data. The hierarchy is division, type, category, value. Match company, division, type, category and code to preserve an existing DesignFlow ID. Hold ambiguous and unmatched IDs for review. Check deployment before relying on the canonical load.
- [Items and children](https://github.com/popcre/shared-db/issues/4707), [RFQs](https://github.com/popcre/shared-db/issues/4709) and [production orders](https://github.com/popcre/shared-db/issues/4710) track moves into permanent structures. Check each issue and delivery evidence before implementing or assuming a move is live.

## Superseded material

- The [June unified schema map](unified-supabase-schema-map.md) and relationship diagrams are historical planning. Use the current ownership map above and the exact schema sources when choosing a table.
- The [piecemeal Cloud SQL host move](../plan_cloudsql_piecemeal_cutover.md) was superseded by the adopted DesignFlow plan. Albert confirmed Cloud SQL shut down the week of November 19, 2026. An open [retirement issue](https://github.com/popcre/shared-db/issues/4252) does not establish that the service is running.
- Early ColdLion integration and merchandise taxonomy drafts are historical where they conflict with the current feeds or Business Logic Library. The frozen merchandise copy was retired. The [six alleged readers](https://github.com/popcre/designflow-item-master/issues/205#issuecomment-6850651584) were checked and did not require rewrites.
- Retain old plans as decision history. A later owner ruling or verified delivery record can supersede part of a plan without retiring the whole plan.

## Still undecided or unverified

- Final table and column mappings for the open moves, reconciliation of overlapping records, and compatibility and live acceptance for each cutover. Draft names and mappings in the older crosswalk are provisional.
- The [DesignFlow item and licensing migration plan](designflow-item-and-licensing-migration.md) defines the database structure, DesignFlow data move, release order and live checks for #4707. The [production merchandise-group reconciliation](verification/4707-designflow-merch-group-holds-20261120.md) accounts for all 3,099 held DesignFlow IDs.
- No open owner question from the merchandise group email. Escalate only a new business choice with verified examples. For live proof and implementation ownership, start on the linked issue rather than opening a competing plan.
