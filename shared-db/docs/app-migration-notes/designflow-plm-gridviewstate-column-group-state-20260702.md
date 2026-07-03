# DesignFlow PLM — GridViewState.column_group_state — 2026-07-02

## App-owned additive column (recorded for schema-map completeness)

What changed:
The DesignFlow PLM app added a `column_group_state` column (JSONB, nullable) to
the app-owned `GridViewState` table. It stores AG Grid column-group open/closed
state as `[{ groupId, open }]`, persisted per saved view alongside the existing
`column_state` and `filter_model` columns.

This is **not** a shared-schema change and there is **no** shared-db SQL migration
for it. `GridViewState` (like its sibling PLM grid/view tables `GridLayout`,
`GridChildrenLayout`, `GridChildrenLayoutOrder`, `GridAccessLevel`, `GridCellNote`,
`viewlayout`) is app-owned and managed by the PLM backend's own Sequelize layer,
not by the canonical `core`/`plm` migrations here. The column is created by:

- Model field: `designflow-backend/models/db/GridViewState.js`
- Idempotent startup migration: `designflow-backend/models/db.js`
  (`ALTER TABLE "GridViewState" ADD COLUMN IF NOT EXISTS column_group_state JSONB`)
- Regression assertions: `designflow-backend/tests/unit/db.migration.test.js`

Why:
The RFQ grid now groups its 28 pricing columns into 8 collapsible AG Grid column
groups (Gen/Lic × FOB/POE/Whse/mDDP). AG Grid keeps column-group open/closed state
in a structure separate from column state, so persisting each user's collapse
choice in their saved view required this additive column. Per the workspace
`SUPABASE-MIGRATION.md` Decision Principle, changes to existing DesignFlow
functionality on an app-owned table stay in the backend service as an idempotent,
additive, non-destructive startup migration — which this is.

Why it's recorded here:
`docs/unified-supabase-migration-gaps.md` lists "Generate column-level inventories
for PopDAM tables and PLM Sequelize models" as pending. Until that inventory
exists, app-owned column additions like this one are noted here so the canonical
schema record stays complete. See the PLM grid/view/admin row in
`docs/unified-supabase-schema-map.md`.

Future sessions should:
Keep this column app-owned. If a future phase brings PLM Sequelize models under
canonical shared-db migrations, fold `GridViewState.column_group_state` into that
inventory rather than authoring a standalone `ALTER` migration against a table the
canonical `core`/`plm` schema does not otherwise manage.

Affected apps:
DesignFlow PLM only (frontend `designflow-frontend`, backend `designflow-backend`;
`designflow-bff` is a transparent pass-through — no change). Not read by CRM, DAM,
PM/PIM, or Directus. The `saveGridViewState`/`getGridViewState` API contract gained
an optional `column_group_state` field, but that contract is PLM-internal
(frontend → bff → backend).

Where the durable implementation lives:
- Model: `designflow-backend/models/db/GridViewState.js` (`column_group_state` JSONB).
- Startup migration: `designflow-backend/models/db.js`
  (`ALTER TABLE "GridViewState" ADD COLUMN IF NOT EXISTS column_group_state JSONB`).
- Save/restore: `designflow-backend/models/lib.model.js`
  (`saveGridViewState`/`getGridViewState`); frontend `rfq.component.ts`
  (`saveRfqViewState`, `applyGridViewStateForViewName`) + `rfq-column-groups.ts`.
- Tests: `designflow-backend/tests/unit/db.migration.test.js`;
  `designflow-frontend/.../rfq-column-groups.spec.ts`, `rfq.component.spec.ts`.

What was verified:
App-side unit tests pass (backend `db.migration` 89/89; frontend transform 12/12,
`rfq.component` 58/58). NOT verified against a Supabase preview branch or with
`supabase db push --dry-run` — this is an app-owned, additive, idempotent startup
migration that applies on the next `designflow-backend` deploy, not a canonical
`core`/`plm` migration, so the shared-db preview/promote gate does not apply.

Risks / watchouts:
Additive + nullable → no read/write break for any app (safe to deploy or roll back;
rollback is simply not writing the column). The column exists only once the updated
`designflow-backend` deploys and its startup migration runs. Not reflected in a
`supabase/migrations/*.sql` file by design; the canonical column-level record waits
on the PLM Sequelize inventory in `unified-supabase-migration-gaps.md`.
