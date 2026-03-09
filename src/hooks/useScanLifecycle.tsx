import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useAdminApi } from "./useAdminApi";
import type { ScanProgress, ScanProgressStatus } from "./useScanProgress";

export interface ScanLifecycleState {
  scanTriggered: boolean;
  scanRunning: boolean;
  scanQueued: boolean;
  lastScanStatus: "completed" | "completed_with_errors" | "failed" | null;
  lastScanTime: string | null;
  lastScanSummary: string | null;
  handleSync: () => Promise<void>;
  handleStopScan: () => Promise<void>;
}

/**
 * Manages scan lifecycle: trigger/stop scans, detect status transitions,
 * show toast notifications, and invalidate queries on completion.
 */
export function useScanLifecycle(scanProgress: ScanProgress & { pollNow: () => void }): ScanLifecycleState {
  const queryClient = useQueryClient();
  const { call } = useAdminApi();

  const [scanTriggered, setScanTriggered] = useState(false);
  const [lastScanStatus, setLastScanStatus] = useState<"completed" | "completed_with_errors" | "failed" | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [lastScanSummary, setLastScanSummary] = useState<string | null>(null);

  const scanRunning = scanProgress.status === "running" || scanProgress.status === "stale";
  const scanQueued = scanProgress.status === "queued";

  // ── Scan outcome notifications ──────────────────────────────────
  const prevScanStatusRef = useRef<ScanProgressStatus>(scanProgress.status);
  useEffect(() => {
    const prev = prevScanStatusRef.current;
    const curr = scanProgress.status;
    prevScanStatusRef.current = curr;

    if (prev === curr) return;

    // Scan started running
    if (curr === "running" && (prev === "queued" || prev === "idle")) {
      toast({ title: "Scan started", description: "The Bridge Agent is scanning the NAS…" });
    }

    // Scan completed
    if (curr === "completed" || curr === "completed_with_errors" || (curr === "idle" && (prev === "running" || prev === "queued"))) {
      setScanTriggered(false);
      const c = scanProgress.counters;
      let summary = "";
      if (c) {
        const parts: string[] = [];
        if (c.files_checked) parts.push(`${c.files_checked.toLocaleString()} files checked`);
        if (c.ingested_new) parts.push(`${c.ingested_new} new`);
        if (c.updated_existing) parts.push(`${c.updated_existing} updated`);
        if (c.moved_detected) parts.push(`${c.moved_detected} moved`);
        if (c.errors && curr === "completed_with_errors") parts.push(`${c.errors} errors`);
        summary = parts.length > 0 ? parts.join(", ") : "Nothing new to sync";

        if (curr === "completed_with_errors") {
          toast({
            title: "Scan completed with errors",
            description: (
              <span>
                {summary}.{" "}
                <a href="/settings/scan-diagnostics" className="underline underline-offset-2 hover:no-underline">
                  View details
                </a>
              </span>
            ),
          });
        } else {
          toast({ title: "Scan complete", description: summary });
        }
      } else {
        summary = "Nothing new to sync — all assets are up to date.";
        toast({ title: "Scan complete", description: summary });
      }

      setLastScanStatus(curr === "completed_with_errors" ? "completed_with_errors" : "completed");
      setLastScanTime(new Date().toISOString());
      setLastScanSummary(summary);

      // Refresh library data
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["filter-counts"] });
    }

    // Scan failed
    if (curr === "failed") {
      setScanTriggered(false);
      toast({
        title: "Scan failed",
        description: (
          <span>
            Something went wrong.{" "}
            <a href="/settings/scan-diagnostics" className="underline underline-offset-2 hover:no-underline">
              View diagnostics
            </a>
          </span>
        ),
        variant: "destructive",
      });
      setLastScanStatus("failed");
      setLastScanTime(scanProgress.updated_at || new Date().toISOString());
      setLastScanSummary("Scan failed — check diagnostics");
    }

    // Stale detection
    if (curr === "stale" && prev === "running") {
      toast({
        title: "Scan appears stuck",
        description: "No progress in 3+ minutes. Use 'Reset Scan State' in Settings if needed.",
        variant: "destructive",
      });
    }
  }, [scanProgress.status, scanProgress.counters, scanProgress.updated_at, queryClient]);

  // Clear scanTriggered once the scan is picked up
  useEffect(() => {
    if (scanTriggered && (scanProgress.status === "running" || scanProgress.status === "queued")) {
      setScanTriggered(false);
    }
  }, [scanTriggered, scanProgress.status]);

  // Safety timeout for scanTriggered
  useEffect(() => {
    if (!scanTriggered) return;
    const timer = setTimeout(() => setScanTriggered(false), 120_000);
    return () => clearTimeout(timer);
  }, [scanTriggered]);

  const handleSync = useCallback(async () => {
    try {
      await call("trigger-scan");
      setScanTriggered(true);
      setTimeout(() => scanProgress.pollNow(), 500);
      toast({ title: "Scan triggered", description: "The Bridge Agent will start scanning on its next poll (~30s)." });
    } catch (e) {
      toast({ title: "Failed to trigger scan", description: (e as Error).message, variant: "destructive" });
    }
  }, [call, scanProgress.pollNow]);

  const handleStopScan = useCallback(async () => {
    try {
      await call("stop-scan");
      toast({ title: "Stop requested", description: "The agent will abort the current scan shortly." });
    } catch (e) {
      toast({ title: "Failed to stop scan", description: (e as Error).message, variant: "destructive" });
    }
  }, [call]);

  return {
    scanTriggered,
    scanRunning,
    scanQueued,
    lastScanStatus,
    lastScanTime,
    lastScanSummary,
    handleSync,
    handleStopScan,
  };
}
