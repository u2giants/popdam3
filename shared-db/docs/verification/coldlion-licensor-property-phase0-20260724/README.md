# ColdLion licensor/property Phase 0 baseline completion

**Measured:** 2026-07-24  
**ColdLion measurement:** live read-only API, 2026-07-24T19:30:54Z  
**Database measurement:** preview `rjyboqwcdzcocqgmsyel`, 2026-07-24T19:34:24Z  
**Production boundary:** no production query was run in this session. The user explicitly
forbade running Phase 2A against production, so production facts remain the already-recorded
2026-07-24 snapshot in
[`../licensor-property-cutover-baseline-20260724.md`](../licensor-property-cutover-baseline-20260724.md).

This folder completes the residual Phase 0 evidence required by
[`fix_coldlion_licensor_property_cutover.md`](../../../fix_coldlion_licensor_property_cutover.md)
§2 and §15.1 before Phase 2A importer implementation. It separates freshly measured
preview/API facts from the existing production snapshot and contains the full row-level
inventories that were missing from the earlier summary.

## Measurement summary

| Evidence | Fresh result |
|---|---|
| ColdLion header dictionary | 37 rows across CW001, SP001, EH001, and EP001 |
| Licensed type pairs | CW001/05 Licensor, CW001/06 Property, SP001/05 Licensor, SP001/06 Property |
| ColdLion licensed detail rows | 560 source rows: 22 + 258 in each licensed division |
| Preview canonical | 26 Licensors and 256 Properties |
| Preview DesignFlow staging | 37 Licensor rows and 468 Property rows |
| Preview source references | 505, all `designflow_plm` (`37` Licensor / `468` Property); zero ColdLion refs |
| Preview parent edges | 256/256 Properties have one Licensor |
| Relevant Supabase cron jobs | 0 |

The ColdLion division/type inventory is complete, including zero-detail non-licensed
header pairs. `mgTypeCode` is never interpreted without its division and description.

## Row-level artifacts

- [`coldlion-division-type-inventory.csv`](coldlion-division-type-inventory.csv) — every
  `(companyCode, divisionCode, mgTypeCode, mgTypeDesc)` header and the licensed-detail count
  fetched for it.
- [`source-references.csv`](source-references.csv) — all 505 preview
  `core.taxonomy_source_ref` Licensor/Property rows.
- [`parent-edges.csv`](parent-edges.csv) — all 256 preview
  `core.property.licensor_id` edges with both canonical UUIDs, codes, names, and statuses.
- [`unmatched-ambiguous-ledger.csv`](unmatched-ambiguous-ledger.csv) — every source row not
  matched by exact compatible code plus every canonical-only row. Division duplicates remain
  separate because the ColdLion natural key includes division.

## Unmatched and ambiguous baseline

The non-mutating comparison used this order only to describe evidence: exact compatible
entity/code, exact normalized entity/name, cross-entity code collision, unmatched. It did
not approve or write a link.

| Category | Source rows | Meaning for Phase 2A |
|---|---:|---|
| Exact compatible code | 542 | Mirror as unresolved; do not link |
| Exact normalized name | 2 | NASA (`NA`) in CW001/SP001 points to the same name as canonical `X-NASA`; still not approved |
| Entity-type collision | 2 | FRIDA KAHLO Licensor code `FK` collides with canonical Property code `FK`; quarantine/review |
| Unmatched | 14 | ZAG twice plus six ColdLion-only Properties twice; review only |
| Canonical-only | 10 | FRIENDS TV, five provenance-free `X-` Licensors, and four Properties; preserve |

There were no multi-candidate same-entity code or name matches in this baseline. The ledger
is evidence, not a Phase 3 decision record.

Named cases:

- NASA is canonical `X-NASA`, active, and matches ColdLion `NA` by normalized name only.
  Phase 2A must not link it or change its status.
- ZAG is ColdLion-only (`ZG`) in both licensed divisions.
- FRIDA KAHLO is ColdLion-only as a Licensor (`FK`) but collides with an existing canonical
  Property code. It must not cross entity types.
- FRIENDS TV remains canonical-only Licensor `FR`. ColdLion Property `FR` matches the
  canonical Property “1ST ORDER TROOPER,” not the Licensor.

## Database dependency graph

Fresh preview catalog inspection found these definition-level consumers:

| Schema | Object | Kind |
|---|---|---|
| `api` | `coldlion_licensor_reconciliation` | view |
| `api` | `coldlion_property_reconciliation` | view |
| `api` | `dam_asset_library` | view |
| `api` | `db_data_admin_licensor_property_list` | function |
| `api` | `db_data_admin_licensor_property_tree` | function |
| `api` | `plm_item_status` | view |
| `api` | `pm_product_board` | view |
| `plm` | `import_item_master_data` | function |
| `plm` | `import_master_data` | function |
| `plm` | `refresh_style_tracker_item_bridge` | function |
| `public` | `dam_character_catalog` | view |
| `public` | `search_style_tracker_link_candidates` | function |
| `public` | `style_tracker_rows_with_bridge` | view |

Foreign-key consumers of `core.licensor` / `core.property` span `core`, `crm`, `dam`, `pim`,
`plm`, and `public`: Property/Character; CRM approval threads; DAM assets, style groups, and
style-guide files; PIM products, submissions, and projects; PLM items, licensing status,
imports, taxonomy disagreement/review, ColdLion mirrors, and style-tracker bridges; and
legacy public DAM assets/style groups plus bakeoff results. These dependencies make UUID,
status, and parent-edge immutability mandatory.

Neither `plm.licensor_import` nor `plm.property_import` has an application-facing foreign
key consumer beyond its canonical FKs and indexes. Their operational consumer is
`plm.import_master_data` / `tools/sync-plm-master-data.mjs`; DesignFlow remains enabled.

## Application dependency graph

The database contracts route to these application surfaces:

| Consumer | Contract/path | Phase 2A impact |
|---|---|---|
| DB Data Admin | `api.db_data_admin_licensor_property_list/tree` | None; canonical reads only |
| DAM / PopDAM | `api.dam_asset_library`, DAM asset/style-group/style-guide FKs | None; UUIDs/status/parents untouched |
| PM/PIM | `api.pm_product_board`, `pim.product/project/submission` FKs | None |
| CRM | `crm.licensor_approval_thread` FKs | None |
| DesignFlow PLM | `getLicensorsWithProperties`; existing DesignFlow master-data sync | Remains enabled and authoritative for parent/status comparison |
| Item taxonomy | `plm.item`, `plm.import_item_master_data`, disagreement tables | None; mirror rows are evidence only |
| Style tracker | bridge/search/view functions | None |

Local source scanning excluded generated types and mirrored `shared-db/` folders. Direct
DesignFlow application references were found in
`designflow-item-master/services/item_library.service.js` and its controller/router/tests.
The other consumers use the database API/FK contracts above rather than querying the four
staging/canonical tables by literal qualified name in the available local checkouts.

## Phase 0 decisions carried into Phase 2A

- Field ownership is unchanged: ColdLion owns only mirror identity/descriptions/raw evidence;
  Supabase owns canonical UUIDs, lifecycle, names/aliases, and parent edges.
- The licensed allowlist is derived from live header descriptions, not hard-coded type
  numbers: CW001 and SP001 are required; EH001/EP001 remain dictionary-only.
- Status and Property parent policy remain Supabase-owned.
- FRIENDS TV stays curated-only unless a later human decision changes that.
- Canonical display names are not overwritten in Phase 2A.
- No unanswered Phase 0 question changes the Phase 2A mirror schema or automatic behavior,
  because Phase 2A performs no automatic canonical matching/linking.

## Reproduction boundary

The ColdLion inventory used read-only `GET /merchGroupHeaders` and
`GET /merchGroupDetails` calls with the API key supplied from 1Password
`vibe_coding`. The database export used a read-only connection to preview. No importer
function was invoked, no preview mirror row was written, and no production connection was
made.
