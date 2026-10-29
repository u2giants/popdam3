// #4974: per-item /itemDetails delta for the item sweep (on-demand plus anchors).
//
// The nightly masters landing is the only full writer of coldlion.item_detail,
// which left the Master Data auto-flow (#4956) deciding brand-new items on
// stale evidence until the next 05:20 UTC run. ColdLion's /itemDetails endpoint
// accepts companyCode/divisionCode/itemNo filters
// (docs/coldlion-erp-api-reference.md), so the sweep pulls the detail rows of
// each NEW item in the same cycle, BEFORE the import SQL runs: the assortment
// marker (pre_pack_code) is then already on the row the auto-flow reads, and a
// new assortment is skipped instantly instead of after the nightly landing.
//
// Row shape is the masters loader's own: ITEM_SPECS + projectCurrentRows project
// the vendor payload into the FULL current-state column set (validated shape,
// canonical source hashes, verbatim payload kept for change_log), so a delta
// row is indistinguishable from a masters-landed row of the same vintage.
//
// Landing is INSERT-only with ON CONFLICT DO NOTHING — the nightly masters
// landing owns updates and deletes. The delta never advances the auto-flow's
// evidence clock: that clock (#4974 migration) reads only
// 'coldlion-landing sync-masters' runs, never this delta's sync_run rows.

import { COLDLION_BASE_URL } from "../../coldlion-sync-common.mjs";
import { ITEM_SPECS } from "./master-specs.mjs";
import { projectCurrentRows } from "./project-masters.mjs";
import { sqlDate, sqlNumber, sqlText, sqlTimestamp, sqlUuid } from "./values.mjs";

// A run that would treat more than this many items as new is not a normal
// delta (2-25/day is the measured nightly range) — it is a ColdLion-side
// anomaly and must not fan out into per-item GETs. Land nothing; the nightly
// masters run covers the items instead.
export const MAX_DELTA_ITEMS = 20;

// Bounded worst case: MAX_DELTA_ITEMS sequential GETs at this timeout, inside a
// global deadline the loop checks before every fetch. The sweep job ceiling is
// 15 minutes and the same tool runs first in the ~118-minute nightly landing
// pipeline, whose later steps must not be starved.
export const DETAIL_FETCH_TIMEOUT_MS = 10_000;
export const DELTA_DEADLINE_MS = 240_000;

export const DELTA_REQUESTED_BY = "coldlion-item-sweep";

const clean = (value) => String(value ?? "").trim();

// Newness is (company, division, itemNo) — item numbers repeat across
// divisions (20 measured live, 20260905014719), so an item_number-only test
// would starve cross-division new items of the instant path.
export function newItemsFromPayload(payloadItems, existingIdentities) {
  const existing = new Set(existingIdentities.map((parts) => parts.map(clean).join("\u0000")));
  return payloadItems.filter((row) => {
    if (!clean(row?.itemNo) || !clean(row?.companyCode) || !clean(row?.divisionCode)) return false;
    if (clean(row.divisionCode) === "EP001") return false; // masters lands no EP001 detail rows
    return !existing.has([row.companyCode, row.divisionCode, row.itemNo].map(clean).join("\u0000"));
  });
}

// A detail row is landable only when it belongs to the item that was asked for
// and carries a complete natural key; anything else is a vendor surprise and is
// reported, never landed (projectCurrentRows checks shape, not scope).
export function validDetailRow(detail, request) {
  if (!clean(detail?.itemPkey) || !clean(detail?.itemNo)) return "blank natural key";
  if (clean(detail.companyCode) !== clean(request.companyCode)
    || clean(detail.divisionCode) !== clean(request.divisionCode)
    || clean(detail.itemNo) !== clean(request.itemNo)) return "row outside the requested scope";
  if (clean(detail.divisionCode) === "EP001") return "EP001 detail rows do not exist by design";
  return null;
}

export async function fetchItemDetails(apiKey, { companyCode, divisionCode, itemNo }, fetchImpl = fetch) {
  const url = new URL(`${COLDLION_BASE_URL}/itemDetails`);
  url.searchParams.set("companyCode", companyCode);
  url.searchParams.set("divisionCode", divisionCode);
  url.searchParams.set("itemNo", itemNo);
  const response = await fetchImpl(url, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(DETAIL_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${url} returned a non-array body`);
  return payload;
}

const emitters = { text: sqlText, keytext: sqlText, num: sqlNumber, date: sqlDate, ts: sqlTimestamp };

// Full-column insert for a projected spec row. projectCurrentRows has already
// validated the shape, keys, and EP001 exclusion, so nothing here re-checks.
function landingStatements(table, spec, projectedRows, run) {
  if (!projectedRows.length) {
    return [
      `create temp table _delta_${table}_inserted on commit drop as select ${spec.key.map((column) => `null::text as ${column}`).join(", ")} where false;`,
    ];
  }
  const columns = [...spec.fields.map((field) => field.column)];
  const tuples = projectedRows
    .map((row) => `  (${[...spec.fields.map((field) => emitters[field.type](row[field.column])), sqlText(row.source_hash), sqlUuid(run.id), sqlTimestamp(row.fetched_at), sqlTimestamp(row.fetched_at), sqlTimestamp(row.fetched_at)].join(", ")})`)
    .join(",\n");
  const evidence = projectedRows
    .map((row) => `  (${spec.key.map((column) => sqlText(row[column])).join(", ")}, ${sqlText(row.source_hash)}, ${sqlText(JSON.stringify(row.source_raw))}::jsonb)`)
    .join(",\n");
  return [
    `insert into coldlion.${table} (${[...columns, "source_hash", "run_id", "fetched_at", "first_seen_at", "last_seen_at"].join(", ")})`,
    "values",
    tuples,
    `on conflict (${spec.key.join(", ")}) do nothing;`,
    `create temp table _delta_${table}_inserted on commit drop as`,
    "select v.* from (values",
    evidence,
    `) as v(${[...spec.key, "source_hash", "raw"].join(", ")})`,
    `where exists (select 1 from coldlion.${table} t where ${spec.key.map((column) => `t.${column} = v.${column}`).join(" and ")} and t.run_id = ${sqlUuid(run.id)});`,
    `insert into coldlion.change_log (table_name, natural_key, change_kind, new_source_hash, new_raw, run_id)`,
    `select '${table}', jsonb_build_object(${spec.key.flatMap((column) => [`'${column}'`, `h.${column}`]).join(", ")}), 'inserted', h.source_hash, h.raw, ${sqlUuid(run.id)}`,
    `  from _delta_${table}_inserted h;`,
  ];
}

// One transaction: sync_run first (its children carry immediate FKs to it),
// insert-only landing through the masters projections, then the finishing
// update with the true inserted counts and a DB-visible per-item failure note
// (the notes column is text; the JSON string is deliberate so failures are
// queryable with notes::jsonb).
export function buildItemDetailDeltaSql({ run, headerRows, detailRows }) {
  return [
    "begin;",
    `insert into coldlion.sync_run (id, endpoint, company_code, division_code, request_params, status, requested_by, started_at, finished_at, rows_fetched)`,
    `values (${sqlUuid(run.id)}, '/itemDetails', ${sqlText(run.companyCode)}, ${sqlText(run.divisionCode)}, ${sqlText(JSON.stringify(run.requestParams))}::jsonb, 'running', ${sqlText(run.requestedBy)}, ${sqlTimestamp(run.startedAt)}, ${sqlTimestamp(run.fetchedAt)}, ${detailRows.length});`,
    ...landingStatements("item_header", ITEM_SPECS.item_header, headerRows, run),
    ...landingStatements("item_detail", ITEM_SPECS.item_detail, detailRows, run),
    `update coldlion.sync_run set status = 'succeeded',`,
    `  rows_inserted = (select count(*) from _delta_item_detail_inserted),`,
    `  notes = ${sqlText(JSON.stringify(run.notes ?? {}))}`,
    ` where id = ${sqlUuid(run.id)};`,
    "select (select count(*) from _delta_item_detail_inserted) as details_inserted, (select count(*) from _delta_item_header_inserted) as headers_inserted;",
    "commit;",
    "",
  ].join("\n");
}

// The last "N\tM" line of the delta SQL's unaligned tuples-only output.
export function parseDeltaCounts(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^(\d+)\t(\d+)$/.exec(lines[index]);
    if (match) return { detailsInserted: Number(match[1]), headersInserted: Number(match[2]) };
  }
  return null;
}
