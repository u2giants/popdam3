/**
 * Scan run history (#1117). SCAN_PROGRESS is one row overwritten each run, so
 * finished runs are also appended to SCAN_HISTORY (newest first, capped) to
 * let duration and outcome trends be read back.
 */

export const SCAN_HISTORY_KEY = "SCAN_HISTORY";
export const SCAN_HISTORY_LIMIT = 200;

export const TERMINAL_SCAN_STATUSES = new Set([
  "completed",
  "completed_with_warnings",
  "completed_with_errors",
  "failed",
]);

export interface ScanHistoryEntry {
  session_id: string;
  status: string;
  started_at: string | null;
  finished_at: string;
  duration_seconds: number | null;
  counters: Record<string, unknown>;
  error?: string;
}

export function buildScanHistoryEntry(
  sessionId: string,
  status: string,
  startedAt: string | null,
  finishedAt: string,
  counters: Record<string, unknown> | undefined,
  error?: string,
): ScanHistoryEntry {
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const endMs = Date.parse(finishedAt);
  const duration = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? Math.round((endMs - startMs) / 1000)
    : null;
  return {
    session_id: sessionId,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_seconds: duration,
    counters: counters ?? {},
    ...(error ? { error: error.slice(0, 500) } : {}),
  };
}

/** Newest first; a repeated terminal report for one session replaces its entry. */
export function appendScanHistory(
  existing: unknown,
  entry: ScanHistoryEntry,
  limit = SCAN_HISTORY_LIMIT,
): ScanHistoryEntry[] {
  const prior = Array.isArray(existing) ? existing as ScanHistoryEntry[] : [];
  return [entry, ...prior.filter((e) => e && e.session_id !== entry.session_id)].slice(0, limit);
}

/** Finished sibling-scan requests are only useful as a short-lived cache. */
export const SIBLING_SCAN_RETENTION_MS = 24 * 60 * 60 * 1000;

export function isExpiredSiblingScanRow(
  value: unknown,
  updatedAt: string | null | undefined,
  nowMs: number,
): boolean {
  const status = (value as Record<string, unknown> | null)?.status;
  if (status !== "completed" && status !== "failed") return false;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(updatedMs) && nowMs - updatedMs > SIBLING_SCAN_RETENTION_MS;
}
