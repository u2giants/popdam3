#!/usr/bin/env node
// ColdLion /proddetails backfill and refresh (issue #3180).
//
// One keyed GET per production order, harvested from the landed production history.
// Bounded and resumable: a key with a SUCCEEDED /proddetails sync_run is never fetched
// again by a backfill, so an interrupted run continues where the evidence stops.
//
// Modes:
//   backfill — never-fetched keys, oldest first. Re-dispatch until outstanding is 0.
//   refresh  — never-fetched keys first, then recently-observed keys re-read newest
//              first. This is what the scheduled workflow runs.
//   keys     — exactly the orders named by --keys, re-fetched even if already done.
//
// Nothing here prints a ColdLion row. Progress is keys, counts and statuses only —
// this repository is public and ColdLion payloads are not ours to publish.

import { randomUUID } from "node:crypto";
import { readColdlionApiKey } from "../coldlion-sync-common.mjs";
import { proveTarget, queryRows, recordMasterFailure, runSql } from "./lib/db.mjs";
import { fetchArrayMaster } from "./lib/master-http.mjs";
import { delay } from "./lib/http.mjs";
import { COMPANY_CODE } from "./lib/scopes.mjs";
import {
  PROD_DETAIL_SPEC,
  buildProdDetailLoadSql,
  doneKeysSql,
  harvestSql,
  makeProdDetailRun,
  parseDoneKeys,
  parseHarvest,
  parseReconciliation,
  prodDetailRefusalSql,
  reconcileSql,
  selectKeys,
  projectProdDetailRows,
} from "./lib/prod-details.mjs";

export function parseArgs(argv) {
  const args = { mode: null, keys: [], limit: null, from: null, recentDays: 21, company: COMPANY_CODE, pauseMs: 3000, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--dry-run") { args.dryRun = true; continue; }
    if (flag === "--mode") {
      if (!["backfill", "refresh", "keys"].includes(value)) throw new Error(`unknown mode ${value}`);
      args.mode = value; index += 1; continue;
    }
    if (flag === "--keys") {
      args.keys = String(value).split(",").map((raw) => raw.trim()).filter(Boolean).map((raw) => {
        if (!/^-?\d+$/.test(raw)) throw new Error(`--keys contains a non-integer production order: ${raw}`);
        return Number(raw);
      });
      index += 1; continue;
    }
    if (flag === "--limit") {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, not ${value}`);
      args.limit = limit; index += 1; continue;
    }
    if (flag === "--from") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--from must be YYYY-MM-DD, not ${value}`);
      args.from = value; index += 1; continue;
    }
    if (flag === "--recent-days") {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1) throw new Error(`--recent-days must be a positive integer, not ${value}`);
      args.recentDays = days; index += 1; continue;
    }
    if (flag === "--company") { args.company = value; index += 1; continue; }
    if (flag === "--pause-ms") {
      const pause = Number(value);
      if (!Number.isInteger(pause) || pause < 0) throw new Error(`--pause-ms must be a non-negative integer, not ${value}`);
      args.pauseMs = pause; index += 1; continue;
    }
    throw new Error(`unknown argument ${flag}`);
  }
  if (!args.mode) throw new Error("a --mode is required: backfill, refresh or keys");
  if (args.mode === "keys" && args.keys.length === 0) throw new Error("--mode keys requires --keys <prodOrderNo[,prodOrderNo...]>");
  if (args.mode !== "keys" && args.keys.length > 0) throw new Error("--keys is only valid with --mode keys");
  return args;
}

/**
 * Fetch and land one production order in one transaction. Throws on any failure; the
 * caller decides whether one key may be skipped or the whole run must stop.
 */
export async function loadOneKey({ prodOrderNo, apiKey, companyCode, requestedBy, dbOptions = {}, fetchImpl = fetch, execute = runSql, pauseMs = 3000 }) {
  const evidence = [];
  const startedAt = new Date().toISOString();
  // The vendor agreement is one request at a time with a pause between them.
  await delay(pauseMs);
  const rows = await fetchArrayMaster(PROD_DETAIL_SPEC.endpoint, { companyCode, prodOrderNo }, apiKey, {
    fetchImpl,
    pauseMs,
    onResponse: (entry) => evidence.push(entry),
  });
  const fetchedAt = new Date().toISOString();
  const runId = randomUUID();
  const projected = projectProdDetailRows(rows, { runId, fetchedAt, companyCode, prodOrderNo });
  const run = makeProdDetailRun({
    id: runId,
    companyCode, prodOrderNo, requestedBy,
    startedAt, finishedAt: fetchedAt,
    httpStatus: evidence.at(-1)?.httpStatus ?? null,
    bodyStatus: evidence.at(-1)?.bodyStatus ?? null,
    rowsFetched: rows.length,
    zeroRow: projected.zeroRow,
  });
  execute(buildProdDetailLoadSql({ run, rows: projected.rows }), dbOptions);
  return { prodOrderNo, zeroRow: projected.zeroRow, rowsFetched: rows.length };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const prove = dependencies.proveTarget ?? proveTarget;
  const execute = dependencies.runSql ?? runSql;
  const read = dependencies.queryRows ?? queryRows;
  const readKey = dependencies.readApiKey ?? readColdlionApiKey;
  const recordFailure = dependencies.recordMasterFailure ?? recordMasterFailure;
  const loadKey = dependencies.loadOneKey ?? loadOneKey;
  const target = prove();
  console.log(`target ${target.database} at ${target.host}`);

  let harvested = [];
  let done = new Set();
  let refusedKeys = new Set();
  if (args.mode === "keys") {
    harvested = args.keys.map((prodOrderNo) => ({ prodOrderNo, firstObserved: "", lastObserved: "" }));
  } else {
    harvested = parseHarvest(read(harvestSql(args.company)));
    ({ done, refused: refusedKeys } = parseDoneKeys(read(doneKeysSql(args.company))));
  }
  const selection = args.mode === "keys"
    ? harvested
    : selectKeys({ harvested, done, refused: refusedKeys, mode: args.mode, from: args.from, recentDays: args.recentDays, limit: args.limit });

  const outstanding = harvested.filter((entry) => !done.has(entry.prodOrderNo)).length;
  console.log(`${args.mode}: population ${harvested.length}, answered ${done.size} (refused ${refusedKeys.size}), outstanding ${outstanding}, selected ${selection.length}${args.from ? ` (first observed on/after ${args.from})` : ""}`);
  if (args.dryRun) {
    for (const entry of selection.slice(0, 10)) console.log(`  would fetch prodOrderNo ${entry.prodOrderNo}`);
    if (selection.length > 10) console.log(`  … and ${selection.length - 10} more`);
    return { selected: selection.length, outstanding };
  }

  const apiKey = readKey();
  const requestedBy = `coldlion-landing sync-prod-details ${args.mode}`;
  const failed = [];
  const refused = [];
  for (const entry of selection) {
    try {
      const summary = await loadKey({
        prodOrderNo: entry.prodOrderNo, apiKey, companyCode: args.company, requestedBy, pauseMs: args.pauseMs,
      });
      console.log(`prodOrderNo ${summary.prodOrderNo}: fetched ${summary.rowsFetched}${summary.zeroRow ? " (zero rows)" : ""}`);
    } catch (error) {
      if (error.refused) {
        // One order's data cannot land (an identity collision the #2863 constraint
        // refuses to collapse). Record it durably, count it, and let the population
        // proceed — the run still exits non-zero below so the refusal stays loud.
        try { execute(prodDetailRefusalSql({ companyCode: args.company, prodOrderNo: entry.prodOrderNo, requestedBy, error })); }
        catch (recordError) { error.message = `${error.message} (and the refusal could not be recorded: ${recordError.message})`; throw error; }
        console.error(`prodOrderNo ${entry.prodOrderNo} REFUSED (${error.refused}): ${error.message}`);
        refused.push({ prodOrderNo: entry.prodOrderNo, reason: error.refused });
        continue;
      }
      try { recordFailure({ endpoint: error.endpoint ?? PROD_DETAIL_SPEC.endpoint, companyCode: args.company, requestedBy, error }); }
      catch (recordError) { error.message = `${error.message} (and the failure could not be recorded: ${recordError.message})`; }
      if (error.fatal) {
        // A shape failure repeats for every key: fetching the next thousands of orders
        // against a changed feed proves nothing and buries the refusal in noise. Stop.
        console.error(`fatal: ${error.message}`);
        throw error;
      }
      console.error(`prodOrderNo ${entry.prodOrderNo} failed: ${error.message}`);
      failed.push({ prodOrderNo: entry.prodOrderNo, message: String(error.message).slice(0, 300) });
    }
  }

  const reconcileRow = read(reconcileSql(args.company))[0];
  if (!reconcileRow) throw new Error("the reconciliation read returned nothing");
  const reconcile = parseReconciliation(reconcileRow);
  console.log(`reconcile: keysDone=${reconcile.keysDone} zeroRowKeys=${reconcile.zeroRowKeys} rowsFetchedTotal=${reconcile.rowsFetchedTotal} keysLanded=${reconcile.keysLanded} rowsLandedTotal=${reconcile.rowsLandedTotal} tableRows=${reconcile.tableRows} distinctPkey=${reconcile.distinctPkey} refusedKeys=${reconcile.refusedKeys} exclusions=${reconcile.exclusions} agrees=${reconcile.agrees}`);
  if (failed.length) {
    console.error(`${failed.length} key(s) failed; the run exits non-zero so the failure stays visible`);
    const error = new Error(`${failed.length} production order(s) failed to load`);
    error.failedKeys = failed;
    error.reconciliation = reconcile;
    throw error;
  }
  if (refused.length) {
    console.error(`${refused.length} key(s) REFUSED an identity collision and were recorded, not landed; the run exits non-zero so the refusal stays visible`);
    const error = new Error(`${refused.length} production order(s) refused: identity collisions recorded for a structural ruling`);
    error.refusedKeys = refused;
    error.reconciliation = reconcile;
    throw error;
  }
  if (!reconcile.agrees) {
    const error = new Error(`reconciliation disagrees: ${JSON.stringify(reconcile)}`);
    error.reconciliation = reconcile;
    throw error;
  }
  return { reconciliation: reconcile };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-prod-details.mjs")) {
  main().catch((error) => {
    console.error(String(error.message).slice(0, 1000));
    process.exitCode = 1;
  });
}
