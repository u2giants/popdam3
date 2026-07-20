> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`u2giants/shared-db`](https://github.com/u2giants/shared-db) is the **single source of truth**. Its entire contents are automatically mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM, Directus, and the `popcre/designflow-*` repos) on each push to `main`, via [`.github/workflows/sync.yml`](https://github.com/u2giants/shared-db/blob/main/.github/workflows/sync.yml).
>
> **Reading this inside a consumer repo's `shared-db/` folder?** These files are a read-only copy — any edits here are **overwritten on the next sync**. Make changes in the canonical repo instead.
>
> The `popcre/designflow-*` mirrors intentionally push to each repo's default branch. Sandbox deploy suppression belongs in the Cloud Build trigger path filters (`ignored_files = ["shared-db/**"]` in `popcre/infrastructure`), not by removing consumers from this sync.

---

# Shared DB

Planning and migration repo for the unified POP shared database on Supabase.

This repo holds schema mapping, relationship design, migration gaps, Supabase migrations, branch verification notes, and cutover preparation for consolidating DAM, CRM, PM, and the operational PLM data needed by those apps into one Supabase project.

## Shared-db Gatekeeper

All database schema changes for the shared Supabase project start in this repo.
That includes DesignFlow PLM tables even when a consumer repo has Sequelize
models, old inline startup migrations, or local docs that mention `models/db.js`.

For future sessions with no chat context: do not add columns, tables, indexes,
RLS policies, triggers, functions, views, enums, storage policies, realtime
publication changes, or extension changes inside a consumer repo. Create a new
timestamped migration under `supabase/migrations/` here, test it against the
preview branch, then update the app repos after the shared migration lands.

On 2026-07-10, the six `popcre/designflow-*` repos were updated with an
always-on Cursor rule at `.cursor/rules/shared-db-gatekeeper.mdc`. The file is
duplicated across:

- `designflow-bff`
- `designflow-frontend`
- `designflow-backend`
- `designflow-item-master`
- `designflow-tracking`
- `designflow-data-syncing`

If any agent changes that Cursor rule in one repo, the same change must be made
to the other five repos in the same session, then all six must be committed and
pushed together. `designflow-frontend/AGENTS.md` now has a shared-db section near
the top, and `designflow-item-master/AGENTS.md` was created so future agents see
the rule even before reading app-specific docs.

## Current Documents

- [Cross-app coordination playbook](AGENTS.md) - **read first.** The operating contract for every AI session: which repos use `main` vs DesignFlow PR workflow vs shared-db PR workflow, the four rules that stop dependent apps from breaking each other through the shared database, and the merge protocol the AI runs.
- [AI tagging keyset timeout remediation](docs/app-migration-notes/ai-tagging-keyset-timeout-20260714.md) - service-only candidate RPC, query-shaped indexes, rollout evidence, and the cross-app list/search optimization standard.
- [Merch-group taxonomy architecture](docs/merch-group-taxonomy-architecture.md) - how licensors, properties, themes, style guides and artists actually flow from Coldlion ERP through DesignFlow PLM into `core.*`. **Read before touching any of those.**
- [Unified Supabase schema map](docs/unified-supabase-schema-map.md) - canonical entity/table ownership map across DAM, CRM, PM, and PLM.
- [Shared database vision](docs/shared-database-vision.md) - the grander intention: one shared Supabase database for DAM, CRM, PM/PIM, and PLM.
- [Unified Supabase relationships](docs/unified-supabase-relationships.md) - crossover relationships, join strategy, realtime boundaries, and browser-facing API contracts.
- [Unified Supabase migration gaps](docs/unified-supabase-migration-gaps.md) - duplicates, conflicts, risky tables, missing links, and migration-order risks.
- [Supabase migration preparation](docs/supabase-migration-prep.md) - rehearsal plan for moving the current Directus-owned Postgres data into Supabase.
- [Schema implementation notes](docs/implementation/schema-implementation-notes.md) - what the migration package implements and what remains intentionally unresolved.
- [AI session instructions](docs/ai-session-instructions/README.md) - handoff guides for CRM and PM rewrite sessions using the shared preview branch.

## Host PLM Import

The active Designflow PLM master-data sync is owned here, not in Directus:

- Import tool: `tools/sync-plm-master-data.mjs`
- Host wrapper: `tools/run-plm-master-data-sync.sh`
- Unit templates: `systemd/plm-sync.service` and `systemd/plm-sync.timer`
- Secrets: mode-600 `/home/ai/.plm-sync.env`

The host service runs the import into the linked production Supabase project via
`plm.import_master_data(...)`. It must not point at `/worksp/directus` or the old
Directus Postgres container. The env file must provide `PLM_API_KEY` (or
`DESIGNFLOW_API_KEY`) and `SUPABASE_DB_URL`; systemd must not depend on an
interactive Supabase CLI login.

## Migration Package

The first-pass DDL package lives in [`supabase/migrations`](supabase/migrations):

- `20260621150714_foundation.sql`
- `20260621150815_app_core.sql`
- `20260621151024_domain_tables.sql`
- `20260621151155_api_rls_realtime.sql`

These migrations are for disposable rehearsal targets first. Do not apply them to the live project until source dumps, dedupe rules, RLS tests, and cutover order are approved.

Production also has older PopDAM migrations in its Supabase migration ledger from
before this repo became the shared database source of truth. Those already-applied
legacy versions are represented in `supabase/migrations/` as no-op marker files
so `supabase db push --dry-run` can compare the local ledger with production
without trying to replay PopDAM history from this repo.

## Preview Branch

The migration package has been applied to a persistent Supabase preview branch for review:

```text
Parent project: qsllyeztdwjgirsysgai
Branch name: shared-db-schema-rehearsal
Preview project ref: xjcyeuvzkhtzsheknaiu
```

Verification notes are in [docs/verification/preview-branch-20260621.md](docs/verification/preview-branch-20260621.md).

AI sessions migrating CRM and PM should use [docs/ai-session-instructions/shared-supabase-branch-workflow.md](docs/ai-session-instructions/shared-supabase-branch-workflow.md), then their app-specific guide.

## Target

Supabase project:

```text
https://qsllyeztdwjgirsysgai.supabase.co
```

The shared schema migrations and CRM contact segment API have been applied to the production/default project.
