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
export const ORDER_LIST_SELECT = Array.from(
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
    // Void state is not a grid column, but the grid must still know it: a voided
    // order is rendered struck through and the editor offers Restore instead of
    // Void. Leaving it out made both silently do nothing (caught in production
    // during the 2026-08-26 human pass).
    "order_voided_at",
    "line_voided_at",
    ...ORDER_LIST_COLUMNS.map((column) => column.field as string),
  ]),
).join(",");

/** A count-only request still needs a column list; keep it to one cheap column. */
const ORDER_LIST_COUNT_SELECT = "order_line_id";

export type OrderListBlockRequest = {
  startRow: number;
  endRow: number;
  sortModel?: Array<{ colId: string; sort: string }>;
  filterModel?: Record<string, unknown> | null;
  search?: string;
};

/**
 * `totalRowCount` is null when the exact count is not (yet) known. The grid
 * treats that as "there is more", which is honest: it never invents a total.
 */
export type OrderListBlock = { rows: OrderListRow[]; totalRowCount: number | null };

/** Applies filters, search and sort identically to the row and count queries. */
function applyOrderListShape<T>(query: T, request: OrderListBlockRequest, withSort: boolean): T {
  let q = query as any;

  for (const filter of buildOrderListFilters(request.filterModel as Record<string, any> | null)) {
    if (filter.operator === "is") q = q.is(filter.column, null);
    else if (filter.operator === "not.is") q = q.not(filter.column, "is", null);
    else if (filter.operator === "not.ilike") q = q.not(filter.column, "ilike", filter.value);
    else q = q.filter(filter.column, filter.operator, filter.value);
  }

  const search = buildOrderListSearchClause(request.search ?? "");
  if (search) q = q.or(search);

  // Sorting is pointless work for a count-only request.
  if (withSort) {
    for (const sort of buildOrderListSort(request.sortModel)) {
      q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
    }
  }

  return q as T;
}

/** Identifies one result set, so its total is counted once and not per block. */
function orderListCountKey(request: OrderListBlockRequest): string {
  return JSON.stringify({ filter: request.filterModel ?? null, search: request.search ?? "" });
}

const orderListCountCache = new Map<string, number>();

/** Exposed for tests; also called when a new search or filter is applied. */
export function clearOrderListCountCache() {
  orderListCountCache.clear();
}

/**
 * Exact row count for the current filter/search, as a SEPARATE request.
 *
 * PostgREST computes an exact count in the SAME statement that returns the
 * rows. Counting this view exactly costs ~2s as `authenticated` (every row is
 * re-checked against RLS on the order tables, core.customer, core.factory and
 * plm.item), while returning 100 rows costs ~50ms. Asking for both together
 * put the ONE request that renders the screen within reach of the 8s
 * `authenticated` statement_timeout, and under real conditions it exceeded it:
 * the whole grid failed with "canceling statement due to statement timeout"
 * (observed in production 2026-08-26). Splitting them means a slow or failed
 * count can never stop the rows from rendering.
 */
async function fetchOrderListCount(request: OrderListBlockRequest): Promise<number | null> {
  const key = orderListCountKey(request);
  const cached = orderListCountCache.get(key);
  if (cached !== undefined) return cached;

  const query = applyOrderListShape(
    orderListTable().select(ORDER_LIST_COUNT_SELECT, { count: "exact", head: true }),
    request,
    false,
  );

  const { count, error } = await query;
  // Best effort by design: an unknown total is a live grid, not a dead screen.
  if (error || count == null) return null;

  orderListCountCache.set(key, count);
  return count;
}

/**
 * One bounded block of the view. Sorting, filtering and search all run in the
 * database, so results cover every matching row, not only the loaded ones.
 *
 * The rows and the total are two independent requests. The rows decide whether
 * this call succeeds; the total is best-effort and cached per result set.
 */
export async function fetchOrderListBlock(request: OrderListBlockRequest): Promise<OrderListBlock> {
  const rowQuery = applyOrderListShape(orderListTable().select(ORDER_LIST_SELECT), request, true);

  const [rowResult, countResult] = await Promise.allSettled([
    rowQuery.range(request.startRow, Math.max(request.endRow - 1, request.startRow)),
    fetchOrderListCount(request),
  ]);

  if (rowResult.status === "rejected") throw rowResult.reason;
  const { data, error } = rowResult.value;
  if (error) throw error;

  return {
    rows: (data ?? []) as OrderListRow[],
    totalRowCount: countResult.status === "fulfilled" ? countResult.value : null,
  };
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
