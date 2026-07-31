# Advisory-lock registry (shared Supabase database)

PostgreSQL advisory locks are **global to the database and keyed only by a number**.
Nothing in the database validates them, nothing names them, and nothing warns you when two
unrelated features pick the same key. When that happens the symptom is not an error — it is
two features mysteriously blocking each other, or a `pg_try_*` call returning `false` for a
reason that appears nowhere in either feature's code.

Every app in POP Creations shares one database, so this file is the registry. **Before
introducing a new advisory lock, add its key here. Before choosing a key, read the table.**

## Rules

1. **Literal constants for singleton lane locks.** Do not derive a singleton key with
   `hashtext('some.function')`. `hashtext()` is only guaranteed stable *within* a PostgreSQL
   major version, so an upgrade can silently move the lock and let two runs interleave with
   no code change and no visible signal anywhere. Derived keys are fine for **per-row**
   locks, where the point is a key per entity rather than a stable global identity.
2. **Transaction-scoped (`pg_*_advisory_xact_lock`) by default.** The lock is released by
   `COMMIT` or `ROLLBACK`, so a crashed, cancelled or timed-out session cannot leave a lane
   wedged. Session-scoped locks need an explicit unlock and a documented reason.
3. **`try`, not a blocking wait, for scheduled work.** A scheduled job that queues behind a
   long-running one applies a plan computed against a snapshot that has since moved. Prefer
   "skip this cycle and report it" over "wait and then act on stale input".
4. **Losing the race is never a silent no-op.** This repository forbids silent failures.
   A skipped run must be durably recorded and must be distinguishable, by the caller, from
   both success and failure — including by the alerting that watches it.

## Registered keys

| Key | Scope | Owner | Purpose |
|---|---|---|---|
| `720260729` | transaction, `try` | `plm.promote_coldlion_source_owned` | Serializes the ColdLion Licensor/Property **recurring promotion lane** (Step 7A). The lane is driven both by a scheduled GitHub Actions workflow and by manual drills; without this, a drill and a scheduled run could promote the same mirror rows concurrently and write two overlapping `ingest.sync_run` rows plus duplicate `plm.coldlion_promotion_audit` entries for the same field. Digits encode the lane: `7` = Step 7A, `20260729` = the date the recurring promotion shipped. Added 2026-07-31 by `supabase/migrations/20260731180000_coldlion_recurring_promotion_serialization_lock.sql`. |
| `21450` + `sample_id_fk` | transaction, blocking | sample-movement trigger (`20260722221400_sample_tracking_movements_and_closeouts.sql`) | Per-sample serialization of movement/closeout accounting. Two-argument form, so the second int is the row identity, not a second lane. |

### Derived (per-row) keys — not singleton lanes

These use `hashtextextended(<entity uuid>, <classifier>)`, i.e. a key **per row pair**, so
rule 1 does not apply. They are listed so the classifiers are not reused with a different
meaning.

| Classifier | Owner | Purpose |
|---|---|---|
| `0`, `1` | `20260722004500_db_data_admin_merge_fk_coverage.sql` | DB Data Admin merge FK coverage — locks the loser/survivor pair in a fixed order to avoid deadlock. |
| `10` (customer), `11` (vendor) | `20260722194000_db_data_admin_merge_workflow.sql` | DB Data Admin merge workflow, same loser/survivor ordering discipline. |

## What "skipped" looks like on the ColdLion promotion lane

The one lane with a documented skip contract, as of 2026-07-31:

- **Database** — `plm.promote_coldlion_source_owned` commits an `ingest.sync_run` row with
  `status = 'cancelled'` (not `failed`), `source_name = coldlion_licensors_properties_promote_source_owned`,
  and `metadata.outcome = 'skipped_already_running'`; it returns `mode = 'skipped_already_running'`
  with every count zero, and raises a `warning` naming the run id and the lock key.
- **Runner** — `tools/promote-coldlion-source-owned.mjs` exits **3**, distinct from success
  (`0`) and failure (`1`).
- **Alerting** — nothing fires. The skip path never calls `record_taxonomy_sync_alert` and
  never writes a `failed` row, so it cannot contribute to the **two-consecutive-failure**
  `pg_notify('coldlion_sync_alert', …)` breaker in `tools/coldlion-sync-common.mjs`. That
  separation is the whole point: two healthy overlapping cycles must not manufacture an
  outage by tripping the breaker.
- **Workflow** — the `promote` step in
  `.github/workflows/coldlion-licensor-property-production.yml` maps exit 3 to a green job
  with a `::notice::`. (That workflow remains **disabled**; this mapping is part of its
  standing contract, not an enablement.)
