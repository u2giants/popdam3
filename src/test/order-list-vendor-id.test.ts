import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { mergeOrderListVendorIds, ORDER_LIST_SELECT } from "@/hooks/useOrderList";
import { ensureVendorIdInSavedColumnState, ORDER_LIST_COLUMNS, buildOrderListFilters, buildOrderListSort } from "@/lib/order-list";
import type { OrderListRow } from "@/types/order-list";
const rows = [{ order_line_id: "one" }, { order_line_id: "two" }] as OrderListRow[];
describe("Vendor ID source boundary", () => {
  it("preserves leading zeros and blanks absent source without modifying rows", () => {
    expect(mergeOrderListVendorIds(rows, [{ order_line_id: "two", vendor_code: "0012" }])).toEqual([
      { order_line_id: "one", vendor_code: null }, { order_line_id: "two", vendor_code: "0012" },
    ]);
    expect(rows[1].vendor_code).toBeUndefined();
  });
  it.each([null, {}, [{ order_line_id: "other", vendor_code: "1" }], [{ order_line_id: "one", vendor_code: 12 }], [{ order_line_id: "one", vendor_code: " " }], [{ order_line_id: "one", vendor_code: "1" }, { order_line_id: "one", vendor_code: null }]])("rejects malformed or unrelated responses %j", value => {
    expect(() => mergeOrderListVendorIds(rows, value)).toThrow();
  });
  it("shows an automatic read-only column and never queries the primary view for a sidecar field", () => {
    const column = ORDER_LIST_COLUMNS.find(c => c.field === "vendor_code");
    expect(column).toMatchObject({ header: "Vendor ID", virtual: true, queryable: false, source: "automatic" });
    expect(column?.hide).toBeUndefined(); expect(column?.editable).toBeUndefined();
    expect(ORDER_LIST_SELECT.split(",")).not.toContain("vendor_code");
    expect(buildOrderListFilters({ vendor_code: { type: "contains", filter: "12" } })).toEqual([]);
    expect(buildOrderListSort([{ colId: "vendor_code", sort: "asc" }]).some(x => x.column === "vendor_code")).toBe(false);
  });
  it("inserts into older layouts while preserving deliberate hiding, order, width and pinning", () => {
    const old = [{ colId: "sku", width: 200 }, { colId: "vendor_name", pinned: "left" }];
    expect(ensureVendorIdInSavedColumnState(old)).toEqual([...old, { colId: "vendor_code", hide: false }]);
    const hidden = [{ colId: "vendor_code", hide: true, width: 190 }, ...old];
    expect(ensureVendorIdInSavedColumnState(hidden)).toBe(hidden);
    expect(old).toHaveLength(2);
  });
});
