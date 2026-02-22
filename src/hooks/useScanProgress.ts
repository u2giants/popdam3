import { useState, useEffect, useRef } from "react";
import { useAdminApi } from "./useAdminApi";
import type { ScanCounters } from "./useAgentStatus";

export type ScanProgressStatus = "idle" | "running" | "completed" | "failed";

export interface ScanProgress {
  status: ScanProgressStatus;
  session_id?: string;
  counters?: ScanCounters;
  current_path?: string;
  updated_at?: string;
}

const POLL_IDLE_MS = 15_000;
const POLL_ACTIVE_MS = 5_000;

/**
 * Polls admin-api get-config for SCAN_PROGRESS every 5-15s.
 * Returns the current scan progress state.
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
        const data = await call("get-config", { keys: ["SCAN_PROGRESS"] });
        if (!mounted) return;

        const raw = data?.config?.SCAN_PROGRESS?.value;
        if (raw && typeof raw === "object") {
          const sp = raw as Record<string, unknown>;
          const status = (sp.status as ScanProgressStatus) || "idle";
          setProgress({
            status,
            session_id: sp.session_id as string | undefined,
            counters: sp.counters as ScanCounters | undefined,
            current_path: sp.current_path as string | undefined,
            updated_at: sp.updated_at as string | undefined,
          });
          prevStatusRef.current = status;
        } else {
          setProgress({ status: "idle" });
          prevStatusRef.current = "idle";
        }
      } catch {
        // silently ignore polling errors
      }

      if (!mounted) return;
      const interval = prevStatusRef.current === "running" ? POLL_ACTIVE_MS : POLL_IDLE_MS;
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
