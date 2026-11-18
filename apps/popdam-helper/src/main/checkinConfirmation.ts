/**
 * A check-in is only finished once helper-api confirms it saved the record.
 * Anything else (missing ok, unknown status) is ambiguous: keep the queued job
 * and its snapshot so the upload queue retries; the server route is idempotent.
 */
export type ConfirmedCheckinStatus = "verifying" | "complete";

export function confirmedCheckinStatus(result: unknown): ConfirmedCheckinStatus {
  const r = result as { ok?: unknown; status?: unknown } | null | undefined;
  if (r?.ok === true && (r.status === "verifying" || r.status === "complete")) {
    return r.status;
  }
  throw new Error(`Check-in not confirmed by server: ${JSON.stringify(result ?? null)}`);
}
