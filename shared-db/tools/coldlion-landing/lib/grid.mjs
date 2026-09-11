// The fixed seven-day window grid, anchored at 2019-01-01.
//
// This is not a scheduling preference. ColdLion refuses any fromDate/toDate span wider
// than seven days INCLUSIVE, and both coldlion.window_ledger and
// coldlion.history_page_ledger carry a CHECK that (window_from - 2019-01-01) % 7 = 0.
// A window computed off any other anchor is refused by the database, not silently
// misfiled — which is the point of anchoring it here in one place.

export const GRID_ANCHOR = "2019-01-01";
const DAY_MS = 86_400_000;

export function parseIsoDate(value, name = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a real calendar date`);
  }
  return date;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Days from the grid anchor. Negative for dates before it. */
export function daysFromAnchor(isoValue) {
  const anchor = parseIsoDate(GRID_ANCHOR, "anchor");
  return Math.round((parseIsoDate(isoValue, "date").valueOf() - anchor.valueOf()) / DAY_MS);
}

/** The window that CONTAINS the given date, snapped down onto the grid. */
export function windowContaining(isoValue) {
  const offset = daysFromAnchor(isoValue);
  if (offset < 0) {
    throw new Error(`${isoValue} is before the fixed grid anchor ${GRID_ANCHOR}`);
  }
  return windowAtIndex(Math.floor(offset / 7));
}

export function windowAtIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("window index must be a non-negative integer");
  }
  const anchor = parseIsoDate(GRID_ANCHOR, "anchor");
  const from = new Date(anchor.valueOf() + index * 7 * DAY_MS);
  const to = new Date(from.valueOf() + 6 * DAY_MS);
  return { index, from: isoDate(from), to: isoDate(to) };
}

/**
 * Windows from `fromIso` up to and including the window containing `toIso`.
 * Oldest first — a backfill that starts at the oldest window can be resumed from the
 * ledger without recomputing where it stopped.
 */
export function* windowRange(fromIso, toIso) {
  const first = windowContaining(fromIso).index;
  const last = windowContaining(toIso).index;
  if (last < first) throw new Error("the `to` window precedes the `from` window");
  for (let index = first; index <= last; index += 1) yield windowAtIndex(index);
}

/**
 * The index of the newest window that has FINISHED.
 *
 * The window containing `asOfIso` is still open: rows written on any of its remaining
 * days have not been sent yet. That matters here far more than it looks, because a
 * window is sealed the moment it is loaded -- the ledger declines it, and the database
 * forbids adding page evidence to it afterwards -- so a window fetched on day one of its
 * seven is a permanently incomplete week that the ledger will nonetheless report as
 * complete. Only closed windows may be loaded.
 */
export function lastClosedWindowIndex(asOfIso) {
  const current = windowContaining(asOfIso).index;
  if (current === 0) {
    throw new Error(`no seven-day window has closed yet as of ${asOfIso}`);
  }
  return current - 1;
}

/**
 * The `count` windows ending with the window that CONTAINS `toIso`, oldest first.
 *
 * `toIso` names a window to LOAD; it is not an "as of" moment. The two readings differ by
 * exactly one window, and the difference is not cosmetic: feeding a date that has already
 * been clamped onto a closed window into an "as of" selector classifies that closed window
 * as the current one and drops it, so the week the scheduled run exists to pick up is the
 * one week it never loads. The caller is responsible for having clamped `toIso` to a
 * window that has closed.
 */
export function windowsEndingAt(toIso, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--windows must be a positive integer");
  }
  const last = windowContaining(toIso).index;
  const first = Math.max(0, last - count + 1);
  const windows = [];
  for (let index = first; index <= last; index += 1) windows.push(windowAtIndex(index));
  return windows;
}

/** The N most recent CLOSED windows as of `asOfIso`, oldest first. */
export function recentClosedWindows(asOfIso, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--windows must be a positive integer");
  }
  return windowsEndingAt(windowAtIndex(lastClosedWindowIndex(asOfIso)).to, count);
}
