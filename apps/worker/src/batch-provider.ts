import { createHash } from "node:crypto";
import { PreSubmissionError } from "./batch-submission-error.js";
import { getGoogleAiApiKey } from "./google-ai-key.js";
import { getOpenRouterApiKey } from "./openrouter-key.js";
import type { OpenRouterBatchJobState } from "./types.js";
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

export interface BatchJobIdentity {
  batchProvider: DurableBatchProvider;
  model: string;
  /** OpenRouter provider-routing pin the batch was prepared with (null = none). */
  providerPin: string | null;
}

/**
 * The provider/model/routing identity for a durable batch step. A NEW job takes
 * it from current Settings; an existing job always uses what it saved, so a
 * Settings change mid-batch can never re-route polling, repair or apply to a
 * different provider, model or key. Legacy jobs saved before `provider` existed
 * are OpenRouter; before `provider_pin` existed the pin was not recorded, so
 * those keep the current Settings pin (their previous behavior).
 */
export function batchJobIdentity(
  job: OpenRouterBatchJobState | undefined,
  settings: { primary: string; providerPin: string | null },
): BatchJobIdentity {
  if (!job) {
    return { batchProvider: batchProviderForModel(settings.primary), model: settings.primary, providerPin: settings.providerPin };
  }
  const model = typeof job.model === "string" && job.model ? job.model : settings.primary;
  const providerPin = "provider_pin" in job
    ? (typeof job.provider_pin === "string" && job.provider_pin ? job.provider_pin : null)
    : settings.providerPin;
  return { batchProvider: job.provider ?? "openrouter", model, providerPin };
}

/**
 * Non-reversible fingerprint of the provider credential (first 16 hex chars of
 * its SHA-256). Saved with a submitted batch so a key rotated to a different
 * account mid-run is detected instead of polling someone else's batch space.
 */
export function accountFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/** Fields stamped onto the job at submission: the identity the POST used. */
export function submittedIdentity(
  identity: BatchJobIdentity,
  apiKey?: string,
): Pick<OpenRouterBatchJobState, "provider" | "model"> & { provider_pin: string | null; account_fingerprint?: string } {
  return {
    provider: identity.batchProvider,
    model: identity.model,
    provider_pin: identity.providerPin,
    ...(apiKey ? { account_fingerprint: accountFingerprint(apiKey) } : {}),
  };
}

/**
 * For a submitted batch, a message when the current credential is not the one
 * the batch was submitted with (the batch lives in that account); else null.
 * Jobs submitted before fingerprints existed are not checked.
 */
export function submittedAccountMismatch(job: OpenRouterBatchJobState | undefined, apiKey: string): string | null {
  if (!job?.provider_batch_id || typeof job.account_fingerprint !== "string" || !job.account_fingerprint) return null;
  if (accountFingerprint(apiKey) === job.account_fingerprint) return null;
  const name = (job.provider ?? "openrouter") === "google-gemini" ? "Google AI" : "OpenRouter";
  return `The ${name} API key changed since batch ${job.provider_batch_id} was submitted; restore the original key in Settings to resume it`;
}

/** A provider poll refused for authorization or because the batch is not in this account. */
export function isAccountRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403 || status === 404;
}

/** The API key belongs to the job's saved provider, never to a model-name guess. */
export function getBatchProviderApiKey(provider: DurableBatchProvider): Promise<string> {
  return provider === "google-gemini" ? getGoogleAiApiKey() : getOpenRouterApiKey();
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
