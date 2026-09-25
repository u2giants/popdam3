import type { OpenRouterBatchJobState } from "../types.js";
import { ProviderPollTransportError } from "../batch-submission-error.js";

const BATCH_VISIBILITY_GRACE_MS = 120_000;

/** A just-created batch may 404 briefly on either provider (OpenRouter or Gemini). */
export function isNewBatchVisibilityDelay(status: unknown, submittedAt: string | undefined, nowMs = Date.now()): boolean {
  if (status !== 404 || !submittedAt) return false;
  const submittedMs = new Date(submittedAt).getTime();
  return Number.isFinite(submittedMs) && nowMs - submittedMs >= 0 && nowMs - submittedMs < BATCH_VISIBILITY_GRACE_MS;
}

export type BatchNextAction =
  | { type: "claim" }
  | { type: "submit"; leaseToken: string }
  | { type: "wait" }
  | { type: "poll"; batchId: string }
  | { type: "apply"; batchId: string }
  | { type: "clear"; batchId: string; leaseToken: string }
  | { type: "blocked"; reason: string };

export function nextBatchAction(job: OpenRouterBatchJobState, nowMs = Date.now()): BatchNextAction {
  if (job.phase === "ambiguous_submission") {
    return { type: "blocked", reason: "Provider submission is ambiguous; automatic resubmission is disabled" };
  }
  if (job.phase === "prepared") return { type: "claim" };
  if (job.phase === "submitting") {
    if (job.provider_batch_id) return { type: "poll", batchId: job.provider_batch_id };
    if (job.lease_token) return { type: "submit", leaseToken: job.lease_token };
    return { type: "claim" };
  }
  if (job.phase === "pending") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Pending provider job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    const due = !job.next_poll_at || new Date(job.next_poll_at).getTime() <= nowMs;
    return due ? { type: "poll", batchId: job.provider_batch_id } : { type: "wait" };
  }
  if (job.phase === "applying") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Applying provider job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    // A paused apply (repair temporarily unavailable) waits for its retry time.
    if (job.next_poll_at && new Date(job.next_poll_at).getTime() > nowMs) return { type: "wait" };
    return { type: "apply", batchId: job.provider_batch_id };
  }
  if (job.phase === "completed") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Completed provider job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    return { type: "clear", batchId: job.provider_batch_id, leaseToken: job.lease_token };
  }
  return { type: "blocked", reason: "Unknown provider batch state" };
}

export function indexBatchResults<T extends { custom_id?: string }>(
  expectedCustomIds: string[],
  results: T[],
): Map<string, T> {
  const expected = new Set(expectedCustomIds);
  const indexed = new Map<string, T>();
  for (const result of results) {
    if (!result.custom_id || !expected.has(result.custom_id)) {
      throw new Error("Provider batch returned an unknown result ID");
    }
    if (indexed.has(result.custom_id)) {
      throw new Error("Provider batch returned a duplicate result ID");
    }
    indexed.set(result.custom_id, result);
  }
  for (const customId of expected) {
    if (!indexed.has(customId)) throw new Error("Provider batch result is missing");
  }
  return indexed;
}

/**
 * A provider GET that failed for a temporary reason: network/disconnect,
 * timeout, an unparseable body, HTTP 408/429 or any 5xx. The saved provider
 * job ID is still authoritative, so the caller keeps the job pending and polls
 * the same ID later instead of failing the operation.
 */
export function isTransientProviderPollError(error: unknown): boolean {
  if (error instanceof ProviderPollTransportError) return true;
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  if (error.name === "TimeoutError" || error.name === "AbortError" || error.name === "SyntaxError") return true;
  // Node's fetch reports DNS/socket failures as TypeError("fetch failed").
  return error.name === "TypeError" && /fetch failed|terminated|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(error.message);
}

/**
 * Ceiling for a provider retry/poll backoff. Kept strictly below the operation
 * loop's 10-minute stale guard (STALE_RUN_MINUTES) so a backoff can never look
 * like a dead run; the loop also heartbeats while an operation waits.
 */
export const MAX_PROVIDER_RETRY_DELAY_MS = 5 * 60 * 1000;

/** 30 s doubling to a 5 min ceiling; the job stays resumable indefinitely. */
export function transientPollDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, Math.min(consecutiveFailures, 10));
  return Math.min(30_000 * 2 ** exponent, MAX_PROVIDER_RETRY_DELAY_MS);
}

/**
 * Attempts at a result's own database write before the item is recorded as a
 * terminal failure. Below this the apply pass pauses and retries the item.
 */
export const MAX_APPLY_WRITE_ATTEMPTS = 5;

/** Our database write for an applied result failed (not the model's answer). */
export class ApplyWriteError extends Error {
  constructor(public readonly cause: unknown) {
    super(`Database write failed while applying the result: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ApplyWriteError";
  }
}
