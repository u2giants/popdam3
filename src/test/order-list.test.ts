import { describe, expect, it } from "vitest";

import {
  ORDER_LIST_COLUMNS,
  ORDER_LIST_PAGE_SIZE_OPTIONS,
  buildOrderListFilters,
  buildOrderListSearchClause,
  buildOrderListSort,
  ORDER_LIST_FETCH_BATCH_SIZE,
  buildOrderListEdit,
  eligibleLinkCandidates,
  formatOrderBoolean,
  formatOrderDate,
  masterDataDescription,
  masterDataLicenseStatus,
  matchStatusLabel,
  needsReview,
  normalizeOrderSku,
  normalizeStyleType,
  parseOrderBoolean,
  parseOrderDate,
  parseOrderNumber,
  shouldFetchNextOrderListBatch,
  summarizeOrderListRows,
} from "@/lib/order-list";
import type { OrderListLinkCandidate, OrderListRow } from "@/types/order-list";

function row(overrides: Partial<OrderListRow> = {}): OrderListRow {
  return {
    order_line_id: "line-1",
    order_id: "order-1",
    production_order_number: "PO-1",
    order_status: "Open",
    company_id: null,
    customer_name: "Acme",
    factory_id: null,
    vendor_name: "Vendor",
    ordering_company: null,
    order_date: "2026-01-02",
    sent_po_date: null,
    seal_container_date: null,
    vendor_delivery_date: null,
    requested_ship_date: null,
    actual_ship_date: null,
    booking_state: null,
    etd: null,
    eta: null,
    warehouse_date: null,
    container_booking_group: null,
    mbl: null,
    close_tracking: null,
    order_voided_at: null,
    order_void_reason: null,
    line_number: "1",
    order_person: null,
    order_type: null,
    customer_suffix: null,
    customer_po_number: null,
    assortment_id: null,
    assortment_component_ordinal: null,
    sku: "NCV3SP1",
    sku_normalized: "ncv3sp1",
    quantity_ordered: 10,
    quantity_shipped: null,
    unit_cost: null,
    order_depth_inches: null,
    case_pack: null,
    cases_reported: null,
    ship_to: null,
    start_ship_date: null,
    start_ship_raw: null,
    cancel_date: null,
    cancel_raw: null,
    cargo_forecast_date: null,
    cargo_forecast_raw: null,
    test_report: null,
    professional_photos: null,
    contractual_sample_reorder: null,
    line_status: null,
    line_voided_at: null,
    line_void_reason: null,
    source_style_type: "licensed",
    master_data_match_status: "matched",
    item_id: "item-1",
    item_number: null,
    item_style_number: null,
    item_name: null,
    item_description: null,
    style_tracker_bridge_id: null,
    style_tracker_row_id: null,
    master_data_tracker_type: "licensed",
    master_data_description: "Current description",
    master_data_license_status: "Approved",
    master_data_licensor: "Warner Bros",
    master_data_default_vendor: null,
    master_data_customer: null,
    snapshot_sku: "NCV3SP1",
    snapshot_description: "Description at import",
    snapshot_license_status: "Pending",
    snapshot_style_type: "licensed",
    snapshot_source_row: "65",
    item_link_missing: false,
    item_link_type_mismatch: false,
    google_source_id: "order:row:65",
    coldlion_source_id: null,
    line_created_at: null,
    line_updated_at: null,
    ...overrides,
  };
}

describe("OrderList SKU normalization", () => {
  it("trims and case-folds only, never strips punctuation", () => {
    expect(normalizeOrderSku("  NcV3-SP1 ")).toBe("ncv3-sp1");
    expect(normalizeOrderSku("   ")).toBeNull();
    expect(normalizeOrderSku(null)).toBeNull();
  });

  it("accepts only the two Master Data catalogs", () => {
    expect(normalizeStyleType("Licensed")).toBe("licensed");
    expect(normalizeStyleType(" GENERIC ")).toBe("generic");
    expect(normalizeStyleType("licensed\ngeneric")).toBeNull();
  });
});

describe("OrderList Master Data display", () => {
  it("shows live Master Data when the line is linked", () => {
    expect(masterDataDescription(row())).toEqual({ value: "Current description", isSnapshot: false });
    expect(masterDataLicenseStatus(row())).toEqual({ value: "Approved", isSnapshot: false });
  });

  it("falls back to the import snapshot and names the fallback when unlinked", () => {
    const unlinked = row({ item_id: null, master_data_description: null, master_data_license_status: null, master_data_match_status: "unmatched" });
    expect(masterDataDescription(unlinked)).toEqual({ value: "Description at import", isSnapshot: true });
    expect(masterDataLicenseStatus(unlinked)).toEqual({ value: "Pending", isSnapshot: true });
  });

  it("labels every match status in plain words", () => {
    expect(matchStatusLabel("matched")).toBe("Linked");
    expect(matchStatusLabel("ambiguous")).toBe("Ambiguous");
    expect(matchStatusLabel("unmatched")).toBe("Not linked");
    expect(matchStatusLabel("not_applicable")).toBe("No SKU");
    expect(matchStatusLabel("manual")).toBe("Linked (manual)");
  });

  it("flags rows a human still has to resolve", () => {
    expect(needsReview(row())).toBe(false);
    expect(needsReview(row({ item_id: null, master_data_match_status: "unmatched" }))).toBe(true);
    expect(needsReview(row({ item_id: "item-1", master_data_match_status: "ambiguous" }))).toBe(true);
    expect(needsReview(row({ item_id: null, master_data_match_status: "not_applicable" }))).toBe(false);
  });
});

describe("OrderList value parsing", () => {
  it("turns blank cells into NULL rather than empty strings", () => {
    expect(parseOrderNumber("")).toBeNull();
    expect(parseOrderNumber(" 12 ")).toBe(12);
    expect(parseOrderNumber("Wrong QTY")).toBeNull();
    expect(parseOrderDate("")).toBeNull();
    expect(parseOrderDate("2026-03-04")).toBe("2026-03-04");
    expect(parseOrderDate("#REF!")).toBeNull();
    expect(parseOrderBoolean("Yes")).toBe(true);
    expect(parseOrderBoolean("no")).toBe(false);
    expect(parseOrderBoolean("")).toBeNull();
  });

  it("formats dates and booleans for display", () => {
    expect(formatOrderDate("2026-03-04")).toBe("2026-03-04");
    expect(formatOrderDate(null)).toBe("");
    expect(formatOrderDate("not a date")).toBe("");
    expect(formatOrderBoolean(true)).toBe("Yes");
    expect(formatOrderBoolean(null)).toBe("");
  });
});

describe("OrderList edit diff", () => {
  it("uses the RPC patch key, not the view column name, for status", () => {
    const edit = buildOrderListEdit(row(), "order_status", "Shipped");
    expect(edit.orderPatch).toEqual({ status: "Shipped" });
    expect(buildOrderListEdit(row(), "line_status", "Cancelled").linePatch).toEqual({ status: "Cancelled" });
  });

  it("routes a header field to the order patch", () => {
    const edit = buildOrderListEdit(row(), "etd", "2026-05-06");
    expect(edit).toEqual({
      orderId: "order-1",
      orderLineId: "line-1",
      orderPatch: { etd: "2026-05-06" },
      linePatch: {},
    });
  });

  it("routes a line field to the line patch and coerces its type", () => {
    const edit = buildOrderListEdit(row(), "quantity_ordered", "24");
    expect(edit.orderPatch).toEqual({});
    expect(edit.linePatch).toEqual({ quantity_ordered: 24 });
  });

  it("refuses a read-only Master Data field loudly", () => {
    expect(() => buildOrderListEdit(row(), "master_data_description", "x")).toThrow(/not an editable/);
  });
});

describe("OrderList link candidates", () => {
  const candidates: OrderListLinkCandidate[] = [
    { style_tracker_row_id: "s1", plm_item_id: "i1", sku: "NCV3SP1", tracker_type: "licensed", description: "A", license_status: null, licensor: null, default_vendor: null },
    { style_tracker_row_id: "s2", plm_item_id: "i2", sku: "ncv3sp1", tracker_type: "generic", description: "B", license_status: null, licensor: null, default_vendor: null },
    { style_tracker_row_id: "s3", plm_item_id: null, sku: "NCV3SP1", tracker_type: "licensed", description: "C", license_status: null, licensor: null, default_vendor: null },
    { style_tracker_row_id: "s4", plm_item_id: "i4", sku: "NCV3SP", tracker_type: "licensed", description: "D", license_status: null, licensor: null, default_vendor: null },
  ];

  it("offers only exact SKU matches in the line's own catalog", () => {
    const eligible = eligibleLinkCandidates(row(), candidates);
    expect(eligible.map((candidate) => candidate.style_tracker_row_id)).toEqual(["s1"]);
  });

  it("switches catalog with the line's Licensed/Generic value", () => {
    const eligible = eligibleLinkCandidates(row({ source_style_type: "generic" }), candidates);
    expect(eligible.map((candidate) => candidate.style_tracker_row_id)).toEqual(["s2"]);
  });

  it("offers nothing when the line has no Style #", () => {
    expect(eligibleLinkCandidates(row({ sku: null, sku_normalized: null }), candidates)).toEqual([]);
  });
});

describe("OrderList summary and loading", () => {
  it("counts linked, ambiguous and unmatched rows separately", () => {
    const counts = summarizeOrderListRows([
      row(),
      row({ order_line_id: "l2", item_id: null, master_data_match_status: "unmatched" }),
      row({ order_line_id: "l3", item_id: null, master_data_match_status: "ambiguous" }),
      row({ order_line_id: "l4", item_id: null, master_data_match_status: "not_applicable" }),
    ], 100);
    expect(counts).toEqual({ total: 100, filtered: 4, linked: 1, ambiguous: 1, unmatched: 1 });
  });

  it("reads bounded blocks rather than the whole 24k-row list", () => {
    expect(ORDER_LIST_FETCH_BATCH_SIZE).toBe(200);
    expect(shouldFetchNextOrderListBatch(200)).toBe(true);
    expect(shouldFetchNextOrderListBatch(199)).toBe(false);
  });
});

describe("OrderList columns", () => {
  it("opens with the recognizable legacy sheet order", () => {
    const visible = ORDER_LIST_COLUMNS.filter((column) => !column.hide).map((column) => column.field);
    expect(visible.slice(0, 9)).toEqual([
      "order_status",
      "production_order_number",
      "vendor_name",
      "order_date",
      "sent_po_date",
      "customer_name",
      "customer_po_number",
      "sku",
      "master_data_match_status",
    ]);
  });

  it("never makes a Master Data column editable", () => {
    const editableMasterData = ORDER_LIST_COLUMNS.filter((column) => column.kind === "masterData" && column.editable);
    expect(editableMasterData).toEqual([]);
  });

  it("declares no duplicate columns", () => {
    const fields = ORDER_LIST_COLUMNS.map((column) => column.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});


describe("OrderList database query building", () => {
  it("turns a text filter into a case-insensitive contains", () => {
    expect(buildOrderListFilters({ sku: { filterType: "text", type: "contains", filter: "NCV3" } })).toEqual([
      { column: "sku", operator: "ilike", value: "%NCV3%" },
    ]);
  });

  it("escapes wildcards so a literal % or _ cannot widen the search", () => {
    const [filter] = buildOrderListFilters({ sku: { type: "contains", filter: "50%_off" } });
    expect(filter.value).toBe("%50\\%\\_off%");
  });

  it("supports blank, range and number filters", () => {
    expect(buildOrderListFilters({ eta: { type: "blank" } })).toEqual([{ column: "eta", operator: "is", value: null }]);
    expect(buildOrderListFilters({ quantity_ordered: { type: "greaterThan", filter: 10 } })).toEqual([
      { column: "quantity_ordered", operator: "gt", value: 10 },
    ]);
    expect(
      buildOrderListFilters({ order_date: { type: "inRange", dateFrom: "2026-01-01 00:00:00", dateTo: "2026-02-01 00:00:00" } }),
    ).toEqual([
      { column: "order_date", operator: "gte", value: "2026-01-01" },
      { column: "order_date", operator: "lte", value: "2026-02-01" },
    ]);
  });

  it("expands both halves of a two-condition filter", () => {
    const filters = buildOrderListFilters({
      sku: { conditions: [{ type: "startsWith", filter: "NC" }, { type: "notContains", filter: "TEST" }] },
    });
    expect(filters).toEqual([
      { column: "sku", operator: "ilike", value: "NC%" },
      { column: "sku", operator: "not.ilike", value: "%TEST%" },
    ]);
  });

  it("searches the recognizable columns in the database, not just loaded rows", () => {
    const clause = buildOrderListSearchClause(" D0644 ");
    expect(clause).toContain("production_order_number.ilike.%D0644%");
    expect(clause).toContain("sku.ilike.%D0644%");
    expect(buildOrderListSearchClause("   ")).toBeNull();
  });

  it("always ends sorting on a stable tiebreaker", () => {
    expect(buildOrderListSort([{ colId: "order_date", sort: "asc" }])).toEqual([
      { column: "order_date", ascending: true },
      { column: "order_line_id", ascending: true },
    ]);
    expect(buildOrderListSort([])).toEqual([
      { column: "production_order_number", ascending: false },
      { column: "order_line_id", ascending: true },
    ]);
  });

  it("keeps every page size a whole division of the fetched block", () => {
    for (const size of ORDER_LIST_PAGE_SIZE_OPTIONS) {
      expect(ORDER_LIST_FETCH_BATCH_SIZE % size).toBe(0);
    }
  });
});
