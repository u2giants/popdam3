#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  COLDLION_BASE_URL,
  buildFailedSyncRunSql,
  fetchPaged,
  readColdlionApiKey,
  runSql,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";
import { assertExpectedTarget } from "./coldlion-landing/lib/db.mjs";

export function buildItemImportPayload(items, options = {}) {
  return {
    sweepId: options.sweepId ?? randomUUID(),
    terminalReached: options.terminalReached === true,
    minimumSilverRatio: options.minimumSilverRatio ?? 0.8,
    items,
  };
}

// Refuse to promote a sweep that collapses licensor resolution (#3903 review F2): a
// stale or empty merch-group header dictionary row de-resolves a DIVISION, and the
// upsert would overwrite previously resolved licensor links with NULL while every
// row-count guard still passes. So the guard works per division, over the items in
// CURRENT silver (plm.item_import joined to plm.item by source_id), never over all of
// plm.item, which only grows and would dilute the signal over time. A division with
// at least MIN_DIVISION_ITEMS items whose resolved share falls by more than
// MAX_RESOLVED_SHARE_DROP refuses the whole sweep. The script carries its own
// Applies go only through psql with DATABASE_URL (target proven first); the script
// carries its own begin/commit and runSql sets ON_ERROR_STOP, so a raise rolls the
// whole import back.
// A deliberate, verified drop is promoted by setting allowResolutionDrop (workflow
// input allow_resolution_drop), which skips only this guard for that one run.
export const MAX_RESOLVED_SHARE_DROP = 0.1;
export const MIN_DIVISION_ITEMS = 50;

const DIVISION_SHARE_SQL = [
  "select ii.division_code,",
  "       count(*)::numeric as n,",
  "       count(*) filter (where i.licensor_id is not null)::numeric / count(*) as share",
  "  from plm.item_import ii",
  "  join plm.item i on i.id = ii.item_id",
  " group by ii.division_code",
].join("\n");

export function buildItemImportSql(payload, { allowResolutionDrop = false } = {}) {
  return [
    // Explicit transaction: atomic whatever the transport does; ON_ERROR_STOP (set by
    // runSql) makes any raise below abort before commit, rolling the import back.
    "begin;",
    `create temp table item_master_resolved_before as ${DIVISION_SHARE_SQL};`,
    `select * from plm.import_item_master_data(${sqlDollarQuote("cl_items", payload)}::jsonb);`,
    "do $guard$",
    "declare v_bad text; v_silver bigint; v_linked bigint;",
    "begin",
    // Input sanity: always enforced, never bypassable. Silver links to plm.item by the
    // resolver's own item_id foreign key, so no key format is re-derived here.
    "  select count(*), count(i.id) into v_silver, v_linked",
    "    from plm.item_import ii left join plm.item i on i.id = ii.item_id;",
    "  if v_silver = 0 or v_linked < 0.9 * v_silver then",
    "    raise exception 'item master guard: % of % silver rows link to plm.item; refusing to promote', v_linked, v_silver;",
    "  end if;",
    `  if ${allowResolutionDrop ? "false" : "true"} then`,
    "    select string_agg(format('%s %s -> %s', b.division_code, round(b.share, 3), round(coalesce(a.share, 0), 3)), ', ')",
    "      into v_bad",
    "      from item_master_resolved_before b",
    `      left join (${DIVISION_SHARE_SQL}) a using (division_code)`,
    `     where b.n >= ${MIN_DIVISION_ITEMS} and a.division_code is not null`,
    `       and coalesce(a.share, 0) < b.share - ${MAX_RESOLVED_SHARE_DROP};`,
    "    if v_bad is not null then",
    "      raise exception 'item master resolution collapsed (resolved share by division: %); refusing to promote. If the drop is real, re-run ColdLion Landing Sync with allow_resolution_drop=true', v_bad;",
    "    end if;",
    "  end if;",
    "end",
    "$guard$;",
    `select '${allowResolutionDrop ? "RESOLUTION GUARD BYPASSED by allow_resolution_drop" : "resolution guard enforced"}' as item_master_guard;`,
    "drop table item_master_resolved_before;",
    "commit;",
    "",
  ].join("\n");
}

const KNOWN_FLAGS = new Set(["--apply"]);

/** A misspelled flag must fail loudly, never degrade into a green fetch-only run. */
export function parseLoaderArgs(argv, known = KNOWN_FLAGS) {
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(" ")}; allowed: ${[...known].join(" ")}`);
  return { apply: argv.includes("--apply") };
}

export async function collectItems(apiKey, fetchImpl = fetch) {
  const url = new URL(`${COLDLION_BASE_URL}/items`);
  url.searchParams.set("companyCode", "EDGEHOME");
  url.searchParams.set("size", "200");
  return fetchPaged(url, apiKey, fetchImpl);
}

async function main() {
  const { apply } = parseLoaderArgs(process.argv.slice(2));
  const linked = false; // the Supabase-CLI path is not supported for applies (#3903)
  if (apply) assertExpectedTarget();
  let stage = "fetch";
  try {
    const sweep = await collectItems(readColdlionApiKey());
    const payload = buildItemImportPayload(sweep.rows, sweep);
    const divisions = sweep.rows.reduce((counts, row) => {
      counts[row.divisionCode ?? "(missing)"] = (counts[row.divisionCode ?? "(missing)"] ?? 0) + 1;
      return counts;
    }, {});
    process.stdout.write(`${JSON.stringify({ items: sweep.rows.length, pagesFetched: sweep.pagesFetched,
      terminalReached: sweep.terminalReached, divisions, apply,
      resolutionGuard: process.env.ITEM_MASTER_ALLOW_RESOLUTION_DROP === "true" ? "BYPASSED" : "enforced" }, null, 2)}\n`);
    if (apply) {
      stage = "apply";
      process.stdout.write(runSql(buildItemImportSql(payload, { allowResolutionDrop: process.env.ITEM_MASTER_ALLOW_RESOLUTION_DROP === "true" }), { linked }));
    }
  } catch (error) {
    if (apply) {
      try { runSql(buildFailedSyncRunSql("item_taxonomy_resolver", stage, error.message), { linked }); }
      catch (recordError) { process.stderr.write(`WARNING: failed to record durable failure: ${recordError.message}\n`); }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Coldlion item sync failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
