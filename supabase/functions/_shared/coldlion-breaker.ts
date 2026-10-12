/**
 * Short-lived circuit breaker for the live ColdLion API.
 *
 * During a ColdLion outage every call waits for its full fetch timeout. Bulk
 * callers (scan ingest calls parseSku once per file) then spend 15-30 seconds
 * per file and fail, which stalled the 2026-10-11 full scan for hours. After a
 * failure the breaker stays open for `cooldownMs`; callers fail fast and use
 * their fallback until one probe call is allowed again.
 */
export class ColdLionBreaker {
  private openUntil = 0;
  private lastError = "";

  constructor(private readonly cooldownMs = 120_000, private readonly now: () => number = Date.now) {}

  /** Throws immediately while the breaker is open. */
  assertClosed(what: string): void {
    if (this.now() < this.openUntil) {
      throw new Error(`ColdLion API skipped for ${what}: breaker open after recent failure (${this.lastError})`);
    }
  }

  recordFailure(message: string): void {
    this.lastError = message;
    this.openUntil = this.now() + this.cooldownMs;
  }

  recordSuccess(): void {
    this.openUntil = 0;
    this.lastError = "";
  }

  isOpen(): boolean {
    return this.now() < this.openUntil;
  }
}
