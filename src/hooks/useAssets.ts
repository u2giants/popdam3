import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Asset, AssetFilters, SortField, SortDirection, FacetCounts } from "@/types/assets";

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
    query = query.ilike("filename", `%${filters.search}%`);
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
  if (filters.tagFilter) {
    query = query.contains("tags", [filters.tagFilter]);
  }

  // File Status filter
  if (filters.fileStatus === "has_preview") {
    query = query.not("thumbnail_url", "is", null);
  } else if (filters.fileStatus === "no_preview_renderable") {
    query = query.is("thumbnail_url", null).or("thumbnail_error.is.null,and(thumbnail_error.neq.no_pdf_compat,thumbnail_error.neq.no_preview_or_render_failed)");
  } else if (filters.fileStatus === "no_pdf_compat") {
    query = query.is("thumbnail_url", null).eq("thumbnail_error", "no_pdf_compat");
  } else if (filters.fileStatus === "no_preview_unsupported") {
    query = query.is("thumbnail_url", null).eq("thumbnail_error", "no_preview_or_render_failed");
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
      query = query.order(sortField, { ascending: sortDirection === "asc" });
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

      const { data, error } = await supabase.rpc("get_filter_counts", {
        p_filters: filterPayload as unknown as Json,
      });
      if (error) throw error;
      return (data ?? {}) as unknown as FacetCounts;
    },
    staleTime: 10_000,
  });
}

export function useFilterOptions(licensorId?: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ["filter-options", licensorId ?? "all"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            action: "get-filter-options",
            ...(licensorId ? { licensor_id: licensorId } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json();
    },
    staleTime: 30_000,
  });

  return {
    licensors: (data?.licensors ?? []) as { id: string; name: string; asset_count: number }[],
    properties: (data?.properties ?? []) as { id: string; name: string; licensor_id: string; asset_count: number }[],
    isLoading,
  };
}
