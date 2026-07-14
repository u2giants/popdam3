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

export function sortByRank<T>(rows: T[], rankedIds: string[], getId: (row: T) => string): T[] {
  const rank = new Map(rankedIds.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (rank.get(getId(a)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(getId(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}
