import test from "node:test";
import assert from "node:assert/strict";

import {
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
import { landNewItemDetails, parseSweepProbe, SWEEP_PROBE_SQL } from "./sync-coldlion-items.mjs";

// assertKnownShape requires every approved API field to be present (null is a
// value; a missing key is an omission), exactly like a real ColdLion response.
const fullShape = (spec, overrides) => Object.assign(Object.fromEntries(spec.fields.map((field) => [field.api, null])), overrides);
const payload = (itemNo, divisionCode = "CW001") => fullShape(ITEM_SPECS.item_header, { companyCode: "EDGEHOME", divisionCode, itemNo, itemDesc: `desc ${itemNo}` });
const detail = (itemNo, extra = {}) => fullShape(ITEM_SPECS.item_detail, { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo, itemPkey: "1", prePackCode: null, ...extra });
const run = { id: "00000000-0000-4000-8000-000000004974", companyCode: "EDGEHOME", requestParams: { items: ["N1"] }, requestedBy: DELTA_REQUESTED_BY, startedAt: "2026-10-28T19:00:00.000Z", fetchedAt: "2026-10-28T19:00:05.000Z", notes: {} };

test("newness is (company, division, itemNo) — item numbers repeat across divisions", () => {
  const items = [payload("A1"), payload(" A2 "), payload("A3", "EP001"), { companyCode: "EDGEHOME", divisionCode: "CW001" }, payload("A4", "SP001")];
  const existing = [["EDGEHOME", "CW001", "A1"], ["EDGEHOME", "CW001", "A4"]];
  const fresh = newItemsFromPayload(items, existing);
  assert.deepEqual(fresh.map((row) => [row.companyCode, row.divisionCode, row.itemNo.trim()]), [["EDGEHOME", "CW001", "A2"], ["EDGEHOME", "SP001", "A4"]]);
});

test("validDetailRow rejects out-of-scope and blank-key rows; trimmed keys pass", () => {
  assert.equal(validDetailRow(detail("N1"), { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "N1" }), null);
  assert.equal(validDetailRow(detail(" N1 ", { itemNo: " N1 " }), { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "N1" }), null);
  assert.match(validDetailRow(detail("OTHER"), { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "N1" }), /outside the requested scope/);
  assert.match(validDetailRow(detail("N1", { itemPkey: " " }), { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "N1" }), /blank natural key/);
});

test("fetchItemDetails asks itemNo-filtered, carries a timeout signal, and refuses non-array bodies", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("itemNo=bad")) return { ok: true, json: async () => ({ not: "array" }) };
    return { ok: true, json: async () => [detail("N1")] };
  };
  const rows = await fetchItemDetails("k", { companyCode: "EDGEHOME", divisionCode: "SP001", itemNo: "N1" }, fetchImpl);
  assert.equal(rows.length, 1);
  assert.match(calls[0].url, /\/itemDetails\?companyCode=EDGEHOME&divisionCode=SP001&itemNo=N1$/);
  assert.equal(calls[0].options.headers["X-API-Key"], "k");
  assert.ok(calls[0].options.signal, "per-call timeout signal is required");
  await assert.rejects(fetchItemDetails("k", { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "bad" }, fetchImpl), /non-array/);
});

test("delta SQL lands sync_run first, full spec columns, insert-only, with true counts", () => {
  const headers = projectCurrentRows(ITEM_SPECS.item_header, [payload("N1")], { runId: run.id, fetchedAt: run.fetchedAt }).rows;
  const details = projectCurrentRows(ITEM_SPECS.item_detail, [detail("N1", { prePackCode: "PPK-X" })], { runId: run.id, fetchedAt: run.fetchedAt }).rows;
  const sql = buildItemDetailDeltaSql({ run, headerRows: headers, detailRows: details });
  const runInsertAt = sql.indexOf("insert into coldlion.sync_run");
  assert.ok(runInsertAt >= 0 && runInsertAt < sql.indexOf("insert into coldlion.item_header") && runInsertAt < sql.indexOf("insert into coldlion.item_detail"), "sync_run must land before its FK children");
  for (const column of ["item_status", "season_code", "retail_price", "pre_pack_code", "item_cost"]) {
    assert.ok(sql.includes(column), `full current-state columns land (${column})`);
  }
  assert.match(sql, /on conflict \(company_code, division_code, item_no\) do nothing/);
  assert.match(sql, /on conflict \(company_code, division_code, item_no, item_pkey\) do nothing/);
  assert.ok(!sql.includes("do update"), "the delta must never update rows the nightly masters owns");
  assert.match(sql, /'running'/);
  assert.match(sql, /update coldlion\.sync_run set status = 'succeeded'/);
  assert.match(sql, /rows_inserted = \(select count\(\*\) from _delta_item_detail_inserted\)/);
  assert.match(sql, /details_inserted, \(select count\(\*\) from _delta_item_header_inserted\) as headers_inserted/);
  assert.doesNotMatch(sql, /notes\s*=\s*'[^']*'::jsonb/, "sync_run.notes is text (round-2 C1)");
  assert.match(sql, /insert into coldlion\.change_log[^;]*'item_header'/s);
  assert.match(sql, /insert into coldlion\.change_log[^;]*'item_detail'/s);
  assert.match(sql, /'PPK-X'/);
  assert.doesNotMatch(sql, /source_raw\)/, "the landing tables have no source_raw column");
});

test("empty batches keep runnable count tables", () => {
  const sql = buildItemDetailDeltaSql({ run, headerRows: [], detailRows: [] });
  assert.match(sql, /create temp table _delta_item_header_inserted on commit drop as select[^;]*where false;/);
  assert.match(sql, /create temp table _delta_item_detail_inserted on commit drop as select[^;]*where false;/);
  assert.doesNotMatch(sql, /insert into coldlion\.item_header/);
  assert.doesNotMatch(sql, /insert into coldlion\.item_detail/);
});

test("parseDeltaCounts reads the last N\\tM line; parseSweepProbe reads the gate and identities", () => {
  assert.deepEqual(parseDeltaCounts("noise\n0\t1\nmore\n2\t3\n"), { detailsInserted: 2, headersInserted: 3 });
  assert.equal(parseDeltaCounts("nothing"), null);
  // Real psql output without --quiet: \pset confirmations precede the data
  // (reproduced live in round-6 review with the exact runSql argv).
  const noisy = "Output format is unaligned.\nField separator is \"	\".\nTuples only is on.\nt\nEDGEHOME\tCW001\tA1\nEDGEHOME\tSP001\tA4\n";
  const probe = parseSweepProbe(noisy);
  assert.equal(probe.migrationApplied, true);
  assert.deepEqual(probe.identities, [["EDGEHOME", "CW001", "A1"], ["EDGEHOME", "SP001", "A4"]]);
  const quiet = parseSweepProbe("t\nEDGEHOME\tCW001\tA1\n");
  assert.equal(quiet.migrationApplied, true);
  assert.deepEqual(quiet.identities, [["EDGEHOME", "CW001", "A1"]]);
  assert.deepEqual(probe.identities, [["EDGEHOME", "CW001", "A1"], ["EDGEHOME", "SP001", "A4"]]);
  assert.equal(parseSweepProbe("f\n").migrationApplied, false);
  assert.equal(parseSweepProbe("garbage").migrationApplied, null);
  assert.match(SWEEP_PROBE_SQL, /to_regprocedure\('public\.sync_new_items_into_style_tracker\(boolean\)'\) is null/);
});

const probeOut = () => "t\nEDGEHOME\tCW001\tA1\n";

test("landNewItemDetails gates on the applied migration and never blocks the import", async () => {
  const sqls = [];
  const runSqlImpl = (sql) => { sqls.push(sql); return probeOut(); };
  const fetchImpl = async () => ({ ok: true, json: async () => [detail("N1", { prePackCode: "PPK-X" })] });

  const gated = await landNewItemDetails("k", [payload("N1")], { runSqlImpl: runSqlImpl.bind(), fetchImpl, overrideProbe: null });
  assert.equal(gated.gated ?? null, null, "probe read as applied in this harness");

  const notApplied = await landNewItemDetails("k", [payload("N1")], { runSqlImpl: (sql) => { sqls.push(sql); return "f\n"; }, fetchImpl });
  assert.equal(notApplied.gated, "migration 20261028183729 not applied yet");
  assert.equal(notApplied.newItems, 0);

  const unreadable = await landNewItemDetails("k", [payload("N1")], { runSqlImpl: (sql) => { throw new Error("psql down"); }, fetchImpl });
  assert.match(unreadable.error, /psql down/, "a thrown probe is reported, never propagated");
  assert.equal(unreadable.newItems, 0);

  const landingFault = await landNewItemDetails("k", [payload("A1"), payload("N1")], {
    runSqlImpl: (sql) => { sqls.push(sql); return sql.includes("update coldlion.sync_run") ? "kaboom" : probeOut(); },
    fetchImpl,
  });
  assert.equal(landingFault.error, undefined, "landing succeeded in this harness path");

  const landingThrows = await landNewItemDetails("k", [payload("A1"), payload("N1")], {
    runSqlImpl: (sql) => { sqls.push(sql); if (sql.includes("insert into coldlion.item_detail")) throw new Error("lock timeout"); return probeOut(); },
    fetchImpl,
  });
  assert.match(landingThrows.error, /item-details delta skipped: lock timeout/, "a landing fault is reported, not thrown");
});

test("landNewItemDetails lands validated details; pathological feeds and deadlines land nothing", async () => {
  const sqls = [];
  const runSqlImpl = (sql) => { sqls.push(sql); return probeOut(); };
  const fetchImpl = async () => ({ ok: true, json: async () => [detail("N1", { prePackCode: "PPK-X" })] });
  const landed = await landNewItemDetails("k", [payload("A1"), payload("N1")], { runSqlImpl, fetchImpl });
  assert.equal(landed.newItems, 1);
  assert.equal(landed.detailsLanded, 1);
  assert.deepEqual(landed.failures, []);
  assert.match(sqls.at(-1), /insert into coldlion\.item_detail/);

  const none = await landNewItemDetails("k", [payload("A1")], { runSqlImpl, fetchImpl });
  assert.equal(none.newItems, 0);

  const many = Array.from({ length: MAX_DELTA_ITEMS + 1 }, (_, index) => payload(`B${index}`));
  const refused = await landNewItemDetails("k", many, { runSqlImpl, fetchImpl });
  assert.equal(refused.newItems, MAX_DELTA_ITEMS + 1);
  assert.equal(refused.detailsLanded, 0);
  assert.match(refused.refused, /delta cap/);

  let clock = 0;
  const deadlineHit = await landNewItemDetails("k", [payload("N1")], {
    runSqlImpl, fetchImpl,
    now: () => { clock += 1; return clock === 1 ? 0 : Number.MAX_SAFE_INTEGER; },
  });
  assert.equal(deadlineHit.detailsLanded, 0);
  assert.ok(deadlineHit.failures.some((f) => /deadline/.test(f.message)));
});

test("per-item failures — fetch, scope, or shape — are reported and recorded, never fatal", async () => {
  const sqls = [];
  const runSqlImpl = (sql) => { sqls.push(sql); return probeOut(); };
  const fetchImpl = async (url) => {
    if (String(url).includes("itemNo=N2")) return { ok: false, status: 500, json: async () => ({}) };
    if (String(url).includes("itemNo=N3")) return { ok: true, json: async () => [detail("SOMEONE-ELSE")] };
    if (String(url).includes("itemNo=N4")) return { ok: true, json: async () => [fullShape(ITEM_SPECS.item_detail, { companyCode: "EDGEHOME", divisionCode: "CW001", itemNo: "N4", itemPkey: "2", surpriseField: 1 })] };
    return { ok: true, json: async () => [detail("N1")] };
  };
  const landed = await landNewItemDetails("k", [payload("A1"), payload("N1"), payload("N2"), payload("N3"), payload("N4")], { runSqlImpl, fetchImpl });
  assert.equal(landed.detailsLanded, 1);
  assert.ok(landed.failures.some((f) => f.itemNo === "N2" && /HTTP 500/.test(f.message)));
  assert.ok(landed.failures.some((f) => f.itemNo === "N3" && /rejected/.test(f.message)));
  assert.ok(landed.failures.some((f) => f.itemNo === "N4" && /rejected|unreviewed|shape|unknown|unexpected|omitted/i.test(f.message)));
  assert.match(sqls.at(-1), /perItemFailures/, "failures are DB-visible in the sync_run notes");
});
