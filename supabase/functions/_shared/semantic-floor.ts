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

/**
 * Picture matches are kept only within this distance of the query's best
 * picture match. SigLIP2 text→image cosine is low and flat (~0.14-0.23), so
 * an absolute floor cannot fit every query. Measured on production
 * (2026-10-29, "spiderman coir"): real coir mats score 0.173-0.201, the
 * first off-topic Spider-Man product (tin sign) follows at 0.151. A 0.045
 * margin left only 0.005 between the floor and that junk cliff, so normal
 * anchor drift let junk in and out between refreshes; 0.035 keeps every
 * measured mat (lowest 0.173 = anchor 0.201 - 0.028) while pushing the
 * junk gap to 0.015. Keyword matches are unaffected by this floor.
 */
export const RELATIVE_SEMANTIC_MARGIN = 0.035;

/**
 * Combine the admin floor with the per-query relative floor. Keyword matches
 * are unaffected: the RPC applies p_min_semantic_score to the picture leg only.
 */
export function effectiveSemanticFloor(adminFloor: number | null, bestSemanticScore: number | null): number | null {
  const relative = bestSemanticScore !== null && Number.isFinite(bestSemanticScore) && bestSemanticScore > 0
    ? Math.max(0, bestSemanticScore - RELATIVE_SEMANTIC_MARGIN)
    : null;
  if (adminFloor === null) return relative;
  if (relative === null) return adminFloor;
  return Math.max(adminFloor, relative);
}
