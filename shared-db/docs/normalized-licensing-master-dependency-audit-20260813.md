# Normalized licensing master: implementation plan and Phase 1 dependency audit

**Workstream:** fix licensor tables · **Issue:** #912 · **Mode:** read-only audit

## STATUS

| Phase | State | Evidence / blocker |
|---|---|---|
| 1. Dependency audit | COMPLETE for the named canonical local checkouts and production catalog | This document. No unexplained code reference to an old table remains in the scanned checkouts. |
| 2. Measure and classify data | BLOCKED | Requires the owner decisions listed below, then a separately approved row-count-only audit. |
| 3. Target schema design | BLOCKED | Must follow Phase 2 evidence and Albert's answers. |
| 4. Additive schema | NOT STARTED | No schema file may be written before the design is approved. |
| 5-10. Migration, apps, rehearsal, production, retirement | NOT STARTED | Depend on prior phases and exact production approval. |

## Audit boundary and proof

- Repository baseline: `origin/main` `a5bd83a16182a6d0f2c1031e12c1ccbf89dffdc3`; highest migration `20260813180000`.
- Open shared-db PRs at audit time: #864 and #874. Neither claims this read-only audit.
- Production target was proved immediately before both database reads as `qsllyeztdwjgirsysgai`.
- Ledger comparison found 440 migrations on `origin/main`, 437 applied, and three merged but not applied: `20260729120000`, `20260802170000`, `20260802171000`. Catalog absence of objects from those files is not treated as missing design work.
- Local app checkouts scanned: all six `C:\repos\dflow plm\designflow-*` repos, `popdam3`, `poppim-web`, `popcrm-web`, `oracle` (Hiclaw workspace), `synology-monitor`, and `devops-mcp`. Generated code, CI, jobs, import tools, and application source were included. Mirrored `shared-db/`, dependencies, builds, documentation, and git metadata were excluded from app-code results.
- Required architecture and verification documents named in issue #912 were reviewed with the baseline and all later migrations that mention the affected objects. Licensed row values were not read into or written to this public artifact.

## Dependency evidence table

“Replacement candidate” is a cutover target to validate in Phase 3, not an approved schema design.

| Repository | File / live object | Access | Fields or contract used | Current meaning | Replacement candidate | Cutover | Risk if missed |
|---|---|---|---|---|---|---|---|
| designflow-backend | `models/db/properties_and_characters.js:3-83` | read model | `id,name,type,licensor_id,source_licensed_property_id,source_character_id` | Mixed style-guide/licensed-property parent and character appearance rows | separate property, character, style-guide and source-identity models | app move | App continues treating appearances as identities. |
| designflow-backend | `models/db/property_character_associations.js:3-46` | read model | `property_id,character_id,licensor_id` | Self-link inside the mixed table | typed property-character and style-guide-character links | app move | Wrong endpoint type remains possible. |
| designflow-backend | `models/db/item_character_associations.js:3-48` | read/write model | `item_header_id,character_id` | One item points to one mixed-table row | item-to-canonical-character link plus explicit property/style-guide context if required | app move | Item licensing keeps a legacy integer identity. |
| designflow-backend | `models/db/licenseList.js:3-54` | read/write model | ID, code, title, status, royalty rates | Contract/royalty list presented as a licensor list | license agreement joined to canonical licensor | app move | Contract terms remain attached to a mislabeled party record. |
| designflow-backend | `models/db/init-models.js:59-95` | read relationship | mixed self-links; mixed-to-licenseList; item-to-mixed | ORM encodes the broken grain | typed relationships between normalized models | app move | New tables exist but application joins still use old ones. |
| designflow-backend | `services/autofill.service.js:85-90,169-193,282-314` | read | names, type, licensor ID, source property ID | Fuzzy name matching and direct mixed-table lookup | candidate-only search over typed masters; approved crosswalk for saving | app move | Fuzzy candidates can continue acting as approved identity. |
| designflow-backend | `models/lib.model.js:260-310,4339-4345` | read/write | license title/code/status/royalty fields | CRUD for `licenseList` | agreement CRUD with separate licensor selection | app move | Writers keep the legacy contract table alive. |
| designflow-backend | `routes/lib.router.js:51-54` | read/write API | find/add license list | Public API exposes old shape | versioned agreement/licensor endpoints | app move | Frontend cannot cut over safely. |
| designflow-data-syncing | `models/db/licenseList.js:3-54` | model | all legacy agreement fields | Sync model for legacy contract list | agreement model plus licensor key | app move | Background sync can recreate legacy writes. |
| designflow-frontend | `src/app/pages/editor/license-list/license-list.component.ts` and `.html` | read/write UI | license list edit shape | Editor manages agreements as “licenses/licensors” | agreement editor with licensor relation | app move | Users keep editing the wrong business object. |
| designflow-frontend | nine autocomplete/RFQ/item-library files found by exact `licenseList` search | read UI | license list choice/code | Multiple workflows consume the legacy API | typed licensor and agreement choices based on business need | app move | Hidden screens remain coupled after main editor changes. |
| shared-db | `tools/analyze-character-identity-resolution.mjs:161-177` | read audit | old links, canonical property/licensor, empty character/style guide | Existing analysis bridge between universes | revise after approved crosswalk | migration tooling | Audit reports become stale or misleading. |
| shared-db | `tools/process-style-guide-licensing-review.mjs`; `tools/resolve-character-identity.mjs` | read/tool output | mixed IDs and review decisions | Human-review tooling for the old grain | governed match-review and source-identity services | migration tooling | Prior review decisions may be lost on re-import. |
| shared-db | `supabase/ci-bootstrap/010_pre_adoption_baseline.sql`; migrations `20260710135950`, `20260717163500` | schema baseline | old tables, keys, indexes and grants | Canonical captured legacy structure | retain as immutable history; add new migrations only | additive schema | Editing history would corrupt the migration ledger. |
| shared-db | migration `20260727230000_core_style_guide_axis.sql` | schema | canonical character/style-guide and typed links | Existing additive normalized axis | audit and reuse rather than duplicate | design | Duplicate masters would deepen the split. |
| shared-db | migrations `20260720120000` onward involving `core.licensor`, `core.property`, source refs and review | read/write functions | canonical IDs, aliases, source refs, candidate/review contracts | Current canonical taxonomy and import safety layer | extend or adapt after full contract review | design/migration | Replacement could bypass curated-field and abstention rules. |
| shared-db | migrations `20260807170000` onward for OPA/portal landings | landing/read | source IDs plus optional canonical FKs | Private-source landing families map toward typed masters | source-identity crosswalk, without copying licensed rows | migration tooling | Portal-specific identity rules may be lost. |
| PopDAM | 14 source files, including `StylesPage.tsx`, `AssetDetailPanel.tsx`, worker tagging handlers and metadata functions | read/write | canonical licensor/property and style metadata | Active DAM use of normalized licensor/property, with style workflows | preserve core IDs; add typed character/style-guide links | app move | Asset and style editing breaks or loses taxonomy. |
| PopPIM | `src/domain/reference/api.ts`, `src/lib/supabaseQuery.ts`, `src/features/board/collab.ts` | read | canonical core reference data | PIM reads normalized master references | stable compatibility API/view during cutover | app move | Product forms lose reference choices. |
| PopCRM | `workers/crm-worker-supabase.mjs` | read | canonical core reference data | CRM worker consumes normalized taxonomy | stable typed contract | app move | Approval/CRM jobs fail. |
| Hiclaw (`oracle`) | no exact code references found | none found | N/A | No proven dependency in this checkout | none unless runtime evidence appears | verification | Low, but deployed config still needs release-time check. |
| monitoring/import tools | `synology-monitor`, `devops-mcp`: no exact code references found | none found | N/A | No proven dependency | none | verification | Low. Scheduled external jobs not present locally remain a deployment audit item. |
| production catalog | `core.properties_and_characters`, `core.property_character_associations`, `core."licenseList"` | table/FK | old integer IDs and self-links | Legacy mixed universe | compatibility layer then retirement | late retirement | Dropping early breaks core/plm references. |
| production catalog | `dflow.properties_and_characters`, `dflow.property_character_associations`, `dflow.item_character_associations`, `dflow."licenseList"` | table/FK | duplicate old structures | DesignFlow copy and item link | normalized core masters and typed item link | app move | DesignFlow remains on a separate identity universe. |
| production catalog | `plm.item_character_associations_character_id_fkey` | FK/read-write | `character_id -> core.properties_and_characters(id)` | PLM item still points at mixed table | canonical character FK | migration + app move | Core copy cannot retire. |
| production catalog | canonical `core.property`, `core.character`, `core.style_guide`, `core.licensor` and typed link FKs | table/FK | UUID typed masters | Existing normalized foundation | reuse after grain and ownership audit | design | Creating replacements blindly duplicates sound tables. |
| production catalog | DAM, PIM, CRM, PLM and public FKs to `core.licensor` / `core.property` | FK | canonical UUIDs | Broad active cross-app contract | preserve IDs or provide bounded compatibility | all cutovers | ID churn would break several apps at once. |
| production catalog | portal landing FKs to canonical property/character/style guide | FK | optional `core_*_id` | Reviewed portal-to-master link points | migrate into governed source identity without guessing | migration tooling | Approved matches could be detached. |

## Exact old-name search closure

The code search found old-table dependencies only in shared-db's immutable migrations/baseline and three current audit/review tools; DesignFlow backend models/services/routes; one DesignFlow data-sync model; and eleven DesignFlow frontend files. It found none in DesignFlow BFF, item-master or tracking, PopDAM, PopPIM, PopCRM, Hiclaw, Synology Monitor, or devops-mcp after mirrored shared-db copies and documentation were excluded. Those zeroes are recorded evidence, not a claim that the applications have no dependency on canonical `core.*` tables.

Live catalog inspection found no matching non-internal trigger, view, or function definition in the bounded search. It did find the foreign keys listed above. A release-time catalog recheck remains mandatory because the database and migration ledger can change after this audit.

## Decisions that remain Albert's

The schema and code cannot prove which business population Albert wants as the starting canonical property list, how the 500 misleading `PROPERTY` rows should be treated, how mixed licensor rows map, how agreements map to licensors, whether reviewed imports may create masters, which app owns review, whether compatibility views are required, or the production window. Ask one question at a time before the affected design is fixed.

### First question to ask

Which table should be the starting property master?

- **Use `core.property` as the starting list, then review unmatched source records. Recommended.** It is already typed, uses stable UUIDs, and many live app foreign keys point to it.
- Use the 500 `PROPERTY` rows from the mixed table. This risks treating style-guide or licensed-group records as true properties.
- Start a new empty property list. This gives the cleanest slate but breaks existing IDs and creates the largest review and app-migration burden.

Recommendation: use `core.property` as the seed because it preserves the widest existing cross-app contract while keeping uncertain mixed rows out of the master until review.

## Next gate

After Albert answers the first question, update STATUS and ask the next evidence-dependent question. Do not write schema SQL until all eight decisions are settled and the target design names one canonical table for every business record type.
