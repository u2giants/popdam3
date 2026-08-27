import { describe, expect, it } from "vitest";
import {
  TAG_ASSET_REQUIRED_FIELDS,
  TAG_ASSET_SCHEMA,
  buildTaggingSystemPrompt,
} from "../../supabase/functions/_shared/tag-asset-contract.js";
import { TAG_STYLE_GROUP_SCHEMA, buildStyleGroupTaggingPrompt } from "../../supabase/functions/_shared/tag-style-group-contract.js";
import { deriveAuthoritativeGroupTags, groupAiStatus, sourcePriority } from "../../supabase/functions/_shared/tagging-metadata-policy.js";

describe("tag asset contract", () => {
  it("keeps the strict object shape and required fields canonical", () => {
    expect(TAG_ASSET_SCHEMA.type).toBe("object");
    expect(TAG_ASSET_SCHEMA.additionalProperties).toBe(false);
    expect(TAG_ASSET_SCHEMA.required).toBe(TAG_ASSET_REQUIRED_FIELDS);
    expect(TAG_ASSET_REQUIRED_FIELDS).toEqual(["asset_tags", "ai_description", "scene_description", "content_type"]);
    expect(TAG_ASSET_SCHEMA.properties.content_type.type).toBe("string");
    expect(TAG_ASSET_SCHEMA.properties.content_type.enum).toEqual([
      "source_art", "style_guide_art", "pattern_allover", "icon_badge",
      "product_photo", "lifestyle_photo", "render_mockup", "tech_pack",
      "licensing_sheet", "spec_layout_doc", "packaging_art", "sticker", "jcard", "other",
    ]);
    expect(TAG_ASSET_SCHEMA.properties.asset_tags.minItems).toBe(4);
    expect(TAG_ASSET_SCHEMA.properties.asset_tags.maxItems).toBe(18);
    expect(TAG_ASSET_SCHEMA.properties.asset_tags.items.properties.category.enum).toEqual([
      "file_type", "view", "scene", "color", "visible_content", "technique", "other",
    ]);
  });

  it("uses nullable unions for optional string fields", () => {
    const properties = TAG_ASSET_SCHEMA.properties as Record<string, { type: unknown }>;
    for (const field of ["cover_description", "design_style"]) {
      expect(properties[field].type).toEqual(["string", "null"]);
    }
    expect(TAG_ASSET_SCHEMA.properties).not.toHaveProperty("licensor_id");
    expect(TAG_ASSET_SCHEMA.properties).not.toHaveProperty("property_id");
  });

  it("keeps descriptions search-oriented without forcing product categories", () => {
    const properties = TAG_ASSET_SCHEMA.properties as Record<string, { description: string }>;
    expect(properties.ai_description.description).toContain("search-friendly");
    expect(properties.scene_description.description).toContain("literal visual");

    const prompt = buildTaggingSystemPrompt({
      asset: { filename: "sample.psd", relative_path: "Decor/Sample/sample.psd", file_type: "psd", tags: [] },
      taxonomyContext: "Licensors: none\nProperties: none\nCharacters: none",
      itemDescription: "Marvel metallic canvas Spider-Man shooting web 13x19",
    });

    expect(prompt).toContain("professional/lifestyle photography");
    expect(prompt).toContain("never force a product type");
    expect(prompt).toContain("Avoid marketing copy");
    expect(prompt).toContain("Authoritative product/item description");
    expect(prompt).toContain("do NOT restate or override it");
    expect(prompt).toContain("choose exactly one primary file kind");
    expect(prompt).toContain('"professional photography"');
    expect(prompt).toContain('"straight view"');
    expect(prompt).toContain('"3/4 view"');
    expect(prompt).toContain('"close-up view"');
    expect(prompt).toContain('"back view"');
    expect(prompt).toContain('"lifestyle / in-use image"');
    expect(prompt).toContain('"person holding item / size scale image"');
    expect(prompt).toContain("mainly to communicate its physical size or scale");
    expect(prompt).toContain('"product mockup"');
    expect(prompt).toContain('"artwork"');
    expect(prompt).toContain('"tech pack"');
    expect(prompt).toContain('"packaging design"');
    expect(prompt).toContain('"embellishment placement design"');
    expect(prompt).toContain('"freelancer illustration"');
    expect(prompt).toContain("Magenta placement overlays take priority");
    expect(prompt).toContain("Do not guess");
    expect(prompt).toContain("read-only context owned by the Style Group");
    expect(prompt).toContain("Use character_ids only");
  });

  it("keeps group and asset categories physically separate", () => {
    expect(TAG_STYLE_GROUP_SCHEMA.properties.group_tags.items.properties.category.enum).toEqual([
      "product_type", "theme", "style", "occasion", "audience", "technique", "other",
    ]);
    expect(TAG_STYLE_GROUP_SCHEMA.properties.group_tags.items.properties.category.enum).not.toContain("view");
    const prompt = buildStyleGroupTaggingPrompt({
      styleGroup: { sku: "SYNTH-1", item_description: "Synthetic backpack" },
      representativeAssets: [{ id: "a", descriptor: "tech pack" }, { id: "b", descriptor: "photo" }],
    });
    expect(prompt).toContain("Never rewrite or contradict licensor, property, SKU");
    expect(prompt).toContain("Never promote file type, view, scene, color");
  });

  it("applies manual priority, group promotion, and authoritative derivation deterministically", () => {
    expect(sourcePriority("manual")).toBeGreaterThan(sourcePriority("group_ai"));
    expect(sourcePriority("group_ai")).toBeGreaterThan(sourcePriority("file_ai"));
    expect(groupAiStatus(0.85, ["a", "b"])).toBe("active");
    expect(groupAiStatus(0.84, ["a", "b"])).toBe("candidate");
    expect(groupAiStatus(0.99, ["a", "a"])).toBe("candidate");
    expect(deriveAuthoritativeGroupTags({ product_category: " BackPack ", big_theme: "Winter" })).toEqual([
      { tag: "backpack", category: "product_type", source: "authoritative", status: "active", confidence: 1, evidence: { field: "product_type" } },
      { tag: "winter", category: "theme", source: "authoritative", status: "active", confidence: 1, evidence: { field: "theme" } },
    ]);
  });
});
