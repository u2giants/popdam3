import { describe, expect, it } from "vitest";
import { appendScanHistory, buildScanHistoryEntry, isExpiredSiblingScanRow, TERMINAL_SCAN_STATUSES } from "./scan-history.ts";
import { isRevivableRetirement, RETIRED_MISSING_MARKER, RETIRED_STALE_MARKER } from "./stale-asset-retirement.ts";

describe("scan history", () => {
  it("records how long a run took", () => {
    const entry = buildScanHistoryEntry("s1", "completed", "2026-11-18T04:32:00Z", "2026-11-18T05:02:30Z", { files_checked: 9 });
    expect(entry.duration_seconds).toBe(1830);
    expect(entry.counters).toEqual({ files_checked: 9 });
  });

  it("leaves the duration empty when the start is unknown", () => {
    expect(buildScanHistoryEntry("s1", "failed", null, "2026-11-18T05:00:00Z", undefined, "boom").duration_seconds).toBeNull();
  });

  it("keeps newest first, one entry per run, within the cap", () => {
    const e = (id: string) => buildScanHistoryEntry(id, "completed", null, "2026-11-18T05:00:00Z", {});
    let history = appendScanHistory(undefined, e("a"));
    history = appendScanHistory(history, e("b"));
    history = appendScanHistory(history, e("a"));
    expect(history.map((h) => h.session_id)).toEqual(["a", "b"]);
    expect(appendScanHistory(history, e("c"), 2).map((h) => h.session_id)).toEqual(["c", "a"]);
  });

  it("treats completed-with-warnings as a finished run", () => {
    expect(TERMINAL_SCAN_STATUSES.has("completed_with_warnings")).toBe(true);
    expect(TERMINAL_SCAN_STATUSES.has("running")).toBe(false);
  });
});

describe("finished sibling-scan requests", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  it("expire a day after finishing", () => {
    expect(isExpiredSiblingScanRow({ status: "completed" }, "2026-11-17T11:00:00Z", now)).toBe(true);
    expect(isExpiredSiblingScanRow({ status: "failed" }, "2026-03-01T00:00:00Z", now)).toBe(true);
    expect(isExpiredSiblingScanRow({ status: "completed" }, "2026-11-18T11:55:00Z", now)).toBe(false);
  });
  it("never expire while waiting or in progress", () => {
    expect(isExpiredSiblingScanRow({ status: "pending" }, "2026-03-01T00:00:00Z", now)).toBe(false);
    expect(isExpiredSiblingScanRow({ status: "claimed" }, "2026-03-01T00:00:00Z", now)).toBe(false);
  });
});

describe("retirements a returning file undoes", () => {
  it("covers stale duplicates and files missing from the NAS only", () => {
    expect(isRevivableRetirement(`${RETIRED_STALE_MARKER}abc`)).toBe(true);
    expect(isRevivableRetirement(RETIRED_MISSING_MARKER)).toBe(true);
    expect(isRevivableRetirement("Decor/new/a.psd")).toBe(false);
    expect(isRevivableRetirement(null)).toBe(false);
  });
});
