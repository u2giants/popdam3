/**
 * Heartbeat liveness watchdog (#167). If heartbeats stop succeeding, log one
 * FATAL line with diagnostics and exit non-zero so Docker's restart policy
 * starts a fresh process. A worker-thread backstop covers a frozen event loop,
 * where the main-thread timer could never fire. Never touches the self-updater.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

export interface WatchdogDiagnostics {
  [key: string]: unknown;
}

export interface LivenessWatchdogOptions {
  /** Max time without a successful heartbeat before exiting. */
  timeoutMs: number;
  /** How often to check. */
  checkIntervalMs?: number;
  now?: () => number;
  /** Extra diagnostics from the agent (activity, counters…). */
  getDiagnostics?: () => WatchdogDiagnostics;
  /**
   * While heartbeats keep completing with a server/network answer (the
   * process is clearly alive, the API is down), wait up to this long before
   * restarting anyway. Default 6x timeoutMs.
   */
  outageCeilingMs?: number;
  logFatal: (msg: string, meta: Record<string, unknown>) => void;
  logWarn?: (msg: string, meta: Record<string, unknown>) => void;
  exit: (code: number) => void;
}

let currentActivity = "idle";
let activitySince = Date.now();

/** Record what the agent is doing right now, so a watchdog kill says where it was stuck. */
export function setActivity(activity: string): void {
  currentActivity = activity;
  activitySince = Date.now();
}

export function getActivity(): { activity: string; since: string } {
  return { activity: currentActivity, since: new Date(activitySince).toISOString() };
}

const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

export function createLivenessWatchdog(opts: LivenessWatchdogOptions) {
  const now = opts.now ?? Date.now;
  let startedAt = now();
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastFailureError: string | undefined;
  let lastFailureKind: FailureKind | null = null;
  const outageCeilingMs = opts.outageCeilingMs ?? opts.timeoutMs * 6;
  let fired = false;
  let warned = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lag: IntervalHistogram | null = null;

  function diagnostics(): Record<string, unknown> {
    const mem = process.memoryUsage();
    return {
      ...getActivity(),
      started_at: new Date(startedAt).toISOString(),
      last_heartbeat_success_at: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
      last_heartbeat_failure_at: lastFailureAt ? new Date(lastFailureAt).toISOString() : null,
      last_heartbeat_error: lastFailureError,
      last_heartbeat_failure_kind: lastFailureKind,
      memory_mb: { rss: mb(mem.rss), heap_used: mb(mem.heapUsed), heap_total: mb(mem.heapTotal), external: mb(mem.external) },
      event_loop_lag_ms: lag
        ? { mean: Math.round(lag.mean / 1e6), p99: Math.round(lag.percentile(99) / 1e6), max: Math.round(lag.max / 1e6) }
        : null,
      ...(opts.getDiagnostics ? safe(opts.getDiagnostics) : {}),
    };
  }

  /** Returns true when the watchdog decided to exit. */
  function check(): boolean {
    if (fired) return true;
    const t = now();
    const silentMs = t - (lastSuccessAt ?? startedAt);
    if (silentMs < opts.timeoutMs) return false;
    const recentAnswer = lastFailureAt !== null && t - lastFailureAt < opts.timeoutMs;
    // A revoked key is permanent until re-pairing: restarting cannot help.
    if (recentAnswer && lastFailureKind === "auth") {
      warnOnce("Heartbeat watchdog: no successful heartbeat, but the API rejects the agent key — not restarting (re-pair the agent)", silentMs);
      return false;
    }
    // The loop is alive and the API answers with errors / is unreachable:
    // tolerate an outage for a while instead of restart-looping every N min.
    if (recentAnswer && lastFailureKind === "api" && silentMs < outageCeilingMs) {
      warnOnce("Heartbeat watchdog: heartbeats failing with API/network errors — process alive, holding restart", silentMs);
      return false;
    }
    fired = true;
    opts.logFatal("FATAL heartbeat watchdog: no successful heartbeat — exiting so Docker restarts the agent", {
      silent_ms: silentMs,
      timeout_ms: opts.timeoutMs,
      ...diagnostics(),
    });
    opts.exit(70);
    return true;
  }

  function warnOnce(msg: string, silentMs: number) {
    if (warned) return;
    warned = true;
    opts.logWarn?.(msg, { silent_ms: silentMs, ...diagnostics() });
  }

  return {
    noteSuccess() {
      lastSuccessAt = now();
      warned = false;
    },
    noteFailure(error: string) {
      lastFailureAt = now();
      lastFailureError = error.slice(0, 300);
      lastFailureKind = classifyHeartbeatFailure(error);
    },
    check,
    diagnostics,
    start() {
      startedAt = now(); // grace period starts when armed, not at module load
      lag = monitorEventLoopDelay({ resolution: 50 });
      lag.enable();
      timer = setInterval(check, opts.checkIntervalMs ?? 30_000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      lag?.disable();
      timer = null;
    },
  };
}

export type FailureKind = "auth" | "api" | "timeout";

/** auth = key rejected; api = server/network answered with an error; timeout = something hung. */
export function classifyHeartbeatFailure(message: string): FailureKind {
  if (/returned 40[13]\b/.test(message)) return "auth";
  // Any HTTP status means the server answered — even if its body mentions a timeout.
  if (/returned \d{3}\b/.test(message)) return "api";
  if (/timed out|timeout|aborted/i.test(message)) return "timeout";
  return "api";
}

function safe(fn: () => WatchdogDiagnostics): WatchdogDiagnostics {
  try {
    return fn();
  } catch (e) {
    return { diagnostics_error: (e as Error).message };
  }
}

// ── Frozen-event-loop backstop ──────────────────────────────────────

// ESM: this package is "type": "module", so eval'd worker code runs as ESM.
const BACKSTOP_SOURCE = `
import { workerData } from "node:worker_threads";
import { writeSync } from "node:fs";
const ticks = new BigInt64Array(workerData.buf);
setInterval(() => {
  const age = Date.now() - Number(Atomics.load(ticks, 0));
  if (age > workerData.frozenMs) {
    writeSync(2, JSON.stringify({
      ts: new Date().toISOString(), level: "error",
      msg: "FATAL event-loop watchdog: main thread frozen — killing process so Docker restarts the agent",
      frozen_ms: age, limit_ms: workerData.frozenMs,
    }) + "\\n");
    process.kill(workerData.pid, "SIGKILL");
  }
}, workerData.checkMs);
`;

/**
 * Starts the worker-thread backstop. The main thread stamps a shared buffer
 * every `tickMs`; the worker SIGKILLs the process if the stamp goes stale.
 */
export function startEventLoopBackstop(
  frozenMs: number,
  opts: { tickMs?: number; onError?: (e: Error) => void } = {},
): { worker: Worker; stop: () => void } {
  const tickMs = opts.tickMs ?? 5_000;
  const buf = new SharedArrayBuffer(8);
  const ticks = new BigInt64Array(buf);
  const stamp = () => Atomics.store(ticks, 0, BigInt(Date.now()));
  stamp();
  const tick = setInterval(stamp, tickMs);
  tick.unref?.();
  const worker = new Worker(BACKSTOP_SOURCE, {
    eval: true,
    workerData: { buf, frozenMs, pid: process.pid, checkMs: Math.min(tickMs, 10_000) },
  });
  worker.on("error", (e) => opts.onError?.(e));
  worker.unref();
  return {
    worker,
    stop: () => {
      clearInterval(tick);
      void worker.terminate();
    },
  };
}

/** Rejects if `p` does not settle within `ms` — keeps the heartbeat loop from hanging forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}
