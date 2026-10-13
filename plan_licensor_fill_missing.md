# Run plan: licensor fill-in via reprocess-metadata (fill-missing-licensing mode)

Issue: u2giants/popdam3#357. Code on main (4fb0b89c or later): PR #359 fill-only mode, plus ColdLion fixes #372, #374, #375, #376.

## Operation
- Bulk operation key: `reprocess-metadata`, started through admin-api `update-bulk-op` with `params.mode = "fill-missing-licensing"`.
- Do NOT use the app's "Reprocess Metadata" button. It sends no params and runs the full, unguarded mode, which also rewrites size, division, sku_sequence, mg01-03, is_licensed, and workflow_status.
- Fill-only: writes only the six licensing columns, each guarded on the column still being NULL. Never touches SKU, MG codes, is_licensed, or workflow.
- Scope: `is_deleted = false AND is_licensed = true AND licensor_id IS NULL`. Baseline Oct 12 2026 2:15 PM EDT: 138,655 assets total, 124,183 licensed with no licensor. Re-count at run start and record it.
- Walk: asset id keyset, ascending, using the stored cursor.
- Batch size: the worker sends batch_size 25 (apps/worker/src/handlers/metadata-reprocess.ts:21). The edge function caps at 200. Effective batch is 25. No count cap.
- Start seed: `{ "status": "running", "cursor": 0, "params": { "mode": "fill-missing-licensing" }, "progress": {} }`. Without `cursor` the worker fails the op as legacy_format.

## Prerequisites
1. The DAM scan (session 9381c755) has finished. admin_config SCAN_PROGRESS is not "running".
2. Freshness: the worker heartbeat `sha` (from RAILWAY_GIT_COMMIT_SHA or GIT_COMMIT_SHA) and the edge function deploy are main 4fb0b89c or later. A 10-asset sample resolves a licensor from the current ColdLion mirror.
3. Conflict guard: no other metadata-lane operation (including backfill-sku-names) is running or queued. The server checks only the operations listed in OP_CONFLICTS for reprocess-metadata, so this is checked by hand. No scan, ColdLion mirror sync, or ERP pass may be running, because they also write licensing columns.
4. Snapshot before any write: all six licensing columns plus size, division, sku_sequence, mg01-03, is_licensed, workflow_status, and style_group_changed_at (stamped by the assets_style_group_change_clock trigger whenever a licensing column changes) for every licensed asset, saved to a local file outside the repo. This is the rollback source for every column.
5. `ai-task-gates check --before database --reviewer-approval <assigned AI reviewer exact-head APPROVE report>` passes, with target-database proof on the issue. This run is not a small owner entry.

## Pilot (500 assets)
- Start the run with the seed above. Stop by the stop procedure once the stored cursor passes the 500th asset id in scope. The stop is checked every 10 batches of 25, so the pilot may fill up to about 250 assets beyond 500. Verification covers every row filled from run start to stop.
- Pass conditions, all required:
  - Fills greater than 0.
  - Every pilot asset whose ColdLion licensor resolves now has one. Record the unresolved count.
  - No non-NULL licensing value changed, checked against the snapshot.
  - No change to any non-licensing column in the snapshot.
- If any condition fails, do not start the full run.

## Stop procedure
- Read the current op_state, change only `status` to "interrupted" and `interruption_reason_code` to "user_stop", and write the full object back with update-bulk-op. Writing only the status can be auto-resumed.

## Full run
- Resume the same operation from its stored cursor. Do not set a manual id. A resume must write status "running", set interruption_reason_code to null, and keep cursor and params, because the worker auto-resume loop skips a user_stop reason. Use the same read-modify-write as the stop procedure.
- Stop by the stop procedure when: the op status becomes "failed" or "interrupted" without an operator pause (the worker exhausted its retries); any non-NULL licensing value changed; or any non-licensing column changed.
- Transient errors the worker auto-resumes do not stop the run. The operator checks status and error at each stored-cursor check.
- A cursor race can move the cursor back one batch on a stop. Re-scanning is idempotent because fill-only writes are NULL-guarded.

## Verification (read-only)
- Before the run: NULL-licensor count over the scope.
- Verification assumes this run is the only licensing writer during its window. Prerequisite 3 enforces that. If any other writer touches a row during the window, the verification must show it and the run stops.
- After the pilot and after the full run, against the full snapshot, not only the pilot:
  - Rows where a non-NULL licensing value changed. Expect 0.
  - Rows where a non-licensing column changed. Expect 0.
  - NULL-licensor count after the run. Expect the fall to equal the number of rows filled. Report the unresolved count.

## Rollback
- Fill-only never overwrites a non-NULL value, so the run cannot overwrite data.
- Rollback restores style_group_changed_at to its snapshot value for each restored row too.
- Undo for licensing columns is a column-level restore, applied only to rows that the verification shows this run changed: for each asset and licensing column that was NULL in the snapshot and is non-NULL now, set only that column back to NULL.
- If any non-licensing column changed, restore that column from the snapshot the same way.
- The expected row count for the guarded transaction is the number of rows that differ between the snapshot and now, computed before the write.
- Rollback runs only after proving the target database and passing `ai-task-gates check --before database` with the same approval rule as prerequisite 5.
