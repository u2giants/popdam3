# Master Data Style Tracker

This is the temporary standalone Master Data app at `https://master.designflow.app/styles`.
It mirrors the legacy Google Sheet style tracker while PLM is not yet fully hosted in the shared Supabase project.

## Current Runtime

- Route: `/styles`
- Page: `src/pages/StylesPage.tsx`
- Preview/live host used during this workstream: `master.designflow.app`
- Preview container: `popdam-master-preview`
- Local image tag: `popdam-master-preview:local`

The preview route is a manual/break-glass style deployment on the VPS, not the normal GHCR/Coolify frontend pipeline.
After editing the page, rebuild `dist/`, rebuild the preview image, recreate the `popdam-master-preview` container on the `coolify` Docker network, and smoke-test `https://master.designflow.app/styles`.

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

Rows are loaded newest-first. By default the browser loads only the latest 2,500 rows for speed; the user can choose **Show All**.

## Google Sheet Import Rules

The import script is `scripts/import-style-tracker-xlsx.py`.

The Google Sheet contains formula/default-only tail rows. Those are not real records. A populated row must contain at least one business field such as style/SKU, group, description, customer, designer, commissioned, UPC, licensor, status, vendor, or notes. Formula-only values such as `0`/`false` in trailing status columns must not cause import.

Verified populated counts from the 2026-07-20 authoritative replacement:

- `License.Style`: 12,400 rows
- `Generic.Style`: 3,133 rows
- Total: 15,533 rows

The replacement clears prior imported rows, audit history, and manual value
resolutions for these tabs in one transaction, inserts both tabs, and rebuilds
`plm.style_tracker_item_bridge`. Saved user views are preferences and are not
part of the imported workbook data, so they are preserved.

## UI Behavior

- Tabs:
  - Google Sheet `License.Style` maps to **Licensed**
  - Google Sheet `Generic.Style` maps to **Generic**
- Right-click a spreadsheet cell and open **Audit history** to see that cell's change history.
- `Print Fair Row#` is hidden by default.
- `Legacy BA#` is hidden by default.
- `Match` column is the row-level Master Data cross-reference status.
- `Sample Vendor` uses the active `core.factory` list as its cell picker in both Licensed and Generic tabs.
- `Originally Designed For` (Licensed) and `Special Customer` (Generic) are canonical Customer relationships. Their dropdown reads `api.dam_customer_list`, displays `display_name` with `name` as the fallback, and saves `public.style_tracker_rows.customer_id` (`core.customer.id`). Customer names are not copied on selection, so later renames do not break or stale the relationship. Legacy imported customer text remains only on rows that could not be backfilled unambiguously and disappears when a user selects a canonical Customer.
- `Packaging Type` appears in both Licensed and Generic tabs and uses the active `core.packaging_type` list as its cell picker. The selected display name is stored in each row's flexible `row_data.packaging_type` field; this does not duplicate or modify the shared lookup table.
- Double-clicking the `Description` cell opens the SKU-description builder. It still saves one string to `public.style_tracker_rows.description` / column `D`, but users compose that string from four visual sections:
  `Product Type + Material`, `Licensor + Property`, `Art Description`, and `Size`.
- The controlled description sections are picker/autocomplete driven. `Product Type + Material` reads `core.product_material` with local convention examples as a fallback; `Licensor + Property` reads `core.property` joined to `core.licensor` and displays values as `Licensor Property`; `Size` tries `core.product_size` when present, then existing DAM `style_groups.size_name`, then convention examples. `Art Description` is the only free-text section.
- A nonblank description must have approved values for Product Type + Material, Licensor + Property, and Size before the grid accepts the edit. This is intended to force spellings such as `Spider-Man`, `Coca-Cola`, and `Coir Doormat` through shared picker values instead of personal spelling variants.
- The `Row` button opens a menu for `+1`, `+5`, `+10`, `+25`.
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

## Canonical Source Decision

As of 2026-06-24, the user clarified that PLM APIs are canonical for:

- licensors
- properties
- customers

Do not treat arbitrary customer-looking strings as canonical Master Data customer
matches without PLM reconciliation. Canonical customers now live in
`core.customer`; confirmed PLM-backed customers have a `designflow_plm` source
ref in `core.company_source_ref` and `is_potential = false`.

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
Product Type + Material -> Licensor + Property -> Art Description -> Size
```

Examples:

- `Printed Glass Shadowbox Marvel Spider-Man Building Hopping 16x20" x1.2"`
- `PE Rattan 2-Tier Wall Shelf Disney Princess Floral Icons 12x16"`
- `Coir Doormat Coca-Cola Classic Logo 18x30"`

Picker sources:

- `core.product_material` is the canonical shared table for approved Product Type + Material display phrases such as `Printed Glass Shadowbox`, `Coir Doormat`, and `PE Rattan 2-Tier Wall Shelf`.
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

Verified during the 2026-06-24 session:

- `npm run build` passes after the current page reconstruction.
- `https://master.designflow.app/styles#` redirects to `/login` when unauthenticated and no longer white-screens.
- Preview container `popdam-master-preview` reached healthy state after redeploy.
- Playwright smoke checks showed no console errors on the unauthenticated route.

Verified during the 2026-06-26 core.customer cutover repair:

- `public.search_style_tracker_link_candidates('customer', 'Ross', 5, 'fuzzy')` on preview returned `target_schema = 'core'`, `target_table = 'customer'`, `target_label = 'Ross Stores'`.
- The stale prod `plm.style_tracker_value_resolution` row was migrated from `target_table = 'company'` to `target_table = 'customer'`.
- Prod Supabase type generation for `public,core,dam` succeeds and exposes `core.customer`.

## Follow-Ups

- Keep candidate matching constrained to PLM-backed source refs through `public.search_style_tracker_link_candidates(...)`.
- ✅ Per-user saved grid views are now implemented (see "View Customization" above); they persist to `public.style_tracker_user_views`. Formalize that table in `shared-db` before treating it as durable shared-schema infrastructure.
- Move the temporary Master Data tables/RPCs into a cleaner PLM bridge namespace or replace them when PLM lands in the shared Supabase project.
