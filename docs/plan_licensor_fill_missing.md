# Run plan: licensor fill-in via reprocess-metadata (fill-missing-licensing mode)

Issue: u2giants/popdam3#357. Code on main (4fb0b89c): PR #359 (ad5434f) fill-only mode, plus ColdLion fixes #372, #374, #375, #376.

## Operation
- Bulk operation key: `reprocess-metadata` (admin-api `update-bulk-op`), with `params.mode = fill-missing-licensing`.
- Fill-only: writes only the six licensing columns, each guarded on the column still being NULL. Never touches SKU, MG codes, is_licensed, or workflow.
- Scope: `is_deleted = false` AND `is_licensed = true` AND licensor IS NULL. Baseline at Oct 12 2026 2:15 PM EDT was 138,655 assets total and 124,183 licensed with no licensor. Re-count at run start and record it.
- Walk: asset id keyset, ascending, using the operation's stored cursor.
- Batch size: the worker sends batch_size 25 (apps/worker/src/handlers/metadata-reprocess.ts:21); the edge function caps at 200. The effective batch is 25. The run does not use a count cap.

## Pre-run prerequisites
1. The DAM scan (session 9381c755) has finished. Verify in admin_config SCAN_PROGRESS status is not running.
2. `ai-task-gates check --before database` passes, with target-database proof recorded on the issue.
3. Full snapshot before any write: all six licensing columns plus SKU, MG codes, is_licensed, and workflow for the entire scope and for all licensed assets, saved to a local file outside the repo. This is the rollback source.

## Pilot (500 assets)
- Start the run. Stop the operation (update-bulk-op status change to stopped) once the stored cursor passes the 500th asset id in scope. Record that id.
- Pass conditions, all required:
  - Fills greater than 0.
  - Every pilot asset whose ColdLion licensor resolves now has one. Count unresolved assets and record them.
  - No non-NULL licensing value changed, checked against the snapshot for the 500 pilot assets.
  - No change to SKU, MG codes, is_licensed, or workflow on the pilot assets.
- If any condition fails, stop and do not start the full run.

## Full run
- Resume the same operation from its stored cursor, not a manual id.
- Stop immediately on: any batch error; any non-NULL licensing value changed; any change outside the six licensing columns.

## Verification (read-only)
- Before the run: NULL-licensor count over the scope.
- After the pilot and after the full run, against the full snapshot, not only the pilot:
  - Count of rows where a non-NULL licensing value changed. Expect 0.
  - Count of rows where SKU, MG codes, is_licensed, or workflow changed. Expect 0.
  - NULL-licensor count after the run. Expect a fall equal to the number of rows filled, reported with the unresolved count.

## Stop conditions
- Pilot pass conditions fail.
- Any batch error.
- Any changed non-NULL licensing value or changed non-licensing column.
- Scan still running at the time of the run.

## Rollback
- Fill-only means a previously non-NULL value is never overwritten, so overwrite cannot happen.
- Undo is a targeted restore: for each asset in the full snapshot that had NULL licensing values, set the columns that are now non-NULL back to NULL. Rows that were already filled before the run are not touched.
- The rollback runs only after proving the target database and as a guarded transaction that asserts the expected row count, through ai-task-gates check --before database.
