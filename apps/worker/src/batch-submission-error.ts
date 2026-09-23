/** The provider may have accepted a non-idempotent POST, but no durable ID was obtained. */
export class AmbiguousBatchSubmissionError extends Error {
  constructor(provider: string) {
    super(`${provider} batch submission outcome is ambiguous; automatic resubmission is disabled`);
    this.name = "AmbiguousBatchSubmissionError";
  }
}

/** Evidence from the configured provider endpoint, never from a transport error. */
export class DefinitiveBatchSubmissionError extends Error {
  constructor(
    public provider: "Gemini" | "OpenRouter",
    public status: 400 | 422,
    public providerError: Record<string, unknown>,
  ) {
    super(`${provider} batch submission rejected (HTTP ${status})`);
    this.name = "DefinitiveBatchSubmissionError";
  }
}

export function providerValidationRejection(
  response: Response,
  expectedUrl: string,
  provider: "Gemini" | "OpenRouter",
  body: string,
): DefinitiveBatchSubmissionError | undefined {
  if (response.status !== 400 && response.status !== 422) return undefined;
  // fetch's URL is the final response URL. An absent or redirected origin is
  // insufficient evidence to consume a one-time database receipt.
  if (response.url !== expectedUrl) return undefined;
  if (!/^(application\/json|[^;\s]+\+json)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const error = (parsed as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const details = error as Record<string, unknown>;
  if (typeof details.message !== "string" || !details.message.trim()) return undefined;
  return new DefinitiveBatchSubmissionError(provider, response.status, details);
}
