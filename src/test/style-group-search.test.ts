import { describe, expect, it } from "vitest";
import { buildStyleGroupSearchFilter } from "@/hooks/useStyleGroups";

describe("buildStyleGroupSearchFilter", () => {
  it("searches style group folder paths", () => {
    expect(buildStyleGroupSearchFilter("lenticular")).toContain("folder_path.ilike.%lenticular%");
  });

  it("searches AI-derived product descriptions", () => {
    expect(buildStyleGroupSearchFilter("lenticular")).toContain("cover_description.ilike.%lenticular%");
  });

  it("keeps SKU search in the same predicate", () => {
    expect(buildStyleGroupSearchFilter("3fz")).toContain("sku.ilike.%3fz%");
  });

  it("ignores blank search text after sanitizing reserved OR characters", () => {
    expect(buildStyleGroupSearchFilter(" (,) ")).toBeNull();
  });
});
