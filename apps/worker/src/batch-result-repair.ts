import { chatCompletion, type ChatCompletionRequest, type ChatCompletionResult } from "./openrouter.js";
import { geminiGenerateContent, isDirectGeminiBatchModel } from "./gemini-batch.js";
import { parseStructuredJson, runJsonRepair } from "./structured-output.js";

const MAX_MALFORMED_CHARS = 12_000;

/**
 * The repair call itself could not run (auth, billing, rate limit, provider
 * 5xx, timeout, network). The batch answer is still recoverable, so the apply
 * pass must pause and retry rather than count the item as failed.
 */
export class RepairUnavailableError extends Error {
  constructor(public status: number | undefined, reason: string) {
    super(`JSON repair temporarily unavailable${typeof status === "number" ? ` (HTTP ${status})` : ""}: ${reason.slice(0, 200)}`);
    this.name = "RepairUnavailableError";
  }
}

export function isRepairInfrastructureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") return [401, 402, 403, 408, 429].includes(status) || status >= 500;
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
}): Promise<BatchStructuredResult<T>> {
  const candidate = options.result.toolCalls?.find((call) => call.name === options.toolName)?.arguments
    ?? parseStructuredJson(options.result.content);
  let reason: string;
  if (candidate) {
    try {
      return { value: options.validate(candidate), repaired: false };
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  } else {
    reason = "No parsable structured output";
  }
  const malformed = options.result.content?.trim() || (candidate ? JSON.stringify(candidate) : "");
  if (!malformed) throw new Error(`Unrepairable batch result: ${reason}; the model returned no content to repair`);
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
    repairSource: reason,
    validate: options.validate,
    maxTokens: options.maxTokens,
    isTerminalError: isRepairInfrastructureError,
  });
  } catch (error) {
    throw new RepairUnavailableError((error as { status?: number }).status, error instanceof Error ? error.message : String(error));
  }
  if (repaired.ok) return { value: repaired.value, repaired: true };
  throw new Error(`Unrepairable batch result: ${reason}; repair failed: ${repaired.attempt.error ?? "unknown"}`);
}
