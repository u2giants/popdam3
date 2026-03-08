import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScanProgressPanelProps {
  /** Raw config value from the scan request key */
  scanRequest: Record<string, unknown> | undefined;
  /** Whether the local trigger mutation is pending */
  triggerPending: boolean;
  /** Human-readable label, e.g. "File Hygiene" or "TIFF" */
  label: string;
  /** Override stale threshold (ms). Default 10 min. */
  staleThresholdMs?: number;
}

function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function truncatePath(p: string | undefined): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

export function ScanProgressPanel({ scanRequest, triggerPending, label, staleThresholdMs = 10 * 60 * 1000 }: ScanProgressPanelProps) {
  const [now, setNow] = useState(Date.now());

  const status = (scanRequest?.status as string) || "idle";
  const isActive = status === "pending" || status === "claimed";
  const isCompleted = status === "completed";
  const isError = status === "error";

  useEffect(() => {
    if (!isActive && !triggerPending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, triggerPending]);

  // Don't render anything if idle and not triggering
  if (!isActive && !triggerPending && !isCompleted && !isError) return null;

  const claimedAt = scanRequest?.claimed_at as string | undefined;
  const completedAt = scanRequest?.completed_at as string | undefined;
  const updatedAt = scanRequest?.updated_at as string | undefined;
  const scanError = scanRequest?.error as string | undefined;

  // Progress counters from agent
  const progress = (scanRequest?.progress as Record<string, unknown>) || {};
  const filesChecked = (progress.files_checked as number) || 0;
  const dirsScanned = (progress.dirs_scanned as number) || 0;
  const filesFound = (progress.files_found as number) || (scanRequest?.files_reported_so_far as number) || 0;
  const findingsCount = (progress.findings_count as number) || (scanRequest?.findings_so_far as number) || 0;
  const currentFile = (progress.current_file as string) || (progress.current_dir as string) || "";
  const totalFiles = (scanRequest?.total_files as number) || 0;
  const totalFindings = (scanRequest?.total_findings as number) || 0;

  // Elapsed time
  const startTime = claimedAt ? new Date(claimedAt).getTime() : 0;
  const endTime = isCompleted || isError
    ? (completedAt ? new Date(completedAt).getTime() : now)
    : now;
  const elapsed = startTime > 0 ? endTime - startTime : 0;

  // Stale detection
  const lastUpdate = updatedAt ? new Date(updatedAt).getTime() : 0;
  const isStale = isActive && lastUpdate > 0 && (now - lastUpdate) > staleThresholdMs;

  // Waiting for agent (pending but not yet claimed)
  const isWaiting = status === "pending" || triggerPending;

  return (
    <div className={cn(
      "rounded-md border p-3 space-y-2 text-xs",
      isError ? "border-destructive/40 bg-destructive/5" :
      isStale ? "border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.05)]" :
      isCompleted ? "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.05)]" :
      "border-primary/30 bg-primary/5"
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isWaiting && !claimedAt && (
            <>
              <Clock className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
              <span className="font-medium text-muted-foreground">Waiting for agent…</span>
            </>
          )}
          {isActive && claimedAt && !isStale && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="font-medium text-primary">{label} scan running</span>
            </>
          )}
          {isStale && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
              <span className="font-medium text-[hsl(var(--warning))]">{label} scan may be stuck</span>
            </>
          )}
          {isCompleted && (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
              <span className="font-medium text-[hsl(var(--success))]">{label} scan complete</span>
            </>
          )}
          {isError && (
            <>
              <XCircle className="h-3.5 w-3.5 text-destructive" />
              <span className="font-medium text-destructive">{label} scan failed</span>
            </>
          )}
        </div>
        {elapsed > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      {/* Counters */}
      {(filesChecked > 0 || filesFound > 0 || dirsScanned > 0 || totalFiles > 0 || totalFindings > 0) && (
        <div className="flex flex-wrap gap-3 text-muted-foreground">
          {filesChecked > 0 && (
            <span>Files checked: <span className="text-foreground font-semibold tabular-nums">{filesChecked.toLocaleString()}</span></span>
          )}
          {filesFound > 0 && (
            <span>TIFFs found: <span className="text-foreground font-semibold tabular-nums">{filesFound.toLocaleString()}</span></span>
          )}
          {findingsCount > 0 && (
            <span>Findings: <span className="text-foreground font-semibold tabular-nums">{findingsCount.toLocaleString()}</span></span>
          )}
          {dirsScanned > 0 && (
            <span>Dirs: <span className="text-foreground font-semibold tabular-nums">{dirsScanned.toLocaleString()}</span></span>
          )}
          {isCompleted && totalFiles > 0 && (
            <span>Total files: <span className="text-foreground font-semibold tabular-nums">{totalFiles.toLocaleString()}</span></span>
          )}
          {isCompleted && totalFindings > 0 && (
            <span>Total findings: <span className="text-foreground font-semibold tabular-nums">{totalFindings.toLocaleString()}</span></span>
          )}
        </div>
      )}

      {/* Rate calculation */}
      {isActive && elapsed > 10000 && (filesChecked > 0 || filesFound > 0) && (
        <div className="text-muted-foreground">
          Rate: <span className="text-foreground tabular-nums">
            {Math.round(((filesChecked || filesFound) / (elapsed / 60000))).toLocaleString()}
          </span> files/min
        </div>
      )}

      {/* Current file */}
      {isActive && currentFile && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground shrink-0">Current:</span>
          <span className="font-mono text-muted-foreground truncate" title={currentFile}>
            {truncatePath(currentFile)}
          </span>
        </div>
      )}

      {/* Stale warning */}
      {isStale && (
        <p className="text-[hsl(var(--warning))]">
          No update from the agent in {formatElapsed(now - lastUpdate)}. The agent may have crashed or lost connectivity. Check Docker logs.
        </p>
      )}

      {/* Error message */}
      {isError && scanError && (
        <p className="text-destructive">{scanError}</p>
      )}

      {/* Waiting hint */}
      {isWaiting && !claimedAt && (
        <p className="text-muted-foreground">
          Scan request sent. The Windows Agent will pick it up on the next heartbeat (~30s).
          If nothing happens after 2 minutes, check that the agent is running and connected.
        </p>
      )}
    </div>
  );
}
