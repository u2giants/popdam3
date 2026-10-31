import { describe, expect, it } from "vitest";
import { isUserCreatedRow } from "@/pages/styles/helpers";

describe("isUserCreatedRow", () => {
  it("accepts only the user_added origin stamp", () => {
    expect(isUserCreatedRow({ row_data: { origin: "user_added" } })).toBe(true);
    expect(isUserCreatedRow({ row_data: { origin: "plm_item_autoflow" } })).toBe(false);
    expect(isUserCreatedRow({ row_data: { B: "some sheet cell" } })).toBe(false);
    expect(isUserCreatedRow({ row_data: {} })).toBe(false);
    expect(isUserCreatedRow(undefined)).toBe(false);
  });

  it("keeps the stamp after cell edits merge into row_data", () => {
    const rowData = { origin: "user_added", C: "Edited later" };
    expect(isUserCreatedRow({ row_data: rowData })).toBe(true);
  });
});
