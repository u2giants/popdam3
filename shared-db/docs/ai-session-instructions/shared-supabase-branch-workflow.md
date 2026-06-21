# Shared Supabase Branch Workflow For App Rewrite Sessions

Use this guide for AI sessions rewriting POP app frontends from Directus to Supabase.

## Goal

CRM and PM/PIM are being rewritten to use Supabase directly. Their new backend tables, views, RPCs, RLS changes, and realtime configuration must land in the shared Supabase database design owned by this repo.

Do not create app-specific Supabase projects for CRM or PM. Use the shared project.

## Repos And Ownership

| Concern | Owner |
|---|---|
| Database schemas, migrations, RLS, API views, RPCs, realtime publication | `u2giants/shared-db` |
| CRM frontend rewrite | `u2giants/popcrm-web` |
| PM/PIM frontend rewrite | `u2giants/poppim-web` |
| Existing live DAM data/project | Supabase project `qsllyeztdwjgirsysgai` |

The app repos may contain generated client types and frontend code, but any database change belongs in `shared-db/supabase/migrations`.

## Supabase Targets

Production/main project:

```text
Project ref: qsllyeztdwjgirsysgai
URL: https://qsllyeztdwjgirsysgai.supabase.co
Purpose: live PopDAM project; do not apply untested app migrations here.
```

Preview branch for CRM/PM rewrite work:

```text
Branch name: shared-db-schema-rehearsal
Preview project ref: tcscehehgeiijilylezv
URL: https://tcscehehgeiijilylezv.supabase.co
Created with data: true
Persistent: true
Purpose: shared integration target for schema/app rewrite testing.
```

## Current Baseline On The Preview Branch

The preview branch already has the baseline shared schema migrations applied:

```text
20260621000100_foundation.sql
20260621000200_app_core.sql
20260621000300_domain_tables.sql
20260621000400_api_rls_realtime.sql
```

Baseline result:

```text
8 logical schemas
85 tables
6 API views
153 RLS policies
```

## Required Working Pattern

1. Clone or open `u2giants/shared-db`.
2. Link the Supabase CLI to the preview branch, not production:

   ```bash
   supabase link --project-ref tcscehehgeiijilylezv
   ```

3. Create new migration files in `supabase/migrations`.
4. Keep changes additive whenever possible.
5. Run local/static checks:

   ```bash
   scripts/check-sql.sh
   ```

6. Dry-run against the preview branch:

   ```bash
   supabase db push --dry-run
   ```

7. Apply only to the preview branch:

   ```bash
   supabase db push
   ```

8. Point the app rewrite to the preview branch URL and test the frontend there.
9. Commit the migration files and any docs to `shared-db`.

If `supabase db push` or `supabase migration list` fails with a login role or connection error, set the database password for the linked project:

```bash
export SUPABASE_DB_PASSWORD='<preview-branch-db-password>'
```

Do not commit passwords, service-role keys, anon keys, or generated `.env` files.

## Migration Naming

Use timestamped names that identify the app and purpose:

```text
supabase/migrations/YYYYMMDDHHMMSS_crm_<short_description>.sql
supabase/migrations/YYYYMMDDHHMMSS_pim_<short_description>.sql
```

Examples:

```text
20260621103000_crm_account_rpc_contracts.sql
20260621104500_pim_product_board_indexes.sql
```

Parallel sessions must avoid duplicate timestamps. Before creating a migration, run:

```bash
ls supabase/migrations
```

## Schema Boundaries

Use these schemas:

| Schema | Use |
|---|---|
| `app` | profiles, roles, app access, comments, activity, notifications, generic files |
| `core` | shared companies, contacts, licensors, properties, characters, factories, taxonomy, SKU refs |
| `crm` | CRM-only operational tables |
| `pim` | PM/PIM product/project/design/workflow/order tables |
| `dam` | DAM assets/style groups/style guides/queues |
| `plm` | item master, production order, licensing/RFQ operational records |
| `ingest` | raw imports, snapshots, sync runs, dedupe candidates |
| `api` | browser-facing views and RPC contracts |

Do not create duplicate customer/contact/product/factory/taxonomy tables inside `crm` or `pim`. Use `core` FKs.

## Cross-App Realtime Rule

For one frontend action to instantly affect another frontend, write to canonical shared rows in this one Supabase project.

Do not make frontend A call frontend B. Do not dual-write from browser code.

Preferred patterns:

- Shared entity change: write canonical table, subscribe to canonical table or `api` contract.
- Workflow side effect: database trigger or service-side Edge Function writes the downstream table.
- UI-specific shape: create an `api` view or RPC over canonical tables.

## Promotion To Production

Do not copy objects manually from the preview branch in the Supabase dashboard.

The promotion path is migration-file based:

1. Confirm the app rewrite works against preview project `tcscehehgeiijilylezv`.
2. Commit and push the migration files to `u2giants/shared-db`.
3. Review schema diff, RLS exposure, and frontend behavior.
4. Link a clean checkout of `shared-db` to production:

   ```bash
   supabase link --project-ref qsllyeztdwjgirsysgai
   ```

5. Dry-run production:

   ```bash
   supabase db push --dry-run
   ```

6. Confirm only approved migrations are listed.
7. Apply to production during an approved window:

   ```bash
   supabase db push
   ```

8. Immediately verify:

   ```bash
   supabase migration list
   ```

For the first production promotion, production does not yet have the baseline shared schema migrations. Expect the baseline migrations plus any accepted CRM/PM migrations to appear in the dry-run. If that is not desired, stop and split the rollout deliberately.

## What Not To Do

- Do not run unreviewed SQL directly in production SQL Editor.
- Do not put database DDL only in `popcrm-web` or `poppim-web`.
- Do not create another Supabase project for CRM or PM.
- Do not expose base PLM/RFQ/pricing tables directly to general authenticated users.
- Do not grant vendor product/order access until vendor row scoping exists.
- Do not move DAM object storage as part of CRM/PM rewrites.
- Do not rename/move existing PopDAM `public` tables during app rewrite work.

## Required Handoff From Each AI Session

Each app migration session must leave:

- Migration files committed in `shared-db`.
- A short doc under `docs/app-migration-notes/` describing frontend env vars, tested screens, table/view/RPC usage, and remaining gaps.
- Confirmation that the app was tested against `https://tcscehehgeiijilylezv.supabase.co`.
- A production promotion checklist naming exactly which migrations should be applied.
