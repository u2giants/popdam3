/** Server-side resolver for the existing database-managed Google AI key. */
import { config } from "./config.js";
import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

const CACHE_TTL_MS = 60_000;
let cachedKey: string | null = null;
let cachedAt = 0;

function unwrap(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).value;
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

async function readKeyFromAdminConfig(): Promise<string> {
  const { data, error } = await withDependencyTimeout(
    "Google AI key config read",
    db().from("admin_config").select("value").eq("key", "GOOGLE_AI_API_KEY").maybeSingle(),
  );
  if (error) throw new Error(error.message);
  return unwrap(data?.value);
}

export async function resolveGoogleAiApiKey(
  loadFromDb: () => Promise<string> = readKeyFromAdminConfig,
  envKey: string = config.googleAiApiKey,
): Promise<string> {
  const now = Date.now();
  if (cachedKey !== null && now - cachedAt < CACHE_TTL_MS) return cachedKey;
  let dbKey = "";
  try {
    dbKey = await loadFromDb();
  } catch (error) {
    logger.error("google-ai-key: database-managed key unavailable; using environment fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  cachedKey = dbKey || envKey;
  cachedAt = now;
  return cachedKey;
}

export function getGoogleAiApiKey(): Promise<string> {
  return resolveGoogleAiApiKey();
}

export function resetGoogleAiKeyCacheForTests(): void {
  cachedKey = null;
  cachedAt = 0;
}
