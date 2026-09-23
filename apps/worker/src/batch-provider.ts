import { PreSubmissionError } from "./batch-submission-error.js";
import {
  getOpenRouterBatch,
  prepareOpenRouterBatch,
  parseOpenRouterBatchResult,
  submitPreparedOpenRouterBatch,
  type ChatCompletionResult,
  type OpenRouterBatchRecord,
  type OpenRouterBatchResultItem,
  type OpenRouterBatchSubmission,
  type PreparedOpenRouterBatch,
} from "./openrouter.js";
import {
  getGeminiBatch,
  isDirectGeminiBatchModel,
  prepareGeminiBatch,
  parseGeminiBatchResult,
  submitPreparedGeminiBatch,
  type GeminiBatchRecord,
  type GeminiBatchResultItem,
  type PreparedGeminiBatch,
} from "./gemini-batch.js";

export type DurableBatchProvider = "openrouter" | "google-gemini";
export type ProviderBatchRecord = OpenRouterBatchRecord | GeminiBatchRecord;
export type ProviderBatchResultItem = OpenRouterBatchResultItem | GeminiBatchResultItem;
export type PreparedProviderBatch = PreparedOpenRouterBatch | PreparedGeminiBatch;

export function batchProviderForModel(model: string): DurableBatchProvider {
  return isDirectGeminiBatchModel(model) ? "google-gemini" : "openrouter";
}

export function providerBatchPageLimit(provider: DurableBatchProvider, scope: "asset" | "style_group"): number {
  if (provider !== "google-gemini") return 100;
  return scope === "asset" ? 3 : 1;
}

export function assertProviderSubmissionLeaseBudget(
  leaseExpiresAt: string | undefined,
  minimumRemainingMs = 90_000,
  nowMs = Date.now(),
): void {
  const deadline = leaseExpiresAt ? new Date(leaseExpiresAt).getTime() : Number.NaN;
  if (!Number.isFinite(deadline) || deadline - nowMs < minimumRemainingMs) {
    throw new PreSubmissionError("Provider batch preparation left insufficient submission lease time");
  }
}

export async function prepareProviderBatch(
  provider: DurableBatchProvider,
  items: OpenRouterBatchSubmission[],
): Promise<PreparedProviderBatch> {
  return provider === "google-gemini" ? prepareGeminiBatch(items) : prepareOpenRouterBatch(items);
}

export async function submitPreparedProviderBatch(
  apiKey: string,
  prepared: PreparedProviderBatch,
): Promise<ProviderBatchRecord> {
  return prepared.provider === "google-gemini"
    ? submitPreparedGeminiBatch(apiKey, prepared)
    : submitPreparedOpenRouterBatch(apiKey, prepared);
}

export async function getProviderBatch(
  provider: DurableBatchProvider,
  apiKey: string,
  batchId: string,
): Promise<ProviderBatchRecord> {
  return provider === "google-gemini" ? getGeminiBatch(apiKey, batchId) : getOpenRouterBatch(apiKey, batchId);
}

export async function parseProviderBatchResult(
  provider: DurableBatchProvider,
  apiKey: string,
  item: ProviderBatchResultItem,
): Promise<ChatCompletionResult> {
  return provider === "google-gemini"
    ? parseGeminiBatchResult(item as GeminiBatchResultItem)
    : parseOpenRouterBatchResult(apiKey, item as OpenRouterBatchResultItem);
}
