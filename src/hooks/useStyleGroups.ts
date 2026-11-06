import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { buildProductCategoryOrFilter } from "@/lib/product-category-filters";
import { searchAccessStatus, buildDamSearchFilters, expandFallbackTerms, fetchHybridSearchPage, fetchSearchIds, getSearchMode, parseDamSearchFacets, sortByRank } from "@/lib/dam-search";
import { sortByConceptThenRank } from "@/lib/search-concept-rank";

type WorkflowStatus = Database["public"]["Enums"]["workflow_status"];
import type { AssetFilters, FacetCounts } from "@/types/assets";

export interface StyleGroup {
  id: string;
  sku: string;
  folder_path: string;
  primary_asset_id: string | null;
  asset_count: number;
  workflow_status: string;
  is_licensed: boolean;
  licensor_id: string | null;
  licensor_code: string | null;
  licensor_name: string | null;
  property_id: string | null;
  property_code: string | null;
  property_name: string | null;
  product_category: string | null;
  division_code: string | null;
  division_name: string | null;
  mg01_code: string | null;
  mg01_name: string | null;
  mg02_code: string | null;
  mg02_name: string | null;
  mg03_code: string | null;
  mg03_name: string | null;
  size_code: string | null;
  size_name: string | null;
  thumbnail_url: string | null;
  latest_file_date: string | null;
  designer_name: string | null;
  technical_designer_name: string | null;
  freelancer_name: string | null;
  designer_conflict: boolean;
  created_at: string;
  updated_at: string;
  cover_description: string | null;
  item_short_description?: string | null;
  item_description?: string | null;
  rich_metadata?: Record<string, unknown> | null;
  stage: string | null;
  customer: string | null;
  program: string | null;
}

const PAGE_SIZE = 200;
const FULL_TEXT_SEARCH_LIMIT = 500;
const SEARCH_ID_CACHE_TTL_MS = 30_000;
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

type SearchIdCacheEntry = {
  expiresAt: number;
  promise: Promise<string[] | null | undefined>;
};

const styleGroupSearchIdCache = new Map<string, SearchIdCacheEntry>();

/** A resolved ranked-filtered ID list, kept briefly so a page change only re-reads its own rows. */
type RankedListCacheEntry = {
  expiresAt: number;
  promise: Promise<string[]>;
};

const RANKED_LIST_CACHE_TTL_MS = SEARCH_ID_CACHE_TTL_MS;
const styleGroupRankedListCache = new Map<string, RankedListCacheEntry>();

/** Test/refresh hook: drop every cached ranked-filtered list. */
export function clearStyleGroupRankedListCache(): void {
  styleGroupRankedListCache.clear();
}

function setRankedListCacheEntry(
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

const STYLE_GROUP_SEARCH_COLUMNS = [
  "sku",
  "cover_description",
  "folder_path",
  "licensor_name",
  "property_name",
  "product_category",
  "customer",
  "program",
] as const;

/**
 * Build the ILIKE fallback OR filter across every searchable column for every
 * expanded term. `terms` should come from `expandFallbackTerms` so a query like
 * "spiderman" also matches stored "SPIDER MAN" / "Spider-Man".
 */
export function buildStyleGroupSearchFilter(terms: string[] | string) {
  const list = Array.isArray(terms)
    ? terms
    : (terms.replace(/[(),]/g, " ").trim() ? [terms.replace(/[(),]/g, " ").trim()] : []);
  if (list.length === 0) return null;
  const clauses: string[] = [];
  for (const term of list) {
    const safe = term.replace(/[(),]/g, " ").trim();
    if (!safe) continue;
    for (const col of STYLE_GROUP_SEARCH_COLUMNS) clauses.push(`${col}.ilike.%${safe}%`);
  }
  return clauses.length > 0 ? clauses.join(",") : null;
}

/** Precompute the synonym-aware ILIKE fallback filter (only used on RPC failure). */
async function buildStyleGroupFallbackFilter(search: string) {
  return buildStyleGroupSearchFilter(await expandFallbackTerms(search));
}

/**
 * Resolve a search term to indexed IDs, plus a synonym-aware ILIKE fallback
 * filter that is only populated (and thus only used) when the full-text RPC
 * failed. `ids === undefined` means the RPC errored → the fallback applies.
 */
async function resolveStyleGroupSearch(
  search?: string,
): Promise<{ ids: string[] | null | undefined; fallback: string | null }> {
  if (!search) return { ids: null, fallback: null };
  const ids = await fetchStyleGroupFullTextIds(search);
  const fallback = ids === undefined ? await buildStyleGroupFallbackFilter(search) : null;
  return { ids, fallback };
}

function shouldFallbackFromFullTextRpc(error: unknown) {
  if (searchAccessStatus(error)) return false;
  const err = error as { code?: string; message?: string; details?: string };
  const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  return (
    err.code === "PGRST202" ||
    err.code === "57014" ||
    text.includes("search_style_groups_full_text") ||
    text.includes("statement timeout") ||
    text.includes("canceling statement due to statement timeout")
  );
}

async function fetchStyleGroupFullTextIds(search: string) {
  const term = search.replace(/[(),]/g, " ").trim();
  if (!term) return null;
  const searchMode = await getSearchMode();
  const cacheKey = `${searchMode}\u0000${term}\u0000${FULL_TEXT_SEARCH_LIMIT}`;
  const cached = styleGroupSearchIdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    return fetchSearchIds(searchMode, term, "style_group", FULL_TEXT_SEARCH_LIMIT, async () => {
      // Retry once on a transient failure (e.g. statement timeout under load)
      // before degrading to the ILIKE fallback, which cannot match synonyms.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await (supabase.rpc as any)("search_style_groups_full_text", {
          p_query: term,
          p_limit: FULL_TEXT_SEARCH_LIMIT,
        });
        if (!error) {
          return ((data ?? []) as { style_group_id: string }[]).map((row) => row.style_group_id);
        }
        if (!shouldFallbackFromFullTextRpc(error)) throw error;
        if (attempt === 0) continue;
        return undefined; // both attempts hit a fallback-worthy error
      }
      return undefined;
    });
  })();

  styleGroupSearchIdCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_ID_CACHE_TTL_MS,
    promise,
  });

  try {
    const result = await promise;
    // Don't cache a failed lookup: a transient timeout must not pin the UI to
    // the degraded ILIKE fallback for the full cache TTL.
    if (result === undefined) styleGroupSearchIdCache.delete(cacheKey);
    return result;
  } catch (error) {
    styleGroupSearchIdCache.delete(cacheKey);
    throw error;
  }
}

function applyStyleGroupFilters(
  query: any,
  filters: AssetFilters,
  fullTextGroupIds?: string[] | null,
  fallbackFilter?: string | null,
) {
  if (filters.search) {
    if (fullTextGroupIds) {
      query = query.in("id", fullTextGroupIds.length > 0 ? fullTextGroupIds : [NO_MATCH_UUID]);
    } else {
      const searchFilter = fallbackFilter ?? buildStyleGroupSearchFilter(filters.search);
      if (searchFilter) query = query.or(searchFilter);
    }
  }
  if (filters.stage.length > 0) {
    query = query.in("stage", filters.stage);
  }
  if (filters.customer) {
    // Canonical core.customer id (api.dam_customer_list) against the FK, not free text.
    query = query.eq("customer_id", filters.customer);
  }
  if (filters.program) {
    query = query.eq("program", filters.program);
  }
  if (filters.isLicensed !== null) {
    query = query.eq("is_licensed", filters.isLicensed);
  }
  if (filters.workflowStatus.length > 0) {
    query = query.in("workflow_status", filters.workflowStatus as WorkflowStatus[]);
  }
  if (filters.licensorId) {
    query = query.eq("licensor_id", filters.licensorId);
  }
  if (filters.propertyId) {
    query = query.eq("property_id", filters.propertyId);
  }
  if (filters.fileStatus.length > 0) {
    const orParts: string[] = [];
    for (const fs of filters.fileStatus) {
      if (fs === "has_preview") orParts.push("primary_thumbnail_url.not.is.null");
      else if (fs === "no_preview_renderable") orParts.push("and(primary_thumbnail_url.is.null,primary_thumbnail_error.is.null)");
      else if (fs === "no_pdf_compat") orParts.push("and(primary_thumbnail_url.is.null,primary_thumbnail_error.eq.no_pdf_compat)");
      else if (fs === "no_preview_unsupported") orParts.push("and(primary_thumbnail_url.is.null,primary_thumbnail_error.not.is.null,primary_thumbnail_error.neq.no_pdf_compat)");
    }
    if (orParts.length > 0) query = query.or(orParts.join(","));
  }
  if (filters.assetType.length > 0) {
    query = query.in("primary_asset_type", filters.assetType);
  }
  if (filters.productCategory.length > 0) {
    const categoryFilter = buildProductCategoryOrFilter(filters.productCategory, "folder_path");
    if (categoryFilter) query = query.or(categoryFilter);
  }
  return query;
}

/**
 * Relevance ordering has no database ORDER BY: the full-text rank IS the result
 * order. Resolve the ranked IDs that also survive every active filter and the
 * visibility window (one narrow id-only read), rank them, and cache the list.
 * A page change then fetches full rows for exactly its own slice instead of
 * every matching group; the list length doubles as the exact total because it
 * comes from the identical predicate the old exact count used.
 */
async function fetchRankedFilteredStyleGroupIds(options: {
  filters: AssetFilters;
  minDate: string;
  searchMode: string;
  searchTerm: string;
  fullTextGroupIds: string[];
  fallbackSearchFilter: string | null;
}): Promise<string[]> {
  const { filters, minDate, searchMode, searchTerm, fullTextGroupIds, fallbackSearchFilter } = options;
  const cacheKey = `${searchMode}\u0000${searchTerm}\u0000${minDate}\u0000${JSON.stringify(filters)}`;
  const cached = styleGroupRankedListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    let query: any = supabase.from("style_groups").select("id");
    // Visibility date filter — use latest_file_date (max modified_at of member files)
    query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);
    query = applyStyleGroupFilters(query, filters, fullTextGroupIds, fallbackSearchFilter);
    const { data, error } = await query;
    if (error) throw error;
    return sortByRank((data ?? []) as { id: string }[], fullTextGroupIds, (row) => row.id).map((row) => row.id);
  })();

  setRankedListCacheEntry(styleGroupRankedListCache, cacheKey, promise);

  try {
    return await promise;
  } catch (error) {
    // A failed (or aborted) lookup must not pin the UI to a stale list.
    styleGroupRankedListCache.delete(cacheKey);
    throw error;
  }
}

export function useStyleGroups(
  filters: AssetFilters,
  sortField: string,
  sortDirection: "asc" | "desc",
  page: number,
  customPageSize?: number,
  visibilityDate?: string,
  enabled = true,
) {
  const effectivePageSize = customPageSize ?? PAGE_SIZE;

  return useQuery({
    enabled,
    retry: filters.search ? false : undefined,
    queryKey: ["style-groups", filters, sortField, sortDirection, page, effectivePageSize, visibilityDate],
    queryFn: async () => {
      const from = page * effectivePageSize;
      const to = from + effectivePageSize - 1;
      const searchTerm = filters.search?.replace(/[(),]/g, " ").trim();
      const searchMode = searchTerm ? await getSearchMode() : "keyword";
      if (searchTerm && searchMode === "hybrid") {
        const ranked = await fetchHybridSearchPage({
          query: searchTerm,
          documentType: "style_group",
          limit: effectivePageSize,
          offset: from,
          filters: buildDamSearchFilters(filters),
        });
        const { data, error } = await supabase
          .from("style_groups")
          .select(`*, primary_asset:assets!style_groups_primary_asset_id_fkey(thumbnail_url, thumbnail_error)`)
          .in("id", ranked.ids.length ? ranked.ids : [NO_MATCH_UUID]);
        if (error) throw error;
        const groups = sortByConceptThenRank(
          sortByRank((data ?? []).map((row: any) => ({
            ...row,
            asset_count: row.asset_count ?? 0,
            workflow_status: row.workflow_status ?? "other",
            thumbnail_url: row.primary_asset?.thumbnail_url ?? row.primary_thumbnail_url ?? null,
          })) as StyleGroup[], ranked.ids, (group) => group.id),
          searchTerm,
          (group) => [group.sku, group.item_description, group.cover_description, group.item_short_description].filter(Boolean).join(" "),
        );
        return { groups, totalCount: ranked.totalCount, searchFacets: parseDamSearchFacets(ranked.facets), pageSize: effectivePageSize, page };
      }
      const { ids: fullTextGroupIds, fallback: fallbackSearchFilter } = await resolveStyleGroupSearch(filters.search);
      const minDate = visibilityDate ?? "2020-01-01";

      // Relevance path: the ranked, fully-filtered ID list is the pagination
      // backbone (cached), so a page change fetches full rows for exactly its
      // own slice. Ordering and page contents match the previous fetch-all-
      // and-slice behavior because both come from the same ranked list.
      if (filters.search?.trim() && fullTextGroupIds) {
        const rankedIds = await fetchRankedFilteredStyleGroupIds({
          filters,
          minDate,
          searchMode,
          searchTerm,
          fullTextGroupIds,
          fallbackSearchFilter,
        });
        const pageIds = rankedIds.slice(from, to + 1);
        let groups: StyleGroup[] = [];
        if (pageIds.length > 0) {
          let pageQuery: any = supabase
            .from("style_groups")
            .select(`*, primary_asset:assets!style_groups_primary_asset_id_fkey(thumbnail_url, thumbnail_error)`);
          pageQuery = pageQuery.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);
          // pageIds already survived every active filter; the narrow IN keeps
          // the full-row read bounded to this page.
          pageQuery = applyStyleGroupFilters(pageQuery, filters, pageIds, null);
          const { data, error } = await pageQuery;
          if (error) throw error;
          groups = sortByRank(
            (data ?? []).map((row: any) => ({
              ...row,
              asset_count: row.asset_count ?? 0,
              workflow_status: row.workflow_status ?? "other",
              // Prefer live thumbnail from the joined primary asset over the cached column —
              // eliminates stale-cache display bugs when the two drift out of sync.
              thumbnail_url: (row.primary_asset as any)?.thumbnail_url ?? row.primary_thumbnail_url ?? null,
            })) as StyleGroup[],
            pageIds,
            (group) => group.id,
          );
        }
        return {
          groups,
          totalCount: rankedIds.length,
          searchFacets: undefined as FacetCounts | undefined,
          pageSize: effectivePageSize,
          page,
        };
      }

      let query = supabase
        .from("style_groups")
        .select(
          `*, primary_asset:assets!style_groups_primary_asset_id_fkey(thumbnail_url, thumbnail_error)`,
          { count: "exact" },
        );

      // Visibility date filter — use latest_file_date (max modified_at of member files)
      query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);

      // Filters
      query = applyStyleGroupFilters(query, filters, fullTextGroupIds, fallbackSearchFilter);

      // Sort — map the library sort fields onto real style_groups columns.
      const sgSortField =
        sortField === "file_created_at" ? "created_at"
        : sortField === "sku" || sortField === "filename" ? "sku"
        : sortField === "asset_count" || sortField === "file_size" ? "asset_count"
        : "latest_file_date"; // modified_at + fallback
      query = query.order(sgSortField, { ascending: sortDirection === "asc" });
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      const groups: StyleGroup[] = (data ?? []).map((row: any) => {
        return {
          ...row,
          asset_count: row.asset_count ?? 0,
          workflow_status: row.workflow_status ?? "other",
          // Prefer live thumbnail from the joined primary asset over the cached column —
          // eliminates stale-cache display bugs when the two drift out of sync.
          thumbnail_url: (row.primary_asset as any)?.thumbnail_url ?? row.primary_thumbnail_url ?? null,
        };
      });

      return {
        groups,
        totalCount: count ?? 0,
        searchFacets: undefined as FacetCounts | undefined,
        pageSize: effectivePageSize,
        page,
      };
    },
  });
}

export function useStyleGroupCount(filters: AssetFilters, visibilityDate?: string, enabled = true) {
  return useQuery({
    retry: filters.search ? false : undefined,
    queryKey: ["style-group-count", filters, visibilityDate],
    enabled,
    queryFn: async () => {
      const searchTerm = filters.search?.replace(/[(),]/g, " ").trim();
      if (searchTerm && await getSearchMode() === "hybrid") {
        const ranked = await fetchHybridSearchPage({
          query: searchTerm,
          documentType: "style_group",
          limit: 1,
          filters: buildDamSearchFilters(filters),
        });
        return ranked.totalCount;
      }
      let query = supabase
        .from("style_groups")
        .select("*", { count: "exact", head: true });
      const { ids: fullTextGroupIds, fallback: fallbackSearchFilter } = await resolveStyleGroupSearch(filters.search);

      const minDate = visibilityDate ?? "2020-01-01";
      query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);

      query = applyStyleGroupFilters(query, filters, fullTextGroupIds, fallbackSearchFilter);

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useStyleGroupAssetCount(filters: AssetFilters, visibilityDate?: string, enabled = true) {
  return useQuery({
    retry: filters.search ? false : undefined,
    queryKey: ["style-group-asset-count", filters, visibilityDate],
    enabled,
    queryFn: async () => {
      const pageSize = 1000;
      const minDate = visibilityDate ?? "2020-01-01";
      let from = 0;
      let total = 0;
      const { ids: fullTextGroupIds, fallback: fallbackSearchFilter } = await resolveStyleGroupSearch(filters.search);

      while (true) {
        let query = supabase
          .from("style_groups")
          .select("asset_count")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);
        query = applyStyleGroupFilters(query, filters, fullTextGroupIds, fallbackSearchFilter);

        const { data, error } = await query;
        if (error) throw error;

        const rows = data ?? [];
        total += rows.reduce((sum, row) => sum + Number(row.asset_count ?? 0), 0);

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      return total;
    },
  });
}

export function useUngroupedCount() {
  return useQuery({
    queryKey: ["ungrouped-asset-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("assets")
        .select("*", { count: "exact", head: true })
        .is("style_group_id", null)
        .eq("is_deleted", false);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}

export function useTotalAssetCount() {
  return useQuery({
    queryKey: ["total-asset-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("assets")
        .select("*", { count: "exact", head: true })
        .eq("is_deleted", false);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });
}
