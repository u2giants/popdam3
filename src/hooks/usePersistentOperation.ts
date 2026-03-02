import { useState, useEffect, useCallback } from "react";
import { useAdminApi } from "./useAdminApi";

/**
 * Server-side persistent operation hook.
 *
 * Operations are processed by the `bulk-job-runner` edge function (invoked
 * every minute by pg_cron). The UI just writes "running" state and polls
 * for progress — no client-side batch loops required.
 */

export interface OperationProgress {
  [key: string]: unknown;
}

export interface OperationState {
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  cursor?: number;
  params?: Record<string, unknown>;
  started_at?: string;
  updated_at?: string;
  progress?: OperationProgress;
  result_message?: string;
  error?: string;
}

const CONFIG_KEY = "BULK_OPERATIONS";
const POLL_ACTIVE_MS = 3_000;
const POLL_IDLE_MS = 30_000;

export function usePersistentOperation(operationKey: string) {
  const { call } = useAdminApi();
  const [state, setState] = useState<OperationState>({ status: "idle" });

  // ── Poll for state updates ──────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let timerId: ReturnType<typeof setTimeout>;
    let currentStatus = "idle";

    const poll = async () => {
      try {
        const data = await call("get-config", { keys: [CONFIG_KEY] });
        if (!mounted) return;
        const ops = (
          data?.config?.[CONFIG_KEY]?.value ?? data?.config?.[CONFIG_KEY]
        ) as Record<string, OperationState> | undefined;
        const saved = ops?.[operationKey];
        if (saved) {
          setState(saved);
          currentStatus = saved.status;
        } else {
          setState({ status: "idle" });
          currentStatus = "idle";
        }
      } catch {
        // ignore polling errors
      }

      if (!mounted) return;
      timerId = setTimeout(
        poll,
        currentStatus === "running" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
      );
    };

    poll();
    return () => {
      mounted = false;
      clearTimeout(timerId);
    };
  }, [operationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist helper ──────────────────────────────────────────────
  const persistState = useCallback(
    async (opState: OperationState) => {
      try {
        const data = await call("get-config", { keys: [CONFIG_KEY] });
        const existing =
          ((data?.config?.[CONFIG_KEY]?.value ??
            data?.config?.[CONFIG_KEY]) as Record<string, unknown>) ?? {};
        await call("set-config", {
          entries: {
            [CONFIG_KEY]: { ...existing, [operationKey]: opState },
          },
        });
      } catch {
        // best-effort
      }
    },
    [call, operationKey],
  );

  // ── Start a server-side operation ───────────────────────────────
  const start = useCallback(
    async (options?: {
      confirmMessage?: string;
      params?: Record<string, unknown>;
      initialProgress?: OperationProgress;
    }) => {
      if (state.status === "running") return;
      if (options?.confirmMessage && !confirm(options.confirmMessage)) return;

      const now = new Date().toISOString();
      const running: OperationState = {
        status: "running",
        cursor: 0,
        params: options?.params,
        started_at: now,
        updated_at: now,
        progress: options?.initialProgress ?? {},
      };
      setState(running);
      await persistState(running);
    },
    [state.status, persistState],
  );

  // ── Stop (mark as interrupted) ──────────────────────────────────
  const stop = useCallback(async () => {
    const interrupted: OperationState = {
      ...state,
      status: "interrupted",
      updated_at: new Date().toISOString(),
    };
    setState(interrupted);
    await persistState(interrupted);
  }, [state, persistState]);

  // ── Reset to idle ───────────────────────────────────────────────
  const reset = useCallback(async () => {
    const idle: OperationState = { status: "idle" };
    setState(idle);
    await persistState(idle);
  }, [persistState]);

  const isActive = state.status === "running";
  const isInterrupted = state.status === "interrupted";

  return { state, start, stop, reset, isActive, isInterrupted };
}
