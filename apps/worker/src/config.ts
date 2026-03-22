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

  // Google Gemini API key for asset tagging
  googleAiApiKey: optional("GOOGLE_AI_API_KEY", ""),

  // Anthropic API key for ERP classification
  anthropicApiKey: optional("ANTHROPIC_API_KEY", ""),

  // How often to poll Supabase for pending operations (ms)
  pollIntervalMs: optionalInt("WORKER_POLL_INTERVAL_MS", 5_000),

  // Parallel Gemini calls per AI tagging batch
  aiBatchConcurrency: optionalInt("AI_BATCH_CONCURRENCY", 15),

  // Assets fetched per AI tagging batch
  aiBatchSize: optionalInt("AI_BATCH_SIZE", 15),
} as const;
