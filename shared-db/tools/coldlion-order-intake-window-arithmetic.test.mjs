// Offline tests for the ColdLion order-intake window arithmetic
// (plan_coldlion_order_intake.md §9 B1 / Phase E). No secrets, no database.

import test from "node:test";
import assert from "node:assert/strict";

import {
  trailingWindows,
  forwardWindows,
  forwardCapDate,
  forwardStopReached,
  recordStagedWindow,
  closesStagedMonth,
  FORWARD_EMPTY_MONTH_STOP,
  FORWARD_HARD_CAP_MONTHS,
} from "./coldlion-landing/lib/order-intake-windows.mjs";
import { windowContaining } from "./coldlion-landing/lib/grid.mjs";

function collectForward(asOfIso) {
  return [...forwardWindows(asOfIso)];
}

test("the trailing track is the last three closed windows plus the OPEN current week, oldest first", () => {
  const asOf = "2026-09-28";
  const windows = trailingWindows(asOf);
  assert.equal(windows.length, 4);
  const current = windowContaining(asOf);
  // The first three are the closed windows immediately before the current one.
  assert.equal(windows[2].index, current.index - 1);
  assert.equal(windows[3].index, current.index);
  // Oldest first, contiguous on the fixed seven-day grid.
  for (let i = 1; i < windows.length; i += 1) {
    assert.equal(windows[i].index, windows[i - 1].index + 1);
  }
  // Inclusive seven-day windows (from + 6 days = to).
  for (const w of windows) {
    assert.equal(new Date(`${w.to}T00:00:00Z`) - new Date(`${w.from}T00:00:00Z`), 6 * 86_400_000);
  }
});

test("the trailing track clamps to the available closed windows near the grid anchor, and refuses before any closed window exists", () => {
  // 2019-01-15 sits in grid window 2, so exactly windows 0 and 1 have closed.
  const windows = trailingWindows("2019-01-15");
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.at(-1), windowContaining("2019-01-15"));
  // Inside the very first grid window nothing has closed; the sealed-window rule
  // that only closed windows count has no trailing track to offer.
  assert.throws(() => trailingWindows("2019-01-03"), /no seven-day window has closed yet/);
});

test("the forward track starts at the grid window AFTER today's and never includes it", () => {
  const asOf = "2026-09-28";
  const forward = collectForward(asOf);
  assert.equal(forward[0].index, windowContaining(asOf).index + 1);
  assert.ok(forward.every((w) => w.index > windowContaining(asOf).index));
});

test("the forward track is capped 18 calendar months out (the plan's bounded-cost decision)", () => {
  const asOf = "2026-09-28";
  assert.equal(forwardCapDate(asOf), "2028-03-01"); // September 2026 + 18 calendar months
  const forward = collectForward(asOf);
  assert.equal(forward.at(-1).from <= "2028-03-01", true);
  // The first window PAST the cap is excluded entirely.
  assert.equal(forward.at(-1).index, windowContaining("2028-03-01").index);
  assert.equal(FORWARD_HARD_CAP_MONTHS, 18);
});

test("the empty-month stop rule: two consecutive zero-STAGED from_date months stop the scan", () => {
  assert.equal(FORWARD_EMPTY_MONTH_STOP, 2);
  const counters = {};
  // October staged rows; November and December staged nothing -> stop.
  recordStagedWindow(counters, { from: "2026-10-02" }, 12);
  assert.equal(forwardStopReached(counters), false);
  recordStagedWindow(counters, { from: "2026-11-06" }, 0);
  assert.equal(forwardStopReached(counters), false);
  recordStagedWindow(counters, { from: "2026-12-04" }, 0);
  assert.equal(forwardStopReached(counters), true);
});

test("fetched-but-not-staged or EP001-excluded rows never satisfy an empty month — only staged counts are fed in", () => {
  // The runner records ONLY staged rows into the counters; a month with fetched rows
  // but zero staged rows is still empty for the rule. Conversely any staged row
  // keeps its month non-empty even after two later empty months were NOT yet reached.
  const counters = {};
  recordStagedWindow(counters, { from: "2027-01-01" }, 1);
  recordStagedWindow(counters, { from: "2027-02-05" }, 0);
  assert.equal(forwardStopReached(counters), false);
  // A straddling grid window belongs to the month of its from_date only.
  const straddle = { from: "2027-03-28", to: "2027-04-03" };
  recordStagedWindow(counters, straddle, 5);
  assert.equal(counters["2027-04"], undefined);
  assert.equal(counters["2027-03"], 5);
});

test("the stop rule judges the TWO NEWEST observed months, sorted by month key, never by insertion order", () => {
  // The runner observes months in scan order, so observed months are consecutive in
  // real use; the rule itself only sorts the keys and inspects the newest two.
  const counters = { "2027-05": 7, "2027-03": 0, "2027-04": 0 };
  // Newest two months are 2027-04 (0) and 2027-05 (7): not a stop.
  assert.equal(forwardStopReached(counters), false);
  counters["2027-05"] = 0;
  // Newest two are now 2027-04 (0) and 2027-05 (0): stop, regardless of the older
  // empty 2027-03 and regardless of the order keys were inserted.
  assert.equal(forwardStopReached(counters), true);
});

test("a month is only complete at its LAST window: closesStagedMonth marks month boundaries", () => {
  // A month holding 4-5 grid windows is only known zero-staged after its final
  // window; stopping mid-month would skip that month's remaining windows and the
  // orders in them. The scan evaluates the stop rule ONLY where this is true.
  const octA = { from: "2026-10-02", to: "2026-10-08" };
  const octB = { from: "2026-10-09", to: "2026-10-15" };
  const nov = { from: "2026-11-06", to: "2026-11-12" };
  // Mid-month: the next window is still October -> NOT a boundary.
  assert.equal(closesStagedMonth(octA, octB), false);
  // Month boundary: the next window starts November.
  assert.equal(closesStagedMonth(octB, nov), true);
  // The scan's end (18-month cap) completes the final month by definition.
  assert.equal(closesStagedMonth(nov, null), true);
  assert.equal(closesStagedMonth(nov, undefined), true);
});

test("the stop rule never fires mid-month when windows within one month stage rows later", () => {
  // October has two scanned windows; the first stages nothing, the second stages
  // rows. A per-window stop rule would have stopped inside October and skipped
  // the second window's orders; evaluating only at closesStagedMonth keeps
  // October non-empty.
  const octA = { from: "2026-10-02", to: "2026-10-08" };
  const octB = { from: "2026-10-09", to: "2026-10-15" };
  const nov = { from: "2026-11-06", to: "2026-11-12" };
  const counters = {};
  recordStagedWindow(counters, octA, 0);
  // Not a month boundary -> the rule is not evaluated -> no stop.
  assert.equal(closesStagedMonth(octA, octB), false);
  recordStagedWindow(counters, octB, 4);
  assert.equal(counters["2026-10"], 4);
  // At October's boundary the month is correctly non-empty.
  assert.equal(closesStagedMonth(octB, nov) && forwardStopReached(counters), false);
});
