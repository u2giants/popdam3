# OrderList (`/orders`)

Active loading/Find-performance work is tracked in [`../plan_master_data_orderlist_loading_performance.md`](../plan_master_data_orderlist_loading_performance.md). Read its STATUS table first; do not re-derive or re-plan completed steps.

PopDAM's replacement for the legacy Google Sheet `OrderList`. Signed-in PopDAM
staff can view, search, filter, sort, edit and create order lines. Linked product
descriptions come from Item Master (`plm.item.description`, then item name),
never the older style-tracker description. Existing licensing/vendor/customer
columns still use their separately named Master Data sources.

PopSG never exposes this page: both the route and the nav item are behind
`!IS_POPSG`, and `src/test/order-list-routing.test.ts` fails if that changes.

---

## Files

| Piece | File |
|---|---|
| Route registration | `src/App.tsx` (protected, `!IS_POPSG`) |
| Navigation entry | `src/components/AppHeader.tsx` (`popdamNavItems`, and `SECONDARY_NAV_LABELS` for compact chrome) |
| Page | `src/pages/OrdersPage.tsx` |
| Grid | `src/components/orders/OrderListGrid.tsx` |
| Row Edit action (the only way into the editor for an existing order) | `src/components/orders/OrderActionsCell.tsx` |
| Create / edit / void dialog | `src/components/orders/OrderEditorDialog.tsx` |
| Link status cell | `src/components/orders/MasterDataLinkCell.tsx` |
| Manual relink dialog | `src/components/orders/MasterDataLinkDialog.tsx` |
| Saved views menu | `src/components/orders/OrderListViewsMenu.tsx` |
| Summary counts | `src/components/orders/OrderListSummary.tsx` |
| Data access | `src/hooks/useOrderList.ts` |
| Pure rules (columns, parsing, matching, query building) | `src/lib/order-list.ts` |
| Types for the `api` view and the RPCs | `src/types/order-list.ts` |
| Tests | `src/test/order-list*.test.ts(x)` |

## Current Google source refresh

Use `scripts/refresh-google-orderlist-rows.py` and the source-bound dry-run,
independent-review, recovery, identity/fidelity, and live-proof procedure in
[`verification/orderlist-refresh-20261008.md`](verification/orderlist-refresh-20261008.md).
The historical first-import CLI's production replacement refusal remains intact.
Do not delete or merge ColdLion records based on matching PO/style/quantity;
uncertain identities and malformed Google entries stay held on the same issue.

## Database contract

All objects are owned by canonical `popcre/shared-db`. Nothing here may be changed from
this repo.

| Object | Used for |
|---|---|
| `api.dam_order_list` | The one read surface. Security-invoker view joining `plm.production_order`, `plm.production_order_line`, the linked `plm.item`, and Master Data through `plm.style_tracker_item_bridge`. |
| `public.create_dam_order(p_order jsonb, p_lines jsonb)` | Create an order with its lines. |
| `public.update_dam_order(p_order_id uuid, p_order_patch jsonb, p_line_patches jsonb)` | Edit header and line fields. Only keys present in the patch are written. |
| `public.link_dam_order_line(p_line_id uuid, p_item_id uuid, p_match_status text)` | Manual relink to a canonical item. |
| `public.order_list_user_views` | Per-user saved column/filter/sort layouts, unique on `(user_id, view_name)`. |
| `public.style_tracker_rows_with_bridge` | Source of eligible relink candidates. |

**Patch-key trap:** the RPCs accept `status`, while the view exposes
`order_status` and `line_status`. `patchKeyFor()` in `src/lib/order-list.ts`
does the translation. Sending a key outside the RPC's allow-list fails with
`42501` (HTTP 403), so this is a hard contract, not a preference.
`ordering_company` is not an accepted key, so that column is read-only.

## How the page loads data

The list is **not** loaded in full. Measured against the preview database on
2026-08-16 the whole view is about 53 MB (2.2 MB per 1,000 rows x 24,010 rows)
and took roughly 25 seconds to appear. The grid therefore uses AG Grid's
infinite row model and reads 200-row blocks, pushing sort, filter and search
into the database, so results always cover every matching row rather than only
the rows in the browser. First rows now appear in well under a second.

Consequence, deliberate: **Set filters are not offered.** A Set filter lists the
distinct values of the whole dataset, which the browser no longer holds; showing
one would silently filter against loaded rows only. Columns use Text, Number and
Date filters, plus the free-text search box, which searches
`ORDER_LIST_SEARCH_COLUMNS` in the database.

The summary counts (total, linked, ambiguous, not linked) are read as sequential
count queries over the whole dataset, not derived from loaded rows. They start
after visible rows have loaded so they cannot hold up the grid.

The default view is sorted by newest **Order Date** first and shows 1,500 rows per
page. Users can change the sort or page size, and saved views can restore their
own sort.

The grid virtualizes cells, so the browser does not create DOM text for every
off-screen row. Ctrl+F is therefore captured and focuses the page's database-backed
OrderList Find box. Find locates the first match across the full result set,
moves to and highlights that row, and leaves the surrounding rows visible.
Administrators can select rows and use **AI helper** to preview one bulk field/value
update before confirming it. The planner uses `gpt-5.6-luna` with medium reasoning;
the existing OrderList write contract still validates every saved value.

**Visible blocks never request or wait for an exact total** (strengthened
2026-09-11). The earlier row/count split still launched the exact count beside
the row request, while the summary launched four more counts. Under production
load those statements competed and the bounded row query could still fail with
`canceling statement due to statement timeout`. The grid now renders each
500-row block alone and discovers the exact end when the last block is shorter.
See `docs/KNOWN_QUIRKS.md` #75. Do not put a count back on the row-loading path.

**What the exact count actually costs** (re-measured on production as
`authenticated`, 2026-08-27, issue #100). The original "~2.2 s under RLS"
reading blamed the wrong thing. Every RLS policy on the joined tables is
`using (true)`, so it folds away and costs nothing; a *warm* count is 161 ms.
The cost is **cold-cache sequential IO** — 24,835 shared buffers (~194 MB), of
which 16,943 are a full scan of `plm.style_tracker_item_bridge`, a 132 MB table
holding ~24 MB of live data. That scan happens because the bridge has no index
on `plm_item_id`, the column this view joins it on, and the join cannot be
pruned: the bridge genuinely fans out (24,010 order lines to 24,486 view rows).
The remedy is two indexes in canonical `popcre/shared-db` (issue #1657), which drop the
cold read substantially. **When measuring this again, look at `buffers`, not at
RLS.**

**Resolved, verified on production 2026-08-30** (shared-db #1657 and #1722).
Both large tables are now Index Only Scans and the bridge does zero heap
fetches: the exact total costs **107 ms cold / 52-76 ms warm**, reading **969
buffers (~8 MB)** where it once read 24,835 (~194 MB). That is ~1.5% of the 8 s
`authenticated` ceiling. The visible-row path stays count-free regardless, so
whole-list work cannot delay or kill a bounded block.

**No-role timeout resolved and verified on production 2026-09-16**
(shared-db #2988, migration `20260916033914`). Customer and vendor display
names now come through two narrow, non-exposed directory views instead of
re-running the role-dependent Customer/Vendor policies for every directory row.
The main OrderList view remains security-invoker, anonymous access stays denied,
and direct Customer/Vendor access is unchanged. The same first 500 rows took
105 ms as Albert and 121 ms as Yzhou's no-business-role identity, with identical
row/name digests, no missing linked names, and 1,927 warm buffer hits for each
identity (down from Yzhou's measured 58,527 before the repair).

## Master Data rules

- An order line points at a canonical `plm.item`. Master Data is reached through
  the style-to-item bridge. There is no second link to `style_tracker_rows`.
- Column colors mirror the Google OrderList: blue is user input, light gray is
  automatic/linked output, and dark gray is derived/helper output. Import PO #
  is entered only when creating an order and is immutable afterward.
- When a line has no link, the Master Data cells fall back to the immutable
  import snapshot and are labelled `at import`. A snapshot value is never shown
  as if it were current product truth.
- Rows needing a human decision (ambiguous, or unlinked with a Style #) are
  highlighted and named in the Master Data Link column.
- A manual relink offers only exact, catalog-eligible candidates: the normalized
  Style # must match exactly (trim + case-fold only, never fuzzy) and the Master
  Data catalog must match the line's Licensed/Generic value. Manual links are
  saved with match status `manual`.
- A relink always writes `manual`, in both directions. There is no UI path back
  to `matched`, so re-pointing a line at the item it already had still changes
  its status. That is deliberate: a human decision stays visible as one.

## Editing rules

- Only the Google sheet's blue inputs are writable: Customer (canonical picker),
  Order Person, Order Type, Customer PO, Assortment ID, Style #, Order Depth,
  Quantity, Case Pack, Ship To, Start Ship, and Cancel. Automatic and helper
  fields are blocked in both the grid and the database RPCs (shared-db #1772).
- Licensed/Generic is a guarded matching override for resolving ambiguous Style
  # links; it is not presented as a normal blue input.

- **Editing an existing order** starts from the pencil in the pinned Edit column
  on each row. The editor dialog was previously reachable only through **New
  order**, which left `mode: "edit"` as dead code and made the whole edit and
  void path unreachable (fixed 2026-08-26, issue #99).
- **There is no delete.** A correction voids the order: `update_dam_order` takes
  `{"voided": true, "void_reason": "..."}`, which stamps `voided_at`/`voided_by`
  and keeps the record. The dialog requires a reason and asks for confirmation,
  and offers **Restore** on an order that is already voided.
- **`api.dam_order_list` does NOT filter voided rows out.** A voided order stays
  in the grid and must therefore be *rendered* as voided — struck through, faded,
  with a ban icon in the Edit column — or a cancelled order reads as a live one.
- **`order_voided_at` is not a grid column, so it must be named explicitly in
  `ORDER_LIST_SELECT`.** That select list is built from the grid's columns plus a
  short list of extras; a field the grid needs but never displays is invisible to
  it otherwise. Leaving it out made voiding write correctly while looking like
  nothing happened. A test pins it in place.
- **An unreadable value is refused, never written as null.** `parseOrderDate` and
  `parseOrderNumber` return `null` both for "the user cleared this field" and for
  "this text is not a date/number", so typing `not-a-date` over a real date used
  to ERASE it and report "Order saved" — silent data loss with a success message,
  reproduced against production on 2026-08-26. `coerceFieldValueStrict` now
  throws on non-empty input it cannot parse, naming the column; the grid turns
  that into a toast and rolls the cell back. Clearing a cell to empty still
  writes `null`, because that is a real edit. **Any new write path must use
  `coerceFieldValueStrict`, not `coerceFieldValue`.**

## Permissions

Read and write follow the collaborative Master Data model: any signed-in PopDAM
user can read and edit. There is no delete; corrections use status and void
fields so history survives.

## Find behavior

OrderList Find keeps the grid's active filters and sort, then asks the shared
database for the first matching row and its position in one bounded lookup. The
grid loads the normal destination block and highlights the match with nearby
rows still visible. It does not download the full list or scan IDs in the
browser. A temporary fallback exists only if a just-deployed server genuinely
does not yet expose the lookup; permission, validation, timeout, and database
errors stay visible instead of being hidden.

> **Settled by the owner, 2026-08-26.** Albert Hazan ruled that **everyone
> signed in should be able to see OrderList data**. The four OrderList tables
> carry `USING (true)` SELECT policies for `authenticated`, which already match
> the ruling, so no policy change was required — read access is now a deliberate,
> approved decision rather than an unreviewed default. Writes remain restricted
> to `plm_admin_write` (administrator role). This closes open question 2 in the
> shared-db plan `plan_popdam_order_list.md`.

## Verification (2026-08-16, preview `rjyboqwcdzcocqgmsyel`)

Checked in the real app, signed in, against the preview database:

- 24,010 lines listed, first rows visible immediately;
- free-text search `NCV3SP1` returned 23 rows from the database;
- column filter `Style # contains BFC02GABB` returned 1 row of 24,010;
- a cell edit saved through `update_dam_order` and was confirmed in the database,
  then reverted the same way (PO Status became read-only in shared-db #1772);
- a manual relink of a licensed line saved through `link_dam_order_line` and the
  whole-dataset counts moved to `Linked to Master Data: 1`;
- a saved view was created (60 columns of state) and deleted;
- Columns panel, compact width (900px) and the PopSG exclusion all behave.

## Verification (2026-08-26, production `qsllyeztdwjgirsysgai`)

Checked in the deployed app at `dam.designflow.app/orders`, signed in as an
administrator, at build `47a42e92`:

- **24,486 shown of 24,486 lines · Linked to Master Data: 24,473 · Ambiguous: 0
  · Not linked: 0**; page 1 of 245 at 100 rows per page;
- Master Data descriptions render live on every row (no `at import` fallback);
- no console errors beyond the pre-existing AG Grid trial-licence notice.

## Human pass over the write paths (2026-08-26, production, issue #99)

Every write path was exercised against live production orders, signed in as an
administrator, and every change was reverted. The database confirms production
was left exactly as it was found: 3,212 orders (0 voided), 24,010 lines
(23,997 `matched`, 13 `not_applicable`), 0 saved views.

| Path | Result |
|---|---|
| Cell edit | PASS — saved, persisted across reload, reverted; one order and one line touched |
| Order editor dialog on an existing order | PASS — after adding the row Edit action; prefilled correctly, saved, reverted |
| Create an order | PASS — created, then voided, restored, voided again, and finally removed so production carries no test data |
| Void / restore | PASS — reason required, confirm step, row renders struck through, Restore clears `voided_at` and the reason |
| Manual relink | PASS — offered exactly one candidate (the exact Style # in the line's own catalog), wrote `manual` without changing `item_id` |
| Saved views | PASS — created, survived reload, restored the exact column layout, deleted |
| Error honesty (failed save) | PASS — a forced 503 produced a toast and a visible rollback; nothing was written |
| Error honesty (unreadable input) | **FAILED, then fixed** — see the coercion rule under *Editing rules* |
| PopSG exclusion | PASS — no Orders nav item; `sg.designflow.app/orders` renders the app 404 |
| Deep paging | PASS — page 26 of 245 (rows 2,501-2,600), total held at 24,486, zero failed requests |

Three defects were found and fixed in the same pass: the editor was unreachable
for an existing order, there was no way to void, and unreadable input silently
erased the field it was meant to change. All three are described under
*Editing rules*.

Two measurement traps cost time and are worth knowing:

- **AG Grid virtualises columns horizontally.** Reading `.ag-header-cell-text`
  shows only what is on screen, so a restored saved view looks wrong when it is
  right. Scroll the grid end to end, or read the column state, before concluding
  anything about which columns are visible.
- **Pinned columns live in a different DOM container.** `PO Status` and
  `Import PO #` are pinned left, so they are not inside
  `.ag-center-cols-container`; a row reader that only looks there finds nothing.

The earlier intermittent first-block timeout for no-business-role users is
resolved by shared-db #2988. Keep the block count-free and preserve the narrow
directory-view contract; restoring per-row Customer/Vendor role checks would
reintroduce the production failure.

## Current data state

**Production linkage after the 2026-08-28 Master Data refresh.** `plm.item` holds **19,362** items
loaded from ColdLion through `plm.import_item_master_data`; the style-item
bridge carries `plm_item_id` on 14,732 rows; and
`public.relink_dam_order_lines_bulk()` linked **23,997 of 24,010 order lines**
with zero ties and zero no-candidates. The 2026-08-28 workbook refresh removed
the current style records behind 10 previously linked order lines; those stale
links were deliberately cleared and now show as unmatched instead of displaying
obsolete Master Data. Production therefore has 23,987 linked lines, 10 unmatched
lines, and 13 `not_applicable` lines with no SKU. Link integrity was checked:
zero linked order items are absent from the refreshed Styles bridge.

The import-snapshot fallback now applies to the 10 unmatched historical lines
and remains necessary when a new order arrives before its item does.


## Native Sheets integration delivery (2026-10-09, issue #281)

**Status: backend installed, source inputs loaded, and PRs #282–#289 merged. Current release `9883315` is live; publish `37986360726` and CI `37985400880` passed. The served bundle SHA-256 is `574bdff6df39c7533993996c591b04c8133e62e82b3e25626f29a5258c8c46fb`; focused administrator/viewer refresh checks passed. Native workflow `37987001226` passed 90 checks across both roles (checks-label manifest SHA-256 `708b9395e8e6e054372a7c9b7a7bb73b03f0ce3448df2acec338b447586eb0e1`), with verified schema, type and live artifacts. Shared-db #4111 and PopDAM #275 are closed. The #275 administrator/viewer UI proof passed 53 checks; report `coldlion-owner-link-proof.json`, SHA-256 `fd33979beb4abe88c0a5eb969b58ec7b679ebffda9f227d63b1bfb9b6d7a219f`. The 3 target Find IDs matched indexes 2,000, 2,558 and 7,785; 500-row reads at offsets 2,000, 2,500 and 7,500 displayed all 6 canonical descriptions. There were zero write attempts and browser errors; issue evidence is comment 6089001259. Only #281 documentation closeout remains. Earlier failures and prior-release acceptances below are historical.**
Application acceptance stays on
[u2giants/popdam3#281](https://github.com/u2giants/popdam3/issues/281); the
shared backend contract is [popcre/shared-db#4111](https://github.com/popcre/shared-db/issues/4111).
The application merged as PR #282 at
`3000b7e04bd6864bc9bef699abc6b84e02f64661`. Production backend run
`37951612832` passed with the unchanged migration SHA-256
`bbe83b7db3ac4eb67a1468da83f32d1d9a5a75695decdf09a2957bcf6b31e590`, bounded
catalog verification (56 checks), and 9 behavior checks. The hosted-preview
rollback acceptance passed administrator, viewer, and anonymous checks,
including edits and clears; all fixture mutations were rolled back.
The subsequent OrderList Find repair merged as PR #283 at
`709450766d9ddf2e7944db1aaa916a188e3cac75` (reviewed source head
`9e4a005aba239253fd9ab2c7435b755a2cf9e37e`). Full CI run `37958015493`
passed 80 files / 496 tests plus one existing skip; the build passed. Frontend
publish run `37958305346` succeeded; at that release, production served build
token `7094507`, asset `index-U3ZqunIC.js`, bundle SHA-256
`9fd6875ad97cbc7cdf44e033a54d3d26b88532058a8c8a3fe6f55014a508ae8e`, image
digest `60d6eb3237d360f1fb90d8b7b5884ae8de92e6c1871c636d606772f766b6ace5`.
Historical pre-PR #284 administrator/viewer same-row acceptance passed 93
checks (47/46); report
`acceptance-report-7094507-attempt2.json` SHA-256
`0fccf979a10fc39fa61ea9cbb12eef45ac03c824388510518a4f0dd1b68dac73`. Find
passed for both roles: current at offset 0 and far rows at offsets 10,380 and
6,839 matched the exact RPC ID, bounded GET row, and visible grid row. Report
`orderlist-find-final-diagnostic-attempt6-7094507.json` SHA-256
`86b3cb643eb5740f7ae3c6e680b53d35d533c746a3d532f0407b4d0c01378977`.
Original controls passed for both roles; report
`existing-capabilities-attempt7-7094507.json` SHA-256
`0b87513183fa5435225623a76fcd00db99144b28af961f3d01c4b4c56752464d`.
Styles Find repair PR #284 merged at
`f02b9de2e60a317aaf5136c77957b1639b9274b1` (1:11 PM EDT); its exact-head GLM
review approved it (report
`glm-final-check-20261009T165439-2485646-28136.md`). CI run `37964251577` passed 81 files / 497 tests plus one
existing skip. Publish run `37964512337` succeeded at 1:15 PM EDT; that release
served token `f02b9de`, asset `assets/index-BGe0FYew.js` (SHA-256
`b48e4cafceb7113365782c2398707e029f2332ce5fe900ff349a2d4af6c9d2c6`), and image
digest `12b5c868d41aa25a8cfbab0f8e38e1037f2e0c519fd52911fd120063eb9dc87a`.
The administrator fixture capture passed; report `fixtures-f02b9de.json` has
SHA-256 `2e1f46649dfe71e95b75f1f6e296145b38b986411b14e40518383e60c5a1782a`.
The acceptance attempt at that point reached 88 of 93 checks before the viewer
License/Styles row timed out. Both roles hit PostgreSQL `57014` on the initial
normal GET for one of four ranges, leaving the grid blank; exact-ID Find reached
its target after loading. This was a failed historical attempt; the current
release proof is recorded below.

PR #285, the deployed-app/production-types proof workflow, merged at
`783f7357a1e407bc3a26859ddb82fa5561220f99` (1:33 PM EDT). Exact-head StepFun
APPROVE is recorded for source `c8f02dc44e8b27a058ec538e10bcd28f0f478110` in
`stepfun-final-check-20261009T172314-2599466-16163.md`. CI run `37966825066`
passed 497 tests plus one existing skip and 19 observer tests. The merged
`.github/workflows/orderlist-integration-live-proof.yml` has four existing-
account GitHub proof secrets configured via protected stdin; no accounts were
created. At that point in the release sequence the workflow had not yet run; its
later guarded result and current remaining actions are recorded below.

The exact auxiliary source SHA-256
`13bc64585bb5ec26e977fa948e6c59dfcf1b489e463fbe5e6151016ebd36fb4d` was loaded
once in a guarded transaction: 8,257 sample-depth rows, 38 customer suffixes,
and 3,147 tracking rows. A separate read-only production count check matched
those counts. The 71 held tracking exceptions and three duplicate tracking rows
remain excluded. A private identity-only comparison confirmed that all 12
normalized PO identities in #277's held conflicting-order set (79 source rows)
match 12 of the 71 auxiliary tracking holds; the other 59 holds stay excluded
separately. Issue #277 describes 12 conflicting orders and 58
malformed/incomplete rows; it does not own the other missing-reference holds.
No business-row identifiers are repeated here.

The native formula inventory was read from the live workbooks rather than
cached XLSX formula results. The implementation boundary is OrderList,
POTracking and its expanded ItemTracking details, SAMPLE lookup, customer suffix
lookup and the Master Data VendorStatistics import. Master Data OrderLog,
OrderSample and NotSoldIn are internal workbook helpers, not additional
cross-workbook connections. The authority rules belong in the companywide
[ERP orders and source meaning](https://github.com/popcre/shared-db/blob/main/docs/business-rules/erp-orders-and-source-meaning.md)
topic; this document records the DAM implementation and acceptance boundary.

The earlier `f901017` read, Find, loading/retry, screenshot and controls results are historical. Native runs `37978352705` and `37981872323` failed and produced no canonical artifacts; those failures are preserved. Native workflow `37987001226` passed on live `9883315`; its 90-check evidence and verified artifacts are summarized above. Shared-db #4111 and PopDAM #275 are closed; only #281 documentation closeout remains open.

Required serving behavior:

- Item Master supplies product description. Current Master Data supplies
  licensing progress, default/sample vendor, test report, professional photos
  and contractual-sample reorder. For a linked line, a named current Master
  Data field is authoritative even when its value is NULL: NULL displays as
  Unknown and never falls back to an older letter or import snapshot. Conflicting
  or unavailable workflow remains explicitly unknown. An unlinked line may show
  its frozen import snapshot, visibly labelled `at import`; snapshots are
  historical evidence, not current product truth. Item Master description is
  the live description source, with the separately labelled import description
  used only when no linked live description is available.
- POTracking supplies its manual header inputs and documents/payment facts;
  ItemTracking components inherit those header facts. Calculated case totals,
  forecasts, warehouse dates, delays, inspection/SVN and booking identifiers
  remain read-only. Assortment physical-parent quantities are counted once;
  unknown component quantities are never manufactured.
- Administrators can patch only the 24 declared manual PO tracking inputs:
  sent PO and vendor-delivery dates, booking state, ETD, ETA, container booking
  group, MBL, close-tracking flag, agent, CBM, comment, vessel, ColdLion/worksheet
  flags, inspection date/note, six document flags, wire request and payment
  note. Patches are closed-key, validated and dirty-only. Tracking pages are
  bounded to 50 headers; sample-depth and suffix settings, and vendor statistics,
  are bounded to 100 rows. Literal searches, visible errors, periodic/focus
  refetch and successful-save cross-screen refresh are part of the app behavior.
  Reads require sign-in; manual writes are administrator-only, including during
  impersonation.
- The three auxiliary application tables are `dam.orderlist_sample_depth`,
  `dam.orderlist_customer_settings` and `dam.order_tracking_ext`. They hold
  sample-depth settings, customer suffixes and PO tracking extensions; they are
  not canonical Item Master or Master Data. Current depth is keyed by normalized
  style/customer. A positive current value may be cleared to NULL; after a clear,
  the UI shows Unknown while retaining the raw imported value and provenance as
  history. Customer suffix is trimmed, required (1–50 characters), and cannot
  be cleared. Preserve explicit David/Contractual sample overrides.
- VendorStatistics returns purchase-header counts, closed/open counts, latest
  noncancelled sent-PO date and the native 14-month activity window to Master
  Data. ColdLion sales-history placeholders are excluded from purchase tracking.
  This is a read-only reverse summary, not a vendor editor.

The OrderList view preserves its original 78 leading columns and appends 12
read-only diagnostic fields: workflow source, Master Data sample vendor, current
sample depth, case error, assortment parent quantity/cases/key, imported sample
depth and source row, and the three imported test-report/photo/reorder snapshots.
These fields are hidden by default and are neither queryable nor editable through
the grid. Existing OrderList Find, filters, saved views and normal blue-input
edits remain separate from the integration diagnostics.

The loaded auxiliary-source payload contains 8,257 sample bindings, 38 customer
suffix settings and 3,147 exact-matched tracking records from the verified source
digest above. It deliberately excludes 71 held tracking exceptions and three
duplicate tracking rows after the first source match. A private identity-only
comparison confirmed that all 12 PO identities in #277's held conflicting-order
set match 12 of the 71 auxiliary tracking holds by normalized PO identity. Issue #277
describes 12 conflicting orders across 79 source rows and 58 malformed/incomplete
rows; Albert owns those business decisions. The other 59 auxiliary holds remain
excluded separately. The production load used empty destination tables and revalidated canonical PO
IDs/numbers, wrote the exact expected counts in one guarded transaction, and
created private recovery evidence. Canonical Item Master, Master Data rows and
existing PO dates were not seeded or overwritten.

Keep remaining exceptions separate: the owner recorded
`DSMT0MVAV01` → POP (Functional Wall) and `NTSTVSSSS01` → Spruce (Storage) on
[#275](https://github.com/u2giants/popdam3/issues/275#issuecomment-6088735709). The guarded application is committed and read-back verified: all 462 links are present, zero are ambiguous, the three decided rows have the expected divisions, item IDs and served descriptions, and the original 459-row preimage fingerprint is unchanged. The final #275 administrator/viewer proof passed 53 checks and is recorded in [#275 completion comment](https://github.com/u2giants/popdam3/issues/275#issuecomment-6089001259); #275 is closed. The current linked cohort has 23 ColdLion lines across 7 Items with workflow correctly Unknown where Master tracker facts are absent; no records were created.
Issue [#277](https://github.com/u2giants/popdam3/issues/277) holds business
decisions for 12 conflicting orders (79 source rows) and 58 malformed/incomplete
rows; its 12 order identities match 12 of the 71 auxiliary tracking holds. The
other 59 auxiliary holds remain excluded. No source rows are guessed or merged.

Backend application, catalog checks, preview rollback tests, and auxiliary
production load are complete. Prior release `f901017` results are historical.
Live `9883315` focused checks and native workflow `37987001226` passed; shared-db
#4111 is closed. Current follow-up is #281 documentation closeout. Keep #277's conflicting-order
and malformed-row choices separate.

Execution plan: [native Sheets integration](../plan_orderlist_sheets_full_integration.md), with current STATUS and its own session handoff.
