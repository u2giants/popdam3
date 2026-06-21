# PM/PIM Directus To Shared Supabase Backend Migration Plan

This document is a standalone execution plan for migrating `u2giants/poppim-web`
from the current Directus backend to the shared enterprise-wide Supabase.com
database.

It is written for a fresh AI/developer session with no prior context. Read it
from top to bottom before making changes.

## 0. Critical Strategy Summary

The target is **not** a PM-specific Supabase project.

The target is one shared enterprise Supabase project for DAM, CRM, PM/PIM, and
PLM. PM/PIM is a consumer of the shared schema. Shared database DDL belongs in
the shared database repo, not in this frontend repo.

### Production Supabase Project

```text
Project ref: qsllyeztdwjgirsysgai
URL: https://qsllyeztdwjgirsysgai.supabase.co
Purpose: live PopDAM project and future shared enterprise database
```

### Preview Branch For PM/CRM Rewrite Work

```text
Project ref: tcscehehgeiijilylezv
URL: https://tcscehehgeiijilylezv.supabase.co
Branch name: shared-db-schema-rehearsal
Parent project ref: qsllyeztdwjgirsysgai
Persistent: yes
Created with data: yes
```

### Deprecated / Do Not Use As PM Backend

```text
Project ref: wqgffwbhepkzldzpahbf
```

That older project-specific strategy has been superseded. Do not implement PM
against `wqgffwbhepkzldzpahbf`.

## 1. Required Reading

This plan lives in the canonical `u2giants/shared-db` repo. Read the companion
docs alongside it (paths are relative to this file):

- Shared DB README: [README.md](../../README.md)
- Shared database vision: [shared-database-vision.md](../shared-database-vision.md)
- Unified schema map: [unified-supabase-schema-map.md](../unified-supabase-schema-map.md)
- Cross-domain relationship map: [unified-supabase-relationships.md](../unified-supabase-relationships.md)
- Migration gaps and risks: [unified-supabase-migration-gaps.md](../unified-supabase-migration-gaps.md)
- Supabase migration prep: [supabase-migration-prep.md](../supabase-migration-prep.md)
- Schema implementation notes: [implementation/schema-implementation-notes.md](../implementation/schema-implementation-notes.md)
- Shared Supabase branch workflow: [shared-supabase-branch-workflow.md](shared-supabase-branch-workflow.md)
- PM/PIM session instructions (condensed): [poppim-web-supabase-migration.md](poppim-web-supabase-migration.md)
- Preview branch verification: [verification/preview-branch-20260621.md](../verification/preview-branch-20260621.md)
- Shared DB migration SQL: [supabase/migrations](../../supabase/migrations)

Important: mirrored `shared-db/` folders inside consumer app repos (e.g.
`poppim-web/shared-db/`) are read-only copies. Edit this canonical
`u2giants/shared-db` repo, not the synced copy inside an app repo.

## 2. Current System Summary

`poppim-web` is a React/Vite PM/PIM frontend currently backed by Directus at:

```text
https://data.designflow.app
```

The current app:

- stores no data locally;
- uses `@directus/sdk`;
- authenticates through Directus session cookies and Microsoft SSO;
- reads/writes Directus collections for products, projects, designs, workflow,
  saved views, comments, files, users, roles, and reference data;
- relies on Directus as the API, auth, permissions, comments, and metadata
  layer.

Current key frontend files:

| Area | File |
|---|---|
| Directus client | `src/lib/directus.ts` |
| Directus-shaped types | `src/lib/types.ts` |
| Auth provider | `src/auth/auth.tsx` |
| Product pipeline API | `src/features/pipeline/api.ts` |
| Product collaboration/detail API | `src/features/board/collab.ts` |
| Workflow API | `src/features/workflow/api.ts` |
| Saved views API | `src/features/views/api.ts` |
| Product rollups | `src/domain/products/rollups.ts` |
| Product adapters/presentation | `src/domain/products/*` |

Do not remove the Directus path until Supabase preview parity is proven.

## 3. Shared Supabase Architecture

The shared enterprise database uses logical Postgres schemas:

| Schema | Purpose |
|---|---|
| `app` | profiles, roles, app access, comments, activity, notifications, generic files |
| `core` | canonical shared business objects: companies, contacts, licensors, properties, characters, factories, taxonomy, SKU refs |
| `dam` | DAM assets, style groups, style guides, processing/helper state |
| `pim` | PM/PIM products, projects, designs, workflow, orders, assignments, saved views |
| `crm` | CRM departments, opportunities, email/meeting workflow, notes, tasks, approvals |
| `plm` | item master, production orders, licensing, RFQ, ERP/operational data |
| `ingest` | raw imports, snapshots, dedupe candidates, source records |
| `api` | stable browser-facing views and RPC contracts |

Core design rule:

- shared identity/reference objects live in `core`;
- PM workflow records live in `pim`;
- shared app support records live in `app`;
- frontend-facing joined shapes live in `api`;
- raw imports and dedupe records live in `ingest`;
- PLM operational records live in `plm`;
- DAM files/assets stay first-class in `dam`.

## 4. Existing Shared-DB Baseline

The shared-db repo already contains baseline migrations:

```text
20260621000100_foundation.sql
20260621000200_app_core.sql
20260621000300_domain_tables.sql
20260621000400_api_rls_realtime.sql
```

Per the shared-db verification docs, those migrations have been applied to the
preview branch only:

```text
Preview project ref: tcscehehgeiijilylezv
```

They have **not** been applied to production/default project
`qsllyeztdwjgirsysgai`.

Verified preview baseline:

```text
8 logical schemas
85 tables
6 API views
153 RLS policies
```

Verified key objects include:

```text
app.profile
core.company
dam.asset
pim.product
crm.opportunity
plm.item
api.pm_product_board
api.global_search
```

Existing useful PM-facing API views:

```text
api.pm_product_board
api.pm_product_assets
api.plm_item_status
api.global_search
```

Any missing PM API views/RPCs must be added in `shared-db` migrations.

## 5. Database Source Of Truth

All database changes belong here:

```text
/worksp/shared-db/supabase/migrations/
```

Do not:

- put permanent DDL only in `poppim-web`;
- run unreviewed SQL directly in the Supabase production SQL editor;
- manually copy schema objects from preview to production;
- create an app-specific Supabase project for PM;
- create duplicate PM-only company/contact/taxonomy/factory tables.

`poppim-web` may contain:

- Supabase client code;
- generated TypeScript database types;
- frontend adapters;
- environment variable documentation;
- frontend-specific migration notes.

## 6. Directus To Shared Supabase Mapping

Use this mapping when rewriting frontend queries and writing migration/load
scripts.

| Current Directus collection/system table | Shared Supabase target |
|---|---|
| `directus_users` | `app.profile` |
| `directus_roles` | `app.role`, `app.user_role`, `app.app_access` |
| `directus_comments` | `app.comment` |
| `directus_files` | `app.file_object` for generic files; `dam.asset` for DAM-managed files |
| Directus activity/revisions | `app.activity` for user-visible history; raw audit only if deliberately imported |
| Directus Flows | Postgres triggers, RPCs, Edge Functions, or host workers |
| Directus permissions | RLS policies, grants, API views/RPCs |
| Directus field hiding | role-specific views/RPCs and grants |
| `retailer` | `core.company` |
| `buyer` | `core.contact`, `core.contact_company` |
| `licensor` | `core.licensor` |
| `property` | `core.property` |
| `factory` | `core.factory` |
| `product_type` | `core.product_type` |
| `season` | PM-local field initially; future shared reference only if required |
| `product` | `pim.product` |
| `project` | `pim.project` |
| `design` | `pim.design` |
| `design_collection` | `pim.design_collection` |
| `stage` | `pim.stage` |
| `stage_history` | `pim.stage_history` |
| `order` | `pim.customer_order`, linked to `plm.production_order` when known |
| `product_submission` | `pim.product_submission` |
| `product_sample` | `pim.product_sample` |
| `revision_request` | `pim.revision_request` |
| `checklist_item` | `pim.checklist_item` |
| `subtask` | `pim.checklist_item` initially, or future `pim.subtask` if required |
| `product_assignee` | `pim.product_assignee` |
| `product_file` | `pim.product_file`, optionally linked to `app.file_object` or `dam.asset` |
| `product_update` | `pim.product_update` or `app.activity`, depending on final usage |
| `product_tag` | `pim.product_tag` |
| `product_field` | `pim.product_field` |
| `product_activity` | `app.activity` or preserved ClickUp parity rows |
| `product_link` | `pim.product_link` |
| `product_time_entry` | `pim.product_time_entry` |
| `pm_saved_view` | `pim.saved_view` |
| `pm_view_pref` | `pim.view_pref` |

Do not duplicate these inside `pim`:

- companies/customers;
- contacts/buyers;
- licensors;
- properties;
- characters;
- factories/vendors;
- product taxonomy;
- DAM assets;
- PLM items.

## 7. Non-Negotiable Constraints

Follow these constraints throughout the migration:

1. Use the preview branch first.
2. Promote to production only from committed `shared-db` migrations.
3. Preserve Directus UUIDs where possible.
4. Preserve all source IDs:
   - `external_id`
   - `external_source`
   - ClickUp task ids
   - PLM ids
   - DAM ids
   - Directus ids
   - CRM/Twenty/ingest ids
5. Keep DigitalOcean Spaces URLs during the first database migration.
6. Do not migrate object storage during the database/auth migration.
7. Keep vendor users without product/order access until vendor row scoping is
   implemented.
8. Do not expose PLM/RFQ/pricing/cost base tables through broad authenticated
   grants.
9. Do not browser dual-write for cross-app side effects.
10. Use triggers, RPCs, Edge Functions, or service-side workers for cross-domain
    effects.
11. Do not expose raw ingest tables through normal PM browser contracts.
12. Do not expose raw CRM email/meeting content through broad API views.

## 8. Required Secrets And Safety

Do not commit secrets.

The implementing session will need approved access to:

- preview Supabase URL and anon key;
- production Supabase URL and anon key when ready;
- Supabase CLI access token;
- preview database password if `supabase db push` requires it;
- Directus database or dump access;
- Directus admin/API access only if DB-level export is not available;
- Microsoft/Azure auth configuration, if implementing auth.

Use local secret files outside the repo, for example:

```text
/home/ai/.shared-db-supabase.env
/home/ai/.poppim-supabase-preview.env
```

Set permissions:

```bash
chmod 600 /home/ai/.shared-db-supabase.env
chmod 600 /home/ai/.poppim-supabase-preview.env
```

Never paste service-role keys or database passwords into committed files.

## 9. Phase 0: Repo Alignment

Goal: confirm the app repo and shared database repo are being used correctly.

### 9.1 In `poppim-web`

```bash
cd /worksp/poppim-web
git status --short
```

Read:

```text
AGENTS.md
README.md
docs/architecture.md
pm_migration_supa_backend.md
```

Confirm current Directus files:

```bash
rg -n "directus|@directus/sdk|readItems|aggregate|readComments|readUsers" src
```

### 9.2 In `shared-db`

```bash
cd /worksp/shared-db
git status --short
supabase link --project-ref tcscehehgeiijilylezv
scripts/check-sql.sh
supabase db push --dry-run
```

If Supabase CLI reports a database password or login-role connection failure,
load the preview branch password from the approved secret store:

```bash
export SUPABASE_DB_PASSWORD='<preview-branch-db-password>'
```

Do not link to production until production promotion is explicitly approved.

Exit criteria:

- `poppim-web` is clean or known dirty changes are understood.
- `shared-db` is linked to `tcscehehgeiijilylezv`.
- SQL checks pass.
- Dry-run against preview succeeds.

## 10. Phase 1: Directus Source Audit And Parity Baseline

Goal: create objective before/after checks before moving data or rewriting code.

### 10.1 Source Snapshots

Take or obtain:

- full Directus Postgres dump;
- Directus schema-only dump;
- row counts by public table;
- Directus role/policy/permission inventory;
- Directus user inventory;
- Directus comments/files/activity summary;
- Directus Flow inventory;
- file-storage coverage summary;
- PM/CRM curated-vs-ingested customer split counts.

Prefer Postgres-level dumps over Directus API exports because Directus API
exports do not capture all SQL-managed additions, constraints, and backend-only
tables.

### 10.2 PM Parity Queries

Create parity checks for:

- product counts by department:
  - Licensed => Directus values `POP`, `POP Creations`
  - Generic => Directus values `Spruce`, `Spruce Line`
  - Software => `Software`
- top-level open/custom ClickUp cards:
  - `clickup_parent_id is null`
  - `clickup_status_type in ('open', 'custom')`
- stage counts by department;
- list/folder facets by department;
- saved views by visibility/origin/owner;
- view prefs by user/view;
- product detail child counts:
  - files
  - comments
  - assignees
  - checklist items
  - subtasks
  - updates
  - tags
  - fields
  - links
  - time entries
- workflow counts:
  - submissions
  - samples
  - revisions
  - customer orders
- curated customer and buyer counts;
- ingested company/contact counts;
- remaining unstored product files;
- active user counts by Directus role.

Store these checks either in:

```text
/worksp/shared-db/scripts/
```

or as documented SQL in a shared-db migration/prep note.

Exit criteria:

- parity checks can be run repeatedly;
- expected baseline counts are recorded;
- no frontend rewrite is trusted until parity checks exist.

## 11. Phase 2: PM API Contracts In `shared-db`

Goal: expose stable PM-facing read and write contracts from the shared database.

Do not make the frontend rebuild all Directus relation/filter behavior manually.
Prefer `api` views and RPCs for joined or permission-sensitive data.

### 11.1 Existing API Views To Inspect

Inspect these in `shared-db` migrations and preview branch:

```text
api.pm_product_board
api.pm_product_assets
api.plm_item_status
api.global_search
```

Compare `api.pm_product_board` to the current fields expected by:

```text
src/features/pipeline/api.ts
src/domain/products/adapters.ts
src/components/PimTaskCard.tsx
src/components/TaskDetailModal.tsx
```

### 11.2 Likely API Views To Add

Add only when needed, but expect these to be useful:

```text
api.pm_pipeline_list_facets
api.pm_pipeline_counts
api.pm_product_detail
api.pm_product_rollups
api.pm_my_work_queue
api.pm_workflow_queue
api.pm_project_summary
api.pm_design_library
api.pm_design_collection_summary
api.pm_order_status
api.pm_saved_view_options
api.pm_account_picker
api.pm_buyer_picker
```

### 11.3 Likely RPCs To Add

Use RPCs where authorization, validation, side effects, or activity logging
matter:

```text
api.pm_set_product_stage(product_id uuid, stage_id uuid)
api.pm_update_product_fields(product_id uuid, patch jsonb)
api.pm_add_comment(target_schema text, target_table text, target_id uuid, body text)
api.pm_add_checklist_item(product_id uuid, label text)
api.pm_set_checklist_item_done(item_id uuid, done boolean)
api.pm_delete_checklist_item(item_id uuid)
api.pm_add_product_assignee(product_id uuid, profile_id uuid)
api.pm_remove_product_assignee(row_id uuid)
api.pm_create_product_submission(payload jsonb)
api.pm_create_product_sample(payload jsonb)
api.pm_create_revision_request(payload jsonb)
api.pm_upsert_view_pref(view_id uuid, patch jsonb)
```

### 11.4 Migration File Rules

Create PM migrations in:

```text
/worksp/shared-db/supabase/migrations/
```

Use timestamped names:

```text
YYYYMMDDHHMMSS_pim_<short_description>.sql
```

Before adding a migration:

```bash
cd /worksp/shared-db
ls supabase/migrations
```

Avoid duplicate timestamps if parallel sessions exist.

After adding migration:

```bash
scripts/check-sql.sh
supabase db push --dry-run
supabase db push
```

Apply only to preview branch until production promotion is approved.

Exit criteria:

- PM read contracts exist for the first migrated screen.
- PM mutation RPCs exist for the first migrated write flows.
- migration SQL is committed in `shared-db`.
- preview branch has the migration applied.

## 12. Phase 3: PM Frontend Supabase Foundation

Goal: add Supabase to `poppim-web` without removing Directus.

### 12.1 Install Dependency

```bash
cd /worksp/poppim-web
npm install @supabase/supabase-js
```

Do not remove `@directus/sdk` yet.

### 12.2 Add Environment Variables

Update `.env.example` only with non-secret names:

```text
VITE_BACKEND=directus
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

For preview local testing, `.env.local` may contain:

```text
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://tcscehehgeiijilylezv.supabase.co
VITE_SUPABASE_ANON_KEY=<preview anon key>
```

Do not commit `.env.local`.

### 12.3 Add Supabase Client

Create:

```text
src/lib/supabase.ts
```

Expected responsibilities:

- read `VITE_SUPABASE_URL`;
- read `VITE_SUPABASE_ANON_KEY`;
- create browser Supabase client;
- export helper constants;
- fail clearly if `VITE_BACKEND=supabase` but Supabase env vars are missing.

### 12.4 Generate Types

Generate types from the preview branch:

```bash
cd /worksp/shared-db
supabase gen types typescript --project-id tcscehehgeiijilylezv --schema app,core,pim,crm,dam,plm,ingest,api > /worksp/poppim-web/src/lib/database.types.ts
```

If CLI syntax differs, check current Supabase CLI help:

```bash
supabase gen types typescript --help
```

Do not hand-write generated database types.

### 12.5 Backend Switch

Add a small helper:

```text
src/lib/backend.ts
```

Suggested API:

```ts
export const BACKEND = import.meta.env.VITE_BACKEND ?? 'directus'
export const usingSupabase = BACKEND === 'supabase'
export const usingDirectus = !usingSupabase
```

Keep Directus as the default until preview parity is proven.

Exit criteria:

- app still builds with Directus default;
- Supabase client exists;
- generated types exist;
- no screens have switched yet.

## 13. Phase 4: Supabase Auth Adapter

Goal: replace Directus auth behind the backend switch while preserving the old
path.

Current Directus auth is in:

```text
src/auth/auth.tsx
src/lib/directus.ts
src/pages/LoginPage.tsx
```

Supabase auth should:

- call `supabase.auth.getSession()`;
- call `supabase.auth.getUser()`;
- subscribe to `supabase.auth.onAuthStateChange`;
- load `app.profile`;
- load active roles from `app.user_role` / `app.role`;
- check `app.app_access` for app `pm`;
- support Microsoft login through Supabase Auth.

Directus auth should remain available when:

```text
VITE_BACKEND=directus
```

Supabase auth should be active when:

```text
VITE_BACKEND=supabase
```

Acceptance tests:

- Directus mode still works.
- Supabase mode loads unauthenticated state.
- Supabase mode can start Microsoft OAuth.
- after login, user profile loads from `app.profile`.
- app access is checked for `pm`.
- assignee user list can read active `app.profile` rows permitted by RLS.

Do not hardcode service-role access in the frontend.

## 14. Phase 5: Read-Only PM Screens

Goal: make PM read paths work from Supabase preview before moving writes.

### 14.1 Reference Data First

Rewrite or dual-path these reads:

- stages: Directus `stage` -> `pim.stage`;
- licensors: Directus `licensor` -> `core.licensor`;
- properties: Directus `property` -> `core.property`;
- product types: Directus `product_type` -> `core.product_type`;
- factories: Directus `factory` -> `core.factory`;
- customers: Directus `retailer` -> `core.company`;
- buyers: Directus `buyer` -> `core.contact` / `core.contact_company`;
- users: Directus `directus_users` -> `app.profile`.

Start with:

```text
src/domain/reference/api.ts
src/features/board/collab.ts
```

### 14.2 Pipeline Read Path

Migrate:

```text
src/features/pipeline/api.ts
src/domain/products/adapters.ts
src/domain/products/rollups.ts
```

Current Directus behavior to preserve:

- hard-separated departments:
  - Licensed maps to `POP` / `POP Creations`
  - Generic maps to `Spruce` / `Spruce Line`
  - Software maps to `Software`
- top-level ClickUp cards:
  - `clickup_parent_id is null`
  - `clickup_status_type in ('open', 'custom')`
- server-side search;
- licensor filter;
- ClickUp list filter;
- list/folder facets;
- aggregate total count;
- 5,000-row cap behavior or a deliberate replacement;
- sort by `clickup_updated_at` and `clickup_orderindex` where appropriate;
- `clickup_orderindex` must not be sorted lexically if exact order matters.

Preferred Supabase contracts:

```text
api.pm_product_board
api.pm_pipeline_counts
api.pm_pipeline_list_facets
```

If the existing `api.pm_product_board` lacks fields, add them in `shared-db`.

### 14.3 Product Detail Read Path

Migrate reads used by:

```text
src/components/TaskDetailModal.tsx
src/features/board/collab.ts
src/features/workflow/api.ts
```

Preserve:

- product main fields;
- editable field source values;
- assignees;
- comments;
- checklist items;
- subtasks;
- files/images;
- updates;
- tags;
- custom fields;
- activity;
- links;
- time entries;
- submissions;
- samples;
- revisions.

Preferred Supabase contracts:

```text
api.pm_product_detail
api.pm_product_assets
app.comment
pim.product_file
pim.product_update
pim.product_tag
pim.product_field
app.activity or pim.product_activity
pim.product_link
pim.product_time_entry
```

### 14.4 Saved Views Read Path

Migrate:

```text
src/features/views/api.ts
src/components/Sidebar.tsx
src/components/Topbar.tsx
```

Directus behavior to preserve:

- Space = department.
- Master view is virtual.
- Shared views visible to all PM users.
- Personal views visible only to owner.
- Shared/seeded views are hidden per user through prefs.
- Per-user color/order overrides live in prefs.

Supabase target:

```text
pim.saved_view
pim.view_pref
```

Exit criteria:

- all read-only PM screens load in preview Supabase mode;
- Directus mode still works;
- parity counts match.

## 15. Phase 6: PM Mutations

Goal: move writes through Supabase preview safely.

Recommended order:

1. Product stage drag:
   - current Directus: `updateItem('product', id, { stage })`
   - target: `api.pm_set_product_stage(...)`

2. Inline product field edits:
   - current Directus: `updateProduct(id, patch)`
   - target: `api.pm_update_product_fields(...)`

3. Comments:
   - current Directus: `directus_comments`
   - target: `app.comment` via RPC or RLS-safe insert

4. Checklist/subtask changes:
   - current Directus: `checklist_item`, `subtask`
   - target: `pim.checklist_item` and maybe future `pim.subtask`

5. Assignees:
   - current Directus: `product_assignee` with `directus_user`
   - target: `pim.product_assignee` with `app.profile`

6. Saved views:
   - current Directus: `pm_saved_view`, `pm_view_pref`
   - target: `pim.saved_view`, `pim.view_pref`

7. Workflow child records:
   - submissions -> `pim.product_submission`
   - samples -> `pim.product_sample`
   - revisions -> `pim.revision_request`

8. Cover image update:
   - current Directus: `product.cover_url`
   - target: `pim.product.cover_url` or equivalent field in the shared schema

For each mutation:

- test allowed roles;
- test denied roles;
- test optimistic UI behavior;
- test persistence after reload;
- write `app.activity` if expected;
- avoid browser dual-writes.

Exit criteria:

- core PM workflow writes work on preview Supabase;
- Directus is no longer required for migrated write paths;
- Directus mode remains available until cutover.

## 16. Phase 7: Data Migration

Goal: load Directus PM data into the shared schema with canonical references.

### 16.1 General Rules

- Preserve UUIDs where possible.
- Preserve source refs.
- Do not hard-link uncertain duplicates.
- Keep source-system provenance.
- Keep Spaces URLs.
- Do not migrate object storage in this phase.
- Do not expose raw ingest data to PM pickers.

### 16.2 Load Order

1. App identity:
   - Directus users -> `app.profile`
   - Directus roles -> `app.role`
   - Directus role membership -> `app.user_role`
   - PM access -> `app.app_access`

2. Core reference rows:
   - curated customers -> `core.company`
   - curated buyers -> `core.contact`, `core.contact_company`
   - ingested company/contact refs -> source refs or `ingest.raw_record`
   - licensors -> `core.licensor`
   - properties -> `core.property`
   - characters if present -> `core.character`
   - factories -> `core.factory`
   - product taxonomy -> `core.product_type`
   - SKU/source refs -> `core.sku_ref`

3. PM domain rows:
   - `pim.stage`
   - `pim.design_collection`
   - `pim.project`
   - `pim.design`
   - `pim.product`
   - `pim.stage_history`
   - `pim.product_submission`
   - `pim.product_sample`
   - `pim.revision_request`
   - `pim.customer_order`
   - `pim.checklist_item`
   - `pim.product_assignee`
   - `pim.product_file`
   - `pim.product_update`
   - `pim.product_tag`
   - `pim.product_field`
   - `pim.product_link`
   - `pim.product_time_entry`
   - `pim.saved_view`
   - `pim.view_pref`

4. App support:
   - Directus comments -> `app.comment`
   - user-visible activity -> `app.activity`
   - generic files -> `app.file_object`

5. Cross-domain links:
   - PM product to DAM style group/asset when verified;
   - PM product to PLM item when verified;
   - PM order to PLM production order when verified;
   - CRM opportunity to PM project/product when verified.

### 16.3 Customer/Ingest Split

The current Directus/CRM system deliberately split raw ingested CRM records from
curated real customers. Preserve that idea.

PM pickers must use canonical curated records:

```text
core.company
core.contact
core.contact_company
```

Raw ingested domains/contacts should become:

```text
core.*_source_ref
ingest.raw_record
ingest.dedupe_candidate
```

Do not point PM customer/buyer pickers at raw ingested data.

### 16.4 ClickUp Parity

Preserve:

- ClickUp task ids;
- ClickUp list/folder/space names and ids;
- ClickUp status fields;
- `clickup_parent_id`;
- `clickup_top_level_parent_id`;
- `clickup_updated_at`;
- `clickup_orderindex`;
- product files/updates/tags/fields/activity/links/time entries;
- imported comments/checklists where applicable.

Important rules:

- `clickup_orderindex` should remain text/varchar.
- If sorting by order index in SQL, use numeric cast carefully.
- Do not claim exact ClickUp ordering globally if data is capped or merged
  across lists.

Exit criteria:

- preview branch has migrated PM data;
- parity checks match the Directus baseline;
- uncertain dedupe rows are documented, not silently merged.

## 17. Phase 8: RLS And Authorization Hardening

Goal: make authorization safe before exposing PM screens.

Required roles:

```text
administrator
sales
licensing
designer
viewer
vendor
```

Required assertions:

- administrators can manage all PM data.
- sales/licensing/designer can write only expected PM workflow data.
- viewer is read-only.
- vendor cannot see products/orders until vendor row scoping exists.
- designers cannot see pricing/cost fields.
- raw ingest tables are not exposed broadly.
- PLM/RFQ/cost tables are not exposed broadly.
- saved views are scoped by owner/shared visibility and PM app access.
- service-role-only functions cannot be called by browser clients.
- PM app access is checked through `app.app_access`.

Add RLS tests in `shared-db`, not ad-hoc notes only.

Exit criteria:

- RLS tests exist.
- role allow/deny cases pass.
- pricing/vendor/raw-data exposure has been checked intentionally.

## 18. Phase 9: Realtime

Goal: enable realtime only for user-facing PM state after RLS is correct.

Candidate PM subscriptions:

```text
pim.product
pim.stage_history
pim.product_submission
pim.product_sample
pim.revision_request
pim.customer_order
pim.product_assignee
app.comment
app.notification
app.activity
```

Do not subscribe PM frontend to:

- raw ingest tables;
- DAM queues;
- helper tokens;
- PLM RFQ/cost tables;
- broad audit logs;
- worker-only tables.

Test with two browser sessions:

- stage movement;
- comment creation;
- assignment updates;
- workflow status changes;
- notifications/activity if implemented.

Exit criteria:

- realtime is restricted to intended tables.
- subscriptions respect RLS.
- app gracefully handles missed realtime events by refetching.

## 19. Phase 10: Background Jobs And Cross-App Effects

Goal: replace Directus-dependent automation and avoid browser dual-writes.

| Current behavior | Shared Supabase replacement |
|---|---|
| Directus stage-history Flow | Postgres trigger or `api.pm_set_product_stage` writes `pim.stage_history` |
| Directus new-user notification Flow | Supabase Auth/profile trigger plus `app.notification` or Edge Function |
| Entra role sync | sync `app.profile`, `app.role`, `app.user_role`, `app.app_access` |
| PLM master sync | write `core`/`plm` tables or service-role RPCs |
| ClickUp imports/backfills | write `pim` and `ingest` with source refs |
| CRM worker | write `crm`, `core`, `ingest`, `app.activity` |
| Spaces file recovery | keep URL metadata first; storage migration later |

Cross-app side effects:

- If CRM opportunity creates PM work, server-side code writes `pim.project` or
  `pim.product`.
- If PM stage movement should update CRM/account activity, a trigger/function
  writes `app.activity` and optionally `crm.task`.
- If DAM asset links to PM design/product, write `pim.design_asset` or
  `pim.product_style_group`.

Do not implement cross-app side effects as frontend dual-writes.

Exit criteria:

- every current Directus Flow/job has a Supabase replacement or an explicit
  deferred decision.
- active host timers/workers have a Supabase path.

## 20. Phase 11: Preview Testing

Goal: prove PM works against the shared preview branch.

Configure PM preview/local build:

```text
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://tcscehehgeiijilylezv.supabase.co
VITE_SUPABASE_ANON_KEY=<preview anon key>
```

Run:

```bash
cd /worksp/poppim-web
npm run build
npm run lint
```

Required PM smoke tests:

- Microsoft login through Supabase.
- app shell loads profile and roles.
- app access for PM is enforced.
- pipeline board loads.
- department switching preserves hard separation.
- list filter/facet counts match Directus parity.
- search works.
- table/board grouping works.
- product card images render.
- detail modal opens from card click.
- detail modal opens from `?item=<uuid>`.
- inline edit persists after reopen.
- drag-to-stage persists after refresh.
- comments add and reload.
- checklist/subtask operations persist.
- assignee picker loads active users and persists changes.
- saved view create/reorder/recolor/hide persists.
- workflow creation works:
  - submission
  - sample
  - revision
- order/status surfaces load.
- customer/buyer pickers show canonical curated records only.
- reports totals match parity.
- secondary screens load:
  - Control Room
  - My Work
  - Projects
  - Designs
  - Submissions
  - Samples
  - Revisions
  - Orders
  - Accounts
  - Reports
  - Settings

Required shared-db handoff note:

```text
/worksp/shared-db/docs/app-migration-notes/poppim-web-YYYYMMDD.md
```

Include:

- migrations added;
- API views/RPCs used by each PM screen;
- RLS policies changed;
- realtime subscriptions used;
- screens tested;
- preview branch test results;
- remaining Directus dependencies;
- exact production migrations to apply;
- known gaps.

Exit criteria:

- preview branch PM works end-to-end for agreed scope;
- shared-db handoff note exists;
- production promotion checklist is precise.

## 21. Phase 12: Production Promotion

Goal: promote from preview to production safely.

Do not manually copy SQL from preview to production.

### 21.1 Database Promotion

In a clean `shared-db` checkout:

```bash
cd /worksp/shared-db
git status --short
supabase link --project-ref qsllyeztdwjgirsysgai
supabase db push --dry-run
```

Review dry-run output carefully.

Confirm:

- only approved baseline and PM migrations are listed;
- no unexpected destructive changes are listed;
- PopDAM production tables are not being renamed/moved unexpectedly;
- RLS changes are expected.

Apply only during an approved window:

```bash
supabase db push
supabase migration list
```

### 21.2 Data Migration / Final Sync

Use either:

- a short Directus write freeze; or
- a tested final delta sync.

Preferred: short write freeze. Avoid long-term dual-write.

Steps:

1. announce freeze;
2. take fresh Directus dump;
3. run final migration/delta load;
4. run parity checks;
5. unlock Supabase-backed PM only after parity passes.

### 21.3 PM Frontend Promotion

Set production PM env:

```text
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://qsllyeztdwjgirsysgai.supabase.co
VITE_SUPABASE_ANON_KEY=<production anon key>
```

Deploy through normal `poppim-web` path.

Production smoke tests:

- login;
- pipeline;
- detail modal;
- stage drag;
- inline edit;
- comment;
- saved view;
- workflow record creation;
- customer/buyer picker;
- file/image rendering.

### 21.4 Rollback

Keep Directus available read-only during the first stability window.

Rollback path:

1. set PM env back to:

   ```text
   VITE_BACKEND=directus
   ```

2. redeploy previous PM frontend;
3. if Supabase accepted writes before rollback, decide whether to:
   - replay them into Directus;
   - discard them;
   - keep Directus frozen and fix forward.

Avoid rollback ambiguity by using a write freeze and short validation window.

## 22. Phase 13: Cleanup

After stable production:

1. Remove `@directus/sdk` from `poppim-web`.
2. Delete `src/lib/directus.ts`.
3. Replace Directus references in:
   - `README.md`
   - `AGENTS.md`
   - `docs/architecture.md`
   - `docs/configuration.md`
   - `docs/development.md`
4. Remove `VITE_DIRECTUS_URL`.
5. Remove Directus API branches from feature API modules.
6. Keep Directus database dumps for audit.
7. Decide whether Directus remains read-only for temporary admin/reference use.
8. Archive Directus-specific backend scripts only after active jobs are migrated.

## 23. Files Likely To Change In `poppim-web`

Expected app-side files:

```text
package.json
package-lock.json
.env.example
src/lib/supabase.ts
src/lib/database.types.ts
src/lib/backend.ts
src/auth/auth.tsx
src/pages/LoginPage.tsx
src/domain/reference/api.ts
src/domain/products/adapters.ts
src/domain/products/rollups.ts
src/features/pipeline/api.ts
src/features/board/api.ts
src/features/board/collab.ts
src/features/workflow/api.ts
src/features/views/api.ts
src/features/control-room/api.ts
src/features/mywork/api.ts
src/features/projects/api.ts
src/features/designs/api.ts
src/features/submissions/*
src/features/samples/*
src/features/revisions/*
src/features/orders/api.ts
src/features/accounts/api.ts
src/features/reports/api.ts
src/features/settings/api.ts
```

Keep UI components stable unless data shape changes force a UI update.

## 24. Files Likely To Change In `shared-db`

Expected database-side files:

```text
supabase/migrations/YYYYMMDDHHMMSS_pim_<description>.sql
docs/app-migration-notes/poppim-web-YYYYMMDD.md
scripts/<parity-or-rls-test>.sql
```

Do not place app-specific permanent DDL only in `poppim-web`.

## 25. Common Mistakes To Avoid

- Targeting `wqgffwbhepkzldzpahbf`.
- Applying migrations directly to production first.
- Editing synced `shared-db/` copies inside consumer repos instead of the
  canonical shared-db repo.
- Creating `pim.customer` or `pim.buyer` duplicates instead of using `core`.
- Exposing base PLM/RFQ/pricing tables to broad authenticated roles.
- Moving Spaces/Supabase Storage during the database migration.
- Removing Directus before Supabase preview parity exists.
- Sorting `clickup_orderindex` lexically.
- Showing `product.code` in the UI as a human label.
- Treating raw ingested CRM domains/contacts as curated PM pickers.
- Implementing CRM/PM cross-effects as browser dual-writes.
- Assuming RLS scaffold is production-final without role tests.

## 26. Immediate Recommended Implementation Slice

Do this first. Do not start with a full migration.

### 26.1 In `shared-db`

1. Inspect `api.pm_product_board`.
2. Compare it to the fields currently requested by `PRODUCT_SUMMARY_FIELDS` in:

   ```text
   src/features/pipeline/api.ts
   ```

3. Add missing read fields to `api.pm_product_board` or create an improved
   `api.pm_pipeline_products` view/RPC.
4. Add list-facet and count contracts if absent:

   ```text
   api.pm_pipeline_counts
   api.pm_pipeline_list_facets
   ```

5. Run:

   ```bash
   cd /worksp/shared-db
   scripts/check-sql.sh
   supabase db push --dry-run
   supabase db push
   ```

### 26.2 In `poppim-web`

1. Install `@supabase/supabase-js`.
2. Add `src/lib/supabase.ts`.
3. Generate `src/lib/database.types.ts` from preview.
4. Add `src/lib/backend.ts`.
5. Add `VITE_BACKEND` support.
6. Implement Supabase read path for:
   - auth/profile if ready;
   - stages/reference data;
   - pipeline products;
   - pipeline counts;
   - pipeline list facets.
7. Keep Directus as default.
8. Test with:

   ```text
   VITE_BACKEND=supabase
   VITE_SUPABASE_URL=https://tcscehehgeiijilylezv.supabase.co
   ```

9. Run:

   ```bash
   npm run build
   npm run lint
   ```

This slice proves the shared enterprise project strategy against one high-value
PM screen without forcing a risky whole-app rewrite.

## 27. Acceptance Criteria For The Whole Migration

The PM migration is complete only when:

- all PM production screens use Supabase, not Directus;
- all required DB changes are committed in `shared-db`;
- production Supabase project has approved migrations only;
- Directus data has been migrated and parity-checked;
- Microsoft login works through Supabase;
- `app.profile`, `app.role`, and `app.app_access` enforce PM access;
- RLS role tests pass;
- PM board/detail/workflow/saved-view writes persist;
- DAM/PLM/CRM cross-links use canonical shared rows or source refs;
- Directus is no longer needed for PM runtime;
- rollback/read-only Directus plan has been executed or retired.

