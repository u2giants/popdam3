import { useState, useEffect, useRef } from "react";
import { useAdminApi } from "./useAdminApi";
import type { ScanCounters } from "./useAgentStatus";

export type ScanProgressStatus = "idle" | "queued" | "running" | "completed" | "failed" | "stale";

export interface ScanProgress {
  status: ScanProgressStatus;
  session_id?: string;
  counters?: ScanCounters;
  current_path?: string;
  updated_at?: string;
}

const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

const POLL_IDLE_MS = 15_000;
const POLL_ACTIVE_MS = 5_000;
const POLL_QUEUED_MS = 5_000;

/**
 * Polls admin-api get-config for SCAN_PROGRESS + SCAN_REQUEST every 5-15s.
 * Returns the current scan progress state, including a synthetic "queued"
 * status when a scan request exists but progress hasn't started yet.
 */
export function useScanProgress(): ScanProgress {
  const [progress, setProgress] = useState<ScanProgress>({ status: "idle" });
  const { call } = useAdminApi();
  const prevStatusRef = useRef<ScanProgressStatus>("idle");

  useEffect(() => {
    let mounted = true;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const data = await call("get-config", { keys: ["SCAN_PROGRESS", "SCAN_REQUEST"] });
        if (!mounted) return;

        const raw = data?.config?.SCAN_PROGRESS?.value;
        const rawRequest = data?.config?.SCAN_REQUEST?.value;

        if (raw && typeof raw === "object") {
          const sp = raw as Record<string, unknown>;
          let status = (sp.status as ScanProgressStatus) || "idle";
          const updatedAt = sp.updated_at as string | undefined;

          // Staleness detection: if "running" but no update in 3+ minutes
          if (status === "running" && updatedAt) {
            const elapsed = Date.now() - new Date(updatedAt).getTime();
            if (elapsed > STALE_THRESHOLD_MS) {
              status = "stale";
            }
          }

          // Synthetic "queued" status: request exists but progress is idle
          if (
            (status === "idle" || !status) &&
            rawRequest &&
            typeof rawRequest === "object"
          ) {
            const reqStatus = (rawRequest as Record<string, unknown>).status as string | undefined;
            if (reqStatus === "pending" || reqStatus === "claimed") {
              status = "queued";
            }
          }

          setProgress({
            status,
            session_id: sp.session_id as string | undefined,
            counters: sp.counters as ScanCounters | undefined,
            current_path: sp.current_path as string | undefined,
            updated_at: updatedAt,
          });
          prevStatusRef.current = status;
        } else {
          // No SCAN_PROGRESS — check if there's a pending request
          let status: ScanProgressStatus = "idle";
          if (rawRequest && typeof rawRequest === "object") {
            const reqStatus = (rawRequest as Record<string, unknown>).status as string | undefined;
            if (reqStatus === "pending" || reqStatus === "claimed") {
              status = "queued";
            }
          }
          setProgress({ status });
          prevStatusRef.current = status;
        }
      } catch {
        // silently ignore polling errors
      }

      if (!mounted) return;
      const interval =
        prevStatusRef.current === "running" ? POLL_ACTIVE_MS :
        prevStatusRef.current === "queued" ? POLL_QUEUED_MS :
        POLL_IDLE_MS;
      timerId = setTimeout(poll, interval);
    };

    poll();
    return () => {
      mounted = false;
      clearTimeout(timerId);
    };
  }, [call]);

  return progress;
}
