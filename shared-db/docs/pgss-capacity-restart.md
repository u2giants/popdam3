---
summary: "Fixed #5609 pg_stat_statements.max=40000 capacity increase and controlled Postgres restart (preview-first, NY window)."
kind: ops
status: current
read-when: "reviewing or executing the fixed pg_stat_statements.max capacity increase and controlled restart for issue 5609"
---

# Fixed statement-capacity increase and controlled restart for issue 5609

Owner: the coordinator of [issue 5609](https://github.com/popcre/shared-db/issues/5609).
Statement-entry eviction at `pg_stat_statements.max = 5000` invalidated complete
acceptance observations. Because `pg_stat_statements.max` has `context = postmaster`,
increasing it to `40000` requires a controlled Postgres restart via Supabase's
Management API (`PUT /v1/projects/{ref}/config/database/postgres` with
`restart_database: true`). Retire this route after effective capacity `40000` is
independently verified and issue 5609 is accepted.

## Scope, modes, and safety controls

- Fixed operation: `config/pgss-capacity-restart.json` authorizes only
  `pg-stat-statements-capacity-restart/v1`, `work_issue = 5609`,
  `pg_stat_statements.max = 40000`, `restart_database = true`. Its `source_pr`
  must be set to the actual positive PR number before merge.
- Explicit mode input on `.github/workflows/apply-pgss-capacity-restart.yml`:
  - `preview_only` (default): rehearses the full config override merge,
    controlled restart, and post-restart verification on preview only.
  - `preview_and_production`: runs preview first; production runs only after a
    same-run, same-attempt, same-source, same-plan preview receipt proves
    preview reached `effective_capacity = 40000` with `pending_restart = false`.
- Maintenance window guard: the `production` target fails closed outside the
  owner-authorized New York disruptive window (**Friday 6:00 PM through Sunday
  5:00 AM `America/New_York`**). Preview rehearsal may run at any time.
- Native locking: uses existing `preview-maintenance` and `production` exclusive
  refs via `scripts/pgss-restart-exclusive.mjs` without introducing a new lock lane.
- Override preservation: reads `GET /config/database/postgres`, verifies no
  concurrent drift immediately before `PUT`, preserves every other existing
  override verbatim, and sends at most one `PUT`.
- Post-restart verification: polls read-only catalog (`supabase_read_only_user`,
  `transaction_read_only = on`) until `pg_postmaster_start_time()` advances,
  `pg_stat_statements.max = '40000'`, `pending_restart = false`, and all four
  protected #5610 indexes remain `valid = true, ready = true` with exact
  production OIDs and definition MD5s.
- Privacy: receipts contain only hashes, target fingerprints, and bounded
  numeric/boolean fields; no secrets, tokens, raw vendor responses, or project
  identifiers are printed.
