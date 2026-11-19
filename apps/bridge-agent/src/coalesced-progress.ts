/**
 * Single-flight reporter for fire-and-forget "running" scan progress (#1186).
 *
 * Progress updates were sent without waiting, each with transport retries. When
 * the cloud API slowed, hundreds piled up and added load while real ingest calls
 * timed out. Only one update is in flight at a time; a newer update replaces any
 * waiting one, and the latest is always sent once the current call settles.
 */
export function createCoalescedReporter<T>(send: (value: T) => Promise<void>) {
  let inFlight: Promise<void> | null = null;
  let pending: { value: T } | null = null;

  const drain = (): void => {
    if (inFlight || !pending) return;
    const { value } = pending;
    pending = null;
    inFlight = send(value)
      .catch(() => {})
      .finally(() => {
        inFlight = null;
        drain();
      });
  };

  return {
    report(value: T): void {
      pending = { value };
      drain();
    },
    /** Resolves once nothing is in flight or waiting. */
    async idle(): Promise<void> {
      while (inFlight) await inFlight;
    },
  };
}
