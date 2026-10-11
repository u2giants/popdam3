import { useState, useEffect } from "react";
import { Gauge, XCircle, Square, FolderOpen, AlertTriangle, FolderX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useScanProgress, type ScanProgress } from "@/hooks/useScanProgress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function useElapsed(updatedAt: string | undefined, active: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!updatedAt) return "0:00";
  const elapsed = Math.max(0, now - new Date(updatedAt).getTime());
  const totalSec = Math.floor(elapsed / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return `${hr}:${String(rm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function formatTimeAgo(ts: string | undefined): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

export function CounterCell({ label, value, variant, onClick }: { label: string; value: number; variant?: "error" | "warning"; onClick?: () => void }) {
  const content = (
    <div className={cn("flex justify-between items-baseline", onClick && "cursor-pointer hover:bg-muted/50 -mx-1 px-1 rounded")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn(
        "text-sm font-semibold tabular-nums",
        variant === "error" && value > 0 && "text-destructive",
        variant === "warning" && value > 0 && "text-[hsl(var(--warning))]",
        onClick && value > 0 && "underline decoration-dotted underline-offset-2",
      )}>
        {(value ?? 0).toLocaleString()}
      </span>
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} className="text-left">{content}</button> : content;
}

export function LiveScanMonitor() {
  const scanProgress = useScanProgress();
  const { call } = useAdminApi();
  const [lastCompleted, setLastCompleted] = useState<ScanProgress | null>(null);
  const [showSkippedDirs, setShowSkippedDirs] = useState(false);

  // Store last completed/failed scan
  useEffect(() => {
    if (scanProgress.status === "completed" || scanProgress.status === "failed") {
      setLastCompleted(scanProgress);
    }
  }, [scanProgress.status]);

  const isRunning = scanProgress.status === "running";
  const isStale = scanProgress.status === "stale";
  const isActive = isRunning || isStale;
  const elapsed = useElapsed(scanProgress.updated_at, isActive);

  const displayProgress = isActive ? scanProgress : (lastCompleted ?? scanProgress);
  const c = displayProgress.counters;

  const handleStop = async () => {
    try {
      await call("stop-scan");
      toast.success("Stop requested — agent will abort shortly.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to stop scan");
    }
  };

  const handleReset = async () => {
    try {
      await call("reset-scan-state");
      toast.success("Scan state reset.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset scan state");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Live Scan Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicator */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              isRunning && "bg-[hsl(var(--success))] animate-pulse",
              isStale && "bg-[hsl(var(--warning))]",
              scanProgress.status === "completed" && "bg-[hsl(var(--success))]",
              scanProgress.status === "failed" && "bg-destructive",
              scanProgress.status === "idle" && "bg-muted-foreground/40",
            )}
          />
          <span className="text-sm font-medium">
            {isRunning && "Scanning"}
            {isStale && "Scan appears stuck"}
            {scanProgress.status === "completed" && "Last scan completed"}
            {scanProgress.status === "failed" && "Last scan failed"}
            {scanProgress.status === "idle" && "No scan in progress"}
          </span>
          {isActive && (
            <span className="text-xs text-muted-foreground tabular-nums">{elapsed} elapsed</span>
          )}
          {!isActive && displayProgress.updated_at && (
            <span className="text-xs text-muted-foreground">{formatTimeAgo(displayProgress.updated_at)}</span>
          )}
        </div>

        {/* Stale warning */}
        {isStale && (
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))] shrink-0" />
            <span>No progress update for over 3 minutes.</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="ml-auto h-6 text-[10px]" onClick={handleReset}>
                    Reset Scan State
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[240px] text-center">
                  Clears scan request and progress flags only. Does not delete any discovered assets or data.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Counters grid */}
        {c && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-muted/30 px-4 py-3">
            <CounterCell label="Total encountered" value={c.files_total_encountered ?? 0} />
            <CounterCell label="Candidates (.ai/.psd)" value={c.candidates_found} />
            <CounterCell label="New assets" value={c.ingested_new} />
            <CounterCell label="Updated" value={c.updated_existing} />
            <CounterCell label="Moved" value={c.moved_detected} />
            <CounterCell label="Unchanged" value={c.noop_unchanged ?? 0} />
            <CounterCell label="Rejected (subfolder)" value={c.rejected_subfolder ?? 0} />
            <CounterCell label="Errors" value={c.errors} variant="error" />
            <CounterCell label="Skipped dirs (perms)" value={c.dirs_skipped_permission} variant="warning" onClick={c.dirs_skipped_permission > 0 ? () => setShowSkippedDirs(true) : undefined} />
            <CounterCell label="Skipped dirs (excluded)" value={c.dirs_skipped_excluded ?? 0} />
          </div>
        )}

        {/* Skipped directories dialog */}
        <Dialog open={showSkippedDirs} onOpenChange={setShowSkippedDirs}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <FolderX className="h-4 w-4 text-[hsl(var(--warning))]" />
                Skipped Directories ({displayProgress.skipped_dirs?.length ?? 0})
              </DialogTitle>
            </DialogHeader>
            {displayProgress.skipped_dirs && displayProgress.skipped_dirs.length > 0 ? (
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-1 pr-4">
                  {displayProgress.skipped_dirs.map((dir, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-1.5">
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <code className="text-xs font-mono text-foreground break-all">{dir}</code>
                    </div>
                  ))}
                  {(c?.dirs_skipped_permission ?? 0) > (displayProgress.skipped_dirs?.length ?? 0) && (
                    <p className="text-xs text-muted-foreground px-3 py-2">
                      …and {(c?.dirs_skipped_permission ?? 0) - displayProgress.skipped_dirs.length} more (capped at 500)
                    </p>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground py-4">
                Skipped directory paths will appear here after the next scan. The Bridge Agent needs to be updated to collect this data.
              </p>
            )}
          </DialogContent>
        </Dialog>

        {/* Current path */}
        {isActive && displayProgress.current_path && (
          <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <code className="text-xs font-mono text-muted-foreground truncate">{displayProgress.current_path}</code>
          </div>
        )}

        {/* Actions */}
        {isActive && (
          <Button variant="outline" size="sm" onClick={handleStop} className="gap-1.5 text-destructive hover:text-destructive">
            <Square className="h-3.5 w-3.5" /> Stop Scan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
