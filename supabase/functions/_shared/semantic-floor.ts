import { unwrapConfigValue } from "./config-utils.ts";

/** admin_config key for the DAM search semantic floor (popdam3 #97; RPC contract shared-db #3457). */
export const SEARCH_MIN_SEMANTIC_SCORE_KEY = "SEARCH_MIN_SEMANTIC_SCORE";

/**
 * Normalise the stored floor into the value passed as
 * `search_dam_documents(p_min_semantic_score)`. Anything missing, blank,
 * non-numeric, or outside 0..1 yields null, which keeps today's behaviour.
 */
export function parseSemanticFloor(raw: unknown): number | null {
  const value = unwrapConfigValue(raw);
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}
