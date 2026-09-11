#!/usr/bin/env node
// The manual, resumable history backfill.
//
//   node tools/coldlion-landing/backfill-history.mjs --from 2019-01-01 [--to 2026-09-07]
//                                                    [--limit 50] [--endpoint /orderHistory]
//                                                    [--stage ISS] [--dry-run]
//
// Resumable means resumable from the LEDGER, not from a note someone kept: every window
// already proven loaded is skipped, so re-running after any interruption continues where
// the evidence stops. It walks oldest-first for the same reason.
//
// `--to` is clamped to the newest window that has CLOSED, whatever was asked for. Loading
// a window seals it, so reaching into the current week would freeze a one-day-old week as
// a finished one and lose its remaining six days silently.
//
// The backfill writes ONE baseline version per production line. That is a baseline, not
// reconstructed change history, and the retention guard refuses to prune it.

import { readColdlionApiKey } from "../coldlion-sync-common.mjs";
import { isoDate, lastClosedWindowIndex, windowAtIndex, windowRange } from "./lib/grid.mjs";
import { proveTarget } from "./lib/db.mjs";
import { COMPANY_CODE, PAGE_SIZE, PROD_STAGES } from "./lib/scopes.mjs";
import { allScopes, ledgerKey, loadWindowScope, loadedWindows, scopeLabel } from "./lib/run-history.mjs";

export function parseArgs(argv) {
  const args = { limit: Infinity, company: COMPANY_CODE, pageSize: PAGE_SIZE, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--from": args.from = value; index += 1; break;
      case "--to": args.to = value; index += 1; break;
      case "--limit": args.limit = Number(value); index += 1; break;
      case "--company": args.company = value; index += 1; break;
      case "--endpoint": args.endpoint = value; index += 1; break;
      case "--stage": args.stage = String(value).toUpperCase(); index += 1; break;
      case "--page-size": args.pageSize = Number(value); index += 1; break;
      case "--dry-run": args.dryRun = true; break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!args.from) throw new Error("--from YYYY-MM-DD is required");
  // The end of the newest window that has CLOSED, never today. A backfill that reached
  // into the current week would seal a window on the first of its seven days, and a
  // sealed window can never be added to: the rest of that week would be lost silently.
  const lastClosed = windowAtIndex(lastClosedWindowIndex(isoDate(new Date())));
  if (!args.to || args.to > lastClosed.to) args.to = lastClosed.to;
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) {
    throw new Error("--limit must be a number");
  }
  if (args.limit !== Infinity && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error("--limit must be a positive whole number");
  }
  if (!Number.isInteger(args.pageSize) || args.pageSize < 1) {
    throw new Error("--page-size must be a positive whole number");
  }
  if (args.stage && !PROD_STAGES.includes(args.stage)) {
    throw new Error(`--stage must be one of ${PROD_STAGES.join(", ")}`);
  }
  return args;
}

export function selectScopes({ endpoint, stage }) {
  return allScopes().filter(
    (scope) =>
      (!endpoint || scope.endpoint === endpoint) && (!stage || scope.stage === stage),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const scopes = selectScopes(args);
  if (scopes.length === 0) throw new Error("no scope matches the given --endpoint/--stage");

  const target = proveTarget();
  console.log(
    `target ${target.database} at ${target.host} (${target.coldlionTables} coldlion tables)`,
  );

  const windows = [...windowRange(args.from, args.to)];
  const done = loadedWindows({ companyCode: args.company });
  const work = [];
  for (const window of windows) {
    for (const scope of scopes) {
      if (!done.has(ledgerKey(scope, window))) work.push({ window, scope });
    }
  }
  const planned = work.slice(0, args.limit === Infinity ? work.length : args.limit);
  console.log(
    `${windows.length} window(s) ${args.from}..${args.to}; ${work.length} window/scope pair(s) outstanding; running ${planned.length}`,
  );
  if (args.dryRun) return { planned: planned.length, outstanding: work.length, loaded: 0 };

  const apiKey = readColdlionApiKey();
  let loaded = 0;
  for (const { window, scope } of planned) {
    const result = await loadWindowScope({
      scope,
      window,
      apiKey,
      companyCode: args.company,
      pageSize: args.pageSize,
      requestedBy: "coldlion-landing backfill-history",
      isBackfillBaseline: true,
    });
    loaded += 1;
    console.log(
      `${window.from}..${window.to} ${scopeLabel(scope)} ${result.fetched.rows} row(s) ${result.summary.lines} line(s) [${loaded}/${planned.length}]`,
    );
  }
  return { planned: planned.length, outstanding: work.length, loaded };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backfill-history.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
