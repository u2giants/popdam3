# AI Session Instructions

Use these instructions when separate AI sessions are rewriting app frontends from Directus to the shared Supabase project.

Start with:

- [Shared Supabase branch workflow](shared-supabase-branch-workflow.md)

Then use the app-specific guide:

- [CRM / `popcrm-web`](popcrm-web-supabase-migration.md)
- [PM/PIM / `poppim-web`](poppim-web-supabase-migration.md)

The shared preview branch is:

```text
Parent project: qsllyeztdwjgirsysgai
Preview project ref: tcscehehgeiijilylezv
Branch name: shared-db-schema-rehearsal
```

Production promotion must happen from committed migration files in this repo, not from manual SQL copied out of the preview branch.
