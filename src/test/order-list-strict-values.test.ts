import { describe, expect, it } from "vitest";

import { buildOrderListEdit, coerceFieldValue, coerceFieldValueStrict } from "@/lib/order-list";
import type { OrderListRow } from "@/types/order-list";

const row = {
  order_line_id: "line-1",
  order_id: "order-1",
  order_date: "2026-01-02",
  quantity_ordered: 10,
} as unknown as OrderListRow;

/**
 * Regression guard for the silent data-loss path found during the 2026-08-26
 * production human pass: typing `not-a-date` over a real date wiped it and the
 * app reported "Order saved", because the lenient parser turns anything it
 * cannot read into `null` -- indistinguishable from "the user cleared it".
 */
describe("OrderList strict value coercion", () => {
  it("still lets an empty value clear a field", () => {
    expect(coerceFieldValueStrict("order_date", "")).toBeNull();
    expect(coerceFieldValueStrict("quantity_ordered", "   ")).toBeNull();
    expect(coerceFieldValueStrict("close_tracking", "")).toBeNull();
    expect(coerceFieldValueStrict("mbl", "")).toBeNull();
  });

  it("accepts values it can read", () => {
    expect(coerceFieldValueStrict("order_date", "2026-01-15")).toBe("2026-01-15");
    expect(coerceFieldValueStrict("quantity_ordered", "42")).toBe(42);
    expect(coerceFieldValueStrict("close_tracking", "yes")).toBe(true);
    expect(coerceFieldValueStrict("mbl", " ABC123 ")).toBe("ABC123");
  });

  it("refuses a date it cannot read, naming the column", () => {
    expect(() => coerceFieldValueStrict("order_date", "not-a-date")).toThrow(/is not a date/i);
    expect(() => coerceFieldValueStrict("order_date", "not-a-date")).toThrow(/Order Date/);
  });

  it("refuses a number it cannot read", () => {
    expect(() => coerceFieldValueStrict("quantity_ordered", "ten")).toThrow(/is not a number/i);
  });

  it("refuses a yes/no it cannot read", () => {
    expect(() => coerceFieldValueStrict("close_tracking", "maybe")).toThrow(/is not a yes or no/i);
  });

  it("the lenient parser is what used to lose the data, and still would", () => {
    // Kept deliberately: this is the behaviour the strict wrapper exists to stop.
    expect(coerceFieldValue("order_date", "not-a-date")).toBeNull();
    expect(coerceFieldValue("quantity_ordered", "ten")).toBeNull();
  });

  it("a grid edit with unreadable input throws instead of building an erasing patch", () => {
    expect(() => buildOrderListEdit(row, "order_date", "not-a-date")).toThrow(/is not a date/i);
    expect(() => buildOrderListEdit(row, "quantity_ordered", "ten")).toThrow(/is not a number/i);
  });

  it("a grid edit that clears a field still builds a null patch", () => {
    expect(buildOrderListEdit(row, "order_date", "").orderPatch).toEqual({ order_date: null });
  });
});

describe("OrderList row fetch covers void state", () => {
  it("asks the view for the void columns the grid needs but never displays", async () => {
    // `order_voided_at` drives the struck-through row and the editor's
    // Void/Restore choice, and it is not a grid column -- so it has to be named
    // explicitly or it never arrives, and both features silently do nothing.
    // That is exactly what happened in production on 2026-08-26.
    const { ORDER_LIST_SELECT } = await import("@/hooks/useOrderList");
    const columns = ORDER_LIST_SELECT.split(",");
    expect(columns).toContain("order_voided_at");
    expect(columns).toContain("line_voided_at");
  });
});
