/** The provider may have accepted a non-idempotent POST, but no durable ID was obtained. */
export class AmbiguousBatchSubmissionError extends Error {
  constructor(provider: string) {
    super(`${provider} batch submission outcome is ambiguous; automatic resubmission is disabled`);
    this.name = "AmbiguousBatchSubmissionError";
  }
}
