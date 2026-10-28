#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  COLDLION_BASE_URL,
  buildFailedSyncRunSql,
  fetchPaged,
  readColdlionApiKey,
  runSql,
  sqlDollarQuote, isClientSpawnFault, isClientUriFault
} from "./coldlion-sync-common.mjs";
import { assertExpectedTarget } from "./coldlion-landing/lib/db.mjs";
import {
  DELTA_DEADLINE_MS,
  DELTA_REQUESTED_BY,
  MAX_DELTA_ITEMS,
  buildItemDetailDeltaSql,
  fetchItemDetails,
  newItemsFromPayload,
  parseDeltaCounts,
  validDetailRow,
} from "./coldlion-landing/lib/item-detail-delta.mjs";
import { ITEM_SPECS } from "./coldlion-landing/lib/master-specs.mjs";
import { projectCurrentRows } from "./coldlion-landing/lib/project-masters.mjs";

// The /items sweep is offset-paged, so a row that moves between pages mid-sweep is
// returned twice (the 2026-10-25 and 2026-10-26 nightlies failed on
// item_import_staging_pkey). Keep the LAST copy of each company/division/item key -- the
// most recently read -- and report how many were folded, never silently. The key is
// trimmed of spaces only, exactly as plm.import_item_master_data btrim()s it into the
// staging primary key, so two rows fold here only when the database would collide.
// A fold of more than MAX_FOLDED_ITEMS is not page drift: refuse the sweep loudly.
export const MAX_FOLDED_ITEMS = 50;

export function dedupeItems(items, { maxFolded = MAX_FOLDED_ITEMS } = {}) {
  const byKey = new Map();
  for (const row of items) {
    const key = ["companyCode", "divisionCode", "itemNo"].map((field) => String(row?.[field] ?? "").replace(/^ +| +$/g, "")).join("\u0000");
    byKey.delete(key);
    byKey.set(key, row);
  }
  const folded = items.length - byKey.size;
  if (folded > maxFolded) {
    throw new Error(`/items sweep returned ${folded} duplicate item keys (limit ${maxFolded}); refusing to import`);
  }
  return { items: [...byKey.values()], folded };
}

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

// One probe, unaligned tuples-only output: first line is the migration gate
// (has 20261028183729 replaced the auto-flow function's signature?), the rest
// are the existing (company, division, item_number) identities.
// Tolerant of psql's own chatter: without --quiet, every \pset meta-command
// echoes a confirmation line before the data ("Output format is unaligned.").
// Scan for the gate row instead of assuming it is first.
export function parseSweepProbe(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const gateIndex = lines.findIndex((line) => /^[tf]$/.test(line));
  if (gateIndex === -1) return { migrationApplied: null, identities: [] };
  const identities = [];
  for (const line of lines.slice(gateIndex + 1)) {
    const cells = line.split("\t");
    if (cells.length === 3 && cells.some((cell) => cell)) identities.push(cells);
  }
  return { migrationApplied: lines[gateIndex] === "t", identities };
}

export const SWEEP_PROBE_SQL = [
  "\\pset format unaligned",
  "\\pset tuples_only on",
  "\\pset fieldsep '\\t'",
  "select to_regprocedure('public.sync_new_items_into_style_tracker(boolean)') is null",
  "   and to_regprocedure('public.sync_new_items_into_style_tracker(boolean, timestamptz)') is not null as migration_applied;",
  "select raw ->> 'companyCode', raw ->> 'divisionCode', btrim(item_number) from plm.item;",
].join("\n");

// #4974: before the import SQL runs, land the /itemDetails rows of NEW items so
// the Master Data auto-flow decides them on fresh evidence in THIS cycle (a new
// assortment is skipped instantly instead of after the nightly masters run).
// The whole step is best-effort by contract: the migration gate (M1) keeps it
// off until 20261028183729 is applied on the target, and ANY fault — probe,
// fetch, projection, or landing — is reported and skipped so the item-master
// import itself always runs. Per-item failures (fetch, shape, deadline) are
// recorded in the sync_run notes; the nightly masters run remains the backstop.
export async function landNewItemDetails(apiKey, payloadItems, { runSqlImpl = runSql, fetchImpl = fetch, now = Date.now } = {}) {
  try {
    const probe = parseSweepProbe(runSqlImpl(SWEEP_PROBE_SQL, { linked: false }));
    if (probe.migrationApplied !== true) {
      return { newItems: 0, detailsLanded: 0, failures: [], gated: probe.migrationApplied === null ? "probe unreadable" : "migration 20261028183729 not applied yet" };
    }
    const newItems = newItemsFromPayload(payloadItems, probe.identities);
    if (!newItems.length) return { newItems: 0, detailsLanded: 0, failures: [] };
    if (newItems.length > MAX_DELTA_ITEMS) {
      return { newItems: newItems.length, detailsLanded: 0, failures: [], refused: `new-item count ${newItems.length} exceeds the ${MAX_DELTA_ITEMS}-item delta cap; nightly masters covers these items` };
    }
    const startedAt = new Date().toISOString();
    const deadline = now() + DELTA_DEADLINE_MS;
    const fetchedDetails = [];
    const failures = [];
    for (const row of newItems) {
      if (now() >= deadline) {
        failures.push({ itemNo: row.itemNo, message: "delta fetch deadline exceeded; nightly masters covers this item" });
        continue;
      }
      const request = { companyCode: row.companyCode, divisionCode: row.divisionCode, itemNo: row.itemNo };
      try {
        const raw = await fetchItemDetails(apiKey, request, fetchImpl);
        const inScope = [];
        for (const detail of raw) {
          const invalid = validDetailRow(detail, request);
          if (invalid) failures.push({ itemNo: row.itemNo, message: `detail row rejected: ${invalid}` });
          else inScope.push(detail);
        }
        // Per-item projection: a shape/blank-key/duplicate surprise drops only
        // this item's rows (projectCurrentRows raises with the endpoint named).
        fetchedDetails.push(projectCurrentRows(ITEM_SPECS.item_detail, inScope, { runId: "pending", fetchedAt: "pending" }).rows);
      } catch (error) {
        failures.push({ itemNo: row.itemNo, message: error?.message ?? String(error) });
      }
    }
    const detailRows = fetchedDetails.flat();
    const run = {
      id: randomUUID(),
      companyCode: "EDGEHOME",
      requestParams: { items: newItems.map((row) => ({ companyCode: row.companyCode, divisionCode: row.divisionCode, itemNo: row.itemNo })) },
      requestedBy: DELTA_REQUESTED_BY,
      startedAt,
      fetchedAt: new Date().toISOString(),
      notes: failures.length ? { perItemFailures: failures } : {},
    };
    const headers = projectCurrentRows(ITEM_SPECS.item_header, newItems, { runId: run.id, fetchedAt: run.fetchedAt }).rows;
    const details = detailRows.map((row) => ({ ...row, run_id: run.id, fetched_at: run.fetchedAt }));
    const counts = parseDeltaCounts(runSqlImpl(buildItemDetailDeltaSql({ run, headerRows: headers, detailRows: details }), { linked: false }));
    return {
      newItems: newItems.length,
      detailsLanded: counts?.detailsInserted ?? detailRows.length,
      headersLanded: counts?.headersInserted ?? null,
      failures,
    };
  } catch (error) {
    return { newItems: 0, detailsLanded: 0, failures: [], error: `item-details delta skipped: ${error?.message ?? String(error)}` };
  }
}

async function main() {
  const { apply } = parseLoaderArgs(process.argv.slice(2));
  const linked = false; // the Supabase-CLI path is not supported for applies (#3903)
  if (apply) assertExpectedTarget();
  let stage = "fetch";
  try {
    const sweep = await collectItems(readColdlionApiKey());
    const { items, folded } = dedupeItems(sweep.rows);
    sweep.rows = items;
    const payload = buildItemImportPayload(sweep.rows, sweep);
    const divisions = sweep.rows.reduce((counts, row) => {
      counts[row.divisionCode ?? "(missing)"] = (counts[row.divisionCode ?? "(missing)"] ?? 0) + 1;
      return counts;
    }, {});
    let delta = { newItems: 0, detailsLanded: 0, failures: [] };
    if (apply) {
      stage = "item-details-delta";
      delta = await landNewItemDetails(readColdlionApiKey(), sweep.rows);
    }
    process.stdout.write(`${JSON.stringify({ items: sweep.rows.length, pagesFetched: sweep.pagesFetched,
      terminalReached: sweep.terminalReached, duplicateKeysFolded: folded, divisions, apply,
      newItemDetailDelta: { newItems: delta.newItems, detailsLanded: delta.detailsLanded,
        headersLanded: delta.headersLanded ?? null, refused: delta.refused ?? null,
        gated: delta.gated ?? null, error: delta.error ?? null, failures: delta.failures },
      resolutionGuard: process.env.ITEM_MASTER_ALLOW_RESOLUTION_DROP === "true" ? "BYPASSED" : "enforced" }, null, 2)}\n`);
    if (apply) {
      stage = "apply";
      process.stdout.write(runSql(buildItemImportSql(payload, { allowResolutionDrop: process.env.ITEM_MASTER_ALLOW_RESOLUTION_DROP === "true" }), { linked }));
    }
  } catch (error) {
    if (apply) {
      if (isClientSpawnFault(error) || isClientUriFault(error)) {
        process.stderr.write(`CLIENT TOOLING/CONFIG FAULT at stage ${stage}: ${error?.message ?? error}
No durable failed ingest.sync_run row was recorded.
`);
      } else try { runSql(buildFailedSyncRunSql("item_taxonomy_resolver", stage, error.message), { linked }); }
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
