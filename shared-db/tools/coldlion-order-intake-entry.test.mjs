// Offline tests for the ColdLion order-intake ENTRY POINT
// (tools/coldlion-landing/order-intake.mjs — plan §9 B1). No secrets, no
// database, no network: the entry point now runs main() only when executed
// directly (round-4 L-4), so these tests import it safely and pin the contract
// round-4 H-1 showed had no guard: stageIntakeWindow returns parseStageSummary's
// SNAKE_CASE keys (the SQL column names) and the entry point folds them into
// its camelCase summary through exported helpers — a wrong key name used to
// fold undefined into NaN, and NaN ?? 0 is still NaN, silently killing the
// forward stop rule with no throw (§11 forbids silent failures).

import test from "node:test";
import assert from "node:assert/strict";

import { foldWindowResult, stagedRowCount, parseArgs } from "./coldlion-landing/order-intake.mjs";

// Exactly the shape stageIntakeWindow returns on a live window
// (lib/order-intake-run.mjs: parseStageSummary keys + the wrapper fields).
const windowResult = {
  runId: "11111111-2222-3333-4444-555555555555",
  window: { from: "2026-10-01", to: "2026-10-07" },
  track: "forward",
  fetched: { rows: 7, pages: 1 },
  excludedEp001: 1,
  sliced: false,
  ordersKept: 2,
  lines_inserted: 3,
  lines_updated: 1,
  components_inserted: 4,
  components_updated: 2,
  new_orders: 1,
  new_order_numbers: "47001",
  sql: "begin; commit;",
};

const zeroSummary = () => ({
  windows: 0,
  rowsFetched: 0,
  linesInserted: 0,
  linesUpdated: 0,
  componentsInserted: 0,
  componentsUpdated: 0,
  newOrders: 0,
  newOrderNumbers: [],
  stagedOrders: 0,
});

test("foldWindowResult reads the stager's SNAKE_CASE keys into the summary — a camelCase misread folds NaN (round-4 H-1 pin)", () => {
  const summary = foldWindowResult(zeroSummary(), windowResult);
  assert.equal(summary.windows, 1);
  assert.equal(summary.stagedOrders, 2);
  assert.equal(summary.rowsFetched, 7);
  assert.equal(summary.linesInserted, 3);
  assert.equal(summary.linesUpdated, 1);
  assert.equal(summary.componentsInserted, 4);
  assert.equal(summary.componentsUpdated, 2);
  assert.equal(summary.newOrders, 1);
  assert.deepEqual(summary.newOrderNumbers, ["47001"]);
  // The stop-rule feed: every folded field must be a finite number. This is
  // the assertion that failed silently for three review rounds.
  for (const [field, value] of Object.entries(summary)) {
    if (Array.isArray(value)) continue;
    assert.ok(Number.isFinite(value), `summary.${field} folded to non-finite ${value}`);
  }
});

test("foldWindowResult is accumulative and splits the new-order numbers list", () => {
  const summary = zeroSummary();
  foldWindowResult(summary, windowResult);
  foldWindowResult(summary, { ...windowResult, new_orders: 0, new_order_numbers: "", ordersKept: 1, lines_inserted: 2 });
  assert.equal(summary.windows, 2);
  assert.equal(summary.linesInserted, 5);
  assert.equal(summary.newOrders, 1);
  assert.deepEqual(summary.newOrderNumbers, ["47001"]);
});

test("stagedRowCount sums the four snake_case staged counts (the forward stop rule's per-month feed)", () => {
  assert.equal(stagedRowCount(windowResult), 10);
  // The dry-run zero object (lib/order-intake-run.mjs) is all-zero, so a dry
  // run's months record real zeros — the disclosed preview behaviour.
  assert.equal(
    stagedRowCount({
      lines_inserted: 0,
      lines_updated: 0,
      components_inserted: 0,
      components_updated: 0,
      new_orders: 0,
      new_order_numbers: "",
    }),
    0,
  );
});

test("parseArgs keeps its contract: --limit/--today validation and flags", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, claimOnly: false, limit: null, today: null });
  assert.deepEqual(parseArgs(["--dry-run", "--limit", "5"]), { dryRun: true, claimOnly: false, limit: 5, today: null });
  assert.deepEqual(parseArgs(["--claim-only"]), { dryRun: false, claimOnly: true, limit: null, today: null });
  assert.equal(parseArgs(["--today", "2026-10-01"]).today, "2026-10-01");
});

test("importing the entry point does not run the poll (round-4 L-4 pin: main() only on direct execution)", () => {
  // This test file exists only because the import at the top is side-effect
  // free: reaching this line proves the module did not call main() (which
  // would exit 2 here — no COLDLION_API_KEY in the test environment).
  assert.ok(true);
});
