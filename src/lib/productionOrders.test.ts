import { describe, expect, it } from "vitest";
import { toStyleProductionOrders } from "./productionOrders";

describe("toStyleProductionOrders (#1272)", () => {
  it("maps shared rows and sorts soonest due first, undated last", () => {
    const out = toStyleProductionOrders([
      { production_order_id: "b", production_order_number: "D2", status: null, customer_name: null, quantity: null, order_date: null, due_date: null, updated_at: null },
      { production_order_id: "a", production_order_number: "D1", status: "Creating PO", customer_name: "Ross", quantity: "240", order_date: null, due_date: "2026-12-20", updated_at: "2026-11-01T00:00:00Z" },
    ]);
    expect(out.map((o) => o.prod_order_number)).toEqual(["D1", "D2"]);
    expect(out[0]).toMatchObject({ id: "a", order_status: "Creating PO", quantity: 240, customer_name: "Ross" });
    expect(out[1].quantity).toBeNull();
  });
});
