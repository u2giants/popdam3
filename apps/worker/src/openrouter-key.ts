/**
 * Single source of truth for the OpenRouter API key.
 *
 * The key is edited in the PopDAM admin UI (Settings → APIs), which writes it to
 * `admin_config.OPENROUTER_API_KEY`. The Supabase edge functions already read it
 * from there. The worker used to read a SECOND copy from the Railway env var
 * OPENROUTER_API_KEY, so rotating the key in the UI left the worker on the old
 * one and every model call failed with `OpenRouter 401: User not found.` while
 * the model list (edge function) kept working.
 *
 * Now admin_config wins and the env var is a fallback only, so there is nothing
 * to keep in sync. Cached briefly so a batch of calls does not hit the DB per
 * asset; a rotation takes effect within CACHE_TTL_MS with no redeploy.
 */
import { config } from "./config.js";
import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

const CACHE_TTL_MS = 60_000;

let cachedKey: string | null = null;
let cachedAt = 0;
let warnedEnvFallback = false;
let warnedDbUnreadable = false;

/** Values are stored as a JSON string, but tolerate a `{ value: "..." }` wrapper. */
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
    "OpenRouter key config read",
    db().from("admin_config").select("value").eq("key", "OPENROUTER_API_KEY").maybeSingle(),
  );
  if (error) throw new Error(error.message);
  return unwrap(data?.value);
}

/** Exported for tests: the resolution rules, with the DB read injected. */
export async function resolveOpenRouterApiKey(
  loadFromDb: () => Promise<string> = readKeyFromAdminConfig,
  envKey: string = config.openRouterApiKey,
): Promise<string> {
  const now = Date.now();
  if (cachedKey !== null && now - cachedAt < CACHE_TTL_MS) return cachedKey;

  let dbKey = "";
  try {
    dbKey = await loadFromDb();
    warnedDbUnreadable = false;
  } catch (err) {
    // Never fail silently: a DB read problem here degrades us to a possibly
    // stale env key, and that must be visible in the logs.
    if (!warnedDbUnreadable) {
      warnedDbUnreadable = true;
      logger.error("openrouter-key: could not read admin_config.OPENROUTER_API_KEY; falling back to env", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const key = dbKey || envKey;
  if (!dbKey && key && !warnedEnvFallback) {
    warnedEnvFallback = true;
    logger.warn(
      "openrouter-key: admin_config.OPENROUTER_API_KEY is empty; using the OPENROUTER_API_KEY env var. " +
        "Set the key in PopDAM Settings → APIs so rotations apply everywhere.",
    );
  }
  if (dbKey) warnedEnvFallback = false;

  cachedKey = key;
  cachedAt = now;
  return key;
}

export function getOpenRouterApiKey(): Promise<string> {
  return resolveOpenRouterApiKey();
}

/** Test/rotation hook — drops the cache so the next call re-reads admin_config. */
export function resetOpenRouterKeyCache(): void {
  cachedKey = null;
  cachedAt = 0;
  warnedEnvFallback = false;
  warnedDbUnreadable = false;
}
