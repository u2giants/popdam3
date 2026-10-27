import { describe, expect, it } from "vitest";
import { buildOrderListPOBands } from "@/lib/order-list-po-groups";
import type { OrderListRow } from "@/types/order-list";

const row = (rowIndex: number, order_id: string, production_order_number = "same label") => ({
  rowIndex,
  data: { order_id, production_order_number, order_line_id: `line-${rowIndex}` } as OrderListRow,
});

describe("PO visual bands", () => {
  it("keeps a PO together across block boundaries and alternates at each new PO", () => {
    const bands = buildOrderListPOBands([row(501, "b"), row(499, "a"), row(502, "c"), row(500, "a")]);
    expect([...bands.values()]).toEqual([
      { alternate: false, start: false }, { alternate: false, start: false },
      { alternate: true, start: true }, { alternate: false, start: true },
    ]);
  });

  it("uses PO identity, even when PO labels match, and does not invent a boundary across unloaded rows", () => {
    const bands = buildOrderListPOBands([row(0, "a"), row(1, "b"), row(500, "c")]);
    expect(bands.get("line-1")).toEqual({ alternate: true, start: true });
    expect(bands.get("line-500")?.start).toBe(false);
  });
});
