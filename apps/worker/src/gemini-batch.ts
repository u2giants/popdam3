import type { ChatCompletionRequest, ChatCompletionResult, OpenRouterBatchSubmission } from "./openrouter.js";
import { AmbiguousBatchSubmissionError, classifySubmissionHttpFailure, pollTransport, PreSubmissionError } from "./batch-submission-error.js";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const DIRECT_PREFIX = "google-direct/";
const BATCH_SUFFIX = ":batch";
const MAX_INLINE_BATCH_BYTES = 19 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIRECT_BATCH_REQUESTS = 3;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const TRUSTED_THUMBNAIL_HOSTS = new Set([
  "cdn.designflow.app",
  "popdam.nyc3.digitaloceanspaces.com",
  "popdam.nyc3.cdn.digitaloceanspaces.com",
]);

export class GeminiBatchError extends Error {
  constructor(public status: number, message: string) {
    super(`Gemini Batch ${status}: ${redact(message).slice(0, 300)}`);
    this.name = "GeminiBatchError";
  }
}

export interface GeminiBatchResultItem {
  custom_id?: string;
  response?: unknown;
  error?: unknown;
}

export interface GeminiBatchRecord {
  id?: string;
  status?: string;
  results?: GeminiBatchResultItem[];
  error?: unknown;
}

export function isDirectGeminiBatchModel(model: string): boolean {
  const value = model.trim();
  return value.startsWith(DIRECT_PREFIX) && value.endsWith(BATCH_SUFFIX);
}

export function directGeminiModelId(model: string): string {
  if (!isDirectGeminiBatchModel(model)) throw new Error("Direct Gemini batch model must use google-direct/<model>:batch");
  const id = model.trim().slice(DIRECT_PREFIX.length, -BATCH_SUFFIX.length);
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("Direct Gemini batch model ID contains unsupported characters");
  return id;
}

function redact(value: string): string {
  return value
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/data:[^\s"']+/gi, "[REDACTED_MEDIA]");
}

function safeErrorMessage(_text: string): string {
  // Provider errors may echo prompts, media, or credentials. Status is enough
  // for operations; keep the raw body out of logs, state, and exceptions.
  return "provider request failed";
}

async function imagePart(urlValue: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const inline = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(urlValue);
  if (inline) {
    const bytes = Buffer.from(inline[2], "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Gemini batch image must be 1-${MAX_IMAGE_BYTES} bytes`);
    }
    return { inlineData: { mimeType: inline[1].toLowerCase(), data: inline[2] } };
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("Gemini batch image URL must be valid public http(s)");
  }
  validateThumbnailUrl(url);
  const fetchSignal = AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS);
  let response: Response | undefined;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(url, { redirect: "manual", signal: fetchSignal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 3) throw new Error("Gemini batch image exceeded the redirect limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("Gemini batch image redirect has no location");
      url = new URL(location, url);
      validateThumbnailUrl(url);
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message))) {
      throw new Error("Gemini thumbnail fetch timed out before submission");
    }
    throw error;
  }
  if (!response) throw new Error("Gemini batch image fetch produced no response");
  if (!response.ok) throw new Error(`Gemini batch image fetch HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`Gemini batch image must be 1-${MAX_IMAGE_BYTES} bytes`);
  }
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) throw new Error("Gemini batch image response has unsupported content type");
  if (!response.body) throw new Error("Gemini batch image response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error(`Gemini batch image must be 1-${MAX_IMAGE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  if (byteLength === 0) {
    throw new Error(`Gemini batch image must be 1-${MAX_IMAGE_BYTES} bytes`);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
  return { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } };
}

function validateThumbnailUrl(url: URL): void {
  if (url.protocol !== "https:" || !TRUSTED_THUMBNAIL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Gemini batch image URL must use an approved public thumbnail host");
  }
  if (url.username || url.password) throw new Error("Gemini batch image URL must not contain credentials");
}

async function requestToGemini(request: ChatCompletionRequest) {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  const systemParts: Array<{ text: string }> = [];
  for (const message of request.messages) {
    const parts: Array<Record<string, unknown>> = [];
    const inputParts = typeof message.content === "string"
      ? [{ type: "text" as const, text: message.content }]
      : message.content;
    for (const part of inputParts) {
      if (part.type === "text") parts.push({ text: part.text });
      else parts.push(await imagePart(part.image_url.url));
    }
    if (message.role === "system") {
      for (const part of parts) if (typeof part.text === "string") systemParts.push({ text: part.text });
    } else {
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
    }
  }
  const generationConfig: Record<string, unknown> = {};
  if (request.max_tokens) generationConfig.maxOutputTokens = request.max_tokens;
  if (request.response_format?.type === "json_schema") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = toGeminiJsonSchema(request.response_format.json_schema.schema);
  } else if (request.response_format?.type === "json_object") {
    generationConfig.responseMimeType = "application/json";
  }
  return {
    contents,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

/** Convert the production JSON schemas to Gemini's documented JSON-Schema subset. */
export function toGeminiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) result[key] = convert(child);
    if (Array.isArray(source.enum) && source.enum.includes(null)) {
      const allowed = source.enum.filter((entry) => entry !== null);
      const rawTypes = Array.isArray(source.type) ? source.type : [source.type];
      const nonNullTypes = rawTypes.filter((entry) => entry && entry !== "null");
      delete result.type;
      delete result.enum;
      result.anyOf = [
        { type: nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes, enum: allowed },
        { type: "null" },
      ];
    }
    return result;
  };
  return convert(schema) as Record<string, unknown>;
}

export async function buildGeminiBatchPayload(
  items: OpenRouterBatchSubmission[],
  displayName = "popdam-image-tagging",
  maxPayloadBytes = MAX_INLINE_BATCH_BYTES,
) {
  if (items.length === 0 || items.length > MAX_DIRECT_BATCH_REQUESTS) throw new Error("Gemini batch requires 1-3 requests");
  // At most three trusted thumbnails are fetched concurrently. Each fetch has a
  // 20-second deadline, leaving most of the 120-second submission lease for POST
  // and guarded ID persistence.
  const requests = await Promise.all(items.map(async (item) => ({
    request: await requestToGemini(item.request),
    metadata: { key: item.customId },
  })));
  const payload = { batch: { displayName, inputConfig: { requests: { requests } } } };
  if (Buffer.byteLength(JSON.stringify(payload)) > maxPayloadBytes) {
    throw new Error("Gemini inline batch exceeds the 19 MB safety ceiling");
  }
  return payload;
}

function headers(apiKey: string): Record<string, string> {
  if (!apiKey) throw new GeminiBatchError(401, "GOOGLE_AI_API_KEY is not configured");
  return { "x-goog-api-key": apiKey, "Content-Type": "application/json" };
}

export interface PreparedGeminiBatch {
  provider: "google-gemini";
  model: string;
  body: string;
}

export async function prepareGeminiBatch(items: OpenRouterBatchSubmission[]): Promise<PreparedGeminiBatch> {
  const model = directGeminiModelId(items[0]?.request.model ?? "");
  const payload = await buildGeminiBatchPayload(items);
  return { provider: "google-gemini", model, body: JSON.stringify(payload) };
}

export async function submitPreparedGeminiBatch(apiKey: string, prepared: PreparedGeminiBatch): Promise<GeminiBatchRecord> {
  if (!apiKey) throw new PreSubmissionError("GOOGLE_AI_API_KEY is not configured");
  const requestHeaders = headers(apiKey);
  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(prepared.model)}:batchGenerateContent`, {
      method: "POST", headers: requestHeaders, body: prepared.body, signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AmbiguousBatchSubmissionError("Gemini");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    if (response.ok) throw new AmbiguousBatchSubmissionError("Gemini");
    throw classifySubmissionHttpFailure("google-gemini", response.status, undefined);
  }
  // Only a parsed Google 400/422 error envelope is definitive; timeouts,
  // disconnects, 5xx and every other status stay ambiguous.
  if (!response.ok) throw classifySubmissionHttpFailure("google-gemini", response.status, text);
  let parsed: { name?: unknown };
  try {
    parsed = JSON.parse(text) as { name?: unknown };
  } catch {
    throw new AmbiguousBatchSubmissionError("Gemini");
  }
  if (typeof parsed.name !== "string" || !/^batches\/[A-Za-z0-9._-]+$/.test(parsed.name)) {
    throw new AmbiguousBatchSubmissionError("Gemini");
  }
  return { id: parsed.name, status: "pending" };
}

export async function submitGeminiBatch(apiKey: string, items: OpenRouterBatchSubmission[]): Promise<GeminiBatchRecord> {
  return submitPreparedGeminiBatch(apiKey, await prepareGeminiBatch(items));
}

function normalizeState(raw: unknown, done: unknown): string {
  const state = typeof raw === "string" ? raw : "";
  if (state === "BATCH_STATE_SUCCEEDED" || state === "JOB_STATE_SUCCEEDED") return "completed";
  if (state === "BATCH_STATE_FAILED" || state === "JOB_STATE_FAILED") return "failed";
  if (state === "BATCH_STATE_CANCELLED" || state === "JOB_STATE_CANCELLED") return "cancelled";
  if (state === "BATCH_STATE_EXPIRED" || state === "JOB_STATE_EXPIRED") return "expired";
  return done === true ? "failed" : "pending";
}

function inlineResults(value: unknown): GeminiBatchResultItem[] | undefined {
  if (Array.isArray(value)) return value.map(normalizeResult);
  if (value && typeof value === "object") {
    const nested = (value as Record<string, unknown>).inlinedResponses;
    if (Array.isArray(nested)) return nested.map(normalizeResult);
  }
  return undefined;
}

function normalizeResult(value: unknown): GeminiBatchResultItem {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};
  return {
    custom_id: typeof metadata.key === "string" ? metadata.key : undefined,
    response: item.response,
    error: item.error,
  };
}

export async function getGeminiBatch(apiKey: string, batchId: string): Promise<GeminiBatchRecord> {
  if (!/^batches\/[A-Za-z0-9._-]+$/.test(batchId)) throw new Error("Invalid Gemini batch name");
  const requestHeaders = headers(apiKey);
  const response = await pollTransport("Gemini", () => fetch(`${GEMINI_API_ROOT}/${batchId}`, { headers: requestHeaders, signal: AbortSignal.timeout(30_000) }));
  const text = await pollTransport("Gemini", () => response.text());
  if (!response.ok) throw new GeminiBatchError(response.status, safeErrorMessage(text));
  const parsed = await pollTransport("Gemini", () => {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  });
  const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata as Record<string, unknown> : {};
  const responseBody = parsed.response && typeof parsed.response === "object" ? parsed.response as Record<string, unknown> : {};
  const output = responseBody.output && typeof responseBody.output === "object"
    ? responseBody.output as Record<string, unknown> : {};
  const dest = parsed.dest && typeof parsed.dest === "object" ? parsed.dest as Record<string, unknown> : {};
  // GenerateContentBatch resource shape: top-level `output.inlinedResponses`.
  const topOutput = parsed.output && typeof parsed.output === "object" ? parsed.output as Record<string, unknown> : {};
  return {
    id: typeof parsed.name === "string" ? parsed.name : batchId,
    status: normalizeState(metadata.state ?? responseBody.state ?? parsed.state, parsed.done),
    results: inlineResults(output.inlinedResponses ?? topOutput.inlinedResponses ?? responseBody.inlinedResponses ?? dest.inlinedResponses),
    error: parsed.error,
  };
}

/**
 * One synchronous generateContent call on the same direct Gemini model. Used
 * only for the text-only JSON-repair step after a batch result is malformed;
 * it never submits or replaces a batch.
 */
export async function geminiGenerateContent(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs = 60_000,
): Promise<ChatCompletionResult> {
  const modelId = directGeminiModelId(request.model);
  const body = await requestToGemini(request);
  const response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(modelId)}:generateContent`, {
    method: "POST", headers: headers(apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new GeminiBatchError(response.status, safeErrorMessage(text));
  return parseGeminiBatchResult({ response: JSON.parse(text) });
}

export function parseGeminiBatchResult(item: GeminiBatchResultItem): ChatCompletionResult {
  if (item.error) throw new GeminiBatchError(422, "one batch request failed");
  if (!item.response || typeof item.response !== "object" || Array.isArray(item.response)) {
    throw new Error("Gemini batch returned an invalid response body");
  }
  const body = item.response as Record<string, unknown>;
  const candidates = Array.isArray(body.candidates) ? body.candidates as Array<Record<string, unknown>> : [];
  const content = candidates[0]?.content && typeof candidates[0].content === "object"
    ? candidates[0].content as Record<string, unknown> : {};
  const parts = Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];
  const text = parts.map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
  if (!text) throw new Error("Gemini batch returned no text result");
  const usage = body.usageMetadata && typeof body.usageMetadata === "object" ? body.usageMetadata as Record<string, unknown> : {};
  return {
    content: text,
    usage: {
      prompt_tokens: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined,
      completion_tokens: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined,
      total_tokens: typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined,
    },
  };
}
