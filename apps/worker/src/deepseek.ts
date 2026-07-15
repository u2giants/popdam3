/**
 * Direct DeepSeek API client (OpenAI-compatible).
 *
 * Used ONLY for cacheable, high-volume batch work — currently rich-PDF
 * extraction. DeepSeek's API does automatic prefix-based context caching:
 * cache-hit input tokens bill at ~1/10 the miss price. Because rich-PDF
 * extraction sends the SAME large instruction+schema prefix on every one of
 * ~19k calls, that caching is a major cost saver — which OpenRouter does not
 * reliably pass through. See docs/RICH_PDF_EXTRACTION.md.
 *
 * To maximize cache hits, callers MUST put the stable content (instructions +
 * schema) in `system` (the shared prefix) and the variable content (the PDF
 * text) in `user`, which comes last.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface DeepSeekResult {
  content: string;
  usage: DeepSeekUsage;
  model: string;
}

export class DeepSeekError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export interface DeepSeekChatOptions {
  apiKey: string;
  model: string;
  /** Stable prefix (instructions + schema) — cached across calls. */
  system: string;
  /** Variable content (the PDF text) — sent last. */
  user: string;
  /** Force JSON-object output (DeepSeek JSON mode). Default true. */
  jsonMode?: boolean;
  temperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Call DeepSeek chat completions. Retries transient (429/5xx/network) errors
 * with exponential backoff. Throws DeepSeekError on terminal failure.
 */
export async function deepSeekChat(opts: DeepSeekChatOptions): Promise<DeepSeekResult> {
  const {
    apiKey,
    model,
    system,
    user,
    jsonMode = true,
    temperature = 0,
    maxRetries = 3,
    timeoutMs = 120_000,
  } = opts;

  if (!apiKey) throw new DeepSeekError("DeepSeek API key not configured (set DEEPSEEK_API_KEY)");

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxRetries) {
          lastError = new DeepSeekError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status);
          await backoff(attempt);
          continue;
        }
        throw new DeepSeekError(`HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: DeepSeekUsage;
        model?: string;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new DeepSeekError("DeepSeek returned empty content");
      }
      return { content, usage: json.usage ?? {}, model: json.model ?? model };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt < maxRetries) {
        lastError = err as Error;
        await backoff(attempt);
        continue;
      }
      if (err instanceof DeepSeekError) throw err;
      throw new DeepSeekError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DeepSeekError(lastError?.message ?? "DeepSeek request failed after retries");
}

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(1_000 * 2 ** attempt, 8_000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
