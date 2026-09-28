# Indexed-write measurement for app issue #169

This is an opt-in, read-only observer. It never starts a crawl, invokes a bridge refresh, changes database settings, or writes to the database. It records row identifiers and indexed column values only in a private scratch directory outside this repository. Do not attach that directory or its files to an issue or pull request.

## Before an independently authorized representative workload

Use the documented production **session pooler** `aws-1-us-east-1.pooler.supabase.com:5432`, with username `supabase_read_only_user.qsllyeztdwjgirsysgai` and database `postgres`. The direct host resolves only to IPv6 here and is not reachable from this machine; the session pooler resolves to IPv4 and accepted a TCP connection in the authoring check. Supply the database URL only through `POP_MEASURE_READONLY_DATABASE_URL`, never on a command line. Supply the production Supabase CA certificate downloaded from the project Database Settings page through `POP_MEASURE_SUPABASE_CA_FILE`. The observer requires certificate and hostname verification; it does not accept an SSL downgrade parameter. The runtime also rechecks the role, database, transaction read-only state, project identity, live primary key, every index definition and dependency, and the table counters. Give each table and workload its own scratch directory, owned by the current user with mode `0700`.

```text
node scripts/measure-indexed-writes.mjs before --table public.style_guide_files --dir /private/outside/repository/measurement
```

The supported tables are `public.style_guide_files`, `public.assets`, `public.dam_search_documents`, and `plm.style_tracker_item_bridge`. The default row bound is 500,000; a larger explicit `--max-rows` may be set up to 2,000,000. If the bound is exceeded, stop and replan instead of weakening protections. The observer needs a consistent read-only snapshot and may be expensive for a large table; schedule the read accordingly.

The edge-function aggregate hooks are disabled unless `POP_INDEXED_WRITE_MEASUREMENT=1` on that runtime. The Style Tracker browser aggregate hook is disabled unless the built app has `VITE_POP_INDEXED_WRITE_MEASUREMENT=1`. The hooks emit timestamped attempted/succeeded counts only, never row identifiers or values. Neither flag is enabled by this script or this change. Copy the actual hook records into a private `0600` JSON receipt, preserving their timestamps and counts, and record the deployed source commit. A failed or unknown attempt makes the measurement inconclusive; do not substitute an estimate.

## After the workload

Create a private `0600` JSON operation file with this shape, using only counts from the actual result receipt. The two receipt files must exist, be owned by the current user with mode `0600`, and have the stated SHA-256 hashes. The single-writer receipt must contain independently checked evidence that no other writer touched the target table during the window. Do not claim a single-writer window from table counters alone.

```json
{
  "name": "one representative full crawl",
  "path": "crawl-upsert",
  "source_commit": "40-lowercase-hex-character-deployed-commit",
  "attempted_rows": 0,
  "succeeded_rows": 0,
  "result_receipt_path": "/private/outside/repository/result-receipt",
  "result_receipt_sha256": "64-lowercase-hex-character-sha256",
  "single_writer_receipt_path": "/private/outside/repository/single-writer-receipt",
  "single_writer_receipt_sha256": "64-lowercase-hex-character-sha256"
}
```

The result receipt is a private JSON object of the form `{"events":[{"observed_at":"2026-09-28T00:00:00.000Z","table":"public.style_guide_files","path":"crawl-upsert","attempted_rows":1,"succeeded_rows":1}]}`. Include every attempt for this path in the bounded window. The observer recomputes totals from those events and rejects any event outside the interval between the finished before snapshot and started after snapshot. Verify the receipt against the original platform logs; the observer cannot authenticate a copied log by itself.

```text
node scripts/measure-indexed-writes.mjs after --dir /private/outside/repository/measurement --operation /private/outside/repository/operation.json
```

The observer writes `report.json` only when the live index inventory is unchanged; statistics have not reset; no row disappeared; changed rows have one update each; inserted rows and update totals match the table deltas; actual success counts match table writes; and a protected single-writer receipt is supplied. The report contains aggregates and receipt hashes, never row identifiers or values. It marks attribution as requiring independent receipt review. A matching aggregate cannot itself prove there were no other writers, so review the protected receipts before using the report for a storage decision. The observer cannot establish a representative workload by itself.
