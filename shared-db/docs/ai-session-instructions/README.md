# AI Session Instructions

Use these instructions when separate AI sessions are rewriting app frontends from Directus to the shared Supabase project.

Start with:

- [Shared database vision](../shared-database-vision.md)
- [Shared Supabase branch workflow](shared-supabase-branch-workflow.md)

Then use the app-specific guide:

- [CRM / `popcrm-web`](popcrm-web-supabase-migration.md)
- [PM/PIM / `poppim-web`](poppim-web-supabase-migration.md)
  - Full execution plan (phased, standalone): [poppim-web-supabase-migration-plan.md](poppim-web-supabase-migration-plan.md)

The shared preview branch is:

```text
Parent project: qsllyeztdwjgirsysgai
Preview project ref: xjcyeuvzkhtzsheknaiu
Branch name: shared-db-schema-rehearsal
```

Production promotion must happen from committed migration files in this repo, not from manual SQL copied out of the preview branch.

Production includes older PopDAM migration versions from before this repo became
the shared database source of truth. The no-op legacy marker files under
`supabase/migrations/` are intentional; keep them so Supabase CLI can compare
local and remote migration ledgers.
