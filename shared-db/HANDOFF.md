# Handoff - production schema reconciliation closeout

Date: 2026-07-10
Repo: `u2giants/shared-db`

## Current state

- Local branch: `main`
- Remote state: `main` matches `origin/main`
- Latest merge commit: `f6dbbf4a1c0f67be7d702cb61ea94514bd1dbcfc`
- PR #54 was merged: `https://github.com/u2giants/shared-db/pull/54`
- Sync workflow after merge passed:
  `https://github.com/u2giants/shared-db/actions/runs/29121430719`

Production project `qsllyeztdwjgirsysgai` was not modified during the
reconciliation session.

Preview project `xjcyeuvzkhtzsheknaiu` was repaired and verified against
production.

## What was completed

- Captured production-only schema drift into canonical reconciliation migrations:
  style-tracker, AI tag bakeoff, Auth triggers, full `dflow` baseline,
  service-role grants, and permission parity.
- Applied those migrations to preview only.
- Verified catalog parity between preview and production across
  `api`, `app`, `core`, `crm`, `dam`, `dflow`, `ingest`, `pim`, `plm`, and
  `public`.
- Verified effective `service_role` permission summary parity.
- Verified auth trigger parity and auth refresh-token sequence structure.
- Merged the repo record to `main`.

See the durable audit note:
`docs/verification/production-schema-reconciliation-20260710.md`.

## Exact verification evidence

- Preview dry-run after repair:
  `supabase db push --dry-run --include-all` returned
  `Remote database is up to date.`
- Production dry-run only returned exactly these pending reconciliation files:
  - `20260710135600_reconcile_style_tracker_tables.sql`
  - `20260710135700_reconcile_style_tracker_functions.sql`
  - `20260710135800_reconcile_style_tracker_triggers.sql`
  - `20260710135900_reconcile_ai_tag_bakeoff.sql`
  - `20260710135925_reconcile_auth_triggers.sql`
  - `20260710135950_reconcile_dflow_baseline.sql`
  - `20260710135975_reconcile_service_role_grants.sql`
  - `20260710135985_reconcile_permission_parity.sql`
- Catalog hash on both preview and production:
  `fa401030346978a28a24c9e7eb64671c`
- Effective service-role permission summary differences:
  `0`
- PR validation workflow passed:
  `https://github.com/u2giants/shared-db/actions/runs/29121385593`

## Loose ends

1. Rotate the production DB password.

   A Supabase CLI dry-run/dump command unexpectedly printed the production DB
   password in local tool output during the audit. The value was not committed
   to the repository, but it should be treated as exposed to local
   transcript/tool-output history. After rotation, update the 1Password item:
   `Supabase DB Password - shared POP database`.

2. Promote the reconciliation migrations to production only in an approved
   production window.

   Do not run production apply as part of ordinary closeout. Before promotion,
   re-run the production dry-run and confirm it still lists only the eight
   reconciliation files above. Then use the normal shared-db production apply
   workflow or Supabase CLI path from `AGENTS.md`.

## Known tooling note

`scripts/check-sql.sh` has CRLF line endings in the Windows checkout, so direct
WSL execution can fail before checks run with `set: pipefail\r`. The static
checks passed from a normalized temporary copy. CI also passed on GitHub.
