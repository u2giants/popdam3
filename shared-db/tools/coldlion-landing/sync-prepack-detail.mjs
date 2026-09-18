#!/usr/bin/env node
// ColdLion /prepackDetail landing loader (issue #3179; table from #2863).
//
// The feed is enumerated, not paged: every run harvests the complete prepackCode
// population from tables this repository has ALREADY landed, then asks the vendor
// once per code. Two modes share one code path:
//
//   * BOUNDED BACKFILL (--limit N): cover at most N not-yet-covered codes.
//     Resumable by evidence — every successful run records the cumulative
//     covered set in coldlion.sync_run.request_params, so an interrupted,
//     cancelled or timed-out backfill continues exactly where the evidence
//     stops. Re-dispatch until "pending" is 0.
//   * FULL REFRESH (default, and the scheduled mode): re-read every harvested
//     code and upsert the current state, so a changed or removed recipe line
//     is observed and reconciled.
//
// A zero-row response is expected, never silent: the code is counted, named on
// the sync_run and alerted. Everything else about a response that does not hold
// together — unknown fields, a shape that is not a bare array, a row answering a
// different request than the one that fetched it, a repeated natural key, a
// missing harvest source, a connection that is not the declared target — aborts
// the run BEFORE anything is written: the load is one transaction.
//
// --reconcile prints the read-only reconciliation report (API totals vs landed
// counts, coverage backlog, zero-row keys) and writes nothing.

import { randomUUID } from "node:crypto";
import { readColdlionApiKey } from "../coldlion-sync-common.mjs";
import { proveTarget, queryRows, recordMasterFailure, runSql } from "./lib/db.mjs";
import { fetchArrayMaster } from "./lib/master-http.mjs";
import { sqlText } from "./lib/values.mjs";
import { COMPANY_CODE } from "./sync-masters.mjs";
import {
  PREPACK_DETAIL_SPEC,
  PREPACK_HARVEST_LANDING_TABLE,
  PREPACK_HARVEST_SOURCES,
  assertRowsAnswerRequest,
  buildCoverageReadSql,
  buildHarvestExistenceSql,
  buildHarvestKeysSql,
  buildLandingTableExistenceSql,
  buildPrepackLoadSql,
  buildReconcileSql,
  parseCoverageRow,
  projectPrepackRows,
  reduceHarvestRows,
} from "./lib/prepack-detail.mjs";

const REQUESTED_BY = "coldlion-landing sync-prepack-detail";
const DEFAULT_PAUSE_MS = 3_000;
const MIN_PAUSE_MS = 250;

export function parseArgs(argv) {
  const args = { company: COMPANY_CODE, dryRun: false, limit: null, pauseMs: DEFAULT_PAUSE_MS, reconcile: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") { args.dryRun = true; continue; }
    if (arg === "--reconcile") { args.reconcile = true; continue; }
    if (arg === "--company") { args.company = argv[(index += 1)]; continue; }
    if (arg === "--pause-ms") {
      const value = Number(argv[(index += 1)]);
      if (!Number.isInteger(value) || value < MIN_PAUSE_MS) throw new Error(`--pause-ms must be an integer of at least ${MIN_PAUSE_MS}`);
      args.pauseMs = value;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(argv[(index += 1)]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit must be a positive integer");
      args.limit = value;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

function makeGate(pauseMs) {
  let next = Promise.resolve();
  return () => {
    next = next.then(() => new Promise((done) => setTimeout(done, pauseMs)));
    return next;
  };
}

/** Harvest the population and the previous coverage in read-only queries. */
export function readPlan({ companyCode, query = queryRows } = {}) {
  const presence = query(buildHarvestExistenceSql());
  const present = new Map(presence.map(([source, present]) => [source, String(present) === "t" || present === true]));
  const sources = PREPACK_HARVEST_SOURCES.filter((entry) => present.get(entry.source));
  const missingRequired = PREPACK_HARVEST_SOURCES.filter((entry) => entry.required && !present.get(entry.source));
  if (missingRequired.length) {
    throw Object.assign(new Error(`harvest source(s) absent from the target: ${missingRequired.map((entry) => entry.table).join(", ")}`), {
      endpoint: PREPACK_DETAIL_SPEC.endpoint,
    });
  }
  const [[landingTablePresent]] = query(buildLandingTableExistenceSql());
  if (String(landingTablePresent) !== "t" && landingTablePresent !== true) {
    throw Object.assign(new Error(`${PREPACK_HARVEST_LANDING_TABLE} does not exist on this target; refusing to load`), {
      endpoint: PREPACK_DETAIL_SPEC.endpoint,
    });
  }
  const harvest = reduceHarvestRows(query(buildHarvestKeysSql(sources)));
  const coverageRow = query(buildCoverageReadSql(companyCode))[0];
  const coverage = parseCoverageRow(coverageRow);
  const pending = harvest.keys.filter((code) => !coverage.coveredKeys.has(code));
  return { sources, harvest, coverage, pending };
}

/**
 * Which codes this run asks about, and what the cumulative covered set becomes.
 * Pure: every resumability decision is testable offline.
 */
export function planRun({ harvestedKeys, coveredKeys, limit }) {
  if (limit === null || limit === undefined) {
    return { keys: [...harvestedKeys], mode: "full-refresh", cumulativeCovered: [...harvestedKeys] };
  }
  const pending = harvestedKeys.filter((code) => !coveredKeys.has(code));
  const keys = pending.slice(0, limit);
  return {
    keys,
    mode: "bounded-backfill",
    cumulativeCovered: [...new Set([...coveredKeys, ...keys])].sort(),
  };
}

/** Fetch one response per code. Zero-row codes are evidence, not errors. */
export async function collectPrepackDetail({ companyCode, apiKey, keys, runId, fetchOptions = {} }) {
  const evidence = [];
  const upstreamResponse = fetchOptions.onResponse;
  const options = {
    requestGate: makeGate(fetchOptions.pauseMs ?? DEFAULT_PAUSE_MS),
    ...fetchOptions,
    onResponse: (entry) => { evidence.push(entry); upstreamResponse?.(entry); },
  };
  const sourceRows = [];
  const zeroRowKeys = [];
  for (const prepackCode of keys) {
    const params = { companyCode, prepackCode };
    const response = await fetchArrayMaster(PREPACK_DETAIL_SPEC.endpoint, params, apiKey, options);
    if (response.length === 0) { zeroRowKeys.push(prepackCode); continue; }
    assertRowsAnswerRequest(response, params);
    sourceRows.push(...response);
  }
  if (keys.length !== zeroRowKeys.length + new Set(sourceRows.map((row) => row.prePackCode)).size) {
    throw Object.assign(new Error("incomplete key coverage: the fetched rows do not account for every requested code"), {
      endpoint: PREPACK_DETAIL_SPEC.endpoint,
    });
  }
  return { sourceRows, zeroRowKeys, evidence, rowsFetched: sourceRows.length };
}

function uniformStatus(evidence, field) {
  if (!evidence.length) return null;
  const first = evidence[0][field];
  return evidence.every((entry) => entry[field] === first) ? first : null;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const prove = dependencies.proveTarget ?? proveTarget;
  const execute = dependencies.runSql ?? runSql;
  const query = dependencies.queryRows ?? queryRows;
  const readKey = dependencies.readApiKey ?? readColdlionApiKey;
  const collect = dependencies.collectPrepackDetail ?? collectPrepackDetail;
  const recordFailure = dependencies.recordMasterFailure ?? recordMasterFailure;
  const target = prove();
  console.log(`target ${target.database} at ${target.host}`);

  if (args.reconcile) {
    const { harvest, coverage, pending } = readPlan({ companyCode: args.company, query });
    for (const [metric, value] of query(buildReconcileSql(args.company))) console.log(`${metric}: ${value}`);
    console.log(`harvested_keys: ${harvest.keys.length}`);
    console.log(`covered_keys: ${coverage.coveredKeys.size}${coverage.runId ? ` (run ${coverage.runId} at ${coverage.finishedAt})` : " (no successful run yet)"}`);
    console.log(`pending_keys: ${pending.length}`);
    console.log("exclusions: 0 (unit 5b ruling: /prepackDetail is a transactional feed, EP001 is not excluded)");
    return { harvest, coverage, pending };
  }

  const { sources, harvest, coverage, pending } = readPlan({ companyCode: args.company, query });
  const plan = planRun({ harvestedKeys: harvest.keys, coveredKeys: coverage.coveredKeys, limit: args.limit });
  const sourceSummary = sources.map((entry) => `${entry.source}=${harvest.perSource[entry.source] ?? 0}`).join(", ");
  console.log(`harvest ${harvest.keys.length} distinct prepack code(s) from ${sources.length} landed source(s): ${sourceSummary}`);
  console.log(`coverage ${coverage.coveredKeys.size} already asked; pending ${pending.length}; ${plan.mode} asking ${plan.keys.length}`);

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let collected;
  try {
    collected = await collect({ companyCode: args.company, apiKey: readKey(), keys: plan.keys, runId, fetchOptions: { pauseMs: args.pauseMs } });
  } catch (error) {
    if (!args.dryRun) try { recordFailure({ endpoint: PREPACK_DETAIL_SPEC.endpoint, companyCode: args.company, requestedBy: REQUESTED_BY, error }); } catch { /* preserve the source failure */ }
    throw error;
  }
  const finishedAt = new Date().toISOString();
  const projected = projectPrepackRows(collected.sourceRows, { runId, fetchedAt: finishedAt });
  console.log(`${PREPACK_DETAIL_SPEC.endpoint}: fetched ${collected.rowsFetched} row(s) over ${plan.keys.length} code(s); zero-row code(s): ${collected.zeroRowKeys.length}; duplicate-free projected ${projected.rows.length}`);
  if (args.dryRun) {
    console.log("dry run: writing nothing (no sync_run, no rows, no alert)");
    return { plan, collected, projected };
  }

  const run = {
    id: runId,
    endpoint: PREPACK_DETAIL_SPEC.endpoint,
    companyCode: args.company,
    requestedBy: REQUESTED_BY,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt) - new Date(startedAt)),
    httpStatus: uniformStatus(collected.evidence, "httpStatus"),
    bodyStatus: uniformStatus(collected.evidence, "bodyStatus"),
    rowsFetched: collected.rowsFetched,
    zeroRowCount: collected.zeroRowKeys.length,
    requestParams: {
      companyCode: args.company,
      fullSnapshot: plan.mode === "full-refresh",
      ...(args.limit !== null ? { limit: args.limit } : {}),
      harvestedKeys: harvest.keys.length,
      pendingBeforeRun: pending.length,
      coveredKeys: plan.cumulativeCovered,
      zeroRowKeys: collected.zeroRowKeys,
      sources: harvest.perSource,
    },
  };
  const notes = [
    `${plan.mode}: asked ${plan.keys.length} of ${harvest.keys.length} harvested code(s)`,
    `${collected.zeroRowKeys.length} zero-row code(s) recorded`,
    `${collected.rowsFetched} row(s) fetched`,
  ].join("; ");
  try {
    execute(buildPrepackLoadSql({ run, rows: projected.rows, fetchedCodes: plan.keys, notes }));
  } catch (error) {
    try { recordFailure({ endpoint: PREPACK_DETAIL_SPEC.endpoint, companyCode: args.company, requestedBy: REQUESTED_BY, error }); } catch { /* preserve the write failure */ }
    throw error;
  }
  const [recorded] = query(`select rows_inserted, rows_updated, rows_unchanged, coalesce(notes,'') from coldlion.sync_run where id = ${sqlText(runId)};`);
  if (recorded) console.log(`landed run ${runId}: inserted ${recorded[0]}, updated ${recorded[1]}, unchanged ${recorded[2]}; notes: ${recorded[3]}`);
  return { plan, collected, projected, run };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-prepack-detail.mjs")) {
  main().catch((error) => {
    console.error(error.code === "DATABASE_COMMAND_FAILED" ? error.message : String(error.message).slice(0, 1000));
    process.exitCode = 1;
  });
}
