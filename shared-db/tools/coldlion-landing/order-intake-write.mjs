#!/usr/bin/env node
// order-intake-write.mjs — the ColdLion order-intake CANONICAL WRITER
// (plan_coldlion_order_intake.md §9 C2). Runs AFTER the poller
// (order-intake.mjs), which stays claim-only: this separate script is the
// only intake step that writes plm.production_order(_line) and their source
// refs.
//
// The scheduled trigger stays DISABLED until Phase F's live proof passes, and
// the first enablement is a bounded event (plan B0): --limit bounds the
// orders this run may claim, and the staged dispatch ladder (preview dry-run
// → preview dispatch → ONE bounded production dispatch) owns every
// enablement step — nothing here enables or dispatches anything.
//
//   --write          commit the canonical writes. WITHOUT it the identical
//                    transaction executes and ROLLS BACK: a true rehearsal of
//                    the real path (same plans, same constraints) that writes
//                    nothing anywhere — not even the run's sync_run row.
//   --limit <n>      claim at most n pending orders this run (B0 bounded
//                    enablement; deterministic by ascending sales_order_no)
//   --order <so>     claim exactly one sales order (preview gate, targeted
//                    recovery). salesOrderNo = 0 is refused — it is
//                    quarantined upstream and must never mint COLDLION-SO-0.
//
// Idempotency is source-ref-only (§8): a second --write run over the same
// pending set changes nothing — created orders leave the pending state, and
// the SQL's IS DISTINCT FROM update guards fire zero rows even if an order is
// re-pended. Every google_order_list ref stays untouched.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isClientSpawnFault, proveTarget, queryRows, runSql } from "./lib/db.mjs";
import {
  buildWriteFailureSql,
  buildWriteSql,
  buildWriterObjectAssertionSql,
  parseWriteSummary,
} from "./lib/order-intake-write.mjs";

export function parseArgs(argv) {
  const options = { write: false, limit: null, order: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") options.write = true;
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--order") options.order = Number(argv[++i]);
    else {
      console.error(`unknown argument ${arg}`);
      process.exit(2);
    }
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    console.error("--limit must be a positive integer");
    process.exit(2);
  }
  if (options.order !== null && (!Number.isSafeInteger(options.order) || options.order <= 0)) {
    console.error("--order must be a positive sales order number (salesOrderNo = 0 is never written)");
    process.exit(2);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // PROVE THE TARGET before anything: an undeclared database is refused, and
  // the write path additionally proves its exact objects (the two canonical
  // tables beside everything the poller asserts) — a write into a database
  // missing them is a write into nothing (Phase B round-2 M-1 discipline).
  proveTarget();
  {
    // A healthy database answers with one EMPTY string (nothing missing), and
    // queryRows drops empty lines, so ZERO rows is the healthy shape here —
    // never destructure the row away (an empty result would make the inner
    // destructure read `undefined is not iterable` and refuse a healthy DB).
    const [row] = queryRows(buildWriterObjectAssertionSql(), {});
    const missingObjects = row?.[0] ?? "";
    if (missingObjects.trim()) {
      console.error(`refusing to write: required database objects are missing: ${missingObjects}`);
      process.exit(2);
    }
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const sql = buildWriteSql({
    runId,
    write: options.write,
    limit: options.limit,
    order: options.order,
    startedAt,
  });

  let summary;
  try {
    summary = parseWriteSummary(runSql(sql, {}));
  } catch (error) {
    // The failure recorder is the §8 SIBLING, never recordFailure() itself:
    // a failed sync_run row + the alert, with no window_ledger write (that
    // would poison sealed-window resume). A client-side spawn fault says
    // nothing about the data or the database and is not recorded as one.
    // A run WITHOUT --write records NOTHING anywhere (round-3 review #10):
    // its transaction already rolled back, and a post-rollback parse failure
    // inserting a failed sync_run row would be a write on a dry run.
    if (options.write && !isClientSpawnFault(error)) {
      try {
        runSql(buildWriteFailureSql({ runId, error, startedAt }), {});
      } catch (recordError) {
        error.message = `${error.message} (and the failure could not be recorded: ${recordError.message})`;
      }
    }
    throw error;
  }

  console.log(
    `canonical write ${options.write ? "" : "(dry run — nothing written) "}complete: ` +
      `ordersCreated=${summary.orders_created} ordersQuarantined=${summary.orders_quarantined} ` +
      `ordersLeftPending=${summary.orders_left_pending} ` +
      `headers+${summary.headers_inserted}/~${summary.headers_updated} ` +
      `lines+${summary.lines_inserted}/~${summary.lines_updated}` +
      (options.order !== null ? ` (order ${options.order})` : "") +
      (options.limit !== null ? ` (limit ${options.limit})` : ""),
  );
}

// Direct-run guard: main() runs only when this file is the node entry point,
// so tests import parseArgs without writing anything (the Phase B round-4
// L-4 lesson).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
