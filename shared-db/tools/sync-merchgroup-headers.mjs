#!/usr/bin/env node
// DO NOT SCHEDULE (#3903): plm.merch_group_header holds curated, owner-approved rows
// (approval #539, implementation #1177) and this loader is a vendor-mirror upsert
// that would overwrite them. The nightly Item Master step instead guards against a
// stale dictionary by refusing sweeps that collapse resolution per division.

import { pathToFileURL } from "node:url";
import {
  COLDLION_BASE_URL,
  buildFailedSyncRunSql,
  fetchPaged,
  readColdlionApiKey,
  runSql,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";

export const DIVISIONS = ["CW001", "SP001", "EH001", "EP001"];

export function buildHeaderImportSql(headers) {
  return `select * from plm.import_merch_group_headers(${sqlDollarQuote("cl_headers", headers)}::jsonb);\n`;
}

export async function collectHeaders(apiKey, fetchImpl = fetch) {
  const rows = [];
  for (const division of DIVISIONS) {
    const url = new URL(`${COLDLION_BASE_URL}/merchGroupHeaders`);
    url.searchParams.set("companyCode", "EDGEHOME");
    url.searchParams.set("divisionCode", division);
    url.searchParams.set("size", "200");
    const result = await fetchPaged(url, apiKey, fetchImpl);
    rows.push(...result.rows);
  }
  return rows;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const linked = args.has("--linked");
  let stage = "fetch";
  try {
    const headers = await collectHeaders(readColdlionApiKey());
    const divisions = Object.fromEntries(DIVISIONS.map((d) => [d, headers.filter((h) => h.divisionCode === d).length]));
    process.stdout.write(`${JSON.stringify({ headers: headers.length, divisions, apply }, null, 2)}\n`);
    if (apply) {
      stage = "apply";
      process.stdout.write(runSql(buildHeaderImportSql(headers), { linked }));
    }
  } catch (error) {
    if (apply) {
      try { runSql(buildFailedSyncRunSql("merch_group_headers", stage, error.message), { linked }); }
      catch (recordError) { process.stderr.write(`WARNING: failed to record durable failure: ${recordError.message}\n`); }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Coldlion merch-group header sync failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
