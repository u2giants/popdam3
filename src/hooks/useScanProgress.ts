import { useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

async function fetchScanProgress(): Promise<ScanProgress> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ["SCAN_PROGRESS", "SCAN_REQUEST"]);

  if (error) throw error;

  const config: Record<string, unknown> = {};
  for (const row of data ?? []) {
    config[row.key] = row.value;
  }

  return parseScanProgress(config.SCAN_PROGRESS, config.SCAN_REQUEST);
}

/**
 * Reads SCAN_PROGRESS + SCAN_REQUEST directly from admin_config via Supabase JS client.
 * Realtime subscription pushes invalidations on any change — no polling.
 * admin_config has USING (true) SELECT RLS so all authenticated users can read it.
 */
export function useScanProgress(): ScanProgress & { pollNow: () => void } {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["scan-progress"],
    queryFn: fetchScanProgress,
    staleTime: Infinity,
    initialData: DEFAULT_PROGRESS,
  });

  useEffect(() => {
    const channel = supabase
      .channel("scan-progress-realtime")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.SCAN_PROGRESS",
      }, () => queryClient.invalidateQueries({ queryKey: ["scan-progress"] }))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.SCAN_REQUEST",
      }, () => queryClient.invalidateQueries({ queryKey: ["scan-progress"] }))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const pollNow = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scan-progress"] });
  }, [queryClient]);

  return { ...(data ?? DEFAULT_PROGRESS), pollNow };
}
