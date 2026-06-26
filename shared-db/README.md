> ⚠️ **Auto-synced — do not hand-edit the copies.**
>
> [`u2giants/shared-db`](https://github.com/u2giants/shared-db) is the **single source of truth**. Its entire contents are automatically mirrored into the **`shared-db/` folder** of every consumer repo (CRM, DAM, PM, Directus, and the `popcre/designflow-*` repos) on each push to `main`, via [`.github/workflows/sync.yml`](https://github.com/u2giants/shared-db/blob/main/.github/workflows/sync.yml).
>
> **Reading this inside a consumer repo's `shared-db/` folder?** These files are a read-only copy — any edits here are **overwritten on the next sync**. Make changes in the canonical repo instead.

---

# Shared DB

Planning and migration repo for the unified POP shared database on Supabase.

This repo holds schema mapping, relationship design, migration gaps, Supabase migrations, branch verification notes, and cutover preparation for consolidating DAM, CRM, PM, and the operational PLM data needed by those apps into one Supabase project.

## Current Documents

- [Cross-app coordination playbook](AGENTS.md) - **read first.** The operating contract for every AI session: which repos use `main` vs branch+PR, the four rules that stop the four apps from breaking each other through the shared database, and the merge protocol the AI runs.
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
