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
    // ColdLion's value where it disagrees with the merged Google line (#4931).
    "coldlion_quantity_ordered",
    "coldlion_import_po",
    ...ORDER_LIST_COLUMNS.filter((column) => !column.virtual).map((column) => column.field as string),
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
  /** When set, hides rows whose order window date is before this YYYY-MM-DD day. Rows with no window date stay visible. */
  orderWindowStart?: string | null;
};

/**
 * `totalRowCount` is null when the exact count is not (yet) known. The grid
 * treats that as "there is more", which is honest: it never invents a total.
 */
export type OrderListBlock = {
  rows: OrderListRow[];
  totalRowCount: number | null;
  salesOrderDatesError: string | null;
  assortmentQuantitiesError?: string | null;
};

export type OrderListSalesOrderDate = { order_line_id: string; sales_order_date: string | null };
export type OrderListAssortmentQuantity = {
  order_line_id: string;
  assortment_sku_quantity: number | null;
  quantity_source: "order_recipe" | "current_recipe" | null;
};

const SALES_ORDER_DATES_UNAVAILABLE = "SO Date could not be loaded. Refresh OrderList to try again.";
const ASSORTMENT_QUANTITIES_UNAVAILABLE = "SKU quantity in assortment could not be loaded. Refresh OrderList to try again.";

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysPerMonth[month - 1];
}

/** Track failures by grid block so a successful retry clears only its own warning. */
export function updateOrderListSalesDateErrors(
  current: Record<string, string>,
  requestScope: string,
  blockStartRow: number,
  error: string | null,
): Record<string, string> {
  const next = { ...current };
  const key = `${requestScope}:${blockStartRow}`;
  if (error) next[key] = error;
  else delete next[key];
  return next;
}

/** Match sidecar dates only by the exact canonical line ID returned by the RPC. */
export function mergeOrderListSalesOrderDates(
  rows: OrderListRow[],
  dateRows: unknown,
): OrderListRow[] {
  if (!Array.isArray(dateRows)) throw new Error("Could not read OrderList Sales Order dates.");
  const requestedIds = new Set(rows.map((row) => row.order_line_id));
  const dates = new Map<string, string | null>();
  for (const result of dateRows as OrderListSalesOrderDate[]) {
    if (!result || typeof result.order_line_id !== "string" || !requestedIds.has(result.order_line_id)) {
      throw new Error("Sales Order date lookup returned an unexpected OrderList line.");
    }
    if (dates.has(result.order_line_id)) {
      throw new Error("Sales Order date lookup returned a duplicate OrderList line.");
    }
    if (result.sales_order_date !== null && (typeof result.sales_order_date !== "string" || !isIsoCalendarDate(result.sales_order_date))) {
      throw new Error("Sales Order date lookup returned an invalid date.");
    }
    dates.set(result.order_line_id, result.sales_order_date);
  }
  return rows.map((row) => ({ ...row, sales_order_date: dates.get(row.order_line_id) ?? null }));
}

async function attachOrderListSalesOrderDates(rows: OrderListRow[]): Promise<OrderListRow[]> {
  if (rows.length === 0) return rows;
  if (rows.length > 1500) throw new Error("Sales Order date lookup exceeded its 1,500-line bound.");
  const { data, error } = await (supabase as any).rpc("get_dam_order_sales_order_dates", {
    p_line_ids: rows.map((row) => row.order_line_id),
  });
  if (error) throw error;
  return mergeOrderListSalesOrderDates(rows, data ?? []);
}

/** Merge recipe quantities by exact line ID; null or undefined RPC data is malformed. */
export function mergeOrderListAssortmentQuantities(rows: OrderListRow[], quantityRows: unknown): OrderListRow[] {
  if (!Array.isArray(quantityRows)) throw new Error("Could not read OrderList assortment quantities.");
  const requestedIds = new Set(rows.filter((row) => typeof row.assortment_id === "string" && row.assortment_id.trim() !== "").map((row) => row.order_line_id));
  const quantities = new Map<string, OrderListAssortmentQuantity>();
  for (const result of quantityRows as OrderListAssortmentQuantity[]) {
    if (!result || typeof result.order_line_id !== "string" || !requestedIds.has(result.order_line_id)) {
      throw new Error("Assortment quantity lookup returned an unexpected OrderList line.");
    }
    if (quantities.has(result.order_line_id)) throw new Error("Assortment quantity lookup returned a duplicate OrderList line.");
    const quantity = result.assortment_sku_quantity;
    const source = result.quantity_source;
    const sourceValid = source === null || source === "order_recipe" || source === "current_recipe";
    const quantityValid = quantity === null || (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0);
    if (!sourceValid || !quantityValid || ((quantity === null) !== (source === null))) {
      throw new Error("Assortment quantity lookup returned an invalid quantity or source.");
    }
    quantities.set(result.order_line_id, result);
  }
  return rows.map((row) => {
    const result = quantities.get(row.order_line_id);
    return {
      ...row,
      assortment_sku_quantity: result?.assortment_sku_quantity ?? null,
      assortment_quantity_source: result?.quantity_source ?? null,
    };
  });
}

async function attachOrderListAssortmentQuantities(rows: OrderListRow[]): Promise<OrderListRow[]> {
  const assortmentRows = rows.filter((row) => typeof row.assortment_id === "string" && row.assortment_id.trim() !== "");
  if (assortmentRows.length === 0) return rows.map((row) => ({ ...row, assortment_sku_quantity: null, assortment_quantity_source: null }));
  if (assortmentRows.length > 1500) throw new Error("Assortment quantity lookup exceeded its 1,500-line bound.");
  const { data, error } = await (supabase as any).rpc("get_dam_order_assortment_quantities", {
    p_line_ids: assortmentRows.map((row) => row.order_line_id),
  });
  if (error) throw error;
  return mergeOrderListAssortmentQuantities(rows, data);
}

export type OrderListFindRequest = Pick<OrderListBlockRequest, "filterModel" | "sortModel" | "search">;

export type OrderListFindPayload = {
  p_search: string;
  p_filters: ReturnType<typeof buildOrderListFilters>;
  p_sort: ReturnType<typeof buildOrderListSort>;
};

export function buildOrderListFindPayload(request: OrderListFindRequest): OrderListFindPayload {
  return {
    p_search: request.search?.trim() ?? "",
    p_filters: buildOrderListFilters(request.filterModel as Record<string, any> | null),
    p_sort: buildOrderListSort(request.sortModel),
  };
}

function isMissingOrderListFindRpc(error: { code?: string; message?: string } | null | undefined) {
  // Deployment skew only: do not hide permissions, validation, timeout, or SQL errors.
  return error?.code === "42883" || error?.code === "PGRST202";
}

/** Applies filters, search and sort identically to the row and count queries. */
function applyOrderListShape<T>(query: T, request: OrderListBlockRequest, withSort: boolean): T {
  let q = query as any;

  for (const filter of buildOrderListFilters(request.filterModel as Record<string, any> | null)) {
    if (filter.operator === "is") q = q.is(filter.column, null);
    else if (filter.operator === "not.is") q = q.not(filter.column, "is", null);
    else if (filter.operator === "not.ilike") q = q.not(filter.column, "ilike", filter.value);
    else q = q.filter(filter.column, filter.operator, filter.value);
  }

  if (request.orderWindowStart) {
    q = q.or(`order_window_date.is.null,order_window_date.gte.${request.orderWindowStart}`);
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
export async function fetchOrderListCount(request: OrderListBlockRequest): Promise<number | null> {
  const query = applyOrderListShape(
    orderListTable().select(ORDER_LIST_COUNT_SELECT, { count: "exact", head: true }),
    request,
    false,
  );

  const { count, error } = await query;
  // Best effort by design: an unknown total is a live grid, not a dead screen.
  if (error || count == null) return null;

  return count;
}

/** Keeps each `in.(...)` request URL well under proxy limits (100 UUIDs ≈ 3.7 KB). */
const ORDER_LIST_ID_CHUNK = 100;

/** Full grid rows for exact line IDs, returned in the order the IDs were given. */
async function fetchOrderListRowsById(ids: string[]): Promise<OrderListRow[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ORDER_LIST_ID_CHUNK) chunks.push(ids.slice(i, i + ORDER_LIST_ID_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => orderListTable().select(ORDER_LIST_SELECT).in("order_line_id", chunk)));
  const byId = new Map<string, OrderListRow>();
  for (const { data, error } of results as Array<{ data: OrderListRow[] | null; error: unknown }>) {
    if (error) throw error;
    for (const row of data ?? []) byId.set(row.order_line_id, row);
  }
  // A line deleted between the two requests simply drops out of this block.
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/**
 * One bounded block of the view. Sorting, filtering and search all run in the
 * database, so results cover every matching row, not only the loaded ones.
 *
 * Do not count the whole view while loading a block. Production users can have
 * several exact summary counts in flight already; adding another expensive
 * count here made the visible 500-row request compete for the statement timeout.
 * AG Grid discovers the exact end when a bounded block returns fewer rows.
 */
export async function fetchOrderListBlock(request: OrderListBlockRequest): Promise<OrderListBlock> {
  // Two steps on purpose. Sorting the view with every grid column built for
  // every line cost ~2s warm and exceeded the 8s statement_timeout on a cold
  // first load (production 2026-10-27). Ranking only line IDs is ~0.6s, and
  // fetching the chosen lines by primary key is ~30ms per 100.
  const idQuery = applyOrderListShape(orderListTable().select("order_line_id"), request, true);
  const { data: idData, error: idError } = await idQuery.range(request.startRow, Math.max(request.endRow - 1, request.startRow));
  if (idError) throw idError;
  const sourceRows = await fetchOrderListRowsById(((idData ?? []) as Array<{ order_line_id: string }>).map((row) => row.order_line_id));
  const baseRows: OrderListRow[] = sourceRows.map((row) => ({
    ...row,
    sales_order_date: null,
    assortment_sku_quantity: null,
    assortment_quantity_source: null,
  }));
  const [salesDatesResult, assortmentQuantitiesResult] = await Promise.allSettled([
    attachOrderListSalesOrderDates(baseRows),
    attachOrderListAssortmentQuantities(baseRows),
  ]);
  // Merge the independent optional lookups by their exact line IDs. A failure
  // in either sidecar leaves the primary rows and the other sidecar intact.
  const datesById = new Map(
    salesDatesResult.status === "fulfilled"
      ? salesDatesResult.value.map((row) => [row.order_line_id, row.sales_order_date] as const)
      : [],
  );
  const quantitiesById = new Map(
    assortmentQuantitiesResult.status === "fulfilled"
      ? assortmentQuantitiesResult.value.map((row) => [row.order_line_id, [row.assortment_sku_quantity, row.assortment_quantity_source] as const] as const)
      : [],
  );
  const rows = baseRows.map((row) => {
    const [assortment_sku_quantity, assortment_quantity_source] = quantitiesById.get(row.order_line_id) ?? [null, null];
    return {
      ...row,
      sales_order_date: datesById.get(row.order_line_id) ?? null,
      assortment_sku_quantity,
      assortment_quantity_source,
    };
  });
  return {
    rows,
    totalRowCount: null,
    salesOrderDatesError: salesDatesResult.status === "rejected" ? SALES_ORDER_DATES_UNAVAILABLE : null,
    assortmentQuantitiesError: assortmentQuantitiesResult.status === "rejected" ? ASSORTMENT_QUANTITIES_UNAVAILABLE : null,
  };
}

/**
 * Finds the first matching row and its position in the unsearched, filtered
 * list. This lets the grid scroll to a database-wide match without turning the
 * search box into another filter.
 */
async function findOrderListRowWithLegacyScan(request: OrderListFindRequest): Promise<{ rowId: string; index: number } | null> {
  if (!request.search?.trim()) return null;

  const matchQuery = applyOrderListShape(
    orderListTable().select(ORDER_LIST_SELECT),
    { ...request, startRow: 0, endRow: 1 },
    true,
  );
  const { data: matches, error: matchError } = await matchQuery.range(0, 0);
  if (matchError) throw matchError;
  const rowId = ((matches?.[0] ?? null) as OrderListRow | null)?.order_line_id;
  if (!rowId) return null;

  const baseRequest = { ...request, search: "", startRow: 0, endRow: 1 };
  const count = await fetchOrderListCount(baseRequest);
  if (count == null) throw new Error("Could not locate the matching order in the full list.");

  const ranges = Array.from({ length: Math.ceil(count / 1000) }, (_, index) => ({
    from: index * 1000,
    to: Math.min((index + 1) * 1000 - 1, count - 1),
  }));
  for (let start = 0; start < ranges.length; start += 6) {
    const pages = await Promise.all(ranges.slice(start, start + 6).map(async (range) => {
      const query = applyOrderListShape(orderListTable().select("order_line_id"), baseRequest, true);
      const { data, error } = await query.range(range.from, range.to);
      if (error) throw error;
      return { from: range.from, rows: data ?? [] };
    }));
    for (const page of pages) {
      const offset = page.rows.findIndex((candidate: { order_line_id?: string }) => candidate.order_line_id === rowId);
      if (offset >= 0) return { rowId, index: page.from + offset };
    }
  }
  return null;
}

/**
 * Finds a database-wide match and its position without downloading every
 * preceding OrderList ID. The legacy scan exists only during deployment skew
 * where a client reaches a server that genuinely lacks the RPC.
 */
export async function findOrderListRow(request: OrderListFindRequest): Promise<{ rowId: string; index: number } | null> {
  const payload = buildOrderListFindPayload(request);
  if (!payload.p_search) return null;

  const { data, error } = await (supabase.rpc as any)("find_dam_order_list_row", payload);
  if (error) {
    if (!isMissingOrderListFindRpc(error)) throw error;
    console.warn("OrderList Find RPC is unavailable during deployment; using the temporary bounded fallback.", { code: error.code });
    return findOrderListRowWithLegacyScan(request);
  }

  const match = (data?.[0] ?? null) as { order_line_id?: string; row_index?: number } | null;
  if (!match?.order_line_id || typeof match.row_index !== "number") return null;
  return { rowId: match.order_line_id, index: match.row_index };
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
  // Keep these off the database's critical path. Four concurrent exact counts
  // previously competed with the customer's bounded row requests.
  const total = await countWhere((query) => query);
  const linked = await countWhere((query) => query.not("item_id", "is", null));
  const ambiguous = await countWhere((query) => query.eq("master_data_match_status", "ambiguous"));
  const unmatched = await countWhere(
    // Ambiguous rows have their own count, so they are not also counted here.
    (query) => query.is("item_id", null).not("master_data_match_status", "in", "(not_applicable,ambiguous)"),
  );
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
