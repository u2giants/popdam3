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

function parseScanProgress(
  raw: unknown,
  rawRequest: unknown,
): ScanProgress {
  if (raw && typeof raw === "object") {
    const sp = raw as Record<string, unknown>;
    let status = (sp.status as ScanProgressStatus) || "idle";
    const updatedAt = sp.updated_at as string | undefined;

    // Staleness detection
    if (status === "running" && updatedAt) {
      const elapsed = Date.now() - new Date(updatedAt).getTime();
      if (elapsed > STALE_THRESHOLD_MS) {
        status = "stale";
      }
    }

    // Synthetic "queued" status
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

    return {
      status,
      session_id: sp.session_id as string | undefined,
      counters: sp.counters as ScanCounters | undefined,
      current_path: sp.current_path as string | undefined,
      updated_at: updatedAt,
      skipped_dirs: Array.isArray(sp.skipped_dirs) ? sp.skipped_dirs as string[] : undefined,
    };
  }

  // No SCAN_PROGRESS — check if there's a pending request
  let status: ScanProgressStatus = "idle";
  if (rawRequest && typeof rawRequest === "object") {
    const reqStatus = (rawRequest as Record<string, unknown>).status as string | undefined;
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
