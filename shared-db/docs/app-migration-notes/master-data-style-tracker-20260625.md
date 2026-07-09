# Master Data Style Tracker PLM Candidate Search — 2026-06-25

This note records the shared-db contract used by the temporary Master Data style tracker in `u2giants/popdam3`.

## Contract

The PopDAM Master Data page calls:

```sql
public.search_style_tracker_link_candidates(
  p_field_key text,
  p_query text,
  p_limit integer,
  p_match_mode text
)
```

The return shape is kept stable for the existing frontend:

```text
target_schema text
target_table text
target_id uuid
target_label text
score real
```

## PLM Canonical Rule

Customer, licensor, and property candidates must come from PLM-backed canonical identities:

- customers: `core.customer` joined through `core.company_source_ref` with `source_system = 'designflow_plm'` and `source_table = 'customers'`
- licensors/properties: `core.licensor` / `core.property` joined through `core.taxonomy_source_ref` with `source_system = 'designflow_plm'` and `source_table = 'merchGroup'`

This prevents noisy non-PLM imports from appearing as canonical Master Data matches.

## 2026-06-26 core.customer Cutover Repair

What changed:
After `core.company` was hard-renamed to `core.customer`, migration
`20260626170000_fix_core_customer_leftovers.sql` reasserted the app-facing
contracts that still had old-name leftovers. It recreates `api.global_search`
against `core.customer`, refreshes the relevant PLM/Master Data functions without
`from core.company`, and rewrites any persisted Master Data resolution target
from `target_table = 'company'` to `target_table = 'customer'`.

Why:
Prod type generation for app schemas failed while live schema objects still
resolved the removed table name, and one persisted Master Data resolution row
still pointed at `core.company`.

Affected apps:
PopDAM / Master Data directly. Other shared-db consumers benefit from
`api.global_search` no longer exposing a removed source table.

Verified:
`scripts/check-sql.sh`; Supabase dry-run + apply on preview
`xjcyeuvzkhtzsheknaiu`; Supabase dry-run + apply on prod
`qsllyeztdwjgirsysgai`; prod type generation for `public,core,dam`; and the
stored resolution row now groups under `core/customer`.

## Browser Boundary

The browser should continue using the RPC. It must not call the Designflow PLM APIs directly and must not receive the PLM API key. If the frontend needs a broader direct-read contract later, add an `api.*` view or RPC here first.

## SKU Description Pickers

The PopDAM Master Data page's `Description` cell uses a structured builder for
the SKU naming convention:

```text
Product Type + Material -> Licensor + Property -> Art Description -> Size
```

Shared picker contract:

- `core.product_material` is the canonical table for the first segment,
  Product Type + Material. It stores approved display phrases such as
  `Printed Glass Shadowbox`, `Coir Doormat`, and `PE Rattan 2-Tier Wall Shelf`.
  This table is intentionally separate from PLM MG01 `core.product_type`: it is
  the exact user-facing description phrase, optionally linked back to
  `core.product_type` / `core.product_subtype`.
- `core.property` remains the browser-facing property picker source. The app
  joins to `core.licensor` through `core.property.licensor_id` and displays
  options as `Licensor Property`, so users browse/select the property while the
  resulting description includes the licensor prefix automatically.
- `core.product_size` is the intended shared size picker once MG04 is migrated.
  Until then, PopDAM may fall back to existing DAM `style_groups.size_name`
  values and convention examples.

Migration `20260708201000_core_product_material.sql` adds
`core.product_material`, shared read/admin-write RLS, service-role grants, the
`app.set_updated_at()` trigger, and initial convention seed values.

## Audit Log

Migration `20260708183000_masterdata_audit_log.sql` adds `public.style_tracker_audit_log`
and `public.style_tracker_audit_log_with_user` for the Master Data page's
History panel. The log records row additions, spreadsheet cell edits detected
from `style_tracker_rows.row_data`, and manual value-resolution decisions made
through `public.upsert_style_tracker_value_resolution(...)`.

The migration is guarded because the shared-db preview branch does not currently
contain the temporary `public.style_tracker_rows` objects. On databases without
those objects it emits a skip notice; on production, where Master Data exists,
it creates the table, trigger, view, and updated resolution RPC.
