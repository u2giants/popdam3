import { useState, useEffect, useRef, useCallback } from "react";
import { useAdminApi } from "./useAdminApi";

/**
 * Persistent operation state stored in admin_config under key BULK_OPERATIONS.
 * Each operation gets a slot keyed by `operationKey`.
 *
 * On mount, if an operation was "running" but stale (>2 min since last update),
 * it's treated as interrupted. If still fresh, the hook auto-resumes.
 */

export interface OperationProgress {
  [key: string]: unknown;
}

export interface OperationState {
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  started_at?: string;
  updated_at?: string;
  progress?: OperationProgress;
  result_message?: string;
  error?: string;
}

const STALE_MS = 2 * 60 * 1000; // 2 minutes without update = stale
const CONFIG_KEY = "BULK_OPERATIONS";

export function usePersistentOperation(operationKey: string) {
  const { call } = useAdminApi();
  const [state, setState] = useState<OperationState>({ status: "idle" });
  const runningRef = useRef(false);
  const abortRef = useRef(false);

  // ── Read persisted state on mount ────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await call("get-config", { keys: [CONFIG_KEY] });
        if (!mounted) return;
        const ops = data?.config?.[CONFIG_KEY]?.value as Record<string, OperationState> | undefined;
        const saved = ops?.[operationKey];
        if (!saved || saved.status === "idle" || saved.status === "completed" || saved.status === "failed") {
          setState(saved ?? { status: "idle" });
          return;
        }

        // It was "running" — check staleness
        if (saved.status === "running" && saved.updated_at) {
          const elapsed = Date.now() - new Date(saved.updated_at).getTime();
          if (elapsed > STALE_MS) {
            // Mark interrupted
            const interrupted: OperationState = { ...saved, status: "interrupted" };
            setState(interrupted);
            await persistState(interrupted);
            return;
          }
        }

        // Still fresh "running" — the page was navigated away and came back.
        // We can't auto-resume because we don't have the batch function reference yet.
        // Mark as interrupted so the user can see and re-trigger.
        const interrupted: OperationState = { ...saved, status: "interrupted" };
        setState(interrupted);
        await persistState(interrupted);
      } catch {
        // ignore load errors
      }
    }

    load();
    return () => { mounted = false; };
  }, [operationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist helper ───────────────────────────────────────────────
  async function persistState(opState: OperationState) {
    try {
      // Read current BULK_OPERATIONS, merge our key, write back
      const data = await call("get-config", { keys: [CONFIG_KEY] });
      const existing = (data?.config?.[CONFIG_KEY]?.value as Record<string, unknown>) ?? {};
      await call("set-config", {
        entries: { [CONFIG_KEY]: { ...existing, [operationKey]: opState } },
      });
    } catch {
      // best-effort
    }
  }

  // ── Run an operation ─────────────────────────────────────────────
  const run = useCallback(
    async (
      batchFn: (offset: number) => Promise<{ done: boolean; nextOffset?: number; [key: string]: unknown }>,
      options?: {
        confirmMessage?: string;
        buildProgress?: (batchResult: Record<string, unknown>, prev: OperationProgress) => OperationProgress;
        buildResultMessage?: (progress: OperationProgress) => string;
        startOffset?: number;
      },
    ) => {
      if (runningRef.current) return;

      if (options?.confirmMessage && !confirm(options.confirmMessage)) return;

      runningRef.current = true;
      abortRef.current = false;
      const now = new Date().toISOString();
      let progress: OperationProgress = options?.startOffset ? (state.progress ?? {}) : {};
      let offset = options?.startOffset ?? 0;

      const running: OperationState = {
        status: "running",
        started_at: now,
        updated_at: now,
        progress,
      };
      setState(running);
      await persistState(running);

      try {
        while (!abortRef.current) {
          const result = await batchFn(offset);
          progress = options?.buildProgress
            ? options.buildProgress(result, progress)
            : { ...progress, ...result };

          const updated: OperationState = {
            status: "running",
            started_at: running.started_at,
            updated_at: new Date().toISOString(),
            progress,
          };
          setState(updated);
          // Persist every batch so it survives navigation
          await persistState(updated);

          if (result.done) break;
          offset = result.nextOffset ?? offset + 1;
        }

        if (abortRef.current) {
          const interrupted: OperationState = {
            ...running,
            status: "interrupted",
            updated_at: new Date().toISOString(),
            progress,
          };
          setState(interrupted);
          await persistState(interrupted);
        } else {
          const completed: OperationState = {
            status: "completed",
            started_at: running.started_at,
            updated_at: new Date().toISOString(),
            progress,
            result_message: options?.buildResultMessage?.(progress),
          };
          setState(completed);
          await persistState(completed);
        }
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Unknown error";
        const failed: OperationState = {
          status: "failed",
          started_at: running.started_at,
          updated_at: new Date().toISOString(),
          progress,
          error: errMsg,
        };
        setState(failed);
        await persistState(failed);
      } finally {
        runningRef.current = false;
      }
    },
    [state.progress], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Reset to idle ────────────────────────────────────────────────
  const reset = useCallback(async () => {
    abortRef.current = true;
    const idle: OperationState = { status: "idle" };
    setState(idle);
    await persistState(idle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = state.status === "running";
  const isInterrupted = state.status === "interrupted";

  return { state, run, reset, isActive, isInterrupted };
}
