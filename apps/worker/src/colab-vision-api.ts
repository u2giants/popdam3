/**
 * Direct OpenAI-compatible vision client for ephemeral Google Colab GPU servers
 * (e.g., vLLM serving Qwen/Qwen3-VL-32B-Instruct behind an authenticated HTTPS tunnel).
 *
 * Model IDs use the prefix "colab-direct/<hf-model-id>", e.g.:
 *   "colab-direct/Qwen/Qwen3-VL-32B-Instruct"
 *
 * Endpoint URL and bearer token live in admin_config.COLAB_VISION_CONFIG
 * ({ base_url, api_key, auto_shutdown }) with env fallback (COLAB_VISION_BASE_URL / COLAB_VISION_API_KEY).
 * Short cache TTL (15s) lets a new Colab session take effect without restarting Railway.
 */

import { config } from "./config.js";
import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";
import type { ChatCompletionRequest, ChatCompletionResult, ToolCallResult } from "./openrouter.js";

export const COLAB_DIRECT_PREFIX = "colab-direct/";
const COLAB_MODEL_SHAPE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/;
const CONFIG_CACHE_TTL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ColabVisionConfig {
  baseUrl: string;
  apiKey: string;
  autoShutdown: boolean;
}

export class ColabVisionApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Colab Vision API ${status}: ${body.slice(0, 300)}`);
    this.name = "ColabVisionApiError";
  }
}

export function isColabDirectModel(model: string): boolean {
  const trimmed = model.trim();
  if (!trimmed.startsWith(COLAB_DIRECT_PREFIX)) return false;
  return COLAB_MODEL_SHAPE.test(trimmed.slice(COLAB_DIRECT_PREFIX.length));
}

export function colabModelId(model: string): string {
  return model.trim().slice(COLAB_DIRECT_PREFIX.length);
}

export function isTerminalColabVisionApiError(error: unknown): boolean {
  if (!(error instanceof ColabVisionApiError)) return false;
  return error.status === 401 || error.status === 403 || error.status === 404 || error.status === 429 || error.status >= 500;
}

function isPrivateIpv4Octets(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 loopback, ULA (fc00::/7), link-local (fe80::/10), and IPv4-mapped IPv6 (::ffff:...)
  if (h.includes(":")) {
    if (h === "::" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    if (h.startsWith("::ffff:")) {
      const mapped = h.slice("::ffff:".length);
      const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped);
      if (dotted) return isPrivateIpv4Octets(Number(dotted[1]), Number(dotted[2]));
      const hexPair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
      if (hexPair) {
        const hi = parseInt(hexPair[1], 16);
        return isPrivateIpv4Octets((hi >> 8) & 0xff, hi & 0xff);
      }
      return true;
    }
    return false;
  }
  // Reject raw integer / hex / octal IPv4 forms
  if (/^(?:0x[0-9a-f]+|\d+)$/.test(h)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) return isPrivateIpv4Octets(Number(ipv4[1]), Number(ipv4[2]));
  return false;
}

export function validateColabBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Colab Vision base_url is empty");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Colab Vision base_url is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Colab Vision base_url must use https://");
  }
  if (url.username || url.password) {
    throw new Error("Colab Vision base_url must not contain credentials");
  }
  if (isPrivateOrLoopbackHost(url.hostname)) {
    throw new Error("Colab Vision base_url must be a public HTTPS host");
  }
  const normalizedPath = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1$/i, "");
  return `${url.origin}${normalizedPath}`;
}

type ConfigRow = { found: boolean; baseUrl: string; apiKey: string; autoShutdown: boolean };
let cachedConfig: { value: ColabVisionConfig; cachedAt: number } | null = null;

function parseConfigRow(value: unknown): { baseUrl: string; apiKey: string; autoShutdown: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { baseUrl: "", apiKey: "", autoShutdown: true };
  const record = value as Record<string, unknown>;
  const baseUrl = typeof record.base_url === "string" ? record.base_url.trim() : "";
  const apiKey = typeof record.api_key === "string" ? record.api_key.trim() : "";
  const autoShutdown = record.auto_shutdown !== false;
  return { baseUrl, apiKey, autoShutdown };
}

async function readColabConfigFromDb(): Promise<ConfigRow> {
  const { data, error } = await withDependencyTimeout(
    "COLAB_VISION_CONFIG config read",
    db().from("admin_config").select("value").eq("key", "COLAB_VISION_CONFIG").maybeSingle(),
  );
  if (error) throw new Error(error.message);
  if (data === null) return { found: false, baseUrl: "", apiKey: "", autoShutdown: true };
  const parsed = parseConfigRow(data.value);
  return { found: true, ...parsed };
}

export async function getColabVisionConfig(
  loadFromDb: () => Promise<ConfigRow> = readColabConfigFromDb,
): Promise<ColabVisionConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.cachedAt < CONFIG_CACHE_TTL_MS) return cachedConfig.value;

  let baseUrl = config.colabVisionBaseUrl.trim();
  let apiKey = config.colabVisionApiKey.trim();
  let autoShutdown = true;
  try {
    const row = await loadFromDb();
    if (row.found) {
      baseUrl = row.baseUrl.trim();
      apiKey = row.apiKey.trim();
      autoShutdown = row.autoShutdown;
    }
  } catch (error) {
    logger.error("colab-vision-api: could not read admin_config.COLAB_VISION_CONFIG; using environment fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let normalizedUrl = "";
  if (baseUrl) {
    try {
      normalizedUrl = validateColabBaseUrl(baseUrl);
    } catch (error) {
      logger.warn("colab-vision-api: ignoring invalid COLAB_VISION_CONFIG base_url", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const value = { baseUrl: normalizedUrl, apiKey, autoShutdown };
  cachedConfig = { value, cachedAt: now };
  return value;
}

export async function getColabVisionApiKey(
  loadFromDb?: () => Promise<ConfigRow>,
): Promise<string> {
  try {
    const cfg = await getColabVisionConfig(loadFromDb);
    return cfg.baseUrl && cfg.apiKey ? cfg.apiKey : "";
  } catch {
    return "";
  }
}

// Tracks concurrent in-process jobs sharing the ephemeral Colab GPU (e.g., bulk tagging + Vision Bake-Off)
// so one finisher does not shut down the GPU while another active consumer still needs it.
const activeColabConsumers = new Set<string>();

export function markColabConsumerActive(consumerId: string): void {
  if (consumerId) activeColabConsumers.add(consumerId);
}

export async function releaseColabConsumerAndMaybeShutdown(
  consumerId: string,
  options?: Parameters<typeof shutdownColabVisionServer>[0],
): Promise<boolean> {
  if (consumerId) activeColabConsumers.delete(consumerId);
  if (activeColabConsumers.size > 0) {
    logger.info("colab-vision-api: deferring instant shutdown while another Colab consumer is active", {
      consumerId,
      remainingConsumers: activeColabConsumers.size,
    });
    return false;
  }
  return shutdownColabVisionServer(options);
}

export function resetColabVisionConfigCacheForTests(): void {
  cachedConfig = null;
  activeColabConsumers.clear();
}

function parseOpenAiToolCalls(rawToolCalls: unknown): ToolCallResult[] | undefined {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return undefined;
  const parsed: ToolCallResult[] = [];
  for (const call of rawToolCalls) {
    if (!call || typeof call !== "object") continue;
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn || typeof fn.name !== "string") continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string") {
      try {
        const obj = JSON.parse(fn.arguments);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) args = obj as Record<string, unknown>;
      } catch {
        continue;
      }
    } else if (fn.arguments && typeof fn.arguments === "object" && !Array.isArray(fn.arguments)) {
      args = fn.arguments as Record<string, unknown>;
    }
    parsed.push({ name: fn.name, arguments: args });
  }
  return parsed.length > 0 ? parsed : undefined;
}

export async function colabChatCompletion(
  apiKey: string,
  request: ChatCompletionRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  options?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<ChatCompletionResult> {
  const targetModel = colabModelId(request.model);
  if (!isColabDirectModel(request.model) || !targetModel) {
    throw new ColabVisionApiError(400, `Invalid Colab Vision model ID: ${request.model}`);
  }
  const baseUrl = options?.baseUrl
    ? validateColabBaseUrl(options.baseUrl)
    : (await getColabVisionConfig()).baseUrl;
  if (!baseUrl) throw new ColabVisionApiError(503, "Google Colab vision base_url is not configured");
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) throw new ColabVisionApiError(401, "Google Colab vision api_key is not configured");

  const body: Record<string, unknown> = {
    model: targetModel,
    messages: request.messages,
    max_tokens: request.max_tokens ?? 4000,
    temperature: request.temperature ?? 0,
  };
  if (request.response_format) body.response_format = request.response_format;
  if (request.tools?.length) body.tools = request.tools;
  if (request.tool_choice) body.tool_choice = request.tool_choice;

  const fetchFn = options?.fetchImpl ?? fetch;
  const response = await fetchFn(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${trimmedKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ColabVisionApiError(response.status, text);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Non-terminal parse error so executeStructuredOutput can continue its fallback/repair ladder.
    throw new Error(`Invalid JSON response from Colab Vision API: ${text.slice(0, 200)}`);
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as { message?: { content?: unknown; tool_calls?: unknown } } | undefined;
  const content = typeof first?.message?.content === "string" ? first.message.content : undefined;
  const toolCalls = parseOpenAiToolCalls(first?.message?.tool_calls);
  const usage = data.usage && typeof data.usage === "object"
    ? data.usage as ChatCompletionResult["usage"]
    : undefined;

  return {
    id: typeof data.id === "string" ? data.id : undefined,
    model: typeof data.model === "string" ? data.model : targetModel,
    content,
    toolCalls,
    usage,
    providerInfo: {
      provider: "google-colab",
      servedModel: typeof data.model === "string" ? data.model : targetModel,
      source: "direct-colab",
    } as ChatCompletionResult["providerInfo"],
  };
}

/**
 * Best-effort immediate shutdown signal to the ephemeral Colab vision server
 * when a bulk tagging or bake-off job finishes with no remaining work.
 * Enabled by default (opt out via admin_config.COLAB_VISION_CONFIG.auto_shutdown = false).
 * Never throws so a network/tunnel hiccup can never fail a completed job.
 */
export async function shutdownColabVisionServer(options?: {
  reason?: string;
  baseUrl?: string;
  apiKey?: string;
  autoShutdown?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  loadFromDb?: () => Promise<ConfigRow>;
}): Promise<boolean> {
  try {
    const hasExplicitEndpoint = Boolean(options?.baseUrl && options?.apiKey);
    const cfg = hasExplicitEndpoint
      ? {
          baseUrl: validateColabBaseUrl(options!.baseUrl!),
          apiKey: options!.apiKey!.trim(),
          autoShutdown: options?.autoShutdown ?? true,
        }
      : await getColabVisionConfig(options?.loadFromDb);
    const trimmedKey = cfg.apiKey.trim();
    const shouldShutdown = options?.autoShutdown ?? cfg.autoShutdown;
    if (!shouldShutdown || !cfg.baseUrl || !trimmedKey) return false;

    const fetchFn = options?.fetchImpl ?? fetch;
    const response = await fetchFn(`${cfg.baseUrl}/popdam/shutdown`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmedKey}`,
      },
      body: JSON.stringify({ reason: options?.reason ?? "job_completed" }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 10_000),
    });
    if (!response.ok) {
      logger.warn("colab-vision-api: instant shutdown signal returned non-2xx", {
        status: response.status,
        reason: options?.reason ?? "job_completed",
      });
      return false;
    }
    logger.info("colab-vision-api: instant shutdown signal acknowledged by Colab server", {
      reason: options?.reason ?? "job_completed",
    });
    return true;
  } catch (error) {
    logger.warn("colab-vision-api: instant shutdown signal failed (idle fallback will still protect units)", {
      reason: options?.reason ?? "job_completed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
