/**
 * Per-file scan errors kept for the final scan report (#1195). Docker stdout is
 * the only other copy of these strings, so the summary travels with the terminal
 * scan-progress call and lands in SCAN_HISTORY.
 */
export interface ErrorCollector {
  add(file: string, message: string): void;
  reset(): void;
  /** Joined summary of the retained entries; empty when nothing failed. */
  summary(): string;
}

export function createErrorCollector(max = 8, perEntry = 180): ErrorCollector {
  const entries: string[] = [];
  return {
    add(file, message) {
      entries.push(`${file}: ${message}`.slice(0, perEntry));
      if (entries.length > max) entries.shift();
    },
    reset() {
      entries.length = 0;
    },
    summary() {
      return entries.join(" | ");
    },
  };
}
