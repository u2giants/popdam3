/**
 * Worker configuration — loaded from environment variables.
 */

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v.trim();
}

function optional(key: string, fallback: string): string {
  return (process.env[key] || "").trim() || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  // OpenRouter API key — single gateway for most AI providers
  openRouterApiKey: optional("OPENROUTER_API_KEY", ""),

  // Direct DeepSeek API key — used ONLY for cacheable high-volume batch work
  // (rich-PDF extraction) where DeepSeek's automatic prefix caching beats the
  // OpenRouter path on cost. Value lives in 1Password ai-provider-api-keys
  // (deepseek field); set DEEPSEEK_API_KEY in the Railway worker env.
  deepSeekApiKey: optional("DEEPSEEK_API_KEY", ""),

  // Legacy direct Anthropic key (unused by the OpenRouter path; kept for
  // any residual direct calls).
  anthropicApiKey: optional("ANTHROPIC_API_KEY", ""),

  // How often to poll Supabase for pending operations (ms).
  // 1s gives near-instant responsiveness without significant DB load.
  pollIntervalMs: optionalInt("WORKER_POLL_INTERVAL_MS", 1_000),

  // Parallel AI calls per AI tagging batch.
  // With the persistent worker (no 45s timeout) we can sustain high concurrency.
  aiBatchConcurrency: optionalInt("AI_BATCH_CONCURRENCY", 50),

  // Assets fetched per AI tagging batch
  aiBatchSize: optionalInt("AI_BATCH_SIZE", 50),
} as const;
