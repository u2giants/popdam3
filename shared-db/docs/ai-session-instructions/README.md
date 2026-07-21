# AI Session Instructions

Use these instructions for work against the shared Supabase preview branch and
for controlled promotion to production. The CRM and PM/PIM cutovers are complete;
obsolete backend-migration playbooks were removed from the current tree and remain
available only through Git history.

Start with:

- [Shared database vision](../shared-database-vision.md)
- [Shared Supabase branch workflow](shared-supabase-branch-workflow.md)

The shared preview branch is:

```text
Parent project: qsllyeztdwjgirsysgai
Preview project ref: rjyboqwcdzcocqgmsyel
Branch name: shared-db-schema-rehearsal
```

Production promotion must happen from committed migration files in this repo, not from manual SQL copied out of the preview branch.

Production includes older PopDAM migration versions from before this repo became
the shared database source of truth. The no-op legacy marker files under
`supabase/migrations/` are intentional; keep them so Supabase CLI can compare
local and remote migration ledgers.
