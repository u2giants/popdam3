#!/usr/bin/env node

// #5011: the new-item heartbeat. ONE tiny GET every 5 minutes asks ColdLion
// for the two newest items (/items?sort=createdTime,desc&size=2) and
// dispatches the existing item sweep when the newest item was created inside
// the window — replacing the old 30-minute full sweep.
//
// RECORDED LIVE EVIDENCE (2026-10-29, read-only, production ColdLion, issue
// #5011; "record the probe or it is fabricated"):
//   - createdFrom is DAY-TYPED: instants 2026-10-28T00:00:01Z,
//     2026-10-28T23:59:59Z and the bare date 2026-10-28 ALL return
//     totalElements=41 — the vendor truncates to the date, so a time window
//     cannot be built on that filter (round-4 blocking finding, confirmed).
//   - sort=createdTime,desc works: the first row is the newest item, and the
//     envelope carries the sort echo under the key "sort" (the exact key was
//     re-verified against the raw envelope; "sortField" is accepted as an
//     alias in case the vendor renames). The unsorted default sorts by ItemNo
//     ASC. Both the metadata echo AND the data order are asserted every run —
//     the /seasons defect class is "metadata fine, content wrong", so the
//     probe also demands row[0].createdTime >= row[1].createdTime.
//   - Vendor createdTime is America/New_York wall time, not UTC: on 2026-10-28
//     the items AA020NDCST02 (17:09) and NKR82HDWAN02 (17:27) landed in
//     plm.item at 21:54 UTC — exactly one sweep cycle after 17:09/17:27 EDT
//     (= 21:09/21:27 UTC), and hours off under any UTC reading.
//   - modifiedFrom serves createdFrom semantics (identical totals on every
//     probe) — no edit-coverage probe exists; item edits land at the three
//     anchor sweeps plus the nightly masters run, i.e. up to ~13 hours late
//     (worst gap 00:00→13:00 UTC) instead of ≤30 minutes (trade-off on #5011).
//   - companyCode-only, no divisionCode: the full item sweep
//     (tools/sync-coldlion-items.mjs) pulls the same way — /items is not in
//     the per-division-must-send-division defect family (/seasons is).

import { pathToFileURL } from "node:url";
import { COLDLION_BASE_URL, readColdlionApiKey } from "./coldlion-sync-common.mjs";

// Two intervals of the 5-minute cadence: one entirely skipped run still has
// its window seen by the next run (three or more consecutive skipped runs
// would miss items — recorded, accepted; the anchors and nightly remain the
// backstop). Re-triggering is absorbed by the workflow's 10-minute dispatch
// throttle.
export const HEARTBEAT_WINDOW_MINUTES = 10;
export const HEARTBEAT_FETCH_TIMEOUT_MS = 10_000;

export function buildHeartbeatUrl({ baseUrl = COLDLION_BASE_URL } = {}) {
  const url = new URL(`${baseUrl}/items`);
  url.searchParams.set("companyCode", "EDGEHOME");
  url.searchParams.set("sort", "createdTime,desc");
  url.searchParams.set("size", "2");
  url.searchParams.set("page", "0");
  return url;
}

// Vendor wall time ("2026-10-28 17:27:39.668") is America/New_York; convert
// through the zone offset valid at that wall time. A wrong or unparseable
// timestamp is a shape failure, never a quiet pass.
export function vendorTimeToUtc(value, { zone = "America/New_York" } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const wallAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number((fraction ?? "0").padEnd(3, "0").slice(0, 3)));
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const zoneOffsetFor = (instant) => {
    const parts = Object.fromEntries(dtf.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)) - instant;
  };
  const firstGuess = wallAsUtc - zoneOffsetFor(wallAsUtc);
  return new Date(wallAsUtc - zoneOffsetFor(firstGuess));
}

const round1 = (value) => Math.round(value * 10) / 10;

// Judged on metadata AND data (round-5 H2): the echo must say createdTime
// DESC, the two returned rows must actually be in descending createdTime
// order, and the newest row's timestamp must parse and sit plausibly near now.
export function classifyHeartbeat(payload, { now = new Date(), windowMinutes = HEARTBEAT_WINDOW_MINUTES } = {}) {
  const rows = payload?.content;
  if (!Array.isArray(rows) || !rows.length || !Number.isFinite(payload?.totalElements)) {
    return { outcome: "malformed", message: "response is not a paged envelope with content and totalElements" };
  }
  const sortEcho = Array.isArray(payload?.sort) ? payload.sort : Array.isArray(payload?.sortField) ? payload.sortField : [];
  const isCreatedTimeDesc = sortEcho.some((entry) => String(entry?.property) === "createdTime" && String(entry?.direction).toUpperCase() === "DESC");
  if (!isCreatedTimeDesc) {
    return { outcome: "malformed", message: `the sort echo does not say createdTime DESC (${JSON.stringify(sortEcho)}) — the newest-item contract is broken` };
  }
  const stamps = rows.map((row) => vendorTimeToUtc(row?.createdTime));
  if (stamps.some((stamp) => !stamp)) {
    return { outcome: "malformed", message: `a returned row carries no parseable createdTime (${JSON.stringify(rows.map((row) => row?.createdTime))})` };
  }
  if (stamps.length > 1 && stamps[0].getTime() < stamps[1].getTime()) {
    return { outcome: "malformed", message: "the returned rows are not in createdTime-descending order — the sort echo lies (the /seasons metadata-lie defect class)" };
  }
  const ageMinutes = (now.getTime() - stamps[0].getTime()) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < -windowMinutes) {
    return { outcome: "malformed", message: `the newest createdTime resolves ${ageMinutes} minutes from now — the timezone contract is broken` };
  }
  const newestItemNo = String(rows[0]?.itemNo ?? "").trim() || null;
  if (ageMinutes <= windowMinutes) {
    return { outcome: "trigger", newestItemNo, newestCreatedUtc: stamps[0].toISOString(), ageMinutes: round1(ageMinutes) };
  }
  return { outcome: "quiet", newestItemNo, newestCreatedUtc: stamps[0].toISOString(), ageMinutes: round1(ageMinutes) };
}

// The full pipeline behind main(), exported so the workflow contract (the
// `trigger` JSON key the dispatch gate reads, and the exit codes) is tested
// end to end (round-5 C1/M2: the gate key once went missing and no test
// noticed).
export async function runProbe(apiKey, fetchImpl = fetch, { now = new Date() } = {}) {
  const url = buildHeartbeatUrl();
  const response = await fetchImpl(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(HEARTBEAT_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const result = classifyHeartbeat(await response.json(), { now });
  return {
    report: { url: String(url), checkedAt: now.toISOString(), trigger: result.outcome === "trigger", ...result },
    exitCode: result.outcome === "malformed" ? 1 : 0,
  };
}

async function main() {
  const { report, exitCode } = await runProbe(readColdlionApiKey());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Coldlion item heartbeat failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
