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
 * The provider itself refused the submission for account reasons: auth (401/
 * 403), billing (402) or rate limit (429), proven by its own error envelope.
 * No batch was created, but the governed reset accepts only 400/422, so the
 * operation stops immediately and visibly instead of waiting as ambiguous.
 */
export class ProviderRefusedSubmissionError extends Error {
  constructor(public provider: string, public status: 401 | 402 | 403 | 429) {
    const kind = status === 402 ? "billing" : status === 429 ? "rate limit" : "authorization";
    super(`${provider} refused the batch submission (HTTP ${status}, ${kind}); fix the key, billing or quota, then start a new run`);
    this.name = "ProviderRefusedSubmissionError";
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
): DefinitiveBatchRejectionError | ProviderRefusedSubmissionError | AmbiguousBatchSubmissionError {
  if ([400, 422, 401, 402, 403, 429].includes(status) && typeof bodyText === "string") {
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
      if (code === status && (status === 401 || status === 402 || status === 403 || status === 429)) {
        return new ProviderRefusedSubmissionError(provider, status);
      }
      if (code === status && (status === 400 || status === 422)) {
        const summary: Record<string, string | number> = { provider, code: status };
        if (typeof record.status === "string" && /^[A-Z_]{1,64}$/.test(record.status)) summary.status = record.status;
        return new DefinitiveBatchRejectionError(provider, status as DefinitiveRejectionStatus, summary);
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
  /** `permanent`: retrying cannot help (e.g. nothing usable left to submit). */
  constructor(message: string, public permanent = false) {
    super(message);
    this.name = "PreSubmissionError";
  }
}

/**
 * A provider status GET that never produced a complete, parseable answer:
 * connect/DNS failure, timeout, a body stream cut off mid-read ("terminated"),
 * or an unparseable 200 body. The saved batch ID stays authoritative.
 */
export class ProviderPollTransportError extends Error {
  constructor(provider: string) {
    super(`${provider} batch status read did not complete; will poll the same batch again`);
    this.name = "ProviderPollTransportError";
  }
}

/** Run one poll transport step, mapping any failure to ProviderPollTransportError. */
export async function pollTransport<T>(provider: string, step: () => Promise<T> | T): Promise<T> {
  try {
    return await step();
  } catch {
    throw new ProviderPollTransportError(provider);
  }
}
