import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backwardWindows,
  buildPageUrl,
  captureScope,
  fetchPage,
  historyScopes,
  productionDuplicateTripwire,
  validatePage,
  verifyCompletePages,
} from "./coldlion-history-puller.mjs";

function page(number, content, { last = true, totalElements = content.length, totalPages = 1 } = {}) {
  return { content, first: number === 0, last, number, numberOfElements: content.length,
    size: 200, totalElements, totalPages, sort: null };
}

test("windows are exactly seven inclusive days and move backward without overlap", () => {
  const windows = [...backwardWindows("2026-09-04", 3)];
  assert.deepEqual(windows, [
    { number: 0, from: "2026-08-29", to: "2026-09-04" },
    { number: 1, from: "2026-08-22", to: "2026-08-28" },
    { number: 2, from: "2026-08-15", to: "2026-08-21" },
  ]);
});

test("history scopes pull order once and production for all three stages", () => {
  assert.deepEqual(historyScopes(), [
    { endpoint: "orderHistory", stage: null },
    { endpoint: "prodHistory", stage: "ISS" },
    { endpoint: "prodHistory", stage: "INTRAN" },
    { endpoint: "prodHistory", stage: "REC" },
  ]);
});

test("page URL carries fixed scope, stage, page and size", () => {
  const url = buildPageUrl({ endpoint: "prodHistory", stage: "REC" }, { from: "2026-01-01", to: "2026-01-07" }, 2);
  assert.equal(url.searchParams.get("companyCode"), "EDGEHOME");
  assert.equal(url.searchParams.get("stageCode"), "REC");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("size"), "200");
});

test("page validation refuses raw arrays and returned-stage mismatch", () => {
  assert.throws(() => validatePage([], 0, { endpoint: "orderHistory", stage: null }), /paged envelope/);
  assert.throws(() => validatePage(page(0, [{ stageCode: "ISS" }]), 0,
    { endpoint: "prodHistory", stage: "REC" }), /stage other than requested/);
  assert.doesNotThrow(() => validatePage(page(0, [{ stageCode: "iss" }]), 0,
    { endpoint: "prodHistory", stage: "ISS" }));
});

test("completion requires every contiguous page and agreeing totals", () => {
  const pages = [page(0, [{ id: 1 }], { last: false, totalElements: 2, totalPages: 2 }),
    page(1, [{ id: 2 }], { last: true, totalElements: 2, totalPages: 2 })];
  assert.deepEqual(verifyCompletePages(pages, { endpoint: "orderHistory", stage: null }), { rows: 2, pages: 2 });
  assert.throws(() => verifyCompletePages(pages.slice(0, 1), { endpoint: "orderHistory", stage: null }), /terminal page/);
  assert.deepEqual(verifyCompletePages([page(0, [], { totalElements: 0, totalPages: 0 })],
    { endpoint: "orderHistory", stage: null }), { rows: 0, pages: 1 });
});

test("wire HTTP 400 is permanent even when the body claims status 500", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 400, text: async () => JSON.stringify({ status: 500,
      message: "fromDate and toDate must be within 7 days (inclusive)" }) };
  };
  await assert.rejects(() => fetchPage(new URL("https://example.invalid/prodHistory"), "fixture", fetchImpl), /wire HTTP 400/);
  assert.equal(calls, 1);
});

test("production tripwire ignores last-field fan-out and counts business-field disagreements", () => {
  const base = { prodOrderNo: 10, prodLineSeq: 2, itemNo: "A", prepackItemNo: "B", prodOrderQty: 4 };
  assert.deepEqual(productionDuplicateTripwire([{ ...base, lastProdCost: 1 }, { ...base, lastProdCost: 2 }]),
    { ambiguousGroups: 0 });
  assert.deepEqual(productionDuplicateTripwire([base, { ...base, prodOrderQty: 5 }]),
    { ambiguousGroups: 1 });
});

test("capture resumes saved pages and writes newly fetched pages atomically", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "coldlion-history-test-"));
  const scope = { endpoint: "orderHistory", stage: null };
  const window = { from: "2026-01-01", to: "2026-01-07" };
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const number = Number(url.searchParams.get("page"));
    const payload = number === 0
      ? page(0, [{ id: 1 }], { last: false, totalElements: 2, totalPages: 2 })
      : page(1, [{ id: 2 }], { last: true, totalElements: 2, totalPages: 2 });
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  assert.deepEqual(await captureScope({ outputDir, scope, window, apiKey: "fixture", fetchImpl }), { rows: 2, pages: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(await captureScope({ outputDir, scope, window, apiKey: "fixture", fetchImpl }), { rows: 2, pages: 2 });
  assert.equal(calls, 2, "resume must not repeat completed page requests");
  const saved = JSON.parse(await readFile(join(outputDir, "orderHistory", "2026-01-01_2026-01-07", "page-00001.json"), "utf8"));
  assert.equal(saved.last, true);
});
