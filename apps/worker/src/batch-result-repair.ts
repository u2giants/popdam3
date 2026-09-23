import { chatCompletion, type ChatCompletionRequest, type ChatCompletionResult } from "./openrouter.js";
import { geminiGenerateContent, isDirectGeminiBatchModel } from "./gemini-batch.js";
import { parseStructuredJson, runJsonRepair } from "./structured-output.js";

const MAX_MALFORMED_CHARS = 12_000;

/**
 * Durable failure reasons must never echo provider bodies (they can repeat
 * licensed metadata or prompts). Provider errors reduce to their HTTP status;
 * only our own parse/validation messages are kept, truncated.
 */
export function safeRepairReason(error: unknown): string {
  if (error instanceof UnrepairableBatchResultError || error instanceof RepairUnavailableError
    || error instanceof RepairNotAuthorizedError) return error.message;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `provider HTTP ${status}`;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return "provider request timed out";
  if (error instanceof Error && error.name === "TypeError") return "provider request did not complete";
  // Remaining errors are our own write/lookup failures; provider-shaped
  // messages are reduced so no response body is ever persisted.
  const message = error instanceof Error ? error.message : String(error);
  return /^(OpenRouter|Gemini Batch) \d{3}/.test(message) ? "provider request failed" : message.slice(0, 200);
}

/** Final per-item failure; its message is built only from fixed categories. */
export class UnrepairableBatchResultError extends Error {
  constructor(reason: string, repairReason?: string) {
    super(`Unrepairable batch result: ${reason}${repairReason ? `; repair failed: ${repairReason}` : ""}`);
    this.name = "UnrepairableBatchResultError";
  }
}

/** The repair key is rejected (401/402/403): stop the apply for the operator. */
export class RepairNotAuthorizedError extends Error {
  constructor(public status: number) {
    super(`JSON repair was refused by the provider (HTTP ${status}); fix the provider key or billing, then resume`);
    this.name = "RepairNotAuthorizedError";
  }
}

/**
 * The repair call itself could not run (auth, billing, rate limit, provider
 * 5xx, timeout, network). The batch answer is still recoverable, so the apply
 * pass must pause and retry rather than count the item as failed.
 */
export class RepairUnavailableError extends Error {
  constructor(public status: number | undefined, reason: string) {
    super(`JSON repair temporarily unavailable: ${reason}`);
    this.name = "RepairUnavailableError";
  }
}

export function isRepairInfrastructureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") return [401, 402, 403, 408, 429].includes(status) || status >= 500;
  // (401/402/403 are split out as RepairNotAuthorizedError by the caller.)
  return ["TimeoutError", "AbortError", "SyntaxError"].includes(error.name)
    || (error.name === "TypeError" && /fetch failed|terminated|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(error.message));
}

/** The synchronous endpoint for the SAME model a batch ran on. */
export function sameModelRepairCompletion(model: string): {
  model: string;
  completion: (apiKey: string, request: ChatCompletionRequest, timeoutMs?: number) => Promise<ChatCompletionResult>;
} {
  if (isDirectGeminiBatchModel(model)) return { model: model.trim(), completion: geminiGenerateContent };
  // OpenRouter `:batch` is a pricing variant; the base ID is the same model.
  return { model: model.trim().replace(/:batch$/, ""), completion: chatCompletion };
}

export interface BatchStructuredResult<T> {
  value: T;
  repaired: boolean;
}

/**
 * Parse and validate one batch result. A malformed or invalid answer goes
 * through the shared JSON-repair step on the SAME model (never another model);
 * only an answer that still cannot be repaired throws, with its reason. The
 * repair is text-only: the malformed answer and the schema, no images.
 */
export async function structuredBatchResult<T>(options: {
  apiKey: string;
  model: string;
  result: ChatCompletionResult;
  toolName: string;
  schema: Record<string, unknown>;
  validate: (value: Record<string, unknown>) => T;
  maxTokens?: number;
  repair?: ReturnType<typeof sameModelRepairCompletion>;
  /** OpenRouter provider pin used for the batch; repair keeps the same routing. */
  provider?: ChatCompletionRequest["provider"];
}): Promise<BatchStructuredResult<T>> {
  const candidate = options.result.toolCalls?.find((call) => call.name === options.toolName)?.arguments
    ?? parseStructuredJson(options.result.content);
  let reason: string;
  let repairPromptReason: string;
  if (candidate) {
    try {
      return { value: options.validate(candidate), repaired: false };
    } catch (error) {
      // Only this internal reason goes to the repair prompt; the durable
      // failure reason below uses fixed categories, never model text.
      repairPromptReason = error instanceof Error ? error.message : String(error);
      reason = "schema validation failed";
    }
  } else {
    reason = "No parsable structured output";
    repairPromptReason = reason;
  }
  const malformed = options.result.content?.trim() || (candidate ? JSON.stringify(candidate) : "");
  if (!malformed) throw new UnrepairableBatchResultError(`${reason}; the model returned no content to repair`);
  const repair = options.repair ?? sameModelRepairCompletion(options.model);
  let repaired: Awaited<ReturnType<typeof runJsonRepair<T>>>;
  try {
    repaired = await runJsonRepair({
    apiKey: options.apiKey,
    model: repair.model,
    completion: repair.completion,
    messages: [{
      role: "user",
      content: `This response must be exactly one JSON object matching this JSON Schema:\n${JSON.stringify(options.schema)}\n\nResponse to correct:\n${malformed.slice(0, MAX_MALFORMED_CHARS)}`,
    }],
    repairSource: repairPromptReason,
    // Gemini has no OpenRouter routing; OpenRouter repair keeps the batch pin.
    provider: repair.completion === geminiGenerateContent ? undefined : options.provider,
    validate: options.validate,
    maxTokens: options.maxTokens,
    isTerminalError: isRepairInfrastructureError,
  });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 402 || status === 403) throw new RepairNotAuthorizedError(status);
    throw new RepairUnavailableError(status, safeRepairReason(error));
  }
  if (repaired.ok) return { value: repaired.value, repaired: true };
  const attempt = repaired.attempt;
  const repairReason = typeof attempt.httpStatus === "number" ? `provider HTTP ${attempt.httpStatus}`
    : attempt.validation === "failed" ? "repaired output failed schema validation"
      : attempt.parse === "failed" ? "repaired output was not parsable JSON"
        : "provider request failed";
  throw new UnrepairableBatchResultError(reason, repairReason);
}
