import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Asset, AssetFilters, SortField, SortDirection, FacetCounts } from "@/types/assets";
import { useAdminApi } from "@/hooks/useAdminApi";
import { buildProductCategoryOrFilter } from "@/lib/product-category-filters";
import { fetchSearchIds, getSearchMode, sortByRank } from "@/lib/dam-search";

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

export function buildAssetSearchFilter(search: string) {
  const term = search.replace(/[(),]/g, " ").trim();
  if (!term) return null;

  return (
    `filename.ilike.%${term}%,` +
    `cover_description.ilike.%${term}%,` +
    `ai_description.ilike.%${term}%,` +
    `scene_description.ilike.%${term}%,` +
    `program.ilike.%${term}%,` +
    `customer.ilike.%${term}%`
  );
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
      const { data, error } = await (supabase.rpc as any)("search_assets_full_text", {
        p_query: term,
        p_limit: FULL_TEXT_SEARCH_LIMIT,
      });
      if (error) {
        if (shouldFallbackFromFullTextRpc(error)) return undefined;
        throw error;
      }
      return ((data ?? []) as { asset_id: string }[]).map((row) => row.asset_id);
    });
  })();

  assetSearchIdCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_ID_CACHE_TTL_MS,
    promise,
  });

  try {
    return await promise;
  } catch (error) {
    assetSearchIdCache.delete(cacheKey);
    throw error;
  }
}

function applyFilters(query: any, filters: AssetFilters, fullTextAssetIds?: string[] | null) {
  query = query.eq("is_deleted", false);

  if (filters.search) {
    if (fullTextAssetIds) {
      query = query.in("id", fullTextAssetIds.length > 0 ? fullTextAssetIds : [NO_MATCH_UUID]);
    } else {
      const searchFilter = buildAssetSearchFilter(filters.search);
      if (searchFilter) query = query.or(searchFilter);
    }
  }
  if (filters.stage.length > 0) {
    query = query.in("stage", filters.stage);
  }
  if (filters.customer) {
    query = query.eq("customer", filters.customer);
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
      const fullTextAssetIds = filters.search ? await fetchAssetFullTextIds(filters.search) : null;

      let query = supabase
        .from("assets")
        .select("*", { count: "exact" });

      query = applyFilters(query, filters, fullTextAssetIds);
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
      const fullTextAssetIds = filters.search ? await fetchAssetFullTextIds(filters.search) : null;

      let query = supabase
        .from("assets")
        .select("*", { count: "exact", head: true });

      query = applyFilters(query, filters, fullTextAssetIds);
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
 * Distinct customers + programs for the path-attribute filter combos.
 * Programs are scoped to the selected customer when one is provided.
 * Sourced from style_groups (the natural per-SKU unit) via the get_path_facets RPC.
 */
export function usePathFacets(customer?: string | null) {
  return useQuery({
    queryKey: ["path-facets", customer ?? "all"],
    queryFn: async () => {
      // Cast: get_path_facets is added by migration; generated types may lag the frontend build.
      const { data, error } = await (supabase.rpc as any)("get_path_facets", {
        p_customer: customer ?? undefined,
      });
      if (error) throw error;
      const obj = (data ?? {}) as { customers?: PathFacet[]; programs?: PathFacet[] };
      return {
        customers: obj.customers ?? [],
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
