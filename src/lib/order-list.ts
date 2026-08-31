// Pure helpers for the PopDAM OrderList page. No React, no Supabase, so every
// rule here is unit-testable on its own.

import type {
  OrderHeaderPatch,
  OrderLinePatch,
  OrderListLinkCandidate,
  OrderListMatchStatus,
  OrderListRow,
  OrderListStyleType,
} from "@/types/order-list";

/**
 * How many rows one PostgREST request returns.
 *
 * The list is NOT loaded in full. Measured against preview on 2026-08-16, the
 * whole view is about 53 MB (2.2 MB per 1,000 rows x 24,010 rows) and took ~25
 * seconds to load, far past the 3-second budget, so the grid reads bounded
 * blocks and pushes sorting, filtering and search into the database. That keeps
 * search and filter results complete instead of limited to loaded rows.
 */
export const ORDER_LIST_FETCH_BATCH_SIZE = 500;

export const ORDER_LIST_DEFAULT_PAGE_SIZE = 250;
// Every option must divide ORDER_LIST_FETCH_BATCH_SIZE: AG Grid requires the
// block size to be a whole number of pages.
export const ORDER_LIST_PAGE_SIZE_OPTIONS = [50, 100, 250, 500];

export function shouldFetchNextOrderListBatch(receivedRowCount: number) {
  return receivedRowCount === ORDER_LIST_FETCH_BATCH_SIZE;
}

/** Columns the free-text search box looks in, searched in the database. */
export const ORDER_LIST_SEARCH_COLUMNS = [
  "production_order_number",
  "order_status",
  "customer_po_number",
  "sku",
  "vendor_name",
  "customer_name",
  "container_booking_group",
  "mbl",
  "snapshot_description",
] as const;

export type OrderListFilter = {
  column: string;
  /** PostgREST operator: eq, ilike, gte, lte, is, not.ilike, not.is. */
  operator: string;
  value: string | number | null;
};

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, (character) => `\\${character}`);
}

/** AG Grid text/number/date filter model -> PostgREST filters. Pure and testable. */
export function buildOrderListFilters(filterModel: Record<string, any> | null | undefined): OrderListFilter[] {
  const filters: OrderListFilter[] = [];
  for (const [column, model] of Object.entries(filterModel ?? {})) {
    const conditions = Array.isArray(model?.conditions) && model.conditions.length > 0 ? model.conditions : [model];
    for (const condition of conditions) {
      if (!condition) continue;
      const type = condition.type as string | undefined;
      const filterValue = condition.filter;
      const dateFrom = typeof condition.dateFrom === "string" ? condition.dateFrom.slice(0, 10) : undefined;
      const dateTo = typeof condition.dateTo === "string" ? condition.dateTo.slice(0, 10) : undefined;
      const value = dateFrom ?? filterValue;

      if (type === "blank") {
        filters.push({ column, operator: "is", value: null });
        continue;
      }
      if (type === "notBlank") {
        filters.push({ column, operator: "not.is", value: null });
        continue;
      }
      if (value === undefined || value === null || value === "") continue;

      switch (type) {
        case "contains":
          filters.push({ column, operator: "ilike", value: `%${escapeLike(String(value))}%` });
          break;
        case "notContains":
          filters.push({ column, operator: "not.ilike", value: `%${escapeLike(String(value))}%` });
          break;
        case "startsWith":
          filters.push({ column, operator: "ilike", value: `${escapeLike(String(value))}%` });
          break;
        case "endsWith":
          filters.push({ column, operator: "ilike", value: `%${escapeLike(String(value))}` });
          break;
        case "notEqual":
          filters.push({ column, operator: "neq", value: value as string | number });
          break;
        case "greaterThan":
          filters.push({ column, operator: "gt", value: value as string | number });
          break;
        case "greaterThanOrEqual":
          filters.push({ column, operator: "gte", value: value as string | number });
          break;
        case "lessThan":
          filters.push({ column, operator: "lt", value: value as string | number });
          break;
        case "lessThanOrEqual":
          filters.push({ column, operator: "lte", value: value as string | number });
          break;
        case "inRange":
          filters.push({ column, operator: "gte", value: (dateFrom ?? condition.filter) as string | number });
          filters.push({ column, operator: "lte", value: (dateTo ?? condition.filterTo) as string | number });
          break;
        case "equals":
        default:
          filters.push({ column, operator: "eq", value: value as string | number });
          break;
      }
    }
  }
  return filters;
}

/** Free-text search across the recognizable columns, as one PostgREST `or` clause. */
export function buildOrderListSearchClause(search: string): string | null {
  const term = search.trim();
  if (term === "") return null;
  const pattern = `%${escapeLike(term)}%`;
  return ORDER_LIST_SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(",");
}

export type OrderListSort = { column: string; ascending: boolean };

/** AG Grid sort model -> ordering, always ending on a stable tiebreaker. */
export function buildOrderListSort(sortModel: Array<{ colId: string; sort: string }> | null | undefined): OrderListSort[] {
  const sorts = (sortModel ?? [])
    .filter((entry) => entry.colId && entry.sort)
    .map((entry) => ({ column: entry.colId, ascending: entry.sort === "asc" }));
  if (sorts.length === 0) sorts.push({ column: "order_date", ascending: false });
  sorts.push({ column: "order_line_id", ascending: true });
  return sorts;
}

/**
 * Trim + case-fold only. Never strip punctuation and never fuzzy-match: the
 * database matching rule (`plm.production_order_line.sku_normalized`) is exactly
 * this, and the two must agree or the app would offer links the database rejects.
 */
export function normalizeOrderSku(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeStyleType(value: string | null | undefined): OrderListStyleType | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "licensed") return "licensed";
  if (normalized === "generic") return "generic";
  return null;
}

const MATCH_STATUS_LABELS: Record<OrderListMatchStatus, string> = {
  matched: "Linked",
  manual: "Linked (manual)",
  ambiguous: "Ambiguous",
  unmatched: "Not linked",
  not_applicable: "No SKU",
};

export function matchStatusLabel(status: OrderListMatchStatus | null | undefined) {
  if (!status) return MATCH_STATUS_LABELS.not_applicable;
  return MATCH_STATUS_LABELS[status] ?? status;
}

/** Rows in these states need a human to pick the right Master Data record. */
export function needsReview(row: Pick<OrderListRow, "master_data_match_status" | "item_id">) {
  if (row.master_data_match_status === "ambiguous") return true;
  if (row.master_data_match_status === "not_applicable") return false;
  return !row.item_id;
}

export type MasterDataDisplay = {
  value: string;
  /** True when the value came from the frozen import snapshot, not from live Master Data. */
  isSnapshot: boolean;
};

/**
 * Current Master Data wins. Only when the line has no live link do we fall back
 * to the immutable import snapshot, and the caller must label that fallback --
 * a snapshot value must never be shown as if it were current product truth.
 */
export function masterDataDescription(row: OrderListRow): MasterDataDisplay {
  const live = row.master_data_description ?? row.item_description ?? row.item_name;
  if (row.item_id && live) return { value: live, isSnapshot: false };
  return { value: row.snapshot_description ?? "", isSnapshot: true };
}

export function masterDataLicenseStatus(row: OrderListRow): MasterDataDisplay {
  if (row.item_id && row.master_data_license_status) {
    return { value: row.master_data_license_status, isSnapshot: false };
  }
  return { value: row.snapshot_license_status ?? "", isSnapshot: true };
}

export function formatOrderDate(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function formatOrderBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  return value ? "Yes" : "No";
}

/** Grid text -> stored value. Blank clears the cell rather than storing "". */
export function parseOrderNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOrderText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function parseOrderBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["yes", "true", "y", "1"].includes(text)) return true;
  if (["no", "false", "n", "0"].includes(text)) return false;
  return null;
}

export function parseOrderDate(value: unknown): string | null {
  const text = parseOrderText(value);
  if (!text) return null;
  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * View column -> the key `public.update_dam_order` accepts. The RPC rejects any
 * key outside its allow-list (error 42501), so these names are a hard contract,
 * not a preference. `ordering_company` is deliberately absent: the RPC does not
 * accept it, so the column stays read-only.
 */
export const ORDER_PATCH_KEYS: Record<string, string> = {};

export function patchKeyFor(field: string) {
  return ORDER_PATCH_KEYS[field] ?? field;
}

// Inline edits are intentionally limited to the Google sheet's blue inputs.
// Customer uses a canonical picker in the dialog, and Import PO # is create-only.
export const ORDER_HEADER_FIELDS = [] as const;

export const ORDER_LINE_FIELDS = [
  "order_person",
  "order_type",
  "customer_po_number",
  "assortment_id",
  "sku",
  "quantity_ordered",
  "order_depth_inches",
  "case_pack",
  "ship_to",
  "start_ship_date",
  "cancel_date",
] as const;

export type OrderHeaderField = (typeof ORDER_HEADER_FIELDS)[number];
export type OrderLineField = (typeof ORDER_LINE_FIELDS)[number];

export function isOrderHeaderField(field: string): field is OrderHeaderField {
  return (ORDER_HEADER_FIELDS as readonly string[]).includes(field);
}

export function isOrderLineField(field: string): field is OrderLineField {
  return (ORDER_LINE_FIELDS as readonly string[]).includes(field);
}

export type OrderListEdit = {
  orderId: string;
  orderLineId: string;
  orderPatch: OrderHeaderPatch;
  linePatch: OrderLinePatch;
};

/**
 * Build the smallest possible patch for one edited cell. Unknown fields are
 * rejected loudly instead of silently dropped, so a renamed view column shows up
 * as an error rather than a save that quietly does nothing.
 */
export function buildOrderListEdit(row: OrderListRow, field: string, value: unknown): OrderListEdit {
  // Strict on purpose: a value we cannot parse must be refused, never written as null.
  const patchValue = coerceFieldValueStrict(field, value);
  if (isOrderHeaderField(field)) {
    return {
      orderId: row.order_id,
      orderLineId: row.order_line_id,
      orderPatch: { [patchKeyFor(field)]: patchValue } as OrderHeaderPatch,
      linePatch: {},
    };
  }
  if (isOrderLineField(field)) {
    return {
      orderId: row.order_id,
      orderLineId: row.order_line_id,
      orderPatch: {},
      linePatch: { [patchKeyFor(field)]: patchValue } as OrderLinePatch,
    };
  }
  throw new Error(`OrderList: "${field}" is not an editable order or line field`);
}

const DATE_FIELDS = new Set<string>([
  "order_date",
  "sent_po_date",
  "seal_container_date",
  "vendor_delivery_date",
  "requested_ship_date",
  "actual_ship_date",
  "etd",
  "eta",
  "warehouse_date",
  "start_ship_date",
  "cancel_date",
  "cargo_forecast_date",
]);

const NUMBER_FIELDS = new Set<string>([
  "quantity_ordered",
  "quantity_shipped",
  "unit_cost",
  "order_depth_inches",
  "case_pack",
  "cases_reported",
]);

const BOOLEAN_FIELDS = new Set<string>(["close_tracking", "contractual_sample_reorder"]);

export function coerceFieldValue(field: string, value: unknown) {
  if (DATE_FIELDS.has(field)) return parseOrderDate(value);
  if (NUMBER_FIELDS.has(field)) return parseOrderNumber(value);
  if (BOOLEAN_FIELDS.has(field)) return parseOrderBoolean(value);
  return parseOrderText(value);
}

/** The column header a user actually sees, for error messages. Falls back to the field name. */
export function columnHeaderFor(field: string): string {
  return ORDER_LIST_COLUMNS.find((column) => column.field === field)?.header ?? field;
}

/**
 * Same as `coerceFieldValue`, but REFUSES input it cannot understand instead of
 * turning it into `null`.
 *
 * The lenient parsers return `null` both for "the user cleared this field" and
 * for "this text is not a date/number/yes-no". Writing that `null` through means
 * typing `not-a-date` over a real date ERASES it and reports "Order saved" --
 * silent data loss with a success message (observed in production 2026-08-26).
 * Clearing a field to empty is still legitimate and still writes `null`; only
 * non-empty unparseable input throws, and the caller turns that into a toast.
 */
export function coerceFieldValueStrict(field: string, value: unknown) {
  const text = parseOrderText(value);
  // Empty means "clear this field", which is a real and allowed edit.
  if (text === null) return coerceFieldValue(field, value);

  if (DATE_FIELDS.has(field)) {
    const parsed = parseOrderDate(value);
    if (parsed === null) {
      throw new Error(`"${text}" is not a date. ${columnHeaderFor(field)} needs YYYY-MM-DD, or an empty cell to clear it.`);
    }
    return parsed;
  }
  if (NUMBER_FIELDS.has(field)) {
    const parsed = parseOrderNumber(value);
    if (parsed === null) {
      throw new Error(`"${text}" is not a number. ${columnHeaderFor(field)} needs a number, or an empty cell to clear it.`);
    }
    return parsed;
  }
  if (BOOLEAN_FIELDS.has(field)) {
    const parsed = parseOrderBoolean(value);
    if (parsed === null) {
      throw new Error(`"${text}" is not a yes or no. ${columnHeaderFor(field)} needs yes or no, or an empty cell to clear it.`);
    }
    return parsed;
  }
  return text;
}

/**
 * Eligible relink candidates: exact normalized SKU, and the Master Data catalog
 * must match the line's Licensed/Generic discriminator. Candidates without a
 * canonical item cannot be linked, so they are excluded rather than offered.
 */
export function eligibleLinkCandidates(
  row: Pick<OrderListRow, "sku" | "sku_normalized" | "source_style_type">,
  candidates: OrderListLinkCandidate[],
) {
  const sku = row.sku_normalized ?? normalizeOrderSku(row.sku);
  const type = normalizeStyleType(row.source_style_type);
  if (!sku) return [];
  return candidates.filter((candidate) => {
    if (!candidate.plm_item_id) return false;
    if (normalizeOrderSku(candidate.sku) !== sku) return false;
    if (type && normalizeStyleType(candidate.tracker_type) !== type) return false;
    return true;
  });
}

export type OrderListSummaryCounts = {
  total: number;
  filtered: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
};

export function summarizeOrderListRows(rows: OrderListRow[], total?: number): OrderListSummaryCounts {
  let linked = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const row of rows) {
    if (row.master_data_match_status === "ambiguous") ambiguous += 1;
    else if (row.item_id) linked += 1;
    else if (row.master_data_match_status !== "not_applicable") unmatched += 1;
  }
  return { total: total ?? rows.length, filtered: rows.length, linked, ambiguous, unmatched };
}

export type OrderListColumn = {
  field: keyof OrderListRow;
  header: string;
  width?: number;
  /** "masterData" columns are read-only and visually marked as Master Data. */
  kind: "order" | "line" | "masterData" | "link" | "diagnostic";
  type?: "text" | "number" | "date" | "boolean";
  editable?: boolean;
  /** Mirrors the Google sheet: blue is user input; gray is automatic/linked output. */
  source?: "input" | "automatic" | "helper";
  hide?: boolean;
  pinned?: "left";
};

/**
 * Default visible order follows the legacy sheet flow so staff recognize it:
 * PO status / number / vendor / dates / customer / style / Master Data
 * description / license status / quantity / shipping / tracking.
 * Rarely used and PO-writing helper fields stay available through Columns.
 */
export const ORDER_LIST_COLUMNS: OrderListColumn[] = [
  { field: "order_status", header: "PO Status", kind: "order", source: "automatic", type: "text", width: 130, pinned: "left" },
  { field: "production_order_number", header: "Import PO #", kind: "order", source: "helper", type: "text", width: 150, pinned: "left" },
  { field: "vendor_name", header: "Vendor", kind: "order", type: "text", width: 170 },
  { field: "order_date", header: "Order Date", kind: "order", type: "date", width: 130 },
  { field: "sent_po_date", header: "Sent PO", kind: "order", type: "date", width: 130 },
  { field: "customer_name", header: "Customer", kind: "order", source: "input", type: "text", width: 170 },
  { field: "customer_po_number", header: "Customer PO", kind: "line", source: "input", type: "text", editable: true, width: 150 },
  { field: "sku", header: "Style #", kind: "line", source: "input", type: "text", editable: true, width: 150 },
  { field: "master_data_match_status", header: "Master Data Link", kind: "link", width: 210 },
  { field: "master_data_description", header: "Description (Master Data)", kind: "masterData", type: "text", width: 280 },
  { field: "master_data_license_status", header: "License Status (Master Data)", kind: "masterData", type: "text", width: 180 },
  { field: "master_data_licensor", header: "Licensor (Master Data)", kind: "masterData", type: "text", width: 170 },
  { field: "source_style_type", header: "Licensed / Generic", kind: "line", type: "text", width: 150 },
  { field: "quantity_ordered", header: "Quantity", kind: "line", source: "input", type: "number", editable: true, width: 120 },
  { field: "case_pack", header: "Case Pack", kind: "line", source: "input", type: "number", editable: true, width: 120 },
  { field: "start_ship_date", header: "Start Ship", kind: "line", source: "input", type: "date", editable: true, width: 130 },
  { field: "cancel_date", header: "Cancel", kind: "line", source: "input", type: "date", editable: true, width: 130 },
  { field: "requested_ship_date", header: "Requested Ship", kind: "order", type: "date", width: 150 },
  { field: "actual_ship_date", header: "Actual Ship", kind: "order", type: "date", width: 140 },
  { field: "etd", header: "ETD", kind: "order", type: "date", width: 120 },
  { field: "eta", header: "ETA", kind: "order", type: "date", width: 120 },
  { field: "warehouse_date", header: "Warehouse", kind: "order", type: "date", width: 135 },
  { field: "container_booking_group", header: "Container / Booking", kind: "order", type: "text", width: 175 },
  { field: "mbl", header: "MBL", kind: "order", type: "text", width: 140 },
  { field: "close_tracking", header: "Close Tracking", kind: "order", type: "boolean", width: 150 },

  // Available through the Columns panel, hidden by default.
  { field: "line_number", header: "Line #", kind: "line", type: "text", width: 110, hide: true },
  { field: "order_person", header: "Order Person", kind: "line", source: "input", type: "text", editable: true, width: 150, hide: true },
  { field: "order_type", header: "Order Type", kind: "line", source: "input", type: "text", editable: true, width: 140, hide: true },
  { field: "customer_suffix", header: "Customer Suffix", kind: "line", type: "text", width: 150, hide: true },
  { field: "ordering_company", header: "Ordering Company", kind: "order", type: "text", width: 170, hide: true },
  { field: "assortment_id", header: "Assortment ID", kind: "line", source: "input", type: "text", editable: true, width: 150, hide: true },
  { field: "assortment_component_ordinal", header: "Assortment Component", kind: "line", type: "number", width: 180, hide: true },
  { field: "quantity_shipped", header: "Quantity Shipped", kind: "line", type: "number", width: 160, hide: true },
  { field: "unit_cost", header: "Unit Cost", kind: "line", type: "number", width: 130, hide: true },
  { field: "order_depth_inches", header: "Order Depth (in)", kind: "line", source: "input", type: "number", editable: true, width: 160, hide: true },
  { field: "cases_reported", header: "Cases Reported", kind: "line", type: "number", width: 155, hide: true },
  { field: "ship_to", header: "Ship To", kind: "line", source: "input", type: "text", editable: true, width: 150, hide: true },
  { field: "cargo_forecast_date", header: "Cargo Forecast", kind: "line", type: "date", width: 150, hide: true },
  { field: "start_ship_raw", header: "Start Ship (raw)", kind: "diagnostic", type: "text", width: 150, hide: true },
  { field: "cancel_raw", header: "Cancel (raw)", kind: "diagnostic", type: "text", width: 150, hide: true },
  { field: "cargo_forecast_raw", header: "Cargo Forecast (raw)", kind: "diagnostic", type: "text", width: 170, hide: true },
  { field: "seal_container_date", header: "Seal Container", kind: "order", type: "date", width: 150, hide: true },
  { field: "vendor_delivery_date", header: "Vendor Delivery", kind: "order", type: "date", width: 155, hide: true },
  { field: "booking_state", header: "Booking", kind: "order", type: "text", width: 140, hide: true },
  { field: "test_report", header: "Test Report", kind: "line", type: "text", width: 150, hide: true },
  { field: "professional_photos", header: "Professional Photos", kind: "line", type: "text", width: 175, hide: true },
  { field: "contractual_sample_reorder", header: "Contractual Sample Reorder", kind: "line", type: "boolean", width: 210, hide: true },
  { field: "line_status", header: "Line Status", kind: "line", type: "text", width: 140, hide: true },
  { field: "master_data_default_vendor", header: "Default Vendor (Master Data)", kind: "masterData", type: "text", width: 195, hide: true },
  { field: "master_data_customer", header: "Customer (Master Data)", kind: "masterData", type: "text", width: 190, hide: true },
  { field: "item_number", header: "Item #", kind: "masterData", type: "text", width: 140, hide: true },
  { field: "item_style_number", header: "Item Style #", kind: "masterData", type: "text", width: 150, hide: true },
  { field: "snapshot_description", header: "Description (at import)", kind: "diagnostic", type: "text", width: 250, hide: true },
  { field: "snapshot_license_status", header: "License Status (at import)", kind: "diagnostic", type: "text", width: 190, hide: true },
  { field: "snapshot_sku", header: "Style # (at import)", kind: "diagnostic", type: "text", width: 165, hide: true },
  { field: "snapshot_source_row", header: "Source Row", kind: "diagnostic", type: "text", width: 130, hide: true },
  { field: "google_source_id", header: "Google Source ID", kind: "diagnostic", type: "text", width: 220, hide: true },
  { field: "coldlion_source_id", header: "Coldlion Source ID", kind: "diagnostic", type: "text", width: 220, hide: true },
  { field: "order_void_reason", header: "Order Void Reason", kind: "order", type: "text", width: 180, hide: true },
  { field: "line_void_reason", header: "Line Void Reason", kind: "line", type: "text", width: 180, hide: true },
];

export function isMasterDataColumn(column: OrderListColumn) {
  return column.kind === "masterData";
}
