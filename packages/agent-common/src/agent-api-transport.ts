/**
 * Shared HTTPS transport for agent → agent-api edge-function calls, plus the
 * auth-failure backoff state machine (issue #141: a stale/revoked agent key is
 * permanent until re-paired, so hammering every 30s only creates a steady 401
 * stream — track failures and slow the heartbeat instead).
 *
 * One engine, two deployment policies (#708):
 *   - bridge agent (Docker/Synology): maxAttempts 5 with exponential backoff
 *     on 5xx and network errors, hard 30s default timeout per request.
 *   - Windows render agent: single-shot (maxAttempts 1) with an OPTIONAL
 *     timeout — call sites that pass none run with no AbortSignal at all.
 *
 * The endpoint surfaces (which actions each agent calls) stay per-agent in
 * apps/<agent>/src/api-client.ts; only the transport lives here.
 */

import { logger } from "./logger.js";

export interface AgentApiTransportOptions {
  /** Base URL of the agent-api edge function (agent config value). */
  getUrl(): string;
  /** Agent key sent as x-agent-key (agent config value). */
  getKey(): string;
  /**
   * Total attempts per call. 5 = retry 5xx/network errors with backoff
   * (bridge); 1 = single-shot (Windows). 4xx is never retried either way.
   */
  maxAttempts: number;
  /** Timeout applied when a call site passes none. undefined = no AbortSignal. */
  defaultTimeoutMs?: number;
  /** Base for the exponential retry delay (min 5s cap). Tests shrink this. */
  retryBaseDelayMs?: number;
}

export interface AgentApiTransport {
  callApi(action: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** Heartbeat delay suggestion that grows with consecutive auth failures. */
  suggestedHeartbeatDelayMs(): number;
  /** True once a 401 has been seen and no call has succeeded since. */
  isAuthFailure(): boolean;
}

export function createAgentApiTransport(options: AgentApiTransportOptions): AgentApiTransport {
  const maxAttempts = options.maxAttempts;
  const baseDelay = options.retryBaseDelayMs ?? 1000;
  let consecutiveAuthFailures = 0;

  function suggestedHeartbeatDelayMs(): number {
    if (consecutiveAuthFailures === 0) return 30_000;
    if (consecutiveAuthFailures < 3) return 30_000;
    if (consecutiveAuthFailures < 10) return 120_000;
    return 300_000;
  }

  function isAuthFailure(): boolean {
    return consecutiveAuthFailures > 0;
  }

  function noteAuthFailure(action: string, status: number, text: string): never {
    consecutiveAuthFailures++;
    const delayMs = suggestedHeartbeatDelayMs();
    logger.error(`agent-api ${action} auth failure (${status}) — check agent key / re-pair`, {
      consecutiveAuthFailures,
      nextHeartbeatDelayMs: delayMs,
      // Response body is the public error message (never the key).
      error: text.slice(0, 200),
    });
    throw new Error(`agent-api ${action} returned ${status}: ${text}`);
  }

  function noteAuthSuccess(): void {
    consecutiveAuthFailures = 0;
  }

  async function callApi(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ action, ...payload });
    const effectiveTimeoutMs = timeoutMs === undefined ? options.defaultTimeoutMs : timeoutMs;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(options.getUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agent-key": options.getKey(),
          },
          body,
          // hard timeout per request — prevents hung connections stalling the scan
          signal: effectiveTimeoutMs === undefined ? undefined : AbortSignal.timeout(effectiveTimeoutMs),
        });

        if (!res.ok) {
          const text = await res.text();
          // Don't retry client errors (4xx) — they are permanent
          if (res.status === 401) {
            noteAuthFailure(action, res.status, text);
          }
          if (res.status >= 400 && res.status < 500) {
            throw new Error(`agent-api ${action} returned ${res.status}: ${text}`);
          }
          // Retry server errors (5xx)
          lastError = new Error(`agent-api ${action} returned ${res.status}: ${text}`);
          if (attempt < maxAttempts) {
            const delay = Math.min(5000, baseDelay * Math.pow(2, attempt - 1));
            logger.warn(`agent-api ${action} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw lastError;
        }

        const data = await res.json();
        if (data && !data.ok) {
          throw new Error(`agent-api ${action} error: ${data.error || "unknown"}`);
        }
        noteAuthSuccess();
        return data;

      } catch (e) {
        // Re-throw already-formatted errors (4xx or data.ok === false)
        if (e instanceof Error && e.message.startsWith("agent-api")) throw e;
        // Network error — retry
        lastError = e as Error;
        if (attempt < maxAttempts) {
          const delay = Math.min(5000, baseDelay * Math.pow(2, attempt - 1));
          logger.warn(`agent-api ${action} network error, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`, { error: (e as Error).message });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError ?? new Error(`agent-api ${action} failed after ${maxAttempts} attempts`);
  }

  return { callApi, suggestedHeartbeatDelayMs, isAuthFailure };
}
