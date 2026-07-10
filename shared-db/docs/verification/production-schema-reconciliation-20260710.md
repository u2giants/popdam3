# Production schema reconciliation audit - 2026-07-10

## Scope

This audit captured production-only schema drift into canonical `shared-db`
migrations and repaired the Supabase preview branch so it again matches
production before any future production promotion.

Production project: `qsllyeztdwjgirsysgai`
Preview project: `xjcyeuvzkhtzsheknaiu`

Production was not modified during this reconciliation. All migration application
in this session was limited to preview.

## Drift captured

The following additive reconciliation migrations were added:

- `20260710135600_reconcile_style_tracker_tables.sql`
- `20260710135700_reconcile_style_tracker_functions.sql`
- `20260710135800_reconcile_style_tracker_triggers.sql`
- `20260710135900_reconcile_ai_tag_bakeoff.sql`
- `20260710135925_reconcile_auth_triggers.sql`
- `20260710135950_reconcile_dflow_baseline.sql`
- `20260710135975_reconcile_service_role_grants.sql`
- `20260710135985_reconcile_permission_parity.sql`

These versions intentionally sort before
`20260710140000_dflow_product_user_assignment.sql` and
`20260710172623_dflow_comments_widen_comment.sql`. Preview did not have the
full `dflow` baseline schema, so those later dflow migrations could not be
rehearsed safely until the baseline was inserted ahead of them.

The auth refresh-token sequence repair did not require new structural SQL:
preview and production both already use
`nextval('auth.refresh_tokens_id_seq')`, `pg_get_serial_sequence(...)` resolves
to the same sequence, and table/sequence ownership is `supabase_auth_admin` in
both projects.

## Verification

- Preview migration application completed successfully.
- Preview `supabase db push --dry-run --include-all` reports:
  `Remote database is up to date.`
- Production `supabase db push --dry-run --include-all` would apply only the
  eight reconciliation migrations listed above.
- Catalog fingerprint parity across `api`, `app`, `core`, `crm`, `dam`,
  `dflow`, `ingest`, `pim`, `plm`, and `public` is exact:
  `fa401030346978a28a24c9e7eb64671c` on both production and preview.
- Effective `service_role` permission summary parity is exact after
  `20260710135985_reconcile_permission_parity.sql`.
- Auth triggers on `auth.users` match between preview and production:
  `on_auth_user_created`, `on_auth_user_created_popdam`, and
  `on_auth_user_email_confirmed`.
- `scripts/check-sql.sh` static checks pass from a normalized temporary copy.
  The tracked script currently has CRLF line endings on Windows, so direct WSL
  execution fails before running the checks with `set: pipefail\r`.

## Attribution findings

PostgreSQL/Supabase does not keep a complete built-in DDL actor history in
`pg_catalog`. The durable traces available here are GitHub history, Supabase
migration-ledger metadata, GitHub Actions runs, and local/archived AI
transcripts.

Confirmed or high-confidence traces:

- `dflow.comments.comment` widen:
  PR #51 (`https://github.com/u2giants/shared-db/pull/51`) states that
  production had already been widened out of band, names DesignFlow PLM as the
  affected app, and includes a Claude Code co-author:
  `Claude Opus 4.8 <noreply@anthropic.com>`.
- `dflow.productUserAssignment`:
  commit `818299154edbe231ebfe56fd0bcf3c2270d9fcc2` was committed directly by
  `devopswithkube <devopswithkube@gmail.com>` with message
  `added user assignment`; the migration comments say it was already applied to
  production on 2026-07-10.
- GitHub Actions run `29112670884` was manual `workflow_dispatch` on `main`,
  but the `Apply migrations` step was skipped. It did not apply the July 10
  production DDL.

Partial traces:

- The June 30 / July 1 marker migrations
  `add_ai_tag_bakeoff`, `restore_popdam_auth_trigger`, and
  `repair_auth_refresh_token_sequence` were added to this repo later in commit
  `ebf8685c10157bb0f94c5b92a5f5c0d7d80f1dbb` as production migration-history
  markers. Their file comments explicitly say the original SQL was applied
  outside the canonical shared-db migration flow.
- The production `supabase_migrations.schema_migrations` rows for those marker
  versions do not contain `created_by` or `idempotency_key` values. They contain
  only version/name/statement metadata.
- Local and archived transcript searches found matching Codex/Claude chat files
  for PopDAM/auth/AI-bakeoff terms, but those transcripts should be treated as
  sensitive private data and were not copied into this report.

Recommended next security action:

- Rotate the production database password. A Supabase CLI dry-run/dump command
  unexpectedly printed the password in local tool output during this audit. The
  value was not committed to the repository, but it should be considered exposed
  to the local transcript/tool-output history.
