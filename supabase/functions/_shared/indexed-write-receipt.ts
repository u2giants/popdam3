/** Aggregate-only, opt-in result receipt for issue #169. */
export function emitIndexedWriteReceipt(
  enabled: boolean,
  table: string,
  path: string,
  attempted: number | null,
  succeeded: number | null,
  log: (label: string, counts: Record<string, string | number | null>) => void = console.info,
  now: () => Date = () => new Date(),
): void {
  if (!enabled) return;
  log("[indexed-write-measurement]", {
    observed_at: now().toISOString(),
    table,
    path,
    attempted_rows: attempted,
    succeeded_rows: succeeded,
  });
}
