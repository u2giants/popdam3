# DesignFlow PLM — GridViewState.column_group_state — 2026-07-02

## Historical app-owned additive column (superseded workflow)

2026-07-10 update:
This note records what happened historically, but it must not be used as a
template for new DesignFlow database changes. The current rule is that
`u2giants/shared-db` is the gatekeeper for every shared Supabase schema change,
including DesignFlow PLM tables that still appear in app repos as Sequelize
models or legacy inline startup migrations. Future schema changes belong in a
new timestamped migration under `shared-db/supabase/migrations/`, with preview
testing before production. App repos should only receive the matching app code,
model/type/query/test/doc updates after the shared migration exists.

Why this note changed:
Another AI session correctly identified a contradiction: DesignFlow app docs and
the existing `models/db.js` inline migrations taught agents to keep adding local
startup migrations, while `shared-db` expected to be the canonical gatekeeper.
On 2026-07-10, all six `popcre/designflow-*` repos were updated with a checked-in
Cursor rule at `.cursor/rules/shared-db-gatekeeper.mdc`, and frontend/item-master
agent docs were updated so agents see the shared-db rule near the top. If that
Cursor rule changes in one DesignFlow repo, the same change must be made to the
other five repos in the same session and all six must be committed/pushed
together.

What changed:
The DesignFlow PLM app added a `column_group_state` column (JSONB, nullable) to
the app-owned `GridViewState` table. It stores AG Grid column-group open/closed
state as `[{ groupId, open }]`, persisted per saved view alongside the existing
`column_state` and `filter_model` columns.

This was originally treated as **not** a shared-schema change and there is **no**
shared-db SQL migration for it. `GridViewState` (like its sibling PLM grid/view
tables `GridLayout`, `GridChildrenLayout`, `GridChildrenLayoutOrder`,
`GridAccessLevel`, `GridCellNote`, `viewlayout`) was managed by the PLM backend's
own Sequelize layer instead of by canonical migrations here. The column was
created by:

- Model field: `designflow-backend/models/db/GridViewState.js`
- Idempotent startup migration: `designflow-backend/models/db.js`
  (`ALTER TABLE "GridViewState" ADD COLUMN IF NOT EXISTS column_group_state JSONB`)
- Regression assertions: `designflow-backend/tests/unit/db.migration.test.js`

Why it was added:
The RFQ grid now groups its 28 pricing columns into 8 collapsible AG Grid column
groups (Gen/Lic × FOB/POE/Whse/mDDP). AG Grid keeps column-group open/closed state
in a structure separate from column state, so persisting each user's collapse
choice in their saved view required this additive column. The old reasoning was
that an app-owned table could be changed through an idempotent backend startup
migration. That reasoning is now superseded for future work because it created a
conflicting instruction at the exact place an agent acts.

Why it's recorded here:
`docs/unified-supabase-migration-gaps.md` lists "Generate column-level inventories
for PopDAM tables and PLM Sequelize models" as pending. Until that inventory
exists, app-owned column additions like this one are noted here so the canonical
schema record stays complete. See the PLM grid/view/admin row in
`docs/unified-supabase-schema-map.md`.

Future sessions should:
Leave this historical column alone unless there is a deliberate repair/migration
task. For any new DesignFlow schema change, do not copy this inline-migration
pattern. Start in `shared-db`, create a new timestamped migration, run the shared
preview/prod protocol, then update app code in the affected consumer repos.

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

What was verified at the time:
App-side unit tests pass (backend `db.migration` 89/89; frontend transform 12/12,
`rfq.component` 58/58). NOT verified against a Supabase preview branch or with
`supabase db push --dry-run` — this is an app-owned, additive, idempotent startup
migration that applies on the next `designflow-backend` deploy, not a canonical
`core`/`plm` migration. That lack of preview-gate verification is precisely why
future schema changes should go through `shared-db`.

Risks / watchouts:
Additive + nullable → no read/write break for any app (safe to deploy or roll back;
rollback is simply not writing the column). The column exists only once the updated
`designflow-backend` deploys and its startup migration runs. Not reflected in a
`supabase/migrations/*.sql` file because of the historical workflow; do not repeat
that workflow for new schema changes.
