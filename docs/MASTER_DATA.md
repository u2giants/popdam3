# Master Data Style Tracker

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
Pagination still defaults to 500 visible rows. **Show All** sits beside the
bottom pagination controls and expands the current filtered result set; it does
not change which rows are searched or filtered.

## Google Sheet Import Rules

The import script is `scripts/import-style-tracker-xlsx.py`.

The Google Sheet contains formula/default-only tail rows. Those are not real records. A populated row must contain at least one business field such as style/SKU, group, description, customer, designer, commissioned, UPC, licensor, status, vendor, or notes. Formula-only values such as `0`/`false` in trailing status columns must not cause import.

Verified populated counts from the 2026-08-06 go-live replacement:

- `License.Style`: 12,439 rows
- `Generic.Style`: 3,174 rows
- Total: 15,613 rows

The replacement clears prior imported rows, audit history, and manual value
resolutions for these tabs in one transaction, inserts both tabs, and rebuilds
`plm.style_tracker_item_bridge`. Saved user views are preferences and are not
part of the imported workbook data, so they are preserved.

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
- Grid pagination defaults to 500 rows per page, with 1,000 and 1,500 row options.
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

Do not add browser-side PLM calls for these pickers. Add or update shared picker tables/RPCs in `u2giants/shared-db`, then consume them from the Master Data page.

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
