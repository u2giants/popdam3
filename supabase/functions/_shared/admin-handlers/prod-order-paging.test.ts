import { describe, expect, it } from "vitest";
import { prodOrderPageWindow } from "./prod-order-paging.ts";

// popdam3#1272: 0-based offset, exclusive end — consecutive pages tile with no gap.
describe("prodOrderPageWindow", () => {
  it("tiles the grid without skipping rows", () => {
    expect(prodOrderPageWindow(0, 100)).toEqual({ startRow: 0, endRow: 100 });
    expect(prodOrderPageWindow(1, 100)).toEqual({ startRow: 100, endRow: 200 });
    expect(prodOrderPageWindow(4, 50).endRow).toBe(prodOrderPageWindow(5, 50).startRow);
  });
});
