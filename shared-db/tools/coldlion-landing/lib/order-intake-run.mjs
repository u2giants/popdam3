// One scanned window, end to end, for the order-intake poll (plan §9 B1).
//
// Mirrors loadWindowScope's shape but replaces the ENTIRE sealed machinery: no
// window_ledger, no page evidence, no sealing. The staging transaction is
// buildIntakeStageSql; the failure recorder is the SIBLING that never touches
// the ledger (recordFailure() itself would mark sealed rows state='failed').

import { randomUUID } from "node:crypto";
import { fetchWindowScope, REQUEST_PAUSE_MS } from "./http.mjs";
import { projectOrderHistoryWindow } from "./project-order-history.mjs";
import { ORDER_HISTORY, PAGE_SIZE } from "./scopes.mjs";
import { buildIntakeFailureSql, buildIntakeStageSql } from "./order-intake-stage.mjs";
import { isClientSpawnFault, runSql } from "./db.mjs";

/**
 * Bound one window's projection to the first `maxOrders` DISTINCT sales orders
 * (round-2 review H-2): --limit must bound the rows WRITTEN, and a bound checked
 * only between windows leaves the first window unbounded. Slicing happens BEFORE
 * any SQL is built, so a --limit 5 dispatch stages at most 5 orders' lines and
 * components per window no matter how many the window contains. The skipped
 * orders are simply not staged yet; staging is idempotent and the next dispatch
 * (or an unbounded run) picks them up. Components whose parent line was cut are
 * cut with it. Returns { projected, sliced, ordersKept }.
 */
export function sliceProjection(projected, maxOrders) {
  if (maxOrders === null || maxOrders === undefined) {
    return { projected, sliced: false, ordersKept: projected.lines.length ? new Set(projected.lines.map((line) => line.sales_order_no)).size : 0 };
  }
  const kept = new Set();
  for (const line of projected.lines) {
    if (kept.size >= maxOrders && !kept.has(line.sales_order_no)) continue;
    kept.add(line.sales_order_no);
  }
  const lines = projected.lines.filter((line) => kept.has(line.sales_order_no));
  const lineIds = new Set(lines.map((line) => line.localId));
  const components = projected.components.filter((component) => lineIds.has(component.lineLocalId));
  const sliced = lines.length !== projected.lines.length;
  return {
    projected: sliced
      ? { ...projected, lines, components }
      : projected,
    sliced,
    ordersKept: kept.size,
  };
}

export async function stageIntakeWindow({
  window,
  track,
  apiKey,
  companyCode,
  pageSize = PAGE_SIZE,
  fetchImpl = fetch,
  execute = runSql,
  dryRun = false,
  maxStageOrders = null,
}) {
  const runId = randomUUID();
  const startedAt = new Date();
  try {
    const fetched = await fetchWindowScope({
      scope: ORDER_HISTORY, // ORDER_HISTORY only — never allScopes(), no stageCode on this path
      window,
      apiKey,
      companyCode,
      size: pageSize,
      fetchImpl,
      // The repo-standard pause, passed EXPLICITLY so the vendor agreement is a
      // visible fact of this call, not a default two files away (lib/http.mjs:19;
      // never below 2000 ms — plan §8 serial-pause rule).
      pauseMs: REQUEST_PAUSE_MS,
    });
    const rows = fetched.pages.flatMap((page) => page.content);
    const fetchedAt = fetched.pages.at(-1).fetchedAt;
    const full = projectOrderHistoryWindow(rows, { runId, fetchedAt });
    // --limit bounds the STAGED work at order granularity, before any SQL exists.
    const { projected, sliced, ordersKept } = sliceProjection(full, maxStageOrders);

    const finishedAt = new Date();
    const sql = buildIntakeStageSql({
      runId,
      window,
      track,
      projected,
      companyCode,
      pageSize,
      completion: {
        rows: fetched.rows,
        reportedTotalElements: fetched.reportedTotalElements,
        reportedTotalPages: fetched.reportedTotalPages,
        lastPageNumber: fetched.lastPageNumber,
        pages: fetched.pages.length,
        httpStatus: fetched.pages.at(-1).httpStatus,
        bodyStatus: fetched.pages.at(-1).bodyStatus,
      },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.valueOf() - startedAt.valueOf(),
      notes: [
        `lines=${projected.lines.length}`,
        `components=${projected.components.length}`,
        `excludedEp001=${projected.excludedEp001}`,
        `cardinalityMismatches=${projected.cardinalityMismatches}`,
        `versionFanOut=${projected.versionFanOut}`,
        ...(sliced ? [`limitSlicedOrders=${ordersKept}`] : []),
      ].join(" "),
      dryRun,
    });

    let staged = { lines_inserted: 0, lines_updated: 0, components_inserted: 0, components_updated: 0, new_orders: 0, new_order_numbers: "" };
    if (!dryRun) {
      const output = execute(sql, {});
      staged = parseStageSummary(output);
    }
    // else (round-3 L-2, disclosed): a dry run stages nothing, so every count
    // above stays zero BY DESIGN — including the staged-row totals the forward
    // stop rule consumes, which is why a dry run's forward scan stops after two
    // all-zero months and previews a far smaller window set than a live run.
    // It previews the wiring and the windows it TOUCHES, never the live cost.
    return {
      runId,
      window,
      track,
      fetched: { rows: fetched.rows, pages: fetched.pages.length },
      excludedEp001: full.excludedEp001,
      sliced,
      ordersKept,
      ...staged,
      sql, // returned so a dry run can be inspected without executing it
    };
  } catch (error) {
    // The sibling differs from recordFailure() ONLY in never touching the window
    // ledger — and it keeps recordFailure's other discipline too: a client-side
    // spawn fault (psql missing, EPIPE) says nothing about the data or the
    // database and must not be recorded as a database failure or raise the
    // coldlion_sync_alert (lib/db.mjs:162's exact rule).
    if (!dryRun && !isClientSpawnFault(error)) {
      try {
        execute(buildIntakeFailureSql({ runId, window, track, companyCode, error, startedAt: startedAt.toISOString() }), {});
      } catch (recordError) {
        error.message = `${error.message} (and the failure could not be recorded: ${recordError.message})`;
      }
    }
    throw error;
  }
}

/**
 * Parse the staging transaction's summary row as runSql's psql ACTUALLY prints
 * it: default ALIGNED format — a two-line header, a `---+---` rule, the data
 * row with `|` separators, and a `(1 row)` footer (db.mjs spawns psql with
 * --quiet but no \pset; only queryRows switches to unaligned/tabbed, and this
 * transaction is a multi-statement script, not a single read). The parser
 * accepts the tab-separated shape too (same summary via queryRows-style
 * settings) and refuses anything it cannot read — a NaN count here would
 * silently break the forward-scan stop rule downstream.
 */
export function parseStageSummary(output) {
  const rows = String(output ?? "")
    .split(/\r?\n/)
    // Only strip line ends here, not the whole line: an EMPTY final column
    // (new_order_numbers on a no-new-orders window) renders as trailing
    // whitespace, and trimming the row before splitting would delete that
    // column and make every quiet window look unparseable.
    .filter((row) => row.trim().length > 0 && !/^begin;?$/i.test(row.trim()) && !/^commit;?$/i.test(row.trim()) && !/^rollback;?$/i.test(row.trim()));
  const candidates = [];
  for (const row of rows) {
    const fields = row.includes("\t") ? row.split("\t") : row.split("|");
    const trimmed = fields.map((field) => field.trim());
    // The data row: six fields, the first five plain integers (new_order_numbers
    // may be empty). The header row and the `(1 row)` footer both fail this.
    if (trimmed.length === 6 && trimmed.slice(0, 5).every((field) => /^\d+$/.test(field))) candidates.push(trimmed);
  }
  const data = candidates.at(-1);
  if (!data) {
    throw new Error(
      "the staging transaction returned no parseable summary row (expected 6 columns: " +
        "lines_inserted, lines_updated, components_inserted, components_updated, new_orders, new_order_numbers)",
    );
  }
  return {
    lines_inserted: Number(data[0]),
    lines_updated: Number(data[1]),
    components_inserted: Number(data[2]),
    components_updated: Number(data[3]),
    new_orders: Number(data[4]),
    new_order_numbers: String(data[5] ?? ""),
  };
}
