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
const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export class OpenRouterError extends Error {
  constructor(public status: number, public body: string, public providerInfo?: OpenRouterProviderInfo) {
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
  provider?: {
    order?: string[];
    only?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    ignore?: string[];
    quantizations?: string[];
    sort?: "price" | "throughput" | "latency";
  };
  response_format?: {
    type: "json_object";
  } | {
    type: "json_schema";
    json_schema: {
      name: string;
      strict?: boolean;
      schema: Record<string, unknown>;
    };
  };
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
  id?: string;
  model?: string;
  providerInfo?: OpenRouterProviderInfo;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenRouterProviderInfo {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
  generationId?: string | null;
  upstreamId?: string | null;
  upstreamStatus?: number | null;
  routerMetadata?: unknown;
  headers?: Record<string, string>;
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

function pickHeader(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

function collectProviderInfo(headers: Headers, body?: Record<string, unknown>): OpenRouterProviderInfo {
  const selectedHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("x-openrouter") ||
      lower === "x-request-id" ||
      lower === "cf-ray"
    ) {
      selectedHeaders[key] = value;
    }
  });

  const routerMetadata = body?.openrouter_metadata;
  const selectedEndpoint = Array.isArray((routerMetadata as { endpoints?: { available?: unknown[] } } | undefined)?.endpoints?.available)
    ? ((routerMetadata as { endpoints: { available: Array<Record<string, unknown>> } }).endpoints.available.find((endpoint) => endpoint.selected === true) ?? null)
    : null;

  return {
    provider: (
      pickHeader(headers, ["x-openrouter-provider", "openrouter-provider"]) ??
      (typeof body?.provider === "string" ? body.provider : null) ??
      (typeof body?.provider_name === "string" ? body.provider_name : null) ??
      (typeof selectedEndpoint?.provider_name === "string" ? selectedEndpoint.provider_name : null) ??
      (typeof selectedEndpoint?.provider === "string" ? selectedEndpoint.provider : null)
    ),
    endpoint: (
      pickHeader(headers, ["x-openrouter-endpoint", "openrouter-endpoint"]) ??
      (typeof body?.endpoint === "string" ? body.endpoint : null) ??
      (typeof body?.endpoint_name === "string" ? body.endpoint_name : null) ??
      (typeof selectedEndpoint?.endpoint_name === "string" ? selectedEndpoint.endpoint_name : null) ??
      (typeof selectedEndpoint?.tag === "string" ? selectedEndpoint.tag : null) ??
      (typeof selectedEndpoint?.slug === "string" ? selectedEndpoint.slug : null)
    ),
    model: (
      pickHeader(headers, ["x-openrouter-model", "openrouter-model"]) ??
      (typeof body?.model === "string" ? body.model : null)
    ),
    generationId: pickHeader(headers, ["x-generation-id", "x-openrouter-generation-id"]) ?? (typeof body?.id === "string" ? body.id : null),
    routerMetadata: routerMetadata ?? undefined,
    headers: Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined,
  };
}

async function enrichProviderInfo(apiKey: string, info: OpenRouterProviderInfo, timeoutMs: number) {
  if (!info.generationId) return info;
  try {
    const url = `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(info.generationId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
    });
    if (!response.ok) return info;
    const payload = await response.json() as { data?: Record<string, unknown> } | Record<string, unknown>;
    const data: Record<string, unknown> = ("data" in payload && payload.data && typeof payload.data === "object")
      ? payload.data as Record<string, unknown>
      : payload as Record<string, unknown>;
    return {
      ...info,
      provider: info.provider ?? (typeof data.provider_name === "string" ? data.provider_name : null),
      endpoint: info.endpoint ?? (typeof data.endpoint_name === "string" ? data.endpoint_name : null),
      model: info.model ?? (typeof data.model === "string" ? data.model : null),
      upstreamId: typeof data.upstream_id === "string" ? data.upstream_id : info.upstreamId,
      upstreamStatus: typeof data.upstream_status === "number" ? data.upstream_status : info.upstreamStatus,
    };
  } catch {
    return info;
  }
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
          "X-OpenRouter-Metadata": "enabled",
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
        id?: string;
        model?: string;
        provider?: string;
        provider_name?: string;
        endpoint?: string;
        endpoint_name?: string;
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

      const providerInfo = await enrichProviderInfo(
        apiKey,
        collectProviderInfo(response.headers, data as Record<string, unknown>),
        timeoutMs,
      );

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        let toolCalls: ToolCallResult[];
        try {
          toolCalls = choice.tool_calls.map((tc) => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const parseError = new Error(`Malformed tool call JSON: ${message}`);
          (parseError as Error & { providerInfo?: OpenRouterProviderInfo }).providerInfo = providerInfo;
          throw parseError;
        }

        return {
          id: data.id,
          model: data.model,
          providerInfo,
          toolCalls,
          usage: data.usage,
        };
      }

      return { id: data.id, model: data.model, content: choice.content || "", providerInfo, usage: data.usage };
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

    throw new OpenRouterError(response.status, errBody, collectProviderInfo(response.headers));
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}
