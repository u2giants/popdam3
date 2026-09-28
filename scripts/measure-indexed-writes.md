# Indexed-write measurement for app issue #169

This is an opt-in, read-only observer. It never starts a crawl, invokes a bridge refresh, changes database settings, or writes to the database. It records row identifiers and indexed column values only in a private scratch directory outside this repository. Do not attach that directory or its files to an issue or pull request.

## Before an independently authorized representative workload

Use the documented production **session pooler** `aws-1-us-east-1.pooler.supabase.com:5432`, with username `supabase_read_only_user.qsllyeztdwjgirsysgai` and database `postgres`. The direct host resolves only to IPv6 here and is not reachable from this machine; the session pooler resolves to IPv4 and accepted a TCP connection in the authoring check. Supply the database URL only through `POP_MEASURE_READONLY_DATABASE_URL`, never on a command line. Supply the production Supabase CA certificate downloaded from the project Database Settings page through `POP_MEASURE_SUPABASE_CA_FILE`. The observer requires certificate and hostname verification; it does not accept an SSL downgrade parameter. The runtime also rechecks the role, database, transaction read-only state, project identity, live primary key, every index definition and dependency, and the table counters. Give each table and workload its own scratch directory, owned by the current user with mode `0700`.

```text
node scripts/measure-indexed-writes.mjs before --table public.style_guide_files --dir /private/outside/repository/measurement
```

The supported tables are `public.style_guide_files`, `public.assets`, and `plm.style_tracker_item_bridge`. `public.dam_search_documents` is excluded from attributed reports because its database triggers and worker refreshes have no complete operation receipt. It needs a separate, governed observer plan. The default row bound is 500,000; a larger explicit `--max-rows` may be set up to 2,000,000. If the bound is exceeded, stop and replan instead of weakening protections. The observer needs a consistent read-only snapshot and may be expensive for a large table; schedule the read accordingly.

The edge-function aggregate hooks are disabled unless `POP_INDEXED_WRITE_MEASUREMENT=1` on that runtime. The Style Tracker browser aggregate hook is disabled unless the built app has `VITE_POP_INDEXED_WRITE_MEASUREMENT=1`. The hooks emit timestamped attempted/succeeded counts only, never row identifiers or values. Neither flag is enabled by this script or this change. Copy the actual hook records into a private `0600` JSON receipt, preserving their timestamps and counts, and record the deployed source commit. A failed or unknown attempt makes the measurement inconclusive; do not substitute an estimate.

## After the workload

Create a private `0600` JSON operation file with this shape, using only counts from the actual result receipt. The three receipt files must exist, be owned by the current user with mode `0600`, and have the stated SHA-256 hashes. The single-writer receipt must contain independently checked evidence that no other writer touched the target table during the window. A separate reset-window receipt must attest, from independent operational evidence, that no table-specific statistics reset occurred during the window. PostgreSQL exposes no per-table reset timestamp, so the runner cannot validate this from table counters or database reset timestamps. If either attestation cannot be independently established, the counter attribution remains inconclusive. Do not claim a single-writer or reset-free window from table counters alone.

```json
{
  "name": "one representative full crawl",
  "paths": ["crawl-upsert", "crawl-reconcile"],
  "source_commit": "40-lowercase-hex-character-deployed-commit",
  "attempted_rows": 0,
  "succeeded_rows": 0,
  "result_receipt_path": "/private/outside/repository/result-receipt",
  "result_receipt_sha256": "64-lowercase-hex-character-sha256",
  "single_writer_receipt_path": "/private/outside/repository/single-writer-receipt",
  "single_writer_receipt_sha256": "64-lowercase-hex-character-sha256",
  "reset_window_receipt_path": "/private/outside/repository/reset-window-receipt",
  "reset_window_receipt_sha256": "64-lowercase-hex-character-sha256"
}
```

The result receipt is a private JSON object of the form `{"events":[{"observed_at":"2026-09-28T00:00:00.000Z","table":"public.style_guide_files","path":"crawl-upsert","attempted_rows":1,"succeeded_rows":1}]}`. Include every attempt for every listed path in the bounded window, including reconciliation calls and conditional asset style-group assignments. The observer recomputes totals from those events and rejects any event outside the interval between the finished before snapshot and started after snapshot. Verify the receipt against the original platform logs; the observer cannot authenticate a copied log by itself.

```text
node scripts/measure-indexed-writes.mjs after --dir /private/outside/repository/measurement --operation /private/outside/repository/operation.json
```

The observer writes a candidate `report.json` only when the live index inventory is unchanged; observable database/server reset identities are unchanged; no row disappeared; changed rows have one update each; inserted rows and update totals match the table deltas; actual success counts match table writes; and protected writer and reset-window receipts are supplied. A table-specific reset may still escape those counters. The report contains aggregates and receipt hashes, never row identifiers or values. It explicitly requires independent writer, reset-window, result-receipt, and representative-workload review before counter attribution or a storage decision. A supplied receipt hash proves file integrity, not the truth of its contents. The observer cannot establish a representative workload by itself.

The public Style Tracker refresh can perform a second designer-resolution update on a bridge row. Asset ingestion can also update the same asset again during style-group assignment. Such repeated writes cannot be classified from only two snapshots; the runner rejects the window instead of mislabeling it. An attributed measurement of those cases needs a separate per-write observer design. Search-document refreshes are excluded for the same reason until every writer has a complete receipt.
