import { isAiTagCursor } from "./ai-tag-cursor.js";

const UUID_CURSOR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AUTO_RESUME_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;
const TRANSIENT_REASONS = new Set([
  "statement_timeout",
  "gateway_timeout",
  "connection_error",
  "rate_limited",
  "stale_run",
  "dependency_timeout",
]);

export function isTransientInterruption(reason?: string): boolean {
  return reason !== undefined && TRANSIENT_REASONS.has(reason);
}

export function isValidAutoResumeCursor(opKey: string, cursor: unknown): boolean {
  if (typeof cursor === "number") return Number.isFinite(cursor) && cursor >= 0;
  if (opKey === "ai-tag-untagged" || opKey === "ai-tag-all" || opKey === "ai-tag-groups") {
    return isAiTagCursor(cursor);
  }
  // Style Group profiling keysets by style_groups.id, so its resumable cursor is a
  // bare UUID. Without this the op cannot auto-resume after a Railway restart.
  if (opKey === "ai-tag-group-profiles") {
    return typeof cursor === "string" && UUID_CURSOR_RE.test(cursor);
  }
  return false;
}

export function getAutoResumeDelayMs(attempts: number, random = Math.random): number {
  const base = AUTO_RESUME_DELAYS_MS[Math.min(Math.max(attempts, 0), AUTO_RESUME_DELAYS_MS.length - 1)];
  const jitter = 0.9 + Math.min(1, Math.max(0, random())) * 0.2;
  return Math.round(base * jitter);
}

export function getNextAutoResumeAt(nowMs: number, attempts: number, random = Math.random): string {
  return new Date(nowMs + getAutoResumeDelayMs(attempts, random)).toISOString();
}

export function getAiRetryPageSize(defaultSize: number, completedResumeAttempts: number): number {
  if (completedResumeAttempts <= 0) return defaultSize;
  if (completedResumeAttempts === 1) return Math.max(10, Math.ceil(defaultSize / 2));
  return Math.min(defaultSize, 10);
}
