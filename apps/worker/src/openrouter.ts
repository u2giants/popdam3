/**
 * OpenRouter client — unified AI gateway for all model calls.
 *
 * Uses the OpenAI-compatible chat completions API.
 * Replaces direct calls to Google Gemini and Anthropic APIs.
 *
 * All models are specified as OpenRouter model IDs, e.g.:
 *   "qwen/qwen3-vl-32b-instruct"
 *   "deepseek/deepseek-v4-pro"
 *
 * Every request is routed through the "Exacto" variant by default (see
 * withExactoRouting) for best tool-calling accuracy. Pin an explicit ":variant"
 * suffix on a model slug to opt out.
 */

import { logger } from "./logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_BATCH_URL = "https://openrouter.ai/api/beta/batches";
const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BATCH_REQUESTS = 100;
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

export interface OpenRouterBatchResultItem {
  custom_id?: string;
  response?: { status_code?: number; body?: unknown };
  error?: unknown;
}

export interface OpenRouterBatchRecord {
  id?: string;
  status?: string;
  results?: OpenRouterBatchResultItem[];
  error?: unknown;
}

export interface OpenRouterBatchSubmission {
  customId: string;
  request: ChatCompletionRequest;
}

export function buildOpenRouterBatchPayload(items: OpenRouterBatchSubmission[]) {
  if (items.length === 0 || items.length > MAX_BATCH_REQUESTS) {
    throw new Error(`OpenRouter batch requires 1-${MAX_BATCH_REQUESTS} requests`);
  }
  const baseModel = baseModelId(items[0].request.model);
  return {
    endpoint: "/v1/chat/completions",
    model: baseModel,
    requests: items.map(({ customId, request }) => {
      const body = { ...request, model: baseModel };
      delete body.temperature;
      return { custom_id: customId, body };
    }),
  };
}

export async function submitOpenRouterBatch(apiKey: string, items: OpenRouterBatchSubmission[]): Promise<OpenRouterBatchRecord> {
  const payload = buildOpenRouterBatchPayload(items);
  const response = await fetch(OPENROUTER_BATCH_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new OpenRouterError(response.status, text);
  const record = unwrapBatchRecord(parseJsonRecord(text));
  if (!record.id) throw new Error("OpenRouter Batch API returned no batch ID");
  return record;
}

export async function getOpenRouterBatch(apiKey: string, batchId: string): Promise<OpenRouterBatchRecord> {
  const response = await fetch(`${OPENROUTER_BATCH_URL}/${encodeURIComponent(batchId)}`, {
    headers: openRouterHeaders(apiKey),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new OpenRouterError(response.status, text);
  return unwrapBatchRecord(parseJsonRecord(text));
}

export async function parseOpenRouterBatchResult(
  apiKey: string,
  item: OpenRouterBatchResultItem,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ChatCompletionResult> {
  const status = item.response?.status_code ?? 500;
  if (status < 200 || status >= 300 || item.error) {
    throw new OpenRouterError(status, batchErrorText(item.error ?? item.response?.body));
  }
  const body = item.response?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("OpenRouter batch returned an invalid response body");
  }
  return parseChatCompletionResult(apiKey, body as Record<string, unknown>, new Headers(), timeoutMs);
}


/** One upstream endpoint OpenRouter tried, in order. Includes failed legs. */
export interface OpenRouterAttempt {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
  status?: number | null;
  ok: boolean;
}

export interface OpenRouterProviderInfo {
  provider?: string | null;
  endpoint?: string | null;
  model?: string | null;
  generationId?: string | null;
  upstreamId?: string | null;
  upstreamStatus?: number | null;
  /** Every endpoint OpenRouter attempted for this call — failed legs included. */
  attempts?: OpenRouterAttempt[];
  routerMetadata?: unknown;
  headers?: Record<string, string>;
}

type RouterEndpointMetadata = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Normalize one raw router attempt/endpoint record into a stable shape. */
function normalizeAttempt(raw: RouterEndpointMetadata): OpenRouterAttempt {
  const status = typeof raw.status === "number" ? raw.status : null;
  return {
    provider: str(raw.provider_name) ?? str(raw.provider),
    endpoint: str(raw.endpoint_name) ?? str(raw.tag) ?? str(raw.slug) ?? str(raw.model),
    model: str(raw.model),
    status,
    ok: typeof status === "number" ? status >= 200 && status < 300 : false,
  };
}

/**
 * Build a `provider` request override that pins a call to specific upstream
 * endpoint(s) and disables silent fallback. Pass one or more OpenRouter
 * provider slugs (e.g. "anthropic", "amazon-bedrock"); an empty/nullish value
 * returns undefined so callers can pass it through unconditionally.
 */
export function buildProviderPin(
  slugs: string | string[] | null | undefined,
): ChatCompletionRequest["provider"] | undefined {
  const list = (Array.isArray(slugs) ? slugs : (slugs ?? "").split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return undefined;
  return { only: list, allow_fallbacks: false };
}

/**
 * OpenRouter "Exacto" routing variant. Routes each request to the upstream
 * provider endpoint with the best measured tool-calling / structured-output
 * accuracy for the given model. Exacto is a free virtual variant (no separate
 * endpoint pool, no price premium), applied to every call by default because
 * our tagging/ERP pipelines depend on reliable tool calls and JSON — it is the
 * routing-level fix for the cross-provider tool_choice/malformed-JSON failures
 * this client otherwise papers over with fallback ladders.
 *
 * A model that already carries an explicit ":variant" suffix (":nitro",
 * ":floor", ":free", ":exacto", …) is returned unchanged, so a caller can opt a
 * specific model out of Exacto by pinning its own variant in the model slug.
 */
export function withExactoRouting(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed.includes(":")) return trimmed;
  return `${trimmed}:exacto`;
}

/**
 * Per-model routing overrides that take precedence over Exacto.
 *
 * Some models regress badly under Exacto's "best tool-calling accuracy" routing.
 * minimax/minimax-m3 is the clearest case (2026-07-14): 8 of its 9 OpenRouter
 * endpoints do NOT support function-calling, and the one that does (AtlasCloud)
 * returns truncated tool-call JSON — so Exacto pinned us to it and MiniMax failed
 * ~89% (vs ~14% on default routing). Its first-party "minimax" endpoint supports
 * response_format (JSON schema), not tools, so we hard-pin to that provider and
 * skip Exacto; the json_schema fallback leg carries the call (minimax-m3 is also
 * on the modelSupportsTools skip list so the tool leg is never attempted).
 */
const MODEL_ROUTING_OVERRIDES: Record<string, NonNullable<ChatCompletionRequest["provider"]>> = {
  "minimax/minimax-m3": { only: ["minimax"], allow_fallbacks: false },
};

/** The bare "author/slug" model id, stripped of any ":variant" suffix. */
export function baseModelId(model: string): string {
  return model.split(":")[0].trim();
}

export function isTerminalOpenRouterError(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false;
  const body = error.body.toLowerCase();
  return error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500 ||
    /billing|credit|payment|invalid (?:image|media)|content[_ -]?policy|safety|moderation|blocked|refusal/.test(body);
}

export function isToolChoiceCompatibilityError(status: number, body: string): boolean {
  return (status === 400 || status === 404) && body.includes("tool_choice");
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
  const endpointCandidates = Array.isArray((routerMetadata as { endpoints?: { available?: unknown[] } } | undefined)?.endpoints?.available)
    ? (routerMetadata as { endpoints: { available: RouterEndpointMetadata[] } }).endpoints.available
    : [];
  const selectedEndpoint = endpointCandidates.find((endpoint) => endpoint.selected === true) ?? null;

  const rawAttempts = Array.isArray((routerMetadata as { attempts?: unknown[] } | undefined)?.attempts)
    ? (routerMetadata as { attempts: RouterEndpointMetadata[] }).attempts
    : [];
  const attempts = rawAttempts.map(normalizeAttempt);
  const successfulAttempt = rawAttempts.find((attempt) => {
    const status = attempt.status;
    return typeof status === "number" && status >= 200 && status < 300;
  }) ?? null;
  // For attribution, prefer the endpoint that actually served the response; on a
  // pure-failure body there is no 2xx attempt, so fall back to the LAST attempt —
  // that is the endpoint that failed, which is exactly what we want to record.
  const representativeAttempt = successfulAttempt ?? rawAttempts[rawAttempts.length - 1] ?? null;

  return {
    provider: (
      pickHeader(headers, ["x-openrouter-provider", "openrouter-provider"]) ??
      (typeof body?.provider === "string" ? body.provider : null) ??
      (typeof body?.provider_name === "string" ? body.provider_name : null) ??
      (typeof selectedEndpoint?.provider_name === "string" ? selectedEndpoint.provider_name : null) ??
      (typeof selectedEndpoint?.provider === "string" ? selectedEndpoint.provider : null) ??
      str(representativeAttempt?.provider_name) ?? str(representativeAttempt?.provider)
    ),
    endpoint: (
      pickHeader(headers, ["x-openrouter-endpoint", "openrouter-endpoint"]) ??
      (typeof body?.endpoint === "string" ? body.endpoint : null) ??
      (typeof body?.endpoint_name === "string" ? body.endpoint_name : null) ??
      (typeof selectedEndpoint?.endpoint_name === "string" ? selectedEndpoint.endpoint_name : null) ??
      (typeof selectedEndpoint?.tag === "string" ? selectedEndpoint.tag : null) ??
      (typeof selectedEndpoint?.slug === "string" ? selectedEndpoint.slug : null) ??
      (typeof selectedEndpoint?.model === "string" ? selectedEndpoint.model : null) ??
      str(representativeAttempt?.endpoint_name) ?? str(representativeAttempt?.tag) ??
      str(representativeAttempt?.slug) ?? str(representativeAttempt?.model)
    ),
    model: (
      pickHeader(headers, ["x-openrouter-model", "openrouter-model"]) ??
      (typeof body?.model === "string" ? body.model : null) ??
      (typeof selectedEndpoint?.model === "string" ? selectedEndpoint.model : null) ??
      str(representativeAttempt?.model)
    ),
    generationId: pickHeader(headers, ["x-generation-id", "x-openrouter-generation-id"]) ?? (typeof body?.id === "string" ? body.id : null),
    attempts: attempts.length > 0 ? attempts : undefined,
    routerMetadata: routerMetadata ?? undefined,
    headers: Object.keys(selectedHeaders).length > 0 ? selectedHeaders : undefined,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
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

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://popdam.com",
    "X-Title": "popdam3",
    "X-OpenRouter-Metadata": "enabled",
  };
}

async function parseChatCompletionResult(
  apiKey: string,
  data: Record<string, unknown>,
  headers: Headers,
  timeoutMs: number,
): Promise<ChatCompletionResult> {
  const choices = data.choices as Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    };
  }> | undefined;
  const choice = choices?.[0]?.message;
  if (!choice) throw new Error("OpenRouter returned no choices");

  const providerInfo = await enrichProviderInfo(apiKey, collectProviderInfo(headers, data), timeoutMs);
  if (choice.tool_calls && choice.tool_calls.length > 0) {
    let toolCalls: ToolCallResult[];
    try {
      toolCalls = choice.tool_calls.map((tc) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parseError = new Error(`Malformed tool call JSON: ${message}`);
      (parseError as Error & { providerInfo?: OpenRouterProviderInfo }).providerInfo = providerInfo;
      throw parseError;
    }
    return {
      id: typeof data.id === "string" ? data.id : undefined,
      model: typeof data.model === "string" ? data.model : undefined,
      providerInfo,
      toolCalls,
      usage: data.usage as ChatCompletionResult["usage"],
    };
  }

  return {
    id: typeof data.id === "string" ? data.id : undefined,
    model: typeof data.model === "string" ? data.model : undefined,
    content: choice.content || "",
    providerInfo,
    usage: data.usage as ChatCompletionResult["usage"],
  };
}

function unwrapBatchRecord(payload: unknown): OpenRouterBatchRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const value = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data
    : record;
  return value as OpenRouterBatchRecord;
}

function batchErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ── Main call ────────────────────────────────────────────────────────────────

export async function chatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ChatCompletionResult> {
  if (request.model.trim().endsWith(":batch")) {
    throw new Error("Batch-only models require the durable asynchronous Batch API path");
  }
  // Some models don't support the specific-function or "required" tool_choice forms.
  // Fall back through the compatibility ladder when an upstream provider
  // explicitly rejects the requested tool_choice value. Providers return this
  // as either 400 or 404, depending on their OpenAI-compatibility layer.
  const toolChoiceFallbacks: Array<ChatCompletionRequest["tool_choice"]> = [];
  if (request.tool_choice && request.tool_choice !== "auto") {
    if (request.tool_choice !== "required") toolChoiceFallbacks.push("required");
    toolChoiceFallbacks.push("auto");
  }

  // A per-model routing override (e.g. minimax/minimax-m3) wins over Exacto:
  // send the bare model pinned to a known-good provider. Otherwise apply Exacto
  // by default (idempotent — a slug with an explicit variant is left untouched).
  // A caller-supplied provider (e.g. the config endpoint pin) always wins.
  const routingOverride = MODEL_ROUTING_OVERRIDES[baseModelId(request.model)];
  let currentRequest: ChatCompletionRequest = routingOverride
    ? { ...request, model: baseModelId(request.model), provider: request.provider ?? routingOverride }
    : { ...request, model: withExactoRouting(request.model) };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: openRouterHeaders(apiKey),
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
      const data = await response.json() as Record<string, unknown>;
      return parseChatCompletionResult(apiKey, data, response.headers, timeoutMs);
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
    const errJson = parseJsonRecord(errBody);

    // tool_choice compatibility fallback: if the model rejects our tool_choice
    // value, retry with the next less-strict value in the ladder.
    if (isToolChoiceCompatibilityError(response.status, errBody) && toolChoiceFallbacks.length > 0) {
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

    throw new OpenRouterError(response.status, errBody, collectProviderInfo(response.headers, errJson));
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}
