# DB Data Admin Step 9 database verification — 2026-07-22

Status: applied and verified on preview only. Production is unchanged and the
`merge_execute` feature gate remains disabled by default.

## Contract

Migrations `20260722194000_db_data_admin_merge_workflow.sql` and corrective
`20260722194100_fix_db_data_admin_merge_digest_schema.sql` add protected Customer and Vendor
merge previews and execution. Preview returns the exact survivor/loser projections, every
direct foreign-key count, per-app business-field conflicts, and a SHA-256 preview token.
Execution locks the ordered pair, rechecks that token, requires explicit survivor/loser
choices for every non-null conflict, reconciles one-sided extension values, and calls the
canonical merge engine in the same transaction. Operation UUIDs make retries idempotent;
successes and expected failures are written to the immutable audit ledger.

The execution gate is data, not DDL. The migration seeds `merge_execute=false`; only preview
may be enabled for UI verification. Production enablement remains part of the approved final
delivery window.

## Preview-first evidence

- Preview project: `rjyboqwcdzcocqgmsyel`.
- Initial dry-run contained exactly migration `20260722194000`.
- The first execution test found that hosted Supabase exposes pgcrypto under `extensions`.
  The applied migration was not edited; additive correction `20260722194100` qualifies
  `extensions.digest` and its dry-run contained only that correction.
- `scripts/check-sql.sh`: passed.
- All eight rollback-safe DB Data Admin suites passed, including
  `db_data_admin_merge_workflow.sql`.

The Step 9 suite proves Customer and Vendor parity, exact affected-link counts, disabled-gate
behavior, stale-preview rejection, explicit extension conflict resolution, transferred
Customer Channels and source references, merge-created old-name aliases, loser removal,
immutable audit creation, and idempotent retry without a second merge.

## Production boundary

No production link, migration, feature-gate update, merge, or data write was performed.
