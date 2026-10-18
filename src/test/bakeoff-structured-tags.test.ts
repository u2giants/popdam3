import { describe, expect, it } from "vitest";
import { structuredTagSummary } from "@/components/settings/AiTagBakeoffTab";

/**
 * Tags are search terms. Category labels in parentheses are noise for readers,
 * so the comparison view prints tag text only.
 */
describe("bake-off structured asset-only tag display", () => {
  it("shows each tag without its category label", () => {
    expect(structuredTagSummary({
      tags: ["blue", "3/4 view"],
      raw_output: {
        asset_tags: [
          { tag: "blue", category: "color", confidence: 0.9 },
          { tag: "3/4 view", category: "view", confidence: 0.8 },
        ],
      },
    })).toBe("blue, 3/4 view");
  });

  it("falls back to the flattened array for older runs with no structured output", () => {
    expect(structuredTagSummary({ tags: ["blue", "3/4 view"], raw_output: null })).toBe("blue, 3/4 view");
    expect(structuredTagSummary({ tags: [], raw_output: { asset_tags: [] } })).toBe("No tags");
  });

  it("ignores malformed rows instead of rendering blanks or [object Object]", () => {
    expect(structuredTagSummary({
      tags: ["blue"],
      raw_output: { asset_tags: [null, { category: "color" }, { tag: "  " }, { tag: "blue", category: "color" }] },
    })).toBe("blue");
  });
});
