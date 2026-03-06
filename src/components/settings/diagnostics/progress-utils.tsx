import React from "react";

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatEta(remainingItems: number, ratePerMin: number): string {
  if (ratePerMin <= 0) return "calculating…";
  const mins = remainingItems / ratePerMin;
  if (mins < 1) return "<1 min";
  if (mins < 60) return `~${Math.round(mins)} min`;
  return `~${(mins / 60).toFixed(1)} hrs`;
}

export function calcRate(done: number, elapsedMs: number): number | null {
  if (elapsedMs < 10_000 || done === 0) return null;
  return done / (elapsedMs / 60_000);
}

export function ProgressRow({ label, done, total, ratePerMin, suffix = "assets" }: {
  label: string; done: number; total: number | null; ratePerMin: number | null; suffix?: string;
}) {
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium tabular-nums">
          {done.toLocaleString()}{total ? ` / ${total.toLocaleString()} ${suffix}` : ` ${suffix}`}
          {pct !== null ? <span className="text-muted-foreground ml-1">({pct}%)</span> : null}
        </span>
      </div>
      {pct !== null && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }} />
        </div>
      )}
      {ratePerMin !== null && ratePerMin > 0 && total && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(ratePerMin).toLocaleString()} {suffix}/min</span>
          <span>ETA: {formatEta(total - done, ratePerMin)}</span>
        </div>
      )}
    </div>
  );
}
