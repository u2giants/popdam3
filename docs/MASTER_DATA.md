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

Verified populated counts from the 2026-06-24 import:

- `License.Style`: 12,317 rows
- `Generic.Style`: 3,027 rows
- Total: 15,344 rows

## UI Behavior

- Tabs:
  - Google Sheet `License.Style` maps to **Licensed**
  - Google Sheet `Generic.Style` maps to **Generic**
- **History** opens the user-visible audit log for recent row additions, cell edits, and Master Data match decisions.
- `Print Fair Row#` is hidden by default.
- `Legacy BA#` is hidden by default.
- `Match` column is the row-level Master Data cross-reference status.
- The `Row` button opens a menu for `+1`, `+5`, `+10`, `+25`.
- AG Grid Enterprise is installed without a license key for now, matching the PLM-style trial setup. Keep AG Grid packages pinned to the same exact version; a previous `35.3.1` Enterprise + `35.1.0` Community/React mismatch caused a blank page before React mounted.

## Matching Workflow

The **Master Data matching** panel is admin-only.

Plain English:

- The left dropdown is built from imported Google Sheet values in the currently loaded Master Data rows.
- The candidate box next to it is built from `public.search_style_tracker_link_candidates(...)`.
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
- Restore/finish per-user saved grid views if the simplified page source is kept; the database table exists but the current recreated page only exposes the AG Grid columns panel.
- Move the temporary Master Data tables/RPCs into a cleaner PLM bridge namespace or replace them when PLM lands in the shared Supabase project.
