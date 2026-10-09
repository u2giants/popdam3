# Master Data Style Tracker

Active loading-performance work is tracked in [`../plan_master_data_orderlist_loading_performance.md`](../plan_master_data_orderlist_loading_performance.md). Read its STATUS table first; do not re-derive or re-plan completed steps.

This is the Master Data page at `https://dam.designflow.app/styles`. It mirrors
the legacy Google Sheet style tracker while PLM is not yet fully hosted in the
shared Supabase project.

## Current Runtime

- Route: `/styles`
- Page: `src/pages/StylesPage.tsx`
- Production host: `dam.designflow.app`
- Deployment: the normal PopDAM GHCR/Coolify frontend pipeline
- The top bar always shows a selectable build stamp containing both the short
  commit ID and its commit date/time, including in compact-height mode.

The old standalone `master.designflow.app` preview was used during the initial
prototype. It is not the current deployment path. Master Data frontend changes
ship with the normal PopDAM frontend workflow and are verified at
`https://dam.designflow.app/styles`.

## Data Model

The Google Sheet was imported into:

- `public.style_tracker_rows`
- `public.style_tracker_rows_with_bridge`
- `public.style_tracker_audit_log`
- `public.style_tracker_audit_log_with_user`
- `plm.style_tracker_item_bridge`
- `plm.style_tracker_value_resolution`
- `public.style_tracker_user_views`

Important RPCs:

- `public.add_style_tracker_rows(p_source_sheet, p_tracker_type, p_count)`
- `public.refresh_style_tracker_item_bridge()`
- `public.search_style_tracker_link_candidates(p_field_key, p_query, p_limit, p_match_mode)`
- `public.upsert_style_tracker_value_resolution(...)`

Rows are loaded newest-first, but the browser loads the full active tab so quick
search, column filters, and saved filters always evaluate the complete list.
Pagination defaults to 1,500 visible rows. **Show All** sits beside the
bottom pagination controls and expands the current filtered result set; it does
not change which rows are searched or filtered.

Source date fidelity: [`verification/master-data-date-fidelity-20261008.md`](verification/master-data-date-fidelity-20261008.md)
records the completed nine-cell correction and the permanent converter behavior
for Google dates beyond year 9999. Original recovery-v2 TSV is an error preimage;
use the protected date-repair source snapshot for corrected equality checks.

## Google Sheet Import Rules

The import script is `scripts/import-style-tracker-xlsx.py`.

The Google Sheet contains formula/default-only tail rows. Those are not real records. A populated row must contain at least one business field such as style/SKU, group, description, customer, designer, commissioned, UPC, licensor, status, vendor, or notes. Formula-only values such as `0`/`false` in trailing status columns must not cause import.

Verified populated counts from the 2026-08-28 production refresh:

- `License.Style`: 12,527 rows
- `Generic.Style`: 3,207 rows
- Total: 15,734 rows

The historical 2026-08-28 replacement cleared prior imported rows, audit history,
and manual value resolutions, then rebuilt `plm.style_tracker_item_bridge`.
Current refreshes use `scripts/refresh-style-tracker-rows.py`, whose reviewed
[execution package](verification/google-sheet-refresh-20261008.md) preserves
provable row identities, relevant canonical relationships, existing audit history,
manual resolutions, and saved views while making source fields equal Google.
Ambiguous identities are replaced without guessing. Refreshed rows are stamped
as system updates, and changed source cells are recorded in audit history.
Recovery preimages and source/database fingerprints are mandatory.

The 2026-08-28 refresh used workbook SHA-256
`14f771331f2de0ffea7b2ac8e23ff3f9cb1332c7d2bc93ff51352e8a66708874`.
The atomic post-load checks confirmed 15,734 bridge rows, including 14,732
canonical item links. A pre-refresh database backup was taken before replacement.

## UI Behavior

- Approval dates color the whole row in both Master Data tabs. A date in
  `Concept Approval` highlights the row yellow. A date in `Production Approval`
  highlights it green. Production approval takes priority when both dates are
  present.
- Tabs:
  - Google Sheet `License.Style` maps to **Licensed**
  - Google Sheet `Generic.Style` maps to **Generic**
- Right-click a spreadsheet cell and open **Audit history** to see that cell's change history.
- `Print Fair Row#` is hidden by default.
- `Legacy BA#` is hidden by default.
- `Match` column is the row-level Master Data cross-reference status.
- `Sample Vendor` uses the active `core.factory` list as its cell picker in both Licensed and Generic tabs.
- `Sample ETA` appears beside Sample Vendor in both tabs, saves a date in the flexible row data, and its heading tooltip reads `ETA From Factory`.
- Licensed and Generic use the same grid and save logic; their column configurations only identify the different source-sheet positions and omit licensing-only fields from Generic.
- `Ordered Proff Photos` remains a text field. `Professional Photos` is a Yes/No field in both tabs.
- Google date columns use date editors and Google checkbox columns use Yes/No editors. The Generic `UPC Code` column is numeric. Mixed identifier columns such as Style #, BA#, UPC, and Customer SKU remain text so leading zeroes and nonnumeric legacy values are not damaged.
- `Originally Designed For` (Licensed) and `Special Customer` (Generic) are canonical Customer relationships. Their dropdown reads `api.dam_customer_list`, displays `display_name` with `name` as the fallback, and saves `public.style_tracker_rows.customer_id` (`core.customer.id`). Customer names are not copied on selection, so later renames do not break or stale the relationship. Legacy imported customer text remains only on rows that could not be backfilled unambiguously and disappears when a user selects a canonical Customer.
- `Designer` uses active `core.creative_designer` rows as its picker. Linked rows display and filter by `canonical_designer_name` from `public.style_tracker_rows_with_bridge`; unresolved imported designer text remains visible as a fallback. Saving a picker value keeps the audited sheet text in sync and refreshes `plm.style_tracker_item_bridge`, whose `creative_designer_id` is the canonical foreign key.
- `Packaging Type` appears in both Licensed and Generic tabs and uses the active `core.packaging_type` list as its cell picker. The selected display name is stored in each row's flexible `row_data.packaging_type` field; this does not duplicate or modify the shared lookup table.
- `Catalog Image` is intentionally absent from both tabs. Its legacy imported
  value may remain in `row_data`, but it is not displayed or edited in Master
  Data.
- `RFQ Group` is automatic and read-only. The database matches each row's exact,
  case-insensitive, whitespace-trimmed `row_data.rfq_code` to legacy DesignFlow
  RFQ items and returns `rfq_groups` from
  `public.style_tracker_rows_with_bridge`. The newest group name is visible in
  the cell. If the row has previous groups, the cell shows `+N`; clicking it
  opens a read-only history popover with the newest group first. Users cannot
  select or edit a group from this list. Empty matches return `[]`, never null.
- Double-clicking the `Description` cell opens the SKU-description builder. It still saves one string to `public.style_tracker_rows.description` / column `D`, but users compose that string from six visual sections:
  `MG01`, `MG02`, `MG03`, `Licensor + Property`, `Art Description`, and `Size`.
- The controlled description sections are picker/autocomplete driven. `MG01`, `MG02`, and `MG03` use the MerchGroup schema in `src/lib/mg-lookup.ts`; MG02 is limited by MG01, and MG03 is limited by MG01 + MG02. `Licensor + Property` reads `core.property` joined to `core.licensor` and displays values as `Licensor Property`; `Size` tries `core.product_size` when present, then existing DAM `style_groups.size_name`, then convention examples. `Art Description` is the only free-text section.
- A nonblank description must have approved values for MG01, MG02, MG03, Licensor + Property, and Size before the grid accepts the edit.
- The `Row` button opens a menu for `+1`, `+5`, `+10`, `+25`.
- Grid pagination defaults to 1,500 rows per page, with 500 and 1,000 row options.
- The current deployed Master Data page requests four 1,000-row ranges per
  first wave. Licensed ranges load sequentially, each GET followed by its
  computed-status request; Generic ranges remain parallel. Later pages append
  in the background. The UI reports the number of rows actually received,
  distinguishes initial and next-page failures from loading/completion, and
  offers retry for an initial failure or the failed later page. A displayed
  total does not imply that those rows have loaded. During partial loading,
  Find and filters apply only to loaded rows.
- This behavior first shipped in PR #287 as frontend token `f901017`; those
  read/timing/retry results are historical. The editor-safe interrupted-refresh
  repair is now live in PR #289 as token `9883315`. Focused production checks
  passed in both roles, including edit preservation and cancellation with zero
  business writes. Native workflow `37987001226` passed 90 checks across both
  roles; shared-db #4111 and PopDAM #275 are closed. Only #281 documentation/closeout
  remains open. Earlier timing comparisons
  remain in the [October 9 baseline](verification/grid-loading-performance/2026-10-09T1802Z/README.md).
- Until loading finishes, Find and column filters cover rows already loaded;
  once complete they cover the full in-browser tab.
- Ctrl+F focuses the grid's full-dataset Find box. Find keeps the full table
  visible, moves to the first matching row, and highlights matching rows rather
  than filtering every other row out.
- Administrators can select rows and use **AI helper** to preview one bulk
  field/value update before confirming it. The planner uses `gpt-5.6-luna`
  with medium reasoning; existing picker and description rules still validate saves.
- AG Grid Enterprise is installed without a license key for now, matching the PLM-style trial setup. Keep AG Grid packages pinned to the same exact version; a previous `35.3.1` Enterprise + `35.1.0` Community/React mismatch caused a blank page before React mounted.

## View Customization (Saved Views)

Users can customize the grid and save named, per-user views:

- **Show / hide columns and re-order:** the **Columns** button opens AG Grid's
  columns tool panel (drag to reorder, toggle checkboxes to show/hide). Columns
  are also draggable **live in the grid** by dragging their headers; the grid
  option `maintainColumnOrder` preserves a user's manual order across the async
  option-list refreshes that rebuild `columnDefs`.
- **Save / name views:** the **Views** dropdown (star icon) lists the current
  user's saved views for the active tab and offers **Save current view…**,
  **Update "<active view>"**, per-row **rename** (pencil) and **delete** (trash),
  and **Reset to default**. Saving captures the full AG Grid column state
  (order, visibility, width, pinning, sort) via `getColumnState()` plus the
  `getFilterModel()` filters.
- **Persistence:** views are stored per user + per tab in
  `public.style_tracker_user_views` (`column_state`, `filter_model`,
  `source_sheet`, `view_name`). The last-applied view id is also remembered in
  `localStorage` (`master-data-active-view:<source_sheet>`) and re-applied on
  grid mount and when switching tabs, so a user's chosen layout survives reloads.
- Views are scoped to the active tab's `source_sheet` (Licensed vs Generic), so
  the Licensed and Generic tabs keep independent saved views.

## Matching Workflow

The **Master Data matching** panel is admin-only.

Plain English:

- The left dropdown is built from imported Google Sheet values in the currently loaded Master Data rows.
- The candidate box next to it is built from `public.search_style_tracker_link_candidates(...)`, then filtered client-side so broad fallback results do not show unrelated approval buttons.
- When one or more approved Customer, Licensor, Designer, or Factory candidates remain, the admin API uses the existing server-side `OPENROUTER_API_KEY` to ask the pinned TypeSafe Jev decision model to assess only those candidates against an explicit `no_match` choice. A sufficiently confident answer adds a `Jev suggests` marker without moving the approval buttons: it cannot add candidates, create records, or save a match. `no_match` or a low-confidence answer leaves the choices unmarked. If Jev or its privacy-constrained OpenRouter route is unavailable, the UI says so and shows the existing deterministic choices.
- If no automatic candidate survives, the UI shows a manual picker. Typing in the manual search uses the corresponding canonical candidate search where possible; checking **Show all** explicitly lists up to 100 rows from the corresponding table/list so an admin can choose the right value.
- **Approve: X** saves a canonical match and removes the selected value from the review dropdown.
- **Dismiss: Keep In Master Data** means **Master Data only**. It marks the raw sheet value as accepted locally and does not link or write to a shared canonical table.

After approving/dismissing a value, the UI removes it immediately from the dropdown and future refreshes exclude rows whose `match_notes.manual_resolution.field_key` matches that field.

## Source authority

This document describes how the DAM screen implements Master Data. It does not own a
separate business rule for source authority.

- Customer identity follows
  [`shared-db/docs/shared-database-vision.md`](../shared-db/docs/shared-database-vision.md).
- Licensor, Property, Character, Style Guide, Franchise, licensed-Asset, and licensing
  source authority follow
  [`shared-db/docs/core-master-data-consolidation-aim.md`](../shared-db/docs/core-master-data-consolidation-aim.md).
- The 2026-06-24 statement that PLM APIs are canonical for Licensors and Properties is
  **Historical**. The settled 2026-08-16 rule says authorized licensor sources own official
  names, ownership, and direct relationships; ColdLion controls Property Active/Inactive
  only; the stale DesignFlow pull has no authority.

Do not treat arbitrary customer-looking strings as canonical Customer matches. Canonical
Customers live in `core.customer`; confirmed ERP-backed Customers have the appropriate
source reference and `is_potential = false`.

1Password item:

- `DesignFlow PLM Canonical Master Data API`

The item stores the read-only API key in a concealed field and notes the exact endpoints. Do not copy the key into docs or frontend code.

Endpoints:

- Licensors/properties: `GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties`
- Customers: `GET https://api.designflow.app/api/core/customers/getCustomers`
- Auth header: `x-api-key`

The active candidate-search contract is `public.search_style_tracker_link_candidates(...)`. It should return PLM-backed canonical rows for customer/licensor/property matching by joining `core.customer` through `core.company_source_ref` or joining `core.licensor` / `core.property` through `core.taxonomy_source_ref`, with `source_system = 'designflow_plm'`. Do not add browser-side PLM API calls or broad customer-name searches for this workflow.

The manual picker is an admin override for unresolved values. It may list existing `core.customer`, `core.licensor`, `core.creative_designer`, `core.factory`, or `public.style_groups` rows, but it must not create canonical rows or call PLM APIs directly from the browser.

## SKU Description Builder

The description builder follows the convention document:

```text
MG01 -> MG02 -> MG03 -> Licensor + Property -> Art Description -> Size
```

Examples:

- `Printed Glass Shadowbox Marvel Spider-Man Building Hopping 16x20" x1.2"`
- `PE Rattan 2-Tier Wall Shelf Disney Princess Floral Icons 12x16"`
- `Coir Doormat Coca-Cola Classic Logo 18x30"`

Picker sources:

- MG01, MG02, and MG03 use the human-readable MerchGroup values in `src/lib/mg-lookup.ts`, in that order. The saved description contains the labels, not the one-character ERP codes.
- `core.property` has the property name and `licensor_id`; the UI shows the property picker as `Licensor Property`, so users browse by property but the final description includes the licensor automatically.
- `core.product_size` is the preferred future size picker. Until it is live everywhere, the UI falls back to DAM style-group `size_name` values and the examples from the convention document.

Do not add browser-side PLM calls for these pickers. Add or update shared picker tables/RPCs in canonical `popcre/shared-db`, then consume them from the Master Data page.

## Known Data Provenance Finding

`Rossy` came from the old company-table design, not from the Google Sheet. It
was one of the email-domain noise rows that had been incorrectly associated with
the customer table. That association has been removed; email-domain noise belongs
only in `crm.ingested_domain`, never in customer source refs.

This is why customer matching must use PLM canonical customer data only.
Confirmed customers are `core.customer` rows with `is_potential = false` and a
PLM source ref. Email-domain noise stays in `crm.ingested_domain` and must never
create, promote into, source-ref, FK to, or otherwise associate with customers.

## Verification Notes

Verified during the 2026-08-06 Master Data go-live replacement:

- The production database contains exactly 12,439 `License.Style` rows and
  3,174 `Generic.Style` rows, with 15,613 matching bridge rows.
- Commit `6c3b6f1` contains the pagination constants and regression test:
  `MASTER_DATA_DEFAULT_PAGE_SIZE = 500` and options `500`, `1000`, `1500`.
- The focused pagination and approval-highlighting tests passed: 2 files and 5
  tests. `npm run build` passed. `npm run lint` completed with no errors and the
  repository's existing warnings.
- The pagination code first shipped in commit `6c3b6f1`. Commits `c13fdf8` and
  `eb78907` then made search/filtering use the full active tab and moved **Show
  All** beside the bottom pagination controls. Frontend workflow `31128263974`
  passed lint, built and pushed the image, and deployed `eb78907` through
  Coolify. The live `https://dam.designflow.app/` bundle was verified to contain
  both build ID `eb78907` and the new **Show All** control.

Verified during the 2026-06-24 session:

- `npm run build` passes after the current page reconstruction.
- `https://master.designflow.app/styles#` redirects to `/login` when unauthenticated and no longer white-screens.
- Preview container `popdam-master-preview` reached healthy state after redeploy.
- Playwright smoke checks showed no console errors on the unauthenticated route.

Verified during the 2026-06-26 core.customer cutover repair:

- `public.search_style_tracker_link_candidates('customer', 'Ross', 5, 'fuzzy')` on preview returned `target_schema = 'core'`, `target_table = 'customer'`, `target_label = 'Ross Stores'`.
- The stale prod `plm.style_tracker_value_resolution` row was migrated from `target_table = 'company'` to `target_table = 'customer'`.
- Prod Supabase type generation for `public,core,dam` succeeds and exposes `core.customer`.

Verified during the 2026-08-02 RFQ Group rollout:

- Canonical shared-db migration
  `20260731230000_style_tracker_rows_rfq_groups.sql` is applied to production.
- Production `public.style_tracker_rows_with_bridge` has 15,534 rows, 2,015
  rows linked to at least one RFQ group, and 11 rows linked to multiple groups.
- Known row `MFZ88KMSC01` / RFQ Code `MFZ88-309` returns `Family Dollar July
  2023`.
- The original pre-aggregated RFQ join looked fast as the database owner but
  caused the authenticated browser's first 1,000-row request to exceed its
  8-second limit on 2026-08-02. Shared-db PR #418 replaced it with an indexed
  per-row lookup in migrations `20260802194000` and `20260802194100`. The exact
  browser-shaped query measured 46.7 ms on preview and about 0.75 seconds on
  production after the fix.
- PopDAM commit `a77847e` removed Catalog Image and added the read-only RFQ
  Group history UI. CI, shared-db guards, and the frontend publish/deploy
  workflow passed; the live site returned HTTP 200 and served bundle
  `index-DoD6FXvN.js` containing the RFQ history feature.
- Authenticated visual verification after PR #418 showed the live Licensed grid
  loading all 12,401 rows instead of remaining stuck at `Loading...`.

## Follow-Ups

- Keep candidate matching constrained to PLM-backed source refs through `public.search_style_tracker_link_candidates(...)`.
- ✅ Per-user saved grid views are implemented and durable in canonical
  shared-db migration `20260710135600_reconcile_style_tracker_tables.sql`.
- Move the temporary Master Data tables/RPCs into a cleaner PLM bridge namespace or replace them when PLM lands in the shared Supabase project.


## OrderList integration delivery (2026-10-09)

The backend is installed and the application integration merged in PR #282
(`3000b7e04bd6864bc9bef699abc6b84e02f64661`). The subsequent OrderList Find
repair merged as PR #283 at `709450766d9ddf2e7944db1aaa916a188e3cac75`
(reviewed source head `9e4a005aba239253fd9ab2c7435b755a2cf9e37e`). Full CI run
`37958015493` passed 80 files / 496 tests plus one existing skip; the build
passed. Frontend publish run `37958305346` succeeded. At that prior release,
production served token `7094507`, asset `index-U3ZqunIC.js`, bundle SHA-256
`9fd6875ad97cbc7cdf44e033a54d3d26b88532058a8c8a3fe6f55014a508ae8e`, and image
digest `60d6eb3237d360f1fb90d8b7b5884ae8de92e6c1871c636d606772f766b6ace5`.
Styles Find repair PR #284 merged at
`f02b9de2e60a317aaf5136c77957b1639b9274b1` (1:11 PM EDT); exact-head GLM
review approved it (report
`glm-final-check-20261009T165439-2485646-28136.md`). CI run `37964251577` passed 81 files / 497 tests plus one
existing skip. Publish run `37964512337` succeeded at 1:15 PM EDT. At that prior release,
production served token `f02b9de`, asset `assets/index-BGe0FYew.js` (SHA-256
`b48e4cafceb7113365782c2398707e029f2332ce5fe900ff349a2d4af6c9d2c6`), and image
digest `12b5c868d41aa25a8cfbab0f8e38e1037f2e0c519fd52911fd120063eb9dc87a`.
The administrator fixture capture passed; report `fixtures-f02b9de.json` has
SHA-256 `2e1f46649dfe71e95b75f1f6e296145b38b986411b14e40518383e60c5a1782a`.
PR #285, the deployed-app/production-types proof workflow, merged at
`783f7357a1e407bc3a26859ddb82fa5561220f99` (1:33 PM EDT). Exact-head StepFun
APPROVE is recorded for source `c8f02dc44e8b27a058ec538e10bcd28f0f478110` in
`stepfun-final-check-20261009T172314-2599466-16163.md`. CI run `37966825066`
passed 497 tests plus one existing skip and 19 observer tests. Its workflow has
four existing-account proof secrets configured; no accounts were created.
PR #287 then merged as `f9010170b1ec7e8003016dba0ade6f2251fccb48`; publish run
`37974214106` succeeded and production served token `f901017`. The read
acceptance, screenshot attempt 12 and existing controls at that release are
historical; current focused acceptance is recorded below. The type-proof workflow `37975970329` stopped at its guard after
schema generation. Repair PR #288 has exact-head GLM APPROVE (digest
`6d770bdad0a5e1579182c0f469ee4731226b6d8f3d7fc25810c91ea6746ad806`); production
and ship gates passed; it merged as `a5efa998799df2c99c562a10663b690d66c6ad18`
and CI `37978046556` passed. Final workflow `37978352705` failed finding the
viewer snapshot in the DOM and produced no canonical type-proof artifacts. PR #289 is live as token `9883315`; publish `37986360726` succeeded at 4:25 PM EDT. Served bundle `/assets/index-B2s-PtZY.js` has SHA-256 `574bdff6df39c7533993996c591b04c8133e62e82b3e25626f29a5258c8c46fb`; the container is healthy and matches merge `9883315c7d64b9ed274cc92ae3c1d0c73cc6597b`. Final CI `37985400880` passed 510 tests/82 files, one existing skip and 19 observer tests. Focused edit/refresh checks passed both roles; report `focus-refresh-9883315.json`, SHA-256 `4a3aced17a65b1d7ac473a31180ed7104cb9c36501ed4dfed114cf50702a2641`. The held 500-row read beginning at offset 10,000 was followed by a distinct 500-row read returning HTTP 200 at the exact offset. Native workflow `37987001226` passed 90 checks across both roles (checks SHA-256 `708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`); schema, type artifact `11643178561`, and live artifact `11642863862` matched and passed. Shared-db #4111 and PopDAM #275 are closed. Only #281 documentation/closeout remains open. The post-link readback now has 23 ColdLion lines across 7 linked Items; workflow remains correctly Unknown where Master tracker facts are absent, with no tracker or Item Master records created.
A private exact-sequence diagnostic later passed 90 checks total across both
roles on `f901017` with no HTTP errors, using Find offsets `[0, 20438, 1403,
1403, 12121, 10380]`; checks SHA-256
`708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`. It is not
a native workflow artifact. Native rerun `37981872323` failed viewer current-link
description with `ResponseTimeoutError` at 3:45:48 PM EDT after type generation
passed; it produced no canonical artifacts. This failure remains preserved.
Focused edit/refresh checks and native workflow proof passed on live `9883315`. The separate #275 UI check passed 53 administrator/viewer checks with exact Find results and visible canonical descriptions; issue #275 is closed. Only #281 documentation/closeout remains open.
Production backend run
`37951612832` passed with the unchanged migration SHA-256
`bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590`, bounded
catalog verification (56 checks), and 9 behavior checks. The guarded auxiliary
source load completed with 8,257 sample-depth, 38 suffix, and 3,147 tracking
rows; a separate read-only production count check matched. Historical
pre-PR #284 administrator/viewer same-row acceptance passed 93 checks (47/46);
report
`acceptance-report-7094507-attempt2.json` SHA-256
`0fccf979a10fc39fa61ea9cbb12eef45ac03c824388510518a4f0dd1b68dac73`. Find
passed for both roles: current at offset 0 and far rows at offsets 10,380 and
6,839 matched exact Find IDs, bounded GET pages, and visible rows. The Find
diagnostic SHA-256 is
`86b3cb643eb5740f7ae3c6e680b53d35d533c746a3d532f0407b4d0c01378977`.
Original controls passed for both roles; their report SHA-256 is
`0b87513183fa5435225623a76fcd00db99144b28af961f3d01c4b4c56752464d`.
The earlier parallel Licensed load produced a `57014` timeout; that finding is
historical and was corrected in PR #287. The previous `f901017` release passed 93 read-only checks (administrator 47,
viewer 46), strict Find, loading observation and retry probes; these are
historical acceptance for unchanged behavior. Screenshot attempt 12 passed (14 role screenshots, 118
meaningful API/DOM checks; report `screenshots-final-attempt12-f901017.json`,
SHA-256 `d91c2a2e1e36973fa374b69511acfc2d6144a5fbdf2e61faa432a6bedd90f179`).
Existing controls passed both roles; report
`existing-capabilities-attempt7-f901017.json`, SHA-256
`072f9c2887770f1d07aada9fdbebdc39d6a17992412bc31dcd25695144995706`. PR #288
merged as `a5efa998799df2c99c562a10663b690d66c6ad18`; CI `37978046556` passed.
Final workflow `37978352705` failed viewer snapshot DOM finding and produced no
canonical type-proof artifacts. Native rerun `37981872323` failed viewer
current-link description with `ResponseTimeoutError` at 3:45:48 PM EDT after
type generation passed; it produced no canonical artifacts. The private
exact-sequence diagnostic passed 90 checks total across both roles without HTTP
errors, but is not a native artifact. PR #289 is live as `9883315`; fresh focused acceptance passed (details above).
Native workflow `37987001226` passed; preserve the earlier failed runs as history. Shared-db #4111 and PopDAM #275 are closed with evidence. PopDAM #281 remains the acceptance tracker for documentation closeout.

Master Data's named current workflow fields remain the source used by linked
OrderList lines. When a named current field exists, its presence is authoritative
even if the value is NULL; an explicit NULL clears the older imported letter
instead of reviving it. Missing or conflicting workflow results remain Unknown.
Unlinked OrderList lines can show a frozen import value only with an `at import`
label. Item Master supplies linked product descriptions; a source description
snapshot remains historical fallback only when there is no linked live value.

License Status is calculated from the current workflow through the bounded
`get_dam_style_tracker_license_status` call, mapped by row ID for each loaded
batch. A missing result ID fails the batch visibly. This computed value is
read-only in cell editing, fill, AI helper field choices and update builders;
the existing Master Data serving view remains unchanged. PO-level manual
tracking stays on OrderList. Sample depth and suffix settings are application
inputs in their own auxiliary tables, not canonical Master Data edits.
VendorStatistics is a separate read-only Master Data screen showing purchase
header totals, closed/open totals, latest sent PO and 14-month activity, with
100-row pages.

Keep source exceptions on their existing issues. The owner recorded
`DSMT0MVAV01` → POP (Functional Wall) and `NTSTVSSSS01` → Spruce (Storage) on
[#275](https://github.com/u2giants/popdam3/issues/275#issuecomment-6088735709). The guarded application is committed and read-back verified: all 462 links are present, zero are ambiguous, the three decided rows have the expected divisions, item IDs and served descriptions, and the original 459-row preimage fingerprint is unchanged. The administrator/viewer UI proof passed 53 checks; all three exact Find IDs, 500-row reads, and six canonical descriptions matched. The report `coldlion-owner-link-proof.json` has SHA-256 `fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`; it recorded zero write attempts and zero browser errors. Issue #275 is closed with evidence in comment 6089001259. Current linked workflow is Unknown for 23 ColdLion lines across 7 Items because Master tracker facts are absent; no tracker rows or Item Master records were created.
Issue [#277](https://github.com/u2giants/popdam3/issues/277) holds business
decisions for 12 conflicting orders (79 source rows) and 58 malformed/incomplete
rows. A private identity-only comparison confirmed that all 12 conflicting
order identities match 12 of the 71 auxiliary tracking holds; the other 59
holds remain separate and excluded. Issue #277 does not own those other missing-
reference holds. No Master Data row, canonical Item Master record, or existing
PO date is manufactured or changed to conceal those exceptions.
