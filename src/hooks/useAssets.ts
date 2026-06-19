import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Asset, AssetFilters, SortField, SortDirection, FacetCounts } from "@/types/assets";
import { useAdminApi } from "@/hooks/useAdminApi";

const PAGE_SIZE = 200;

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

function applyFilters(query: any, filters: AssetFilters) {
  query = query.eq("is_deleted", false);

  if (filters.search) {
    // Match filename, customer program, or customer so a search like "Ross Wall 2026"
    // surfaces every file in that program. Strip PostgREST .or() reserved chars.
    const term = filters.search.replace(/[(),]/g, " ").trim();
    if (term) {
      query = query.or(
        `filename.ilike.%${term}%,program.ilike.%${term}%,customer.ilike.%${term}%`
      );
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
    query = query.in("product_category", filters.productCategory);
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
) {
  const effectivePageSize = customPageSize ?? PAGE_SIZE;
  return useQuery({
    queryKey: ["assets", filters, sortField, sortDirection, page, visibilityDate, effectivePageSize],
    queryFn: async () => {
      const from = page * effectivePageSize;
      const to = from + effectivePageSize - 1;
      const minDate = visibilityDate ?? "2020-01-01";

      let query = supabase
        .from("assets")
        .select("*", { count: "exact" });

      query = applyFilters(query, filters);
      query = applyVisibility(query, minDate);
      // Index.tsx runs this query in both modes, so sortField may carry a
      // groups-only value ("sku"/"asset_count") that is not an assets column.
      // Map those onto valid assets columns to avoid a failed query.
      const assetSortField =
        sortField === "sku" ? "filename"
        : sortField === "asset_count" ? "file_size"
        : sortField;
      query = query.order(assetSortField, { ascending: sortDirection === "asc" });
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        assets: (data ?? []) as Asset[],
        totalCount: count ?? 0,
        pageSize: effectivePageSize,
        page,
      };
    },
    placeholderData: (prev) => prev,
  });
}

export function useAssetCount(filters: AssetFilters, visibilityDate?: string) {
  return useQuery({
    queryKey: ["asset-count", filters, visibilityDate],
    queryFn: async () => {
      const minDate = visibilityDate ?? "2020-01-01";

      let query = supabase
        .from("assets")
        .select("*", { count: "exact", head: true });

      query = applyFilters(query, filters);
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
