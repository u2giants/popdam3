/** The provider may have accepted a non-idempotent POST, but no durable ID was obtained. */
export class AmbiguousBatchSubmissionError extends Error {
  constructor(provider: string, public status?: number) {
    super(`${provider} batch submission outcome is ambiguous${typeof status === "number" ? ` (HTTP ${status})` : ""}; automatic resubmission is disabled`);
    this.name = "AmbiguousBatchSubmissionError";
  }
}

/**
 * The widened definitive-rejection status set accepted by
 * reset_bulk_operation_submission_lease (shared-db #3464): validation (400/
 * 422), auth (401/403), billing (402) and rate limit (429). Every one of these,
 * when proven by the provider's own error envelope, means no durable batch was
 * created, so the receipt may be consumed through the governed reset.
 */
export const DEFINITIVE_REJECTION_STATUSES = [400, 401, 402, 403, 422, 429] as const;
export type DefinitiveRejectionStatus = (typeof DEFINITIVE_REJECTION_STATUSES)[number];

function definitiveRejectionMessage(provider: string, status: DefinitiveRejectionStatus): string {
  if (status === 401 || status === 403) {
    return `${provider} refused the batch submission (HTTP ${status}, authorization); fix the key, then start a new run`;
  }
  if (status === 402) {
    return `${provider} refused the batch submission (HTTP 402, billing); fix billing, then start a new run`;
  }
  if (status === 429) {
    return `${provider} refused the batch submission (HTTP 429, rate limit); wait or raise the quota, then start a new run`;
  }
  return `${provider} rejected the batch submission (HTTP ${status})`;
}

/**
 * The provider itself answered the submission POST with a parsed definitive
 * rejection (HTTP 400/401/402/403/422/429 whose JSON error body echoes the same
 * status code). Only this proves no durable batch was created, so only this may
 * consume the submission receipt through reset_bulk_operation_submission_lease
 * with reason `provider_definitive_rejection`.
 * `providerError` is a sanitized summary: never the raw body, which may echo
 * prompts, media or credentials.
 */
export class DefinitiveBatchRejectionError extends Error {
  constructor(
    public provider: string,
    public status: DefinitiveRejectionStatus,
    public providerError: Record<string, string | number>,
  ) {
    super(definitiveRejectionMessage(provider, status));
    this.name = "DefinitiveBatchRejectionError";
  }
}

/**
 * Classify a non-2xx submission response. Returns a definitive rejection only
 * when the status is one of 400/401/402/403/422/429 AND the body parses as the
 * provider's own error envelope (`{ "error": { "code": <same status>, ... } }`);
 * a proxy or gateway page does not carry that envelope. Everything else (other
 * 4xx, 5xx, an unparseable body) stays ambiguous: the database lease must expire
 * into ambiguous_submission rather than be reset.
 */
export function classifySubmissionHttpFailure(
  provider: string,
  status: number,
  bodyText: string | undefined,
): DefinitiveBatchRejectionError | AmbiguousBatchSubmissionError {
  if ((DEFINITIVE_REJECTION_STATUSES as readonly number[]).includes(status) && typeof bodyText === "string") {
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
