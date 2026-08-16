import { describe, expect, it } from "vitest";
import {
  TAG_ASSET_REQUIRED_FIELDS,
  TAG_ASSET_SCHEMA,
  buildTaggingSystemPrompt,
} from "../../supabase/functions/_shared/tag-asset-contract.js";

describe("tag asset contract", () => {
  it("keeps the strict object shape and required fields canonical", () => {
    expect(TAG_ASSET_SCHEMA.type).toBe("object");
    expect(TAG_ASSET_SCHEMA.additionalProperties).toBe(false);
    expect(TAG_ASSET_SCHEMA.required).toBe(TAG_ASSET_REQUIRED_FIELDS);
    expect(TAG_ASSET_REQUIRED_FIELDS).toEqual(["tags", "ai_description", "scene_description", "content_type"]);
    expect(TAG_ASSET_SCHEMA.properties.content_type.type).toBe("string");
    expect(TAG_ASSET_SCHEMA.properties.content_type.enum).toEqual([
      "source_art", "style_guide_art", "pattern_allover", "icon_badge",
      "product_photo", "lifestyle_photo", "render_mockup", "tech_pack",
      "licensing_sheet", "spec_layout_doc", "packaging_art", "sticker", "jcard", "other",
    ]);
    expect(TAG_ASSET_SCHEMA.properties.tags.minItems).toBe(6);
    expect(TAG_ASSET_SCHEMA.properties.tags.maxItems).toBe(18);
    expect(TAG_ASSET_SCHEMA.properties.tags.uniqueItems).toBe(true);
  });

  it("uses nullable unions for optional string fields", () => {
    const properties = TAG_ASSET_SCHEMA.properties as Record<string, { type: unknown }>;
    for (const field of ["cover_description", "design_style", "licensor_id", "property_id"]) {
      expect(properties[field].type).toEqual(["string", "null"]);
    }
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
    expect(prompt).toContain('"product mockup"');
    expect(prompt).toContain('"artwork"');
    expect(prompt).toContain('"tech pack"');
    expect(prompt).toContain('"packaging design"');
    expect(prompt).toContain('"embellishment placement design"');
    expect(prompt).toContain('"freelancer illustration"');
    expect(prompt).toContain("Magenta placement overlays take priority");
    expect(prompt).toContain("Do not guess");
  });
});
