import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { buildProductCategoryOrFilter } from "@/lib/product-category-filters";

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
  stage: string | null;
  customer: string | null;
  program: string | null;
}

const PAGE_SIZE = 200;
const FULL_TEXT_SEARCH_LIMIT = 500;
const NO_MATCH_UUID = "00000000-0000-0000-0000-000000000000";

export function buildStyleGroupSearchFilter(search: string) {
  const term = search.replace(/[(),]/g, " ").trim();
  if (!term) return null;

  return (
    `sku.ilike.%${term}%,` +
    `cover_description.ilike.%${term}%,` +
    `folder_path.ilike.%${term}%,` +
    `licensor_name.ilike.%${term}%,` +
    `property_name.ilike.%${term}%,` +
    `product_category.ilike.%${term}%,` +
    `customer.ilike.%${term}%,` +
    `program.ilike.%${term}%`
  );
}

function shouldFallbackFromFullTextRpc(error: unknown) {
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

  const { data, error } = await (supabase.rpc as any)("search_style_groups_full_text", {
    p_query: term,
    p_limit: FULL_TEXT_SEARCH_LIMIT,
  });
  if (error) {
    if (shouldFallbackFromFullTextRpc(error)) return undefined;
    throw error;
  }

  const ids = ((data ?? []) as { style_group_id: string }[]).map((row) => row.style_group_id);
  return ids.length === 0 || ids.length >= FULL_TEXT_SEARCH_LIMIT ? undefined : ids;
}

function applyStyleGroupFilters(query: any, filters: AssetFilters, fullTextGroupIds?: string[] | null) {
  if (filters.search) {
    if (fullTextGroupIds) {
      query = query.in("id", fullTextGroupIds.length > 0 ? fullTextGroupIds : [NO_MATCH_UUID]);
    } else {
      const searchFilter = buildStyleGroupSearchFilter(filters.search);
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
      const fullTextGroupIds = filters.search ? await fetchStyleGroupFullTextIds(filters.search) : null;

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
      query = applyStyleGroupFilters(query, filters, fullTextGroupIds);

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
        pageSize: effectivePageSize,
        page,
      };
    },
  });
}

export function useStyleGroupCount(filters: AssetFilters, visibilityDate?: string) {
  return useQuery({
    queryKey: ["style-group-count", filters, visibilityDate],
    queryFn: async () => {
      let query = supabase
        .from("style_groups")
        .select("*", { count: "exact", head: true });
      const fullTextGroupIds = filters.search ? await fetchStyleGroupFullTextIds(filters.search) : null;

      const minDate = visibilityDate ?? "2020-01-01";
      query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);

      query = applyStyleGroupFilters(query, filters, fullTextGroupIds);

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useStyleGroupAssetCount(filters: AssetFilters, visibilityDate?: string, enabled = true) {
  return useQuery({
    queryKey: ["style-group-asset-count", filters, visibilityDate],
    enabled,
    queryFn: async () => {
      const pageSize = 1000;
      const minDate = visibilityDate ?? "2020-01-01";
      let from = 0;
      let total = 0;
      const fullTextGroupIds = filters.search ? await fetchStyleGroupFullTextIds(filters.search) : null;

      while (true) {
        let query = supabase
          .from("style_groups")
          .select("asset_count")
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);

        query = query.or(`latest_file_date.gte.${minDate},and(latest_file_date.is.null,asset_count.gt.0)`);
        query = applyStyleGroupFilters(query, filters, fullTextGroupIds);

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
