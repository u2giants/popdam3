import { useState, useEffect } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScanProgress } from "@/hooks/useScanProgress";
import { cn } from "@/lib/utils";

interface ScanMonitorBannerProps {
  scanProgress: ScanProgress;
  onStopScan: () => void;
}

function truncatePath(p: string | undefined): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

function useElapsed(updatedAt: string | undefined, active: boolean): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!updatedAt) return "0:00";
  // We approximate scan start as updated_at minus some offset,
  // but really we just show how long since first update
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

function CounterChip({ label, value, variant }: { label: string; value: number; variant?: "error" }) {
  if (variant === "error" && value === 0) return null;
  return (
    <span className={cn("whitespace-nowrap", variant === "error" && "text-destructive font-medium")}>
      <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-muted-foreground ml-0.5">{label}</span>
    </span>
  );
}

export default function ScanMonitorBanner({ scanProgress, onStopScan }: ScanMonitorBannerProps) {
  const isRunning = scanProgress.status === "running";
  const isStale = scanProgress.status === "stale";
  if (!isRunning && !isStale) return null;

  const c = scanProgress.counters;
  const elapsed = useElapsed(scanProgress.updated_at, isRunning || isStale);
  const truncated = truncatePath(scanProgress.current_path);

  return (
    <div className="relative border-b border-border bg-card overflow-hidden">
      {/* Animated gradient line at top */}
      <div className="absolute inset-x-0 top-0 h-[2px]">
        <div
          className={cn(
            "h-full w-[200%] bg-gradient-to-r",
            isStale
              ? "from-transparent via-[hsl(var(--warning))] to-transparent"
              : "from-transparent via-primary to-transparent",
            "animate-[shimmer_2s_linear_infinite]",
          )}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-2 text-xs flex-wrap">
        {/* Status */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              isStale ? "bg-[hsl(var(--warning))]" : "bg-[hsl(var(--success))] animate-pulse",
            )}
          />
          <span className="font-medium">
            {isStale ? "Scan stuck" : "Scanning"}
          </span>
          <span className="text-muted-foreground tabular-nums">{elapsed}</span>
        </div>

        {/* Separator */}
        <span className="text-muted-foreground/40">|</span>

        {/* Counters */}
        {c && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <CounterChip label="seen" value={c.files_total_encountered ?? c.files_checked} />
            <CounterChip label="found" value={c.candidates_found} />
            <CounterChip label="new" value={c.ingested_new} />
            <CounterChip label="updated" value={c.updated_existing} />
            <CounterChip label="moved" value={c.moved_detected} />
            <CounterChip label="errors" value={c.errors} variant="error" />
          </div>
        )}

        {/* Separator */}
        {truncated && <span className="text-muted-foreground/40">|</span>}

        {/* Current path */}
        {truncated && (
          <span className="text-muted-foreground font-mono truncate min-w-0 max-w-[200px]" title={scanProgress.current_path}>
            {truncated}
          </span>
        )}

        {/* Stop button */}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-destructive hover:text-destructive shrink-0"
          onClick={onStopScan}
        >
          <Square className="h-3 w-3 mr-1" /> Stop
        </Button>
      </div>
    </div>
  );
}
