export function isPdfBackfillComplete(remaining: number): boolean {
  return remaining <= 0;
}

/** PDF_BACKFILL.mode = "indra_rescan" re-OCRs every PDF instead of filling unsampled ones. */
export function isPdfRescanMode(config: Record<string, unknown> | null | undefined): boolean {
  return config?.mode === "indra_rescan";
}

/** The rescan yields from 12:30 to 3:00 AM New York time, around the 1:00 AM nightly grouping. */
export function isPdfRescanQuietHour(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const minutes = hour * 60 + minute;
  return minutes >= 30 && minutes < 180;
}
