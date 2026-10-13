import type { ChatCompletionRequest, ChatCompletionResult, ChatMessage, OpenRouterProviderInfo } from "./openrouter.js";
import { AmbiguousBatchSubmissionError, classifySubmissionHttpFailure, DefinitiveBatchRejectionError } from "./batch-submission-error.js";
import { metaDispatcher } from "./meta-connection.js";

// Contributor models are served only by the Responses API; Chat Completions
// returns 404 model_not_found for them (verified 2026-09-23).
const META_RESPONSES_URL = "https://api.meta.ai/v1/responses";
// Muse always reasons before answering; reasoning tokens count against
// max_output_tokens, so reserve room on top of the caller's answer budget.
const REASONING_TOKEN_RESERVE = 16_384;
const DEFAULT_TIMEOUT_MS = 60_000;

export const META_DIRECT_PREFIX = "meta-direct/";
export const META_MUSE_CONTRIBUTOR_MODEL = `${META_DIRECT_PREFIX}muse-spark-1.3-contributor`;

export class MetaModelApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Meta Model API ${status}: ${body.slice(0, 300)}`);
    this.name = "MetaModelApiError";
  }
}

export function isMetaDirectModel(model: string): boolean {
  return model.trim().startsWith(META_DIRECT_PREFIX);
}

export function metaModelId(model: string): string {
  return model.trim().slice(META_DIRECT_PREFIX.length);
}

export function isTerminalMetaModelApiError(error: unknown): boolean {
  if (!(error instanceof MetaModelApiError)) return false;
  const body = error.body.toLowerCase();
  return error.status === 401 || error.status === 402 || error.status === 403 || error.status === 429 || error.status >= 500 ||
    /billing|credit|payment|region|content[_ -]?policy|safety|moderation|blocked|refusal|muse contributor unavailable/.test(body);
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error("Meta Model API returned malformed tool-call arguments");
}

function toResponsesInput(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    const textType = message.role === "assistant" ? "output_text" : "input_text";
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: textType, text: part.text }
          : { type: "input_image", image_url: part.image_url.url }),
    };
  });
}

export function buildMetaResponsesBody(request: ChatCompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: metaModelId(request.model),
    input: toResponsesInput(request.messages),
    max_output_tokens: (request.max_tokens ?? 4096) + REASONING_TOKEN_RESERVE,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.response_format?.type === "json_schema") {
    const { name, strict, schema } = request.response_format.json_schema;
    body.text = { format: { type: "json_schema", name, strict, schema } };
  } else if (request.response_format?.type === "json_object") {
    body.text = { format: { type: "json_object" } };
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }
  if (request.tool_choice) {
    body.tool_choice = typeof request.tool_choice === "string"
      ? request.tool_choice
      : { type: "function", name: request.tool_choice.function.name };
  }
  return body;
}

// Meta intermittently answers 404 model_not_found for Contributor models that
// are still listed and served (popcre/ai-devops#683): byte-identical requests
// alternate 200 and an instant 404/503 with no rate-limit headers. Retry both.
export const MODEL_NOT_FOUND_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

// Contributor models enforce a small team-wide in-flight cap and report overflow
// as 404/503 rather than 429 (measured 2026-09-23: 12 parallel -> 3 succeed).
// The team is shared with other POP apps, so keep this worker's share small.
const CONTRIBUTOR_MAX_IN_FLIGHT = Math.max(1, Number(process.env.META_CONTRIBUTOR_CONCURRENCY) || 2);
let contributorInFlight = 0;
const contributorWaiters: Array<() => void> = [];

const asyncReservations = new Map<string, string | null>();
const terminalResponses = new Set<string>();
const asyncCreating = new Set<string>();
function wakeContributorWaiters() { for (const wake of contributorWaiters.splice(0)) wake(); }
export function metaAsyncBusy(owner: string): boolean { return [...asyncReservations].some(([key, id]) => key !== owner || id !== null); }
export function synchronizeMetaReservations(operations: Record<string, import("./types.js").OpState>): void {
  const next = new Map<string, string | null>();
  for (const [key, state] of Object.entries(operations)) {
    const job = state.external_job;
    if (job?.provider !== "meta-responses") continue;
    const owner = state.run_id ?? key;
    const id = job.provider_batch_id;
    if (id && !terminalResponses.has(id) && (job.phase === "pending" || job.phase === "submitting" || job.phase === "ambiguous_submission")) next.set(owner, id);
    else if (!id && (job.phase === "submitting" || job.phase === "ambiguous_submission" || job.ambiguous_since)) next.set(owner, null);
  }
  // An acknowledged but unbound response is retained conservatively until
  // its exact terminal state is observed; a stale snapshot cannot release it.
  for (const [owner, id] of asyncReservations) if (id && !terminalResponses.has(id) && !next.has(owner)) next.set(owner, id);
  asyncReservations.clear(); for (const entry of next) asyncReservations.set(...entry);
  wakeContributorWaiters();
}
function releaseTerminalMetaResponse(id: string) {
  terminalResponses.add(id);
  for (const [owner, saved] of asyncReservations) if (saved === id) asyncReservations.delete(owner);
  wakeContributorWaiters();
}
export class MetaCapacityRejectionError extends Error {
  constructor(public readonly status: 404 | 503) { super("Meta Contributor rejected this request before generation due to known capacity/availability"); this.name = "MetaCapacityRejectionError"; }
}
export class MetaCapabilityRejectionError extends DefinitiveBatchRejectionError {}
export function classifyMetaSubmissionFailure(status: number, bodyText: string): DefinitiveBatchRejectionError | AmbiguousBatchSubmissionError | MetaCapacityRejectionError {
  let parsed: unknown; try { parsed = JSON.parse(bodyText); } catch { return new AmbiguousBatchSubmissionError("Meta", status); }
  const envelope = parsed && typeof parsed === "object" ? (parsed as {error?:unknown}).error : null;
  if (!envelope || typeof envelope !== "object") return new AmbiguousBatchSubmissionError("Meta", status);
  const error = envelope as Record<string, unknown>;
  const terminalTypes: Record<number, string> = {
    401: "authentication_error", 402: "billing_error", 403: "permission_error", 429: "rate_limit_error",
  };
  if (terminalTypes[status] && terminalTypes[status] === error.type && typeof error.message === "string" && error.message.length > 0) {
    return new DefinitiveBatchRejectionError("Meta", status as 401 | 402 | 403 | 429, { provider: "Meta", code: status });
  }
  if (status === 404 && error.type === "invalid_request_error" && error.code === "model_not_found" ||
      status === 503 && error.type === "server_error" && ["server_shutting_down", "service_overloaded", "backend_unavailable"].includes(String(error.code))) return new MetaCapacityRejectionError(status as 404 | 503);
  // Canonical Meta validation envelope, documented in /docs/error-handling.
  if ((status === 400 || status === 422) && error.type === "invalid_request_error" && (error.code === null || error.code === undefined) && typeof error.message === "string" && error.message.length > 0) {
    const outputParam = typeof error.param === "string" && /^(?:text(?:\.format(?:\.[a-z_]+)?)?|response_format(?:\.[a-z_]+)?|tools(?:\[\d+\])?(?:\.[a-z_]+)?|tool_choice)$/.test(error.param);
    const summary = { provider: "Meta", code: status, category: outputParam ? "meta_output_contract" : "meta_validation" };
    return outputParam ? new MetaCapabilityRejectionError("Meta", status, summary) : new DefinitiveBatchRejectionError("Meta", status, summary);
  }
  return classifySubmissionHttpFailure("Meta", status, bodyText);
}
async function withContributorSlot<T>(model: string, run: () => Promise<T>, reservationOwner?: string): Promise<T> {
  if (!metaModelId(model).endsWith("-contributor")) return run();
  while (contributorInFlight + [...asyncReservations.keys()].filter(owner => owner !== reservationOwner).length >= CONTRIBUTOR_MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => contributorWaiters.push(resolve));
  }
  contributorInFlight++;
  try {
    return await run();
  } finally {
    contributorInFlight--;
    contributorWaiters.shift()?.();
  }
}

function isTransientModelNotFound(status: number, body: string): boolean {
  return (status === 404 && body.includes("model_not_found")) || status === 503;
}

export async function metaChatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs: number[] = MODEL_NOT_FOUND_RETRY_DELAYS_MS,
): Promise<ChatCompletionResult> {
  if (!apiKey) throw new MetaModelApiError(401, "META_API_KEY is not configured in Railway");

  let response: Response;
  let bodyText: string;
  for (let attempt = 0; ; attempt++) {
    [response, bodyText] = await withContributorSlot(request.model, async () => {
      const requestOptions = {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildMetaResponsesBody(request)),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: metaDispatcher,
      };
      const res = await fetch(META_RESPONSES_URL, requestOptions);
      return [res, await res.text()] as const;
    });
    if (response.ok) break;
    if (!isTransientModelNotFound(response.status, bodyText) || attempt >= retryDelaysMs.length) {
      const note = isTransientModelNotFound(response.status, bodyText)
        ? ` (Muse Contributor unavailable after ${attempt + 1} attempts — see popcre/ai-devops#683)`
        : "";
      throw new MetaModelApiError(response.status, bodyText + note);
    }
    const delay = retryDelaysMs[attempt];
    await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay * 0.5));
  }

  return parseMetaResponse(JSON.parse(bodyText), request.model);
}

export function parseMetaResponse(raw: unknown, model: string): ChatCompletionResult {
  const body = raw as {
    id?: string;
    model?: string;
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: Array<{ type?: string; name?: string; arguments?: unknown; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
  if (body.status && body.status !== "completed") {
    throw new MetaModelApiError(422, `Meta response ${body.status}: ${body.incomplete_details?.reason ?? "unknown"}`);
  }
  const output = body.output ?? [];
  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  const toolCalls = output.flatMap((item) => {
    if (item.type !== "function_call" || !item.name) return [];
    return [{ name: item.name, arguments: parseToolArguments(item.arguments) }];
  });
  const providerInfo: OpenRouterProviderInfo = {
    provider: "meta-model-api",
    endpoint: "direct",
    model: body.model ?? metaModelId(model),
    generationId: body.id ?? null,
  };
  return {
    id: body.id,
    model: body.model,
    content: text || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: body.usage && {
      prompt_tokens: body.usage.input_tokens,
      completion_tokens: body.usage.output_tokens,
      total_tokens: body.usage.total_tokens,
    },
    providerInfo,
  };
}


/** One non-idempotent create. Any lost acknowledgement remains ambiguous. */
export async function createStoredMetaResponse(apiKey: string, request: ChatCompletionRequest, timeoutMs = DEFAULT_TIMEOUT_MS, reservationOwner = "anonymous-meta-create"): Promise<string> {
  if (metaAsyncBusy(reservationOwner) || asyncCreating.has(reservationOwner)) throw new Error("Another Meta generation is still pending");
  asyncReservations.set(reservationOwner, null);
  asyncCreating.add(reservationOwner);
  return withContributorSlot(request.model, async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const requestOptions = {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildMetaResponsesBody(request), stream: true, store: true }),
        signal: AbortSignal.timeout(timeoutMs), dispatcher: metaDispatcher,
      };
      const response = await fetch(META_RESPONSES_URL, requestOptions);
      if (!response.ok) throw classifyMetaSubmissionFailure(response.status, await response.text());
      if (!response.body) throw new AmbiguousBatchSubmissionError("Meta");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let pending = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) throw new AmbiguousBatchSubmissionError("Meta");
        pending += decoder.decode(chunk.value, { stream: true });
        // Only the creation envelope is needed. Bound unacknowledged stream data.
        if (pending.length > 1_048_576) throw new AmbiguousBatchSubmissionError("Meta");
        pending = pending.replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = pending.indexOf("\n\n")) >= 0) {
          const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          const envelope = JSON.parse(data) as { type?: string; response?: { id?: unknown } };
          if (envelope.type !== "response.created") continue;
          const id = envelope.response?.id;
          if (typeof id !== "string" || (!id.trim() || id.length > 256 || /[\x00-\x20\x7f]/.test(id))) throw new AmbiguousBatchSubmissionError("Meta");
          asyncReservations.set(reservationOwner, id);
          return id;
        }
      }
    } catch (error) {
      if (error instanceof DefinitiveBatchRejectionError) { asyncReservations.delete(reservationOwner); wakeContributorWaiters(); throw error; }
      if (error instanceof MetaCapacityRejectionError || error instanceof AmbiguousBatchSubmissionError) throw error;
      throw new AmbiguousBatchSubmissionError("Meta");
    } finally {
      // Cancelling the stream leaves the stored server response retrievable.
      asyncCreating.delete(reservationOwner);
      if (reader) void reader.cancel().catch(() => undefined);
    }
  }, reservationOwner);
}

export async function retrieveStoredMetaResponse(apiKey: string, id: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
  if ((!id.trim() || id.length > 256 || /[\x00-\x20\x7f]/.test(id))) throw new Error("Invalid saved Meta response ID");
  const requestOptions = {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs), dispatcher: metaDispatcher,
  };
  const response = await fetch(`${META_RESPONSES_URL}/${encodeURIComponent(id)}`, requestOptions);
  if (!response.ok) throw new MetaModelApiError(response.status, "Stored response retrieval failed");
  const body = await response.json() as Record<string, unknown>;
  if (body.id !== id) throw new Error("Meta returned a different response ID");
  if (["completed", "failed", "cancelled", "incomplete"].includes(String(body.status))) releaseTerminalMetaResponse(id);
  return body;
}
