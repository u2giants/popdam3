import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  ORDER_LIST_COLUMNS,
  buildOrderListFilters,
  buildOrderListSearchClause,
  buildOrderListSort,
  eligibleLinkCandidates,
  normalizeOrderSku,
} from "@/lib/order-list";
import type {
  OrderCreatePayload,
  OrderListLinkCandidate,
  OrderListRow,
  OrderListSavedView,
  OrderUpdatePayload,
} from "@/types/order-list";

export const ORDER_LIST_SUMMARY_QUERY_KEY = ["order-list-summary"] as const;

function orderListTable() {
  return (supabase as any).schema("api").from("dam_order_list");
}

/**
 * Columns the grid actually reads. The full view is about 2.2 KB per row, so
 * selecting only these keeps each block small.
 */
const ORDER_LIST_SELECT = Array.from(
  new Set<string>([
    "order_line_id",
    "order_id",
    "item_id",
    "sku_normalized",
    "source_style_type",
    "master_data_match_status",
    "item_link_missing",
    "item_link_type_mismatch",
    "snapshot_description",
    "snapshot_license_status",
    "item_description",
    "item_name",
    ...ORDER_LIST_COLUMNS.map((column) => column.field as string),
  ]),
).join(",");

export type OrderListBlockRequest = {
  startRow: number;
  endRow: number;
  sortModel?: Array<{ colId: string; sort: string }>;
  filterModel?: Record<string, unknown> | null;
  search?: string;
};

export type OrderListBlock = { rows: OrderListRow[]; totalRowCount: number };

/**
 * One bounded block of the view. Sorting, filtering and search all run in the
 * database, so results cover every matching row, not only the loaded ones.
 */
export async function fetchOrderListBlock(request: OrderListBlockRequest): Promise<OrderListBlock> {
  let query = orderListTable().select(ORDER_LIST_SELECT, { count: "exact" });

  for (const filter of buildOrderListFilters(request.filterModel as Record<string, any> | null)) {
    if (filter.operator === "is") query = query.is(filter.column, null);
    else if (filter.operator === "not.is") query = query.not(filter.column, "is", null);
    else if (filter.operator === "not.ilike") query = query.not(filter.column, "ilike", filter.value);
    else query = query.filter(filter.column, filter.operator, filter.value);
  }

  const search = buildOrderListSearchClause(request.search ?? "");
  if (search) query = query.or(search);

  for (const sort of buildOrderListSort(request.sortModel)) {
    query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  }

  const { data, count, error } = await query.range(request.startRow, Math.max(request.endRow - 1, request.startRow));
  if (error) throw error;
  return { rows: (data ?? []) as OrderListRow[], totalRowCount: count ?? 0 };
}

export type OrderListStatusCounts = {
  total: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
};

async function countWhere(apply: (query: any) => any): Promise<number> {
  const { count, error } = await apply(orderListTable().select("order_line_id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

/** Whole-dataset link counts, read as counts rather than by loading rows. */
export async function fetchOrderListStatusCounts(): Promise<OrderListStatusCounts> {
  const [total, linked, ambiguous, unmatched] = await Promise.all([
    countWhere((query) => query),
    countWhere((query) => query.not("item_id", "is", null)),
    countWhere((query) => query.eq("master_data_match_status", "ambiguous")),
    // Ambiguous rows have their own count, so they are not also counted here.
    countWhere((query) =>
      query.is("item_id", null).not("master_data_match_status", "in", "(not_applicable,ambiguous)"),
    ),
  ]);
  return { total, linked, ambiguous, unmatched };
}

export function useOrderListStatusCounts(enabled = true) {
  return useQuery({
    queryKey: ORDER_LIST_SUMMARY_QUERY_KEY,
    queryFn: fetchOrderListStatusCounts,
    enabled,
  });
}

/**
 * Master Data rows that could be linked to a SKU. The eligibility rule
 * (exact SKU + matching Licensed/Generic catalog) is applied by
 * `eligibleLinkCandidates`; this only narrows the query.
 */
export async function fetchLinkCandidates(sku: string | null): Promise<OrderListLinkCandidate[]> {
  const normalized = normalizeOrderSku(sku);
  if (!normalized) return [];
  const { data, error } = await (supabase as any)
    .from("style_tracker_rows_with_bridge")
    .select("id, plm_item_id, sku, tracker_type, description, license_status, licensor, default_vendor")
    // Escape LIKE wildcards so a SKU containing % or _ matches literally.
    .ilike("sku", normalized.replace(/[%_\\]/g, (character) => `\\${character}`))
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    style_tracker_row_id: row.id,
    plm_item_id: row.plm_item_id ?? null,
    sku: row.sku ?? null,
    tracker_type: row.tracker_type ?? null,
    description: row.description ?? null,
    license_status: row.license_status ?? null,
    licensor: row.licensor ?? null,
    default_vendor: row.default_vendor ?? null,
  }));
}

export function useOrderListLinkCandidates(row: OrderListRow | null) {
  return useQuery({
    queryKey: ["order-list-link-candidates", row?.sku_normalized ?? row?.sku ?? null, row?.source_style_type ?? null],
    enabled: Boolean(row),
    queryFn: async () => {
      if (!row) return [] as OrderListLinkCandidate[];
      const candidates = await fetchLinkCandidates(row.sku);
      return eligibleLinkCandidates(row, candidates);
    },
  });
}

async function fetchSavedViews(userId: string | undefined): Promise<OrderListSavedView[]> {
  if (!userId) return [];
  const { data, error } = await (supabase as any)
    .from("order_list_user_views")
    .select("id, view_name, column_state, filter_model, sort_model, updated_at")
    .eq("user_id", userId)
    .order("view_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrderListSavedView[];
}

export function useOrderListSavedViews(userId: string | undefined) {
  return useQuery({
    queryKey: ["order-list-saved-views", userId ?? null],
    enabled: Boolean(userId),
    queryFn: () => fetchSavedViews(userId),
  });
}

/**
 * Every mutation reports failure loudly with a toast and asks the page to reload
 * the affected rows, so a rejected save can never leave a wrong value sitting in
 * the grid.
 */
function useOrderListMutation<TVariables>(
  run: (variables: TVariables) => Promise<void>,
  successMessage: string,
  onRowsChanged?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      toast.success(successMessage);
    },
    onError: (error: unknown) => {
      toast.error(`OrderList save failed: ${(error as Error)?.message ?? "unknown error"}`);
    },
    onSettled: () => {
      onRowsChanged?.();
      void queryClient.invalidateQueries({ queryKey: ORDER_LIST_SUMMARY_QUERY_KEY });
    },
  });
}

export function useUpdateOrder(onRowsChanged?: () => void) {
  return useOrderListMutation<OrderUpdatePayload>(
    async (payload) => {
      const { error } = await (supabase.rpc as any)("update_dam_order", payload);
      if (error) throw error;
    },
    "Order saved",
    onRowsChanged,
  );
}

export function useCreateOrder(onRowsChanged?: () => void) {
  return useOrderListMutation<OrderCreatePayload>(
    async (payload) => {
      const { error } = await (supabase.rpc as any)("create_dam_order", payload);
      if (error) throw error;
    },
    "Order created",
    onRowsChanged,
  );
}

export type RelinkPayload = { p_line_id: string; p_item_id: string; p_match_status?: string };

export function useRelinkOrderLine(onRowsChanged?: () => void) {
  return useOrderListMutation<RelinkPayload>(
    async (payload) => {
      const { error } = await (supabase.rpc as any)("link_dam_order_line", {
        p_match_status: "manual",
        ...payload,
      });
      if (error) throw error;
    },
    "Master Data link updated",
    onRowsChanged,
  );
}
