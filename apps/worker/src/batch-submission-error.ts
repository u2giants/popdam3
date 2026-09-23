/** The provider may have accepted a non-idempotent POST, but no durable ID was obtained. */
export class AmbiguousBatchSubmissionError extends Error {
  constructor(provider: string, public status?: number) {
    super(`${provider} batch submission outcome is ambiguous${typeof status === "number" ? ` (HTTP ${status})` : ""}; automatic resubmission is disabled`);
    this.name = "AmbiguousBatchSubmissionError";
  }
}

export type DefinitiveRejectionStatus = 400 | 422;

/**
 * The provider itself answered the submission POST with a parsed validation
 * rejection (HTTP 400/422 whose JSON error body echoes the same status code).
 * Only this proves no batch was created, so only this may consume the
 * submission receipt through reset_bulk_operation_submission_lease.
 * `providerError` is a sanitized summary: never the raw body, which may echo
 * prompts, media or credentials.
 */
export class DefinitiveBatchRejectionError extends Error {
  constructor(
    public provider: string,
    public status: DefinitiveRejectionStatus,
    public providerError: Record<string, string | number>,
  ) {
    super(`${provider} rejected the batch submission (HTTP ${status})`);
    this.name = "DefinitiveBatchRejectionError";
  }
}

/**
 * Classify a non-2xx submission response. Returns a definitive rejection only
 * when the status is 400/422 AND the body parses as the provider's own error
 * envelope (`{ "error": { "code": <same status>, ... } }`); a proxy or gateway
 * page does not carry that envelope. Everything else (other 4xx, 5xx, an
 * unparseable body) stays ambiguous: the database lease must expire into
 * ambiguous_submission rather than be reset.
 */
export function classifySubmissionHttpFailure(
  provider: string,
  status: number,
  bodyText: string | undefined,
): DefinitiveBatchRejectionError | AmbiguousBatchSubmissionError {
  if ((status === 400 || status === 422) && typeof bodyText === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = undefined;
    }
    const envelope = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).error
      : undefined;
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const record = envelope as Record<string, unknown>;
      const code = typeof record.code === "string" ? Number(record.code) : record.code;
      if (code === status) {
        const summary: Record<string, string | number> = { provider, code: status };
        if (typeof record.status === "string" && /^[A-Z_]{1,64}$/.test(record.status)) summary.status = record.status;
        return new DefinitiveBatchRejectionError(provider, status, summary);
      }
    }
  }
  return new AmbiguousBatchSubmissionError(provider, status);
}

/**
 * A local failure after the submission receipt was minted but before any
 * provider request was sent. Nothing exists at the provider, so the worker
 * keeps its in-memory receipt, renews the lease as the same owner, rebuilds the
 * payload and retries; it never resets or abandons the lease for this.
 */
export class PreSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreSubmissionError";
  }
}
