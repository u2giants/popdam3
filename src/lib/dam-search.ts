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

let synonymsPromise: Promise<Array<{ term: string; expansion: string }>> | null = null;

/** Load the active synonym vocabulary (cached). Same source the RPC uses. */
function getSearchSynonyms(): Promise<Array<{ term: string; expansion: string }>> {
  if (!synonymsPromise) {
    synonymsPromise = (async () => {
      const { data, error } = await supabase
        .from("dam_search_synonyms")
        .select("search_term, expansion")
        .eq("is_active", true);
      if (error || !data) {
        synonymsPromise = null; // allow retry on next call
        return [];
      }
      return data.map((row) => ({
        term: String((row as { search_term: string }).search_term).toLowerCase(),
        expansion: String((row as { expansion: string }).expansion).toLowerCase(),
      }));
    })();
  }
  return synonymsPromise;
}

/**
 * Expand a raw search term into the set of phrases the ILIKE fallback should
 * match. Mirrors the RPC's synonym expansion (e.g. "spiderman" → "spider man")
 * and adds hyphen/space separator variants so a one-word query still matches
 * stored values like "SPIDER MAN" or "Spider-Man". Without this, the timeout
 * fallback silently returns 0 results for hyphenated/spaced brand names.
 */
export async function expandFallbackTerms(rawTerm: string): Promise<string[]> {
  const term = rawTerm.replace(/[(),]/g, " ").trim();
  if (!term) return [];
  const lower = term.toLowerCase();
  const variants = new Set<string>();
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    variants.add(v);
    if (v.includes("-")) variants.add(v.replace(/-/g, " "));
    if (/\s/.test(v)) variants.add(v.replace(/\s+/g, "-"));
  };
  add(lower);
  for (const { term: st, expansion } of await getSearchSynonyms()) {
    if (lower === st || lower.includes(st)) add(expansion);
    if (lower === expansion || lower.includes(expansion)) add(st);
  }
  return [...variants];
}

export function sortByRank<T>(rows: T[], rankedIds: string[], getId: (row: T) => string): T[] {
  const rank = new Map(rankedIds.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(getId(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(getId(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}
