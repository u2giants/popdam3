/** Database-managed keys for direct model providers, with env-only rollout fallback. */
import { config } from "./config.js";
import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

const CACHE_TTL_MS = 60_000;
type DirectProviderKey = "META_API_KEY" | "SCALEDOWN_API_KEY" | "STRAITLY_API_KEY" | "STRAITLY_ROUTING" | "OPENROUTER_ROUTING";
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

let straitlyKeyOverride: string | null = null;
let openRouterRoutingOverride: string | null = null;

/** Test hook: force OPENROUTER_ROUTING (null restores normal lookup). */
export function setOpenRouterRoutingForTests(value: string | null): void {
  openRouterRoutingOverride = value;
}

export function getStraitlyApiKey(): Promise<string> {
  if (straitlyKeyOverride !== null) return Promise.resolve(straitlyKeyOverride);
  return resolveDirectProviderApiKey("STRAITLY_API_KEY", config.straitlyApiKey);
}

/** admin_config.STRAITLY_ROUTING = "off" sends non-OpenAI models back to OpenRouter. */
export async function isStraitlyRoutingEnabled(): Promise<boolean> {
  if (straitlyKeyOverride !== null) return true;
  return (await resolveDirectProviderApiKey("STRAITLY_ROUTING", "")).toLowerCase() !== "off";
}

/**
 * admin_config.STRAITLY_ROUTING: "off" → null (OpenRouter only); "share:N" →
 * { cap: N } (Straitly up to N in flight, rest OpenRouter); anything else → {} (all Straitly).
 */
let straitlyRoutingOverride: string | null = null;
export function setStraitlyRoutingForTests(value: string | null): void { straitlyRoutingOverride = value; }

export async function straitlyRouting(): Promise<{ cap?: number } | null> {
  if (straitlyRoutingOverride === null && straitlyKeyOverride !== null) return {};
  const raw = (straitlyRoutingOverride ?? await resolveDirectProviderApiKey("STRAITLY_ROUTING", "")).trim().toLowerCase();
  if (raw === "off") return null;
  const share = /^share:(\d+)$/.exec(raw);
  return share ? { cap: Number(share[1]) } : {};
}

/** admin_config.OPENROUTER_ROUTING = "cheapest" routes by price among healthy providers instead of Exacto. */
export async function openRouterCheapestRouting(): Promise<boolean> {
  if (straitlyKeyOverride !== null || openRouterRoutingOverride !== null) return openRouterRoutingOverride === "cheapest";
  return (await resolveDirectProviderApiKey("OPENROUTER_ROUTING", "")).toLowerCase() === "cheapest";
}

const providerListCache = { value: {} as Record<string, string[]>, cachedAt: 0 };

/**
 * admin_config.OPENROUTER_PROVIDER_ALLOWLIST: {"author/model": ["provider/tag", ...]}.
 * Under cheapest routing, a listed model only goes to these tested providers.
 */
export async function openRouterProviderAllowlist(model: string): Promise<string[] | null> {
  if (straitlyKeyOverride !== null || openRouterRoutingOverride !== null) return null;
  const now = Date.now();
  if (now - providerListCache.cachedAt >= CACHE_TTL_MS) {
    try {
      const { data, error } = await withDependencyTimeout(
        "OPENROUTER_PROVIDER_ALLOWLIST config read",
        db().from("admin_config").select("value").eq("key", "OPENROUTER_PROVIDER_ALLOWLIST").maybeSingle(),
      );
      if (error) throw new Error(error.message);
      const raw = data?.value;
      const next: Record<string, string[]> = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(v)) {
            const list = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
            if (list.length > 0) next[k.trim().toLowerCase()] = list;
          }
        }
      }
      providerListCache.value = next;
    } catch (error) {
      logger.error("provider-api-key: could not read admin_config.OPENROUTER_PROVIDER_ALLOWLIST; keeping last value", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    providerListCache.cachedAt = now;
  }
  return providerListCache.value[model.trim().toLowerCase()] ?? null;
}

/** Test hook: force the Straitly key (null restores normal lookup). */
export function setStraitlyApiKeyForTests(value: string | null): void {
  straitlyKeyOverride = value;
}

export function resetDirectProviderApiKeyCacheForTests(): void {
  cache.clear();
}
