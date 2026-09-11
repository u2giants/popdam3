// ColdLion HTTP, with the two vendor behaviours that break naive loaders.
//
// 1. THE MALFORMED ERROR CONTRACT. A refused history request arrives as HTTP 400 ON THE
//    WIRE while the JSON body says "status": 500 / "error": "Internal Server Error". A
//    loader that trusts the body classifies a permanent, self-inflicted input error as a
//    transient server fault and retries it forever. We branch on the WIRE status and we
//    record both, because the pair is evidence of the vendor's contract.
//
// 2. THE SILENT PAGE CAP. A requested size=2000 comes back as size=200 in the envelope
//    with no error. So `requested_page_size` and `returned_page_size` are carried
//    separately all the way into the ledger, and completion is proven page by page.
//
// Nothing here logs a source row. Errors carry the URL path and status only.

import { COMPANY_CODE, PAGE_SIZE } from "./scopes.mjs";

export const COLDLION_BASE_URL = "http://x5.coldlion.com/EhpApi";
export const REQUEST_TIMEOUT_MS = 120_000;
export const REQUEST_PAUSE_MS = 3_000;
export const MAX_ATTEMPTS = 3;

// 429 and 408 are NOT permanent. The wire status decides permanence because the vendor
// answers a refused history request with a 400 whose body lies about being a 500 -- that
// is a statement about a malformed REQUEST, not about every 4xx. A throttling answer and
// a request timeout say "later", so treating them as terminal would abandon a window the
// vendor never refused.
export const TRANSIENT_CLIENT_STATUSES = [408, 429];

export function isPermanentStatus(status) {
  return status >= 400 && status < 500 && !TRANSIENT_CLIENT_STATUSES.includes(status);
}

export function delay(ms) {
  return ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve();
}

export function buildPageUrl(scope, window, page, { companyCode = COMPANY_CODE, size = PAGE_SIZE } = {}) {
  const url = new URL(`${COLDLION_BASE_URL}${scope.endpoint}`);
  url.searchParams.set("companyCode", companyCode);
  url.searchParams.set("fromDate", window.from);
  url.searchParams.set("toDate", window.to);
  if (scope.stage) url.searchParams.set("stageCode", scope.stage);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));
  return url;
}

/** The request as sent, for coldlion.sync_run.request_params. No secrets. */
export function requestParams(scope, window, page, { companyCode = COMPANY_CODE, size = PAGE_SIZE } = {}) {
  const params = {
    companyCode,
    fromDate: window.from,
    toDate: window.to,
    page,
    size,
  };
  if (scope.stage) params.stageCode = scope.stage;
  return params;
}

/**
 * Validate one Spring Page envelope against the page we asked for.
 *
 * `size` is NOT asserted equal to the requested size — the vendor substitutes it — but a
 * returned size LARGER than requested is impossible and means we are not reading what we
 * think we are.
 */
export function validatePage(payload, requestedPage, scope, requestedSize = PAGE_SIZE) {
  if (!payload || Array.isArray(payload) || !Array.isArray(payload.content)) {
    throw new Error(`${scope.endpoint} did not return the required paged envelope`);
  }
  for (const field of ["number", "size", "numberOfElements", "totalElements", "totalPages", "last"]) {
    if (!(field in payload)) throw new Error(`${scope.endpoint} page is missing ${field}`);
  }
  if (payload.number !== requestedPage) {
    throw new Error(
      `${scope.endpoint} returned page ${payload.number} for requested page ${requestedPage}`,
    );
  }
  if (payload.numberOfElements !== payload.content.length) {
    throw new Error(`${scope.endpoint} page count disagrees with content length`);
  }
  if (payload.size > requestedSize) {
    throw new Error(`${scope.endpoint} returned an impossible page size ${payload.size}`);
  }
  if (payload.content.length > payload.size) {
    throw new Error(`${scope.endpoint} returned more rows than its own page size`);
  }
  if (scope.stage) {
    // The stage AGREEMENT, asserted at the door as well as in the database. A returned
    // stage other than the requested one means the request scope did not hold.
    const mismatch = payload.content.find(
      (row) => String(row?.stageCode ?? "").toUpperCase() !== scope.stage,
    );
    if (mismatch) {
      throw new Error(`${scope.endpoint} returned a stage other than the requested ${scope.stage}`);
    }
  }
  return payload;
}

/**
 * One page fetch with bounded retry. TRANSIENT failures only are retried: a 4xx WIRE
 * status is permanent no matter what the body claims about itself.
 */
export async function fetchPage(url, apiKey, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, pauseMs = REQUEST_PAUSE_MS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { "X-API-Key": apiKey },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        const error = new Error(`${url.pathname} returned non-JSON on wire HTTP ${response.status}`);
        error.httpStatus = response.status;
        error.bodyStatus = null;
        error.permanent = isPermanentStatus(response.status);
        throw error;
      }
      const bodyStatus = Number.isInteger(payload?.status) ? payload.status : null;
      if (!response.ok) {
        const error = new Error(
          `${url.pathname} returned wire HTTP ${response.status} (body claimed ${bodyStatus ?? "no status"})`,
        );
        error.httpStatus = response.status;
        error.bodyStatus = bodyStatus;
        // THE WIRE STATUS DECIDES. The body's 500 on a 400 is the documented vendor lie.
        error.permanent = isPermanentStatus(response.status);
        throw error;
      }
      return { payload, httpStatus: response.status, bodyStatus };
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === MAX_ATTEMPTS) throw error;
      await delay(pauseMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Walk one scope of one window to completion.
 *
 * Completion means walking until the envelope's own `last` flag, then proving pages
 * 0..last are contiguous, exactly one is terminal, and the row counts add up to the
 * vendor's reported total. `totalPages` is a bound to detect a runaway, never the
 * definition of done.
 */
export async function fetchWindowScope({
  scope,
  window,
  apiKey,
  companyCode = COMPANY_CODE,
  size = PAGE_SIZE,
  fetchImpl = fetch,
  // The vendor agreement is one request at a time with a pause between them
  // (docs/coldlion-history-endpoints-shape.md). A backfill is hundreds of windows
  // times four scopes, so an unpaced walk is the shape that gets a key throttled.
  // The gate defaults to that pause instead of to nothing.
  requestGate = () => delay(pauseMs),
  timeoutMs = REQUEST_TIMEOUT_MS,
  pauseMs = REQUEST_PAUSE_MS,
}) {
  const pages = [];
  for (let page = 0; ; page += 1) {
    await requestGate();
    const url = buildPageUrl(scope, window, page, { companyCode, size });
    const { payload, httpStatus, bodyStatus } = await fetchPage(url, apiKey, {
      fetchImpl,
      timeoutMs,
      pauseMs,
    });
    validatePage(payload, page, scope, size);
    pages.push({
      pageNumber: page,
      requestedPageSize: size,
      returnedPageSize: payload.size,
      rowCount: payload.content.length,
      reportedTotalElements: payload.totalElements,
      reportedTotalPages: payload.totalPages,
      isLastPage: payload.last === true,
      httpStatus,
      bodyStatus,
      content: payload.content,
      fetchedAt: new Date().toISOString(),
    });
    if (payload.last === true) break;
    if (page + 1 >= Math.max(1, payload.totalPages)) {
      throw new Error(`${scope.endpoint} claimed no terminal page within totalPages`);
    }
    if (page > 10_000) throw new Error(`${scope.endpoint} paging did not terminate`);
  }
  return { pages, ...assertPagesComplete(pages, scope) };
}

export function assertPagesComplete(pages, scope) {
  if (pages.length === 0) throw new Error(`${scope.endpoint} has no page evidence`);
  const terminal = pages.filter((page) => page.isLastPage);
  if (terminal.length !== 1 || pages.at(-1).isLastPage !== true) {
    throw new Error(`${scope.endpoint} does not have exactly one terminal page`);
  }
  pages.forEach((page, index) => {
    if (page.pageNumber !== index) {
      throw new Error(`${scope.endpoint} pages are not contiguous from 0`);
    }
  });
  const reported = pages[0].reportedTotalElements;
  if (pages.some((page) => page.reportedTotalElements !== reported)) {
    throw new Error(`${scope.endpoint} totalElements changed during one window`);
  }
  const rows = pages.reduce((sum, page) => sum + page.rowCount, 0);
  if (rows !== reported) {
    throw new Error(
      `${scope.endpoint} pages are incomplete: rows ${rows} against reported ${reported}`,
    );
  }
  return {
    rows,
    reportedTotalElements: reported,
    reportedTotalPages: pages[0].reportedTotalPages,
    lastPageNumber: pages.at(-1).pageNumber,
  };
}
