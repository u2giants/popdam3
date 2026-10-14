/** Database-managed keys for direct model providers, with env-only rollout fallback. */
import { config } from "./config.js";
import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

const CACHE_TTL_MS = 60_000;
type DirectProviderKey = "META_API_KEY" | "SCALEDOWN_API_KEY";
type KeyRow = { found: boolean; value: string };
const cache = new Map<DirectProviderKey, { value: string; cachedAt: number }>();

function unwrap(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).value;
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

async function readKeyFromAdminConfig(key: DirectProviderKey): Promise<KeyRow> {
  const { data, error } = await withDependencyTimeout(
    `${key} config read`,
    db().from("admin_config").select("value").eq("key", key).maybeSingle(),
  );
  if (error) throw new Error(error.message);
  return { found: data !== null, value: unwrap(data?.value) };
}

export async function resolveDirectProviderApiKey(
  configKey: DirectProviderKey,
  envKey: string,
  loadFromDb: () => Promise<KeyRow> = () => readKeyFromAdminConfig(configKey),
): Promise<string> {
  const now = Date.now();
  const cached = cache.get(configKey);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  let value = envKey;
  try {
    const row = await loadFromDb();
    // An explicitly saved blank value means the endpoint key was cleared; only
    // a missing row or an unreadable database uses the legacy environment key.
    if (row.found) value = row.value;
  } catch (error) {
    logger.error(`provider-api-key: could not read admin_config.${configKey}; using environment fallback`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  cache.set(configKey, { value, cachedAt: now });
  return value;
}

export function getMetaApiKey(): Promise<string> {
  return resolveDirectProviderApiKey("META_API_KEY", config.metaApiKey);
}

export function getScaleDownApiKey(): Promise<string> {
  return resolveDirectProviderApiKey("SCALEDOWN_API_KEY", config.scaledownApiKey);
}

export function resetDirectProviderApiKeyCacheForTests(): void {
  cache.clear();
}
