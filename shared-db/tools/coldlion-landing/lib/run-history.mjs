// The shared history run: fetch one window+scope to completion, project it, load it in
// one transaction, and move on. Both CLIs are thin argument parsers over this.
//
// Nothing here prints a source row. Progress is counts, scopes and window dates only —
// this repository is public and ColdLion payloads are not ours to publish.

import { randomUUID } from "node:crypto";
import { fetchWindowScope } from "./http.mjs";
import { buildOrderHistoryLoadSql, buildProdHistoryLoadSql } from "./load-window.mjs";
import { projectOrderHistoryWindow } from "./project-order-history.mjs";
import { projectProdHistoryWindow } from "./project-prod-history.mjs";
import { COMPANY_CODE, PAGE_SIZE, allScopes, scopeLabel } from "./scopes.mjs";
import { queryRows, recordFailure, runSql } from "./db.mjs";
import { sqlText } from "./values.mjs";

export { allScopes, scopeLabel };

/** Windows already proven loaded, so a resumed backfill skips them instead of refusing them. */
/**
 * The resume read, as text. Separated so the literal it builds can be proven offline:
 * an interpolated company code is the one place this read could be altered by its own
 * argument.
 */
export function loadedWindowsSql(companyCode = COMPANY_CODE) {
  return `select endpoint, coalesce(stage_code, ''), to_char(window_from, 'YYYY-MM-DD')
       from coldlion.window_ledger
      where company_code = ${sqlText(companyCode)} and state = 'loaded';`;
}

export function loadedWindows({ companyCode = COMPANY_CODE, options = {} } = {}) {
  const rows = queryRows(loadedWindowsSql(companyCode), options);
  return new Set(rows.map(([endpoint, stage, from]) => `${endpoint}|${stage}|${from}`));
}

export function ledgerKey(scope, window) {
  return `${scope.endpoint}|${scope.stage ?? ""}|${window.from}`;
}

/**
 * One window, one scope, end to end.
 *
 * A permanent vendor refusal and a projection failure are both TERMINAL: they are
 * recorded, alerted and rethrown rather than retried, because retrying a self-inflicted
 * input error forever is exactly the failure mode the vendor's malformed error contract
 * invites.
 */
/**
 * Does the target's coldlion.order_history_line carry all four ColdLion stamp columns
 * (migration 20261009170724) with the expected types? All four or none: a partial set
 * is refused rather than guessed around.
 */
export function orderStampColumnsSql() {
  return `select count(*) filter (where (a.attname, format_type(a.atttypid, a.atttypmod)) in
           (('created_time', 'timestamp with time zone'), ('created_user', 'text'),
            ('mod_time', 'timestamp with time zone'), ('mod_user', 'text'))),
         count(*) filter (where a.attname in ('created_time', 'created_user', 'mod_time', 'mod_user'))
    from pg_attribute a
   where a.attrelid = 'coldlion.order_history_line'::regclass and a.attnum > 0 and not a.attisdropped;`;
}

export function interpretOrderStampColumns(rows) {
  const [typed, named] = (rows[0] ?? []).map(Number);
  if (typed === 4 && named === 4) return true;
  if (named === 0) return false;
  throw new Error(
    `coldlion.order_history_line carries ${named} of the 4 ColdLion stamp columns (${typed} with the expected type); refusing to load until migration 20261009170724 is applied whole`,
  );
}

const stampColumnsByTarget = new Map();
export function hasOrderStampColumns(dbOptions = {}, query = queryRows) {
  const key = dbOptions.url ?? process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
  if (!stampColumnsByTarget.has(key)) {
    stampColumnsByTarget.set(key, interpretOrderStampColumns(query(orderStampColumnsSql(), dbOptions)));
  }
  return stampColumnsByTarget.get(key);
}

export async function loadWindowScope({
  scope,
  window,
  apiKey,
  companyCode = COMPANY_CODE,
  pageSize = PAGE_SIZE,
  requestedBy,
  isBackfillBaseline = false,
  dbOptions = {},
  fetchImpl = fetch,
  execute = runSql,
  orderStampColumns,
}) {
  const runId = randomUUID();
  const startedAt = new Date();
  try {
    const fetched = await fetchWindowScope({
      scope,
      window,
      apiKey,
      companyCode,
      size: pageSize,
      fetchImpl,
    });
    const rows = fetched.pages.flatMap((page) => page.content);
    const fetchedAt = fetched.pages.at(-1).fetchedAt;
    const completion = {
      rows: fetched.rows,
      reportedTotalElements: fetched.reportedTotalElements,
      reportedTotalPages: fetched.reportedTotalPages,
      lastPageNumber: fetched.lastPageNumber,
    };

    const common = {
      window,
      scope,
      runId,
      requestedBy,
      companyCode,
      pageSize,
      pages: fetched.pages,
      completion,
      startedAt: startedAt.toISOString(),
    };

    let sql;
    let summary;
    if (scope.stage) {
      const projected = projectProdHistoryWindow(rows, {
        runId,
        fetchedAt,
        requestedStage: scope.stage,
        // The observation timestamp retention orders by is the FETCH time of this
        // window, not "now": two windows loaded in one session must not be ordered by
        // which one the loader happened to reach first.
        observedAt: fetchedAt,
        isBackfillBaseline,
      });
      summary = {
        lines: projected.lines.length,
        components: projected.components.length,
        lastLookups: projected.lastLookups.length,
        asserted: projected.assertableLineIds.length,
        excludedEp001: projected.excludedEp001,
      };
      sql = buildProdHistoryLoadSql({
        ...common,
        projected,
        ...finish(startedAt),
        notes: notesFor(summary),
      });
    } else {
      const projected = projectOrderHistoryWindow(rows, { runId, fetchedAt });
      summary = {
        lines: projected.lines.length,
        components: projected.components.length,
        invoiceRefs: projected.invoiceRefs.length,
        pickTicketRefs: projected.pickTicketRefs.length,
        cardinalityMismatches: projected.cardinalityMismatches,
        versionFanOut: projected.versionFanOut,
        excludedEp001: projected.excludedEp001,
      };
      sql = buildOrderHistoryLoadSql({
        ...common,
        projected,
        ...finish(startedAt),
        notes: notesFor(summary),
        stampColumns: orderStampColumns ?? hasOrderStampColumns(dbOptions),
      });
    }

    execute(sql, dbOptions);
    return { runId, window, scope, fetched: completion, summary };
  } catch (error) {
    try {
      recordFailure({ scope, window, runId, companyCode, requestedBy, error, options: dbOptions });
    } catch (recordError) {
      // A failure we could not even record is worse than the original, so say both.
      error.message = `${error.message} (and the failure could not be recorded: ${recordError.message})`;
    }
    throw error;
  }
}

function finish(startedAt) {
  const finishedAt = new Date();
  return {
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.valueOf() - startedAt.valueOf(),
  };
}

/**
 * The window's own arithmetic, in the run record. The EP001 exclusion in particular is
 * counted rather than silent: page evidence records what the vendor sent, so any gap
 * between fetched and landed rows must have a stated cause.
 */
export function notesFor(summary) {
  return Object.entries(summary)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
}
