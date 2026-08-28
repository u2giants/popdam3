# PopDAM OrderList implementation plan

## STATUS

| Step | Status | Last updated | Evidence / next action |
|---|---|---|---|
| 0. Confirm the legacy source and field contract | ✅ done | 2026-08-09 | Formula audit plus full row profile, item-match census, 48-column map, assortment rules, and source-identity proof: [`docs/app-migration-notes/popdam-order-list.md`](docs/app-migration-notes/popdam-order-list.md). |
| 1. Add the shared database contract | ✅ complete — schema applied on BOTH preview and production | 2026-08-12 | **Four** migrations make up the contract, all on `origin/main` (tip `49fe2fe`): `20260810010000` (commit `523bda0`), `20260810060000` (`35b6494`), `20260810100000` (`59774a7`), and `20260810110000` (`4c98e52`). Earlier wording naming only three and citing PR #663 was incomplete — #663 is a multi-issue integration merge, not the OrderList contract PR. **`20260810110000` is not an optional companion.** It is a split migration serving two workstreams — Warner grants and RLS on eight `plm.wb_*` tables, plus `alter view api.dam_order_list set (security_invoker = true)` — and the OrderList half is load-bearing: without it the view runs as owner `postgres`, which holds BYPASSRLS, so every authenticated reader would bypass RLS on `core.customer`, `core.factory`, `plm.item` and the order tables. It belongs in this package on its own merit. **All four are live on preview `rjyboqwcdzcocqgmsyel` and production `qsllyeztdwjgirsysgai`**, verified 2026-08-12 by read-only catalog inspection — **not** by the migration ledgers, which disagree (preview 430 applied / max `20260812211000`; production 426 applied / max `20260812020000`; `20260810140000` and `20260810180000` are on production but absent from preview, so preview is not a superset). **Consequence: there is no OrderList migration left to promote.** The only outstanding production write is the data import. |
| 1a. The red production apply run — resolved, verifier-only | ✅ resolved 2026-08-12 | 2026-08-12 | Recorded here because the approval package tells this story imprecisely. Run [`31620553795`](https://github.com/u2giants/shared-db/actions/runs/31620553795), job `94194285193`, concluded **`failure`** — but the database work succeeded. Step 9 "Fresh dry-run, then apply" ran against `qsllyeztdwjgirsysgai`, applied all 14 migrations and printed "Finished supabase db push."; step 10 captured the after-ledger. **Only step 11, "Post-apply catalog verification", failed.** **Correction to `docs/verification/popdam-order-list-production-approval-2026-08-12/README.md` line 48:** the false demand was triggered by `20260810020000` (Paramount landing) needing companion `20260810180000` — **not by any OrderList migration** — and `20260810180000` was already applied to production before the run, so the demand was genuinely false. PR **#843** (merge commit `d451d6e`) fixed it by passing `--remote-ledger` to the post-apply verify step, which the pre-apply guards already had. Nothing about this run is pending or unexplained. |
| 2. Rehearse and verify the database contract on preview | ✅ complete — proven behaviourally; the old "86/38" citation is **refuted** | 2026-08-12 | **Struck: "Preview passed 86 object assertions and 38 behavior assertions."** An exhaustive repo search found that figure in exactly two prose locations — this plan and `docs/verification/popdam-order-list-production-approval-2026-08-12/README.md` line 48 — with no artifact, no run ID and no date anywhere. Its only primary source, `HANDOFF.d/2026-08-10T0030Z-al8960ofc-claude-orchestrator-nine-agent-fan-out.md` line 436, actually says **86 object tests and 33 behaviour tests** — 33, not 38 — and describes tests **written in PR #635 on 2026-08-10**, not a preview rehearsal on 2026-08-12. **The figure was a misquotation of a different thing on a different date. Do not cite it again.** The real checkable test artifacts are `supabase/tests/dam_order_list_contract.sql` and `supabase/tests/dam_order_list_item_columns_contract.sql`, but nothing in the repo ties either to an "86/38" run. The contract is proven instead by behaviour recorded in `docs/verification/popdam-order-list-preview-2026-08-12/README.md`: the preview import inserted **3,212 orders and 24,010 lines**, impossible unless `20260810060000` (the NULLS DISTINCT fix to the legacy source pair) is applied, since without it a second line per order cannot exist; a second identical run changed **0** business rows; and **all 10 balance checks PASS (overall BALANCED)**. |
| 3. Import the legacy OrderList data into preview | ✅ complete | 2026-08-12 | **Preview only (`rjyboqwcdzcocqgmsyel`); production NOT touched.** Owner-accepted `OrderList.xlsx` (SHA-256 `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`, issue #727), 12,354 populated rows. Column-AR Style#-mirror root-cause fix (`sub_sku_mirrors_style`) plus 89 focused tests merged to `main` in PR #827 (`070acc5`). Preview write inserted **3,212 orders** and **24,010 lines**; a second identical run changed **0 business rows** (idempotent). **All 10 balance checks PASS (overall BALANCED).** Safe reconciliation report (counts only, no row text): `docs/verification/popdam-order-list-preview-2026-08-12/README.md`. Follow-on: `plm.item` still empty, so `item_id` stays NULL where `resolution = unique` (fix_schema_for_api.md Phase 4). |
| 4. Build the PopDAM OrderList page | ✅ done | 2026-08-26 | PopDAM `/orders` is live in production. The earlier `plm.item` blocker and issues #852/#853 are historical; do not restart them from this plan. Production holds **19,362** ColdLion items. |
| 5. Test the full workflow | ✅ done | 2026-08-26 | Production human QA completed through `u2giants/popdam3#99`: read, cell edit, order editor, create, void/restore, manual relink, and saved views all passed. |
| 6. Land shared-db, seed production, then deploy PopDAM | ✅ done | 2026-08-26 | Schema, guarded production import, item linking, and PopDAM deployment are complete. Of **24,010** order lines, **23,997** are matched and **13** are `not_applicable` because they have no SKU; zero are unmatched or ambiguous. |
| 7. Verify production and update durable docs | ✅ done | 2026-08-28 | Production behavior is verified and this STATUS table now reflects the shipped result. The final access ruling is: every signed-in user may read OrderList; writes remain administrator-only. |

**Fresh-session starting point:** The OrderList workstream is complete. Do not restart issues #852/#853 or repeat the import, deployment, or production QA from this plan. The Phase 3 specification remains useful as implementation history.

## OPEN QUESTIONS

These items are retained as historical decision records; neither blocks the shipped OrderList:

1. **The owner's five-row question is still not answered in the terms he asked it.** The figures are now explained: `docs/app-migration-notes/popdam-order-list.md` lines 89–95 records that **12,328 and 12,323 are two different counting definitions applied to the same sheet lineage, not two measurements of a changing sheet** — the importer's populated definition (any mapped cell non-empty) counts **12,354**, the column-`A` or any-core definition counts 12,349, and 12,323 came from a narrower manual count that the reconciliation never asserted against. Step 3's balance checks all reconcile cleanly against 12,354. **But the owner asked which five rows disappeared, and that itemisation does not exist anywhere in this repository.** The honest position is that the arithmetic no longer implies missing data, while the specific list he asked for was never produced. Close this only by either itemising the five rows or getting the owner to accept the counting-definition explanation instead.
2. **Resolved 2026-08-26:** every signed-in user may read OrderList data; writes remain administrator-only. The production policies already matched this owner ruling, so no corrective migration was required.

## 1. The ultimate goal

POP staff need an OrderList inside PopDAM that replaces the legacy Google Sheet for day-to-day order tracking. It must feel familiar to staff who know the sheet, but it must use PopDAM Master Data as the product source instead of copying product facts into every order row.

When the work is complete:

- signed-in PopDAM users can open `https://dam.designflow.app/orders` and view, search, filter, sort, add, and edit order lines;
- an order line links to the canonical `plm.item`; PopDAM Master Data reaches the same item through its style-to-item bridge;
- the `Licensed` or `Generic` classification determines which Master Data tab is eligible for linking;
- product fields such as SKU, description, license status, licensor, and default vendor display from the linked Master Data record;
- order facts such as PO number, customer PO, quantity, ship dates, container, and tracking status remain on the order record;
- historical OrderList rows from the provided Google Sheet are imported once with a written reconciliation report, then claimed/updated by matching Coldlion records when that API becomes available;
- ambiguous or missing SKU matches are visible and reviewable, never silently guessed;
- future Master Data edits appear in OrderList without rewriting the order record, while a small immutable product snapshot preserves what the order said at import/creation time for audit purposes;
- Google OrderList and Coldlion never create parallel copies of the same order.

**If a step conflicts with this goal, the goal wins. Stop and flag the conflict instead of following the step literally.**

## 2. What the applications are

### PopDAM

PopDAM is POP Creations' internal digital asset manager for licensed consumer-product art. Designers and operations staff use it to browse artwork, manage style groups, and edit the Master Data style tracker. The repository is [`u2giants/popdam3`](https://github.com/u2giants/popdam3). It is a React 18, TypeScript, Vite, Tailwind, Shadcn, TanStack Query, Supabase, and AG Grid Enterprise application. The production site is `https://dam.designflow.app`, deployed from GitHub through GHCR and Coolify. The app repository works directly on `main`.

The existing Master Data page is `https://dam.designflow.app/styles`:

- route registration: `src/App.tsx`, currently near the protected `/styles` route;
- navigation: `src/components/AppHeader.tsx`, currently in `popdamNavItems` and `SECONDARY_NAV_LABELS`;
- page and data-loading behavior: `src/pages/StylesPage.tsx`;
- reusable loading rules: `src/lib/master-data-loading.ts`;
- documentation: `docs/MASTER_DATA.md`;
- tests: `src/test/master-data-loading.test.ts`, `src/test/master-data-pagination.test.ts`, and `src/test/style-tracker-row-highlighting.test.ts`.

The Master Data backend uses `public.style_tracker_rows` and `public.style_tracker_rows_with_bridge`. Licensed rows have `source_sheet = 'License.Style'`; Generic rows have `source_sheet = 'Generic.Style'`. The full current behavior and intentional open-write policy are documented in PopDAM `docs/MASTER_DATA.md` and shared-db `AGENTS.md` Section 0.4.

### Shared database

All POP applications share hosted Supabase project `qsllyeztdwjgirsysgai`. The canonical schema repository is [`u2giants/shared-db`](https://github.com/u2giants/shared-db). Schema changes are authored only here as new timestamped migrations, on a branch, preview first, then PR, then AI merge. Preview is Supabase branch/project ref `rjyboqwcdzcocqgmsyel`.

Existing long-term order tables already exist at `plm.production_order` and `plm.production_order_line`, created in `supabase/migrations/20260621151024_domain_tables.sql`. They are the canonical destination for production-order identity and line facts. Do not create a competing `public.order_list` or `dam.order_list` business table.

### Legacy source workbooks

The legacy source is Google Sheet `OrderList`, spreadsheet ID `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, tab `Order` (`gid=0`). It currently has 48 columns and about 12,925 grid rows. The related `MasterData` workbook is spreadsheet ID `1ZL6cEwydC0cWSGP2I92uILn1ixILr_qAeDfDfD6F214`, with tabs `License.Style` (`gid=381648817`) and `Generic.Style` (`gid=2144577418`).

Owner decisions added 2026-08-07:

- Google OrderList rows and future Coldlion production-order rows are the same business records. The two feeds must upsert/reconcile into the same canonical rows.
- `plm.item` is the ultimate item list. There is no planned `core.item`; `core.*` holds shared reference entities.
- The complete formula findings and workbook dependency map are in [`docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md`](docs/app-migration-notes/popdam-order-list-formula-audit-20260807.md).

## 3. What triggered this work

On 2026-08-06 Albert asked whether PopDAM could contain a replica of the OrderList workbook linked to PopDAM Master Data in the same way the spreadsheet Order tab relates to the License.Style and Generic.Style tabs. Live sheet inspection established the relationship:

- `Order` column P is `Style#`;
- `Order` column AM is `Licensor or Generic` and selects the eligible catalog;
- both Master Data tabs use column B `Style # / SKU`;
- examples matched exactly by SKU, type, and description:
  - Licensed `NCV3SP1`: Order row 65 and MasterData License.Style row 384;
  - Generic `BFC02GABB`: Order row 71 and MasterData Generic.Style row 511;
  - Generic `3FZ64SPC01`: Order row 72 and MasterData Generic.Style row 522.

The `OrderList` workbook also contains copied `License.Style` and `Generic.Style` tabs. Sampled rows were exact copies of the MasterData workbook. Those copied tabs are lookup material, not independent sources, and must not become new PopDAM tables.

This is a new feature. No OrderList application code or new database migration has been written for it. This plan was grounded against shared-db `main` at `9e447e6` and PopDAM `main` at `0c0b570` on 2026-08-06.

## 4. Scope

### In scope

- A new protected PopDAM route `/orders`, available only in PopDAM mode, not PopSG.
- A familiar AG Grid order table based on all business-useful columns in the legacy `Order` tab.
- Native create and edit flows for order headers and lines.
- Stored links from order lines to canonical `plm.item` rows, with Master Data shown through the existing style-to-item bridge.
- Read-through display of current Master Data values plus an immutable creation/import snapshot for audit.
- Search, sort, Text + Set multi-filters, column show/hide/reorder, pagination, and saved per-user views.
- One-time import of the legacy `Order` tab, with idempotency and reconciliation.
- A visible unmatched/ambiguous link state and a manual relink action.
- Shared-db migrations, RLS, grants, serving views/RPCs, tests, generated types, PopDAM UI tests, visual verification, docs, deploy, and production evidence.

### Not in this plan

- Importing or retaining the copied `License.Style` or `Generic.Style` tabs from OrderList. PopDAM Master Data is authoritative.
- Continuous two-way synchronization with Google Sheets. Coldlion is a later recurring source for the same canonical orders, not a second order list.
- Allowing Google Sheets to overwrite edits made in PopDAM.
- Replacing unrelated PO tracking, sample tracking, or DesignFlow workflows.
- Building vendor, customer, licensor, or factory master tables. Reuse canonical `core.*` records.
- Changing Master Data's intentional open-write policy.
- Adding schema migrations under PopDAM's historical `supabase/migrations/` directory.
- Exposing the internal `plm` schema directly to PostgREST.
- Production schema or data changes before preview verification and Albert's behavior confirmation.
- Destructive cleanup of the Google Sheet. It remains a read-only historical reference until Albert separately approves retirement.

## 5. Current state of the code and data

### Shared database

- `plm.production_order` already holds order number, customer/company link, factory link, status, order date, requested/actual ship dates, metadata, and one legacy source-identity pair.
- `plm.production_order_line` already holds order FK, item FK, line number, SKU, ordered/shipped quantity, unit cost, status, metadata, and one legacy source-identity pair.
- One source-identity pair is insufficient for Albert's ruling because the same canonical row must retain both Google and Coldlion identities. Dedicated order and line source-reference tables are required.
- `dam.production_order_snapshot` exists but is an ingest/cache bridge, not the business editing surface. Do not use it as the new source of truth.
- `public.style_tracker_rows` and `public.style_tracker_rows_with_bridge` serve PopDAM Master Data.
- `api.plm_item_list` currently serves legacy `public.erp_items_current`. The style bridge still points there, while `plm.item` is empty. ERP-plan Phase 4 will repoint the bridge and API view to canonical `plm.item`.
- The final order-line relationship is the existing `plm.production_order_line.item_id -> plm.item.id`. Do not add a competing permanent FK directly to `public.style_tracker_rows`.
- No OrderList-specific API view, user-view table, importer, or contract test exists.

### PopDAM

- `/styles` is a mature AG Grid screen with full-tab loading, pagination, saved views, editable cells, audit history, pickers, and row coloring.
- `src/App.tsx` registers protected routes.
- `src/components/AppHeader.tsx` owns desktop, compact, and mobile navigation. Master Data is a link in `popdamNavItems` and a compact secondary item.
- `src/pages/StylesPage.tsx` contains much of the existing grid behavior in one large file. It can provide patterns, but OrderList should not add more code to that file.
- AG Grid packages are pinned to the same exact version. Keep them aligned.
- PopDAM generated types live at `src/integrations/supabase/types.ts` and must be regenerated, not hand-edited.
- The existing `HANDOFF.md` contains older unfinished workstreams. Do not rewrite or delete it for this feature. Add a scoped `HANDOFF.d` file only if this build stops unfinished.

### Legacy data

- The Order sheet's header row includes PO status, import PO number, vendor, order dates, customer, customer PO, assortment ID, style, description, license status, quantity, case pack, ship/cancel/delivery dates, booking, ETD/ETA, test/photos, warehouse/container/MBL, close tracking, Licensed/Generic discriminator, and PO-writing helper fields.
- The completed profile found 12,328 populated rows: 8,412 direct-SKU rows, 3,899 assortment rows, 3 rows with both shapes, and 14 incomplete rows. Valid assortment rows expand into multiple component lines, so a spreadsheet row is not always one canonical line.
- There are 3,083 normalized Import PO numbers and 130 populated rows with no PO number. Five PO groups conflict on customer/vendor identity and must be quarantined rather than silently collapsed.
- Complete counts, invalid values, duplicate keys, item-match rates, and all 48 mappings are in [`docs/app-migration-notes/popdam-order-list.md`](docs/app-migration-notes/popdam-order-list.md).

## 6. Key findings and root cause

1. The workbook is a denormalized database. Order header values repeat on every line, while product facts are looked up by SKU and the Licensed/Generic discriminator.
2. A literal 48-column table would preserve spreadsheet duplication and allow product facts to drift. The app must separate header facts, line facts, and Master Data facts.
3. SKU alone is insufficient during the historical import because the legacy workbook explicitly carries `Licensor or Generic`. Use both values to resolve the Master Data row and then its canonical item.
4. A live lookup without a stored FK is unsafe. Duplicate or malformed SKUs can cause a row to silently point at a different product. Auto-link only an exact, unique match and persist `plm.item.id` on the order line.
5. Purely live Master Data display is also insufficient for historical audit. Keep a small snapshot on each line containing the source SKU, type, description, license status, and resolved canonical item ID as observed at import/creation. Current display should still come from the live linked item/Master Data relationship.
6. The copied License.Style and Generic.Style tabs in OrderList are sampled duplicates of MasterData. Importing them would create two competing sources.
7. Existing `plm.production_order` and `plm.production_order_line` are the declared long-term canonical tables. Building new order tables in `public` or `dam` would violate the shared schema map.
8. The full export contains 321,544 formula cells, but the `Order` tab has only 43: 37 display headers and six one-off arithmetic quantities. It has no lookup formula to either style tab. The old Master Data relationship is implied, not enforced.
9. Google and Coldlion represent the same orders. Source identity and reconciliation must converge on one canonical header/line pair.
10. A canonical order needs multiple source references. The existing single `source_system/source_id` pair cannot preserve both the Google seed identity and later Coldlion identity.
11. Import PO + SKU and Import PO + SKU + quantity are not unique. Even Import PO + customer PO + SKU + quantity has one duplicate and covers only 5,622 direct rows. A Coldlion line key cannot be declared until a real API payload exists.
12. Assortment rows contain newline-aligned component SKUs, types, descriptions, and status flags. Ten rows have mismatched counts and must be rejected for review.

## 7. Approaches considered and rejected

### Rejected: embed or iframe the Google Sheet

This would preserve the old UI but would not make PopDAM or its Master Data authoritative. It also bypasses app permissions, audit, testing, and database relationships.

### Rejected: continuously sync both ways with Google Sheets

Two writers create conflict and overwrite risk. The standing Master Data ruling says curated PopDAM data outranks transitional sheet imports. The same safe direction applies here: import once, then edit in PopDAM.

### Rejected: import the OrderList workbook's copied style tabs

They duplicate the MasterData workbook and would split ownership. Use `public.style_tracker_rows` only.

### Rejected: one flat 48-column database table

It would repeat PO-level data and product data on every line, making edits inconsistent and updates expensive. Use `plm.production_order`, `plm.production_order_line`, metadata for legacy-only fields, and a serving view.

### Rejected: derive the Master Data relationship on every read

`lower(trim(sku))` plus type is useful for import matching but not a durable relationship. Duplicate SKUs and later edits would make results unstable. Store a nullable FK and match state.

### Rejected: refuse to import any row with no unique Master Data match

That would lose real order history. Import the order row with `unmatched` or `ambiguous` status, preserve its source snapshot, and surface it for review.

### Rejected: expose `plm` directly to the browser

PopDAM intentionally consumes browser-safe `public`/`api` contracts. Create a security-invoker serving view and tightly scoped RPCs instead of broadening exposed schemas.

### Rejected: copy all of `StylesPage.tsx`

That page contains Master Data-specific matching and editing logic. Copying it would create a second monolith. Extract only genuinely reusable grid/view helpers and build an OrderList-focused page.

## 8. Design decisions

### Locked decisions, made 2026-08-06

1. **Native PopDAM feature:** `/orders` is the new operational home.
2. **Canonical tables:** extend `plm.production_order` and `plm.production_order_line`; do not create a competing business table.
3. **Canonical item FK:** use the existing `plm.production_order_line.item_id -> plm.item.id`. Master Data reaches the same item through `plm.style_tracker_item_bridge` after ERP-plan Phase 4. Do not add a second permanent FK to `style_tracker_rows`.
4. **Import matching evidence:** preserve the source Licensed/Generic discriminator and a match status with allowed values `matched`, `unmatched`, `ambiguous`, `manual`, `not_applicable`. These explain how the historical row resolved; they do not replace `item_id`.
5. **Exact unique auto-match:** normalize SKU with trim + case-fold only. Do not remove punctuation or guess fuzzy matches. The eligible Master Data source sheet must match the order type.
6. **Historical snapshot:** store source product facts in `plm.production_order_line.metadata.order_list_snapshot`; do not display the snapshot as the current product truth unless the link is missing.
7. **One canonical order, two source stages:** import the Google `Order` tab once as historical/pre-API evidence. When the Coldlion API is available, its recurring pull must claim/upsert the same rows using Coldlion IDs plus a reviewed reconciliation key. It must never create a parallel order copy.
8. **All signed-in PopDAM staff can use OrderList:** initial read/create/update permission follows the intentional collaborative Master Data model. Deletes are not part of version 1; corrections use status/void fields so history remains.
9. **PopSG exclusion:** `/orders` and its nav item render only when `!IS_POPSG`.
10. **Spreadsheet familiarity, app quality:** preserve names/order for core visible columns, but use linked current Master Data fields, canonical pickers, filters, validation, and audit-friendly editing.
11. **Multiple source identities:** add dedicated header and line source-reference tables. Google and Coldlion source refs point to the same canonical records; one never overwrites the other.
12. **Assortment expansion:** one staged Google assortment row may create several canonical component lines. Component ordinal is part of the Google source key. Missing component quantities are never guessed.

### Open implementation judgment, resolved by criteria rather than asking Albert

1. **Which legacy fields receive first-class columns vs metadata:** first-class fields are those needed for joins, common filters, sorting, constraints, or date/number math. Rare PO-writing helper fields may remain in typed JSON metadata but must be projected with stable names in the serving view. Decide from the Step 0 profile and document the mapping.
2. **Header grouping key:** prefer normalized Import PO number. If a blank PO number exists, use a deterministic source-row-specific header so unrelated blank rows never collapse together. Quarantine the documented customer/vendor/status/company conflicts; do not choose the first or most frequent identity value silently.
3. **Page loading:** use server-side bounded queries if production data plus future growth makes full loading slow. Use the existing full-load pattern only if an authenticated preview benchmark loads and filters the entire current dataset within 3 seconds and stays below a reasonable browser memory footprint. Either choice must preserve complete search/filter results.

## 9. Ordered implementation plan

### Phase 0: source profiling and final field map

#### Step 0.1: export the source without modifying it

- Use the Google Drive connector to export spreadsheet `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk` as `.xlsx`, or download only the `Order` tab as CSV if the connector cannot export the workbook within its size limit.
- Save the source only as a local, ignored work artifact. Never commit the workbook because it contains business data.
- Compute a SHA-256 checksum and record the source spreadsheet ID, tab gid `0`, export timestamp, and checksum in the eventual import report.

**Verification gate:** the local file opens, includes the visible `Order` tab, the header begins with `PO Status`, and its checksum is recorded without committing the file.

#### Step 0.2: profile and map the source ✅ completed 2026-08-09

- The complete output is `docs/app-migration-notes/popdam-order-list.md`, produced from bounded live range reads plus a fresh read-only XLSX audit with a recorded SHA-256.
- No standalone profiler was retained because a throwaway workbook dependency would not be durable. Phase 2's real importer must emit the same reconciliation counters and is the maintained executable implementation.
- The profiler must report:
  - populated business-row count after excluding formula/default-only tail rows;
  - distinct and blank Import PO numbers;
  - duplicate candidate source IDs;
  - data types and invalid dates/numbers per column;
  - conflicting repeated header values within each PO;
  - counts of Licensed, Generic, blank, and invalid discriminator values;
  - exact unique Master Data matches, ambiguous matches, and unmatched rows using normalized SKU + type;
  - duplicate normalized SKUs within each Master Data type;
  - formulas and errors such as `#REF!` that must be preserved as source evidence but not treated as valid values.
- Do not repeat the 16-tab formula census. Use the completed audit linked from STATUS. The profiler should consume its findings and add row-level evidence.
- The mapping document must state for every source column: header table column, line table column, metadata key, live Master Data projection, derived field, or intentionally omitted with reason.

**Verification gate passed 2026-08-09:** the live sheet was read in bounded chunks, the fresh XLSX formula scan was repeated, the export hash was recorded, and every one of the 48 headers appears exactly once in the mapping document. Phase 2 must reproduce the documented arithmetic before any write.

**Natural context cut:** after Step 0, update STATUS and use the `fresh-session` skill. The next session must re-read the completed profile and downstream phases before creating SQL.

### Phase 1: shared database contract

#### Step 1.1: claim the database objects before editing

- Coordinate this phase with the still-active [`fix_schema_for_api.md`](fix_schema_for_api.md) plan before changing `plm.item`, `plm.production_order*`, or the style-item bridge. The ERP plan owns populating `plm.item`, repointing the bridge, and building the native Coldlion production-order feed.
- From a clean `shared-db` worktree based on current `origin/main`, run:
  `node scripts/check-dispatch-collision.mjs --task "PopDAM OrderList linked to Master Data" --objects "plm.production_order,plm.production_order_line,plm.production_order_source_ref,plm.production_order_line_source_ref,api.dam_order_list,public.create_dam_order,public.update_dam_order,public.link_dam_order_line,public.order_list_user_views"`
- Choose a unique timestamp manually after checking existing migrations. `--allocate-version` was withdrawn and must not be used.
- File the printed claim exactly as required by `COORDINATOR_INTAKE.md`/the coordinator workflow.
- Stop on exit 1 or 2. Do not trust parser coverage alone; manually inspect open PRs for writes to both PLM tables because the known parser may miss `ALTER TABLE`.

**Verification gate:** collision command exits 0, the claim is open, the manually chosen migration version is unique, and open PR inspection finds no overlapping writes.

#### Step 1.2: create the additive migration

- Add one new timestamped migration under `supabase/migrations/`.
- Extend `plm.production_order` with first-class fields selected by the Step 0 map, expected to include:
  - `import_po_number text` or reuse `production_order_number` with an explicit invariant;
  - seal/container, sent-PO, vendor-delivery, ETD, ETA, warehouse, booking/container, MBL, and close-tracking fields that profiling proved are header scoped;
  - reuse the existing `company_id` customer relationship, whose foreign key now points to `core.customer`; do not add a second customer column unless the coordinated ERP plan deliberately renames the existing one;
  - `voided_at`, `voided_by`, and `void_reason` for non-destructive correction;
  - source metadata/provenance in existing `metadata`.
- Extend `plm.production_order_line` only with fields not already owned by the ERP relocation plan:
  - use existing `item_id` as the durable product relationship;
  - source discriminator and match-status evidence for the historical Google reconciliation;
  - line-scoped fields from the completed map, including order person/type, customer PO, suffix, assortment ID, order depth, case pack, reported cases, ship-to, start/cancel/cargo dates or raw instructions, test report, professional photos, and contractual-sample reorder;
  - normalized SKU generated column or immutable SQL normalization function plus indexes required for matching/filtering;
  - source snapshot and import provenance in existing `metadata`.
- Add `plm.production_order_source_ref` and `plm.production_order_line_source_ref`, each with a canonical-row FK and `unique(source_system, source_id)`. Preserve existing source columns for compatibility until the ERP relocation plan explicitly retires them.
- Add indexes for order number, dates, status, customer, factory, SKU, `item_id`, match status, both source-reference tables, and the common default sort.
- Do not add a competing FK to `style_tracker_rows`. Item linking must follow the ERP plan's final `plm.item` contract. The create/relink path accepts an item only when the exact normalized SKU and Licensed/Generic-qualified style bridge resolve uniquely to that item.
- Add `public.order_list_user_views` keyed by user + view name with column/filter state, patterned after `public.style_tracker_user_views`, but scoped to the OrderList page.
- Add an authenticated-readable `api.dam_order_list` security-invoker view. It must project:
  - stable order and line IDs plus editable order facts;
  - current `plm.item` fields plus linked Master Data fields reached through `plm.style_tracker_item_bridge`;
  - snapshot fallback fields when unmatched;
  - explicit `master_data_match_status` and mismatch diagnostics;
  - canonical customer/factory display labels where linked.
- Add narrow `SECURITY DEFINER` RPCs for create/update/relink only if direct browser writes across `plm` are not available. Each RPC must validate `auth.uid()`, allowed fields, type, SKU, and FK consistency; set `search_path`; revoke public/anon execution; grant only authenticated/service_role as required.
- Do not add a hard-delete RPC.

**Verification gate:** `scripts/check-sql.sh` passes; schema tests prove FK/type/SKU enforcement, anon denial, authenticated read/write, no delete path, view security, and snapshot fallback.

#### Step 1.3: add database tests

- Add `supabase/tests/dam_order_list_contract.sql` covering:
  - Licensed and Generic exact item/bridge matches;
  - wrong-type item link rejection;
  - wrong-SKU item link rejection;
  - unmatched and ambiguous rows remain readable;
  - current Master Data description changes appear through the view while snapshot remains unchanged;
  - voided records retain history;
  - anon cannot read or mutate;
  - authenticated user can perform the approved operations;
  - saved views are isolated per user;
  - source-reference idempotency uniqueness and two different source refs pointing to one canonical row.
- Extend any schema inventory or API contract tests that enumerate browser-facing views.

**Verification gate:** the new pgTAP/SQL contract test passes in the repository test harness and fails when the FK/type guard is deliberately inverted in a local throwaway edit.

**End-of-phase rule:** after Phase 1, re-read Phases 2 through 5 and Section 13. Record any discovery or schema choice that changes a later assumption before starting the preview import.

### Phase 2: preview rehearsal and import

#### Step 2.1: prove preview target and apply

- Immediately before each dry-run/push, read `supabase/.temp/project-ref` and confirm the exact value `rjyboqwcdzcocqgmsyel`.
- Run `supabase db push --dry-run`, confirm only the intended migration, then push to preview.
- Never run migration repair to clear another workstream's preview ledger.
- Record the target proof and applied version in `docs/app-migration-notes/popdam-order-list.md`.

**Verification gate:** target proof equals `rjyboqwcdzcocqgmsyel`; migration exists in the preview ledger; real objects, constraints, indexes, grants, and view definitions exist; database tests pass against preview.

#### Step 2.2: implement the idempotent importer

- Add `scripts/import-order-list-xlsx.py` in shared-db.
- Follow the repository's established import safety rules: explicit configuration, dry-run mode, one transaction per bounded batch, loud failures, and no secret or raw customer data in logs.
- Generate deterministic source IDs from spreadsheet ID + tab gid + stable source row number, and use `source_system = 'google_order_list'`.
- Support `--dry-run`, `--preview`, a bounded batch size, and a required source checksum.
- Group nonblank rows by normalized Import PO. Blank-PO rows each receive a row-specific header. Quarantine the documented customer/vendor/status/company conflicts instead of choosing a value silently.
- Stage each Google row before canonical writes. A direct SKU row creates one candidate line. A valid assortment row expands newline-aligned component values into child candidates with source IDs `order:row:<row>:component:<ordinal>`.
- Reject the 14 incomplete rows, the 3 both-shape rows until reviewed, and the 10 structurally invalid assortment rows from automatic canonical line creation while preserving their raw evidence.
- Auto-link only exact unique normalized SKU + type matches. Persist `matched`, `unmatched`, or `ambiguous`; never choose the first duplicate.
- Store raw source row number and a compact raw/snapshot JSON object for audit.
- Produce a durable, secret-free report under `docs/verification/popdam-order-list-preview-<date>/README.md` with counts, conflicts, rejected values, link results, and representative sampled IDs. Do not commit raw customer/order rows.
- A repeat run against the same checksum must update no business rows unless `--replace-source` is explicitly passed. `--replace-source` is preview-only until separately approved for production.
- Reconciliation arithmetic must balance against the Phase 0 baseline: 12,328 staged rows split across direct, assortment, both-shape, and incomplete classes; valid assortment components split across linked, ambiguous, and rejected counts.

**Verification gate:** preview import total equals profiler total; sum of matched + unmatched + ambiguous + not-applicable equals imported lines; a second identical run changes zero rows; sampled known styles `NCV3SP1`, `BFC02GABB`, and `3FZ64SPC01` link to the expected Master Data types.

**End-of-phase rule:** after Phase 2, re-read Phases 3 through 5 and Section 13. Update later steps for any observed performance, matching, or data-quality facts before PopDAM work starts.

### Phase 3: PopDAM implementation

#### Step 3.1: add typed data helpers

- In PopDAM, add `src/types/order-list.ts` for the API row, editable header/line inputs, match status, filter model, and source snapshot types.
- Add `src/lib/order-list.ts` for pure normalization, boolean/date display, edit-diff construction, row grouping, and match-status labels.
- Add `src/hooks/useOrderList.ts` for bounded reads from `api.dam_order_list`, create/update/relink calls, cache invalidation, and loud error reporting.
- If server-side pagination is required by the Phase 0 benchmark, add a bounded RPC and cursor type rather than using PostgREST offsets across an unbounded view.
- Regenerate `src/integrations/supabase/types.ts` from the preview/shared schema using the repo workflow. Do not edit it by hand.

**Verification gate:** focused unit tests for pure helpers and hook error paths pass; TypeScript build accepts generated contract types without `as any` for the new objects.

#### Step 3.2: build the page as focused components

- Add `src/pages/OrdersPage.tsx` as the route-level orchestrator.
- Add components under `src/components/orders/`:
  - `OrderListGrid.tsx` for AG Grid setup and column definitions;
  - `OrderEditorDialog.tsx` for create/edit with header and line sections;
  - `MasterDataLinkCell.tsx` for current link status, mismatch details, and relink entry point;
  - `MasterDataLinkDialog.tsx` for exact eligible candidates and manual selection;
  - `OrderListViewsMenu.tsx` for per-user saved layouts;
  - `OrderListSummary.tsx` for total/filtered/matched/ambiguous/unmatched counts.
- Use the existing AG Grid theme and pinned `35.3.1` packages.
- Default visible column order should follow the recognizable legacy flow: PO status/number/vendor/dates/customer/style/current Master Data description/license status/quantity/shipping/tracking. Hide formula-helper and low-use legacy fields by default but keep mapped fields available through Columns.
- Current product cells must be read-only and visually marked as coming from Master Data. Order cells are editable according to the API contract.
- Display unmatched/ambiguous rows with a clear warning badge. Never silently fall back without naming the fallback.
- Use Text + Set multi-filters and saved views. If reusable logic is extracted from Master Data, put it in a neutral `src/lib` or `src/components/grid` module and keep both pages covered by tests.
- Optimistic updates may be used only when errors roll back visibly and show a toast. No silent save failures.

**Verification gate:** component tests demonstrate linked current values, snapshot fallback, invalid edit rejection, save error rollback, type-restricted relink candidates, and saved-view restore. A local authenticated screenshot shows the full grid, editor, Columns panel, a Set filter, and an ambiguous-link warning with no console errors.

#### Step 3.3: route and navigation

- Import `OrdersPage` in `src/App.tsx` and add protected `/orders` only under `!IS_POPSG`.
- Add an `Orders` item to `popdamNavItems` in `src/components/AppHeader.tsx` using an appropriate Lucide icon.
- Include Orders in compact/mobile navigation and active-route behavior. Do not add it to `popsgNavItems`.
- Add a route/navigation contract test so PopSG cannot expose OrderList.

**Verification gate:** authenticated PopDAM navigation opens `/orders`; direct unauthenticated access redirects to login; PopSG has no Orders nav item and does not render the route.

#### Step 3.4: documentation

- Add PopDAM `docs/ORDER_LIST.md` describing behavior, source mapping, relationship rules, permissions, import status, and verification.
- Link it from PopDAM `AGENTS.md` task routing and document the new route in `docs/architecture.md` and schema contract in `docs/SCHEMA.md`.
- Link this plan from PopDAM `AGENTS.md` while any STATUS row remains open. Do not copy the plan into two writable files.
- Update shared-db `docs/app-migration-notes/popdam-order-list.md` with final objects and evidence.

**Verification gate:** every path, object, route, source ID, and permission statement in docs matches the code and database.

**Natural context cut:** after the PopDAM code and tests pass locally against preview, update STATUS and use the `fresh-session` skill before production landing. The landing session must re-read Phase 4 and the production safety rules.

**End-of-phase rule:** before that cut, re-read Phases 4 and 5 plus Section 13 and record every interface or behavior change that affects landing, production import, or final cleanup.

### Phase 4: full verification and landing

#### Step 4.1: test against preview

- Point a local PopDAM development instance at preview using the approved non-secret configuration path.
- Run the focused tests listed in Section 10, then `npm test`, `npm run lint`, and `npm run build`.
- Use an authenticated test account from 1Password and verify create/edit/relink on preview only.
- Confirm all 48 source fields are either visible, available through Columns, derived from Master Data, or explicitly omitted per the mapping.
- Capture screenshots at desktop and compact widths.

**Verification gate:** all commands pass; preview create/edit/relink survives reload; filters search the complete dataset; screenshots show no clipping or blank grid; browser console has no errors; Albert confirms the behavior is correct before shared-db merge.

#### Step 4.2: merge shared-db

- Complete the shared-db checklist: SQL checks, preview dry-run, applied preview verification, app behavior confirmation, additive-only review.
- Commit as `Albert Hazan <u2giants@users.noreply.github.com>`, push the feature branch, open a PR, wait for all checks, review the diff and collision check, then AI-merge it.
- Close the database claim after merge.

**Verification gate:** PR is merged; `origin/main` contains the migration and docs; all required checks are green; the claim is closed.

#### Step 4.3: promote schema and import production in an approved window

- This step changes production. Obtain explicit approval for the exact migration/import window if it has not already been granted in the current implementation chat.
- Use the bounded production promotion procedure in shared-db `AGENTS.md` Section 5.1. Never run `--include-all` against the full migration set.
- Immediately before each production push/connection/import, prove `supabase/.temp/project-ref` equals `qsllyeztdwjgirsysgai`; repeat after any reconnect or tool call boundary.
- Apply only the intended migration. Verify real objects, not only the ledger.
- Run the importer first in production dry-run mode, compare totals with preview, then import the exact checksummed source.
- Do not use `--replace-source` in production.

**Verification gate:** final report quotes target proof `qsllyeztdwjgirsysgai`, migration version, and authorized import; production counts equal approved preview counts; repeat dry-run reports zero changes; sampled known SKUs link correctly.

#### Step 4.4: deploy PopDAM

- Rebase/pull current PopDAM `main`, preserving any concurrent work.
- Commit only this feature to `main` with the required Albert identity and push.
- Wait for CI, GHCR image build, and Coolify deploy.
- Verify `https://dam.designflow.app/orders` returns the deployed build SHA using the build stamp/live HTML method documented by PopDAM.

**Verification gate:** GitHub Actions are green; deployed build SHA equals the pushed commit; authenticated live screenshots prove grid load, filters, edit, and relink behavior.

**End-of-phase rule:** after Phase 4, re-read Phase 5 and Section 13. Update the closeout evidence and rollback notes for anything learned during production landing.

#### Step 4.5: close out safely

- Update this STATUS table with dates and evidence.
- Update both repos' durable docs and create a scoped `HANDOFF.d` file only if anything remains unfinished.
- Verify no raw workbook, CSV, credentials, or customer/order data entered git history.
- Confirm all repository changes are committed/pushed and no mystery untracked files belong to this workstream.

**Verification gate:** a fresh session can see completion from STATUS and docs; both repositories are clean for this workstream; final report includes shared-db PR, commit SHAs, CI results, production target proof, import reconciliation, live URL, and screenshot evidence.

## 10. Tests required

### Shared database

- `supabase/tests/dam_order_list_contract.sql` with the cases named in Step 1.3.
- Importer unit tests under `scripts/tests/test_import_order_list.py` using a synthetic workbook fixture with:
  - two lines sharing one PO header;
  - one Licensed exact match;
  - one Generic exact match;
  - duplicate eligible Master Data matches producing `ambiguous`;
  - missing SKU producing `unmatched`;
  - blank PO values that must not merge;
  - conflicting customer/vendor/header identity values producing quarantine, never majority selection;
  - one valid multiline assortment expanding to multiple component lines with deterministic component source refs;
  - mismatched assortment SKU/type/description counts producing rejection;
  - a direct row and an assortment row that both reference the same canonical item without duplicating it;
  - formula/default-only tail rows;
  - invalid date/number and `#REF!` values;
  - second-run Google idempotency;
  - a later Coldlion source ref claiming an existing Google-seeded order/line rather than inserting a duplicate.
- Existing `scripts/check-sql.sh` and repository database test suite remain green.

### PopDAM

- `src/test/order-list.test.ts`: normalization, display fallback, edit diff, boolean/date conversion, and match labels.
- `src/test/order-list-grid.test.tsx`: core column order, current Master Data read-only fields, complete filter model, snapshot fallback warning, and saved-view restoration.
- `src/test/order-list-editor.test.tsx`: create/edit validation, header/line payload, and visible save failure.
- `src/test/order-list-linking.test.tsx`: type-restricted exact candidates, ambiguous state, manual relink, and wrong-type rejection.
- `src/test/order-list-routing.test.tsx`: protected route, PopDAM navigation, compact/mobile presence, and PopSG absence.
- Existing `npm test`, `npm run lint`, and `npm run build` remain green.

### Visual checks

- Desktop screenshot of loaded OrderList with totals and linked fields.
- Compact-width screenshot with usable navigation and horizontal grid behavior.
- Screenshot of Text + Set filter.
- Screenshot of create/edit dialog.
- Screenshot of ambiguous/unmatched relink flow.
- Browser console and network check with zero unexpected errors.

## 11. Constraints, standing rules, and gotchas

1. All shared schema work starts in canonical `u2giants/shared-db`. Never add PopDAM app-repo migrations or run dashboard SQL.
2. One schema change may be in flight at a time. Run and file the collision claim before writing SQL. The parser is known to miss some `ALTER TABLE` statements, so manually inspect open PRs too.
3. Every migration is a new unique timestamp. Never edit an applied migration and never reuse a version.
4. Preview first. Production is `qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`.
5. Immediately prove the live database target before every write or action that triggers a write. The proof covers only the same or immediately following tool call and must be quoted in the report.
6. Never run migration repair to erase another workstream's preview ledger.
7. Production promotion with backlog uses a bounded temp checkout. Never use `--include-all` against the full repo migration set.
8. Master Data writes remain open to every signed-in PopDAM user by design. Do not narrow `public.style_tracker_rows` while adding order links.
9. The import must never overwrite curated Master Data. It links to it and reads from it.
10. Never fuzzy-match SKU relationships. Exact trim/case normalization plus type only; ambiguity must remain visible.
11. No hard delete in version 1. Preserve business history with void/status fields.
12. Do not expose the `plm` schema broadly. Use `api` views and narrow RPCs.
13. Keep all AG Grid packages on exactly the same version. A prior version mismatch caused a blank page before React mounted.
14. Do not hand-edit `src/integrations/supabase/types.ts`; regenerate it.
15. UI work is not complete without authenticated visual verification and screenshots.
16. Preserve unrelated dirty files and concurrent work. Stage only this workstream.
17. Commits must be authored and committed as `Albert Hazan <u2giants@users.noreply.github.com>`; verify before the first commit in each repo.
18. PopDAM commits directly to `main`. Shared-db uses branch + PR, and the AI merges it after the checklist passes.
19. No secret values or raw order/customer workbook data may enter logs, docs, commits, screenshots, or the plan.
20. The legacy `Licensor or Generic` cell can contain newline-aligned component values. Direct rows accept only one exact valid type. Assortment rows split and validate each component type; mixed licensed/generic assortments are valid when list lengths align.
21. Never treat one visible Google assortment row as one finished canonical line. Preserve the staged parent row and expand valid components.
22. Never overwrite a Google source ref with a Coldlion source ref. Both identities must remain attached to the same canonical row.

## 12. Access and environment

- GitHub CLI `gh` is expected to be authenticated for `u2giants/shared-db` and `u2giants/popdam3`. Verify with a real read before claiming access is missing.
- Supabase CLI is expected to be authenticated. Database passwords and tokens live in 1Password vault `vibe_coding`; use the canonical shared-db runbook and never print values.
- Google Drive access is available through the connected Google Drive plugin for the two source spreadsheet IDs in Section 2.
- Production PopDAM: `https://dam.designflow.app`.
- Production OrderList target: `https://dam.designflow.app/orders`.
- Production Master Data: `https://dam.designflow.app/styles`.
- Production Supabase: `qsllyeztdwjgirsysgai`.
- Preview Supabase: `rjyboqwcdzcocqgmsyel`, branch name `shared-db-schema-rehearsal`.
- PopDAM test login credentials live in 1Password vault `vibe_coding`. Locate the PopDAM/DAM test-login item by title search; do not create or expose a new credential if the existing item works.
- Local PopDAM setup is documented in `docs/development.md`; standard commands are `npm install`, `npm run dev`, `npm test`, `npm run lint`, and `npm run build`.
- The source Google workbook export is a local ignored artifact. The committed verification report contains only counts, hashes, source IDs, and non-sensitive sampled SKUs already used as relationship examples.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [x] Source workbook profiled and all 48 fields mapped (2026-08-09; evidence document and export hash recorded).
- [ ] Shared-db collision claim filed and later closed.
- [ ] Additive migration, API view/RPCs, indexes, grants, RLS, and tests pass.
- [ ] Migration rehearsed on preview with quoted target proof.
- [ ] Idempotent preview import reconciles exactly and known samples link correctly.
- [ ] PopDAM `/orders` page, route, navigation, saved views, editor, filters, and relink flow work against preview.
- [ ] All focused and full database/PopDAM tests pass.
- [ ] Albert confirms preview behavior.
- [ ] Shared-db PR merged by the AI with green CI.
- [ ] Production schema/import separately approved, target-proved, applied, and reconciled.
- [ ] PopDAM commit pushed to `main`; CI, GHCR, and Coolify are green.
- [ ] Live build SHA and authenticated behavior verified with screenshots.
- [ ] Docs and STATUS updated; no raw workbook or secrets committed; no unfinished work lacks a scoped handoff.

### Main risks and mitigations

1. **Duplicate SKUs link to the wrong product.** Mitigation: exact unique match only, typed FK constraint, visible ambiguity, manual relink.
2. **Repeated PO header data conflicts across source rows.** Mitigation: profiler report, deterministic grouping rule, conflict evidence, line snapshots.
3. **A Master Data edit rewrites history.** Mitigation: live linked values plus immutable order-line source snapshot.
4. **Import is run twice.** Mitigation: deterministic source IDs, checksum requirement, uniqueness, second-run zero-change test.
5. **Large-grid browser performance.** Mitigation: benchmark before choosing full load; use bounded server queries if the 3-second gate fails.
6. **Wrong database receives writes.** Mitigation: mandatory immediate target proof before every write and quoted evidence.
7. **Assortment rows are flattened incorrectly.** Mitigation: stage the parent row, expand newline-aligned components, reject mismatched lists, and never guess component quantities.
8. **Coldlion creates duplicates of Google-seeded rows.** Mitigation: dedicated multi-source reference tables, exact unique candidate claiming, and quarantine when a match is not unique.
9. **A pending migration backlog causes accidental broad promotion.** Mitigation: bounded checkout procedure and exact dry-run file list.
10. **PopSG accidentally exposes business order data.** Mitigation: `!IS_POPSG` route/nav guards and routing tests.
11. **Sheet formulas/errors become trusted business values.** Mitigation: typed parser, invalid-value report, raw snapshot only.

### Rollback

- Before production import, rollback is migration reversal through a new additive corrective migration, never editing the applied file.
- After import but before staff editing, disable the `/orders` route through an app revert and mark imported `google_order_list` records void/inactive through an approved, target-proved corrective migration or RPC. Do not hard-delete without explicit approval.
- After staff editing begins, preserve all records. Fix forward with new migrations and audited status corrections.
- PopDAM UI rollback is `git revert` of the feature commit on `main`, followed by normal CI/Coolify verification.

### Genuine open questions

No new owner decision is required before Phase 1 planning starts. The exact Coldlion line reconciliation key remains technically open until a real production-order payload is available; do not invent it. The Google import can proceed with deterministic Google row/component source refs, while later Coldlion auto-claiming remains disabled for any non-unique candidate.

## Self-audit

1. **Could a brand-new AI session execute this plan without asking Albert anything? Yes, re-audited 2026-08-09.** STATUS points to the completed formula and row-level evidence. Sections 1 through 4 define the business outcome, source files, exact spreadsheet IDs, scope, and exclusions. Sections 8 and 9 lock the architecture, including assortment expansion and multiple source identities, and give ordered file-level work with a verification gate for every step. Section 12 names access and environments.
2. **Does the plan carry the current background, nuance, and rejected paths? Yes, re-audited 2026-08-09.** Sections 3, 5, and 6 record the 12,328-row profile, Master Data match census, missing universal Coldlion key, existing database relationships, and remaining dependency. Section 7 records every material rejected design and why. Section 11 carries the shared-db, Master Data, target-proof, migration-backlog, AG Grid, and git traps.
3. **Is the ultimate goal clear enough for correct judgment if a step is wrong? Yes, re-audited 2026-08-09.** Section 1 states the user-visible outcome and explicitly says the goal wins over a conflicting step. Section 8 distinguishes the ultimate `plm.item` relationship from source snapshots and source references. Section 13 defines completion, risk responses, rollback, and the one technical fact that must wait for the real Coldlion payload.

All implementation-plan-writer checklist items pass: all 13 sections are present; scope and out-of-scope are explicit; rejected approaches are documented; decisions are labeled locked/open; every implementation step names concrete objects/files and a verification gate; tests are specific; secrets are location-only; and done includes commit, push, CI, deploy SHA, live behavior, documentation, and evidence.
