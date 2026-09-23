import type { ChatCompletionRequest, ChatCompletionResult, ChatMessage, OpenRouterProviderInfo } from "./openrouter.js";

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
  return error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500 ||
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

async function withContributorSlot<T>(model: string, run: () => Promise<T>): Promise<T> {
  if (!metaModelId(model).endsWith("-contributor")) return run();
  while (contributorInFlight >= CONTRIBUTOR_MAX_IN_FLIGHT) {
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
      const res = await fetch(META_RESPONSES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildMetaResponsesBody(request)),
        signal: AbortSignal.timeout(timeoutMs),
      });
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

  const body = JSON.parse(bodyText) as {
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
    model: body.model ?? metaModelId(request.model),
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
