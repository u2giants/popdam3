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

  it("ORs every expanded term across every column (synonym-aware fallback)", () => {
    // Mirrors what expandFallbackTerms produces for "spiderman": the raw term
    // plus the "spider man"/"spider-man" synonym+separator variants. The stored
    // property_name is "SPIDER MAN", which a bare '%spiderman%' can never match.
    const filter = buildStyleGroupSearchFilter(["spiderman", "spider man", "spider-man"]);
    expect(filter).toContain("property_name.ilike.%spider man%");
    expect(filter).toContain("property_name.ilike.%spider-man%");
    expect(filter).toContain("sku.ilike.%spiderman%");
  });

  it("returns null when the expanded term list is empty", () => {
    expect(buildStyleGroupSearchFilter([])).toBeNull();
  });
});
