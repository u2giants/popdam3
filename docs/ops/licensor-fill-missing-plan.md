# Run plan: licensor fill-in (fill-missing-licensing)

Issue: u2giants/popdam3#357. Code: merged PR #359 (ad5434f) plus ColdLion fixes #372/#374/#375/#376 (main 4fb0b89c).

## Operation
- Operation name: `fill-missing-licensing`, run via admin-api `update-bulk-op` with `params.mode=fill-missing-licensing`.
- Mode: fill-missing-only. Writes only NULL licensing columns, each guarded on the column still being NULL. Never touches SKU, MG codes, is_licensed, or workflow.
- Scope query: licensed assets whose licensor is NULL. Baseline at Oct 12 2026 2:15 PM EDT: 138,655 assets total, 124,183 licensed with no licensor.
- Walk order: asset id keyset, ascending.

## Pilot
- First 500 assets by id keyset, in batches of 200, 200, 100.
- Before the pilot, snapshot every licensing and SKU column for the 500 assets to a local file outside the repo.
- Pass condition: every pilot asset that had a resolvable ColdLion licensor now has one; no non-NULL value changed; no SKU, MG, is_licensed, or workflow column changed.

## Full run
- Starts after the pilot passes, from the pilot's last id.
- Batches of 200 via keyset, until the walk reports complete.
- Batch-level stop: stop on any batch error, any change to a non-NULL value, or any change outside the licensing columns.

## Verification queries (read-only, before and after)
- Count of licensed assets with NULL licensor: expect to fall from 124,183 by the number of newly filled rows.
- Count of rows whose non-NULL licensing values changed versus the snapshot: expect 0.
- Count of changes in SKU, MG, is_licensed, or workflow columns versus the snapshot: expect 0.

## Stop conditions
- Pilot fails its pass condition.
- Any batch returns an error.
- Any non-NULL licensing value changes.
- The DAM scan (session 9381c755) is still running at the time of the run.

## Rollback
- The operation writes only into NULL columns, so no existing value is overwritten.
- To undo, restore the NULL state of the filled columns from the pre-run snapshot, row by row, after proving the target database. Rollback is therefore a targeted NULL restore, not a full rewrite.
