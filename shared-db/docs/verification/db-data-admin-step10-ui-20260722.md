# DB Data Admin Step 10 UI verification — 2026-07-22

Step 10 adds the fully read-only Licensor → Property tree. It is the taxonomy
centerpiece of DB Data Admin and the first non-grid screen in the app.

GLM 5.2 implemented this step under Codex supervision. Preview verification found and GLM
corrected a PostgreSQL `max(uuid)` cursor incompatibility through additive migration
`20260722203100`; GLM also corrected a test-only JSONB key-existence call. The already-applied
`20260722203000` migration was never edited.

## What shipped

- **New migration** `supabase/migrations/20260722203000_db_data_admin_licensor_property_tree.sql`
  adds `api.db_data_admin_licensor_property_tree(text, boolean, text, integer)`. It is
  additive: the Step 6 `api.db_data_admin_licensor_property_list` is untouched. The new
  RPC is `SECURITY DEFINER` with a pinned `search_path`, fully qualified objects,
  `EXECUTE` revoked from `public`, granted only to `authenticated`, and gated by
  `app.require_db_data_admin_access()` (active administrator role AND an explicit,
  non-revoked `admin` app_access row). It returns only approved business fields, never
  raw source payloads.
- **New contract test** `supabase/tests/db_data_admin_licensor_property_tree.sql`
  (rollback-safe; derives every count from the live canonical tables in the same
  transaction — no timeless hard-coded production row counts).
- **React tree** `apps/db-data-admin/src/LicensorTree.tsx`, wired as a **Licensors**
  tab in `apps/db-data-admin/src/DataAdmin.tsx`, with data-layer types and
  `loadLicensorTree` in `apps/db-data-admin/src/lib/data-admin.ts`.
- **Unit test** `apps/db-data-admin/src/LicensorTree.test.tsx` and a **Playwright**
  capture in `apps/db-data-admin/tests/browser/grid.spec.ts`.

## How the relationship authority is honored

- The Licensor → Property **edge is read only from `core.property.licensor_id`**, the
  DesignFlow-owned canonical FK. It is **never** inferred from `mgTypeCode`, `mg_code`,
  or any globally unique code. The contract test proves this directly: a property whose
  PLM `mg_code` collides with a *different* licensor's code is still nested under the
  licensor named by its `core.property.licensor_id`.
- `mg_code` is unique only within `(division, mgTypeCode)`, so each source row is
  reported as division/type-qualified context (`plm_context` carries `division_code`,
  `mg_code`, an explicit `mg_type` label, and `mg_category`). A licensor with two source
  divisions surfaces both.
- v1 is **fully read-only**: there is no taxonomy editing, status change, reparenting,
  bulk action, or upstream-repair control anywhere on the screen.

## Loud anomalies and honest feeder status

- **Orphans are separate and loud.** Properties with a null `licensor_id` (structurally
  possible via `ON DELETE SET NULL`, expected count zero) are returned in a dedicated,
  always-complete `orphan_properties` collection and rendered in a prominent alert. The
  reconciliation summary exposes `orphan_property_count` and
  `expected_orphan_count_is_zero`.
- **No claim of live upstream reconciliation.** The snapshot reports observed mirror
  state only: `feeder_last_sync_at`, `feeder_last_run_status`, `feeder_days_stale`, and a
  conservative `feeder_available` flag derived from `ingest.sync_run`
  (`source_system = 'designflow_plm'`). That flag reports observed feeder recency only.
  `live_upstream_reconciliation` is always false because this function never queries or
  compares against the live DesignFlow upstream. The UI presents feeder recency separately
  and always states that live upstream reconciliation is not claimed.
- **Reconciliation is structural.** `licensor_count`, `property_count`,
  `properties_with_licensor`, and `orphan_property_count` are computed directly from
  `core.licensor` / `core.property`, independent of the paginated payload, and
  `partition_reconciles` asserts that parented + orphan = total.

## Local verification (run from `apps/db-data-admin/`)

- `bash scripts/check-sql.sh` (from repo root): **passed**.
- `npm run lint`: **passed**.
- `npm run build` (via `tsc --noEmit` + Vite): **passed**.
- `npm test`: **22 tests passed** across 8 files (the new `LicensorTree.test.tsx` adds 7).
- `npm run test:browser`: **5 Chromium tests passed**, including the new Step 10 tree
  capture.
- Visual evidence: `docs/verification/db-data-admin-step10-licensor-tree.png` shows the
  active Licensors tab, the reconciliation bar with counts and a dated snapshot, the
  feeder-unavailable notice, the loud orphan alert, and an expanded licensor (Marvel)
  with nested properties (Avengers, Spider-Man), status badges, and division/type
  source-context chips. No edit/reparent controls are present.

## What was not done

- The migration and contract test were **not applied to any database** (preview or
  production) and **no Supabase connection** was made. The SQL contract test is pending
  Codex's preview-first run of migration `20260722203000`.
- No existing migration, `AGENTS.md`, `HANDOFF.md`, `DB_Data_Admin.md`,
  `fix_impl_visual_admin_page.md`, or unrelated file was modified; historical screenshots
  were not overwritten (the Step 10 capture is a new file).
- Steps 11–13 (consumer enforcement, bulk operations, production delivery) are out of
  scope. Production remains untouched.
