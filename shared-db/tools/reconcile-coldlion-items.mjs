import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const PROD_REF = "qsllyeztdwjgirsysgai";
const API_BASE = "http://x5.coldlion.com/EhpApi";
const SUPABASE_URL = `https://${PROD_REF}.supabase.co`;

function secret(ref) {
  return execFileSync("op", ["read", ref], { encoding: "utf8" }).trim();
}

async function getAllColdLionItems(apiKey) {
  const rows = [];
  let advertised = null;
  for (let page = 0; ; page += 1) {
    const response = await fetch(`${API_BASE}/items?companyCode=EDGEHOME&page=${page}&size=500`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!response.ok) throw new Error(`ColdLion page ${page} failed: HTTP ${response.status}`);
    const envelope = await response.json();
    advertised ??= envelope.totalElements;
    rows.push(...envelope.content);
    if (page + 1 >= envelope.totalPages) break;
  }
  if (rows.length !== advertised) throw new Error(`ColdLion paging mismatch: fetched ${rows.length}, advertised ${advertised}`);
  return rows;
}

async function getAllRows(serviceKey, schema, table, select, orderColumn) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = buildRowsUrl(table, select, orderColumn, offset, pageSize);
    const response = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Accept-Profile": schema },
    });
    if (!response.ok) throw new Error(`Supabase ${schema}.${table} failed: HTTP ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function buildRowsUrl(table, select, orderColumn, offset, pageSize) {
  return `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(orderColumn)}.asc&offset=${offset}&limit=${pageSize}`;
}

function digest(values) {
  return crypto.createHash("sha256").update([...values].sort().join("\n")).digest("hex");
}

const normalized = (value) => String(value ?? "").trim().toUpperCase();
const comparableFields = [
  ["item_description", "itemDesc"],
  ["mg01_code", "merchGroup01"],
  ["mg02_code", "merchGroup02"],
  ["mg03_code", "merchGroup03"],
  ["mg04_code", "merchGroup04"],
  ["mg05_code", "merchGroup05"],
  ["mg06_code", "merchGroup06"],
];

function bestCandidateResolution(row, candidates) {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: comparableFields.reduce((score, [legacyField, coldField]) => {
      const legacyValue = normalized(row[legacyField]);
      return score + (legacyValue && legacyValue === normalized(candidate[coldField]) ? 1 : 0);
    }, 0),
  }));
  const best = Math.max(...scored.map(({ score }) => score), -1);
  const winners = scored.filter(({ score }) => score === best);
  return { count: winners.length, score: best, candidate: winners.length === 1 && best > 0 ? winners[0].candidate : null };
}

async function main() {
const apiKey = secret("op://vibe_coding/zq6cjbz3ycj6psgkeae2devufm/credential");
const serviceKey = secret("op://vibe_coding/3hhxwrljnaq2tykxi7hplq5ryi/SUPABASE_SERVICE_ROLE_KEY");
const legacy = await getAllRows(serviceKey, "public", "erp_items_current", "id,external_id,division_code,dismissed,item_description,mg01_code,mg02_code,mg03_code,mg04_code,mg05_code,mg06_code,licensor_code,property_code", "id");
const bridgeRows = await getAllRows(serviceKey, "public", "style_tracker_rows_with_bridge", "id,bridge_id,erp_item_id", "id");
const coldLion = await getAllColdLionItems(apiKey);

const coldKey = (row) => `${row.companyCode}|${row.divisionCode}|${row.itemNo}`;
const coldByBare = new Map();
const duplicateFull = new Set();
const fullKeys = new Set();
for (const row of coldLion) {
  const full = coldKey(row);
  if (fullKeys.has(full)) duplicateFull.add(full);
  fullKeys.add(full);
  const bare = String(row.itemNo ?? "");
  if (!coldByBare.has(bare)) coldByBare.set(bare, []);
  coldByBare.get(bare).push(row);
}

const legacyBare = new Set(legacy.map((row) => row.external_id));
const unmatchedLegacy = legacy.filter((row) => !coldByBare.has(row.external_id));
const ambiguousLegacy = legacy.filter((row) => (coldByBare.get(row.external_id)?.length ?? 0) > 1);
const ambiguousUniquelyResolvedByContent = ambiguousLegacy.filter((row) => bestCandidateResolution(row, coldByBare.get(row.external_id) ?? []).candidate !== null);
const uniquelyMappedLegacy = legacy.filter((row) => (coldByBare.get(row.external_id)?.length ?? 0) === 1);
const coldOnly = coldLion.filter((row) => !legacyBare.has(String(row.itemNo ?? "")));
const divisionCounts = Object.groupBy(coldLion, (row) => String(row.divisionCode ?? "(null)"));
const coldOnlyDivisionCounts = Object.groupBy(coldOnly, (row) => String(row.divisionCode ?? "(null)"));
const mappedByLegacyId = new Map(uniquelyMappedLegacy.map((row) => [row.id, coldKey(coldByBare.get(row.external_id)[0])]));
for (const row of ambiguousUniquelyResolvedByContent) mappedByLegacyId.set(row.id, coldKey(bestCandidateResolution(row, coldByBare.get(row.external_id) ?? []).candidate));
const linked = bridgeRows.filter((row) => row.erp_item_id !== null);
const linkedUnmapped = linked.filter((row) => !mappedByLegacyId.has(row.erp_item_id));
const legacyById = new Map(legacy.map((row) => [row.id, row]));
const linkedMissing = linked.filter((row) => !coldByBare.has(legacyById.get(row.erp_item_id)?.external_id));
const linkedAmbiguous = linked.filter((row) => (coldByBare.get(legacyById.get(row.erp_item_id)?.external_id)?.length ?? 0) > 1);
const mappedLinkKeys = linked.map((row) => mappedByLegacyId.get(row.erp_item_id)).filter(Boolean);

console.log(JSON.stringify({
  target: { project_ref: PROD_REF, url: SUPABASE_URL },
  coldlion: {
    rows: coldLion.length,
    unique_full_keys: fullKeys.size,
    duplicate_full_keys: duplicateFull.size,
    unique_bare_item_numbers: coldByBare.size,
    divisions: Object.fromEntries(Object.entries(divisionCounts).map(([key, values]) => [key, values.length])),
    identity_hash: digest(fullKeys),
  },
  legacy: {
    rows: legacy.length,
    unique_bare_item_numbers: legacyBare.size,
    nonnull_division: legacy.filter((row) => row.division_code !== null).length,
    dismissed: legacy.filter((row) => row.dismissed).length,
    uniquely_mapped: uniquelyMappedLegacy.length,
    ambiguous: ambiguousLegacy.length,
    ambiguous_uniquely_resolved_by_content: ambiguousUniquelyResolvedByContent.length,
    missing_from_coldlion: unmatchedLegacy.length,
  },
  coldlion_only: {
    rows: coldOnly.length,
    divisions: Object.fromEntries(Object.entries(coldOnlyDivisionCounts).map(([key, values]) => [key, values.length])),
    identity_hash: digest(coldOnly.map(coldKey)),
  },
  bridge: {
    rows: bridgeRows.length,
    linked_rows: linked.length,
    linked_rows_with_unique_mapping: linked.length - linkedUnmapped.length,
    linked_rows_without_mapping: linkedUnmapped.length,
    linked_rows_on_missing_legacy_items: linkedMissing.length,
    linked_rows_on_ambiguous_legacy_items: linkedAmbiguous.length,
    linked_ambiguous_rows_resolved_by_content: linkedAmbiguous.filter((row) => mappedByLegacyId.has(row.erp_item_id)).length,
    mapped_target_unique_keys: new Set(mappedLinkKeys).size,
    current_link_set_hash: digest(linked.map((row) => `${row.bridge_id}|${row.erp_item_id}`)),
    proposed_link_set_hash: digest(linked.filter((row) => mappedByLegacyId.has(row.erp_item_id)).map((row) => `${row.bridge_id}|${mappedByLegacyId.get(row.erp_item_id)}`)),
  },
}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

export { bestCandidateResolution, buildRowsUrl, digest };
