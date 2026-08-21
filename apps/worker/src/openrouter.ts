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
const BATCH_COMPLETION_TIMEOUT_MS = 24 * 60 * 60_000;
let batchPollIntervalMs = 5_000;
/**
 * A freshly created batch is not immediately readable: OpenRouter returns
 * `202 validating` from the POST, and the first GET on that ID can answer
 * `404 Batch job ... not found.` for a few seconds while the job registers
 * (measured 2026-08-21: first poll 404, next poll 5s later in_progress).
 * We keep polling through an early 404 for this long before calling it real.
 */
const BATCH_VISIBILITY_GRACE_MS = 120_000;
const BATCH_COLLECT_WINDOW_MS = 25;
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

interface PendingBatchRequest {
  apiKey: string;
  request: ChatCompletionRequest;
  timeoutMs: number;
  resolve: (result: ChatCompletionResult) => void;
  reject: (error: unknown) => void;
}

interface OpenRouterBatchResultItem {
  custom_id?: string;
  response?: { status_code?: number; body?: unknown };
  error?: unknown;
}

interface OpenRouterBatchRecord {
  id?: string;
  status?: string;
  results?: OpenRouterBatchResultItem[];
  error?: unknown;
}

const pendingBatchQueues = new Map<string, PendingBatchRequest[]>();
let batchCustomIdSequence = 0;

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

async function runOpenRouterBatch(items: PendingBatchRequest[]): Promise<void> {
  const apiKey = items[0].apiKey;
  const baseModel = baseModelId(items[0].request.model);
  const requests = items.map((item) => {
    const customId = `popdam-${Date.now()}-${++batchCustomIdSequence}`;
    const body = { ...item.request, model: baseModel };
    // The discounted Gemini batch endpoint does not advertise temperature.
    // Omitting it also keeps repair requests compatible with batch-only models.
    delete body.temperature;
    return { custom_id: customId, body };
  });

  let createdResponse: Response;
  try {
    createdResponse = await fetch(OPENROUTER_BATCH_URL, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ endpoint: "/v1/chat/completions", model: baseModel, requests }),
    });
  } catch (error) {
    items.forEach((item) => item.reject(error));
    return;
  }
  const createdText = await createdResponse.text();
  if (!createdResponse.ok) {
    const error = new OpenRouterError(createdResponse.status, createdText);
    items.forEach((item) => item.reject(error));
    return;
  }
  const created = unwrapBatchRecord(parseJsonRecord(createdText));
  if (!created.id) {
    const error = new Error(`OpenRouter Batch API returned no batch ID: ${createdText.slice(0, 300)}`);
    items.forEach((item) => item.reject(error));
    return;
  }
  logger.info("openrouter batch: submitted", { batchId: created.id, model: baseModel, requests: requests.length });

  const submittedAt = Date.now();
  let everSeen = false;
  const deadline = Date.now() + Math.max(BATCH_COMPLETION_TIMEOUT_MS, ...items.map((item) => item.timeoutMs));
  let completed: OpenRouterBatchRecord | null = null;
  while (Date.now() < deadline) {
    let pollResponse: Response;
    try {
      pollResponse = await fetch(`${OPENROUTER_BATCH_URL}/${encodeURIComponent(created.id)}`, {
        headers: openRouterHeaders(apiKey),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      logger.warn("openrouter batch: status poll failed; retrying", { batchId: created.id, error: String(error) });
      await new Promise((resolve) => setTimeout(resolve, batchPollIntervalMs));
      continue;
    }
    const pollText = await pollResponse.text();
    if (!pollResponse.ok) {
      const transient =
        pollResponse.status === 429 ||
        pollResponse.status >= 500 ||
        // Not-yet-visible new batch — only before we have ever seen it, and
        // only inside the grace window. A 404 after that is a real failure.
        (pollResponse.status === 404 && !everSeen && Date.now() - submittedAt < BATCH_VISIBILITY_GRACE_MS);
      if (transient) {
        logger.warn("openrouter batch: status poll not ready; retrying", {
          batchId: created.id, status: pollResponse.status, body: pollText.slice(0, 200),
        });
        await new Promise((resolve) => setTimeout(resolve, batchPollIntervalMs));
        continue;
      }
      const error = new OpenRouterError(pollResponse.status, pollText);
      items.forEach((item) => item.reject(error));
      return;
    }
    everSeen = true;
    const record = unwrapBatchRecord(parseJsonRecord(pollText));
    if (record.status === "completed") {
      completed = record;
      break;
    }
    if (["failed", "cancelled", "canceled", "expired"].includes(record.status ?? "")) {
      const error = new Error(`OpenRouter batch ${created.id} ${record.status}: ${batchErrorText(record.error)}`);
      items.forEach((item) => item.reject(error));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, batchPollIntervalMs));
  }
  if (!completed) {
    const error = new Error(`OpenRouter batch ${created.id} did not finish within 24 hours`);
    items.forEach((item) => item.reject(error));
    return;
  }

  const byId = new Map((completed.results ?? []).map((result) => [result.custom_id, result]));
  await Promise.all(requests.map(async (submitted, index) => {
    const pending = items[index];
    const result = byId.get(submitted.custom_id);
    if (!result) {
      pending.reject(new Error(`OpenRouter batch ${created.id} omitted result ${submitted.custom_id}`));
      return;
    }
    const status = result.response?.status_code ?? 500;
    if (status < 200 || status >= 300 || result.error) {
      pending.reject(new OpenRouterError(status, batchErrorText(result.error ?? result.response?.body)));
      return;
    }
    const body = result.response?.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      pending.reject(new Error(`OpenRouter batch ${created.id} returned an invalid response body`));
      return;
    }
    try {
      pending.resolve(await parseChatCompletionResult(apiKey, body as Record<string, unknown>, new Headers(), pending.timeoutMs));
    } catch (error) {
      pending.reject(error);
    }
  }));
}

/** Test hook: shorten the batch status poll interval. */
export function setBatchPollIntervalForTests(ms: number): void {
  batchPollIntervalMs = ms;
}

function flushBatchQueue(queueKey: string): void {
  const queued = pendingBatchQueues.get(queueKey) ?? [];
  pendingBatchQueues.delete(queueKey);
  for (let offset = 0; offset < queued.length; offset += MAX_BATCH_REQUESTS) {
    void runOpenRouterBatch(queued.slice(offset, offset + MAX_BATCH_REQUESTS));
  }
}

function batchChatCompletion(apiKey: string, request: ChatCompletionRequest, timeoutMs: number): Promise<ChatCompletionResult> {
  const queueKey = `${apiKey}\u0000${baseModelId(request.model)}`;
  return new Promise((resolve, reject) => {
    const queue = pendingBatchQueues.get(queueKey);
    const pending = { apiKey, request, timeoutMs, resolve, reject };
    if (queue) {
      queue.push(pending);
      if (queue.length >= MAX_BATCH_REQUESTS) flushBatchQueue(queueKey);
    } else {
      pendingBatchQueues.set(queueKey, [pending]);
      setTimeout(() => flushBatchQueue(queueKey), BATCH_COLLECT_WINDOW_MS);
    }
  });
}

// ── Main call ────────────────────────────────────────────────────────────────

export async function chatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ChatCompletionResult> {
  if (request.model.trim().endsWith(":batch")) {
    return batchChatCompletion(apiKey, request, timeoutMs);
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
