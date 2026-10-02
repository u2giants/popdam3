#!/usr/bin/env node
// order-intake.mjs — the ColdLion automatic order intake poll (plan_coldlion_order_intake.md §9 B1).
//
// Replaces Adam's manual Google OrderList typing: within the business day after
// JamieLynn keys a sales order into the ColdLion ERP, canonical order rows exist
// in plm.production_order(_line). JamieLynn's ERP entry stays manual (owner
// ruling 2026-09-17).
//
// This entry point POLLS, STAGES, DETECTS, and then runs the C1 decode step
// (buildDecodeSql) as its own transaction in the same process — so a future
// writer bug can never block staging. The CANONICAL WRITER is Phase C2
// (order-intake-write.mjs, not yet built): it is a separate script, so this
// entry point never writes canonical rows.
//
//   --dry-run            write NOTHING anywhere — not even failure records
//                        (it still READS: the declared-target proof connects
//                        read-only and the vendor fetch needs the API key, so
//                        the B1 gate-1 laptop rehearsal needs credentials but
//                        leaves no trace in any database)
//   --limit <n>          stop the scan after n NEW orders have been staged, so
//                        the first enablement is a bounded event (plan B0)
//   --claim-only         stage and decode, write no canonical rows. Every run
//                        of THIS entry point is claim-only by construction (the
//                        writer is C2); the flag fixes the B0 dispatch
//                        vocabulary now and is what the writer step will gate on
//                        when it lands — it is echoed in the run banner.
//   --today <YYYY-MM-DD> override the scan date (offline rehearsal / tests)
//
// The scheduled trigger stays DISABLED until Phase F's live proof passes (B0).

import { pathToFileURL } from "node:url";
import { COMPANY_CODE } from "./lib/scopes.mjs";
import { proveTarget, queryRows, runSql } from "./lib/db.mjs";
import { stageIntakeWindow } from "./lib/order-intake-run.mjs";
import { buildDecodeSql } from "./lib/order-intake-decode.mjs";
import { buildIntakeObjectAssertionSql } from "./lib/order-intake-stage.mjs";
import {
  trailingWindows,
  forwardWindows,
  forwardStopReached,
  recordStagedWindow,
  closesStagedMonth,
} from "./lib/order-intake-windows.mjs";

export function parseArgs(argv) {
  const options = { dryRun: false, claimOnly: false, limit: null, today: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--claim-only") options.claimOnly = true;
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--today") options.today = argv[++i];
    else {
      console.error(`unknown argument ${arg}`);
      process.exit(2);
    }
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    console.error("--limit must be a positive integer");
    process.exit(2);
  }
  if (options.today !== null && !/^\d{4}-\d{2}-\d{2}$/.test(options.today)) {
    console.error("--today must be YYYY-MM-DD");
    process.exit(2);
  }
  return options;
}

/**
 * The staged-row total one window contributed (round-4 H-1/L-4): reads the
 * stager's SNAKE_CASE keys — the SQL column names parseStageSummary returns —
 * through one exported, test-pinned helper instead of four inline reads. A
 * wrong key name here folds undefined into NaN, `NaN ?? 0` is still NaN, and
 * the forward stop rule silently never fires — so every read of these keys
 * goes through this helper or its sibling foldWindowResult below.
 */
export function stagedRowCount(result) {
  return result.lines_inserted + result.lines_updated + result.components_inserted + result.components_updated;
}

/**
 * Fold one staged window's result into the run summary. Same discipline as
 * stagedRowCount: the producer's snake_case keys map to the summary's
 * camelCase fields in exactly this one exported, test-pinned place.
 */
export function foldWindowResult(summary, result) {
  summary.windows += 1;
  summary.stagedOrders += result.ordersKept;
  summary.rowsFetched += result.fetched.rows;
  summary.linesInserted += result.lines_inserted;
  summary.linesUpdated += result.lines_updated;
  summary.componentsInserted += result.components_inserted;
  summary.componentsUpdated += result.components_updated;
  summary.newOrders += result.new_orders;
  if (result.new_order_numbers) summary.newOrderNumbers.push(...result.new_order_numbers.split(",").filter(Boolean));
  return summary;
}

/**
 * Read the object-assertion answer off queryRows' row list WITHOUT destructuring
 * the row away (round-0 live finding, generation 14): the assertion's HEALTHY
 * answer is an empty string, and psql prints an empty line for it, which
 * queryRows filters out — so zero rows is the healthy shape here, exactly as
 * the writer's identical pre-flight learned (order-intake-write.mjs, PR #3868:
 * "never destructure the row away (an empty result would make the inner
 * destructure read `undefined is not iterable` and refuse a healthy DB)").
 * The old `const [[missingObjects]] = ...` form crashed the FIRST real run
 * (preview, 2026-10-02) before any window was fetched — on a database where
 * every required object was present.
 */
export function missingObjectsFromRows(rows) {
  const [row] = Array.isArray(rows) ? rows : [];
  return row?.[0] ?? "";
}

async function main() {
  const apiKey = process.env.COLDLION_API_KEY;
  if (!apiKey) {
    console.error("COLDLION_API_KEY is not set; refusing to poll");
    process.exit(2);
  }
  const options = parseArgs(process.argv.slice(2));
  // PROVE THE TARGET before anything: an undeclared database is refused.
  proveTarget();
  // And prove the OBJECTS: proveTarget only checks the project ref and that the
  // coldlion schema has some table; the intake needs exact tables and
  // constraints, and a load into a database missing them is a load into nothing
  // (round-2 review M-1). Read-only, refused before the first window.
  if (!options.dryRun) {
    const missingObjects = missingObjectsFromRows(queryRows(buildIntakeObjectAssertionSql(), {}));
    if (missingObjects.trim()) {
      console.error(`refusing to poll: required database objects are missing: ${missingObjects}`);
      process.exit(2);
    }
  }

  // The grid and its window arithmetic are UTC (lib/grid.mjs); asOf follows the
  // grid, not a local business clock, so trailing/forward enumeration always
  // agrees with the sealed sync's windows (round-2 L-1: deliberate, not drift).
  const asOf = options.today ?? new Date().toISOString().slice(0, 10);
  const stagedByMonth = {};
  const summary = { windows: 0, rowsFetched: 0, linesInserted: 0, linesUpdated: 0, componentsInserted: 0, componentsUpdated: 0, newOrders: 0, newOrderNumbers: [], stagedOrders: 0 };
  // EVERY window's run id, not just the last: the decode step covers the SET,
  // because a poll that ends on the settled stop rule ends on an EMPTY window
  // whose id staged nothing (round-3 H-1).
  const runIds = [];
  let limitReached = false;

  // The remaining --limit budget, spent INSIDE each window too: the projection
  // is sliced to at most this many orders before any SQL is built, so the bound
  // caps rows written per window, not just windows processed (round-2 H-2). The
  // budget counts TOTAL orders staged this dispatch (new detections are a
  // subset of staged), so even a poll that detects nothing novel stays bounded:
  // with --limit n, at most n orders' rows are written per DISPATCH across all
  // windows (round-3 M-4) — "at most n new orders" (plan B0) follows because
  // new never exceeds staged.
  const remainingLimit = () => (options.limit === null ? null : Math.max(0, options.limit - summary.stagedOrders));

  const scan = async (window, track) => {
    const result = await stageIntakeWindow({
      window,
      track,
      apiKey,
      companyCode: COMPANY_CODE,
      dryRun: options.dryRun,
      maxStageOrders: remainingLimit(),
    });
    runIds.push(result.runId);
    foldWindowResult(summary, result);
    if (track === "forward") {
      recordStagedWindow(stagedByMonth, window, stagedRowCount(result));
    }
    console.log(
      `${track} ${window.from}..${window.to}: fetched=${result.fetched.rows} lines+${result.lines_inserted}/~${result.lines_updated} components+${result.components_inserted}/~${result.components_updated} ep001=${result.excludedEp001} new=${result.new_orders}${result.sliced ? ` (limit-sliced to ${result.ordersKept} orders)` : ""}${options.dryRun ? " (dry run — nothing written)" : ""}`,
    );
  };

  // B0's bounded enablement: the scan stops as soon as n NEW orders have been
  // staged (counted at INSERT only — a re-observed order is not a new
  // detection), even mid-track. Staging is idempotent by identity + source
  // hash, so the next unbounded run loses nothing.
  const limitReachedNow = () => options.limit !== null && summary.stagedOrders >= options.limit;

  // Trailing re-read first: the closed weeks most likely to have absorbed late
  // corrections, plus the open current week.
  for (const window of trailingWindows(asOf)) {
    await scan(window, "trailing");
    if (limitReachedNow()) { limitReached = true; break; }
  }

  // Forward horizon: grid windows after today's, until two consecutive empty
  // STAGED months (Settled 2026-09-17) or the 18-month cap. A month is only
  // known empty once ALL its windows are scanned, so the rule is evaluated
  // exclusively at month boundaries (closesStagedMonth).
  if (!limitReached) {
    const forward = forwardWindows(asOf);
    let next = forward.next();
    while (!next.done) {
      const window = next.value;
      await scan(window, "forward");
      next = forward.next();
      if (limitReachedNow()) { limitReached = true; break; }
      if (closesStagedMonth(window, next.done ? null : next.value) && forwardStopReached(stagedByMonth)) {
        console.log(`forward scan stopped: two consecutive empty staged months (${Object.keys(stagedByMonth).sort().slice(-2).join(", ")})`);
        break;
      }
    }
  }
  if (limitReached) {
    console.log(`--limit ${options.limit} reached after staging ${summary.stagedOrders} order(s) (${summary.newOrders} new); scan stopped early (B0 bounded enablement)`);
  }

  // C1 decode step — its own transaction, after staging, in this same process.
  // Skipped on --dry-run (nothing was staged, so there is nothing to decode) and
  // only run when at least one window staged (lastRunId names the sync_run row
  // whose id carries the quarantine FK). --claim-only does NOT skip this: the
  // plan's claim-only means "stage and decode, write no canonical rows".
  if (!options.dryRun && runIds.length) {
    const decodeSummary = runSql(buildDecodeSql({ runIds, quarantineRunId: runIds[runIds.length - 1] }), {});
    // Four numeric columns (aligned or tab-separated): zero_so_quarantined,
    // new_unknown_codes, orders_quarantined, orders_decoded.
    const row = String(decodeSummary ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.split(/[|\t]/).length === 4 && line.split(/[|\t]/).every((field) => /^\d+$/.test(field.trim())))
      .at(-1);
    const [zeroSo, newUnknown, quarantined, decoded] = row ? row.split(/[|\t]/).map((field) => field.trim()) : ["?", "?", "?", "?"];
    console.log(`decode: zero_so=${zeroSo} new_unknown_codes=${newUnknown} quarantined=${quarantined} decoded=${decoded}`);
  }

  console.log(
      `intake ${options.dryRun ? "dry-run " : ""}scan complete:${options.claimOnly ? " (claim-only — canonical writer is Phase C2)" : ""} windows=${summary.windows} fetched=${summary.rowsFetched} stagedOrders=${summary.stagedOrders} newOrders=${summary.newOrders}${summary.newOrderNumbers.length ? ` (${summary.newOrderNumbers.slice(0, 20).join(",")}${summary.newOrderNumbers.length > 20 ? "…" : ""})` : ""}`,
  );
}

// Direct-run guard (round-4 L-4): main() runs only when this file is the node
// entry point, so tests can import foldWindowResult/stagedRowCount/parseArgs
// without triggering a poll. This module kept auto-running main() on import
// through three review rounds — the structural reason the H-1 key-name bug had
// no test that could ever have caught it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
