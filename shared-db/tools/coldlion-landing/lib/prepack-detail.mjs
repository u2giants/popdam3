// ColdLion /prepackDetail landing: spec, projection, harvest and load SQL.
//
// Issue #3179 (table created by #2863, migration 20260916001944). This feed is
// NOT paged and NOT company-snapshot-able: `prepackCode` is a required request
// parameter, so the population is enumerated by harvesting codes from tables the
// repository's own loaders have already landed, then asking once per key.
//
// The grain, the 18-field shape and the live behaviours this must tolerate are
// docs/coldlion-unit-5b-grain-proof-20260915.md. Two facts drive the design:
//
//   * `(company_code, prepack_code, sequence_no)` is the primary key the table
//     already asserts. A response that repeats it is an identity collision and
//     ABORTS the run; two versions of one line are never collapsed.
//   * `itemPrice` and `ItemPrice` are two real properties on every row. Both
//     land (item_price / item_price_capitalized) and neither is folded.
//
// Zero-row responses are the one expected non-error: a harvested code whose
// recipe the vendor no longer (or not yet) holds answers `[]`. They are counted,
// named on the sync_run and alerted — never silently skipped, never fatal. A
// response that is not a bare JSON array is malformed and fails loudly.

import { bigint, num, sourceHash, sqlNumber, sqlText, sqlTimestamp, sqlUuid, text } from "./values.mjs";
import { assertKnownShape } from "./project-masters.mjs";

const f = (api, column, type = "text") => ({ api, column, type });

export const PREPACK_DETAIL_TABLE = "prepack_detail";

// All eighteen sampled fields land. None is owner-ignored: the field-decisions
// CSV does not cover this feed (grain proof §1), so the landing layer takes all
// of them, exactly as unit 5a did.
export const PREPACK_DETAIL_SPEC = Object.freeze({
  endpoint: "/prepackDetail",
  key: ["company_code", "prepack_code", "sequence_no"],
  paged: false,
  fields: Object.freeze([
    f("companyCode", "company_code"),
    f("prePackCode", "prepack_code"),
    f("sequence", "sequence_no", "int"),
    f("divisionCode", "division_code"),
    f("itemNo", "item_no"),
    f("colorCode", "color_code"),
    f("sizeCode", "size_code"),
    f("dimCode", "dim_code"),
    f("labelCode", "label_code"),
    f("quantity", "quantity", "int"),
    f("detailPrepack", "detail_prepack"),
    f("itemCost", "item_cost", "num"),
    f("itemPrice", "item_price", "num"),
    f("ItemPrice", "item_price_capitalized", "num"),
    f("createdTime", "created_time", "ts"),
    f("createdUser", "created_user"),
    f("modTime", "mod_time", "ts"),
    f("modUser", "mod_user"),
  ]),
});

function timestamp(value) {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error("a timestamp field was not an ISO timestamp");
  if (parsed.toISOString() <= "1900-01-01T23:59:59.999Z") return null;
  return parsed.toISOString();
}

// int fields land as SQL integer columns; a fractional or oversized value is
// refused loudly (the migration's LOADER NOTE) rather than truncated.
const converters = { text, num, int: bigint, ts: timestamp };

/**
 * Project raw /prepackDetail rows into landing rows.
 *
 * Refuses, before anything is staged: unknown fields, omitted approved fields,
 * blank natural keys, and any repeated (company, prepack, sequence) — the grain
 * the table's own primary key asserts. EP001 is deliberately NOT excluded (unit
 * 5b: transactional feed, exclusion belongs to promotion).
 */
export function projectPrepackRows(sourceRows, { runId, fetchedAt } = {}) {
  try {
    assertKnownShape(PREPACK_DETAIL_SPEC, sourceRows);
  } catch (error) {
    error.endpoint ??= PREPACK_DETAIL_SPEC.endpoint;
    throw error;
  }
  const byKey = new Map();
  for (const source of sourceRows) {
    const row = {};
    for (const field of PREPACK_DETAIL_SPEC.fields) row[field.column] = converters[field.type](source[field.api]);
    row.source_hash = sourceHash(source);
    row.source_raw = source;
    row.run_id = runId;
    row.fetched_at = fetchedAt;
    const key = PREPACK_DETAIL_SPEC.key.map((column) => row[column] ?? "").join("\u001f");
    if (PREPACK_DETAIL_SPEC.key.some((column) => row[column] === null)) {
      const error = new Error(`${PREPACK_DETAIL_SPEC.endpoint} returned a blank natural key`);
      error.endpoint = PREPACK_DETAIL_SPEC.endpoint;
      throw error;
    }
    if (byKey.has(key)) {
      const error = new Error(`${PREPACK_DETAIL_SPEC.endpoint} returned duplicate rows for one natural key`);
      error.endpoint = PREPACK_DETAIL_SPEC.endpoint;
      throw error;
    }
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()], byKey };
}

/**
 * Every row must answer the request that fetched it: the payload carries both
 * `companyCode` and `prePackCode`, and a row naming either one unfaithfully is
 * an identity collision that aborts the run before anything lands. The message
 * names the requested key and the code the row actually answers — short ERP
 * codes only, never other row values — so a live refusal is diagnosable from
 * the run log alone.
 *
 * The prepack comparison folds CASE. The vendor spells one real key two ways
 * across its own feeds (2026-09-18, run 35288752430: the harvest asked PPk133
 * as /itemDetails had emitted it; /prepackDetail answered PPK133) — the same
 * key-inconsistency class as the /seasons defect, with no signal in the
 * envelope. The landed prepack_code keeps the ROW's spelling, which is what
 * this feed asserts as its own grain, so a replay through either spelling
 * upserts onto one row and identities cannot split. A genuinely different
 * code still refuses, and the company comparison stays case-sensitive: no
 * company drift has ever been observed, and a future one must abort loudly
 * with both spellings named.
 */
export function assertRowsAnswerRequest(sourceRows, { companyCode, prepackCode }) {
  for (const row of sourceRows) {
    if (String(row.companyCode ?? "").trim() !== String(companyCode).trim()) {
      throw Object.assign(
        new Error(`${PREPACK_DETAIL_SPEC.endpoint} returned a row for another company: asked ${String(companyCode).trim()}, row answers ${String(row.companyCode ?? "").trim() || "(blank)"}`),
        { endpoint: PREPACK_DETAIL_SPEC.endpoint, requestParams: { companyCode, prepackCode } },
      );
    }
    const asked = String(prepackCode ?? "").trim();
    const answers = String(row.prePackCode ?? "").trim();
    if (!asked || asked.toUpperCase() !== answers.toUpperCase()) {
      throw Object.assign(
        new Error(`${PREPACK_DETAIL_SPEC.endpoint} returned a row for another prepack code: asked ${asked}, row answers ${answers || "(blank)"}`),
        { endpoint: PREPACK_DETAIL_SPEC.endpoint, requestParams: { companyCode, prepackCode } },
      );
    }
  }
}

// ---------------------------------------------------------------------------------
// Harvest: the complete prepackCode population from ALREADY-LANDED ColdLion data.
//
// The grain proof enumerated this feed from /inventory and /proddetails, but a
// loader that re-walked the vendor to find its keys would need a second
// enumeration framework and could drift from what the repository has landed.
// Issue #3179 fixes the population source instead: the tables this repository
// itself maintains. The two unit-5a/5b tables that have no loader yet are
// probed with to_regclass and contribute the moment their own loaders exist.
// ---------------------------------------------------------------------------------

export const PREPACK_HARVEST_SOURCES = Object.freeze([
  { source: "item_detail", table: "coldlion.item_detail", column: "pre_pack_code", feed: "/itemDetails", required: true },
  { source: "prod_history_line", table: "coldlion.prod_history_line", column: "pre_pack_code", feed: "/prodHistory", required: true },
  { source: "order_history_line", table: "coldlion.order_history_line", column: "pre_pack_code", feed: "/orderHistory", required: true },
  { source: "inventory", table: "coldlion.inventory", column: "prepack_code", feed: "/inventory", required: false },
  { source: "prod_detail", table: "coldlion.prod_detail", column: "prepack_code", feed: "/proddetails", required: false },
]);

export function buildHarvestExistenceSql(sources = PREPACK_HARVEST_SOURCES) {
  const rows = sources.map((entry) =>
    `select '${entry.source}' as source, to_regclass('${entry.table}') is not null and exists (
       select 1 from information_schema.columns
        where table_schema = 'coldlion' and table_name = '${entry.table.split(".")[1]}' and column_name = '${entry.column}'
     ) as present`,
  );
  return rows.join("\nunion\n") + ";";
}

/** The loader's own landing table must exist: loading into a database missing it is a target mismatch. */
export function buildLandingTableExistenceSql() {
  return `select to_regclass('${PREPACK_HARVEST_LANDING_TABLE}') is not null as present;`;
}

export const PREPACK_HARVEST_LANDING_TABLE = `coldlion.${PREPACK_DETAIL_TABLE}`;

export function buildHarvestKeysSql(sources) {
  const selects = sources.map((entry) =>
    `select '${entry.source}' as source, ${entry.column} as code from ${entry.table} where ${entry.column} is not null and btrim(${entry.column}) <> ''`,
  );
  return selects.join("\nunion all\n") + "\norder by code;";
}

/** Distinct, trimmed codes plus per-source distinct counts. Counts only — no code is printed by the loader. */
export function reduceHarvestRows(rows) {
  const perSource = new Map();
  const codes = new Set();
  for (const [source, code] of rows) {
    const trimmed = String(code ?? "").trim();
    if (!trimmed) continue;
    codes.add(trimmed);
    const seen = perSource.get(source) ?? new Set();
    seen.add(trimmed);
    perSource.set(source, seen);
  }
  return {
    keys: [...codes].sort(),
    perSource: Object.fromEntries([...perSource.entries()].map(([source, seen]) => [source, seen.size])),
  };
}

// ---------------------------------------------------------------------------------
// Coverage: which harvested codes a previous successful run already asked.
//
// Resumability lives in coldlion.sync_run.request_params (no schema change is
// authorized): every successful run records the CUMULATIVE covered set — its
// own keys union the previous run's — so a bounded backfill interrupted at any
// point resumes exactly where the evidence stops, and a full refresh resets the
// set to the whole harvested population.
// ---------------------------------------------------------------------------------

export function buildCoverageReadSql(companyCode) {
  return `select id::text, finished_at::text, coalesce(request_params->'coveredKeys', '[]'::jsonb)::text
  from coldlion.sync_run
 where endpoint = '/prepackDetail' and status = 'succeeded' and company_code = ${sqlText(companyCode)}
 order by finished_at desc
 limit 1;`;
}

export function parseCoverageRow(row) {
  if (!row) return { coveredKeys: new Set(), runId: null, finishedAt: null };
  let parsed;
  try {
    parsed = JSON.parse(row[2]);
  } catch {
    throw new Error("the last successful /prepackDetail run recorded an unreadable coveredKeys array");
  }
  if (!Array.isArray(parsed) || parsed.some((code) => typeof code !== "string")) {
    throw new Error("the last successful /prepackDetail run recorded a malformed coveredKeys array");
  }
  return { coveredKeys: new Set(parsed), runId: row[0], finishedAt: row[1] };
}

// ---------------------------------------------------------------------------------
// Load SQL. One transaction: run record, stage, change_log, upsert, and the
// delete of sequences the current responses no longer carry for the codes this
// run actually asked (current-state semantics — a removed recipe line must not
// linger forever). Replay is a no-op: ON CONFLICT DO UPDATE with identical
// source_hash touches nothing and writes no change_log row.
// ---------------------------------------------------------------------------------

const BATCH = 300;

const PG = { text: "text", int: "integer", num: "numeric", ts: "timestamptz" };
const emitters = { text: sqlText, int: sqlNumber, num: sqlNumber, ts: sqlTimestamp };

function stagePrepackSql(rows) {
  const columns = [
    ...PREPACK_DETAIL_SPEC.fields.map((x) => [x.column, PG[x.type]]),
    ["source_hash", "text"],
    ["source_raw", "jsonb"],
    ["run_id", "uuid"],
    ["fetched_at", "timestamptz"],
  ];
  const statements = [
    `create temp table _stage_prepack (\n  ${columns.map(([c, t]) => `${c} ${t}`).join(",\n  ")}\n) on commit drop;`,
  ];
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    statements.push(`insert into _stage_prepack (${columns.map(([c]) => c).join(", ")}) values\n${batch
      .map((row) => `  (${[
        ...PREPACK_DETAIL_SPEC.fields.map((field) => emitters[field.type](row[field.column])),
        sqlText(row.source_hash),
        `${sqlText(JSON.stringify(row.source_raw))}::jsonb`,
        sqlUuid(row.run_id),
        sqlTimestamp(row.fetched_at),
      ].join(", ")})`)
      .join(",\n")};`);
  }
  return statements.join("\n");
}

function fetchedCodesSql(fetchedCodes, companyCode) {
  const values = fetchedCodes.map((code) => `  (${sqlText(companyCode)}, ${sqlText(code)})`).join(",\n");
  return `create temp table _fetched_prepacks (company_code text, prepack_code text) on commit drop;
${values ? `insert into _fetched_prepacks values\n${values};` : ""}`;
}

function runStartSql(run) {
  return `insert into coldlion.sync_run (id,endpoint,company_code,request_params,status,requested_by,started_at,http_status,body_status,rows_fetched)
values (${sqlUuid(run.id)},${sqlText(run.endpoint)},${sqlText(run.companyCode)},${sqlText(JSON.stringify(run.requestParams))}::jsonb,'running',${sqlText(run.requestedBy)},${sqlTimestamp(run.startedAt)},${sqlNumber(run.httpStatus)},${sqlNumber(run.bodyStatus)},${sqlNumber(run.rowsFetched)});`;
}

function runFinishSql(run, notes) {
  return `update coldlion.sync_run set status='succeeded', finished_at=${sqlTimestamp(run.finishedAt)}, duration_ms=${sqlNumber(run.durationMs)}, notes=${sqlText(notes)},
 rows_inserted=(select inserted from _counts_prepack), rows_updated=(select updated from _counts_prepack), rows_unchanged=(select unchanged from _counts_prepack)
 where id=${sqlUuid(run.id)};`;
}

/**
 * Build the whole load transaction.
 *
 * `run.requestParams` must already carry the durable coverage evidence
 * (coveredKeys cumulative, zeroRowKeys for this run, harvest counts). `rows` are
 * projected rows for every non-empty response; `fetchedCodes` are ALL codes this
 * run asked about, zero-row ones included, so the absent-sequence delete cannot
 * fire for a code the run never questioned.
 */
export function buildPrepackLoadSql({ run, rows, fetchedCodes, notes }) {
  const join = "t.company_code = s.company_code and t.prepack_code = s.prepack_code and t.sequence_no = s.sequence_no";
  const naturalKey = `jsonb_build_object('company_code', s.company_code, 'prepack_code', s.prepack_code, 'sequence_no', s.sequence_no)`;
  const previousRaw = `(to_jsonb(t) - array['run_id','fetched_at','first_seen_at','last_seen_at']::text[])`;
  const updates = [
    ...PREPACK_DETAIL_SPEC.fields.map((x) => x.column).filter((c) => !PREPACK_DETAIL_SPEC.key.includes(c)).map((c) => `${c} = excluded.${c}`),
    "run_id = excluded.run_id",
    "fetched_at = excluded.fetched_at",
    "source_hash = excluded.source_hash",
    "last_seen_at = excluded.last_seen_at",
  ].join(",\n      ");
  const all = [...PREPACK_DETAIL_SPEC.fields.map((x) => x.column), "run_id", "fetched_at", "source_hash", "first_seen_at", "last_seen_at"];
  return `begin;

${runStartSql(run)}

${stagePrepackSql(rows)}

${fetchedCodesSql(fetchedCodes, run.companyCode)}

create temp table _counts_prepack on commit drop as
select count(*) filter (where t.company_code is null) as inserted,
       count(*) filter (where t.company_code is not null and t.source_hash <> s.source_hash) as updated,
       count(*) filter (where t.company_code is not null and t.source_hash = s.source_hash) as unchanged,
       (select count(*) from coldlion.${PREPACK_DETAIL_TABLE} d join _fetched_prepacks f
          on d.company_code = f.company_code and d.prepack_code = f.prepack_code
         where not exists (select 1 from _stage_prepack s where s.company_code = d.company_code and s.prepack_code = d.prepack_code and s.sequence_no = d.sequence_no)) as deleted
  from _stage_prepack s left join coldlion.${PREPACK_DETAIL_TABLE} t on ${join};

insert into coldlion.change_log
  (table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id)
select ${sqlText(PREPACK_DETAIL_TABLE)}, ${naturalKey}, case when t.company_code is null then 'inserted' else 'updated' end,
       t.source_hash, s.source_hash, case when t.company_code is null then null else ${previousRaw} end, s.source_raw, s.run_id
  from _stage_prepack s left join coldlion.${PREPACK_DETAIL_TABLE} t on ${join}
 where t.company_code is null or t.source_hash <> s.source_hash;

insert into coldlion.change_log
  (table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id)
select ${sqlText(PREPACK_DETAIL_TABLE)},
       jsonb_build_object('company_code', d.company_code, 'prepack_code', d.prepack_code, 'sequence_no', d.sequence_no),
       'updated', d.source_hash, encode(extensions.digest('absent from current prepack detail response','sha256'),'hex'),
       (to_jsonb(d) - array['run_id','fetched_at','first_seen_at','last_seen_at']::text[]),
       jsonb_build_object('_state','absent from current prepack detail response'), ${sqlUuid(run.id)}
  from coldlion.${PREPACK_DETAIL_TABLE} d join _fetched_prepacks f
    on d.company_code = f.company_code and d.prepack_code = f.prepack_code
 where not exists (select 1 from _stage_prepack s where s.company_code = d.company_code and s.prepack_code = d.prepack_code and s.sequence_no = d.sequence_no);

delete from coldlion.${PREPACK_DETAIL_TABLE} d
 using _fetched_prepacks f
 where d.company_code = f.company_code and d.prepack_code = f.prepack_code
   and not exists (select 1 from _stage_prepack s where s.company_code = d.company_code and s.prepack_code = d.prepack_code and s.sequence_no = d.sequence_no);

insert into coldlion.${PREPACK_DETAIL_TABLE} (${all.join(", ")})
select ${PREPACK_DETAIL_SPEC.fields.map((x) => `s.${x.column}`).join(", ")}, s.run_id, s.fetched_at, s.source_hash, s.fetched_at, s.fetched_at
  from _stage_prepack s
on conflict (company_code, prepack_code, sequence_no) do update set
      ${updates};

${run.zeroRowCount ? `select pg_notify('coldlion_sync_alert', ${sqlText(`/prepackDetail run landed with ${run.zeroRowCount} zero-row code(s); they are named in sync_run request_params and stay visible, never silent`)});` : "-- no zero-row codes this run; nothing to alert"}
${runFinishSql(run, notes)}
commit;`;
}

/**
 * Read-only reconciliation report inputs. Everything the issue's done-when asks
 * for: per-run API totals, landed counts, zero-row keys, coverage backlog. No
 * exclusions exist for this feed (unit 5b decision), so none are computed.
 */
export function buildReconcileSql(companyCode) {
  return `select 'runs_succeeded' as metric, count(*)::text from coldlion.sync_run where endpoint = '/prepackDetail' and status = 'succeeded' and company_code = ${sqlText(companyCode)}
union all select 'runs_failed', count(*)::text from coldlion.sync_run where endpoint = '/prepackDetail' and status = 'failed' and company_code = ${sqlText(companyCode)}
union all select 'api_rows_fetched_total', coalesce(sum(rows_fetched), 0)::text from coldlion.sync_run where endpoint = '/prepackDetail' and status = 'succeeded' and company_code = ${sqlText(companyCode)}
union all select 'landed_rows', count(*)::text from coldlion.${PREPACK_DETAIL_TABLE}
union all select 'landed_distinct_prepack_codes', count(distinct prepack_code)::text from coldlion.${PREPACK_DETAIL_TABLE}
union all select 'landed_rows_last_success_run', count(*)::text from coldlion.${PREPACK_DETAIL_TABLE} d
 where run_id = (select id from coldlion.sync_run where endpoint = '/prepackDetail' and status = 'succeeded' and company_code = ${sqlText(companyCode)} order by finished_at desc limit 1);`;
}
