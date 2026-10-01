// Window arithmetic for the ColdLion order-intake poll (plan_coldlion_order_intake.md §8/§9 B1).
//
// The intake deliberately does NOT use the sealed-window machinery: it re-reads a
// trailing window and scans forward, upserting unsealed staging rows. Detection is
// salesOrderNo novelty, never a date cursor — the feed carries no created timestamp
// (live-verified 2026-09-17), and newly entered orders normally carry FUTURE ERP
// start dates, so the window filter (which keys on the ERP start date) only sees
// them in forward windows.
//
// Locked design (Albert 2026-09-17, "API calls are cheap; never economise call
// volume at the cost of missing data"): the forward scan stops after two
// consecutive from_date-months that STAGE zero new rows — not fetched, not
// EP001-excluded; staged. The 18-month hard cap below is this plan's own
// bounded-cost decision, NOT part of the ruling: an order whose ERP startDate lies
// beyond the cap is missed by design until a later forward scan reaches it as
// today advances. Both constants live here and nowhere else.

import { windowAtIndex, windowContaining, lastClosedWindowIndex, parseIsoDate, isoDate } from "./grid.mjs";

export const TRAILING_CLOSED_WINDOWS = 3;
export const FORWARD_EMPTY_MONTH_STOP = 2;
export const FORWARD_HARD_CAP_MONTHS = 18;


/** The trailing track: the last N closed grid windows plus the OPEN current week, oldest first. */
export function trailingWindows(asOfIso, { closedCount = TRAILING_CLOSED_WINDOWS } = {}) {
  const current = windowContaining(asOfIso);
  const lastClosed = lastClosedWindowIndex(asOfIso);
  const first = Math.max(0, lastClosed - closedCount + 1);
  const windows = [];
  for (let index = first; index <= lastClosed; index += 1) windows.push(windowAtIndex(index));
  windows.push(current);
  return windows;
}

function monthOf(isoValue) {
  return isoValue.slice(0, 7);
}

/**
 * The forward horizon's hard boundary: no scanned window's from_date may exceed
 * asOf + FORWARD_HARD_CAP_MONTHS (calendar months).
 */
export function forwardCapDate(asOfIso) {
  const asOf = parseIsoDate(asOfIso, "asOf");
  const total = asOf.getUTCFullYear() * 12 + asOf.getUTCMonth() + FORWARD_HARD_CAP_MONTHS;
  // The first day of the month FORWARD_HARD_CAP_MONTHS after asOf's month.
  return isoDate(new Date(Date.UTC(Math.floor(total / 12), total % 12, 1)));
}

/**
 * Enumerate the forward track: the grid window AFTER the one containing asOf, then
 * every following grid window, oldest first, up to the 18-month cap. The empty-month
 * stop rule is NOT applied here — it depends on how many rows each window STAGED,
 * which only the caller knows. Use {@link forwardStopReached} to apply it.
 */
export function* forwardWindows(asOfIso) {
  const cap = forwardCapDate(asOfIso);
  for (let index = windowContaining(asOfIso).index + 1; ; index += 1) {
    const window = windowAtIndex(index);
    if (window.from > cap) return;
    yield window;
  }
}

/**
 * The settled stop rule: two CONSECUTIVE from_date-months staging zero new rows.
 * A grid window straddles month boundaries; a window belongs to the month of its
 * from_date. Only STAGED rows count — fetched-but-excluded (EP001) or fetched-only
 * rows never satisfy an empty month.
 *
 * `stagedByMonth` maps 'YYYY-MM' -> staged row count for months already observed.
 * Returns true when the two most recent observed months are both zero. Evaluate
 * it ONLY when a month is complete — see {@link closesStagedMonth}: a month with
 * 4-5 grid windows is only known to be zero-staged after its LAST window, and
 * stopping mid-month would skip that month's remaining windows (and the orders
 * in them), contradicting "never economise call volume at the cost of missing
 * data".
 */
export function forwardStopReached(stagedByMonth) {
  const months = Object.keys(stagedByMonth).sort();
  if (months.length < FORWARD_EMPTY_MONTH_STOP) return false;
  const last = months.slice(-FORWARD_EMPTY_MONTH_STOP);
  return last.every((month) => (stagedByMonth[month] ?? 0) === 0);
}

/**
 * NOTE: the FIRST forward month can be partial by design: the scan starts at
 * the window after today's, so that month's earlier windows are past data
 * covered by the trailing track and the sealed sync, not windows the forward
 * scan owes. Its staged total legitimately reflects only the future part.
 *
 * True when `window` is the LAST forward-scan window of its from_date month —
 * i.e. the next window (if any) starts a different month. `nextWindow` null/undefined
 * means the scan ended (18-month cap), so the final month is complete by
 * definition. This is the only point at which forwardStopReached may be
 * evaluated for the months including `window`.
 */
export function closesStagedMonth(window, nextWindow) {
  if (!nextWindow) return true;
  return monthOf(nextWindow.from) !== monthOf(window.from);
}

/** Record one window's staged count into the month counters (window -> month of from_date). */
export function recordStagedWindow(stagedByMonth, window, stagedRows) {
  const month = monthOf(window.from);
  stagedByMonth[month] = (stagedByMonth[month] ?? 0) + stagedRows;
  return stagedByMonth;
}
