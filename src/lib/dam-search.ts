import { supabase } from "@/integrations/supabase/client";

export type SearchMode = "keyword" | "hybrid";
export type DamDocumentType = "asset" | "style_group";

let searchModePromise: Promise<SearchMode> | null = null;

export function parseSearchMode(value: unknown): SearchMode {
  return value === "hybrid" ? "hybrid" : "keyword";
}

export function getSearchMode(): Promise<SearchMode> {
  if (!searchModePromise) {
    searchModePromise = (async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "SEARCH_MODE")
        .maybeSingle();
      if (error) return "keyword";
      return parseSearchMode(data?.value);
    })();
  }
  return searchModePromise;
}

export async function fetchHybridSearchIds(
  query: string,
  documentType: DamDocumentType,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke("dam-search-ai", {
    body: {
      action: "search",
      query,
      limit,
      document_types: [documentType],
    },
  });
  if (error) throw error;
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((row: unknown): row is { document_type: string; entity_id: string } => {
      if (!row || typeof row !== "object") return false;
      const result = row as Record<string, unknown>;
      return result.document_type === documentType && typeof result.entity_id === "string";
    })
    .map((row) => row.entity_id);
}

export async function fetchSearchIds(
  mode: SearchMode,
  query: string,
  documentType: DamDocumentType,
  limit: number,
  fetchKeywordIds: () => Promise<string[] | undefined>,
): Promise<string[] | undefined> {
  if (mode === "hybrid") {
    try {
      return await fetchHybridSearchIds(query, documentType, limit);
    } catch {
      // A cold or unavailable edge function must degrade to keyword search.
    }
  }
  return fetchKeywordIds();
}

const expandTermsCache = new Map<string, Promise<string[]>>();

/**
 * Expand a raw search term into the set of phrases an ILIKE search should
 * match. Uses the SECURITY-DEFINER RPC `expand_dam_search_queries` for synonym
 * expansion (e.g. "spiderman" → "spider man") — the `dam_search_synonyms` table
 * itself is RLS-blocked for anon/authenticated, so it can't be read directly.
 * Adds hyphen/space separator variants on top so a one-word query also matches
 * stored values like "Spider-Man" / "SPIDER MAN". Without this, a raw substring
 * search returns 0 results for hyphenated/spaced brand names.
 */
export function expandFallbackTerms(rawTerm: string): Promise<string[]> {
  const term = rawTerm.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return Promise.resolve([]);
  const key = term.toLowerCase();
  let cached = expandTermsCache.get(key);
  if (!cached) {
    cached = (async () => {
      const variants = new Set<string>();
      const add = (value: string) => {
        const v = value.trim().toLowerCase();
        if (!v) return;
        variants.add(v);
        if (v.includes("-")) variants.add(v.replace(/-/g, " "));
        if (/\s/.test(v)) variants.add(v.replace(/\s+/g, "-"));
      };
      add(key);
      try {
        const { data, error } = await (supabase.rpc as any)("expand_dam_search_queries", {
          p_query: term,
        });
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ query_text?: string }>) {
          if (row?.query_text) add(row.query_text);
        }
      } catch {
        expandTermsCache.delete(key); // transient failure: allow a later retry
      }
      return [...variants];
    })();
    expandTermsCache.set(key, cached);
  }
  return cached;
}

export function sortByRank<T>(rows: T[], rankedIds: string[], getId: (row: T) => string): T[] {
  const rank = new Map(rankedIds.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(getId(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(getId(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}
