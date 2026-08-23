import type { ChatCompletionRequest, ChatCompletionResult, OpenRouterProviderInfo } from "./openrouter.js";

const META_CHAT_COMPLETIONS_URL = "https://api.meta.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

export const META_DIRECT_PREFIX = "meta-direct/";
export const META_MUSE_CONTRIBUTOR_MODEL = `${META_DIRECT_PREFIX}muse-spark-1.2-contributor`;

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
    /billing|credit|payment|region|content[_ -]?policy|safety|moderation|blocked|refusal/.test(body);
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }
  throw new Error("Meta Model API returned malformed tool-call arguments");
}

export async function metaChatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ChatCompletionResult> {
  if (!apiKey) throw new MetaModelApiError(401, "META_API_KEY is not configured in Railway");

  const response = await fetch(META_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, provider: undefined, model: metaModelId(request.model) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bodyText = await response.text();
  if (!response.ok) throw new MetaModelApiError(response.status, bodyText);

  const body = JSON.parse(bodyText) as {
    id?: string;
    model?: string;
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> } }>;
    usage?: ChatCompletionResult["usage"];
  };
  const message = body.choices?.[0]?.message;
  const providerInfo: OpenRouterProviderInfo = {
    provider: "meta-model-api",
    endpoint: "direct",
    model: body.model ?? metaModelId(request.model),
    generationId: body.id ?? null,
  };
  return {
    id: body.id,
    model: body.model,
    content: message?.content ?? undefined,
    toolCalls: message?.tool_calls?.flatMap((call) => {
      const name = call.function?.name;
      if (!name) return [];
      return [{ name, arguments: parseToolArguments(call.function?.arguments) }];
    }),
    usage: body.usage,
    providerInfo,
  };
}
