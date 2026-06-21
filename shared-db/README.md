# Shared DB

Planning and migration repo for the unified POP shared database on Supabase.

This repo holds schema mapping, relationship design, migration gaps, Supabase migrations, branch verification notes, and cutover preparation for consolidating DAM, CRM, PM, and the operational PLM data needed by those apps into one Supabase project.

## Current Documents

- [Unified Supabase schema map](docs/unified-supabase-schema-map.md) - canonical entity/table ownership map across DAM, CRM, PM, and PLM.
- [Unified Supabase relationships](docs/unified-supabase-relationships.md) - crossover relationships, join strategy, realtime boundaries, and browser-facing API contracts.
- [Unified Supabase migration gaps](docs/unified-supabase-migration-gaps.md) - duplicates, conflicts, risky tables, missing links, and migration-order risks.
- [Supabase migration preparation](docs/supabase-migration-prep.md) - rehearsal plan for moving the current Directus-owned Postgres data into Supabase.
- [Schema implementation notes](docs/implementation/schema-implementation-notes.md) - what the migration package implements and what remains intentionally unresolved.
- [AI session instructions](docs/ai-session-instructions/README.md) - handoff guides for CRM and PM rewrite sessions using the shared preview branch.

## Migration Package

The first-pass DDL package lives in [`supabase/migrations`](supabase/migrations):

- `20260621000100_foundation.sql`
- `20260621000200_app_core.sql`
- `20260621000300_domain_tables.sql`
- `20260621000400_api_rls_realtime.sql`

These migrations are for disposable rehearsal targets first. Do not apply them to the live project until source dumps, dedupe rules, RLS tests, and cutover order are approved.

## Preview Branch

The migration package has been applied to a persistent Supabase preview branch for review:

```text
Parent project: qsllyeztdwjgirsysgai
Branch name: shared-db-schema-rehearsal
Preview project ref: tcscehehgeiijilylezv
```

Verification notes are in [docs/verification/preview-branch-20260621.md](docs/verification/preview-branch-20260621.md).

AI sessions migrating CRM and PM should use [docs/ai-session-instructions/shared-supabase-branch-workflow.md](docs/ai-session-instructions/shared-supabase-branch-workflow.md), then their app-specific guide.

## Target

Supabase project:

```text
https://qsllyeztdwjgirsysgai.supabase.co
```

The shared schema migrations have been applied to the preview branch only. They have not been applied to the production/default project.
