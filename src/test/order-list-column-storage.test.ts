import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrderListColumns, saveOrderListColumns } from "@/lib/order-list-column-storage";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("OrderList persisted column recovery", () => {
  it("ignores corrupt storage without preventing grid startup", () => {
    localStorage.setItem("popdam:order-list:columns:v1:user", "broken");
    expect(readOrderListColumns("user")).toBeNull();
    localStorage.setItem("popdam:order-list:columns:v1:user", '[{"width":200}]');
    expect(readOrderListColumns("user")).toBeNull();
  });

  it("keeps column editing available when browser storage is disabled", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    expect(() => saveOrderListColumns("user", [{ colId: "sku", hide: true }])).not.toThrow();
    expect(readOrderListColumns(undefined)).toBeNull();
  });
});
