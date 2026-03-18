import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "./useAdminApi";
import type { ScanCounters } from "./useAgentStatus";

export type ScanProgressStatus = "idle" | "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "stale";

export interface ScanProgress {
  status: ScanProgressStatus;
  session_id?: string;
  counters?: ScanCounters;
  current_path?: string;
  updated_at?: string;
  skipped_dirs?: string[];
}

const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

const DEFAULT_PROGRESS: ScanProgress = { status: "idle" };

const TERMINAL_REQUEST_STATUSES = new Set(["completed", "completed_with_errors", "failed"]);

function parseScanProgress(
  raw: unknown,
  rawRequest: unknown,
): ScanProgress {
  // Extract SCAN_REQUEST terminal info for cross-referencing
  const reqObj = (rawRequest && typeof rawRequest === "object") ? rawRequest as Record<string, unknown> : null;
  const reqStatus = reqObj?.status as string | undefined;
  const reqSessionId = reqObj?.request_id as string | undefined;

  if (raw && typeof raw === "object") {
    const sp = raw as Record<string, unknown>;
    let status = (sp.status as ScanProgressStatus) || "idle";
    const updatedAt = sp.updated_at as string | undefined;
    const progressSessionId = sp.session_id as string | undefined;

    // ── Cross-reference fix: if SCAN_REQUEST is terminal but SCAN_PROGRESS
    // is still "running" for the same session, trust SCAN_REQUEST.
    // This handles the race condition where fire-and-forget "running" updates
    // overwrite the terminal status in the database.
    if (
      status === "running" &&
      reqStatus &&
      TERMINAL_REQUEST_STATUSES.has(reqStatus) &&
      progressSessionId &&
      reqSessionId === progressSessionId
    ) {
      status = reqStatus as ScanProgressStatus;
    }

    // Staleness detection (only if still "running" after cross-reference)
    if (status === "running" && updatedAt) {
      const elapsed = Date.now() - new Date(updatedAt).getTime();
      if (elapsed > STALE_THRESHOLD_MS) {
        status = "stale";
      }
    }

    // Synthetic "queued" status
    if (
      (status === "idle" || !status) &&
      reqObj
    ) {
      if (reqStatus === "pending" || reqStatus === "claimed") {
        status = "queued";
      }
    }

    return {
      status,
      session_id: progressSessionId,
      counters: sp.counters as ScanCounters | undefined,
      current_path: sp.current_path as string | undefined,
      updated_at: updatedAt,
      skipped_dirs: Array.isArray(sp.skipped_dirs) ? sp.skipped_dirs as string[] : undefined,
    };
  }

  // No SCAN_PROGRESS — check if there's a pending request
  let status: ScanProgressStatus = "idle";
  if (reqObj) {
    if (reqStatus === "pending" || reqStatus === "claimed") {
      status = "queued";
    }
  }
  return { status };
}

/**
 * Polls admin-api get-config for SCAN_PROGRESS + SCAN_REQUEST.
 * Uses React Query with adaptive refetchInterval:
 *   - 5s when scan is active (running/queued/stale)
 *   - 15s when idle
 */
export function useScanProgress(): ScanProgress & { pollNow: () => void } {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["scan-progress"],
    queryFn: async (): Promise<ScanProgress> => {
      try {
        const result = await call("get-config", { keys: ["SCAN_PROGRESS", "SCAN_REQUEST"] });
        const raw = result?.config?.SCAN_PROGRESS?.value ?? result?.config?.SCAN_PROGRESS;
        const rawRequest = result?.config?.SCAN_REQUEST?.value ?? result?.config?.SCAN_REQUEST;
        return parseScanProgress(raw, rawRequest);
      } catch {
        // Silently ignore polling errors — return previous or default
        return queryClient.getQueryData<ScanProgress>(["scan-progress"]) ?? DEFAULT_PROGRESS;
      }
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? "idle";
      if (status === "running" || status === "stale" || status === "queued") return 5_000;
      return 15_000;
    },
    initialData: DEFAULT_PROGRESS,
  });

  const pollNow = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scan-progress"] });
  }, [queryClient]);

  return { ...(data ?? DEFAULT_PROGRESS), pollNow };
}
