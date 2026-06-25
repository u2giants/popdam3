# Master Data Style Tracker — App Migration Note (2026-06-24)

This note records the temporary Master Data / style tracker work performed from the PopDAM repo while PLM is not yet fully transferred into the shared Supabase project.

## Product Need

The business had a Google Sheet tracking style/SKU data. The sheet was disconnected from PopDAM, PM/PIM, DesignFlow/PLM, ERP, and CRM data. A temporary standalone app at `https://master.designflow.app/styles` now mirrors the sheet into Supabase-backed tables so values can be cross-referenced while the final PLM-backed implementation is pending.

## Affected Apps

- PopDAM frontend repo: `/worksp/popdam`
- Temporary Master Data app: `master.designflow.app/styles`
- Shared Supabase project: `qsllyeztdwjgirsysgai`
- Future canonical source: DesignFlow PLM APIs

## Backend Objects Added / Used

The following objects were added/applied from the PopDAM repo during the session:

- `public.style_tracker_rows`
- `public.style_tracker_rows_with_bridge`
- `plm.style_tracker_item_bridge`
- `plm.style_tracker_value_resolution`
- `public.style_tracker_user_views`
- `public.add_style_tracker_rows(p_source_sheet, p_tracker_type, p_count)`
- `public.refresh_style_tracker_item_bridge()`
- `public.search_style_tracker_link_candidates(p_field_key, p_query, p_limit, p_match_mode)`
- `public.upsert_style_tracker_value_resolution(...)`

PopDAM migration filenames used locally:

- `20260623203334_add_style_tracker_rows.sql`
- `20260624131309_add_style_tracker_plm_bridge.sql`
- `20260624142251_add_style_tracker_fuzzy_resolutions.sql`
- `20260624151703_fix_style_tracker_manual_matching.sql`
- `20260624174748_style_tracker_add_rows_and_cleanup.sql`
- `20260624190000_add_style_tracker_user_views.sql`
- `20260624191000_tighten_style_tracker_candidate_matching.sql`

Some of these were applied manually to live Supabase during rapid preview work, and the live Supabase migration ledger did not contain the recent style-tracker versions at the time checked. Treat this as a preview/temporary bridge until the objects are formalized in the shared-db migration chain.

## Import Rules

Google Sheet source tabs:

- `License.Style` -> app tab **Licensed**
- `Generic.Style` -> app tab **Generic**

Formula/default-only tail rows from the Google Sheet are not real records. Import logic must require at least one meaningful business field such as style/SKU, group, description, customer, designer, commissioned date, UPC, licensor, workflow/status fields, vendor, or notes.

Verified populated counts from the 2026-06-24 import:

- `License.Style`: 12,317 rows
- `Generic.Style`: 3,027 rows
- Total: 15,344 rows

## Matching Semantics

The Master Data matching panel has two user actions:

- **Approve: X** -> save a canonical resolution to a shared/canonical target.
- **Dismiss: Keep In Master Data** -> save the raw sheet value as valid for the temporary Master Data tracker only. It does not create or update a canonical shared table row.

Rows with a matching `manual_resolution.field_key` should be excluded from the review dropdown after refresh.

## Canonical Source Decision

On 2026-06-24 the user clarified that PLM APIs are canonical for:

- licensors
- properties
- customers

Do not treat `core.company` as canonical for this Master Data workflow unless reconciled to PLM. `core.company` contains imported Directus/Twenty/CRM-ish data and may surface secondary/noisy values. Example verified in live DB: `Rossy` is present in `core.company`, sourced from:

- `source_system`: `directus`
- `source_table`: `ingested_domains`
- `external_source`: `twenty`
- `customer_status`: `OTHER`

The PLM API credential is stored in 1Password item `DesignFlow PLM Canonical Master Data API`; do not document or hard-code the key.

Endpoints:

- Licensors/properties: `GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties`
- Customers: `GET https://api.designflow.app/api/core/customers/getCustomers`
- Auth header: `x-api-key`

Use these endpoints from server-side code only, or sync/cache PLM canonical values into Supabase lookup tables with clear source provenance.

## Verification

Verified during the 2026-06-24 session:

- PopDAM frontend `npm run build` passed after adding/reconstructing the page.
- Manual preview container deploy served `https://master.designflow.app/styles`.
- Unauthenticated Playwright smoke test redirected `/styles#` to `/login`, confirming route mount rather than 404/white screen.
- Container `popdam-master-preview` became healthy after deploy.
- Candidate search for `Customer: Ross` returned both `Ross Stores` and `Rossy` from `core.company`, proving the need to switch customer candidates to PLM canonical data.

## Follow-Up / Risk

- Formalize the style tracker objects into the shared-db migration chain if they remain beyond preview.
- Replace `core.company` candidate matching with PLM canonical customer data.
- Replace licensor/property matching with PLM canonical licensor/property data.
- Keep the tracker from writing new values into shared canonical tables. Local-only values belong in Master Data resolution tables until PLM owns them.
