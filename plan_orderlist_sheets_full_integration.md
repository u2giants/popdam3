# IMPLEMENTATION PLAN — reproduce the native Sheets integration (2026-10-09)

## STATUS

Delivery status refreshed October 9, 2026. Backend PR #4118 and atomic installer
repair PR #4136 are merged. Production backend run `37951612832` passed with the
unchanged migration SHA-256
`bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590`, bounded
catalog verification (56 checks), and 9 behavior checks. The hosted-preview
rollback acceptance also passed for administrator, viewer, and anonymous access,
tracking patches, milestone updates/clears, sample-depth clear/history, and parent
case accounting; its fixture changes were rolled back.

The guarded auxiliary import loaded exactly 8,257 sample-depth rows, 38 customer
suffix rows, and 3,147 tracking rows (11,442 total) from source SHA-256
`13bc64585bb5ec26e977fa948e6c59dfcf1b489e463fbe5e6151016ebd36fb4d`. A separate
read-only production count check matched all three counts. The import retained
71 held tracking exceptions and excluded three duplicate rows; it did not
write canonical headers, existing header dates, Item Master, or Master Data.
Application PR #282 is merged at
`3000b7e04bd6864bc9bef699abc6b84e02f64661`.
The subsequent OrderList Find repair merged as PR #283 at
`709450766d9ddf2e7944db1aaa916a188e3cac75` (reviewed source head
`9e4a005aba239253fd9ab2c7435b755a2cf9e37e`). Full CI run `37958015493`
passed 80 files / 496 tests plus one existing skip; the build passed. Frontend
publish run `37958305346` succeeded. Production serves build token `7094507`,
asset `index-U3ZqunIC.js`, bundle SHA-256
`9fd6875ad97cbc7cdf44e033a54d3d26b88532058a8c8a3fe6f55014a508ae8e`, and image
digest `60d6eb3237d360f1fb90d8b7b5884ae8de92e6c1871c636d606772f766b6ace5`.
Canonical business-rule and source-inventory documentation merged in PR #4139
at `3cfd231a92023ebed1beb7ced5e5ba336e652960`.

**Historical pre-PR #284 read acceptance:** administrator/viewer same-row checks
passed 93 checks (47/46) on build token `7094507`. Protected report
`acceptance-report-7094507-attempt2.json` has SHA-256
`0fccf979a10fc39fa61ea9cbb12eef45ac03c824388510518a4f0dd1b68dac73`.
Find diagnostics passed for both roles: current at offset 0 and far rows at
offsets 10,380 and 6,839 returned by exact-ID Find, bounded GET pages (at most
500 rows), and visible DOM rows. Report
`orderlist-find-final-diagnostic-attempt6-7094507.json` has SHA-256
`86b3cb643eb5740f7ae3c6e680b53d35d533c746a3d532f0407b4d0c01378977`.
Original OrderList controls passed for both roles; report
`existing-capabilities-attempt7-7094507.json` has SHA-256
`0b87513183fa5435225623a76fcd00db99144b28af961f3d01c4b4c56752464d`.
Styles Find repair PR #284 merged at `f02b9de2e60a317aaf5136c77957b1639b9274b1`
at 1:11 PM EDT; exact-head GLM review approved it (report
`glm-final-check-20261009T165439-2485646-28136.md`). CI run `37964251577` passed
81 files / 497 tests plus one existing skip. Frontend publish run `37964512337`
succeeded at 1:15 PM EDT. Production serves token `f02b9de`, asset
`assets/index-BGe0FYew.js` (SHA-256
`b48e4cafceb7113365782c2398707e029f2332ce5fe900ff349a2d4af6c9d2c6`), and image
digest `12b5c868d41aa25a8cfbab0f8e38e1037f2e0c519fd52911fd120063eb9dc87a`.
The fresh administrator fixture capture passed; report `fixtures-f02b9de.json`
has SHA-256 `2e1f46649dfe71e95b75f1f6e296145b38b986411b14e40518383e60c5a1782a`.
PR #285, the deployed-app/production-types proof workflow, merged at
`783f7357a1e407bc3a26859ddb82fa5561220f99` (1:33 PM EDT). Its exact-head
StepFun review approved source `c8f02dc44e8b27a058ec538e10bcd28f0f478110`;
report `stepfun-final-check-20261009T172314-2599466-16163.md` is in the proof
worktree. CI run `37966825066` passed 497 tests plus one existing skip and 19
observer tests. The merged
`.github/workflows/orderlist-integration-live-proof.yml` has four existing-
account GitHub proof secrets configured via protected stdin; no accounts were
created. It has not run and is waiting on the separate Master Data loading
repair.

On the current live token `f02b9de`, the administrator/viewer read acceptance
reached 88 of 93 checks before the viewer License/Styles row timed out. Both
roles hit PostgreSQL `57014` on the initial normal GET for one of four ranges,
which left the grid blank; exact-ID Find reached its target after loading. This
is not a current acceptance pass. Replacement screenshots remain pending.
Keep the handoff until the loading repair is complete, the proof workflow has
run, and full acceptance and screenshots pass.

| Step | Status | Evidence / gate |
|---|---|---|
| 1. Governed backend delivery | complete | PRs #4118/#4136 merged; production run `37951612832` passed with exact SQL hash, bounded catalog and behavior checks; preview rollback acceptance passed |
| 2. Auxiliary source load | complete | guarded source SHA verified; exact 8,257/38/3,147 rows loaded; separate read-only counts matched |
| 3. App types and query boundary | implemented; local verification passed | merged in app PR #282; bounded hooks and validated writes; final visual/original-capability gate remains open |
| 4. PO Tracking and component details | implemented; local verification passed | merged in app PR #282; preview rollback and screen tests cover tracking behavior; final visual/original-capability gate remains open |
| 5. Sample Settings | implemented; local verification passed | merged in app PR #282; preview rollback and tests cover positive/NULL depth and suffix behavior; final visual/original-capability gate remains open |
| 6. OrderList read-through and refresh | implemented; local verification passed | merged in app PR #282; source-qualified current facts and bounded refresh; final visual/original-capability gate remains open |
| 7. Master Data licensing and reverse statistics | implemented; local verification passed | merged in app PR #282; ID-mapped readonly licensing and statistics; final visual/original-capability gate remains open |
| 8. Authenticated production read acceptance | historical 7094507 checks passed; current f02b9de proof incomplete | Current run reached 88/93 before viewer License/Styles timeout; both roles hit `57014` on one initial range GET; Find reached its exact target after load; screenshots remain open |
| 9. Documentation and closeout | in progress | PR #285 and exact-head StepFun review/CI passed; four existing-account proof secrets configured, but workflow has not run while Master Data loading repair is pending; retain handoff |

PR #284 remains the live frontend token `f02b9de`. PR #285 merged with exact-head
StepFun APPROVE and CI run `37966825066` passed 497 tests plus one existing skip
and 19 observer tests. Four existing-account workflow proof secrets are
configured; the workflow is waiting for the separate Master Data loading repair.
Current acceptance on `f02b9de` reached 88/93 before a viewer License/Styles row
timeout; both roles hit `57014` on one initial range GET, leaving a blank grid.
Exact-ID Find reached the target after loading. Current full proof and screenshots
remain open; the earlier 7094507 93-check result is historical only.

## 1. The ultimate goal — what we are trying to achieve

Staff should have the same working connections between Master Data, OrderList,
PO Tracking, sample lookups and vendor activity that the Google workbooks have.
Product details come from Item Master; current product workflow comes from
Master Data; purchase tracking remains on the purchase order. Staff can see
honest unknowns, edit their manual inputs and see related screens update.
If any step below conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

PopDAM is POP Creations' internal artwork/product workspace. React/Vite,
Tailwind/Shadcn, AG Grid and TanStack Query serve https://dam.designflow.app.
The same image serves PopSG at https://sg.designflow.app; Orders must remain
excluded from PopSG. App GitHub: u2giants/popdam3. Canonical backend GitHub:
popcre/shared-db, sharing hosted Supabase with other POP applications.

Use the isolated app worktree `/worksp/popdam-sheets-integration`, branch
`codex/sheets-full-integration` (base 91282b607ada; resolve full SHA with Git).
The canonical `/worksp/popdam` is landing-only. Backend isolated worktree is
`/worksp/shared-db-orderlist-integration`, branch
`codex/orderlist-sheets-integration`. Never edit the app's read-only shared-db
mirror or generated Supabase types.

## 3. What triggered this work

Albert asked why ColdLion lines showed no Master Data link, requested exact
style-number matching against Item Master, then said "product details should
now be supplied by item master" and "reproduce the Sheets’ full integration".
The prior linkage work is live:459 of462 ColdLion lines linked; product
Description uses Item Master. Three lines need an owner division choice,
tracked separately on popdam3#275. This plan preserves that completed work.

Open the existing `/orders` and `/styles` screens to reproduce the integration
gap: there is no full POTracking/sample-settings/reverse-statistics surface,
and licensed progress is still an editable stored display. Completion is
owned by https://github.com/u2giants/popdam3/issues/281.

## 4. Scope — in and out

IN: current Master Data licensing/vendor/test/photo/reorder read-through;
PO-level manual tracking/documents/payments plus readonly component details;
sample-depth and customer-suffix settings; physical-parent case accounting;
forecasts/status/inspection/booking helpers; reverse VendorStatistics;
bounded queries, admin/manual permissions, cross-screen refresh and live proof.

NOT in this plan: canonical Item Master creation/curation; guessing three POP
vs Spruce Licensed choices; fixing the twelve Google refresh exceptions on
#277; migrating RFQ relationships; rewriting the existing Master Data serving
view; product-size picker/reference-cutover work; importing MasterData's
internal OrderLog/OrderSample/NotSoldIn helpers; NAS, worker or infrastructure
changes; replacing the Google intake refresh or its owning session's files.

## 5. Current state of the code

The backend migration `20261009073649_popdam_orderlist_sheets_integration.sql`
is merged and applied. Its production run, migration hash, catalog proof and
behavior checks are recorded in STATUS. The exact initial source payload was
loaded once through the guarded app-owned loader; the read-only production
counts match the expected 8,257 sample-depth, 38 suffix and 3,147 tracking rows.
The 71 held tracking exceptions and three duplicate rows remain excluded, and no
canonical PO header/date, Item Master or Master Data row was written.
Private identity-only comparison confirmed that all 12 PO identities in #277's
held conflicting-order set match 12 of the 71 auxiliary tracking holds; the
other 59 held tracking rows remain separate. Issue #277 describes 12 conflicting
orders (79 source rows) and 58 malformed/incomplete rows, not ownership of all
missing-reference holds.

The application changes are merged in PRs #282–#285, and PR #284 remains live
as frontend token `f02b9de`. Current acceptance reached 88/93 before the viewer
License/Styles timeout; both roles hit `57014` on an initial range GET. Find
reached its exact target after loading. PR #285's exact-head StepFun APPROVE and
CI passed, but its proof workflow has not run while Master Data loading repair
is pending. Replacement screenshots and final acceptance remain open; retain
the session handoff.

## 6. Key findings and root cause

Native Sheets, not cached XLSX results, carry ARRAYFORMULA/VLOOKUP/IMPORTRANGE
connections. Source workbook IDs and the complete inventory are in the new
canonical app-migration-note prose and the handoff. MasterData VendorStatistics
imports OrderList's seven columns; other Master helper tabs are internal.

The new backend preserves all78 existing leading OrderList columns and appends
12. `dam.orderlist_product_facts(uuid,text)` resolves current workflow by linked
Item Master and catalog; source is master_data/at_import/unavailable/ambiguous.
Multiple agreeing tracker rows may provide facts; conflicting rows remain
ambiguous. Current missing facts are not historical snapshot fallback.

The get_dam_order_tracking RPC materializes at most200 headers before indexed
per-PO lines. Physical-parent quantities are grouped by original source row;
component quantities remain unknown. Count queries prune the expensive helper.
Existing index plans and actual 60k-line scale were tested in the owned local
PostgreSQL fixture; test assertions remain in shared-db's SQL tests.

New auxiliary tables are dam.orderlist_sample_depth,
dam.orderlist_customer_settings and dam.order_tracking_ext. They are ordinary
application inputs, not curated Item Master. Readonly API views expose sample
and suffix settings. Three admin-only RPCs own writes. The initial frozen
payload is 11,442 rows: 8,257 depths, 38 suffixes, and 3,147 exact-matched
tracking rows. Seventy-one held tracking exceptions and three duplicate tracking
rows are excluded. Existing header
dates and canonical identities are preserved by initial seeding.

The private recovery folder is
`/home/ai/.local/share/popdam-recovery/orderlist-integration-20261009/`.
Prepared payload SHA256:
`13bc64585bb5ec26e977fa948e6c59dfcf1b489e463fbe5e6151016ebd36fb4d`.
Do not publish raw source/recovery files, customer PO numbers or credentials.

## 7. Approaches considered and REJECTED, and why

- Cached-XLSX "no formulas" inference: native Sheets proved it incomplete.
- Mirroring historical flags into current workflow: gives false current truth;
  use separate snapshot columns and explicit unknown/current-source labels.
- Guessing assortment component quantities or summing parent cases per component:
  inflates physical totals. Use the reviewed backend's exact parent accounting.
- Replacing the Master Data serving view: pulls retired RFQ dependencies into a
  narrow task. Use a bounded status RPC on each existing1000-row batch.
- Opaque per-row JSON helper: count projection pruning/row performance failed.
  Bound SQL TABLE helper plus one-row lateral evaluation passed measured plans.
- Finite-looking numeric comparisons alone: PostgreSQL NaN passed the old checks;
  explicit numeric `< Infinity` constraints now reject it and both infinities.
- Merging a new named verification contract before its protected checker knows it:
  guarded merge37897638269 refused. PR4131 is the reviewed tooling prerequisite.
- Reusing old approvals after version/main/source changes: exact-head gates refuse;
  preserve historical artifacts and get actual new approvals.
- Retrying quota-exhausted review: Qwen produced no valid review. Supported durable
  replacement approved the checker; no approval or provider quota was fabricated.
- Bypassing another session's production freeze: unauthorized and unnecessary.

## 8. Design decisions already made (2026-10-09)

LOCKED: Item Master description; Master Data current workflow; tracking header
facts inherited by components; separate import history; admin-only manual
controls; missing/conflicting workflow explicit; no guessed quantities.
LOCKED: Orders tabs OrderList / PO Tracking / Sample Settings. Master Data
Licensed/Generic remain and gain a Vendor Statistics tab. Current licensing is
readonly in cells, fill, AI bulk edits and direct mutation builders.
LOCKED: new OrderList fields are readonly, filter/sort disabled until existing
Find whitelist supports them; do not change its backend in this feature.
LOCKED: tracking50 headers/page, sample/settings100/page, statistics100/page,
30-second visible-page refetch/focus refresh, debounced Master realtime refresh.
LOCKED: source loader is one guarded application transaction over only three
new empty tables. No automatic curated Master Data/canonical-header update.
OPEN: none that requires a business decision or architecture choice. Small
spacing/labels follow existing app components; do not redesign the navigation.

## 9. The plan — numbered, ordered steps

### Phase A — protected delivery (context cut: after actual backend application)

1. **Deliver the backend, in canonical shared-db only.** Inspect the real freeze
   via readPromotionFreeze, the ready PR4131 and current main. When the foreign
   hold is absent/expired, run the ship gate with its actual lifecycle Muse
   report, dispatch guarded-migration-merge for PR4131/exact c54 head and verify
   merged. Preserve an active foreign hold and concurrent queue entries.
   Merge current main normally into PR4118's own clean branch. Retain the
   stronger catalog verifier from PR4131 and rederive the inventory baseline
   from actual tracked migration files, preserving historical marker tuples.
   Re-reserve through --reversion-active-claim if current version is behind any
   newer merged/live version; never rename manually or reuse a burned version.
   Re-run focused tests, full CI, registry-bound delivery preflight and two
   allocator-assigned exact-head reviews. Guarded merge; prepare the official
   preview manifest and use the supported merged-main rehearsal/promotion
   route. Resolve any selector discrepancy from current implementation, never
   guess manifest fields. Gate:merged source, actual target identity,
   preview/production ledger entry and exact catalog TRUE, existing78 leading
   OrderList columns preserved, ordinary authenticated-role read and approved
   preview rollback-write tests pass. Do not start dependent app code before
   backend merge; do not ship it before the production contract is verified.

2. **Load auxiliary source inputs, as app-owned row data.** Add
   scripts/load-orderlist-integration-inputs.py and a focused loader test file;
   add its exact path to .ai-devops/task-gates.json as reviewer-safety and update
   scripts/test-task-gates.sh/its named fixtures for that route. Reuse the
   credential/target-proof/recovery/plan patterns in the existing
   scripts/refresh-google-orderlist-rows.py without editing that other task's
   script. Dry-run only until exact source/action independent final/security
   review and the app database gate pass. Prove production project
   qsllyeztdwjgirsysgai immediately before write through session pooler5432:
   host, full postgres.<project> user, current_database and connection metadata.
   Allow only the three exact new tables/closed columns; no DDL, canonical rows,
   identities, dates, grants or deletes. Revalidate frozen SHA/counts/unique
   normalized keys and every PO UUID/number against current canonical headers.
   Lock destination tables, assert all empty, create/verify private recovery
   and dry-run plan digests, COPY typed rows with psycopg write_row, assert
   counts8257/38/3147 before commit as one transaction. An unsafe/mismatched
   source or changed database state aborts atomically. Retain held exceptions
   rather than guessing. Gate:guarded commit verified11442 rows, recovery/source
   hashes match, 71 held tracking exceptions and three duplicates remain
   excluded, and no canonical header, Item Master or Master Data row was written.
   Root owns this database action.

### Phase B — app implementation (context cut: after local/preview verification)

3. **Types, pure validation and query boundary.** Add
   src/types/order-integration.ts, src/lib/order-integration.ts,
   src/hooks/useOrderIntegration.ts and src/lib/order-integration.test.ts.
   Define OrderTrackingRow/OrderTrackingComponent, SampleDepth,
   CustomerSuffix and VendorStatistic from the actual reviewed migration's
   SELECT/result shapes; reuse OrderListRow only for existing list rows.
   Append12 optional fields to src/types/order-list.ts so existing fixtures
   remain compatible:product_workflow_source,master_data_sample_vendor,
   sample_depth_inches,cases_error,assortment_parent_quantity,
   assortment_parent_cases,assortment_parent_key,sample_depth_raw,
   sample_depth_source_row,snapshot_test_report,snapshot_professional_photos,
   snapshot_contractual_sample_reorder. Current source is
   master_data/at_import/unavailable/ambiguous; absent legacy source displays
   conservatively from actual item linkage, never fabricated current approval.

   Export TRACKING_INPUTS closed metadata for exactly these24 keys:
   sent_po_date,vendor_delivery_date,booking_state,etd,eta,
   container_booking_group,mbl,close_tracking,agent,cbm,comment,vessel,
   sent_to_coldlion,worksheet_done,inspection_passed,inspection_note,
   document_invoice,document_packing_list,document_bill_of_lading,
   document_tsca,document_lacey_act,document_telex,request_wire,payment_note.
   Date keys are sent_po_date/vendor_delivery_date/etd/eta/inspection_passed;
   numeric key cbm; close_tracking and the nine other named boolean keys are
   booleans; remaining keys text. (Boolean keys besides close:
   sent_to_coldlion,worksheet_done, six document_* keys and request_wire.)
   buildTrackingPatch(original,changed) rejects unknown fields, normalizes only
   explicitly changed keys and omits unchanged normalized values. Empty
   nullable values become NULL; clearing close_tracking becomes false. Numeric
   CBM must be finite and>=0. Dates must be complete real YYYY-MM-DD dates,
   including leap-day validation. Booleans accept only true/false/NULL or their
   exact controlled-form encodings; never Boolean('false'). Text is trimmed.
   Positive sample depth may be cleared to NULL; sku/customer are required
   normalized strings. Customer suffix is required, trimmed,1..50 characters;
   it cannot be cleared because the reviewed table does not permit blanks.

   Hooks use an authenticated user guard and query family ['order-integration',
   kind, page/search/openFilters]. Tracking calls public.get_dam_order_tracking
   with p_offset=page*50,p_limit=50,p_search,p_only_open. Sample/suffix/statistics
   read api.dam_order_sample_depth/api.dam_order_customer_settings/
   api.dam_order_vendor_statistics with fixed structured filter columns,
   deterministic ordering and ranges of100 rows. Depth has separate style and
   customer search inputs; do not concatenate user text into PostgREST `or`.
   Escape %, _ and backslash for literal ilike searches. Search caps200 chars.
   Query refetch interval30s and focus refresh; surface errors with retry.
   next-page availability means a full page, not an invented total. Settings
   tables are separate tabs/pages, never one whole8257-row browser fetch.
   Mutations call only update_dam_order_tracking(p_order_id,p_patch),
   upsert_dam_order_sample_depth(p_sku,p_customer,p_depth_inches) and
   upsert_dam_order_customer_settings(p_customer,p_suffix); no direct table
   mutation. Invalidate the query family and refresh the current OrderList
   block after success. Gate:validation and mocked hook bound/error tests pass;
   no generated type edits, unknown field acceptance or unbounded read.

4. **PO Tracking and component detail.** Add
   src/components/orders/POTrackingPanel.tsx with bounded server search,
   open-only switch, previous/next, refresh, loading/error/empty states and a
   horizontally scrollable table. Display PO/vendor/customer/type, total
   cases (Unknown on NULL), Unknown case totals, CRD/forecast/status, ETA/WHS,
   delay/status, worksheet days, current report/photo completeness, inspection
   and booking identifiers. No-line order says No order lines; unknown flags
   never show Yes. Report/photo Yes requires line_count>0 and missing count0.
   Surface unresolved_product_lines rather than suppressing it.

   Each PO opens components showing SKU, Item Master description, licensing,
   default/sample vendor, depth/raw provenance, current test/photo/reorder and
   workflow source, quantity/pack/cases/error and separate parent quantity/cases.
   NULL component quantity shows Unknown. Import history is a separately
   labelled detail group; it does not fill current missing cells. Header manual
   facts are shown once for the PO and inherited by its components.

   Add OrderTrackingEditor.tsx using a Dialog and TRACKING_INPUTS; show only
   when useIsAdmin().isAdmin (which respects member impersonation). Readonly
   identifiers, totals, dates/status derived by backend and product flags are
   outside the form. Track dirty fields; never send a prefilled whole-record
   patch. Do not replace a dirty draft on background refetch. Save errors retain
   the draft and display failure; success closes/refetches. Gate:component tests
   prove viewer has no edit control, readonly facts cannot become patches,
   error retains dirty values, explicit clearing works and inherited detail
   remains accurate. Preview actual admin save/clear/rollback passes.

5. **Sample Settings and suffix settings.** Add
   src/components/orders/OrderSampleSettings.tsx with separate depth/suffix
   tables, bounded search/page controls, refresh and errors. Admin add/edit
   form calls the closed upsert RPCs, with required normalized style/customer,
   finite positive-or-clear depth and nonblank1..50 suffix. Show original raw
   value/source row alongside current depth, labelled as source history rather
   than an active value that could resurrect after a clear. Do not expose
   deletion. Gate:tests positive/NULL depth, invalid numeric and empty suffix
   refusal, viewer controls, error retry, and preview actual upsert/clear prove
   current OrderList depth/suffix changes without touching Master Data rows.

6. **OrderList read-through and refresh.** Update src/pages/OrdersPage.tsx,
   src/lib/order-list.ts, src/components/orders/MasterDataLinkCell.tsx and
   existing OrderList column construction (locate with rg before editing).
   Add OrderList / PO Tracking / Sample Settings tabs, preserving saved views,
   Find, relinking and existing edit behavior. Append the12 readonly fields
   named in step3; disable unsupported server filter/sort/Find rather than
   advertising behavior the bounded Find contract does not implement.
   Current test/photo/reorder display Yes/No/Unknown with source qualification.
   Linked Item Master with missing/conflicting tracker is Unknown, never an
   import snapshot fallback. Unlinked history is labelled At import. Show
   Item Master linkage separately from missing product workflow; do not label
   a linked item No SKU. Preserve canonical Item Master Description.
   Add authenticated style_tracker_rows realtime subscription, debounced
   visible-block refresh (500ms), focus refresh and30s visible polling.
   Dispose channel/timers on unmount; own successful tracking/settings
   mutation refreshes current list block. Gate: existing OrderList tests plus
   linked-unknown/history, unsupported Find field and cleanup tests pass;
   a preview Master Data update changes the matching visible order without
   rewriting the order row. Confirm PopSG never gains Orders routes.

7. **Master licensing and reverse vendor statistics.** Update
   src/pages/StylesPage.tsx and its existing valueFor/buildUpdate/column
   construction; add src/components/orders/VendorStatisticsPanel.tsx.
   After each existing1000-row tracker batch, call
   get_dam_style_tracker_license_status(p_row_ids=that batch IDs), map by id
   and replace license_status. Keep current parallel batch/window bounds;
   no full-view rewrite or browser whole-table computation. Missing result
   IDs and RPC failure are explicit errors, not silent stored-status fallback.
   Licensed column N is computed readonly; exclude it from cell editing,
   fill and AI bulk field choices and reject direct buildUpdate attempts.
   Generic rows may display a synthetic readonly license_status column,
   without remapping existing letters. For workflow milestone/test/photo/
   reorder/sample_vendor/discontinued semantics, named-key presence including
   NULL outranks legacy letters and stale typed values; retain other existing
   field precedence. Preserve existing writes of named key plus legacy letter.
   Add a readonly Vendor Statistics tab using the step3 bounded statistics
   hook: vendor, total/closed/open orders, latest sent date and14-month activity.
   Gate: batch<=1000, map-by-id, missing/error, readonly edit/fill/AI exclusion
   and named-NULL precedence tests pass. Preview actual milestone update
   changes licensing on both Master Data and linked orders; vendor statistics
   agree with the backend for the same factory/vendor grouping.

### Phase C — reviewed shipment, live acceptance and durable closure

8. **Review and deliver.** Re-read downstream phases before this cut point.
   Run npm test, npm run build and targeted lint in the app worktree, with
   meaningful new tests from section10. Obtain the assigned in-rotation
   different-engine review on the exact source head, fix findings, and run
   task gates before shipment. Commit only owned paths, push feature branch,
   open/attach the app PR to issue281 and merge through normal checks/queue
   using ai-pr-wait. Fetch before landing; no protected-main direct push.
   Confirm Publish Frontend Image and supported Coolify deployment consume
   the merged SHA; authenticate administrator and viewer at the live site.
   Capture protected screenshots of Orders tabs, component facts, sample
   settings, Master licensing and vendor statistics. Verify actual API data,
   visible current truth/unknowns and viewer edit exclusion, not merely HTTP
   success or worker deployment. Actual mutation propagation is proven in a
   preview rollback fixture; do not manufacture production canonical data
   just to demonstrate editing. Gate: exact live served SHA plus authenticated
   screenshots and same-row API comparisons recorded on issue281; all checks
   green, original capabilities remain available.

9. **Close documentation and acceptance.** Update docs/ORDER_LIST.md,
   docs/MASTER_DATA.md and this plan STATUS with actual completed artifacts.
   Register the plan in AGENTS.md's relevant active-plan list, without editing
   unrelated guidance. Commit prepared canonical business-rule/native-source
   documentation from /worksp/shared-db-orderlist-rules only after structural
   delivery stabilizes, refreshing main first; it is a prose-only normal PR,
   not a new schema session. Relevant files are
   docs/business-rules/erp-orders-and-source-meaning.md and
   docs/app-migration-notes/popdam-order-list.md. Keep current authority distinct
   from historical formula evidence. Record backend apply/catalog proofs,
   exact source-load counts/hash, app review/CI/served SHA and live evidence on
   the existing issues4111 and281. Close only when all requested integrations
   work live; retain #275 division choices and #277's 12 conflicting orders and
   58 malformed/incomplete source rows as separate held exceptions. The 12 PO
   identities in its conflicting-order set match 12 of the 71 auxiliary tracking
   holds; the other 59 holds remain separate. Delete this session's handoff only
   after its work is actually complete. Gate: every STATUS done row cites
   re-derivable evidence; no acceptance gap or unowned unfinished delivery.

### Adversarial inputs and named proof

| External input | Hostile or ambiguous case | Named test proving behavior |
|---|---|---|
| Google source JSON | changed hash, duplicate PO, wrong UUID, unexpected row count | loader_rejects_changed_source_and_nonexact_target |
| Google number cells | NaN, infinity, negative depth, invalid raw text | loader_preserves_raw_and_rejects_nonfinite_depth |
| Tracking browser patch | unknown/derived key or whole-record submission | tracking_patch_is_closed_and_dirty_only |
| Numeric browser input | negative CBM, infinity, zero CBM, cleared depth | finite_numeric_and_nullable_depth |
| Date/browser boolean | invalid leap day, incomplete date, string false | strict_dates_and_boolean_false |
| Authenticated viewer | forged admin patch or settings write | SQL viewer_rpc_write_refused plus viewer_has_no_edit_controls |
| Impersonated member | real admin account viewing as member | impersonation_has_no_edit_controls |
| Current product facts | named NULL, conflicting trackers, missing tracker | current_unknown_never_uses_import_approval |
| Search/filter text | %, _, backslash, PostgREST expression fragment | search_is_literal_and_page_is_bounded |
| Licensing RPC result | missing IDs, reordered result, failed batch | licensing_maps_by_id_and_failure_is_visible |
| Background update | dirty draft overwritten, duplicate channels | draft_survives_refetch_and_subscription_cleans_up |
| Assortment quantities | unknown components, duplicate physical parent | SQL physical_parent_counted_once_unknown_components_stay_unknown |
| Save response | network/RPC failure | failed_save_preserves_dirty_values |
| Initial load rerun | nonempty auxiliary table, concurrent writer | loader_refuses_nonempty_tables_in_one_transaction |

## 10. Tests required

Add pure validation tests in src/lib/order-integration.test.ts and meaningful
component/hook tests colocated with the new files, using the existing Vitest
setup and mocks. Named behaviors are in the adversarial table; avoid tests
that merely reproduce implementation constants. Extend existing order-list
and Master Data tests for source precedence, readonly computed licensing,
Find exclusion and batched result mapping. Run npm test and npm run build;
identify targeted lint script in package.json and run it on changed source.
Preserve the already-passing76 existing order/Master tests. For loader use
Python unittest with offline fixture sources; run the guarded transaction
against preview fixture/rollback before reviewed production import.
Backend source behavior SQL is
supabase/tests/dam_order_sheets_integration.sql in the canonical repository;
run its actual CI entry, catalog239-test suite and full Schema CI. The checker
prerequisite's239 catalog tests and72 throughput tests already passed, but
fresh merged-head evidence is still required. Current backend exact-head CI37903481114 passed at7ceed18c after checker merge; later heads require new proof.

## 11. Constraints, standing rules, and gotchas in force

Own isolated worktrees only, no broad staging or force push. Declare task class
and check gates before stronger actions; all schema authored in shared-db.
Do not manually apply DDL or bypass promotion freezes, immutable contracts,
reservations, target proof or review. Dependent app code starts only after
backend merge. Product Master Data is not a purchase tracking store. Never
create curated tracker rows to remove Unknown. Keep reviewed source counts
bounded; no whole-table browser load. Supabase API exposed schema api is
usable; private dam uses approved public RPCs. Never edit generated types or
vendored mirror. All human times use EDT/EST, America/New_York. GitHub posts
include this chat signature. Keep secrets/raw source/auth storage private.
No paid reviewer retry when quota is exhausted; use supported replacement.
Do not remove capability or silently swallow failed current-data queries.

## 12. Access and environment

Production Supabase qsllyeztdwjgirsysgai; preview project must be refreshed from
shared-db GitHub environment (last verified mvpkijzfmfcxhnzqogzs, not assumed).
Production website https://dam.designflow.app; PopSG https://sg.designflow.app.
GitHub gh authenticated; gate/review/wait CLIs installed. Backend DB credentials
use 1Password vault vibe_coding item Supabase DB Password - shared POP database,
field password; preview DB password item qbvfk7umc3n75ejekd65zwd4ty field
DB_PASSWORD. Do not print values; use op_run protected env. Production reads
use TLS pooler aws-1-us-east-1.pooler.supabase.com, user
postgres.qsllyeztdwjgirsysgai, database postgres; transaction loader uses session
port5432 after proving project target. Preview corresponding user and host
come from supported environment, never substitute retired Ohio project.
Admin login item7s5uzpbjenka4fpvrqogh44bre; viewer item
mbspkosvp2rf25qxhqufipxqca, both vibe_coding. Resolve item titles through safe
metadata before use; no password in arguments or output. Playwright runtime
/opt/ai-tools/playwright/node_modules/playwright, Chrome
/opt/google/chrome/chrome with isolated contexts and --no-sandbox. App npm ci
is already complete; local dev uses package.json dev script. Scratch is
/tmp/tmp.ptGk0ACD5D for this session only; source recovery location/digest is in
section6 and this session handoff. If scratch vanished, recover source from
protected files/Sheets and re-review exact digest rather than guessing.

## 13. Definition of done, risks and open questions

DONE means backend current-source reviewed/merged, merged-main preview and
qualified automatic production apply verified by ledger/catalog/roles;11442
auxiliary source rows loaded under independently reviewed exact transaction;
all screen integrations implemented/tested/reviewed/merged; actual deployed
frontend SHA verified with administrator/viewer UI and API evidence; native
inventory/company rules/current docs updated; issue281 acceptance complete.
No one calls local preparation deployed. Principal risks: foreign merge freeze,
concurrent main movement, reviewer quota, historical Google missing PO rows,
ambiguous division styles and unavailable current Master workflow for20 linked
ColdLion lines. Three division choices belong to Albert on #275 and do not
block honest Unknown behavior. Issue #277 retains 12 conflicting orders (79
source rows) and 58 malformed/incomplete rows; those 12 order identities match
12 of the 71 auxiliary tracking holds. Keep those decisions separate and do not rewrite
its source-refresh script. Recovery: revert app via
normal GitHub supported deployment; auxiliary import rollback removes only
exact reviewed newly inserted auxiliary identities in a guarded transaction;
backend shape reversal needs a fresh shared-db governed migration, never
inline drop. Stop and preserve exact state if external gates cannot be cleared.

## Self-audit (2026-10-09)

1. Fresh-session execution: YES; sections2,5,6,9 and12 identify repositories,
   current evidence, exact next actions, source/credential locations and gates.
2. Background and nuance: YES; sections3,6,7,8 and13 preserve source authority,
   unknowns, rejected catalog shortcuts and separate exceptions.
3. Goal-guided judgment: YES; sections1,4 and8 prioritize working integrations
   and honest current facts over blindly reproducing defective formulas.

Comprehensiveness checklist: all13 sections YES; plain goal/goal-wins YES;
fresh-session execution YES; rejected attempts YES; concrete files/gates YES;
external-input adversarial named tests YES; locked/open decisions YES;
out-of-scope YES; named tests YES; identifiers/locations YES; secret values
absent YES; commit/push/CI/live DoD YES; reciprocal handoff YES. Re-evaluate
this audit whenever a later delivery changes the current state.

### Production delivery evidence

Production migration and initial auxiliary row load are complete. The migration
run, exact migration/source hashes, row counts, catalog and behavior checks are
recorded in STATUS. The load inserted only the three application-owned auxiliary
tables in one guarded transaction; a later read-only check matched all three
counts. The 71 held source rows and three duplicates remain excluded. No schema,
permissions, canonical PO headers/dates, curated products, Item Master or Master
Data rows were changed. Recovery remains restricted to exact inserted identities
and unchanged full-row fingerprints; it must never erase later user edits.

Installer repair rehearsal: unchanged migration installed by the repaired helper
in isolated PostgreSQL 15; all 25 helper unit tests and 10 real PostgreSQL
transaction tests passed. The later governed production run and catalog proof
are recorded in STATUS.

Import rehearsal: the current loader copied 8,257 depth, 38 suffix and 3,147
tracking rows into isolated PostgreSQL 15, then guarded rollback removed exactly
those rows. The rehearsal corrected canonical header validation to use
`production_order_number`; the source digest remained unchanged. Loader tests
include failed parent-directory fsync rollback. The subsequent hosted load is
complete as recorded in STATUS.

The application integration merged in PR #282 at
`3000b7e04bd6864bc9bef699abc6b84e02f64661`; PR #285 added the deployed-app
proof workflow and its exact-head StepFun review/CI passed. Its workflow has not
run while the separate Master Data loading repair is pending. Current read
acceptance on `f02b9de` reached 88/93 before the viewer License/Styles row timed
out; both roles hit `57014` on one initial range GET, while exact-ID Find reached
its target after loading. Final acceptance and replacement screenshots remain
open. No production edits are needed for these checks.

The approval-date clearing correction preserves a real NULL when AG Grid's date
editor is cleared, while keeping nonblank behavior unchanged. Its behavior tests,
focused lint, build, and review are included in the merged application delivery.
