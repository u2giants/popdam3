// Offline contract tests for the ColdLion /prepackDetail landing loader (issue #3179).
//
// No secrets, no database, no network: every fetch is a stubbed fetchImpl and
// every database answer is a stubbed query/runSql. The fixtures are synthetic —
// this repository is public and no real ColdLion value may appear in it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fetchArrayMaster } from "./coldlion-landing/lib/master-http.mjs";
import { knownApiFields } from "./coldlion-landing/lib/master-specs.mjs";
import {
  PREPACK_DETAIL_SPEC,
  PREPACK_HARVEST_SOURCES,
  assertRowsAnswerRequest,
  buildCoverageReadSql,
  buildHarvestExistenceSql,
  buildHarvestKeysSql,
  buildLandingTableExistenceSql,
  buildPrepackLoadSql,
  parseCoverageRow,
  projectPrepackRows,
  reduceHarvestRows,
} from "./coldlion-landing/lib/prepack-detail.mjs";
import { collectPrepackDetail, main, parseArgs, planRun, readPlan } from "./coldlion-landing/sync-prepack-detail.mjs";

const RUN = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-17T00:00:00.000Z";

function sourceRow(overrides = {}) {
  const row = {};
  for (const field of PREPACK_DETAIL_SPEC.fields) {
    row[field.api] =
      field.type === "num" ? 1.25 :
      field.type === "int" ? 2 :
      field.type === "ts" ? "2026-01-02T03:04:05Z" :
      `SYN-${field.api}`;
  }
  row.companyCode = "SYNCO";
  row.prePackCode = "PPK0001";
  row.sequence = 1;
  return { ...row, ...overrides };
}

// ---------------------------------------------------------------------------------
// Spec and projection
// ---------------------------------------------------------------------------------

test("the spec carries exactly the eighteen sampled fields and the proven grain", () => {
  assert.equal(PREPACK_DETAIL_SPEC.fields.length, 18);
  assert.deepEqual(PREPACK_DETAIL_SPEC.key, ["company_code", "prepack_code", "sequence_no"]);
  assert.equal(PREPACK_DETAIL_SPEC.paged, false);
  const apis = PREPACK_DETAIL_SPEC.fields.map((field) => field.api);
  // The genuine duplicate-cased pair: both land, neither is folded.
  assert.ok(apis.includes("itemPrice") && apis.includes("ItemPrice"));
  const capitalized = PREPACK_DETAIL_SPEC.fields.find((field) => field.api === "ItemPrice");
  assert.equal(capitalized.column, "item_price_capitalized");
  assert.equal(PREPACK_DETAIL_SPEC.fields.find((field) => field.api === "sequence").column, "sequence_no");
});

test("projection lands every field, normalizes sentinels, and hashes the complete record", () => {
  const source = sourceRow({ dimCode: "", detailPrepack: "  ", createdTime: "1900-01-01T00:00:00Z" });
  const { rows } = projectPrepackRows([source], { runId: RUN, fetchedAt: NOW });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.company_code, "SYNCO");
  assert.equal(row.prepack_code, "PPK0001");
  assert.equal(row.sequence_no, 1);
  assert.equal(row.dim_code, null);           // ColdLion sends "" where others send null
  assert.equal(row.detail_prepack, null);
  assert.equal(row.created_time, null);       // the 1900 empty-date marker never lands
  assert.equal(row.item_price, 1.25);
  assert.equal(row.item_price_capitalized, 1.25);
  assert.match(row.source_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.run_id, RUN);
  assert.equal(row.fetched_at, NOW);
  const again = projectPrepackRows([{ ...source }], { runId: RUN, fetchedAt: NOW });
  assert.equal(again.rows[0].source_hash, row.source_hash); // replay of identical bytes is identical
});

test("unknown and omitted approved fields fail loudly before anything is staged", () => {
  assert.throws(() => projectPrepackRows([sourceRow({ newPrivateField: "x" })], { runId: RUN, fetchedAt: NOW }), /unreviewed field/);
  const missing = sourceRow();
  delete missing.labelCode;
  assert.throws(() => projectPrepackRows([missing], { runId: RUN, fetchedAt: NOW }), /omitted approved field/);
});

test("a duplicate natural key aborts instead of collapsing two source rows", () => {
  const a = sourceRow({ itemNo: "SYN-A" });
  const b = sourceRow({ itemNo: "SYN-B" });
  assert.throws(() => projectPrepackRows([a, b], { runId: RUN, fetchedAt: NOW }), /duplicate rows for one natural key/);
  // Same prepack, different sequence: two rows, correctly.
  const seq2 = sourceRow({ sequence: 2 });
  assert.equal(projectPrepackRows([a, seq2], { runId: RUN, fetchedAt: NOW }).rows.length, 2);
});

test("a blank natural key is refused, and a fractional quantity refuses rather than truncates", () => {
  assert.throws(() => projectPrepackRows([sourceRow({ prePackCode: "  " })], { runId: RUN, fetchedAt: NOW }), /blank natural key/);
  assert.throws(() => projectPrepackRows([sourceRow({ sequence: null })], { runId: RUN, fetchedAt: NOW }), /blank natural key/);
  assert.throws(() => projectPrepackRows([sourceRow({ quantity: 1.5 })], { runId: RUN, fetchedAt: NOW }), /safe integer/);
});

test("every row must answer the request that fetched it, and the refusal names both codes", () => {
  const params = { companyCode: "SYNCO", prepackCode: "PPK0001" };
  assert.doesNotThrow(() => assertRowsAnswerRequest([sourceRow()], params));
  assert.throws(() => assertRowsAnswerRequest([sourceRow({ companyCode: "OTHER" })], params), /another company: asked SYNCO, row answers OTHER/);
  assert.throws(() => assertRowsAnswerRequest([sourceRow({ prePackCode: "PPK9999" })], params), /another prepack code: asked PPK0001, row answers PPK9999/);
  // A blank answer is named as blank, never as the string "null".
  assert.throws(() => assertRowsAnswerRequest([sourceRow({ prePackCode: "  " })], params), /row answers \(blank\)/);
});

test("the prepack identity check folds vendor case drift, and the landed key keeps the row's spelling", () => {
  // The live 2026-09-18 collision (run 35288752430): the harvest asked PPk133
  // as /itemDetails had emitted it; /prepackDetail answered PPK133.
  const drifted = { companyCode: "SYNCO", prepackCode: "PPk133" };
  const row = sourceRow({ prePackCode: "PPK133" });
  assert.doesNotThrow(() => assertRowsAnswerRequest([row], drifted));
  // The landed identity is the row's own spelling, so a replay through either
  // harvest spelling upserts onto one row and identities cannot split.
  const projected = projectPrepackRows([row], { runId: RUN, fetchedAt: NOW });
  assert.equal(projected.rows[0].prepack_code, "PPK133");
  // Case folding is for the SAME code only; a different code still refuses.
  assert.throws(() => assertRowsAnswerRequest([sourceRow({ prePackCode: "PPK9999" })], drifted), /asked PPk133, row answers PPK9999/);
  // A blank requested key refuses every row: the guard never invents a match.
  assert.throws(() => assertRowsAnswerRequest([row], { companyCode: "SYNCO", prepackCode: "" }), /asked , row answers PPK133/);
  // The company comparison stays case-sensitive: no drift has been observed
  // there, and one must abort loudly with both spellings named.
  assert.throws(() => assertRowsAnswerRequest([sourceRow({ companyCode: "synco" })], { companyCode: "SYNCO", prepackCode: "PPK0001" }), /asked SYNCO, row answers synco/);
});

// ---------------------------------------------------------------------------------
// Harvest and coverage
// ---------------------------------------------------------------------------------

test("the harvest enumerates exactly the landed tables that carry a prepack code", () => {
  assert.deepEqual(PREPACK_HARVEST_SOURCES.map((entry) => `${entry.table}.${entry.column}`), [
    "coldlion.item_detail.pre_pack_code",
    "coldlion.prod_history_line.pre_pack_code",
    "coldlion.order_history_line.pre_pack_code",
    "coldlion.inventory.prepack_code",
    "coldlion.prod_detail.prepack_code",
  ]);
  const sql = buildHarvestKeysSql(PREPACK_HARVEST_SOURCES);
  for (const entry of PREPACK_HARVEST_SOURCES) assert.ok(sql.includes(`from ${entry.table}`));
  assert.ok(sql.includes("btrim(")); // blank codes never enter the population
  assert.ok(buildHarvestExistenceSql().includes("to_regclass('coldlion.item_detail')"));
  assert.ok(buildLandingTableExistenceSql().includes("to_regclass('coldlion.prepack_detail')"));
});

test("harvest rows reduce to distinct sorted codes with per-source counts", () => {
  const reduced = reduceHarvestRows([
    ["item_detail", "PPK0002"], ["item_detail", " PPK0001 "], ["item_detail", "PPK0002"],
    ["prod_history_line", "PPK0001"], ["prod_history_line", ""], ["order_history_line", "PPK0003"],
  ]);
  assert.deepEqual(reduced.keys, ["PPK0001", "PPK0002", "PPK0003"]);
  assert.deepEqual(reduced.perSource, { item_detail: 2, prod_history_line: 1, order_history_line: 1 });
});

test("readPlan refuses a target missing a required harvest source or the landing table", () => {
  const allPresent = PREPACK_HARVEST_SOURCES.map((entry) => [entry.source, "t"]);
  const noItemDetail = PREPACK_HARVEST_SOURCES.map((entry) => [entry.source, entry.source === "item_detail" ? "f" : "t"]);
  const withPresence = (presenceRows) => (sql) => (sql.includes("to_regclass('coldlion.prepack_detail')") ? [["t"]] : presenceRows);
  assert.throws(() => readPlan({ companyCode: "SYNCO", query: withPresence(noItemDetail) }), /harvest source\(s\) absent/);
  const noLandingTable = (sql) => (sql.includes("to_regclass('coldlion.prepack_detail')") ? [["f"]] : allPresent);
  assert.throws(() => readPlan({ companyCode: "SYNCO", query: noLandingTable }), /prepack_detail does not exist/);
});

test("coverage parses the cumulative covered set and refuses a malformed one", () => {
  const parsed = parseCoverageRow(["33333333-3333-4333-8333-333333333333", "2026-09-17 01:02:03+00", '["PPK0001","PPK0002"]']);
  assert.equal(parsed.coveredKeys.size, 2);
  assert.ok(parsed.coveredKeys.has("PPK0002"));
  assert.deepEqual([...parseCoverageRow(undefined).coveredKeys], []);
  assert.throws(() => parseCoverageRow(["id", "ts", "{not json"]), /unreadable/);
  assert.throws(() => parseCoverageRow(["id", "ts", '{"a":1}']), /malformed/);
});

// ---------------------------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------------------------

test("a bounded run covers only pending keys and unions the cumulative coverage", () => {
  const harvested = ["PPK0001", "PPK0002", "PPK0003", "PPK0004"];
  const plan = planRun({ harvestedKeys: harvested, coveredKeys: new Set(["PPK0001"]), limit: 2 });
  assert.equal(plan.mode, "bounded-backfill");
  assert.deepEqual(plan.keys, ["PPK0002", "PPK0003"]);
  assert.deepEqual(plan.cumulativeCovered, ["PPK0001", "PPK0002", "PPK0003"]);
});

test("a full refresh re-asks every harvested code and resets the covered set", () => {
  const harvested = ["PPK0001", "PPK0002"];
  const plan = planRun({ harvestedKeys: harvested, coveredKeys: new Set(["PPK0009"]), limit: null });
  assert.equal(plan.mode, "full-refresh");
  assert.deepEqual(plan.keys, harvested);
  assert.deepEqual(plan.cumulativeCovered, harvested);
});

// ---------------------------------------------------------------------------------
// Collection: empty responses, malformed responses, incomplete coverage
// ---------------------------------------------------------------------------------

function fetchImplFor(responses) {
  return async (url) => {
    const prepackCode = new URL(url).searchParams.get("prepackCode");
    const body = responses.get(prepackCode);
    if (body === undefined) return { ok: false, status: 404, text: async () => "not json" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

test("zero-row codes are recorded, not fatal, and every other key still lands", async () => {
  const responses = new Map([
    ["PPK0001", [sourceRow({ prePackCode: "PPK0001" })]],
    ["PPK0002", []],
    ["PPK0003", [sourceRow({ prePackCode: "PPK0003", sequence: 1 }), sourceRow({ prePackCode: "PPK0003", sequence: 2 })]],
  ]);
  const collected = await collectPrepackDetail({
    companyCode: "SYNCO", apiKey: "hidden", keys: ["PPK0001", "PPK0002", "PPK0003"], runId: RUN,
    fetchOptions: { fetchImpl: fetchImplFor(responses), pauseMs: 0 },
  });
  assert.deepEqual(collected.zeroRowKeys, ["PPK0002"]);
  assert.equal(collected.rowsFetched, 3);
  assert.equal(collected.evidence.length, 3); // one evidence entry per request, empty ones included
  const projected = projectPrepackRows(collected.sourceRows, { runId: RUN, fetchedAt: NOW });
  assert.equal(projected.rows.length, 3);
});

test("a response that is not a bare array is malformed and fails loudly", async () => {
  const paged = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [], totalElements: 0 }) });
  await assert.rejects(
    collectPrepackDetail({ companyCode: "SYNCO", apiKey: "hidden", keys: ["PPK0001"], runId: RUN, fetchOptions: { fetchImpl: paged, pauseMs: 0 } }),
    /plain array/,
  );
  await assert.rejects(fetchArrayMaster("/prepackDetail", { companyCode: "SYNCO", prepackCode: "PPK0001" }, "hidden", { fetchImpl: paged, pauseMs: 0 }), /plain array/);
});

test("a row answering a different request than the one that fetched it aborts the run", async () => {
  const responses = new Map([["PPK0001", [sourceRow({ prePackCode: "PPK4444" })]]]);
  await assert.rejects(
    collectPrepackDetail({ companyCode: "SYNCO", apiKey: "hidden", keys: ["PPK0001"], runId: RUN, fetchOptions: { fetchImpl: fetchImplFor(responses), pauseMs: 0 } }),
    /another prepack/,
  );
});

test("the shared request gate serializes one vendor request at a time", async () => {
  let inFlight = 0, peak = 0;
  const responses = new Map([["PPK0001", [sourceRow()]], ["PPK0002", []], ["PPK0003", []]]);
  const fetchImpl = async (url) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((done) => setTimeout(done, 5));
    inFlight -= 1;
    return fetchImplFor(responses)(url);
  };
  await collectPrepackDetail({ companyCode: "SYNCO", apiKey: "hidden", keys: [...responses.keys()], runId: RUN, fetchOptions: { fetchImpl, pauseMs: 0 } });
  assert.equal(peak, 1);
});

// ---------------------------------------------------------------------------------
// The load transaction
// ---------------------------------------------------------------------------------

function buildLoad(rows, fetchedCodes, run = {}) {
  return buildPrepackLoadSql({
    run: {
      id: RUN, endpoint: "/prepackDetail", companyCode: "SYNCO", requestedBy: "test",
      startedAt: NOW, finishedAt: NOW, durationMs: 1, httpStatus: 200, bodyStatus: null,
      rowsFetched: rows.length,
      requestParams: { companyCode: "SYNCO", fullSnapshot: true, coveredKeys: fetchedCodes, zeroRowKeys: [], harvestedKeys: fetchedCodes.length },
      ...run,
    },
    rows, fetchedCodes,
    notes: "full-refresh: asked 2 of 2 harvested code(s); 0 zero-row code(s) recorded; 3 row(s) fetched",
  });
}

test("the load is one transaction that upserts on the proven grain and never collapses rows", () => {
  const rows = projectPrepackRows([sourceRow(), sourceRow({ sequence: 2 })], { runId: RUN, fetchedAt: NOW }).rows;
  const sql = buildLoad(rows, ["PPK0001"]);
  assert.ok(sql.startsWith("begin;"));
  assert.ok(sql.trimEnd().endsWith("commit;"));
  assert.ok(sql.includes("on conflict (company_code, prepack_code, sequence_no) do update"));
  assert.ok(sql.includes("insert into coldlion.prepack_detail"));
  assert.ok(sql.includes("insert into coldlion.sync_run"));
  assert.ok(sql.includes("'/prepackDetail'"));
  // Replay is a no-op: only changed rows reach change_log.
  assert.ok(sql.includes("where t.company_code is null or t.source_hash <> s.source_hash"));
  assert.ok(sql.includes("create temp table _stage_prepack"));
  assert.ok(sql.includes("create temp table _fetched_prepacks"));
});

test("rebuilding the load from the same input produces byte-identical SQL", () => {
  const rows = projectPrepackRows([sourceRow(), sourceRow({ sequence: 2 })], { runId: RUN, fetchedAt: NOW }).rows;
  assert.equal(buildLoad(rows, ["PPK0001"]), buildLoad(rows, ["PPK0001"]));
});

test("a sequence the current response no longer carries is deleted only for codes this run asked", () => {
  const sql = buildLoad([], ["PPK0001", "PPK0002"]);
  assert.ok(sql.includes("delete from coldlion.prepack_detail d"));
  assert.ok(sql.includes("using _fetched_prepacks f"));
  assert.ok(sql.includes("absent from current prepack detail response"));
  // No fetched codes, no delete reach: the temp table is empty.
  const empty = buildLoad([], []);
  assert.ok(empty.includes("create temp table _fetched_prepacks (company_code text, prepack_code text) on commit drop;"));
});

test("zero-row codes are named on the run, alerted, and never printed in notes", () => {
  const rows = projectPrepackRows([sourceRow()], { runId: RUN, fetchedAt: NOW }).rows;
  const sql = buildPrepackLoadSql({
    run: {
      id: RUN, endpoint: "/prepackDetail", companyCode: "SYNCO", requestedBy: "test",
      startedAt: NOW, finishedAt: NOW, durationMs: 1, httpStatus: 200, bodyStatus: null, rowsFetched: 1,
      zeroRowCount: 1,
      requestParams: { companyCode: "SYNCO", coveredKeys: ["PPK0001", "PPK0002"], zeroRowKeys: ["PPK0002"] },
    },
    rows, fetchedCodes: ["PPK0001", "PPK0002"],
    notes: "full-refresh: asked 2 of 2 harvested code(s); 1 zero-row code(s) recorded; 1 row(s) fetched",
  });
  assert.ok(sql.includes(`'{"companyCode":"SYNCO","coveredKeys":["PPK0001","PPK0002"],"zeroRowKeys":["PPK0002"]}'::jsonb`));
  assert.match(sql, /pg_notify\('coldlion_sync_alert'/);
  assert.match(sql, /1 zero-row code\(s\)/);
  // The alert and the notes carry counts only; the codes themselves stay in the
  // private request_params, never in a public log line.
  for (const line of sql.split("\n").filter((line) => line.includes("zero-row code(s)"))) {
    assert.doesNotMatch(line, /PPK/);
  }
});

// ---------------------------------------------------------------------------------
// The entry point, with every dependency stubbed
// ---------------------------------------------------------------------------------

function stubbedQuery({ codes = ["PPK0001", "PPK0002"], covered = [], coverageRow } = {}) {
  return (sql) => {
    if (sql.includes("to_regclass('coldlion.prepack_detail')")) return [["t"]];
    if (sql.includes(" as present")) return PREPACK_HARVEST_SOURCES.map((entry) => [entry.source, "t"]);
    if (sql.includes("runs_succeeded")) {
      // buildReconcileSql
      return [["runs_succeeded", "1"], ["landed_rows", String(codes.length)]];
    }
    if (sql.includes("coveredKeys")) return coverageRow ? [coverageRow] : [];
    if (sql.startsWith("select rows_inserted")) return [["3", "0", "0", "notes"]];
    // buildHarvestKeysSql
    return codes.flatMap((code) => [["item_detail", code], ["prod_history_line", code]]);
  };
}

test("main writes one transaction after proving the target, and reports the recorded counts", async () => {
  const writes = [];
  const result = await main(["--limit", "2", "--pause-ms", "250"], {
    proveTarget: () => ({ database: "db", host: "host", coldlionTables: 20 }),
    queryRows: stubbedQuery(),
    runSql: (sql) => { writes.push(sql); return ""; },
    readApiKey: () => "hidden",
    collectPrepackDetail: async ({ keys }) => ({
      sourceRows: keys.flatMap((code) => [sourceRow({ prePackCode: code, sequence: 1 }), sourceRow({ prePackCode: code, sequence: 2 })]),
      zeroRowKeys: [], evidence: keys.map(() => ({ endpoint: "/prepackDetail", httpStatus: 200, bodyStatus: null })), rowsFetched: keys.length * 2,
    }),
    recordMasterFailure: () => { throw new Error("must not be called"); },
  });
  assert.equal(writes.length, 1);
  assert.ok(writes[0].startsWith("begin;"));
  assert.equal(result.plan.mode, "bounded-backfill");
  assert.deepEqual(result.plan.keys, ["PPK0001", "PPK0002"]);
});

test("dry run fetches and validates live but writes nothing", async () => {
  const writes = [];
  const result = await main(["--dry-run", "--limit", "1", "--pause-ms", "250"], {
    proveTarget: () => ({ database: "db", host: "host" }),
    queryRows: stubbedQuery(),
    runSql: (sql) => { writes.push(sql); return ""; },
    readApiKey: () => "hidden",
    collectPrepackDetail: async ({ keys }) => ({ sourceRows: keys.map((code) => sourceRow({ prePackCode: code })), zeroRowKeys: ["PPK0002"], evidence: [], rowsFetched: 1 }),
  });
  assert.equal(writes.length, 0);
  assert.equal(result.collected.zeroRowKeys.length, 1);
});

test("a collection failure is recorded as a failed run and rethrown", async () => {
  const failures = [];
  await assert.rejects(main(["--limit", "1", "--pause-ms", "250"], {
    proveTarget: () => ({ database: "db", host: "host" }),
    queryRows: stubbedQuery(),
    runSql: () => "",
    readApiKey: () => "hidden",
    collectPrepackDetail: async () => { throw Object.assign(new Error("vendor exploded"), { endpoint: "/prepackDetail" }); },
    recordMasterFailure: (call) => { failures.push(call); },
  }), /vendor exploded/);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].endpoint, "/prepackDetail");
});

test("reconcile mode reads everything and writes nothing", async () => {
  const writes = [];
  const result = await main(["--reconcile"], {
    proveTarget: () => ({ database: "db", host: "host" }),
    queryRows: stubbedQuery({ coverageRow: ["44444444-4444-4444-8444-444444444444", "2026-09-17 00:00:00+00", '["PPK0001"]'] }),
    runSql: (sql) => { writes.push(sql); return ""; },
  });
  assert.equal(writes.length, 0);
  assert.equal(result.pending.length, 1);
});

test("argument parsing accepts the documented flags and refuses the rest", () => {
  const args = parseArgs(["--limit", "5", "--pause-ms", "500", "--company", "SYNCO", "--dry-run"]);
  assert.equal(args.limit, 5);
  assert.equal(args.pauseMs, 500);
  assert.equal(args.company, "SYNCO");
  assert.equal(args.dryRun, true);
  assert.equal(parseArgs([]).limit, null);
  assert.equal(parseArgs([]).pauseMs, 3000);
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--pause-ms", "10"]), /at least 250/);
  assert.throws(() => parseArgs(["--wat"]), /unknown argument/);
});

// ---------------------------------------------------------------------------------
// Workflows: the only sanctioned live paths
// ---------------------------------------------------------------------------------

const PRODUCTION_REF = "qsllyeztdwjgirsysgai";

function readWorkflow(name) {
  return readFileSync(`.github/workflows/${name}`, "utf8");
}

test("the backfill workflow cannot be reached by a push, a pull request or a fork", () => {
  const workflow = readWorkflow("coldlion-prepack-backfill.yml");
  const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
  assert.doesNotMatch(on, /pull_request|push:/);
  assert.match(on, /workflow_dispatch/);
});

test("every step that can write names the database it expects before it writes", () => {
  for (const name of ["coldlion-prepack-backfill.yml", "coldlion-landing-sync.yml"]) {
    const workflow = readWorkflow(name);
    const declarations = workflow.match(/COLDLION_EXPECTED_PROJECT_REF: (\S+)/g) ?? [];
    assert.ok(declarations.length >= 2, `${name} must declare its target beside every DATABASE_URL`);
    for (const declaration of declarations) {
      assert.equal(declaration, `COLDLION_EXPECTED_PROJECT_REF: ${PRODUCTION_REF}`, `${name} must hard-code the target, never accept one`);
    }
    assert.equal((workflow.match(/DATABASE_URL: \$\{\{/g) ?? []).length, declarations.length, `${name} would otherwise carry a credential with no declared target`);
  }
});

test("the workflows cannot start without the secrets they need", () => {
  for (const name of ["coldlion-prepack-backfill.yml", "coldlion-landing-sync.yml"]) {
    const workflow = readWorkflow(name);
    assert.match(workflow, /SUPABASE_DB_URL_PRODUCTION is not set/, `${name} must fail loudly, not empty`);
    assert.match(workflow, /COLDLION_API_KEY is not set/, `${name} must fail loudly, not empty`);
  }
});

test("the offline contract tests run before anything touches the database", () => {
  const backfill = readWorkflow("coldlion-prepack-backfill.yml");
  assert.ok(backfill.indexOf("coldlion-landing-prepack.test.mjs") < backfill.indexOf("sync-prepack-detail.mjs"));
  const sync = readWorkflow("coldlion-landing-sync.yml");
  assert.ok(sync.indexOf("coldlion-landing-prepack.test.mjs") < sync.indexOf("sync-prepack-detail.mjs"));
});

test("the backfill shares the landing serialization group and stays inside a bounded timeout", () => {
  const backfill = readWorkflow("coldlion-prepack-backfill.yml");
  assert.match(backfill, /group: coldlion-landing-sync/);
  const timeout = /timeout-minutes: (\d+)/.exec(backfill);
  assert.ok(timeout && Number(timeout[1]) > 0 && Number(timeout[1]) <= 360);
});

test("the scheduled refresh re-asks every harvested code after masters", () => {
  const sync = readWorkflow("coldlion-landing-sync.yml");
  assert.ok(sync.indexOf("sync-history.mjs") < sync.indexOf("sync-masters.mjs"));
  assert.ok(sync.indexOf("sync-masters.mjs") < sync.indexOf("sync-prepack-detail.mjs"));
  assert.match(sync, /schedule:/);
});

// ---------------------------------------------------------------------------------
// Privacy: this repository is public
// ---------------------------------------------------------------------------------

test("no real ColdLion value is committed anywhere in the loader or its tests", () => {
  // Spelled in pieces so this test file cannot trip its own guard.
  const realCompanyCode = ["EDGE", "HOME"].join("");
  for (const path of [
    "tools/coldlion-landing/sync-prepack-detail.mjs",
    "tools/coldlion-landing/lib/prepack-detail.mjs",
    "tools/coldlion-landing-prepack.test.mjs",
  ]) {
    const content = readFileSync(path, "utf8");
    assert.doesNotMatch(content, new RegExp(realCompanyCode), `${path} must not name the real company code`);
    assert.doesNotMatch(content, /x5\.coldlion\.com/, `${path} must not restate the vendor origin (master-http owns it)`);
  }
  // The company default flows from sync-masters' constant, not a new copy of it.
  assert.match(readFileSync("tools/coldlion-landing/sync-prepack-detail.mjs", "utf8"), /COMPANY_CODE } from "\.\/sync-masters\.mjs"/);
});

test("knownApiFields accepts the prepack spec shape", () => {
  const known = knownApiFields(PREPACK_DETAIL_SPEC);
  for (const field of PREPACK_DETAIL_SPEC.fields) assert.ok(known.has(field.api));
  assert.ok(!known.has("newPrivateField"));
});
