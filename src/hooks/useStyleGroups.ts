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
  licensor_code: string | null;
  licensor_name: string | null;
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
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 200;

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
          `*, primary_asset:assets!style_groups_primary_asset_id_fkey(thumbnail_url)`,
          { count: "exact" },
        );

      // Visibility date filter — use latest_file_date (max modified_at of member files)
      const minDate = visibilityDate ?? "2020-01-01";
      query = query.gte("latest_file_date", minDate);

      // Filters
      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }
      if (filters.isLicensed !== null) {
        query = query.eq("is_licensed", filters.isLicensed);
      }
      if (filters.workflowStatus.length > 0) {
        query = query.in("workflow_status", filters.workflowStatus as WorkflowStatus[]);
      }

      // Sort
      const sgSortField = sortField === "modified_at" ? "latest_file_date" : sortField === "filename" ? "sku" : "latest_file_date";
      query = query.order(sgSortField, { ascending: sortDirection === "asc" });
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      const groups: StyleGroup[] = (data ?? []).map((row: any) => ({
        ...row,
        thumbnail_url: row.primary_asset?.thumbnail_url ?? null,
        primary_asset: undefined,
      }));

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
      query = query.gte("latest_file_date", minDate);

      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }
      if (filters.isLicensed !== null) {
        query = query.eq("is_licensed", filters.isLicensed);
      }
      if (filters.workflowStatus.length > 0) {
        query = query.in("workflow_status", filters.workflowStatus as WorkflowStatus[]);
      }

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
