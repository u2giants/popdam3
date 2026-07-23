import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Asset, AssetFilters, SortField, SortDirection, FacetCounts } from "@/types/assets";
import { useAdminApi } from "@/hooks/useAdminApi";
import { buildProductCategoryOrFilter } from "@/lib/product-category-filters";
import { expandFallbackTerms, fetchSearchIds, getSearchMode, sortByRank } from "@/lib/dam-search";

const PAGE_SIZE = 200;
const FULL_TEXT_SEARCH_LIMIT = 500;
const SEARCH_ID_CACHE_TTL_MS = 30_000;
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

type SearchIdCacheEntry = {
  expiresAt: number;
  promise: Promise<string[] | null | undefined>;
};

const assetSearchIdCache = new Map<string, SearchIdCacheEntry>();

/** Fetch THUMBNAIL_MIN_DATE from admin_config (cached) */
export function useVisibilityDate() {
  return useQuery({
    queryKey: ["visibility-date"],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "THUMBNAIL_MIN_DATE")
        .maybeSingle();
      if (data?.value) {
        const raw = typeof data.value === "string" ? data.value : String(data.value);
        return raw;
      }
      return "2020-01-01";
    },
    staleTime: 5 * 60 * 1000,
  });
}

const ASSET_SEARCH_COLUMNS = [
  "filename",
  "cover_description",
  "ai_description",
  "scene_description",
  "program",
  "customer",
] as const;

/**
 * Build the ILIKE fallback OR filter across every searchable column for every
 * expanded term. `terms` should come from `expandFallbackTerms` so a query like
 * "spiderman" also matches stored "spider man" / "spider-man".
 */
export function buildAssetSearchFilter(terms: string[] | string) {
  const list = Array.isArray(terms)
    ? terms
    : (terms.replace(/[(),]/g, " ").trim() ? [terms.replace(/[(),]/g, " ").trim()] : []);
  if (list.length === 0) return null;
  const clauses: string[] = [];
  for (const term of list) {
    const safe = term.replace(/[(),]/g, " ").trim();
    if (!safe) continue;
    for (const col of ASSET_SEARCH_COLUMNS) clauses.push(`${col}.ilike.%${safe}%`);
  }
  return clauses.length > 0 ? clauses.join(",") : null;
}

/** Precompute the synonym-aware ILIKE fallback filter (only used on RPC failure). */
async function buildAssetFallbackFilter(search: string) {
  return buildAssetSearchFilter(await expandFallbackTerms(search));
}

/**
 * Resolve a search term to indexed asset IDs, plus a synonym-aware ILIKE
 * fallback filter used only when the full-text RPC failed. `ids === undefined`
 * means the RPC errored → the fallback applies.
 */
async function resolveAssetSearch(
  search?: string,
): Promise<{ ids: string[] | null | undefined; fallback: string | null }> {
  if (!search) return { ids: null, fallback: null };
  const ids = await fetchAssetFullTextIds(search);
  const fallback = ids === undefined ? await buildAssetFallbackFilter(search) : null;
  return { ids, fallback };
}

function shouldFallbackFromFullTextRpc(error: unknown) {
  const err = error as { code?: string; message?: string; details?: string };
  const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  return (
    err.code === "PGRST202" ||
    err.code === "57014" ||
    text.includes("search_assets_full_text") ||
    text.includes("statement timeout") ||
    text.includes("canceling statement due to statement timeout")
  );
}

async function fetchAssetFullTextIds(search: string) {
  const term = search.replace(/[(),]/g, " ").trim();
  if (!term) return null;
  const searchMode = await getSearchMode();
  const cacheKey = `${searchMode}\u0000${term}\u0000${FULL_TEXT_SEARCH_LIMIT}`;
  const cached = assetSearchIdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    return fetchSearchIds(searchMode, term, "asset", FULL_TEXT_SEARCH_LIMIT, async () => {
      // Retry once on a transient failure (e.g. statement timeout under load)
      // before degrading to the ILIKE fallback, which cannot match synonyms.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await (supabase.rpc as any)("search_assets_full_text", {
          p_query: term,
          p_limit: FULL_TEXT_SEARCH_LIMIT,
        });
        if (!error) {
          return ((data ?? []) as { asset_id: string }[]).map((row) => row.asset_id);
        }
        if (!shouldFallbackFromFullTextRpc(error)) throw error;
        if (attempt === 0) continue;
        return undefined; // both attempts hit a fallback-worthy error
      }
      return undefined;
    });
  })();

  assetSearchIdCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_ID_CACHE_TTL_MS,
    promise,
  });

  try {
    const result = await promise;
    // Don't cache a failed lookup: a transient timeout must not pin the UI to
    // the degraded ILIKE fallback for the full cache TTL.
    if (result === undefined) assetSearchIdCache.delete(cacheKey);
    return result;
  } catch (error) {
    assetSearchIdCache.delete(cacheKey);
    throw error;
  }
}

function applyFilters(
  query: any,
  filters: AssetFilters,
  fullTextAssetIds?: string[] | null,
  fallbackFilter?: string | null,
) {
  query = query.eq("is_deleted", false);

  if (filters.search) {
    if (fullTextAssetIds) {
      query = query.in("id", fullTextAssetIds.length > 0 ? fullTextAssetIds : [NO_MATCH_UUID]);
    } else {
      const searchFilter = fallbackFilter ?? buildAssetSearchFilter(filters.search);
      if (searchFilter) query = query.or(searchFilter);
    }
  }
  if (filters.stage.length > 0) {
    query = query.in("stage", filters.stage);
  }
  if (filters.customer) {
    // filters.customer holds a canonical core.customer id (from api.dam_customer_list),
    // matched against the durable customer_id FK — no longer the legacy free text.
    query = query.eq("customer_id", filters.customer);
  }
  if (filters.program) {
    query = query.eq("program", filters.program);
  }
  if (filters.fileType.length > 0) {
    query = query.in("file_type", filters.fileType);
  }
  if (filters.contentType.length > 0) {
    query = query.in("content_type", filters.contentType);
  }
  if (filters.productMaterial.length > 0) {
    query = query.overlaps("product_material", filters.productMaterial);
  }
  if (filters.status.length > 0) {
    query = query.in("status", filters.status);
  }
  if (filters.workflowStatus.length > 0) {
    query = query.in("workflow_status", filters.workflowStatus);
  }
  if (filters.isLicensed !== null) {
    query = query.eq("is_licensed", filters.isLicensed);
  }
  if (filters.licensorId) {
    query = query.eq("licensor_id", filters.licensorId);
  }
  if (filters.propertyId) {
    query = query.eq("property_id", filters.propertyId);
  }
  if (filters.assetType.length > 0) {
    query = query.in("asset_type", filters.assetType);
  }
  if (filters.artSource.length > 0) {
    query = query.in("art_source", filters.artSource);
  }
  if (filters.productCategory.length > 0) {
    const categoryFilter = buildProductCategoryOrFilter(filters.productCategory, "relative_path");
    if (categoryFilter) query = query.or(categoryFilter);
  }
  if (filters.tagFilter) {
    query = query.contains("tags", [filters.tagFilter]);
  }

  // File Status filter (supports multi-select via OR)
  if (filters.fileStatus.length > 0) {
    const orClauses: string[] = [];
    for (const fs of filters.fileStatus) {
      if (fs === "has_preview") {
        orClauses.push("thumbnail_url.not.is.null");
      } else if (fs === "no_preview_renderable") {
        orClauses.push("and(thumbnail_url.is.null,thumbnail_error.is.null)");
      } else if (fs === "no_pdf_compat") {
        orClauses.push("and(thumbnail_url.is.null,thumbnail_error.eq.no_pdf_compat)");
      } else if (fs === "no_preview_unsupported") {
        orClauses.push("and(thumbnail_url.is.null,thumbnail_error.eq.no_preview_or_render_failed)");
      }
    }
    if (orClauses.length > 0) {
      query = query.or(orClauses.join(","));
    }
  }

  return query;
}

/**
 * Apply visibility logic: assets visible if modified_at >= minDate OR file_created_at >= minDate OR thumbnail_url IS NOT NULL
 * Since Supabase JS doesn't support OR across columns easily, we use an RPC-style .or() filter.
 */
function applyVisibility(query: any, minDate: string) {
  return query.or(
    `modified_at.gte.${minDate},file_created_at.gte.${minDate},thumbnail_url.not.is.null`
  );
}

export function useAssets(
  filters: AssetFilters,
  sortField: SortField,
  sortDirection: SortDirection,
  page: number,
  visibilityDate?: string,
  customPageSize?: number,
  enabled = true,
) {
  const effectivePageSize = customPageSize ?? PAGE_SIZE;
  return useQuery({
    queryKey: ["assets", filters, sortField, sortDirection, page, visibilityDate, effectivePageSize],
    enabled,
    queryFn: async () => {
      const from = page * effectivePageSize;
      const to = from + effectivePageSize - 1;
      const minDate = visibilityDate ?? "2020-01-01";
      const { ids: fullTextAssetIds, fallback: fallbackSearchFilter } = await resolveAssetSearch(filters.search);

      let query = supabase
        .from("assets")
        .select("*", { count: "exact" });

      query = applyFilters(query, filters, fullTextAssetIds, fallbackSearchFilter);
      query = applyVisibility(query, minDate);
      const useRelevance = Boolean(filters.search?.trim() && fullTextAssetIds);
      if (!useRelevance) {
        const assetSortField =
          sortField === "relevance" ? "modified_at"
          : sortField === "sku" ? "filename"
          : sortField === "asset_count" ? "file_size"
          : sortField;
        query = query.order(assetSortField, { ascending: sortDirection === "asc" });
        query = query.range(from, to);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      const assets = useRelevance
        ? sortByRank((data ?? []) as Asset[], fullTextAssetIds!, (asset) => asset.id).slice(from, to + 1)
        : (data ?? []) as Asset[];
      return {
        assets,
        totalCount: count ?? 0,
        pageSize: effectivePageSize,
        page,
      };
    },
  });
}

export function useAssetCount(filters: AssetFilters, visibilityDate?: string) {
  return useQuery({
    queryKey: ["asset-count", filters, visibilityDate],
    queryFn: async () => {
      const minDate = visibilityDate ?? "2020-01-01";
      const { ids: fullTextAssetIds, fallback: fallbackSearchFilter } = await resolveAssetSearch(filters.search);

      let query = supabase
        .from("assets")
        .select("*", { count: "exact", head: true });

      query = applyFilters(query, filters, fullTextAssetIds, fallbackSearchFilter);
      query = applyVisibility(query, minDate);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useFilterCounts(filters: AssetFilters) {
  return useQuery({
    queryKey: ["filter-counts", filters],
    queryFn: async () => {
      const filterPayload: Record<string, unknown> = {};
      if (filters.search) filterPayload.search = filters.search;
      if (filters.fileType.length > 0) filterPayload.fileType = filters.fileType;
      if (filters.contentType.length > 0) filterPayload.contentType = filters.contentType;
      if (filters.productMaterial.length > 0) filterPayload.productMaterial = filters.productMaterial;
      if (filters.status.length > 0) filterPayload.status = filters.status;
      if (filters.workflowStatus.length > 0) filterPayload.workflowStatus = filters.workflowStatus;
      if (filters.isLicensed !== null) filterPayload.isLicensed = filters.isLicensed;
      if (filters.licensorId) filterPayload.licensorId = filters.licensorId;
      if (filters.propertyId) filterPayload.propertyId = filters.propertyId;
      if (filters.assetType.length > 0) filterPayload.assetType = filters.assetType;
      if (filters.artSource.length > 0) filterPayload.artSource = filters.artSource;
      if (filters.tagFilter) filterPayload.tagFilter = filters.tagFilter;
      if (filters.stage.length > 0) filterPayload.stage = filters.stage;
      if (filters.customer) filterPayload.customer = filters.customer;
      if (filters.program) filterPayload.program = filters.program;

      const { data, error } = await supabase.rpc("get_filter_counts", {
        p_filters: filterPayload as unknown as Json,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as FacetCounts;
    },
    staleTime: 10_000,
  });
}

export interface PathFacet {
  name: string;
  count: number;
}

/**
 * Program facets for the path-attribute filter combo, scoped to the selected
 * customer. The customer is now a canonical core.customer id (from
 * api.dam_customer_list), so scoping is by the style_groups.customer_id FK via
 * get_path_facets(p_customer_id). Customer options come from useDamCustomerFacets,
 * not from this RPC's legacy free-text customers list.
 */
/** Distinct product_material values (rich-PDF facet) for the library Material filter. */
export function useProductMaterials() {
  return useQuery({
    queryKey: ["dam-material-facets"],
    queryFn: async () => {
      // Cast: get_dam_material_facets is added by migration; generated types may lag.
      const { data, error } = await (supabase.rpc as any)("get_dam_material_facets");
      if (error) throw error;
      return ((data ?? []) as Array<{ material: string | null }>)
        .map((r) => r.material)
        .filter((m): m is string => !!m);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePathFacets(customerId?: string | null) {
  return useQuery({
    queryKey: ["path-facets", customerId ?? "all"],
    queryFn: async () => {
      // Cast: get_path_facets is added by migration; generated types may lag the frontend build.
      const { data, error } = await (supabase.rpc as any)("get_path_facets", {
        p_customer_id: customerId ?? undefined,
      });
      if (error) throw error;
      const obj = (data ?? {}) as { programs?: PathFacet[] };
      return {
        programs: obj.programs ?? [],
      };
    },
    staleTime: 60_000,
  });
}

export function useFilterOptions(licensorId?: string | null) {
  const { call } = useAdminApi();
  const { data, isLoading } = useQuery({
    queryKey: ["filter-options", licensorId ?? "all"],
    queryFn: () => call("get-filter-options", licensorId ? { licensor_id: licensorId } : {}),
    staleTime: 30_000,
  });

  return {
    licensors: (data?.licensors ?? []) as { id: string; name: string; asset_count: number }[],
    properties: (data?.properties ?? []) as { id: string; name: string; licensor_id: string; asset_count: number }[],
    isLoading,
  };
}
