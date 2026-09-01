import { supabase } from "@/integrations/supabase/client";
import type { AssetFilters, FacetCounts } from "@/types/assets";

export type SearchMode = "keyword" | "hybrid";
export type DamDocumentType = "asset" | "style_group";

export interface DamSearchRequest {
  query: string;
  documentType: DamDocumentType;
  limit: number;
  offset?: number;
  filters?: Record<string, unknown>;
  minRank?: number;
}

export interface DamSearchPage {
  ids: string[];
  totalCount: number;
  hasMore: boolean;
  facets: Record<string, unknown>;
}

export function buildDamSearchFilters(filters: AssetFilters): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (filters.fileType.length) payload.fileType = filters.fileType;
  if (filters.contentType.length) payload.contentType = filters.contentType;
  if (filters.productMaterial.length) payload.productMaterial = filters.productMaterial;
  if (filters.status.length) payload.status = filters.status;
  if (filters.workflowStatus.length) payload.workflowStatus = filters.workflowStatus;
  if (filters.isLicensed !== null) payload.isLicensed = filters.isLicensed;
  if (filters.licensorId) payload.licensorId = filters.licensorId;
  if (filters.propertyId) payload.propertyId = filters.propertyId;
  if (filters.assetType.length) payload.assetType = filters.assetType;
  if (filters.artSource.length) payload.artSource = filters.artSource;
  if (filters.tagFilter) payload.tagFilter = filters.tagFilter;
  if (filters.fileStatus.length) payload.fileStatus = filters.fileStatus;
  if (filters.productCategory.length) payload.productCategory = filters.productCategory;
  if (filters.stage.length) payload.stage = filters.stage;
  if (filters.customer) payload.customerId = filters.customer;
  if (filters.program) payload.program = filters.program;
  return payload;
}

export function parseDamSearchFacets(value: Record<string, unknown>): FacetCounts {
  const record = (key: string) => value[key] && typeof value[key] === "object"
    ? value[key] as Record<string, number>
    : {};
  const licensed = record("isLicensed");
  return {
    fileType: record("fileType"),
    status: record("status"),
    workflowStatus: record("workflowStatus"),
    stage: record("stage"),
    isLicensed: { true: Number(licensed.true) || 0, false: Number(licensed.false) || 0 },
  };
}

let searchModePromise: Promise<SearchMode> | null = null;
let searchModeExpiresAt = 0;
const SEARCH_MODE_TTL_MS = 30_000;

export function parseSearchMode(value: unknown): SearchMode {
  return value === "hybrid" ? "hybrid" : "keyword";
}

export function getSearchMode(): Promise<SearchMode> {
  if (!searchModePromise || Date.now() >= searchModeExpiresAt) {
    searchModeExpiresAt = Date.now() + SEARCH_MODE_TTL_MS;
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

export function invalidateSearchMode(): void {
  searchModePromise = null;
  searchModeExpiresAt = 0;
}

export async function fetchHybridSearchPage({
  query,
  documentType,
  limit,
  offset = 0,
  filters = {},
  minRank = 0,
}: DamSearchRequest): Promise<DamSearchPage> {
  const { data, error } = await supabase.functions.invoke("dam-search-ai", {
    body: {
      action: "search",
      query,
      limit,
      offset,
      filters,
      min_rank: minRank,
      document_types: [documentType],
    },
  });
  if (error) throw error;
  const results = Array.isArray(data?.results) ? data.results : [];
  const ids = results
    .filter((row: unknown): row is { document_type: string; entity_id: string } => {
      if (!row || typeof row !== "object") return false;
      const result = row as Record<string, unknown>;
      return result.document_type === documentType && typeof result.entity_id === "string";
    })
    .map((row) => row.entity_id);
  return {
    ids,
    totalCount: typeof data?.total_count === "number" ? data.total_count : ids.length,
    hasMore: data?.has_more === true,
    facets: data?.facets && typeof data.facets === "object" && !Array.isArray(data.facets)
      ? data.facets as Record<string, unknown>
      : {},
  };
}

export async function fetchHybridSearchIds(
  query: string,
  documentType: DamDocumentType,
  limit: number,
): Promise<string[]> {
  const page = await fetchHybridSearchPage({ query, documentType, limit });
  return page.ids;
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
