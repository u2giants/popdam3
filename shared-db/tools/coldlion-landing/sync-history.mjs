#!/usr/bin/env node
// The scheduled ongoing history sync.
//
//   node tools/coldlion-landing/sync-history.mjs [--windows 3] [--to 2026-09-07] [--forward]
//                                                [--today YYYY-MM-DD]   (tests/rehearsal: the scan date)
//
// It re-fetches the most recent N CLOSED grid windows every run, because a window that is
// already loaded is skipped and a window that is not is completed.
//
// THE CURRENT WEEK IS NEVER LOADED. Loading a window seals it: the ledger declines it
// afterwards and the database forbids adding page evidence to a loaded window. So a
// window fetched on the first of its seven days would be a permanently incomplete week
// that the ledger reports as complete, and every order written over the remaining six
// days would be lost with no trace. The newest window this ever touches is the one that
// has finished, which means the feed trails real time by up to a week by design.
//
// Trailing more than one closed window is still deliberate: a run that failed, a window
// the vendor refused, and an outage all leave older windows unloaded, and this is what
// completes them without anybody having to notice.
//
// It never marks a loaded window dirty and it never rewrites page evidence. Picking up a
// row that CHANGED after its window closed is the change-log unit's job, not this one's.
//
// --forward adds the FORWARD SCAN for /orderHistory (Settled rule "Forward-scan horizon",
// Albert, 2026-09-17: scan forward until consecutive empty months). Sales orders carry
// future start dates and the vendor filters windows by start date, so new orders appear
// only in windows that have not closed. Those windows -- the open current week and every
// later grid window -- are loaded UNSEALED (no window_ledger row, no page evidence; see
// load-window.mjs), so the sealed rule above still holds for each of them once it closes.
// The scan stops after FORWARD_EMPTY_MONTH_STOP consecutive start-date months that land
// no sales-order line, or at the FORWARD_HARD_CAP_MONTHS horizon (order-intake-windows.mjs
// owns both constants, shared with the order-intake poll).

import { readColdlionApiKey } from "../coldlion-sync-common.mjs";
import { isoDate, lastClosedWindowIndex, windowAtIndex, windowsEndingAt } from "./lib/grid.mjs";
import { proveTarget } from "./lib/db.mjs";
import { COMPANY_CODE, PAGE_SIZE } from "./lib/scopes.mjs";
import { allScopes, assertHistoryShape, ledgerKey, loadWindowScope, loadedWindows, scopeLabel } from "./lib/run-history.mjs";
import { ORDER_HISTORY } from "./lib/scopes.mjs";
import {
  closesStagedMonth,
  forwardStopReached,
  forwardWindows,
  recordStagedWindow,
} from "./lib/order-intake-windows.mjs";
import { parseIsoDate, windowContaining } from "./lib/grid.mjs";

export const DEFAULT_WINDOWS = 3;

export function parseArgs(argv) {
  const args = { windows: DEFAULT_WINDOWS, company: COMPANY_CODE, pageSize: PAGE_SIZE, dryRun: false, forward: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--windows": args.windows = Number(value); index += 1; break;
      case "--to": args.to = value; index += 1; break;
      case "--company": args.company = value; index += 1; break;
      case "--page-size": args.pageSize = Number(value); index += 1; break;
      case "--dry-run": args.dryRun = true; break;
      case "--forward": args.forward = true; break;
      case "--today": args.today = value; index += 1; break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  // CLAMPED, exactly as the backfill clamps it. `--to` names the newest window to
  // LOAD and is clamped to a window that has already closed. A future `--to` must
  // never be obeyed: the vendor returns an empty envelope, completion is "proved",
  // and an unloaded week is silently sealed as loaded with zero rows.
  if (args.today !== undefined) parseIsoDate(args.today, "--today");
  args.today ??= isoDate(new Date());
  const lastClosed = windowAtIndex(lastClosedWindowIndex(args.today));
  if (!args.to || args.to > lastClosed.to) args.to = lastClosed.to;
  if (!Number.isInteger(args.windows) || args.windows < 1) {
    throw new Error("--windows must be a positive integer");
  }
  if (!Number.isInteger(args.pageSize) || args.pageSize < 1) {
    throw new Error("--page-size must be a positive whole number");
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const target = proveTarget();
  assertHistoryShape();
  console.log(`target ${target.database} at ${target.host}`);

  // `--to` names the newest window to LOAD, already clamped to one that has closed, so it
  // is selected by the window it falls INSIDE -- exactly as the backfill reads its own
  // `--to`. Reading it as an "as of" moment instead would skip the week that just closed.
  const windows = windowsEndingAt(args.to, args.windows);
  const done = loadedWindows({ companyCode: args.company });
  const work = [];
  for (const window of windows) {
    for (const scope of allScopes()) {
      if (!done.has(ledgerKey(scope, window))) work.push({ window, scope });
    }
  }
  console.log(
    `${windows.length} closed window(s) through ${args.to} (newest ends ${windows.at(-1).to}); ` +
      `${work.length} window/scope pair(s) outstanding`,
  );
  if (args.dryRun) {
    if (args.forward) console.log(`forward scan from ${windowContaining(args.today).from} would run (dry run: nothing fetched)`);
    return { outstanding: work.length, loaded: 0, failures: 0 };
  }

  const apiKey = readColdlionApiKey();
  let loaded = 0;
  const failures = [];
  for (const { window, scope } of work) {
    try {
      const result = await loadWindowScope({
        scope,
        window,
        apiKey,
        companyCode: args.company,
        pageSize: args.pageSize,
        requestedBy: "coldlion-landing sync-history",
      });
      loaded += 1;
      console.log(
        `${window.from}..${window.to} ${scopeLabel(scope)} ${result.fetched.rows} row(s) loaded`,
      );
    } catch (error) {
      // One window's terminal failure is already recorded and alerted. The rest of the
      // schedule still runs, and the process exits non-zero so the run is not green.
      failures.push(`${window.from} ${scopeLabel(scope)}: ${error.message}`);
      console.error(`${window.from} ${scopeLabel(scope)} FAILED: ${error.message}`);
    }
  }
  let forward = null;
  if (args.forward) {
    forward = await forwardScan({ args, apiKey, failures });
  }
  if (failures.length > 0) {
    const error = new Error(`${failures.length} window/scope pair(s) failed`);
    error.failures = failures;
    throw error;
  }
  return { outstanding: work.length, loaded, failures: 0, forward };
}

/**
 * The forward track: the open current window, then every later grid window, each loaded
 * unsealed. A month counts as empty only when NONE of its windows landed a sales-order
 * line; it is judged only once its last window has been read, so a mid-month stop can
 * never skip that month's remaining windows. A failed window counts as NOT empty, so an
 * outage can never end the scan early and is reported through `failures`.
 */
/** Consecutive failed forward windows after which the run stops calling (it stays red). */
export const FORWARD_MAX_CONSECUTIVE_FAILURES = 4;

export async function forwardScan({ args, apiKey, failures, load = loadWindowScope }) {
  const landedByMonth = {};
  const result = { windows: 0, lines: 0, stoppedAt: null };
  let consecutiveFailures = 0;
  const track = [windowContaining(args.today)];
  const later = forwardWindows(args.today);
  let next = later.next();
  for (let position = 0; ; position += 1) {
    if (position >= track.length) {
      if (next.done) break;
      track.push(next.value);
      next = later.next();
    }
    const window = track[position];
    const following = position + 1 < track.length ? track[position + 1] : next.done ? null : next.value;
    let landed = 0;
    try {
      const loadedWindow = await load({
        scope: ORDER_HISTORY,
        window,
        apiKey,
        companyCode: args.company,
        pageSize: args.pageSize,
        requestedBy: "coldlion-landing sync-history forward",
        sealed: false,
      });
      landed = loadedWindow.summary.lines;
      consecutiveFailures = 0;
      result.lines += landed;
      console.log(`${window.from}..${window.to} /orderHistory forward (unsealed) ${loadedWindow.fetched.rows} row(s), ${landed} line(s)`);
    } catch (error) {
      landed = 1; // never let a failure look like an empty month
      failures.push(`${window.from} /orderHistory forward: ${error.message}`);
      console.error(`${window.from} /orderHistory forward FAILED: ${error.message}`);
      consecutiveFailures += 1;
      if (consecutiveFailures >= FORWARD_MAX_CONSECUTIVE_FAILURES) {
        // A vendor or database outage: stop hammering, but never as an "empty" stop --
        // the failures above already make the run red, and the next run starts over.
        failures.push(`forward scan aborted after ${consecutiveFailures} consecutive failed windows`);
        console.error(`forward scan aborted after ${consecutiveFailures} consecutive failed windows`);
        result.aborted = true;
        break;
      }
    }
    result.windows += 1;
    recordStagedWindow(landedByMonth, window, landed);
    if (closesStagedMonth(window, following) && forwardStopReached(landedByMonth)) {
      result.stoppedAt = window.to;
      console.log(`forward scan stopped after ${window.to}: consecutive empty start-date months (${Object.keys(landedByMonth).sort().slice(-2).join(", ")})`);
      break;
    }
  }
  if (!result.stoppedAt && !result.aborted) console.log(`forward scan reached the horizon after ${result.windows} window(s)`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-history.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
