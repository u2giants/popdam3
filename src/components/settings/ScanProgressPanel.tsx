import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Clock, Square, Ban, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Called when user clicks Stop */
  onStop?: () => void;
  /** Whether stop is in progress */
  stopPending?: boolean;
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
  if (parts.length <= 3) return parts.join("/");
  return "…/" + parts.slice(-3).join("/");
}

export function ScanProgressPanel({
  scanRequest, triggerPending, label,
  staleThresholdMs = 10 * 60 * 1000,
  onStop, stopPending,
}: ScanProgressPanelProps) {
  const [now, setNow] = useState(Date.now());

  const status = (scanRequest?.status as string) || "idle";
  const isActive = status === "pending" || status === "claimed";
  const isCompleted = status === "completed";
  const isError = status === "error";
  const isCancelled = status === "cancelled";

  useEffect(() => {
    if (!isActive && !triggerPending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, triggerPending]);

  // Don't render anything if idle and not triggering
  if (!isActive && !triggerPending && !isCompleted && !isError && !isCancelled) return null;

  const claimedAt = scanRequest?.claimed_at as string | undefined;
  const completedAt = scanRequest?.completed_at as string | undefined;
  const cancelledAt = scanRequest?.cancelled_at as string | undefined;
  const updatedAt = scanRequest?.updated_at as string | undefined;
  const scanError = scanRequest?.error as string | undefined;

  // Progress counters from agent
  const progress = (scanRequest?.progress as Record<string, unknown>) || {};
  const filesChecked = (progress.files_checked as number) || 0;
  const dirsScanned = (progress.dirs_scanned as number) || 0;
  const findingsCount = (progress.findings_count as number) || (scanRequest?.findings_so_far as number) || 0;
  const currentFile = (progress.current_file as string) || (progress.current_dir as string) || "";
  const totalFiles = (scanRequest?.total_files as number) || 0;
  const totalFindings = (scanRequest?.total_findings as number) || (scanRequest?.findings_so_far as number) || 0;
  const errorCount = (progress.errors as number) || 0;
  const skippedCount = (progress.skipped as number) || 0;

  // Elapsed time
  const startTime = claimedAt ? new Date(claimedAt).getTime() : 0;
  const endTime = isCompleted || isError || isCancelled
    ? (completedAt ? new Date(completedAt).getTime() : (cancelledAt ? new Date(cancelledAt).getTime() : now))
    : now;
  const elapsed = startTime > 0 ? endTime - startTime : 0;

  // Stale detection
  const lastUpdate = updatedAt ? new Date(updatedAt).getTime() : 0;
  const isStale = isActive && lastUpdate > 0 && (now - lastUpdate) > staleThresholdMs;

  // Waiting for agent (pending but not yet claimed)
  const isWaiting = status === "pending" || triggerPending;

  // Rate
  const rate = elapsed > 10000 && filesChecked > 0
    ? Math.round(filesChecked / (elapsed / 60000))
    : 0;

  return (
    <div className={cn(
      "rounded-md border p-3 space-y-2 text-xs",
      isCancelled ? "border-muted-foreground/30 bg-muted/30" :
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
          {isCancelled && (
            <>
              <Ban className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-muted-foreground">{label} scan cancelled</span>
            </>
          )}
          {isError && (
            <>
              <XCircle className="h-3.5 w-3.5 text-destructive" />
              <span className="font-medium text-destructive">{label} scan failed</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {elapsed > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          )}
          {isActive && onStop && (
            <Button
              variant="destructive" size="sm"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={onStop}
              disabled={stopPending}
            >
              <Square className="h-2.5 w-2.5" /> Stop
            </Button>
          )}
        </div>
      </div>

      {/* Counters */}
      {(filesChecked > 0 || dirsScanned > 0 || totalFiles > 0 || totalFindings > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground font-mono">
          {filesChecked > 0 && (
            <span>.ai files checked: <span className="text-foreground font-semibold tabular-nums">{filesChecked.toLocaleString()}</span></span>
          )}
          {(findingsCount > 0 || totalFindings > 0) && (
            <span>Findings: <span className="text-foreground font-semibold tabular-nums">{(totalFindings || findingsCount).toLocaleString()}</span></span>
          )}
          {dirsScanned > 0 && (
            <span>Dirs scanned: <span className="text-foreground font-semibold tabular-nums">{dirsScanned.toLocaleString()}</span></span>
          )}
          {errorCount > 0 && (
            <span>Errors: <span className="text-destructive font-semibold tabular-nums">{errorCount.toLocaleString()}</span></span>
          )}
          {skippedCount > 0 && (
            <span>Skipped: <span className="text-muted-foreground font-semibold tabular-nums">{skippedCount.toLocaleString()}</span></span>
          )}
          {isCompleted && totalFiles > 0 && (
            <span>Total files: <span className="text-foreground font-semibold tabular-nums">{totalFiles.toLocaleString()}</span></span>
          )}
        </div>
      )}

      {/* Rate calculation */}
      {isActive && rate > 0 && (
        <div className="text-muted-foreground font-mono">
          Rate: <span className="text-foreground tabular-nums">{rate.toLocaleString()}</span> files/min
        </div>
      )}

      {/* Current file — very important for visibility */}
      {isActive && currentFile && (
        <div className="flex items-center gap-1.5 font-mono">
          <span className="text-muted-foreground shrink-0">Inspecting:</span>
          <span className="text-foreground/80 truncate" title={currentFile}>
            {truncatePath(currentFile)}
          </span>
        </div>
      )}

      {/* No progress yet warning */}
      {isActive && claimedAt && filesChecked === 0 && !currentFile && (
        <p className="text-muted-foreground">
          Agent claimed the scan but hasn't reported progress yet. This could mean it's still traversing directories
          or waiting for Illustrator to open the first file (can take 30-60s).
        </p>
      )}

      {/* Stale warning */}
      {isStale && (
        <p className="text-[hsl(var(--warning))]">
          No update from the agent in {formatElapsed(now - lastUpdate)}. The agent may have crashed or lost connectivity.{" "}
          <Link to="/settings/scan-diagnostics" className="underline underline-offset-2 hover:no-underline inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> View diagnostics
          </Link>
        </p>
      )}

      {/* Error message */}
      {isError && scanError && (
        <p className="text-destructive">{scanError}</p>
      )}

      {/* Cancelled message */}
      {isCancelled && (
        <p className="text-muted-foreground">
          Scan was stopped. {filesChecked > 0 ? `Checked ${filesChecked} files before stopping.` : ""}
          {totalFindings > 0 ? ` Found ${totalFindings} issue(s).` : ""}
        </p>
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
