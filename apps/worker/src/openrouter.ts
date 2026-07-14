/**
 * OpenRouter client — unified AI gateway for all model calls.
 *
 * Uses the OpenAI-compatible chat completions API.
 * Replaces direct calls to Google Gemini and Anthropic APIs.
 *
 * All models are specified as OpenRouter model IDs, e.g.:
 *   "google/gemini-2.0-flash-001"
 *   "anthropic/claude-3.5-haiku"
 */

import { logger } from "./logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export class OpenRouterError extends Error {
  constructor(public status: number, public body: string) {
    super(`OpenRouter ${status}: ${body.slice(0, 300)}`);
    this.name = "OpenRouterError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  type: "function";
  function: ToolFunction;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Tool[];
  tool_choice?: { type: "function"; function: { name: string } } | "required" | "auto";
  max_tokens?: number;
  temperature?: number;
}

export interface ToolCallResult {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionResult {
  toolCalls?: ToolCallResult[];
  content?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build an image content part from a base64-encoded image */
export function imageContent(base64: string, mimeType: string): ContentPart {
  return {
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  };
}

/** Build a tool definition from name, description, and JSON Schema parameters */
export function tool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return {
    type: "function",
    function: { name, description, parameters },
  };
}

// ── Main call ────────────────────────────────────────────────────────────────

export async function chatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ChatCompletionResult> {
  // Some models don't support the specific-function or "required" tool_choice forms.
  // Fall back through the compatibility ladder automatically on a 404.
  const toolChoiceFallbacks: Array<ChatCompletionRequest["tool_choice"]> = [];
  if (request.tool_choice && request.tool_choice !== "auto") {
    if (request.tool_choice !== "required") toolChoiceFallbacks.push("required");
    toolChoiceFallbacks.push("auto");
  }

  let currentRequest = request;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://popdam.com",
          "X-Title": "popdam3",
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(currentRequest),
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0]?.message;
      if (!choice) {
        throw new Error("OpenRouter returned no choices");
      }

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        return {
          toolCalls: choice.tool_calls.map((tc) => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          })),
          usage: data.usage,
        };
      }

      return { content: choice.content || "", usage: data.usage };
    }

    if (response.status === 429) {
      // Rate limited — wait and retry
      const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
      logger.warn("openrouter: rate limited", { attempt, retryAfter });
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw new OpenRouterError(429, "Rate limited after retries");
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      logger.warn("openrouter: transient error, retrying", { status: response.status, attempt });
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    const errBody = await response.text();

    // tool_choice compatibility fallback: if the model rejects our tool_choice
    // value, retry with the next less-strict value in the ladder.
    if (response.status === 404 && errBody.includes("tool_choice") && toolChoiceFallbacks.length > 0) {
      const nextChoice = toolChoiceFallbacks.shift()!;
      logger.warn("openrouter: tool_choice not supported, retrying with fallback", {
        model: currentRequest.model,
        from: currentRequest.tool_choice,
        to: nextChoice,
      });
      currentRequest = { ...currentRequest, tool_choice: nextChoice };
      attempt--; // don't count this against retry budget
      continue;
    }

    throw new OpenRouterError(response.status, errBody);
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}
