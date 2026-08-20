import type { OpenRouterBatchJobState } from "../types.js";

const BATCH_VISIBILITY_GRACE_MS = 120_000;

export function isNewBatchVisibilityDelay(status: number, submittedAt: string | undefined, nowMs = Date.now()): boolean {
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
    return { type: "blocked", reason: "OpenRouter submission is ambiguous; automatic resubmission is disabled" };
  }
  if (job.phase === "prepared") return { type: "claim" };
  if (job.phase === "submitting") {
    if (job.provider_batch_id) return { type: "poll", batchId: job.provider_batch_id };
    if (job.lease_token) return { type: "submit", leaseToken: job.lease_token };
    return { type: "wait" };
  }
  if (job.phase === "pending") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Pending OpenRouter job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    const due = !job.next_poll_at || new Date(job.next_poll_at).getTime() <= nowMs;
    return due ? { type: "poll", batchId: job.provider_batch_id } : { type: "wait" };
  }
  if (job.phase === "applying") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Applying OpenRouter job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    return { type: "apply", batchId: job.provider_batch_id };
  }
  if (job.phase === "completed") {
    if (!job.provider_batch_id) return { type: "blocked", reason: "Completed OpenRouter job has no batch ID" };
    if (!job.lease_token) return { type: "claim" };
    return { type: "clear", batchId: job.provider_batch_id, leaseToken: job.lease_token };
  }
  return { type: "blocked", reason: "Unknown OpenRouter batch state" };
}

export function indexBatchResults<T extends { custom_id?: string }>(
  expectedCustomIds: string[],
  results: T[],
): Map<string, T> {
  const expected = new Set(expectedCustomIds);
  const indexed = new Map<string, T>();
  for (const result of results) {
    if (!result.custom_id || !expected.has(result.custom_id)) {
      throw new Error("OpenRouter batch returned an unknown result ID");
    }
    if (indexed.has(result.custom_id)) {
      throw new Error("OpenRouter batch returned a duplicate result ID");
    }
    indexed.set(result.custom_id, result);
  }
  for (const customId of expected) {
    if (!indexed.has(customId)) throw new Error("OpenRouter batch result is missing");
  }
  return indexed;
}
