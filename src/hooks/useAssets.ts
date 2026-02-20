import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Asset, AssetFilters, SortField, SortDirection } from "@/types/assets";

const PAGE_SIZE = 40;

function applyFilters(
  query: any,
  filters: AssetFilters
) {
  // Always exclude deleted
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

  return query;
}

export function useAssets(
  filters: AssetFilters,
  sortField: SortField,
  sortDirection: SortDirection,
  page: number
) {
  return useQuery({
    queryKey: ["assets", filters, sortField, sortDirection, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("assets")
        .select("*", { count: "exact" });

      query = applyFilters(query, filters);
      query = query.order(sortField, { ascending: sortDirection === "asc" });
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        assets: (data ?? []) as Asset[],
        totalCount: count ?? 0,
        pageSize: PAGE_SIZE,
        page,
      };
    },
    placeholderData: (prev) => prev,
  });
}

export function useAssetCount(filters: AssetFilters) {
  return useQuery({
    queryKey: ["asset-count", filters],
    queryFn: async () => {
      let query = supabase
        .from("assets")
        .select("*", { count: "exact", head: true });

      query = applyFilters(query, filters);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useFilterOptions() {
  const licensors = useQuery({
    queryKey: ["licensors-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("licensors")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const properties = useQuery({
    queryKey: ["properties-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  return { licensors: licensors.data ?? [], properties: properties.data ?? [] };
}
