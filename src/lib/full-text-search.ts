import { supabase } from "@/integrations/supabase/client";
import { expandFallbackTerms, fetchSearchIds, getSearchMode, searchAccessStatus } from "@/lib/dam-search";

/**
 * Shared keyword full-text search plumbing for the asset and style-group list
 * hooks (#708). Both hooks previously carried byte-identical copies that
 * differed only in the RPC name, id field, and fallback columns; this factory
 * keeps those per-entity bits explicit while the caching, retry, and fallback
 * logic lives in exactly one place.
 */

export const FULL_TEXT_SEARCH_LIMIT = 500;
const SEARCH_ID_CACHE_TTL_MS = 30_000;
const RANKED_LIST_CACHE_TTL_MS = SEARCH_ID_CACHE_TTL_MS;

type SearchIdCacheEntry = {
  expiresAt: number;
  promise: Promise<string[] | null | undefined>;
};

/** A resolved ranked-filtered ID list, kept briefly so a page change only re-reads its own rows. */
export type RankedListCacheEntry = {
  expiresAt: number;
  promise: Promise<string[]>;
};

export function setRankedListCacheEntry(
  cache: Map<string, RankedListCacheEntry>,
  key: string,
  promise: Promise<string[]>,
): void {
  // Prune expired entries so distinct searches cannot grow the cache unbounded.
  const now = Date.now();
  for (const [existingKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(existingKey);
  }
  cache.set(key, { expiresAt: now + RANKED_LIST_CACHE_TTL_MS, promise });
}

export interface FullTextSearchSpec {
  /** Document type passed to the shared `fetchSearchIds` helper. */
  documentType: "asset" | "style_group";
  /** PostgREST RPC that performs the keyword full-text search. */
  rpcName: string;
  /** Row field of the RPC result holding the matched id. */
  idField: string;
  /** Columns covered by the ILIKE fallback filter. */
  fallbackColumns: readonly string[];
}

export function createFullTextSearchHelpers(spec: FullTextSearchSpec) {
  const { documentType, rpcName, idField, fallbackColumns } = spec;
  const searchIdCache = new Map<string, SearchIdCacheEntry>();

  /**
   * Build the ILIKE fallback OR filter across every searchable column for every
   * expanded term. `terms` should come from `expandFallbackTerms` so a query like
   * "spiderman" also matches stored "spider man" / "spider-man".
   */
  function buildSearchFilter(terms: string[] | string) {
    const list = Array.isArray(terms)
      ? terms
      : (terms.replace(/[(),]/g, " ").trim() ? [terms.replace(/[(),]/g, " ").trim()] : []);
    if (list.length === 0) return null;
    const clauses: string[] = [];
    for (const term of list) {
      const safe = term.replace(/[(),]/g, " ").trim();
      if (!safe) continue;
      for (const col of fallbackColumns) clauses.push(`${col}.ilike.%${safe}%`);
    }
    return clauses.length > 0 ? clauses.join(",") : null;
  }

  /** Precompute the synonym-aware ILIKE fallback filter (only used on RPC failure). */
  async function buildFallbackFilter(search: string) {
    return buildSearchFilter(await expandFallbackTerms(search));
  }

  function shouldFallbackFromRpc(error: unknown) {
    if (searchAccessStatus(error)) return false;
    const err = error as { code?: string; message?: string; details?: string };
    const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
    return (
      err.code === "PGRST202" ||
      err.code === "57014" ||
      text.includes(rpcName) ||
      text.includes("statement timeout") ||
      text.includes("canceling statement due to statement timeout")
    );
  }

  async function fetchFullTextIds(search: string) {
    const term = search.replace(/[(),]/g, " ").trim();
    if (!term) return null;
    const searchMode = await getSearchMode();
    const cacheKey = `${searchMode}\u0000${term}\u0000${FULL_TEXT_SEARCH_LIMIT}`;
    const cached = searchIdCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = (async () => {
      return fetchSearchIds(searchMode, term, documentType, FULL_TEXT_SEARCH_LIMIT, async () => {
        // Retry once on a transient failure (e.g. statement timeout under load)
        // before degrading to the ILIKE fallback, which cannot match synonyms.
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data, error } = await (supabase.rpc as any)(rpcName, {
            p_query: term,
            p_limit: FULL_TEXT_SEARCH_LIMIT,
          });
          if (!error) {
            return ((data ?? []) as Record<string, string>[]).map((row) => row[idField]);
          }
          if (!shouldFallbackFromRpc(error)) throw error;
          if (attempt === 0) continue;
          return undefined; // both attempts hit a fallback-worthy error
        }
        return undefined;
      });
    })();

    searchIdCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_ID_CACHE_TTL_MS,
      promise,
    });

    try {
      const result = await promise;
      // Don't cache a failed lookup: a transient timeout must not pin the UI to
      // the degraded ILIKE fallback for the full cache TTL.
      if (result === undefined) searchIdCache.delete(cacheKey);
      return result;
    } catch (error) {
      searchIdCache.delete(cacheKey);
      throw error;
    }
  }

  /**
   * Resolve a search term to indexed ids, plus a synonym-aware ILIKE fallback
   * filter used only when the full-text RPC failed. `ids === undefined`
   * means the RPC errored → the fallback applies.
   */
  async function resolveSearch(
    search?: string,
  ): Promise<{ ids: string[] | null | undefined; fallback: string | null }> {
    if (!search) return { ids: null, fallback: null };
    const ids = await fetchFullTextIds(search);
    const fallback = ids === undefined ? await buildFallbackFilter(search) : null;
    return { ids, fallback };
  }

  return { buildSearchFilter, buildFallbackFilter, shouldFallbackFromRpc, fetchFullTextIds, resolveSearch };
}
