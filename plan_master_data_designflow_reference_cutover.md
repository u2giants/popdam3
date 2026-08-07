# Master Data and DesignFlow Shared Reference Cutover Plan

## STATUS

| Step | Status | Date | Evidence or next gate |
|---|---|---|---|
| 1. Freeze baselines and confirm exact production sources | ⬜ open | 2026-08-06 | Fresh session starts here. Produce read-only counts, schemas, and source-ref coverage before changing data. |
| 2. Compare Packaging Types | ⬜ open | 2026-08-06 | Reconciliation artifact classifies every hard-coded DesignFlow value and every `core.packaging_type` row. |
| 3. Compare MG04 Sizes with `core.product_size` | ⬜ open | 2026-08-06 | Reconciliation artifact covers all ColdLion MG04 rows, all source refs, and all live-item usage. |
| 4. Compare DesignFlow item assignments with `core.creative_designer` | ⬜ open | 2026-08-06 | Reconciliation artifact distinguishes users, assignment roles, and canonical creative designers. |
| 5. Compare DesignFlow Vendors with ColdLion-backed `core.factory` | ⬜ open | 2026-08-06 | Reconciliation artifact resolves every referenced DesignFlow Vendor or records an explicit exception. |
| 6. Compare and design the `itemDepth` Supabase move | ⬜ open | 2026-08-06 | Reconciliation artifact proves row, code, title, status, and item-usage coverage. |
| 7. Review comparison report and lock cutover mappings | ⬜ open | 2026-08-06 | Albert approves only ambiguous merges, splits, and retirements. Exact matches do not need manual review. |
| 8. Implement canonical shared-db contracts | ⬜ open | 2026-08-06 | Shared-db preview passes data, FK, RLS, API-view, and rollback checks; PR is merged and production apply is verified. |
| 9. Cut DesignFlow consumers over | ⬜ open | 2026-08-06 | Item Details reads and writes canonical UUID-backed sources; sandbox UI and API checks pass. |
| 10. Cut PopDAM Master Data consumers over | ⬜ open | 2026-08-06 | Depth and other shared pickers use the same canonical sources as DesignFlow; live save and reload checks pass. |
| 11. Retire duplicate paths and verify convergence | ⬜ open | 2026-08-06 | No hard-coded Packaging list or active duplicate lookup path remains; cross-app equality checks pass. |

Fresh-session instruction: begin at the first open row. Before each new phase, re-read this entire plan and update this STATUS table with exact commits, PRs, verification results, and blockers. Do not leave completed work described as pending.

## 1. The ultimate goal

POP staff must see and edit the same approved Packaging Type, Product Size, Creative Designer, Factory/Vendor, and Depth values in PopDAM Master Data and DesignFlow Item Library/Item Details. A change made in one application must not create a second, conflicting version of the same item fact.

The shared sources must have clear ownership:

- Packaging Type: `core.packaging_type`.
- Product Size: `core.product_size`, populated from ColdLion merchandise group 04, called MG04.
- Creative Designer: `core.creative_designer` for the creative-designer role. Other DesignFlow assignment roles remain distinct.
- Factory/Vendor: `core.factory`, populated by the guarded ColdLion `/vendors` sync and linked through stable source references.
- Depth: a canonical Supabase lookup migrated from DesignFlow's current `itemDepth` table, preserving stable source identity and used by both applications.

The immediate task is comparison first. No source row may be merged, deleted, renamed, or repointed until the comparison report proves the mapping or records an explicit human decision. If a step conflicts with this goal, the goal wins. Stop and flag the conflict.

## 2. What the applications are

### PopDAM

PopDAM is POP Creations' internal digital asset manager. Its Master Data screen is a spreadsheet-like React and AG Grid interface for licensed and generic SKU records. The production URL is `https://dam.designflow.app/styles`. The app repository is `u2giants/popdam3`, locally `/worksp/popdam`, and normal app work lands on `main`.

Relevant PopDAM areas:

- `src/pages/StylesPage.tsx`: Master Data columns, picker queries, validation, and writes.
- `docs/MASTER_DATA.md`: durable Master Data behavior and known gaps.
- `public.style_tracker_rows`: Master Data row storage in the shared Supabase project.
- `public.style_tracker_rows_with_bridge`: read view that links tracker rows to ERP, DAM, customer, designer, factory, and PLM records.

### DesignFlow PLM

DesignFlow is POP Creations' product lifecycle management system. Item Library and Item Details are the operational item record. The Angular frontend calls Node services through the BFF. The sandbox URL is `https://alsand.designflow.app`; production is `https://designflow.app` unless current DesignFlow docs state otherwise.

The six repositories are `popcre/designflow-frontend`, `designflow-item-master`, `designflow-backend`, `designflow-bff`, `designflow-tracking`, and `designflow-data-syncing`. Work must stay on `sandbox-albert`, use `develop` as the PR base, and be reviewed and merged by Uma. Never work on or merge to `main`.

Relevant DesignFlow areas:

- `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts`: Item Details picker loading and item-header writes.
- `designflow-frontend/src/app/pages/itemLibrary/`: Item Library grid and inline editors.
- `designflow-frontend/src/app/pages/editor/item-depth-aggrid/`: current Depth administration screen.
- `designflow-backend/models/db/itemDepth.js`, `services/itemDepth.service.js`, `models/lib.model.js`, and `routes/itemDepth.router.js`: current Depth lookup API.
- `designflow-item-master/services/item_detail.service.js`: allow-listed Item Header writes.
- `designflow-item-master/models/db/itemHeader.js`: current item-header model, including `item_depth_size` and merchandise-group fields.

### Shared database and ColdLion

The shared hosted Supabase project is `qsllyeztdwjgirsysgai`. Canonical schema changes belong only in `u2giants/shared-db`, locally `/worksp/shared-db`, using a dedicated branch, preview branch, PR, merge, and production apply. App repositories must not contain shared schema migrations.

ColdLion is the ERP source for merchandise groups and Vendors. Credentials live in 1Password vault `vibe_coding`; the existing item title for the API credential is `Coldlion ERP API key x5.coldlion.com`. Never place the value in files, logs, plans, or commits.

## 3. What triggered this work

On 2026-08-06, Carlos tried to change a SKU's Depth in PopDAM Master Data from `0.5"` to `0.63"`. Enter appeared to do nothing. Investigation found that PopDAM has no real Depth field. The Description editor treats dimensions and depth as one Size string and validates that string against the Product Size picker. PopDAM therefore rejected a valid Depth change because it consulted the wrong lookup.

DesignFlow Item Details already has a dedicated Depth picker. It loads active values through `getItemDepth()` and stores the selected title in the item's `item_depth_size`. The business requirement is that the same item in Master Data and DesignFlow must use the same value and the same approved lookup.

The follow-up audit found four additional reference-data boundaries that could drift:

1. DesignFlow hard-codes Packaging Types while PopDAM uses `core.packaging_type`.
2. PopDAM uses `core.product_size`; DesignFlow Size is MG04.
3. PopDAM uses `core.creative_designer`; DesignFlow has role-based item assignments.
4. PopDAM uses the shared Factory list; DesignFlow Item Details uses its Vendor field.

## 4. Scope

### In scope

- Produce reproducible, read-only comparison artifacts for all five domains.
- Prove the authoritative source, stable identity, row counts, status rules, duplicates, unmatched values, and live-item usage for each domain.
- Verify that ColdLion MG04 is the source for `core.product_size`, including inactive-but-referenced MG04 rows.
- Verify that ColdLion `/vendors` is the source for `core.factory` and reconcile DesignFlow Vendor references to it.
- Define how only DesignFlow creative-designer assignments map to `core.creative_designer`, without collapsing other assignment roles.
- Design and then implement the move of `itemDepth` into the canonical Supabase schema.
- Make DesignFlow and PopDAM consume the same canonical lookups after comparison approval.
- Preserve source IDs and add explicit foreign keys or source-reference mappings so names are labels, not identities.
- Update documentation, automated tests, CI, and deployment verification.

### Not in this plan

- Replacing `public.style_tracker_rows` with the entire DesignFlow item record.
- Synchronizing every Master Data workflow field with DesignFlow.
- Reworking licensing, sample, concept, production-approval, photography, or test-report workflows.
- Merging creative designers with artists, technical designers, product managers, salespeople, or other assignment roles.
- Treating DesignFlow Vendors as free-form names after the cutover.
- Moving unrelated DesignFlow tables to Supabase.
- Changing ColdLion itself.
- Deleting legacy tables during the first cutover. Retirement happens only after measured zero-use and an approved rollback window.

## 5. Current state of the code and data contracts

The evidence below was checked against PopDAM's current working tree and the DesignFlow `develop` branch on 2026-08-06. The read-only GitHub snapshots were:

- `designflow-frontend` `957d339e498f050b6f6fcfe32b4ffe0b53cec36a`
- `designflow-item-master` `7405ebd8fe5f4c23ac8eb009d42efbaba52b592e`
- `designflow-backend` `2d4979ca7b1f9856be67de53dda7e1e3c496f58d`
- `designflow-bff` `feb33ef67c4c57be20b333c2d883f81f53fb36f3`

Re-check current `develop` before implementation. These SHAs are evidence, not branches to modify.

### Packaging Type

- PopDAM loads active rows from `core.packaging_type` in `src/pages/StylesPage.tsx:669-678` and rejects values outside that list in `StylesPage.tsx:1205-1209`.
- DesignFlow Item Details defines eight Packaging Type strings directly in `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts:80-89` and writes the selected string to `itemHeader.udf_freeform_06` around `itemDetail.component.ts:955-956`.
- `core.packaging_type` is already the documented shared target in `/worksp/shared-db/docs/unified-supabase-schema-map.md:62`.

### Product Size / MG04

- PopDAM loads `core.product_size` in `src/pages/StylesPage.tsx:757-765`; if that query fails, it falls back to distinct `public.style_groups.size_name`, then to a hard-coded emergency list at `StylesPage.tsx:189-200` and `StylesPage.tsx:767-776`.
- PopDAM currently embeds Size inside Description rather than storing a stable `product_size_id`; see `StylesPage.tsx:1133-1153`.
- The canonical migration design identifies MG04 as Size and `core.product_size` as the target. See `/worksp/shared-db/docs/designflow-master-data-migration/README.md:316-320` and `:528`.
- The same migration design records 661 MG04 rows, only 3 marked active, while live items still reference inactive rows. All MG04 rows must be imported; see that document at `:108-125` and `:654-710`.
- DesignFlow Item Details stores the selected MG04 identity in `itemHeader.udf_merchgroup04_id` and a legacy code in `udf_merchgroup04`; selection occurs in `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts:545-550`.

### Creative Designer

- PopDAM reads active `core.creative_designer` rows in `src/pages/StylesPage.tsx:631-643` and stores a tracker text value plus a bridge link.
- The shared-db bridge already has `creative_designer_id`; see `/worksp/shared-db/supabase/migrations/20260707171500_masterdata_designer_resolution.sql`.
- DesignFlow Item Details has multiple assignment roles, including `creative_designer` and `technical_designer`, in `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts` near the assignment-role definitions. The comparison must use role plus person identity, not person name alone.
- The DesignFlow Item Master architecture maps `productUserAssignment` into the future PLM item model, but the current assignment source and auth user identity must be inventoried before any FK design.

### Factory / Vendor

- PopDAM reads `api.dam_factory_list`, which exposes approved shared Factory rows, in `src/pages/StylesPage.tsx:646-666`.
- DesignFlow Item Details loads its Vendor list through `getAllVendors()` and stores the selected legacy Vendor ID in `itemHeader.vendor_code_fk`; see `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts:476-485`, `:585`, and `:952`.
- ColdLion `/vendors` already feeds `core.factory` through `/worksp/shared-db/tools/sync-coldlion-vendors.mjs`. The guarded database importer is `plm.sync_coldlion_vendors`; the public service-role wrapper is `public.sync_coldlion_vendors`.
- The canonical map names `core.factory` as the shared target; see `/worksp/shared-db/docs/unified-supabase-schema-map.md:63`.
- Do not use display names as keys. ColdLion `vendorCode`, DesignFlow legacy IDs, and canonical UUIDs require source-reference rows.

### Depth

- DesignFlow's current lookup model is `itemDepth` with `itemDepth_id`, `itemDepth_code`, `itemDepth_title`, and `itemDepth_status`; see `designflow-backend/models/db/itemDepth.js`.
- The current API returns rows with `itemDepth_status = 'ACTIVE'`; see `designflow-backend/models/lib.model.js` in `Customer.getItemDepth` and `designflow-backend/services/itemDepth.service.js`.
- Item Details loads this list in `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts:1069-1079`, selects by title around `:590`, and writes the title into `itemHeader.item_depth_size` around `:961-962`.
- Shared-db's reconciled DesignFlow baseline contains `dflow."itemDepth"`, but that baseline copy is not by itself proof that it is the live write authority. See `/worksp/shared-db/supabase/migrations/20260710135950_reconcile_dflow_baseline.sql` around the `itemDepth` table definition.
- PopDAM has no dedicated Depth column today. A pending source-sheet gap was already recorded in `docs/MASTER_DATA.md` under `Pending Sampling Tracker Fields`.

### Git and deployment state

- No implementation from this plan has started.
- No production or shared business data was changed during planning.
- `/worksp/shared-db` had unrelated untracked `.ai` review/session artifacts on 2026-08-06 and was on branch `docs/clickup-handoff`. A new implementation session must not mix those files or that branch with this work.
- PopDAM's working tree also contains unrelated work owned by other sessions. Stage only plan-specific or implementation-specific files.

## 6. Key findings and root cause

1. The Carlos failure was caused by a domain-model error, not by Enter. PopDAM has no Depth field and validates a combined Description/Size string against Product Size.
2. MG04 is confirmed as Size. ColdLion merchandise-group details are the upstream dictionary, DesignFlow stores MG04 identity on items, and `core.product_size` is already the intended shared target.
3. MG04 status cannot be treated normally. Almost all historical MG04 rows are marked inactive but are still used on live items. Filtering to active rows would remove valid current sizes.
4. Packaging Type is already canonical in Supabase for PopDAM, but DesignFlow bypasses it with eight hard-coded labels.
5. `core.factory` is already the intended canonical Factory table and already has a guarded ColdLion `/vendors` ingestion path. The remaining problem is reconciling and repointing DesignFlow's Vendor identities.
6. A DesignFlow item assignment is not automatically a Creative Designer. The role must equal `creative_designer`; technical designers and other roles must remain separate.
7. The current `itemDepth` identity is numeric and DesignFlow-owned, while shared tables use UUIDs and source references. A safe migration must preserve the old ID as source lineage and move item references without matching only by title.
8. Master Data's bridge currently links records but does not turn tracker edits into DesignFlow item-header edits. Shared lookup values alone will prevent picker drift, but exact item-value convergence requires an explicit write/read ownership contract.

## 7. Approaches considered and rejected

### Rejected: keep Depth inside Description

This caused the reported failure and conflates width/height Size with Depth. It cannot guarantee equality with DesignFlow's item Depth.

### Rejected: add `0.63"` to Product Size

Product Size contains full sizes such as `16x16"` and `11x17"`. Adding a Depth-only value would corrupt the domain and still leave two sources.

### Rejected: copy DesignFlow's eight Packaging strings into PopDAM code

That would create two hard-coded lists. The target is one managed table, `core.packaging_type`.

### Rejected: import only active MG04 rows

The source has 661 MG04 rows but only 3 are marked active, while inactive rows remain referenced by live items. Active-only import would break existing items.

### Rejected: match Sizes, Designers, Vendors, or Depths only by display name

Names can differ in punctuation, spacing, casing, abbreviations, or legitimately collide. Stable source IDs and explicit review decisions are required.

### Rejected: map every DesignFlow item assignment to Creative Designer

DesignFlow has separate roles. This would turn technical designers, product managers, or other assignees into false creative designers.

### Rejected: point PopDAM directly at a copied `dflow.itemDepth` table without proving ownership

The reconciled Supabase baseline may be a mirror. A mirror can lag or be overwritten. The cutover must first establish which service writes the live rows, then make Supabase canonical with one controlled writer.

### Rejected: switch applications before reconciliation

Unmatched legacy IDs would produce blank pickers or change item meanings. Comparison and source-reference coverage are rollout gates, not optional reporting.

### Rejected: perform shared schema changes in PopDAM or a DesignFlow app repo

All shared schema, migration, RLS, API view, and backfill work belongs in canonical `/worksp/shared-db` through preview and PR.

## 8. Design decisions

### Locked decisions as of 2026-08-06

1. Comparison precedes mutation. No ambiguous match is auto-merged.
2. `core.packaging_type` is the canonical Packaging Type lookup.
3. `core.product_size` is the canonical Product Size lookup and is populated from ColdLion MG04.
4. All MG04 rows are ingested for source resolution, regardless of the legacy active flag. Picker visibility needs a separate, usage-aware rule.
5. `core.creative_designer` is canonical only for the DesignFlow `creative_designer` assignment role.
6. `core.factory` is canonical for Factory/Vendor and is fed through the guarded ColdLion `/vendors` path.
7. Depth becomes a proper separate field and lookup. It must not remain embedded only in Description.
8. Legacy IDs are preserved as source references. Names are labels, not keys.
9. Shared database work uses `/worksp/shared-db`; DesignFlow code stays on `sandbox-albert` with PRs to `develop`; PopDAM code lands on `main`.
10. Rollouts are additive first. Legacy columns and endpoints remain available until parity and zero-use are verified.

### Open decisions, resolved by evidence rather than preference

1. Final canonical Depth table name and schema. Recommended default: `core.product_depth`, with `core.product_depth_source_ref` or the existing generic taxonomy source-ref pattern. Use `plm.item_depth` only if the inventory proves Depth is operationally PLM-only. Because PopDAM and other product contexts need it, `core.product_depth` is the expected result.
2. Whether existing `core.packaging_type` rows and DesignFlow strings are exact matches, aliases, or separate concepts. The comparison report decides.
3. How inactive MG04 rows appear in new-item pickers. Existing referenced values must render; new selection should use an explicit approved/selectable policy that does not destroy source status.
4. How a DesignFlow auth user or assignment person maps to `core.creative_designer`. Prefer an immutable person/source-ref bridge. Human review is required for ambiguous names.
5. Whether DesignFlow's current Vendor table contains non-factory contacts or obsolete rows. Only true factories/vendors map to `core.factory`; people belong in contact tables.
6. Whether PopDAM should write canonical item fields directly through a service API or call a shared, audited database function. Choose the fewest-moving-parts path that preserves DesignFlow's authorization, validation, and audit rules. Do not grant broad browser writes to PLM tables.

## 9. Implementation plan

### Phase A: read-only inventories and comparison artifacts

This phase may be split into parallel data-domain sessions after the baseline is frozen. Every comparison script must default to read-only, redact secrets, produce deterministic JSON/CSV/Markdown under a dated `docs/verification/` folder in `/worksp/shared-db`, and include its input timestamps and row counts.

#### Step 1. Freeze baselines and confirm exact production sources

1. Read `/worksp/shared-db/AGENTS.md` in full and the credential runbook it names.
2. Check `git status --short` in PopDAM, shared-db, and all six DesignFlow repos. Stop if another shared-db migration or untracked migration exists.
3. Verify `gh`, Supabase CLI, and read-only database access with real status/query calls. Serialize all 1Password reads and fetch shared environment once.
4. Record current production schemas and counts for:
   - `core.packaging_type`
   - `core.product_size`
   - `core.creative_designer`
   - `core.factory`, `core.factory_source_ref`, and `plm.erp_vendor`
   - `dflow."itemDepth"` or the actual live DesignFlow Depth table
   - DesignFlow `merchGroup` MG04 rows
   - DesignFlow item assignments and roles
   - DesignFlow Vendor rows and item references
   - DesignFlow item headers referencing MG04, Vendor, and Depth
5. Prove whether DesignFlow production currently reads Cloud SQL, Supabase `dflow`, or another schema for each source. Use configuration and read-only equality checks. Do not infer from migration files.
6. Save `docs/verification/master-data-designflow-reference-cutover-YYYYMMDD/baseline.md` plus machine-readable counts.

Verification gate: every source has an exact database/schema/table, primary key, writer, consumer, row count, last-update evidence, and read-only query recorded. No item says `probably` or `assumed`.

#### Step 2. Compare Packaging Types

1. Add a shared-db comparison tool, recommended path `tools/compare-packaging-types.mjs`.
2. Extract the DesignFlow hard-coded list from `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts` and compare it with all `core.packaging_type` rows, including inactive rows.
3. Classify each value as exact match, normalized match, alias candidate, DesignFlow-only, core-only, duplicate, or ambiguous.
4. For each DesignFlow item using `udf_freeform_06`, count usage by raw value and flag values outside both lists.
5. Propose seed/upsert actions that add missing DesignFlow concepts to `core.packaging_type` without deleting or renaming existing canonical rows.
6. Record whether codes already exist and propose stable codes for missing rows only when a deterministic code policy exists.

Verification gate: the report accounts for all eight hard-coded values, 100% of existing Item Details packaging values, and 100% of `core.packaging_type` rows. Counts in category totals equal input totals.

#### Step 3. Compare MG04 with `core.product_size`

1. Add `tools/compare-coldlion-mg04-product-sizes.mjs` in shared-db.
2. Pull ColdLion `/merchGroupHeaders` and `/merchGroupDetails` for every relevant division using the existing guarded API conventions. Save hashes and pagination evidence, not credentials.
3. Compare the ColdLion MG04 composite identity `(companyCode, divisionCode, mgTypeCode, mgCode)` and DesignFlow `merchGroup.mg_id` with `core.product_size` and its taxonomy source references.
4. Include all MG04 rows regardless of `is_active`.
5. Count live items by `udf_merchgroup04_id` and code. Identify:
   - MG04 rows referenced by items but missing from core.
   - core sizes with no ColdLion source reference.
   - duplicate labels with different codes or divisions.
   - one ColdLion concept repeated across divisions.
   - item rows whose ID and code disagree.
6. Define a stable deduplication rule. Prefer one canonical `core.product_size` row for semantically identical sizes, with multiple source refs when division copies are the same concept. Require review when normalized labels collide but dimensions or meaning differ.
7. Define separate `source_status` and `selectable_for_new_items` behavior so inactive-but-referenced sizes remain resolvable.

Verification gate: every ColdLion MG04 row and every live item's MG04 reference resolves to exactly one proposed canonical size or one explicit review finding. No live item would display blank after cutover.

#### Step 4. Compare item assignments with Creative Designers

1. Add `tools/compare-designflow-creative-designers.mjs` in shared-db.
2. Inventory DesignFlow assignment tables, person/user tables, role values, active status, email where permitted, and item usage.
3. Filter the mapping candidate set to assignment role `creative_designer`. Report other roles separately and never propose them for `core.creative_designer`.
4. Compare against `core.creative_designer` using stable external user IDs or verified email first, exact normalized name second, and fuzzy name only as a review suggestion.
5. Detect one-to-many and many-to-one conflicts, shared names, former employees, aliases, and assignments with missing people.
6. Propose a durable source-reference table or extension of an existing person source-ref pattern. It must map DesignFlow person identity to the canonical creative-designer UUID.
7. Count affected items per mapping so high-impact ambiguity is reviewed first.

Verification gate: every DesignFlow `creative_designer` assignment is exact, proposed for review, intentionally excluded, or orphaned with an action. Non-creative roles have zero proposed canonical creative-designer writes.

#### Step 5. Compare Vendors with ColdLion-backed Factories

1. Add `tools/compare-designflow-vendors-core-factories.mjs` in shared-db.
2. Run the existing ColdLion Vendor pull in dry-run mode using `tools/sync-coldlion-vendors.mjs --dry-run`; never invent a second ingestion path.
3. Compare DesignFlow Vendor primary keys and codes, ColdLion `vendorCode`, `plm.erp_vendor`, `core.factory_source_ref`, and `core.factory`.
4. Count current `itemHeader.vendor_code_fk` usage and identify deleted, inactive, duplicate, contact-only, and unmatched legacy Vendor rows.
5. Use source code as the first key. Use normalized name only to propose review candidates.
6. Identify DesignFlow Vendor rows that represent people rather than factories and keep them out of `core.factory`.
7. Produce a proposed legacy-ID-to-canonical-UUID bridge with a reason and confidence for every row.

Verification gate: every Vendor referenced by an item resolves to exactly one canonical Factory or an explicit blocking exception. The reconciliation agrees with the current ColdLion `/vendors` universe and does not re-admit excluded rows.

#### Step 6. Compare Depth and design its Supabase move

1. Add `tools/compare-designflow-item-depths.mjs` in shared-db.
2. Inventory all current `itemDepth` rows, including inactive rows, duplicate titles/codes, blank codes, and audit fields.
3. Count item usage by stored `itemHeader.item_depth_size` text and compare it with lookup titles. Include values not found in the lookup, including `0.63"` if present.
4. Compare Cloud SQL/current authority with the reconciled Supabase `dflow."itemDepth"` copy row by row. Measure lag and identify the writer.
5. Propose canonical `core.product_depth` columns: UUID `id`, stable `code`, display `name`, `status`, source metadata, timestamps, and uniqueness rules. Preserve legacy `itemDepth_id` through a source-reference row.
6. Propose an item-level canonical `product_depth_id` FK on the future/current PLM item representation. Keep legacy `item_depth_size` text during transition.
7. Define title parsing and units. Store a normalized numeric quantity and unit only if every source value can be represented safely; otherwise preserve the exact display text and add normalized fields additively.
8. Define the single writer for Depth administration after cutover. Recommended: DesignFlow Depth admin writes the canonical Supabase table through an authenticated server API; PopDAM reads it and may edit item selection, not administer the lookup unless explicitly authorized.

Verification gate: all lookup rows and all item text values are accounted for; the report proves the current writer and mirror status; the proposed migration preserves every referenced legacy value and ID.

#### Natural context cut point A

Start a fresh session after Steps 1-6. Re-read the comparison reports and this plan before Step 7. Do not begin schema work while any comparison total is unbalanced.

### Phase B: decisions and shared-db implementation

#### Step 7. Review and lock mappings

1. Generate one executive summary with totals for exact matches, safe additive inserts, aliases, ambiguous rows, exclusions, and orphans per domain.
2. Auto-approve only identity-proven exact matches and additive rows that do not collide.
3. Present Albert only the ambiguous business decisions, with usage counts and one recommended choice each.
4. Store approved mapping decisions as versioned CSV/JSON fixtures in the verification folder. Include decision date and reason.
5. Update this plan's locked decisions and STATUS table.

Verification gate: every ambiguous row has an explicit decision; mapping fixture hashes are recorded; no implementation query contains undocumented fuzzy matching.

#### Step 8. Implement canonical shared-db contracts

Use one dedicated `/worksp/shared-db` branch. Follow `/worksp/shared-db/AGENTS.md` preview-first workflow. Split migrations by dependency and rollback safety, but keep one coherent PR unless the shared-db guide requires smaller PRs.

1. Packaging Type:
   - Add approved missing rows to `core.packaging_type` with idempotent seed/upsert SQL.
   - Add aliases/source refs only if the comparison proves they are needed.
2. Product Size:
   - Add or repair the guarded ColdLion MG04 importer using the existing taxonomy ingestion patterns, not a new direct browser path.
   - Import all MG04 source rows and link them to `core.product_size` through stable source refs.
   - Add an `api` picker view that exposes selectable rows plus legacy referenced rows needed for display.
3. Creative Designer:
   - Add the approved DesignFlow-person source-reference contract.
   - Backfill only approved mappings.
   - Add constraints preventing one active DesignFlow identity from mapping to multiple canonical creative designers unless the model explicitly supports history.
4. Factory:
   - Reuse `plm.sync_coldlion_vendors`, `core.factory`, and `core.factory_source_ref`.
   - Add the DesignFlow legacy Vendor source-reference/backfill needed by Item Header.
   - Do not create a second canonical Vendor table.
5. Depth:
   - Create the approved canonical table, expected `core.product_depth`, its source references, RLS, indexes, and `api` picker view.
   - Import all legacy `itemDepth` rows idempotently.
   - Add the PLM item Depth FK/backfill contract without dropping legacy text.
6. Add database contract tests for uniqueness, source-ref completeness, inactive-but-referenced MG04 visibility, role-scoped designer mapping, Vendor exclusion rules, and Depth parity.
7. Apply to preview, load representative fixtures, run rollback-only backfills, and save query plans/count evidence.
8. Open the shared-db PR, pass checks, merge it as the AI owner per repo rules, apply production through the canonical workflow, and verify migration ledger plus row counts.

Verification gate: preview and production counts match approved fixtures; all live foreign references resolve; anon access is denied; authenticated picker reads work; only approved service roles can mutate; the migration is in the production ledger.

#### Natural context cut point B

Start a fresh session after shared-db production verification. Re-read the downstream phases. Do not write dependent app code before the canonical schema and API views exist.

### Phase C: DesignFlow cutover

#### Step 9. Point DesignFlow at canonical sources

Work only on `sandbox-albert`; PRs target `develop`; Uma merges.

1. Packaging Type:
   - Remove `packageTypeOptions` from `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.ts`.
   - Add a DesignFlow server endpoint or BFF route that reads the canonical Packaging Type API view with normal auth and loud failure behavior.
   - Store canonical `packaging_type_id` on the PLM item where the shared model permits it; retain `udf_freeform_06` as a transitional label until parity is proven.
2. Product Size:
   - Change Item Details and Item Library Size pickers to use the canonical `core.product_size` contract and stable ID.
   - Preserve current selections for inactive-but-referenced MG04 values.
   - Keep ColdLion MG04 source IDs available for ERP writes.
3. Creative Designer:
   - Change only the `creative_designer` assignment picker to `core.creative_designer`.
   - Store the canonical UUID or source-ref-backed identity on assignments.
   - Leave technical designer and all other roles unchanged.
4. Factory/Vendor:
   - Change Item Details Vendor picker to the canonical `core.factory` API view.
   - Store or bridge canonical Factory UUID while retaining the legacy Vendor ID during transition.
   - Ensure ColdLion-required vendor code is resolved through source refs for ERP calls.
5. Depth:
   - Change `getItemDepth()` and the Depth admin screen to the canonical Supabase-backed endpoint.
   - Store canonical `product_depth_id` and maintain legacy text only as a compatibility shadow.
6. Update `designflow-item-master/services/item_detail.service.js` allow-lists for new exact FK fields only after shared schema exists.
7. Add server-side validation. A browser cannot submit an arbitrary UUID or label; supplied IDs must exist and be selectable or already referenced by that item.
8. Update BFF routes only where needed. Do not duplicate reference data in the BFF cache without explicit invalidation.
9. Visually verify Item Details and Item Library in `https://alsand.designflow.app` without creating disposable production-shared business rows.

Verification gate: sandbox loads all five canonical pickers, existing legacy items retain labels, edits persist after reload, API responses contain stable IDs, and browser console/network logs show no relevant error. DesignFlow unit tests, TypeScript, production-equivalent build, Cloud Build, and sandbox deployment SHA all pass.

### Phase D: PopDAM cutover

#### Step 10. Point Master Data at the same sources

1. Add a dedicated Depth column to Licensed and Generic Master Data only after confirming which tracker sheets require it. Do not keep Depth hidden inside Description as the only value.
2. Load Depth from the same canonical `api` view used by DesignFlow.
3. For rows linked to a PLM item, read the current canonical item value. On edit, use the approved audited item-write path selected in Step 8, then refresh both the PLM item and tracker bridge.
4. Decide how unlinked tracker rows behave. Recommended: allow a canonical Depth selection in tracker staging, then transfer it when the row is linked to a PLM item. Mark it clearly as staged, not synchronized.
5. Remove the Product Size fallback behavior as a Depth source. Product Size continues to use `core.product_size`.
6. Confirm Packaging Type, Product Size, Creative Designer, and Factory pickers use the same canonical `api` views/contracts as DesignFlow. Replace direct-table reads where a common view is needed for identical visibility rules.
7. Keep tracker-only workflow fields in `public.style_tracker_rows`; do not redirect unrelated status fields.
8. Add clear save success and failure messages. Failed cross-app writes must restore the old displayed value and explain what was not saved.
9. Visually verify `https://dam.designflow.app/styles` after deployment. Reproduce Carlos's exact change from `0.5"` to `0.63"`, save, reload, and confirm DesignFlow Item Details shows the same Depth.

Verification gate: the same linked SKU shows identical Packaging Type, Size, Creative Designer, Factory/Vendor, and Depth identities in both apps; editing Depth in Master Data survives reload and appears in DesignFlow; failed saves are visible and do not leave false local state.

### Phase E: convergence and retirement

#### Step 11. Remove duplicate lookup paths after a measured soak

1. Run daily parity queries during an agreed soak period, recommended seven days, covering all linked items.
2. Alert on canonical ID mismatch, missing source refs, legacy/canonical label mismatch, or writes to retired paths.
3. After zero unexplained mismatches for the full soak:
   - Remove DesignFlow's hard-coded Packaging Type list.
   - Disable legacy Depth lookup writes and old endpoints.
   - Stop dual-writing legacy labels where consumers no longer need them.
   - Keep source-reference history permanently.
4. Drop legacy columns or tables only in a later, separately reviewed migration with proven zero readers and a restore procedure.
5. Update `docs/MASTER_DATA.md`, DesignFlow architecture/API docs, shared-db schema maps, and app migration notes.

Verification gate: repository search and runtime telemetry show zero active consumers of retired paths; parity queries remain clean; rollback instructions were tested before any destructive cleanup.

## 10. Tests required

### Shared-db comparison tools

- `tools/compare-packaging-types.test.mjs`
  - exact, normalized, alias, core-only, DesignFlow-only, duplicate, and ambiguous classifications;
  - category totals equal input totals;
  - hard-coded list extraction fails loudly if the source shape changes.
- `tools/compare-coldlion-mg04-product-sizes.test.mjs`
  - composite source identity includes company, division, MG type, and code;
  - inactive MG04 rows are not discarded;
  - duplicate cross-division labels can share canonical identity only under the approved rule;
  - conflicting labels/codes require review.
- `tools/compare-designflow-creative-designers.test.mjs`
  - only `creative_designer` role maps;
  - exact immutable identity outranks name;
  - ambiguous names never auto-map.
- `tools/compare-designflow-vendors-core-factories.test.mjs`
  - ColdLion vendor code outranks name;
  - excluded/contact-only rows never become factories;
  - referenced unmatched Vendors block cutover.
- `tools/compare-designflow-item-depths.test.mjs`
  - inactive and unlisted-but-used values are retained in findings;
  - duplicate title/code conflicts block automatic mapping;
  - unit parsing never changes the exact display value.

### Shared-db contracts

- SQL contract tests proving RLS, grants, uniqueness, source-ref identity, idempotent import, count-drop guards, and rollback.
- A fixture with an inactive-but-referenced MG04 row that remains readable for an existing item but follows the approved new-selection policy.
- A fixture proving a technical designer cannot enter `core.creative_designer` through the assignment importer.
- A fixture proving a legacy Vendor maps through source refs to one `core.factory`.
- A fixture proving legacy `itemDepth_id` maps to one canonical Depth UUID and the item backfill preserves its displayed title.

### DesignFlow

- Frontend tests for canonical picker loading, visible errors, legacy referenced values, and no hard-coded Packaging list.
- Item Master service tests for allow-listed FK writes, invalid UUID rejection, inactive-but-current Size behavior, role-scoped designer assignments, canonical Factory resolution, and Depth writes.
- BFF route tests for auth forwarding and upstream failure propagation if new routes are added.
- Existing full frontend and Item Master unit suites plus TypeScript and production-equivalent builds.
- Browser test of Item Details and Item Library with stable page content, no blank page, no relevant console/page/network errors, and saved values after reload.

### PopDAM

- `src/test/master-data-reference-sources.test.ts`: each shared picker uses the approved canonical view and no Depth path calls Product Size.
- `src/test/master-data-depth-edit.test.ts`: linked and unlinked behavior, successful save, failed save rollback, and `0.5"` to `0.63"` regression.
- Extend Master Data audit tests to prove old/new canonical IDs and labels are recorded.
- Existing targeted Vitest suite, full tests, lint, and production build.
- Visual screenshot showing the Depth picker and the saved `0.63"` value after reload.

## 11. Constraints and gotchas

1. Shared database changes originate only in `/worksp/shared-db` on a dedicated branch with preview, PR, AI-owned merge, and verified production apply.
2. DesignFlow work stays on `sandbox-albert`; PRs target `develop`; Uma reviews and merges; never touch `main`.
3. PopDAM normally works on `main`. Before the first commit in every repo, `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>`; run the approved identity helper if not.
4. Production and shared cloud infrastructure are read-only by default. Do not mutate production with personal cloud credentials.
5. Serialize all 1Password reads. Never expose secrets or rotate credentials without approval.
6. The shared-db checkout had unrelated untracked files during planning. Preserve them and stage only owned files.
7. DesignFlow's existing local workspaces may be owned by another OS user. Do not change permissions. Use the correct machine/session or a clean clone.
8. MG04 active status is misleading. Import all MG04 rows and preserve source status; do not equate source inactive with safe deletion.
9. ColdLion merchandise-group identity is division-scoped. Never key only by `mgCode` or label.
10. ColdLion `/vendors` uses the guarded existing importer. Do not create a new direct sync or bypass its exclusion/quarantine rules.
11. A user assignment role is part of identity. Do not collapse roles.
12. UI code must fail loudly when a canonical lookup is unavailable. Do not silently fall back to stale hard-coded values after cutover.
13. Use stable UUIDs/source refs for stored relations. Keep display labels editable without changing identity.
14. Additive migration first, backfill second, consumer cutover third, retirement last.
15. Verify browser work visually and with network/console checks before reporting completion.
16. AG Grid work in DesignFlow must follow the DesignFlow AG Grid documentation and current Theming API rules.

## 12. Access and environment

- GitHub CLI was authenticated as `u2giants` during planning and could read the private `popcre` repositories. Re-verify with `gh auth status`.
- Shared Supabase project: `qsllyeztdwjgirsysgai`, Virginia. Do not use the decommissioned Ohio PopDAM project.
- Supabase/database credentials and exact CLI commands: read `/worksp/shared-db/AGENTS.md`. Secrets live in 1Password vault `vibe_coding`.
- ColdLion credential: 1Password vault `vibe_coding`, item `Coldlion ERP API key x5.coldlion.com`.
- PopDAM production: `https://dam.designflow.app/styles`.
- DesignFlow sandbox: `https://alsand.designflow.app`.
- DesignFlow repositories: use an accessible clean workspace, work only on `sandbox-albert`, and sync from `develop` using the `codex-dflow-plm` workflow.
- PopDAM local checks use the root `package.json`; inspect scripts before running exact test/build commands.
- Shared-db comparison tools run with read-only database access first. Any `--apply` mode must be explicit, preview-first, and guarded.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] All five comparison reports are complete, reproducible, balanced, and reviewed.
- [ ] Every ambiguous mapping has an explicit dated decision.
- [ ] `core.packaging_type` contains the approved union and DesignFlow has no hard-coded production list.
- [ ] `core.product_size` has complete ColdLion MG04 source-ref coverage, including inactive-but-referenced rows.
- [ ] DesignFlow creative-designer assignments use `core.creative_designer`; other roles remain separate.
- [ ] DesignFlow Vendors resolve to ColdLion-backed `core.factory` or an explicit approved exception.
- [ ] Depth is a separate canonical Supabase lookup with preserved legacy IDs and item FKs.
- [ ] PopDAM and DesignFlow read the same canonical API views and store stable identities.
- [ ] Carlos's `0.5"` to `0.63"` edit succeeds, survives reload, and appears identically in DesignFlow Item Details.
- [ ] Unit, SQL contract, integration, TypeScript, lint, build, browser, and parity tests pass.
- [ ] Shared-db migration is merged and present in the production ledger.
- [ ] PopDAM changes are committed and pushed; CI is green; live build SHA is verified.
- [ ] DesignFlow changes are committed and pushed on `sandbox-albert`; PRs to `develop` are ready for Uma; sandbox deployed SHA is verified.
- [ ] Durable docs and STATUS are current; no mystery untracked migration or handoff file remains.
- [ ] The parity soak finishes with zero unexplained mismatches before legacy retirement.

### Main risks and mitigations

- MG04 duplicates across divisions could be incorrectly merged. Mitigation: composite source identity, live usage counts, and review for semantic collisions.
- Inactive MG04 rows could disappear from existing items. Mitigation: explicit existing-reference visibility tests.
- DesignFlow Vendor rows may mix companies and people. Mitigation: source-code-first mapping and contact-only exclusion.
- Name-based designer mapping could assign the wrong person. Mitigation: immutable ID/email first and human review for ambiguity.
- A mirrored `itemDepth` table could lag the writer. Mitigation: prove authority before migration and cut to one writer.
- Dual writes could diverge during rollout. Mitigation: canonical-ID parity monitoring, visible failures, and short additive transition.
- Cross-app browser writes could weaken security. Mitigation: authenticated server API or narrowly granted audited function, never broad direct table updates.

### Rollback

Each cutover remains additive until the soak completes. Roll back application consumers to the prior read/write path while retaining canonical tables, source refs, and backfilled IDs. Do not delete canonical rows during rollback. Disable new dual writes, reconcile differences from the audit log, then restore service. Legacy table/column deletion is excluded from the initial rollout so rollback does not require data reconstruction.

### Genuine open questions

1. Is current production `itemDepth` authoritative in Cloud SQL or already in Supabase? Step 1 must prove it.
2. What is the approved selectable policy for inactive-but-referenced MG04 rows? Preserve display always; decide new selection from usage and business rules.
3. Which DesignFlow person identity is stable enough for Creative Designer source refs? Prefer an immutable user/person ID, with email as corroboration.
4. Are any DesignFlow Vendor rows valid non-ColdLion exceptions? The comparison report must name them and explain ownership.
5. Should PopDAM write linked item values through DesignFlow Item Master or a shared audited function? Choose after auth and audit comparison; both must preserve the same validation contract.

## Mandatory self-audit

### 1. Could a brand-new AI session execute this plan without asking Albert anything?

Yes. Sections 2, 5, and 6 define the systems, current sources, exact code locations, branch rules, and root causes. Section 9 gives ordered file-level work with a verification gate for every step. Section 12 defines access without exposing secrets. Albert is needed only for genuinely ambiguous mapping approvals in Step 7, where the plan specifies exactly what evidence to present.

### 2. Does the plan carry all current background, nuance, and rejected paths?

Yes. Sections 3 and 5 capture Carlos's exact failure and all five data domains. Section 6 records the non-obvious MG04 inactive-row rule, existing guarded Vendor sync, role-scoped designer distinction, Depth mirror risk, and tracker-versus-item ownership gap. Section 7 records the rejected shortcuts and why they fail. Section 8 labels locked and open decisions.

### 3. Is the ultimate goal clear enough to guide a correct judgment call?

Yes. Section 1 states the business result and canonical owner for each domain, requires comparison before mutation, and explicitly says the goal wins if a step conflicts. Sections 4, 8, and 13 bound scope, decisions, risks, rollback, and completion so an implementer can adjust mechanics without creating a second source of truth.

### Checklist result

Passed on 2026-08-06. All 13 required sections are present. The plan is standalone, includes exact evidence, rejected approaches, locked versus open decisions, concrete steps and tests, per-step verification, access and secrets locations, branch and database rules, deployment proof, rollback, and a complete definition of done.
