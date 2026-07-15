import { describe, expect, it } from "vitest";
import { defaultFilters, hasActiveFilters } from "@/types/assets";

describe("hasActiveFilters", () => {
  it("does not treat blank search text as an active filter", () => {
    expect(hasActiveFilters({ ...defaultFilters, search: "   " })).toBe(false);
  });

  it("treats real search text as an active filter", () => {
    expect(hasActiveFilters({ ...defaultFilters, search: "3fz" })).toBe(true);
  });

  it("treats a content-type selection as an active filter", () => {
    expect(hasActiveFilters({ ...defaultFilters, contentType: ["tech_pack"] })).toBe(true);
  });
});
