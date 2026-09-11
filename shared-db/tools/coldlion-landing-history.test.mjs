// Offline contract tests for the ColdLion history landing loader.
//
// Everything here runs with NO network, NO secrets and NO database. The fixtures are
// synthetic: this repository is public and ColdLion payloads are not ours to publish, so
// no real order, item, customer or vendor value appears below.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GRID_ANCHOR, isoDate, lastClosedWindowIndex, recentClosedWindows, windowAtIndex, windowContaining, windowRange, windowsEndingAt } from "./coldlion-landing/lib/grid.mjs";
import { ORDER_HISTORY, allScopes, prodHistoryScope } from "./coldlion-landing/lib/scopes.mjs";
import { assertPagesComplete, buildPageUrl, fetchPage, fetchWindowScope, isPermanentStatus, requestParams, validatePage } from "./coldlion-landing/lib/http.mjs";
import { assertExpectedTarget } from "./coldlion-landing/lib/db.mjs";
import { bigint, canonical, date, num, sourceHash, splitTokens, sqlText, text } from "./coldlion-landing/lib/values.mjs";
import { projectOrderHistoryWindow, splitInvoiceTokens } from "./coldlion-landing/lib/project-order-history.mjs";
import { projectProdHistoryWindow, quantitiesAgree, selectLookup } from "./coldlion-landing/lib/project-prod-history.mjs";
import { buildOrderHistoryLoadSql, buildProdHistoryLoadSql } from "./coldlion-landing/lib/load-window.mjs";
import { loadedWindowsSql } from "./coldlion-landing/lib/run-history.mjs";
import { parseArgs as parseBackfillArgs, selectScopes } from "./coldlion-landing/backfill-history.mjs";
import { parseArgs as parseSyncArgs } from "./coldlion-landing/sync-history.mjs";

// ---------------------------------------------------------------------------------
// The fixed grid
// ---------------------------------------------------------------------------------

test("every window starts a whole number of weeks after the anchor", () => {
  for (const index of [0, 1, 52, 400]) {
    const window = windowAtIndex(index);
    const days = (Date.parse(`${window.from}T00:00:00Z`) - Date.parse(`${GRID_ANCHOR}T00:00:00Z`)) / 86_400_000;
    assert.equal(days % 7, 0, `${window.from} is off the grid the database CHECK enforces`);
    const span = (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / 86_400_000;
    assert.equal(span, 6, "a window is exactly seven days inclusive, not at most seven");
  }
});

test("a date inside a window snaps down to that window", () => {
  assert.deepEqual(windowContaining("2019-01-05"), { index: 0, from: "2019-01-01", to: "2019-01-07" });
  assert.deepEqual(windowContaining("2019-01-08"), { index: 1, from: "2019-01-08", to: "2019-01-14" });
});

test("a date before the anchor is refused rather than clamped", () => {
  assert.throws(() => windowContaining("2018-12-31"), /before the fixed grid anchor/);
});

test("windowRange is oldest first and inclusive of the end window", () => {
  const windows = [...windowRange("2019-01-03", "2019-01-20")];
  assert.deepEqual(windows.map((window) => window.from), ["2019-01-01", "2019-01-08", "2019-01-15"]);
});

// A window is SEALED by being loaded, so selecting the window a date falls inside would
// freeze a still-open week as a finished one. Everything below pins that boundary; before
// these existed the arithmetic was tested and the open/closed question never was.
test("the newest selectable window is the one that has closed, never the current one", () => {
  const windows = recentClosedWindows("2019-01-20", 2);
  assert.deepEqual(windows.map((window) => window.from), ["2019-01-01", "2019-01-08"]);
  assert.equal(windows.at(-1).to < "2019-01-20", true, "the selected windows have all ended");
});

test("the window containing the date is excluded on every day of its life", () => {
  for (const day of ["2019-01-15", "2019-01-18", "2019-01-21"]) {
    const windows = recentClosedWindows(day, 3);
    assert.equal(windows.at(-1).to < day, true, `${day} selected a window that had not ended`);
  }
});

test("nothing can be loaded before the first window has closed", () => {
  assert.throws(() => lastClosedWindowIndex("2019-01-03"), /no seven-day window has closed/);
});

// ---------------------------------------------------------------------------------
// Scopes: the stage dimension exists for production history and only there
// ---------------------------------------------------------------------------------

test("production history is fetched once per stage and sales history has no stage", () => {
  const scopes = allScopes();
  assert.equal(scopes.length, 4);
  assert.equal(ORDER_HISTORY.stage, null);
  assert.deepEqual(
    scopes.filter((scope) => scope.endpoint === "/prodHistory").map((scope) => scope.stage),
    ["ISS", "INTRAN", "REC"],
  );
});

test("an unknown production stage is refused", () => {
  assert.throws(() => prodHistoryScope("ISSUED"), /unknown production stage/);
});

test("the stage reaches the URL and the recorded request params for prodHistory only", () => {
  const window = windowAtIndex(0);
  const prod = buildPageUrl(prodHistoryScope("REC"), window, 0, {});
  assert.equal(prod.searchParams.get("stageCode"), "REC");
  const order = buildPageUrl(ORDER_HISTORY, window, 0, {});
  assert.equal(order.searchParams.get("stageCode"), null);
  assert.equal(requestParams(ORDER_HISTORY, window, 0, {}).stageCode, undefined);
});

// ---------------------------------------------------------------------------------
// The two vendor defects
// ---------------------------------------------------------------------------------

const envelope = (content, overrides = {}) => ({
  content,
  number: 0,
  size: 200,
  numberOfElements: content.length,
  totalElements: content.length,
  totalPages: 1,
  last: true,
  ...overrides,
});

test("a silently substituted page size is accepted and recorded, not treated as an error", () => {
  const page = validatePage(envelope([], { size: 200 }), 0, ORDER_HISTORY, 2000);
  assert.equal(page.size, 200, "the vendor's own size stands; the requested size is kept separately");
});

test("a page size LARGER than requested is impossible and is refused", () => {
  assert.throws(
    () => validatePage(envelope([], { size: 500 }), 0, ORDER_HISTORY, 200),
    /impossible page size/,
  );
});

test("a page answering a different page number is refused", () => {
  assert.throws(() => validatePage(envelope([], { number: 3 }), 0, ORDER_HISTORY, 200), /returned page 3/);
});

test("a prodHistory page carrying another stage is refused at the door", () => {
  assert.throws(
    () => validatePage(envelope([{ stageCode: "ISS" }]), 0, prodHistoryScope("REC"), 200),
    /stage other than the requested REC/,
  );
});

test("a wire 400 whose body claims 500 is PERMANENT and is not retried", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ status: 500, error: "Internal Server Error" }),
    };
  };
  const error = await fetchPage(new URL("http://example.invalid/EhpApi/orderHistory"), "k", {
    fetchImpl,
    pauseMs: 0,
  }).then(
    () => null,
    (caught) => caught,
  );
  assert.ok(error, "a refused request must throw");
  assert.equal(error.httpStatus, 400);
  assert.equal(error.bodyStatus, 500, "the body's claim is kept as evidence of the contract");
  assert.equal(error.permanent, true, "the WIRE status decides, never the body");
  assert.equal(calls, 1, "a permanent input error must not be retried");
});

test("a transient 5xx on the wire IS retried within the bound", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 503, text: async () => "{}" };
    return { ok: true, status: 200, text: async () => JSON.stringify(envelope([])) };
  };
  const result = await fetchPage(new URL("http://example.invalid/EhpApi/orderHistory"), "k", {
    fetchImpl,
    pauseMs: 0,
  });
  assert.equal(calls, 3);
  assert.equal(result.httpStatus, 200);
});

test("a window is complete only when its pages are contiguous and sum to the vendor total", () => {
  const pages = [
    { pageNumber: 0, rowCount: 2, reportedTotalElements: 3, reportedTotalPages: 2, isLastPage: false },
    { pageNumber: 1, rowCount: 1, reportedTotalElements: 3, reportedTotalPages: 2, isLastPage: true },
  ];
  assert.equal(assertPagesComplete(pages, ORDER_HISTORY).rows, 3);

  const gap = [pages[0], { ...pages[1], pageNumber: 2 }];
  assert.throws(() => assertPagesComplete(gap, ORDER_HISTORY), /not contiguous/);

  const short = [{ ...pages[0], isLastPage: true }];
  assert.throws(() => assertPagesComplete(short, ORDER_HISTORY), /pages are incomplete/);
});

test("fetchWindowScope walks to the vendor's own last flag", async () => {
  const pages = [
    envelope([{ a: 1 }, { a: 2 }], { number: 0, totalElements: 3, totalPages: 2, last: false, numberOfElements: 2 }),
    envelope([{ a: 3 }], { number: 1, totalElements: 3, totalPages: 2, last: true, numberOfElements: 1 }),
  ];
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(pages[Number(url.searchParams.get("page"))]),
  });
  const result = await fetchWindowScope({
    scope: ORDER_HISTORY,
    window: windowAtIndex(0),
    apiKey: "k",
    fetchImpl,
    pauseMs: 0,
  });
  assert.equal(result.rows, 3);
  assert.equal(result.lastPageNumber, 1);
  assert.equal(result.pages[0].requestedPageSize, 200);
});

// ---------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------

test("the vendor's empty-date marker becomes NULL, and blanks become NULL", () => {
  assert.equal(date("1900-01-01"), null);
  assert.equal(date("1900-01-01T00:00:00"), null);
  assert.equal(date("2021-03-04"), "2021-03-04");
  assert.equal(text("   "), null);
  assert.throws(() => date("04/03/2021"), /not an ISO date/);
});

test("the source hash does not depend on key order", () => {
  assert.equal(sourceHash({ a: 1, b: 2 }), sourceHash({ b: 2, a: 1 }));
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("token lists keep their order and drop blanks", () => {
  assert.deepEqual(splitTokens(" A1, ,B2 "), ["A1", "B2"]);
  assert.deepEqual(splitTokens(""), []);
});

test("SQL text literals escape quotes", () => {
  assert.equal(sqlText("O'Hare"), "'O''Hare'");
  assert.equal(sqlText(null), "null");
});

// ---------------------------------------------------------------------------------
// Sales-history projection
// ---------------------------------------------------------------------------------

const orderRow = (overrides = {}) => ({
  companyCode: "TESTCO",
  salesOrderNo: "1001",
  salesOrderLineNo: "1",
  itemNo: "PARENT-A",
  divisionCode: "TS001",
  lineQty: 24,
  prepackQty: 4,
  subItemNo: "SKU-1",
  subLabelCode: "L1",
  quantity: 6,
  orderQty: 6,
  linePrice: 3.5,
  startDate: "1900-01-01",
  ...overrides,
});

let counter = 0;
const ids = () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

test("parent totals are stored once and never multiplied across components", () => {
  counter = 0;
  const projected = projectOrderHistoryWindow(
    [orderRow(), orderRow({ subItemNo: "SKU-2", quantity: 18, orderQty: 18 })],
    { runId: ids(), fetchedAt: "2026-09-08T00:00:00Z", newId: ids },
  );
  assert.equal(projected.lines.length, 1, "one parent line, not one per component");
  assert.equal(projected.components.length, 2);
  assert.equal(projected.lines[0].line_qty, 24, "the header total is stored verbatim, not summed");
  assert.equal(projected.lines[0].start_date, null, "the empty-date marker never lands as a date");
});

test("a differing line projection is a separate VERSION, never a merged row", () => {
  counter = 0;
  const projected = projectOrderHistoryWindow(
    [orderRow(), orderRow({ customerCode: "CHANGED", subItemNo: "SKU-2" })],
    { runId: ids(), fetchedAt: "2026-09-08T00:00:00Z", newId: ids },
  );
  assert.equal(projected.lines.length, 2);
  assert.equal(projected.versionFanOut, 1, "the fan-out is reported, not hidden");
  assert.notEqual(projected.lines[0].line_source_hash, projected.lines[1].line_source_hash);
});

test("EP001 rows are excluded and the exclusion is counted, not silent", () => {
  counter = 0;
  const projected = projectOrderHistoryWindow(
    [orderRow(), orderRow({ divisionCode: "EP001" })],
    { runId: ids(), fetchedAt: "2026-09-08T00:00:00Z", newId: ids },
  );
  assert.equal(projected.lines.length, 1);
  assert.equal(projected.excludedEp001, 1);
});

test("mismatched invoice lists keep both lists and invent no pairing", () => {
  const aligned = splitInvoiceTokens({
    invoice_no_string: "I1,I2",
    invoice_date_string: "2021-03-04,2021-03-05",
  });
  assert.equal(aligned.mismatch, false);
  assert.deepEqual(aligned.refs.map((ref) => ref.invoice_date), ["2021-03-04", "2021-03-05"]);

  const ragged = splitInvoiceTokens({ invoice_no_string: "I1,I2", invoice_date_string: "2021-03-04" });
  assert.equal(ragged.mismatch, true);
  assert.equal(ragged.refs.length, 2, "every number token is still kept");
  assert.ok(ragged.refs.every((ref) => ref.invoice_date === null && !ref.date_alignment_proven));
});

test("document tokens are ordinal-numbered from 1 and flagged on the component", () => {
  counter = 0;
  const projected = projectOrderHistoryWindow(
    [orderRow({ invoiceNoString: "I1,I2", invoiceDateString: "2021-03-04", pickTicketNoString: "P1" })],
    { runId: ids(), fetchedAt: "2026-09-08T00:00:00Z", newId: ids },
  );
  assert.deepEqual(projected.invoiceRefs.map((ref) => ref.ordinal), [1, 2]);
  assert.deepEqual(projected.pickTicketRefs.map((ref) => ref.pick_ticket_no), ["P1"]);
  assert.equal(projected.components[0].document_list_cardinality_mismatch, true);
  assert.equal(projected.cardinalityMismatches, 1);
});

// ---------------------------------------------------------------------------------
// Production-history projection
// ---------------------------------------------------------------------------------

const prodRow = (overrides = {}) => ({
  companyCode: "TESTCO",
  prodOrderNo: "5001",
  prodLineSeq: "1",
  stageCode: "ISS",
  divisionCode: "TS001",
  itemNo: "PARENT-B",
  totalPpkQty: 10,
  ppkDetailQty: 4,
  prepackItemNo: "PPK-1",
  subItemNo: "SKU-1",
  lastProdDate: "2020-05-05",
  lastProdCost: 3,
  ...overrides,
});

const prodOptions = () => ({
  runId: ids(),
  fetchedAt: "2026-09-08T00:00:00Z",
  requestedStage: "ISS",
  observedAt: "2026-09-08T00:00:00Z",
  newId: ids,
});

test("a returned stage other than the requested one aborts the window", () => {
  counter = 0;
  assert.throws(
    () => projectProdHistoryWindow([prodRow({ stageCode: "REC" })], prodOptions()),
    /returned stage REC for requested stage ISS/,
  );
});

test("a row with no returned stage is refused rather than stamped with the request", () => {
  counter = 0;
  assert.throws(
    () => projectProdHistoryWindow([prodRow({ stageCode: null })], prodOptions()),
    /returned no stageCode/,
  );
});

test("component quantities are only asserted when they reconcile exactly", () => {
  counter = 0;
  const reconciling = projectProdHistoryWindow(
    [prodRow(), prodRow({ prepackItemNo: "PPK-2", ppkDetailQty: 6, subItemNo: "SKU-2" })],
    prodOptions(),
  );
  assert.equal(reconciling.lines.length, 1);
  assert.equal(reconciling.assertableLineIds.length, 1, "4 + 6 = the parent total of 10");

  counter = 0;
  const short = projectProdHistoryWindow([prodRow()], prodOptions());
  assert.equal(short.assertableLineIds.length, 0, "4 alone does not reconcile against 10");
});

test("the last* lookup is separated, deduplicated and one copy is deterministically selected", () => {
  counter = 0;
  const projected = projectProdHistoryWindow(
    [
      prodRow({ lastProdCost: 3 }),
      prodRow({ lastProdCost: 3.6, prepackItemNo: "PPK-2", subItemNo: "SKU-2", ppkDetailQty: 6 }),
    ],
    prodOptions(),
  );
  assert.equal(projected.lastLookups.length, 2, "both copies stay visible; neither is summed");
  const selected = projected.lastLookups.filter((lookup) => lookup.is_selected_lookup);
  assert.equal(selected.length, 1, "at most one copy may be selected");
  assert.equal(selected[0].last_prod_cost, 3.6);
  assert.ok(selected[0].selection_rule, "a selection without a recorded rule is a guess wearing a flag");
  assert.ok(
    !Object.keys(projected.lastLookups[0]).some((key) => ["prod_cost", "ext_cost"].includes(key)),
    "no order-cost field may appear on the lookup grain",
  );
});

test("the lookup selection prefers the newest dated copy and is stable", () => {
  const copies = [
    { last_prod_date: null, last_prod_cost: 9, lookup_source_hash: "a" },
    { last_prod_date: "2020-01-01", last_prod_cost: 1, lookup_source_hash: "b" },
  ];
  assert.equal(selectLookup(copies).lookup_source_hash, "b");
  assert.equal(selectLookup([...copies].reverse()).lookup_source_hash, "b");
  assert.equal(selectLookup([]), null);
});

// ---------------------------------------------------------------------------------
// The generated transaction
// ---------------------------------------------------------------------------------

const page = (rowCount) => ({
  pageNumber: 0,
  requestedPageSize: 200,
  returnedPageSize: 200,
  rowCount,
  reportedTotalElements: rowCount,
  reportedTotalPages: 1,
  isLastPage: true,
  httpStatus: 200,
  bodyStatus: null,
  content: [],
  fetchedAt: "2026-09-08T00:00:00Z",
});

function orderSql() {
  counter = 0;
  const runId = "11111111-1111-4111-8111-111111111111";
  const projected = projectOrderHistoryWindow([orderRow({ invoiceNoString: "I1", invoiceDateString: "2021-03-04" })], {
    runId,
    fetchedAt: "2026-09-08T00:00:00Z",
    newId: ids,
  });
  return buildOrderHistoryLoadSql({
    window: windowAtIndex(0),
    scope: ORDER_HISTORY,
    runId,
    requestedBy: "test",
    companyCode: "TESTCO",
    pages: [page(1)],
    completion: { rows: 1, reportedTotalElements: 1, reportedTotalPages: 1, lastPageNumber: 0 },
    projected,
    startedAt: "2026-09-08T00:00:00Z",
    finishedAt: "2026-09-08T00:00:01Z",
    durationMs: 1000,
    notes: "lines=1",
  });
}

test("the window load is one transaction that refuses an already-loaded window", () => {
  const sql = orderSql();
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;$/);
  assert.match(sql, /is already loaded/);
  assert.equal(sql.split("begin;").length - 1, 1, "exactly one transaction per window");
});

test("page evidence is written before the window is marked loaded", () => {
  const sql = orderSql();
  const pageInsert = sql.indexOf("insert into coldlion.history_page_ledger");
  const loaded = sql.indexOf("set state = 'loaded'");
  assert.ok(pageInsert > 0 && loaded > pageInsert, "the completion guard has nothing to read otherwise");
});

test("every landing insert is idempotent against its real identity constraint", () => {
  const sql = orderSql();
  for (const constraint of [
    "coldlion_order_history_line_identity_unique",
    "coldlion_order_history_component_identity_unique",
    "coldlion_order_history_invoice_ref_identity_unique",
    "coldlion_order_history_pick_ticket_ref_identity_unique",
  ]) {
    assert.match(sql, new RegExp(`on conflict on constraint ${constraint} do nothing`));
  }
});

test("nullable identity columns are mapped with IS NOT DISTINCT FROM", () => {
  const sql = orderSql();
  assert.match(sql, /t\.sub_item_no is not distinct from s\.sub_item_no/);
  assert.match(sql, /t\.sales_order_no = s\.sales_order_no/);
});

test("no stage is invented for sales history anywhere in the transaction", () => {
  const sql = orderSql();
  assert.doesNotMatch(sql, /stage_code = 'ISS'/);
  assert.match(sql, /stage_code is not distinct from null/);
});

function prodSql() {
  counter = 0;
  const runId = "22222222-2222-4222-8222-222222222222";
  const projected = projectProdHistoryWindow(
    [prodRow(), prodRow({ prepackItemNo: "PPK-2", ppkDetailQty: 6, subItemNo: "SKU-2" })],
    { runId, fetchedAt: "2026-09-08T00:00:00Z", requestedStage: "ISS", observedAt: "2026-09-08T00:00:00Z", newId: ids },
  );
  return buildProdHistoryLoadSql({
    window: windowAtIndex(0),
    scope: prodHistoryScope("ISS"),
    runId,
    requestedBy: "test",
    companyCode: "TESTCO",
    pages: [page(2)],
    completion: { rows: 2, reportedTotalElements: 2, reportedTotalPages: 1, lastPageNumber: 0 },
    projected,
    startedAt: "2026-09-08T00:00:00Z",
    finishedAt: "2026-09-08T00:00:01Z",
    durationMs: 1000,
    notes: "lines=1",
  });
}

test("production history asserts component quantities only after the components exist", () => {
  const sql = prodSql();
  const components = sql.indexOf("insert into coldlion.prod_history_component");
  const assertion = sql.indexOf("set component_quantities_asserted = true");
  assert.ok(components > 0 && assertion > components, "the guard reads components that must already exist");
  assert.match(sql, /stage_code is not distinct from 'ISS'/);
  assert.match(sql, /is_backfill_baseline/);
});

// ---------------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------------

test("the backfill requires a start and ends at the newest closed window", () => {
  assert.throws(() => parseBackfillArgs([]), /--from/);
  const today = isoDate(new Date());
  const args = parseBackfillArgs(["--from", "2019-01-01", "--limit", "5"]);
  assert.equal(args.limit, 5);
  assert.match(args.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(args.to < today, true, "the default end must be a window that has already ended");
  assert.equal(
    parseBackfillArgs(["--from", "2019-01-01", "--to", "2999-01-01"]).to,
    args.to,
    "an end date in the future is clamped, not obeyed",
  );
});

test("the backfill refuses a limit that would silently drop work", () => {
  // `work.slice(0, -1)` drops the LAST outstanding pair and reports success.
  assert.throws(() => parseBackfillArgs(["--from", "2019-01-01", "--limit", "-1"]), /positive whole number/);
  assert.throws(() => parseBackfillArgs(["--from", "2019-01-01", "--limit", "0"]), /positive whole number/);
  assert.throws(() => parseBackfillArgs(["--from", "2019-01-01", "--limit", "2.5"]), /positive whole number/);
});

test("the backfill can be narrowed to one endpoint or one stage", () => {
  assert.equal(selectScopes({ endpoint: "/orderHistory" }).length, 1);
  assert.equal(selectScopes({ stage: "REC" }).length, 1);
  assert.equal(selectScopes({}).length, 4);
  assert.throws(() => parseBackfillArgs(["--from", "2019-01-01", "--stage", "NOPE"]), /--stage must be one of/);
});

test("the scheduled sync trails more than one window by default", () => {
  const args = parseSyncArgs([]);
  assert.ok(args.windows >= 2, "an order edited days later falls in an older window");
  assert.throws(() => parseSyncArgs(["--windows", "0"]), /positive integer/);
  const windows = windowsEndingAt(parseSyncArgs([]).to, args.windows);
  assert.equal(windows.at(-1).to < isoDate(new Date()), true, "the sync never selects the open week");
});

// The clamp and the selector each behaved correctly and disagreed by one window: the
// clamp handed over the last DAY of the newest closed week, and an "as of" selector reads
// the window around that day as the current one. The scheduled job therefore skipped the
// very week it exists to pick up, and with `--windows 1` skipped it on the only run that
// would ever have loaded it. Asserting "older than today" stayed true throughout, so the
// assertion below is on the exact window, not on an inequality.
test("the scheduled sync loads the week that just closed, not the one before it", () => {
  const lastClosed = windowAtIndex(lastClosedWindowIndex(isoDate(new Date())));
  const selected = windowsEndingAt(parseSyncArgs([]).to, 1);
  assert.deepEqual(selected, [lastClosed], "the newest closed window must be selected");
  assert.deepEqual(windowsEndingAt(parseSyncArgs(["--to", lastClosed.to]).to, 1), [lastClosed]);
  // Any day inside the newest closed week names that same week.
  assert.deepEqual(windowsEndingAt(lastClosed.from, 1), [lastClosed]);
  assert.throws(() => windowsEndingAt(lastClosed.to, 0), /positive integer/);
});

// ---------------------------------------------------------------------------------
// Regressions found by the governed review of this change (PR #2589)
// ---------------------------------------------------------------------------------

test("a whitespace-only number is blank, not zero", () => {
  // `Number("")` is 0, so a trim that does not short-circuit turns a field the vendor
  // left blank into a real quantity of zero that every not-null check then accepts.
  assert.equal(num(""), null);
  assert.equal(num("   "), null);
  assert.equal(num("\t\n"), null);
  assert.equal(num(0), 0, "a real zero still survives");
  assert.equal(num("0"), 0);
  assert.equal(bigint("  "), null);
  assert.equal(num(" 12.5 "), 12.5);
});

test("a decimal component sum still reconciles against its parent total", () => {
  // 5.1 + 5.2 is 10.299999999999999 in binary floating point. An exact comparison would
  // leave a line that genuinely reconciles unasserted, and the guard would stop firing
  // without ever failing.
  assert.equal(quantitiesAgree(5.1 + 5.2, 10.3), true);
  assert.equal(quantitiesAgree(9.3, 10.3), false, "a real discrepancy is still a discrepancy");

  counter = 0;
  const projected = projectProdHistoryWindow(
    [
      prodRow({ totalPpkQty: 10.3, ppkDetailQty: 5.1 }),
      prodRow({ totalPpkQty: 10.3, ppkDetailQty: 5.2, prepackItemNo: "PPK-2", subItemNo: "SKU-2" }),
    ],
    prodOptions(),
  );
  assert.equal(projected.assertableLineIds.length, 1);
});

test("a one-sided invoice list is flagged rather than dropped in silence", () => {
  const datesOnly = splitInvoiceTokens({ invoice_no_string: null, invoice_date_string: "2020-01-01" });
  assert.equal(datesOnly.refs.length, 0);
  assert.equal(datesOnly.mismatch, true, "dates with no numbers produce no rows; that must be counted");

  const numbersOnly = splitInvoiceTokens({ invoice_no_string: "INV-1", invoice_date_string: null });
  assert.equal(numbersOnly.refs.length, 1);
  assert.equal(numbersOnly.mismatch, true);
  assert.equal(numbersOnly.refs[0].date_alignment_proven, false);

  const neither = splitInvoiceTokens({ invoice_no_string: null, invoice_date_string: null });
  assert.equal(neither.mismatch, false, "nothing on either side is not a disagreement");
});

test("the resumable ledger read quotes the company code it was given", () => {
  const sql = loadedWindowsSql("TEST'CO");
  assert.match(sql, /company_code = 'TEST''CO'/);
});


// ---------------------------------------------------------------------------------
// Regressions found by the second governed review of this change (PR #2589)
// ---------------------------------------------------------------------------------

test("an as-of date in the future cannot make the sync seal an unfinished week", () => {
  const today = isoDate(new Date());
  const defaulted = parseSyncArgs([]);
  assert.equal(
    parseSyncArgs(["--to", "2999-01-01"]).to,
    defaulted.to,
    "a future end date selects weeks the vendor answers empty, and an empty week seals as loaded",
  );
  assert.equal(defaulted.to < today, true);
});

test("both entry points refuse a page size that is not a positive whole number", () => {
  for (const bad of ["0", "-1", "2.5", "not-a-number"]) {
    assert.throws(() => parseSyncArgs(["--page-size", bad]), /positive whole number/);
    assert.throws(() => parseBackfillArgs(["--from", "2019-01-01", "--page-size", bad]), /positive whole number/);
  }
});

test("a throttle or a request timeout is not treated as a permanent refusal", () => {
  assert.equal(isPermanentStatus(400), true, "a malformed history request is refused for good");
  assert.equal(isPermanentStatus(404), true);
  assert.equal(isPermanentStatus(408), false, "a request timeout says later, not never");
  assert.equal(isPermanentStatus(429), false, "abandoning a throttled window loses the week");
  assert.equal(isPermanentStatus(500), false);
});

test("a writer refuses to run unless the database it is pointed at is the declared one", () => {
  // No user:password in the fixture: a connection string with credentials in it reads as
  // an email address to the PII forward guard, and this repository is public.
  const url = "postgresql://db.qsllyeztdwjgirsysgai.supabase.co:5432/postgres";
  assert.doesNotThrow(() =>
    assertExpectedTarget({ expectedProjectRef: "qsllyeztdwjgirsysgai", databaseUrl: url }),
  );
  assert.throws(
    () => assertExpectedTarget({ expectedProjectRef: "someotherproject", databaseUrl: url }),
    /project/i,
    "a URL for a different project must be refused, not written to",
  );
  assert.throws(() => assertExpectedTarget({ expectedProjectRef: "", databaseUrl: url }), /COLDLION_EXPECTED_PROJECT_REF/);
  assert.throws(() => assertExpectedTarget({ expectedProjectRef: "qsllyeztdwjgirsysgai", databaseUrl: "" }), /DATABASE_URL/);
});

test("evidence for a production line sealed by an earlier window is skipped, not forced", () => {
  const sql = prodSql();
  for (const target of ["prod_history_component", "prod_history_last_lookup"]) {
    const insert = sql.slice(sql.indexOf(`insert into coldlion.${target}`));
    assert.match(
      insert.slice(0, 4000),
      /join coldlion\.prod_history_line p on p\.id = m\.id and not p\.component_quantities_asserted/,
      `${target} would abort the whole window against a sealed parent, and every retry with it`,
    );
  }
  assert.match(sql, /already sealed by an earlier window/, "a skip nobody can see is a silent loss");
});

// ---------------------------------------------------------------------------------
// The two workflows that are the ONLY sanctioned way to run this against the real
// database. Static on purpose: the only dynamic test of a production writer is a
// production write.
// ---------------------------------------------------------------------------------

const PRODUCTION_REF = "qsllyeztdwjgirsysgai";

const readWorkflow = (name) =>
  readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), "utf8");

const sync = readWorkflow("coldlion-landing-sync.yml");
const backfill = readWorkflow("coldlion-history-backfill.yml");
const both = [
  ["the scheduled sync", sync],
  ["the backfill", backfill],
];

test("neither workflow can be reached by a push, a pull request or a fork", () => {
  for (const [name, workflow] of both) {
    const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    assert.doesNotMatch(on, /pull_request|push:/, `${name} must not run on someone else's commit`);
    assert.match(on, /workflow_dispatch/, `${name} must stay hand-startable`);
  }
});

test("every step that can write names the database it expects before it writes", () => {
  for (const [name, workflow] of both) {
    const declarations = workflow.match(/COLDLION_EXPECTED_PROJECT_REF: (\S+)/g) ?? [];
    assert.ok(declarations.length >= 2, `${name} must declare its target beside every DATABASE_URL`);
    for (const declaration of declarations) {
      assert.equal(
        declaration,
        `COLDLION_EXPECTED_PROJECT_REF: ${PRODUCTION_REF}`,
        `${name} must hard-code the target, never accept one`,
      );
    }
    assert.equal(
      (workflow.match(/DATABASE_URL: \$\{\{/g) ?? []).length,
      declarations.length,
      `${name} would otherwise carry a credential with no declared target`,
    );
  }
});

test("neither workflow can start without the secrets it needs", () => {
  for (const [name, workflow] of both) {
    assert.match(workflow, /SUPABASE_DB_URL_PRODUCTION is not set/, `${name} must fail loudly, not empty`);
    assert.match(workflow, /COLDLION_API_KEY is not set/, `${name} must fail loudly, not empty`);
  }
});

test("the offline contract tests run before anything touches the database", () => {
  for (const [name, workflow] of both) {
    const tests = workflow.indexOf("node --test tools/coldlion-landing-history.test.mjs");
    const write = workflow.search(/DATABASE_URL: \$\{\{/);
    assert.ok(tests > 0, `${name} must prove the loader still holds its contracts`);
    assert.ok(tests < write, `${name} must prove it before it is trusted with a credential`);
  }
});

test("two runs of the same loader cannot overlap", () => {
  for (const [name, workflow] of both) {
    assert.match(workflow, /concurrency:/, `${name} must serialise itself`);
    assert.match(workflow, /cancel-in-progress: false/, `${name} must never cut a window's transaction short`);
  }
});

test("no secret value can be printed", () => {
  for (const [name, workflow] of both) {
    assert.doesNotMatch(workflow, /echo .*\$\{\{\s*secrets\./, `${name} must never echo a secret`);
    assert.doesNotMatch(workflow, /echo "?\$DATABASE_URL/, `${name} must never echo the connection string`);
  }
});
