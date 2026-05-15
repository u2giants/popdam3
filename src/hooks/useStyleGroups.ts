import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type WorkflowStatus = Database["public"]["Enums"]["workflow_status"];
import type { AssetFilters } from "@/types/assets";

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
}

const PAGE_SIZE = 200;

function applyStyleGroupFilters(query: any, filters: AssetFilters) {
  if (filters.search) {
    query = query.or(
      `sku.ilike.%${filters.search}%,` +
      `licensor_name.ilike.%${filters.search}%,` +
      `property_name.ilike.%${filters.search}%,` +
      `product_category.ilike.%${filters.search}%`
    );
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
    query = query.in("product_category", filters.productCategory);
  }
  return query;
}

export function useStyleGroups(
  filters: AssetFilters,
  sortField: string,
  sortDirection: "asc" | "desc",
  page: number,
  customPageSize?: number,
  visibilityDate?: string,
) {
  const effectivePageSize = customPageSize ?? PAGE_SIZE;

  return useQuery({
    queryKey: ["style-groups", filters, sortField, sortDirection, page, effectivePageSize, visibilityDate],
    queryFn: async () => {
      const from = page * effectivePageSize;
      const to = from + effectivePageSize - 1;

      let query = supabase
        .from("style_groups")
        .select(
          `*, primary_asset:assets!style_groups_primary_asset_id_fkey(thumbnail_url, thumbnail_error)`,
          { count: "exact" },
        );

      // Visibility date filter — use latest_file_date (max modified_at of member files)
      const minDate = visibilityDate ?? "2020-01-01";
      query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);

      // Filters
      query = applyStyleGroupFilters(query, filters);

      // Sort
      const sgSortField = sortField === "modified_at" ? "latest_file_date" : sortField === "filename" ? "sku" : "latest_file_date";
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
        pageSize: effectivePageSize,
        page,
      };
    },
    placeholderData: (prev) => prev,
  });
}

export function useStyleGroupCount(filters: AssetFilters, visibilityDate?: string) {
  return useQuery({
    queryKey: ["style-group-count", filters, visibilityDate],
    queryFn: async () => {
      let query = supabase
        .from("style_groups")
        .select("*", { count: "exact", head: true });

      const minDate = visibilityDate ?? "2020-01-01";
      query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);

      query = applyStyleGroupFilters(query, filters);

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
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
