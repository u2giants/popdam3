// ColdLion GET /proddetails — one keyed request per production order, landing into
// coldlion.prod_detail (issue #3180, table from #2863).
//
// Shape and grain were proven live on 2026-09-15
// (docs/coldlion-unit-5b-grain-proof-20260915.md) and re-derived live on 2026-09-17
// before this loader landed: a BARE ARRAY of at most 21 fields, `pkey` a real vendor row
// id unique on its own, `(prodOrderNo, prodLineSeq)` independently unique, and
// `companyCode` required by the request yet absent from the payload — stamped here.
//
// The feed is enumerated, never paged: request keys are harvested from the
// already-landed production history (`coldlion.prod_history_line`), which is the
// complete approved `prodOrderNo` population for this company.

import { randomUUID } from "node:crypto";
import { sqlNumber, sqlText, sqlTimestamp, sqlUuid, bigint, num, sourceHash, text } from "./values.mjs";
import { assertKnownShape } from "./project-masters.mjs";

const f = (api, column, type = "text") => ({ api, column, type });

// The 21 payload fields of the 2026-09-15/17 samples, exactly. The unknown-field
// refusal is keyed to this list: a new vendor field fails the load before any write,
// the way every other ColdLion landing feed in this repository behaves.
export const PROD_DETAIL_SPEC = Object.freeze({
  endpoint: "/proddetails",
  table: "prod_detail",
  key: ["company_code", "pkey"],
  // The SECOND proven identity. Not an upsert target: a pull that breaks it must fail
  // on the table's unique constraint, not silently collapse two lines into one.
  uniqueIdentity: ["company_code", "prod_order_no", "prod_line_seq"],
  requestKey: "prodOrderNo",
  fields: [
    f("pkey", "pkey", "int"),
    f("prodOrderNo", "prod_order_no", "int"),
    f("prodLineSeq", "prod_line_seq", "int"),
    f("divisionCode", "division_code"),
    f("itemPkey", "item_pkey", "int"),
    f("itemNo", "item_no"),
    f("itemDesc", "item_desc"),
    f("colorCode", "color_code"),
    f("sizeCode", "size_code"),
    f("dimCode", "dim_code"),
    f("labelCode", "label_code"),
    f("prepackCode", "prepack_code"),
    f("prodQty", "prod_qty", "num"),
    f("wipQty", "wip_qty", "num"),
    f("prodCost", "prod_cost", "num"),
    f("custPONumber", "cust_po_number"),
    f("merchGroup05Desc", "merch_group_05_desc"),
    f("createdTime", "created_time", "ts"),
    f("createdUser", "created_user"),
    f("modTime", "mod_time", "ts"),
    f("modUser", "mod_user"),
  ],
});

function timestamp(value) {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error("a timestamp field was not an ISO timestamp");
  // 1900-01-01 is ColdLion's empty-date marker (spine rule); never landed as a fact.
  if (parsed.toISOString() <= "1900-01-01T23:59:59.999Z") return null;
  return parsed.toISOString();
}

const int = (value) => (value === null || value === undefined ? null : bigint(value));
const converters = { text, num, ts: timestamp, int };

function fatal(error) {
  error.fatal = true;
  error.endpoint ??= PROD_DETAIL_SPEC.endpoint;
  return error;
}

/**
 * A PER-KEY refusal: this one order's data cannot land, but the feed itself is healthy.
 *
 * The distinction the live backfill bought on 2026-09-17: order 20344 returned two rows
 * with distinct pkeys sharing one prodLineSeq — the vendor falsified the second proven
 * identity that #2863 asserted as a table constraint. That is a fact about ONE key
 * (until re-proven otherwise), not a change in the feed's shape, so it must not abort a
 * run that still has thousands of healthy keys to fetch. The key is refused: recorded as
 * a failed sync_run carrying a refused marker, never re-selected while the structural
 * question is open, and counted in every run's reconciliation.
 *
 * Feed-SHAPE failures (unknown or omitted fields) stay FATAL: they would repeat for
 * every key, and fetching the rest of the population against a changed feed proves
 * nothing but noise.
 */
export const REFUSAL_REASON = "identity-collision";

function refusal(error, reason = REFUSAL_REASON) {
  error.refused = reason;
  error.endpoint ??= PROD_DETAIL_SPEC.endpoint;
  return error;
}

/**
 * Every row must belong to the order that was asked for. /prodHistory taught this
 * repository that a ColdLion scope can silently drift (the stage agreement); the same
 * assertion belongs on any keyed request.
 */
export function assertRequestedOrder(rows, prodOrderNo) {
  for (const row of rows) {
    if (num(row.prodOrderNo) !== prodOrderNo) {
      throw refusal(new Error(
        `/proddetails returned a row for production order ${row.prodOrderNo ?? "(blank)"} under a request for ${prodOrderNo}`,
      ));
    }
  }
}

/**
 * Project one /proddetails response into landing rows.
 *
 * Unknown or omitted FIELDS are fatal for the whole run — the feed's shape changed and
 * every later key would fail the same way. Everything else is a PER-KEY refusal: a row
 * for another order, a blank identity field, or EITHER identity appearing twice in one
 * response. The second case is not hypothetical: on 2026-09-17 the live feed returned
 * two distinct-pkey rows for one (prodOrderNo, prodLineSeq), the exact collision the
 * #2863 unique constraint exists to make visible.
 */
export function projectProdDetailRows(sourceRows, { runId, fetchedAt, companyCode, prodOrderNo }) {
  try {
    assertKnownShape(PROD_DETAIL_SPEC, sourceRows);
  } catch (error) {
    throw fatal(error);
  }
  assertRequestedOrder(sourceRows, prodOrderNo);

  const byPkey = new Map();
  const byLine = new Map();
  const rows = [];
  for (const source of sourceRows) {
    const row = { company_code: companyCode };
    try {
      for (const field of PROD_DETAIL_SPEC.fields) row[field.column] = converters[field.type](source[field.api]);
    } catch (error) {
      // A malformed VALUE (a non-ISO timestamp, a non-finite number) is one key's
      // data, not a feed-shape change: the 21 fields arrived, one value is bad.
      // Classified as transport it would be retried forever; it is a refusal.
      throw refusal(new Error(`/proddetails returned a malformed value for production order ${prodOrderNo}: ${error.message}`));
    }
    row.source_hash = sourceHash(source);
    row.source_raw = source;
    row.run_id = runId;
    row.fetched_at = fetchedAt;

    if (row.pkey === null || row.prod_order_no === null || row.prod_line_seq === null) {
      throw refusal(new Error("/proddetails returned a row with a blank identity field (pkey, prodOrderNo or prodLineSeq)"));
    }
    const lineKey = `${row.company_code}\u001f${row.prod_order_no}\u001f${row.prod_line_seq}`;
    if (byPkey.has(String(row.pkey))) {
      throw refusal(new Error("/proddetails returned duplicate rows for one pkey"));
    }
    if (byLine.has(lineKey)) {
      throw refusal(new Error(`/proddetails returned duplicate rows for one prodOrderNo + prodLineSeq (prodLineSeq ${row.prod_line_seq}); both the table's unique constraint and this loader refuse to collapse them`));
    }
    byPkey.set(String(row.pkey), row);
    byLine.set(lineKey, row);
    rows.push(row);
  }
  return { rows, zeroRow: rows.length === 0 };
}

// -------------------------------------------------------------------------------------
// One transaction per production order: the sync_run record, the change trail, and the
// upsert. A key is either fully loaded or not loaded at all, so an interrupted backfill
// resumes at the first key with no succeeded run — no partial state to reconcile.
// -------------------------------------------------------------------------------------

const PG = { text: "text", num: "numeric", ts: "timestamptz", int: "bigint" };
const emitters = { text: sqlText, num: sqlNumber, ts: sqlTimestamp, int: sqlNumber };
const BATCH = 300;

function stageSql(rows) {
  const columns = [
    ["company_code", "text"],
    ...PROD_DETAIL_SPEC.fields.map((x) => [x.column, PG[x.type]]),
    ["source_hash", "text"],
    ["source_raw", "jsonb"],
    ["run_id", "uuid"],
    ["fetched_at", "timestamptz"],
  ];
  const create = `create temp table _stage_prod_detail (\n  ${columns.map(([c, t]) => `${c} ${t}`).join(",\n  ")}\n) on commit drop;`;
  const statements = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    statements.push(`insert into _stage_prod_detail (${columns.map(([c]) => c).join(", ")}) values\n${batch.map((row) => `  (${[
      sqlText(row.company_code),
      ...PROD_DETAIL_SPEC.fields.map((field) => emitters[field.type](row[field.column])),
      sqlText(row.source_hash),
      `${sqlText(JSON.stringify(row.source_raw))}::jsonb`,
      sqlUuid(row.run_id),
      sqlTimestamp(row.fetched_at),
    ].join(", ")})`).join(",\n")};`);
  }
  return [create, ...statements].join("\n");
}

/**
 * The load for one production order. Modeled on load-masters.mjs: stage, count against
 * the live table, write the change trail, upsert, and finish the run record — all in
 * the caller's single transaction.
 *
 * The upsert targets ONLY (company_code, pkey). The second proven identity is enforced
 * by the table's unique constraint: if the vendor ever re-keys a line, this statement
 * raises instead of merging two lines into one.
 */
export function buildProdDetailLoadSql({ run, rows }) {
  const keys = PROD_DETAIL_SPEC.key;
  // company_code is REQUEST-STAMPED, not a payload field, so it joins the column
  // list here: the insert must name it or Postgres supplies NULL into the leading
  // primary-key column (caught live by the 3-key production probe on 2026-09-17).
  const data = ["company_code", ...PROD_DETAIL_SPEC.fields.map((x) => x.column)];
  const all = [...data, "run_id", "fetched_at", "source_hash", "first_seen_at", "last_seen_at"];
  const join = "t.company_code = s.company_code and t.pkey = s.pkey";
  const naturalKey = `jsonb_build_object('company_code', s.company_code, 'pkey', s.pkey)`;
  const previous = `(to_jsonb(t) - array['run_id','fetched_at','first_seen_at','last_seen_at']::text[])`;
  const priorRaw = `coalesce((select cl.new_raw from coldlion.change_log cl where cl.table_name='prod_detail' and cl.natural_key=${naturalKey} order by cl.changed_at desc limit 1), ${previous})`;
  const updates = [
    ...data.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`),
    "run_id = excluded.run_id",
    "fetched_at = excluded.fetched_at",
    "source_hash = excluded.source_hash",
    // first_seen_at is deliberately NOT updated: it is the row's first landing, forever.
    "last_seen_at = excluded.last_seen_at",
  ].join(",\n      ");
  const notes = `key=${run.requestParams.prodOrderNo} rowsFetched=${run.rowsFetched} zeroRow=${run.zeroRow ? 1 : 0}`;

  return `begin;
${stageSql(rows)}
create temp table _counts_prod_detail on commit drop as
select count(*) filter (where t.company_code is null) as inserted,
       count(*) filter (where t.company_code is not null and t.source_hash <> s.source_hash) as updated,
       count(*) filter (where t.company_code is not null and t.source_hash = s.source_hash) as unchanged
  from _stage_prod_detail s left join coldlion.prod_detail t on ${join};

insert into coldlion.sync_run
  (id, endpoint, company_code, request_params, status, requested_by, started_at, http_status, body_status, rows_fetched)
values
  (${sqlUuid(run.id)}, '/proddetails', ${sqlText(run.companyCode)},
   ${sqlText(JSON.stringify(run.requestParams))}::jsonb, 'running', ${sqlText(run.requestedBy)},
   ${sqlTimestamp(run.startedAt)}, ${sqlNumber(run.httpStatus)}, ${sqlNumber(run.bodyStatus)}, ${sqlNumber(run.rowsFetched)});

insert into coldlion.change_log
  (table_name, natural_key, change_kind, previous_source_hash, new_source_hash, previous_raw, new_raw, run_id)
select 'prod_detail', ${naturalKey}, case when t.company_code is null then 'inserted' else 'updated' end,
       t.source_hash, s.source_hash, case when t.company_code is null then null else ${priorRaw} end, s.source_raw, s.run_id
  from _stage_prod_detail s left join coldlion.prod_detail t on ${join}
 where t.company_code is null or t.source_hash <> s.source_hash;

insert into coldlion.prod_detail (${all.join(", ")})
select ${data.map((c) => `s.${c}`).join(", ")}, s.run_id, s.fetched_at, s.source_hash, s.fetched_at, s.fetched_at
  from _stage_prod_detail s
on conflict (company_code, pkey) do update set
      ${updates};

update coldlion.sync_run set status='succeeded', finished_at=${sqlTimestamp(run.finishedAt)},
  duration_ms=${sqlNumber(run.durationMs)}, notes=${sqlText(notes)},
  rows_inserted=(select inserted from _counts_prod_detail),
  rows_updated=(select updated from _counts_prod_detail),
  rows_unchanged=(select unchanged from _counts_prod_detail)
 where id=${sqlUuid(run.id)};
commit;`;
}

/** A completed per-key run record, ready for buildProdDetailLoadSql. */
export function makeProdDetailRun({ id, companyCode, prodOrderNo, requestedBy, startedAt, finishedAt, httpStatus, bodyStatus, rowsFetched, zeroRow }) {
  return {
    id: id ?? randomUUID(),
    endpoint: PROD_DETAIL_SPEC.endpoint,
    companyCode,
    requestParams: { companyCode, prodOrderNo, fullSnapshot: true },
    requestedBy, startedAt, finishedAt,
    durationMs: Math.max(0, new Date(finishedAt) - new Date(startedAt)),
    httpStatus, bodyStatus, rowsFetched, zeroRow: zeroRow ?? rowsFetched === 0,
  };
}

// -------------------------------------------------------------------------------------
// The reads: the approved key population, the resume set, and the reconciliation.
// -------------------------------------------------------------------------------------

/**
 * The complete approved prodOrderNo population: distinct order numbers already landed
 * in production history for this company, with their first and last observation. The
 * landing layer keeps whatever divisions history landed (cw001 casing included); there
 * is no EP001 filter here because history already excluded it before landing.
 */
export function harvestSql(companyCode) {
  return `select prod_order_no::text,
       to_char(min(source_observed_at), 'YYYY-MM-DD"T"HH24:MI:SS'),
       to_char(max(source_observed_at), 'YYYY-MM-DD"T"HH24:MI:SS')
  from coldlion.prod_history_line
 where company_code = ${sqlText(companyCode)}
 group by prod_order_no`;
}

/**
 * Keys a run must not fetch again, WITH their answer state: SUCCEEDED, plus keys
 * REFUSED for an identity collision. Zero-row keys count as done (they were asked and
 * answered); refused keys count as answered too — re-fetching them cannot change the
 * answer until the falsified-unique-constraint ruling lands, and a nightly schedule
 * that re-fails the same key forever is alert fatigue, not safety. Transport failures
 * are NOT here: those keys stay outstanding and are retried by the next run.
 *
 * The state is kept SEPARATE (never folded into one flat set) because refresh mode
 * re-reads recently-observed answered keys — and a refused key must not re-enter that
 * list even when it is recent (live order 20344 always is). Found by the governed
 * review of PR #3233 round 1 as H1.
 */
export function doneKeysSql(companyCode) {
  return `select (request_params->>'prodOrderNo'),
       case when status = 'failed' then 'refused' else 'succeeded' end
  from coldlion.sync_run
 where endpoint = '/proddetails'
   and company_code = ${sqlText(companyCode)}
   and request_params ? 'prodOrderNo'
   and (
     status = 'succeeded'
     or (status = 'failed' and request_params->>'refused' = ${sqlText(REFUSAL_REASON)})
   )`;
}

/** Parse [key, firstObserved, lastObserved] rows (CR-safe: psql on Windows emits \\r\\n). */
export function parseHarvest(rows) {
  const harvested = [];
  for (const [rawKey, first, last] of rows) {
    const key = bigint(rawKey.trim());
    if (key === null) throw new Error("the production-order harvest returned a blank key");
    harvested.push({ prodOrderNo: key, firstObserved: first.trim(), lastObserved: last.trim() });
  }
  return harvested;
}

export function parseDoneKeys(rows) {
  const done = new Set();
  const refused = new Set();
  for (const [rawKey, state] of rows) {
    const key = bigint(rawKey.trim());
    if (key === null) continue;
    done.add(key);
    if (String(state ?? "").trim() === "refused") refused.add(key);
  }
  return { done, refused };
}

/**
 * Select the keys a run will fetch.
 *
 * backfill: never-fetched keys, oldest first — a multi-run catch-up walks the population
 * in one deterministic order and re-dispatching continues where the evidence stops.
 * refresh: never-fetched keys first, then recently-observed keys re-read newest first —
 * the same trailing-window philosophy as the history sync (an order edited after it was
 * written is re-read), bounded by the limit. REFUSED keys never re-enter either list:
 * they are answered, and re-asking cannot change the answer (PR #3233 review H1).
 */
export function selectKeys({ harvested, done, refused, mode, from, recentDays, limit }) {
  const answered = done;
  const neverFetched = harvested.filter((entry) => !answered.has(entry.prodOrderNo));
  // Oldest first in every mode, so a bounded run walks the population in one
  // deterministic order and two runs never disagree about what comes next.
  neverFetched.sort((a, b) => a.firstObserved.localeCompare(b.firstObserved) || (a.prodOrderNo - b.prodOrderNo));
  const outstanding = from
    ? neverFetched.filter((entry) => entry.firstObserved.slice(0, 10) >= from)
    : neverFetched;
  if (mode === "backfill") {
    return limit === null ? outstanding : outstanding.slice(0, limit);
  }
  const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = harvested
    .filter((entry) => answered.has(entry.prodOrderNo) && !refused.has(entry.prodOrderNo) && entry.lastObserved.slice(0, 10) >= cutoff)
    .sort((a, b) => b.lastObserved.localeCompare(a.lastObserved) || (a.prodOrderNo - b.prodOrderNo));
  const selection = [...outstanding, ...recent];
  return limit === null ? selection : selection.slice(0, limit);
}

/** The reconciliation read: API-side evidence (succeeded runs) against the landed table, refusals counted. */
export function reconcileSql(companyCode) {
  return `with done as (
  select (request_params->>'prodOrderNo')::bigint as prod_order_no, rows_fetched
    from coldlion.sync_run
   where endpoint = '/proddetails' and company_code = ${sqlText(companyCode)}
     and status = 'succeeded' and request_params ? 'prodOrderNo'
), landed as (
  select prod_order_no, count(*) as n from coldlion.prod_detail
   where company_code = ${sqlText(companyCode)} group by 1
)
select (select count(*) from done),
       (select count(*) from done where rows_fetched = 0),
       (select coalesce(sum(rows_fetched), 0) from done),
       (select count(*) from landed),
       (select coalesce(sum(n), 0) from landed),
       (select count(*) from coldlion.prod_detail where company_code = ${sqlText(companyCode)}),
       (select count(distinct pkey) from coldlion.prod_detail where company_code = ${sqlText(companyCode)}),
       (select count(distinct (request_params->>'prodOrderNo')::bigint) from coldlion.sync_run
         where endpoint = '/proddetails' and company_code = ${sqlText(companyCode)}
           and status = 'failed' and request_params->>'refused' = ${sqlText(REFUSAL_REASON)})`;
}

/**
 * Record one refused key durably, in its own transaction: a FAILED sync_run whose
 * request_params carry the same flat prodOrderNo as a succeeded run plus the refusal
 * marker, so doneKeysSql and the reconciliation can find it without any other table.
 */
export function prodDetailRefusalSql({ companyCode, prodOrderNo, requestedBy, error }) {
  const message = String(error?.message ?? error).slice(0, 4000);
  return `begin;
insert into coldlion.sync_run
  (endpoint, company_code, request_params, status, requested_by, started_at, finished_at,
   http_status, body_status, error_message)
values
  ('/proddetails', ${sqlText(companyCode)},
   ${sqlText(JSON.stringify({ companyCode, prodOrderNo, fullSnapshot: true, refused: REFUSAL_REASON }))}::jsonb,
   'failed', ${sqlText(requestedBy)}, now(), now(),
   ${error?.httpStatus ?? "null"}, ${error?.bodyStatus ?? "null"}, ${sqlText(message)});
select pg_notify('coldlion_sync_alert', ${sqlText(`/proddetails refused production order ${prodOrderNo} (${REFUSAL_REASON}): ${message}`.slice(0, 7000))});
commit;`;
}

export function parseReconciliation(row) {
  const [keysDone, zeroRowKeys, rowsFetchedTotal, keysLanded, rowsLandedTotal, tableRows, distinctPkey, refusedKeys] = row.map(Number);
  return {
    keysDone, zeroRowKeys, rowsFetchedTotal, keysLanded, rowsLandedTotal, tableRows, distinctPkey, refusedKeys,
    // This feed lands everything it fetches: no EP001 exclusion, no withheld rows (unit
    // 5b ruling). Refused keys are the one named exception — orders whose response
    // breaks a proven identity, durably recorded and awaiting a structural ruling —
    // and they are counted here rather than hidden inside a mismatch.
    exclusions: refusedKeys,
    agrees: keysLanded === keysDone - zeroRowKeys
      && rowsLandedTotal === rowsFetchedTotal
      && tableRows === rowsLandedTotal
      && distinctPkey === tableRows,
  };
}
