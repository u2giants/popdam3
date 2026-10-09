# IMPLEMENTATION PLAN — reproduce the native Sheets integration (2026-10-09)

## STATUS

**Closed:** all nine integration steps are complete. Reviewed delivery documentation landed in https://github.com/u2giants/popdam3/pull/290; application issue #281, matching issue #275 and shared outcome #4111 are closed. The completed session handoff is retired after confirming live results and closure. Historical attempts below remain evidence, not instructions to restart completed work. Separate source decisions remain on #277.

Current production is PR #289 merge `9883315c7d64b9ed274cc92ae3c1d0c73cc6597b`.
Publish run `37986360726` succeeded at 4:25 PM EDT. Production served HTTP 200
with token `9883315`, asset `/assets/index-B2s-PtZY.js` (SHA-256
`574bdff6df39c7533993996c591b04c8133e62e82b3e25626f29a5258c8c46fb`), and
`APP_DATE=2026-10-09T16:20:46-04:00`. The container is healthy, its OCI revision
matches the merge, and Coolify deployment `btf5t1we2eh3alydmt6wxcoi` completed.
Final CI `37985400880` passed 510 tests in 82 files, one existing skip, and 19
observer tests.

Fresh focused production acceptance passed on the new release in both roles.
Report `focus-refresh-9883315.json`, SHA-256
`4a3aced17a65b1d7ac473a31180ed7104cb9c36501ed4dfed114cf50702a2641`. Both roles
found the same RPC ID at index 10,380; a held 500-row read beginning at offset
10,000 was followed by a distinct 500-row read that returned HTTP 200 at the
exact offset, with the row visible and the earlier response unable to overwrite
it.
For administrator, an unsaved value survived two focus changes with zero GETs
while editing; Escape canceled it, one queued GET returned 200 and restored the
original value. This focused acceptance made zero business-row writes. The
separate guarded #275 owner-decision transaction committed three intended links;
all 462 links were read back and verified, with zero ambiguous rows.

Earlier 93-check read acceptance, strict Find, loading/retry, screenshot and
original-control reports were run against `f901017`; they remain historical
acceptance for unchanged behavior. Native workflow `37987001226` passed for
merge `9883315`: 90 checks across both roles. The checks-label manifest SHA-256 is
`708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`; this
hashes the ordered check labels only; run-specific results are separate.
Canonical schema SHA-256
`fc9041a48038b8604e94a8e0169d06d049214eba57dd609dd296f95823738954` matched;
type artifact `11643178561` SHA-256
`7fdbb47c64e182e3893d104ef3105a751e6a5666efe857d9d640943d306229a7` and live
artifact `11642863862` SHA-256
`54f02a6384171d797ce11ba7ef306dbc39e7d9e41a24c71c3f12b1672332ed59` passed.
Shared-db #4111 has native completion evidence `03332b22ceb8adcb` and is closed.
PopDAM #281 is closed after reviewed documentation landed; #275 is closed after the role-based UI proof.

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

The merged app is live as `9883315`; deployment, focused role checks and native
proof are recorded above. Earlier 93-check read acceptance, Find, loading/retry,
screenshot and controls were on `f901017` and are historical. Native runs
`37978352705` and `37981872323` failed and produced no canonical artifacts;
those failures remain in history. Current native workflow `37987001226` passed.
Shared-db #4111 and PopDAM #275 are closed; #281 is closed after reviewed documentation landed.

| Step | Status | Evidence / remaining gate |
|---|---|---|
| 1. Governed backend delivery | Complete | Migration `20261009073649` applied; production run `37951612832`, catalog and behavior checks passed; native issue #4111 is closed. |
| 2. Auxiliary source load | Complete | Source SHA and exact 8,257/38/3,147 counts verified by a separate read-only production count. |
| 3. App types and query boundary | Complete | Merged in PR #282; native live artifact `11642863862` passed on deployed merge `9883315`. |
| 4. PO Tracking and component details | Complete | Merged in PR #282; preview rollback and current administrator/viewer acceptance passed. |
| 5. Sample Settings | Complete | Merged in PR #282; preview rollback covered positive depth and explicit NULL behavior. |
| 6. OrderList read-through and refresh | Complete | Current facts and bounded refresh passed the native role checks; focused interrupted-read recovery passed both roles. |
| 7. Master Data licensing and reverse statistics | Complete | Merged in PR #282; read-only licensing and statistics verified in native workflow. |
| 8. Authenticated production read acceptance | Complete | Native workflow `37987001226` passed 90 checks across both roles and verified the live and type artifacts; earlier failures remain historical. |
| 9. Documentation and closeout | Complete | Reviewed documentation landed in https://github.com/u2giants/popdam3/pull/290; #281, #4111 and #275 are closed. This session's completed handoff is retired after successor review; separate source exceptions remain on #277. |

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

Historical implementation checkout: app worktree
`/worksp/popdam-sheets-integration`, branch `codex/sheets-full-integration`,
and backend worktree `/worksp/shared-db-orderlist-integration`, branch
`codex/orderlist-sheets-integration`. These implementation worktrees are
archived, not active checkouts. Do not resume them; future app edits start from
current upstream in a fresh dedicated worktree. `/worksp/popdam` remains
landing-only. Never edit the app's read-only shared-db mirror or generated
Supabase types.

## 3. What triggered this work

Albert asked why ColdLion lines showed no Master Data link, requested exact
style-number matching against Item Master, then said "product details should
now be supplied by item master" and "reproduce the Sheets’ full integration".
The last verified linkage count before the new decisions was 459 of 462
ColdLion lines; product Description uses Item Master. The owner recorded
`DSMT0MVAV01` → POP (Functional Wall) and `NTSTVSSSS01` → Spruce (Storage) on
[#275](https://github.com/u2giants/popdam3/issues/275#issuecomment-6088735709).
Guarded application is committed and read-back verified: all 462 links are
present, zero are ambiguous, the three decided rows have the expected divisions,
item IDs and served descriptions, and the original 459-row preimage fingerprint
is unchanged. Before those three links, readback showed 20 linked lines across 5
Items; afterward it showed 23 lines across 7 Items. The final administrator/viewer
UI proof passed 53 checks, showed all six canonical descriptions, and made zero
write attempts or browser errors; report
`coldlion-owner-link-proof.json` SHA-256
`fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`. Issue #275
was closed with evidence in comment 6089001259.

Historical pre-implementation gap: `/orders` and `/styles` lacked the full
POTracking/sample-settings/reverse-statistics surface, and licensed progress was
an editable stored display. PRs #282–#289 implemented the integration; remaining
acceptance is tracked on https://github.com/u2giants/popdam3/issues/281.

## 4. Scope — in and out

IN: current Master Data licensing/vendor/test/photo/reorder read-through;
PO-level manual tracking/documents/payments plus readonly component details;
sample-depth and customer-suffix settings; physical-parent case accounting;
forecasts/status/inspection/booking helpers; reverse VendorStatistics;
bounded queries, admin/manual permissions, cross-screen refresh and live proof.

NOT in this plan: canonical Item Master creation/curation; making unreviewed
POP vs Spruce Licensed choices (the decisions and guarded application are
complete and #275 is closed); fixing the twelve
Google refresh exceptions on #277; migrating RFQ relationships; rewriting the existing Master Data serving
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

The application integration is merged through PR #289 and live as `9883315`;
deployment, focused role acceptance and native proof are recorded in STATUS.
The previous source implementation worktree was archived after PR #282; it is
not a current checkout. Any new code work starts from current upstream in a
fresh dedicated worktree. Issue #281 is closed after reviewed documentation;
#275 is closed after the verified role-based UI check.

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
   work live; retain the #275 UI verification and #277's 12 conflicting orders and
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
and 23 linked ColdLion lines across 7 Items whose workflow is correctly Unknown
because current Master tracker facts are unavailable. This is up from 20 lines
across 5 Items before the three guarded links. No tracker rows or Item Master
records were created. The owner
recorded two #275 item decisions and root committed and verified all 462 links,
with zero ambiguous rows and the three mappings checked against canonical served
descriptions; the original 459-row fingerprint is unchanged. The final #275
administrator/viewer UI proof passed 53 checks, showed all six canonical
descriptions and recorded zero write attempts or browser errors. Report
`coldlion-owner-link-proof.json`, SHA-256
`fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`; issue #275
is closed with evidence in comment 6089001259. Honest Unknown behavior remains
for 23 linked lines across 7 Items without current Master tracker facts. Issue
#277 retains 12 conflicting orders (79
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

PR #287's `f901017` is a prior release; its read, Find, loading/retry, screenshot
and controls acceptance is historical. PR #289 is live as `9883315`; deployment,
focused role checks and native workflow `37987001226` passed. Native run
`37981872323` failed its viewer current-link description after type generation
passed; that earlier failure produced no canonical artifacts and remains part of
the history. Native evidence now passed; #4111 is closed. #281 is closed after reviewed documentation; #275 is closed after the 53-check role-based
UI proof.
Existing controls passed in both roles as recorded in STATUS. These checks are
read-only; no production edits are required.

The approval-date clearing correction preserves a real NULL when AG Grid's date
editor is cleared, while keeping nonblank behavior unchanged. Its behavior tests,
focused lint, build, and review are included in the merged application delivery.
