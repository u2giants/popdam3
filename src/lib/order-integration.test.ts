import { describe, expect, it } from "vitest";

import {
  buildTrackingPatch,
  escapeLiteralOrderSearch,
  normalizeCustomerSuffix,
  normalizeSampleDepth,
  normalizeStrictDate,
} from "@/lib/order-integration";

describe("PO tracking patch validation", () => {
  it("tracking_patch_is_closed_and_dirty_only", () => {
    expect(buildTrackingPatch(
      { agent: "Morgan", comment: null, close_tracking: false },
      { agent: " Morgan ", comment: "", close_tracking: "false" },
    )).toEqual({});
    expect(buildTrackingPatch(
      { agent: "Morgan", close_tracking: false },
      { agent: "  Riley ", close_tracking: "true" },
    )).toEqual({ agent: "Riley", close_tracking: true });
    expect(() => buildTrackingPatch({}, { order_status: "Closed" })).toThrow(/not editable/);
    expect(() => buildTrackingPatch({}, { components: [] })).toThrow(/not editable/);
  });

  it("finite_numeric_and_nullable_depth", () => {
    expect(buildTrackingPatch({}, { cbm: "0" })).toEqual({ cbm: 0 });
    for (const cbm of [-1, Infinity, -Infinity, NaN, "Infinity", "not a number"]) {
      expect(() => buildTrackingPatch({}, { cbm })).toThrow(/finite number/);
    }
    expect(normalizeSampleDepth("1.25")).toBe(1.25);
    expect(normalizeSampleDepth(null)).toBeNull();
    expect(normalizeSampleDepth("  ")).toBeNull();
    for (const depth of [0, -1, Infinity, NaN, "text"]) {
      expect(() => normalizeSampleDepth(depth)).toThrow(/greater than zero/);
    }
  });

  it("strict_dates_and_boolean_false", () => {
    expect(normalizeStrictDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizeStrictDate("0001-01-01")).toBe("0001-01-01");
    expect(normalizeStrictDate("0099-12-31")).toBe("0099-12-31");
    expect(() => normalizeStrictDate("0000-01-01")).toThrow(/calendar date/);
    expect(() => normalizeStrictDate("2023-02-29")).toThrow(/calendar date/);
    expect(() => normalizeStrictDate("2024-2-09")).toThrow(/YYYY-MM-DD/);
    expect(() => normalizeStrictDate("2024-02")).toThrow(/YYYY-MM-DD/);
    expect(buildTrackingPatch({}, { close_tracking: "false", worksheet_done: "false" })).toEqual({
      close_tracking: false,
      worksheet_done: false,
    });
    expect(buildTrackingPatch({}, { close_tracking: "" })).toEqual({ close_tracking: false });
    expect(() => buildTrackingPatch({}, { worksheet_done: "yes" })).toThrow(/must be true, false, or blank/);
  });

  it("search_is_literal_and_page_is_bounded", () => {
    expect(escapeLiteralOrderSearch("50%_complete\\x")).toBe("50\\%\\_complete\\\\x");
    expect(() => escapeLiteralOrderSearch("x".repeat(201))).toThrow(/200 characters/);
    expect(normalizeCustomerSuffix("  EAST  ")).toBe("EAST");
    expect(() => normalizeCustomerSuffix("")).toThrow(/1 to 50/);
    expect(() => normalizeCustomerSuffix("x".repeat(51))).toThrow(/1 to 50/);
  });
});
