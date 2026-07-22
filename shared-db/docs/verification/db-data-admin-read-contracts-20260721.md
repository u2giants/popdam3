# DB Data Admin Step 6 — per-app serving and administrator read contracts

Date: 2026-07-21
Specification: [`../../DB_Data_Admin.md`](../../DB_Data_Admin.md) (Delivery Step 6)
Inventory: [`../db-data-admin-inventory.md`](../db-data-admin-inventory.md)
Foundation evidence: [`db-data-admin-foundation-20260722.md`](db-data-admin-foundation-20260722.md)
Merge-coverage evidence: [`db-data-admin-merge-coverage-20260722.md`](db-data-admin-merge-coverage-20260722.md)

Status: **applied and verified on preview; production is untouched.** The full
authorization matrix, filter/sort/cursor/page-size behavior, app-serving views,
and all earlier DB Data Admin regressions passed on preview.

## What was added

| File | Creates |
|---|---|
| `supabase/migrations/20260722005000_db_data_admin_read_contracts.sql` | `app.require_db_data_admin_access()` private gate; `api.db_data_admin_channel_list()`, `api.db_data_admin_customer_list(...)`, `api.db_data_admin_vendor_list(...)`, `api.db_data_admin_licensor_property_list(...)`, `api.db_data_admin_audit_list(...)`, `api.db_data_admin_grid_state_get(...)`, `api.db_data_admin_grid_state_upsert(...)` |
| `supabase/migrations/20260722005100_app_serving_status_contracts.sql` | Additive `security_invoker` serving views: `api.crm_customer_picker_list`, `api.pm_customer_list`, `api.crm_factory_picker_list`, `api.pm_factory_list`, `api.dam_factory_list` |
| `supabase/migrations/20260722005200_fix_db_data_admin_uuid_cursor_aggregates.sql` | Corrective replacement of four list functions so page-boundary UUIDs are selected through a supported text aggregate and cast back to UUID |
| `supabase/tests/db_data_admin_read_contracts.sql` | Rollback-safe authorization-matrix and read-contract proof |
| `supabase/tests/app_serving_status_contracts.sql` | Rollback-safe per-app effective-visibility proof as real authenticated users |

Both migrations sort after the Step 4/5 batch (`20260722002500`–`20260722004500`)
and are purely additive: no existing object is altered, replaced, or dropped.
`api.crm_customer_list`, `api.crm_account_list`, and `api.dam_customer_list`
keep their current definitions and grants.

## Authorization model

Every `api.db_data_admin_*` function is `SECURITY DEFINER` with a pinned
`search_path`, fully qualified objects, `EXECUTE` revoked from `public`, and
granted only to `authenticated` — the `api.crm_admin_user_list()` precedent.
The first statement of every function is `app.require_db_data_admin_access()`,
which requires **both**:

- `app.has_role('administrator')`, and
- `app.has_explicit_app_access('admin')` — a non-revoked `app.app_access`
  row with no administrator short-circuit.

The gate helper itself stays private (no `public`/`authenticated` execute).
The `admin` label already exists in the `app.app_name` enum; no enum change
was needed. Browser callers receive no cross-schema privilege, and the
`core.channel` / `core.customer_channel` tables keep their no-browser-grant
protection from `20260722003500` — `api.db_data_admin_channel_list()` is their
protected serving path.

Matrix proven by `supabase/tests/db_data_admin_read_contracts.sql` with four
existing active preview identities whose roles and grants are normalized inside
the rollback-only transaction. This respects the invitation-only Auth trigger:

| Identity | Expected | Proven against |
|---|---|---|
| Administrator + explicit non-revoked `admin` grant | allowed | all seven functions |
| Administrator **without** explicit grant | denied `insufficient_privilege` | all seven functions |
| Non-administrator with explicit grant | denied `insufficient_privilege` | all seven functions |
| Administrator with revoked grant | denied, then allowed after un-revoke | customer list |
| `public` | no EXECUTE | static privilege check on all seven |
| `authenticated` | EXECUTE granted | static privilege check on all seven |

## List-contract parameters (proven in the test)

All list functions accept filter, sort, cursor/page-size, and
inactive-inclusion parameters from this first version:

- `p_search` (name/display_name ILIKE), `p_status` (whitelisted global
  status), `p_app` + `p_app_status` (per-app effective status),
  `p_include_inactive` (default false → global active/potential only).
- `p_sort` whitelist (`name`, `display_name`, `status`, `updated_at`) and
  `p_sort_dir` (`asc`/`desc`); sort columns are whitelisted, never
  interpolated.
- Opaque base64 keyset cursor over `(sort_value, id)`; page size clamped
  1–200 (default 50). The test pages 5 fixture rows at size 2 through
  3 pages and proves no loss, no duplication, and termination.
- Invalid sort/status/cursor/app-filter combinations raise
  `invalid_parameter_value` (fail closed).

Row shapes expose only approved business fields. Vendor source refs never
expose `source_name` (`core.factory_source_ref` has no such column); identity
is `source_system`/`source_table`/`source_id`/`source_code`.

## PLM single-writer decision (read side)

Per the Step 1 inventory decision, PLM application status is owned by
DesignFlow Cloud SQL; Supabase never gets a competing editable
`plm.*_ext.status`. Step 6 implements the **read side** only:

- Customer rows expose `plm_linked` (a `designflow_plm` source ref exists)
  and `plm_status` (the mirrored `plm.customer_import.status`, latest row).
  The `plm` app filter matches only linked Customers (`ACTIVE` mirror →
  active; linked non-ACTIVE → inactive; unlinked matches neither).
- Vendor rows expose `plm_linked` from `core.factory_source_ref` and keep
  `plm_status` null. `p_app => 'plm'` on the vendor list is rejected with
  `invalid_parameter_value` until the reviewed DesignFlow Factory export and
  one-time match populate `designflow_plm/Factory/<id>` refs.

The protected PLM write path and the mirror-back sync extension remain later
steps / DesignFlow-side work (Uma's sandbox-to-`develop` workflow).

## Per-app serving views

Each view follows the verified `api.dam_customer_list` pattern
(`20260721143000`): `with (security_invoker = true)`, core table LEFT JOIN
only that app's extension row, effective-visibility WHERE clause (global
active/potential AND `coalesce(ext.status, 'active') = 'active'`), granted to
`authenticated`. `supabase/tests/app_serving_status_contracts.sql` proves the
enforcement as real authenticated CRM/PM/DAM users (`SET LOCAL role
authenticated` + JWT sub fixtures): per-app-inactive fixture rows disappear
from that app's picker, globally inactive rows never appear, and visible rows
report the correct per-app status.

Consumer pickers move to these contracts during the Step 11 enforcement pass;
until then the views add capability without changing current behavior.

## Verification completed

1. `bash scripts/check-sql.sh` passed.
2. The initial preview dry-run listed exactly `20260722005000` and
   `20260722005100`; both applied successfully.
3. Runtime testing exposed PostgreSQL's lack of `max(uuid)`. Applied history
   was preserved and corrective migration `20260722005200` replaced only the
   four affected list definitions.
4. `supabase/tests/db_data_admin_read_contracts.sql` passed, including denial
   of an administrator without explicit `admin` access and proof of filtering,
   sorting, cursor pagination, audit reads, and owner-scoped grid state.
5. `supabase/tests/app_serving_status_contracts.sql` passed using real
   authenticated preview identities and the baseline viewer role required by
   the underlying security-invoker/RLS chain.
6. The Step 4 foundation/extension suites and Step 5 merge-coverage suite all
   passed again.
7. Final preview dry-run reports `Remote database is up to date.`
8. Dated preview counts: Customers 859 (140 active, 12 potential, 707 inactive);
   Vendors 510 (91 active, 419 inactive); Licensors 20; Properties 256;
   orphan Properties 0; non-revoked explicit `admin` grants 0.

## Reproduction runbook

Preview project `rjyboqwcdzcocqgmsyel` (Supabase branch
`shared-db-schema-rehearsal`). Credentials: 1Password `vibe_coding` vault,
items `Supabase CLI Personal Access Token` and
`Supabase Preview Branch Credentials - shared POP database
(shared-db-schema-rehearsal)`. Never commit or print secret values.

1. Repeat the AGENTS.md §6 in-flight check (`gh pr list`, branches,
   `git status --short`, `ls supabase/migrations`) and confirm this tranche
   is the only schema change in flight.
2. `supabase login --token "$SUPABASE_ACCESS_TOKEN"`, then
   `supabase link --project-ref rjyboqwcdzcocqgmsyel --password "$PREVIEW_DB_PASSWORD"`.
3. On an unapplied rehearsal database, `supabase db push --dry-run` must list
   `20260722005000_db_data_admin_read_contracts.sql` and
   `20260722005100_app_serving_status_contracts.sql`, followed by corrective
   migration `20260722005200_fix_db_data_admin_uuid_cursor_aggregates.sql`,
   with no surprise drops/renames.
4. Apply to preview: `supabase db push`.
5. Run both contract tests against preview (each wraps its fixtures in
   `begin; ... rollback;`, so nothing persists). `psql` is not installed on
   the Windows dev machines — use the documented Node `pg` path against the
   preview pooler, or any available `psql`:
   - `supabase/tests/db_data_admin_read_contracts.sql`
   - `supabase/tests/app_serving_status_contracts.sql`
   Both must complete without raising; any `raise exception` fails the gate.
6. Re-run the dated baseline counts and compare them with the verified preview
   figures in the section above.
7. Final `supabase db push --dry-run` must be empty before merge.

## Production gating

Do **not** promote these migrations to production in this tranche. Production
promotion waits for the approved window and the Step 11 consumer-enforcement
gate, and no production identity may receive an `admin` app-access grant
until the owner approves the grantee list (production currently has zero
non-revoked `admin` grants).

## Next step

Step 7: read-only Customer and Vendor RevoGrids in `apps/db-data-admin/`
consuming `api.db_data_admin_customer_list` / `api.db_data_admin_vendor_list`
with the custom persistent header filters, saved grid state through
`api.db_data_admin_grid_state_get/upsert`, and the visual/keyboard/
accessibility/virtualization gates.
