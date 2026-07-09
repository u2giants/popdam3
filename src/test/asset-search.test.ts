import { describe, expect, it } from "vitest";
import { buildAssetSearchFilter } from "@/hooks/useAssets";

describe("buildAssetSearchFilter", () => {
  it("searches product and AI descriptions", () => {
    const filter = buildAssetSearchFilter("lenticular");

    expect(filter).toContain("cover_description.ilike.%lenticular%");
    expect(filter).toContain("ai_description.ilike.%lenticular%");
    expect(filter).toContain("scene_description.ilike.%lenticular%");
  });

  it("keeps filename, customer, and program search in the same predicate", () => {
    const filter = buildAssetSearchFilter("3fz");

    expect(filter).toContain("filename.ilike.%3fz%");
    expect(filter).toContain("customer.ilike.%3fz%");
    expect(filter).toContain("program.ilike.%3fz%");
  });

  it("ignores blank search text after sanitizing reserved OR characters", () => {
    expect(buildAssetSearchFilter(" (,) ")).toBeNull();
  });
});
