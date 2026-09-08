#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE_URL = "http://x5.coldlion.com/EhpApi";
const COMPANY_CODE = "EDGEHOME";
const BATCH_SIZE = 500;

const HEADER_KEYS = ["company_code", "division_code", "item_no"];
const DETAIL_KEYS = ["company_code", "division_code", "item_no", "item_pkey"];
const MERCH_KEYS = ["company_code", "division_code", "item_no", "item_pkey", "slot_no"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snakeCase(key) {
  return key
    .replace(/^mGCategory$/, "mgCategory")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function scalar(value) {
  return value === "" ? null : value;
}

export function projectRecord(raw, runId, fetchedAt) {
  const projected = {};
  for (const [key, value] of Object.entries(raw)) {
    if (/^merchGroup\d\d(?:Desc)?$/.test(key)) continue;
    projected[snakeCase(key)] = scalar(value);
  }
  projected.run_id = runId;
  projected.fetched_at = fetchedAt;
  projected.source_hash = sha256(stableJson(raw));
  projected.first_seen_at = fetchedAt;
  projected.last_seen_at = fetchedAt;
  return projected;
}

export function projectMerchGroups(raw, runId, fetchedAt, itemPkey = null) {
  const rows = [];
  for (let slot = 1; slot <= 14; slot += 1) {
    const suffix = String(slot).padStart(2, "0");
    const code = String(raw[`merchGroup${suffix}`] ?? "").trim();
    if (!code) continue;
    const row = {
      id: randomUUID(),
      company_code: raw.companyCode,
      division_code: raw.divisionCode,
      item_no: raw.itemNo,
      item_pkey: itemPkey,
      slot_no: slot,
      mg_code: code,
      mg_desc: scalar(raw[`merchGroup${suffix}Desc`]),
      run_id: runId,
      fetched_at: fetchedAt,
      first_seen_at: fetchedAt,
      last_seen_at: fetchedAt,
    };
    row.source_hash = sha256(stableJson({ code: row.mg_code, description: row.mg_desc }));
    rows.push(row);
  }
  return rows;
}

async function fetchJson(path, apiKey, params = {}, fetchImpl = fetch) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

export async function collectItems(apiKey, fetchImpl = fetch) {
  const rows = [];
  let page = 0;
  let pagesFetched = 0;
  for (;;) {
    const payload = await fetchJson("/items", apiKey, {
      companyCode: COMPANY_CODE, size: 200, page,
    }, fetchImpl);
    if (!Array.isArray(payload?.content)) throw new Error("/items did not return a page envelope");
    rows.push(...payload.content);
    pagesFetched += 1;
    if (payload.last === true || payload.content.length === 0) break;
    page += 1;
  }
  return { rows, pagesFetched };
}

export async function collectItemDetails(apiKey, fetchImpl = fetch) {
  const payload = await fetchJson("/itemDetails", apiKey, { companyCode: COMPANY_CODE }, fetchImpl);
  if (!Array.isArray(payload)) throw new Error("/itemDetails did not return its documented bare array");
  return payload;
}

async function mapConcurrent(values, concurrency, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export async function probePrepackDetails(codes, apiKey, fetchImpl = fetch) {
  const results = await mapConcurrent(codes, 6, async (code) => {
    const payload = await fetchJson("/prepackDetail", apiKey, {
      companyCode: COMPANY_CODE, prepackCode: code,
    }, fetchImpl);
    const rows = Array.isArray(payload) ? payload : payload?.content;
    if (!Array.isArray(rows)) throw new Error(`/prepackDetail returned an unknown shape for code ${code}`);
    return { code, rows: rows.length, hash: sha256(stableJson(rows)) };
  });
  return {
    codesProbed: results.length,
    rowsFetched: results.reduce((sum, result) => sum + result.rows, 0),
    emptyCodes: results.filter((result) => result.rows === 0).length,
    sourceHash: sha256(stableJson(results)),
  };
}

function quoteJson(value) {
  const text = JSON.stringify(value).replaceAll("'", "''");
  return `'${text}'::jsonb`;
}

function insertBatches(tempTable, recordType, rows) {
  const statements = [];
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    statements.push(`insert into ${tempTable} select * from jsonb_populate_recordset(null::${recordType}, ${quoteJson(rows.slice(index, index + BATCH_SIZE))});`);
  }
  return statements.join("\n");
}

function upsertSql(table, tempTable, keys, runId) {
  const keysSql = keys.map((key) => `'${key}'`).join(",");
  const conflictSql = keys.map((key) => `"${key}"`).join(",");
  return `
do $upsert$
declare v_columns text; v_updates text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum),
         string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
           filter (where a.attname not in (${keysSql}, 'first_seen_at'))
    into v_columns, v_updates
    from pg_attribute a
   where a.attrelid = '${table}'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'id';
  execute format('insert into ${table} (%s) select %s from ${tempTable} on conflict (${conflictSql}) do update set %s',
                 v_columns, v_columns, v_updates);
end $upsert$;
`;
}

function syncRunStatsSql(table, tempTable, keys, runId) {
  const match = keys.map((key) => `target.${key} is not distinct from incoming.${key}`).join(" and ");
  return `update coldlion.sync_run set
  rows_inserted = (select count(*) from ${tempTable} incoming where not exists (select 1 from ${table} target where ${match})),
  rows_updated = (select count(*) from ${tempTable} incoming where exists (select 1 from ${table} target where ${match} and target.source_hash is distinct from incoming.source_hash)),
  rows_unchanged = (select count(*) from ${tempTable} incoming where exists (select 1 from ${table} target where ${match} and target.source_hash = incoming.source_hash))
where id = '${runId}'::uuid;`;
}

export function buildLoadSql({ headers, details, merchGroups, itemRunId, detailRunId, probeRunId, fetchedAt, itemPages, probe }) {
  return `\\set ON_ERROR_STOP on
begin;
set local statement_timeout = '15min';
insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, http_status, rows_fetched, notes)
values
 ('${itemRunId}', '/items', '${COMPANY_CODE}', jsonb_build_object('size',200,'pages_fetched',${itemPages}), 'succeeded', 'popdam3 issue 114 loader', '${fetchedAt}', now(), 200, ${headers.length}, 'Complete terminal page reached; EP001 excluded by landing contract.'),
 ('${detailRunId}', '/itemDetails', '${COMPANY_CODE}', jsonb_build_object('response_shape','bare_array'), 'succeeded', 'popdam3 issue 114 loader', '${fetchedAt}', now(), 200, ${details.length}, 'Complete bare array; endpoint ignores paging parameters.'),
 ('${probeRunId}', '/prepackDetail', '${COMPANY_CODE}', jsonb_build_object('codes_probed',${probe.codesProbed},'aggregate_source_hash','${probe.sourceHash}'), 'succeeded', 'popdam3 issue 114 loader', '${fetchedAt}', now(), 200, ${probe.rowsFetched}, 'Fan-out probe over every distinct nonblank itemDetails prePackCode; no landing relation exists for component rows. Empty-code results: ${probe.emptyCodes}.');

create temp table incoming_headers (like coldlion.item_header including defaults) on commit drop;
create temp table incoming_details (like coldlion.item_detail including defaults) on commit drop;
create temp table incoming_merch (like coldlion.item_merch_group including defaults) on commit drop;
${insertBatches("incoming_headers", "coldlion.item_header", headers)}
${insertBatches("incoming_details", "coldlion.item_detail", details)}
${insertBatches("incoming_merch", "coldlion.item_merch_group", merchGroups)}
create unique index incoming_headers_identity on incoming_headers (company_code, division_code, item_no);
create unique index incoming_details_identity on incoming_details (company_code, division_code, item_no, item_pkey);
create unique index incoming_merch_identity on incoming_merch (company_code, division_code, item_no, item_pkey, slot_no) nulls not distinct;
analyze incoming_headers;
analyze incoming_details;
analyze incoming_merch;
${syncRunStatsSql("coldlion.item_header", "incoming_headers", HEADER_KEYS, itemRunId)}
${syncRunStatsSql("coldlion.item_detail", "incoming_details", DETAIL_KEYS, detailRunId)}
${upsertSql("coldlion.item_header", "incoming_headers", HEADER_KEYS, itemRunId)}
${upsertSql("coldlion.item_detail", "incoming_details", DETAIL_KEYS, detailRunId)}
${upsertSql("coldlion.item_merch_group", "incoming_merch", MERCH_KEYS, detailRunId)}
delete from coldlion.item_merch_group
where company_code='${COMPANY_CODE}' and division_code <> 'EP001'
  and run_id not in ('${itemRunId}'::uuid, '${detailRunId}'::uuid);
delete from coldlion.item_detail
where company_code='${COMPANY_CODE}' and division_code <> 'EP001'
  and run_id <> '${detailRunId}'::uuid;
delete from coldlion.item_header
where company_code='${COMPANY_CODE}' and division_code <> 'EP001'
  and run_id <> '${itemRunId}'::uuid;

update coldlion.sync_run r set
  duration_ms = greatest(0, extract(epoch from (now() - r.started_at)) * 1000)::integer
where r.id in ('${itemRunId}','${detailRunId}','${probeRunId}');
commit;

select json_build_object(
  'item_headers', (select count(*) from coldlion.item_header),
  'item_details', (select count(*) from coldlion.item_detail),
  'detail_items_with_prepack', (select count(distinct (company_code, division_code, item_no)) from coldlion.item_detail where nullif(btrim(pre_pack_code),'') is not null),
  'detail_distinct_prepack_codes', (select count(distinct pre_pack_code) from coldlion.item_detail where nullif(btrim(pre_pack_code),'') is not null),
  'frozen_items_with_prepack', (select count(*) from public.erp_items_current where nullif(btrim(prepack_code),'') is not null),
  'matching_items', (select count(*) from public.erp_items_current e where nullif(btrim(e.prepack_code),'') is not null and exists (select 1 from coldlion.item_detail d where d.item_no=e.style_number and d.pre_pack_code=e.prepack_code)),
  'changed_items', (select count(*) from public.erp_items_current e where nullif(btrim(e.prepack_code),'') is not null and exists (select 1 from coldlion.item_detail d where d.item_no=e.style_number and nullif(btrim(d.pre_pack_code),'') is not null) and not exists (select 1 from coldlion.item_detail d where d.item_no=e.style_number and d.pre_pack_code=e.prepack_code)),
  'frozen_only_items', (select count(*) from public.erp_items_current e where nullif(btrim(e.prepack_code),'') is not null and not exists (select 1 from coldlion.item_detail d where d.item_no=e.style_number and nullif(btrim(d.pre_pack_code),'') is not null))
) as reconciliation;
`;
}

function runPsql(sql) {
  const required = ["PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing protected database environment: ${missing.join(", ")}`);
  if (process.env.PGHOST !== "aws-1-us-east-1.pooler.supabase.com" ||
      process.env.PGUSER !== "postgres.qsllyeztdwjgirsysgai" ||
      process.env.PGDATABASE !== "postgres") {
    throw new Error("Database target is not the Virginia shared POP production project");
  }
  const dir = mkdtempSync(join(tmpdir(), "popdam-prepack-"));
  const file = join(dir, "load.sql");
  try {
    writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
    const result = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", file], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || "psql failed");
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!process.argv.includes("--apply")) throw new Error("Refusing to write without --apply");
  const apiKey = process.env.COLDLION_API_KEY;
  if (!apiKey) throw new Error("COLDLION_API_KEY must be protected-injected");
  const fetchedAt = new Date().toISOString();
  const itemRunId = randomUUID();
  const detailRunId = randomUUID();
  const probeRunId = randomUUID();
  const [{ rows: rawHeaders, pagesFetched }, rawDetails] = await Promise.all([
    collectItems(apiKey), collectItemDetails(apiKey),
  ]);
  const filteredHeaders = rawHeaders.filter((row) => row.divisionCode !== "EP001");
  const headerKeys = new Set(filteredHeaders.map((row) => `${row.companyCode}\0${row.divisionCode}\0${row.itemNo}`));
  const filteredDetails = rawDetails.filter((row) => row.divisionCode !== "EP001" && headerKeys.has(`${row.companyCode}\0${row.divisionCode}\0${row.itemNo}`));
  if (rawDetails.length < 20_000) throw new Error(`Short /itemDetails pull refused: ${rawDetails.length} rows`);
  const codes = [...new Set(filteredDetails.map((row) => String(row.prePackCode ?? "").trim()).filter(Boolean))].sort();
  const probe = await probePrepackDetails(codes, apiKey);
  const headers = filteredHeaders.map((row) => projectRecord(row, itemRunId, fetchedAt));
  const details = filteredDetails.map((row) => projectRecord(row, detailRunId, fetchedAt));
  const merchGroups = [
    ...filteredHeaders.flatMap((row) => projectMerchGroups(row, itemRunId, fetchedAt)),
    ...filteredDetails.flatMap((row) => projectMerchGroups(row, detailRunId, fetchedAt, row.itemPkey)),
  ];
  const sql = buildLoadSql({ headers, details, merchGroups, itemRunId, detailRunId, probeRunId, fetchedAt, itemPages: pagesFetched, probe });
  process.stdout.write(runPsql(sql));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
