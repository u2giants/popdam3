import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger.js";

const taskStore = new AsyncLocalStorage<string>();
/** Runs fn with a caller/task name attached to every model call it makes. */
export function withOpenRouterTask<T>(task: string, fn: () => T): T { return taskStore.run(task, fn); }
export function currentOpenRouterTask(): string | undefined { return taskStore.getStore(); }

/**
 * Per-minute tally of every model call made through chatCompletion, keyed by
 * (task, model, host). Logged as one `openrouter-call` JSON line per minute
 * (issue #1493). Query it in the worker's Railway logs: `"openrouter-call"`.
 */
export type OpenRouterErrorClass = "timeout" | "http_429" | "http_4xx" | "http_5xx" | "invalid_json" | "schema_invalid" | "empty" | "other";

interface Row {
  task: string; model: string; host: string;
  ok: number; failed: number; schema_ok: number; schema_failed: number;
  errors: Partial<Record<OpenRouterErrorClass, number>>;
  http_status: Record<string, number>;
  latencies: number[];
}

const tally = new Map<string, Row>();
let loggedAt = Date.now();

export function classifyOpenRouterError(error: unknown): OpenRouterErrorClass {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    if (status === 429) return "http_429";
    if (status === 408) return "timeout";
    if (status >= 500) return "http_5xx";
    if (status >= 400) return "http_4xx";
  }
  const name = (error as { name?: unknown })?.name;
  const msg = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted/i.test(msg)) return "timeout";
  if (/malformed tool call json|json/i.test(msg)) return "invalid_json";
  if (/no choices|empty/i.test(msg)) return "empty";
  return "other";
}

function row(task: string, model: string, host: string | null | undefined): Row {
  const h = host || "unknown";
  const key = `${task}\u0000${model}\u0000${h}`;
  let r = tally.get(key);
  if (!r) { r = { task, model, host: h, ok: 0, failed: 0, schema_ok: 0, schema_failed: 0, errors: {}, http_status: {}, latencies: [] }; tally.set(key, r); }
  return r;
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function flushOpenRouterCallLog(now = Date.now(), force = false): Record<string, unknown>[] | null {
  if (!force && now - loggedAt < 60_000) return null;
  const calls = [...tally.values()].map((r) => {
    const sorted = [...r.latencies].sort((a, b) => a - b);
    return { task: r.task, model: r.model, host: r.host, ok: r.ok, failed: r.failed, schema_ok: r.schema_ok, schema_failed: r.schema_failed,
      error_class: r.errors, http_status: r.http_status, p50_latency_ms: pct(sorted, 0.5), p95_latency_ms: pct(sorted, 0.95) };
  });
  tally.clear();
  loggedAt = now;
  if (calls.length) logger.info("openrouter-call", { window_s: 60, calls });
  return calls;
}

/** One transport-level call outcome (success or failure). */
export function recordOpenRouterCall(input: { task?: string; model: string; host?: string | null; ok: boolean; latencyMs: number; httpStatus?: number; errorClass?: OpenRouterErrorClass }, now = Date.now()): void {
  const r = row(input.task || "unknown", input.model, input.host);
  if (input.ok) r.ok++; else r.failed++;
  if (!input.ok) r.errors[input.errorClass ?? "other"] = (r.errors[input.errorClass ?? "other"] ?? 0) + 1;
  const status = String(input.httpStatus ?? (input.ok ? 200 : "none"));
  r.http_status[status] = (r.http_status[status] ?? 0) + 1;
  r.latencies.push(Math.max(0, Math.round(input.latencyMs)));
  flushOpenRouterCallLog(now);
}

/** Whether a structured-output caller could parse and validate the answer. */
export function recordOpenRouterSchema(input: { task?: string; model: string; host?: string | null; ok: boolean; errorClass?: OpenRouterErrorClass }, now = Date.now()): void {
  const r = row(input.task || "unknown", input.model, input.host);
  if (input.ok) r.schema_ok++; else {
    r.schema_failed++;
    const c = input.errorClass ?? "schema_invalid";
    r.errors[c] = (r.errors[c] ?? 0) + 1;
  }
  flushOpenRouterCallLog(now);
}
