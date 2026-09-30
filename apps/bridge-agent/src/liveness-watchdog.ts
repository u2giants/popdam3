/**
 * Heartbeat liveness watchdog (issue #167).
 *
 * Incident: the NAS bridge container stayed "Up" for six days with node busy
 * but sent no heartbeats, and nothing restarted it. This module makes that
 * state self-healing and diagnosable:
 *
 *   1. Main-thread watchdog — if no heartbeat has SUCCEEDED for `timeoutMs`,
 *      log one clear fatal line with diagnostics (current activity/phase,
 *      last success, memory, event-loop lag) and exit non-zero so Docker's
 *      restart policy (`restart: unless-stopped`) starts a fresh process.
 *   2. Worker-thread backstop — if the main event loop itself is frozen
 *      (synchronous work that never yields), the main-thread timer can never
 *      fire. A tiny worker watches a shared "loop tick" timestamp and SIGKILLs
 *      the process when the loop has not ticked for `loopFrozenMs`.
 *
 * Auth failures are excluded from the restart: a revoked key is permanent
 * until re-pairing, so restarting every N minutes would only add noise.
 *
 * This module never touches the Docker self-updater.
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
  /** True when the most recent heartbeat failures are auth failures (restart would not help). */
  isAuthFailing?: () => boolean;
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
  const startedAt = now();
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastFailureError: string | undefined;
  let fired = false;
  let authWarned = false;
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
    const ref = lastSuccessAt ?? startedAt;
    const silentMs = now() - ref;
    if (silentMs < opts.timeoutMs) return false;
    if (opts.isAuthFailing?.()) {
      if (!authWarned) {
        authWarned = true;
        opts.logWarn?.("Heartbeat watchdog: no successful heartbeat, but failures are auth errors — not restarting (re-pair the agent)", {
          silent_ms: silentMs,
          ...diagnostics(),
        });
      }
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

  return {
    noteSuccess() {
      lastSuccessAt = now();
      authWarned = false;
    },
    noteFailure(error: string) {
      lastFailureAt = now();
      lastFailureError = error.slice(0, 300);
    },
    check,
    diagnostics,
    start() {
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

function safe(fn: () => WatchdogDiagnostics): WatchdogDiagnostics {
  try {
    return fn();
  } catch (e) {
    return { diagnostics_error: (e as Error).message };
  }
}

// ── Frozen-event-loop backstop ──────────────────────────────────────

const BACKSTOP_SOURCE = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const ticks = new Float64Array(workerData.buf);
setInterval(() => {
  const age = Date.now() - ticks[0];
  if (age > workerData.frozenMs) {
    fs.writeSync(2, JSON.stringify({
      ts: new Date().toISOString(), level: "error",
      msg: "FATAL event-loop watchdog: main thread frozen — killing process so Docker restarts the agent",
      frozen_ms: age, frozen_ms_limit: workerData.frozenMs,
    }) + "\\n");
    process.kill(workerData.pid, "SIGKILL");
  }
}, workerData.checkMs);
`;

/**
 * Starts the worker-thread backstop. The main thread stamps a shared buffer
 * every `tickMs`; the worker SIGKILLs the process if the stamp goes stale.
 */
export function startEventLoopBackstop(frozenMs: number, tickMs = 5_000): () => void {
  const buf = new SharedArrayBuffer(8);
  const ticks = new Float64Array(buf);
  ticks[0] = Date.now();
  const tick = setInterval(() => { ticks[0] = Date.now(); }, tickMs);
  tick.unref?.();
  const worker = new Worker(BACKSTOP_SOURCE, {
    eval: true,
    workerData: { buf, frozenMs, pid: process.pid, checkMs: Math.min(tickMs, 10_000) },
  });
  worker.unref();
  return () => {
    clearInterval(tick);
    void worker.terminate();
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
