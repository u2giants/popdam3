import { describe, expect, it } from "vitest";
import {
  groupEffectiveRows,
  isAuthoritativeSource,
  tagSourceLabel,
} from "@/hooks/useEffectiveAssetTags";

const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LICENSOR = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "22222222-2222-4222-8222-222222222222";

function row(over: Partial<Parameters<typeof groupEffectiveRows>[0][number]> = {}) {
  return {
    scope: "asset",
    tag: "blue",
    category: "color",
    source: "ai",
    status: "active",
    confidence: 0.9,
    model: "test/model",
    created_by: null,
    effective_licensor_id: LICENSOR,
    effective_property_id: PROPERTY,
    style_group_id: GROUP,
    ...over,
  };
}

describe("effective asset metadata", () => {
  it("keeps Style Group facts and file facts in separate buckets", () => {
    const result = groupEffectiveRows([
      row({ scope: "style_group", tag: "drinkware", category: "product_type", source: "authoritative" }),
      row({ scope: "asset", tag: "3/4 view", category: "view" }),
    ]);
    expect(result.groupTags.map((t) => t.tag)).toEqual(["drinkware"]);
    expect(result.assetTags.map((t) => t.tag)).toEqual(["3/4 view"]);
  });

  it("separates candidates from confirmed facts at both scopes", () => {
    const result = groupEffectiveRows([
      row({ scope: "style_group", tag: "floral", status: "candidate", source: "group_ai" }),
      row({ scope: "style_group", tag: "gift", status: "active", source: "group_ai" }),
      row({ scope: "asset", tag: "zipper", status: "candidate" }),
      row({ scope: "asset", tag: "blue", status: "active" }),
    ]);
    expect(result.groupCandidates.map((t) => t.tag)).toEqual(["floral"]);
    expect(result.groupTags.map((t) => t.tag)).toEqual(["gift"]);
    expect(result.assetCandidates.map((t) => t.tag)).toEqual(["zipper"]);
    expect(result.assetTags.map((t) => t.tag)).toEqual(["blue"]);
  });

  it("keeps rejected facts visible as tombstones and out of the active lists", () => {
    const result = groupEffectiveRows([
      row({ tag: "pink", status: "rejected" }),
      row({ tag: "blue", status: "active" }),
    ]);
    expect(result.rejected.map((t) => t.tag)).toEqual(["pink"]);
    expect(result.assetTags.map((t) => t.tag)).toEqual(["blue"]);
    expect(result.assetCandidates).toEqual([]);
  });

  it("orders manual and business-owned facts ahead of AI suggestions", () => {
    const result = groupEffectiveRows([
      row({ tag: "zebra", source: "ai" }),
      row({ tag: "yak", source: "manual" }),
      row({ tag: "aardvark", source: "ai" }),
    ]);
    expect(result.assetTags.map((t) => t.tag)).toEqual(["yak", "aardvark", "zebra"]);
  });

  it("reports the group's identity for a grouped asset", () => {
    const result = groupEffectiveRows([row({ scope: "style_group", tag: "drinkware" })]);
    expect(result.effectiveLicensorId).toBe(LICENSOR);
    expect(result.effectivePropertyId).toBe(PROPERTY);
    expect(result.styleGroupId).toBe(GROUP);
  });

  it("reports the asset's own identity when it has no Style Group", () => {
    const result = groupEffectiveRows([
      row({ scope: "asset", style_group_id: null, effective_licensor_id: LICENSOR, effective_property_id: null }),
    ]);
    expect(result.styleGroupId).toBeNull();
    expect(result.effectiveLicensorId).toBe(LICENSOR);
    expect(result.effectivePropertyId).toBeNull();
  });

  it("is empty and safe for an asset with no metadata at all", () => {
    const result = groupEffectiveRows([]);
    expect(result.groupTags).toEqual([]);
    expect(result.assetTags).toEqual([]);
    expect(result.styleGroupId).toBeNull();
  });

  it("labels every source a user can see", () => {
    expect(tagSourceLabel("manual")).toBe("Manual");
    expect(tagSourceLabel("authoritative")).toBe("Master Data");
    expect(tagSourceLabel("group_ai")).toBe("Group AI");
    expect(tagSourceLabel("ai")).toBe("File AI");
    expect(tagSourceLabel("legacy_unscoped")).toBe("Legacy (unscoped)");
    expect(tagSourceLabel(null)).toBe("Unknown");
    expect(tagSourceLabel("something_new")).toBe("something_new");
  });

  it("treats business-owned facts as not-AI so they cannot be rejected as suggestions", () => {
    expect(isAuthoritativeSource("manual")).toBe(true);
    expect(isAuthoritativeSource("authoritative")).toBe(true);
    expect(isAuthoritativeSource("erp")).toBe(true);
    expect(isAuthoritativeSource("group_ai")).toBe(false);
    expect(isAuthoritativeSource("ai")).toBe(false);
  });
});
