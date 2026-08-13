# Normalized licensing master: implementation plan and Phase 1 dependency audit

**Workstream:** fix licensor tables · **Issue:** #912 · **Mode:** read-only audit

## STATUS

| Phase | State | Evidence / blocker |
|---|---|---|
| 1. Dependency audit | COMPLETE for the named canonical local checkouts and production catalog | This document. No unexplained code reference to an old table remains in the scanned checkouts. |
| 2. Measure and classify data | IN PROGRESS: count-only baseline complete | Production counts and a mutually exclusive classification framework are below. Assigning destinations is blocked on Albert's first decision and private evidence review. |
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

## Phase 2 count-only baseline

Measured read-only on production `qsllyeztdwjgirsysgai` on 2026-08-13. The target was proved immediately before each query. Results contain counts only, never licensed names or source values.

The ledger was rechecked against Phase 2's `origin/main` (`e448594fbec57ac03ba839ff4aac9c021c964bff`). It then had five merged-but-not-applied migrations: the three recorded in Phase 1 plus `20260813190000` and `20260813200000`. Neither new migration changes the normalized licensing objects measured here.

| Measure | Count | Meaning |
|---|---:|---|
| Mixed rows | 10,122 | 500 rows labeled `PROPERTY`; 9,622 labeled `CHARACTER`. |
| Normalized character labels | 8,275 | Punctuation/case/spacing normalization only. This is not an identity count. |
| Character rows whose normalized label repeats | 2,037 | Name-only deduplication would be unsafe. |
| Normalized labels attached to multiple source character IDs | 513 | Direct proof that equal labels cannot auto-merge. |
| Source character IDs attached to multiple normalized labels | 58 | A source ID also needs source-contract review; labels can drift or the ID grain may differ. |
| Character rows with blank character source ID | 0 | All current character appearances retain a source character ID. |
| Character rows with blank licensed-property source ID | 604 | Parent source context is incomplete on part of the population. |
| `PROPERTY` rows with blank licensed-property source ID | 2 | These cannot auto-map by source identity. |
| Distinct source property IDs on 500 `PROPERTY` rows | 497 | At least one source-ID collision exists; the 500 rows are not 500 proven identities. |
| Old property-character links | 9,622 | Every character appearance has exactly one old parent; none has two or zero. |
| Old parents with linked characters | 335 | 165 old parents have no character link. |
| Orphan, self, duplicate, or wrong-type old links | 0 | The links are structurally consistent with their old labels, though those labels are not canonical business meaning. |
| DesignFlow item links | 1,924 items, 80 distinct mixed nodes | 1,099 links point to 58 `CHARACTER` nodes; 825 point to 22 `PROPERTY` nodes. |
| Orphan item links | 0 | All current item links resolve in the mixed table. |
| Canonical property / character / style-guide rows | 256 / 0 / 0 | The typed foundation exists, but only property is populated. |
| Canonical property-character / style-guide-character links | 0 / 0 | No normalized character relationships are live. |
| Canonical licensor / legacy license-list rows | 26 / 19 | These are different grains; 18 of 19 legacy rows contain royalty terms. |
| Canonical source refs | 505 | 468 property and 37 licensor refs; zero blank source IDs and zero source identity keys mapped to multiple canonical IDs. |
| Core versus dflow copies | 0 differences | Mixed rows, old links, legacy license rows, and item links are exact copies for the compared business fields. |

### Immediate conclusions

1. No current mixed row may be silently discarded. The old associations are complete and 1,924 current item-link rows depend on 80 old nodes.
2. A label is candidate evidence only. The 513 same-label/different-source-ID groups prove that name deduplication would merge records the source distinguishes.
3. `core.property` is the least disruptive possible property seed, but that is still an owner choice. It already has broad live foreign-key use while `core.character` and `core.style_guide` are empty.
4. Item links need a separate bridge. A direct FK swap is impossible because 825 links currently target old rows labeled `PROPERTY`, not character rows.
5. The identical `core` and `dflow` copies need one migration mapping, not two independently inferred mappings.
6. The 500 old parent rows cannot yet be divided into true property versus style-guide candidates using public structural evidence alone. Their source IDs, old parent role, and presence of children are classification inputs, not proof of business type.

## Phase 2 row-category framework

Every old row receives exactly one current-state category. Destination is recorded separately, so an uncertain business destination never causes a row to disappear.

| Category | Exact rule | Allowed next action |
|---|---|---|
| Safe automatic migration | Unique nonblank source identity, approved entity-type contract, one unambiguous canonical target, and no conflicting prior review | Create or reuse one crosswalk entry; never merge by label alone. |
| Requires human review | Missing source key, conflicting source evidence, label-only candidate, uncertain entity type, or more than one plausible target | Create a review task with safe internal keys and counts. No canonical promotion. |
| Invalid duplicate | Same source-system/entity/source-ID is proven to be the same source record and duplicates are byte/grain equivalent under the source contract | Retain one target plus reversible mappings from every old ID. Never infer this from name. |
| Orphan requiring repair | Missing endpoint, wrong endpoint type, or source relationship whose endpoint cannot be resolved | Block relationship promotion; keep the old row and report safe keys privately. |
| Retained for compatibility | Still read or written by an application, report, FK, job, or rollback path | Keep read-only compatibility until usage is proven zero. |

Precedence is deliberate: orphan/conflict forces review; active dependency forces compatibility retention even when a destination is known; only reviewed source identity can make migration automatic. The migration ledger must record the old table, old safe ID, proposed entity type, target ID if any, category, evidence method, review state, and timestamps.

## Phase 2 query and test contract

The executable audit must use aggregate SQL or safe internal keys only and must assert:

1. `count(categories) = count(old rows)` and each old key appears once.
2. Category sets do not overlap.
3. Every old link has a categorized source and endpoint.
4. Same normalized label with different source IDs never enters automatic migration.
5. Blank source IDs never enter automatic migration.
6. A source identity maps to at most one active canonical ID per entity type.
7. Every item-linked old node is either mapped or explicitly retained for compatibility.
8. A second classification run produces the same categories and zero new canonical proposals.
9. Core and dflow copies map to the same canonical IDs rather than creating duplicates.
10. Output errors contain counts and safe internal IDs only, with no licensed label, source payload, path, or contract text.

The count query set must cover row totals by old type; distinct and blank source IDs; normalized-label collisions across distinct source IDs; orphan/self/wrong-type/duplicate links; item references by endpoint type; canonical/source-ref counts; and symmetric differences between the core and dflow copies. Before any later write, the runtime tool must independently prove its database target and refuse a broad migration batch.

## Next gate

After Albert answers the first question, update STATUS and ask the next evidence-dependent question. Do not write schema SQL until all eight decisions are settled and the target design names one canonical table for every business record type.
