import { COLDLION_BASE_URL, MAX_ATTEMPTS, REQUEST_PAUSE_MS, REQUEST_TIMEOUT_MS, delay, fetchPage } from "./http.mjs";

export const MASTER_PAGE_SIZE = 2000;

export function masterUrl(endpoint, params = {}) {
  const url = new URL(`${COLDLION_BASE_URL}${endpoint}`);
  // ColdLion's documented API is an inherited HTTP-only vendor service (the
  // HTTPS context returns 404). Owner ruling #906 permanently accepts this
  // known transport risk; refuse any drift to another clear-text host.
  if (url.protocol !== "http:" || url.hostname !== "x5.coldlion.com" || !url.pathname.startsWith("/EhpApi/")) throw new Error("refusing an unapproved ColdLion API origin");
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchPagedMaster(endpoint, params, apiKey, options = {}) {
  const size = options.size ?? MASTER_PAGE_SIZE;
  const rows = [];
  let expectedTotal = null;
  for (let page = 0; ; page += 1) {
    if (options.requestGate) await options.requestGate();
    const requestParams = { ...params, page, size };
    let response;
    try { response = await fetchPage(masterUrl(endpoint, requestParams), apiKey, options); }
    catch (error) { error.requestParams ??= requestParams; throw error; }
    const { payload, httpStatus, bodyStatus } = response;
    options.onResponse?.({ endpoint, params: requestParams, httpStatus, bodyStatus });
    if (!payload || Array.isArray(payload) || !Array.isArray(payload.content)) throw new Error(`${endpoint} did not return a paged envelope`);
    for (const field of ["number","size","numberOfElements","totalElements","totalPages","last"]) {
      if (!(field in payload)) throw new Error(`${endpoint} page is missing ${field}`);
    }
    if (payload.number !== page || payload.numberOfElements !== payload.content.length) throw new Error(`${endpoint} returned inconsistent page ${page}`);
    if (payload.size > size) throw new Error(`${endpoint} returned an impossible page size`);
    if (expectedTotal === null) expectedTotal = payload.totalElements;
    if (payload.totalElements !== expectedTotal) throw new Error(`${endpoint} totalElements changed during the snapshot`);
    rows.push(...payload.content);
    if (payload.last === true) break;
    if (page + 1 >= Math.max(1, payload.totalPages) || page > 10_000) throw new Error(`${endpoint} paging did not terminate`);
  }
  if (rows.length !== expectedTotal) throw new Error(`${endpoint} snapshot is incomplete: ${rows.length} of ${expectedTotal}`);
  return rows;
}

export async function fetchArrayMaster(endpoint, params, apiKey, { fetchImpl = fetch, requestGate, onResponse, timeoutMs = REQUEST_TIMEOUT_MS, pauseMs = REQUEST_PAUSE_MS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (requestGate) await requestGate();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(masterUrl(endpoint, params), { headers: { "X-API-Key": apiKey }, signal: controller.signal });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); }
      catch {
        const error = new Error(`${endpoint} returned non-JSON on wire HTTP ${response.status}`);
        error.httpStatus = response.status;
        error.bodyStatus = null;
        error.permanent = response.status >= 400 && response.status < 500 && ![408,429].includes(response.status);
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`${endpoint} returned wire HTTP ${response.status}`);
        error.httpStatus = response.status;
        if (Number.isInteger(payload?.status)) error.bodyStatus = payload.status;
        error.permanent = response.status >= 400 && response.status < 500 && ![408,429].includes(response.status);
        throw error;
      }
      if (!Array.isArray(payload)) { const error=new Error(`${endpoint} did not return the required plain array`); error.permanent=true; throw error; }
      onResponse?.({ endpoint, params, httpStatus: response.status, bodyStatus: Number.isInteger(payload?.status) ? payload.status : null });
      return payload;
    } catch (error) {
      error.requestParams ??= params;
      lastError = error;
      if (error.permanent || attempt === MAX_ATTEMPTS) throw error;
      await delay(pauseMs);
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

export async function fetchMasterSpec(spec, params, apiKey, options = {}) {
  try {
    return spec.paged
      ? await fetchPagedMaster(spec.endpoint, params, apiKey, options)
      : await fetchArrayMaster(spec.endpoint, params, apiKey, options);
  } catch (error) {
    error.endpoint ??= spec.endpoint;
    throw error;
  }
}
