import { describe, it, expect } from "vitest";
// @ts-expect-error - runtime-neutral JS contract shared with the Deno edge function
import { TAG_ASSET_SCHEMA, toGeminiSchema } from "../../supabase/functions/_shared/tag-asset-contract.js";

/**
 * The Gemini `functionDeclarations` schema dialect rejects array-valued `type`,
 * `null` members in `enum`, and `additionalProperties`. toGeminiSchema() adapts
 * the canonical OpenAI/OpenRouter schema so the edge (Gemini) tagging path keeps
 * working from the single canonical definition. Guards against re-introducing the
 * regression where the raw union-typed schema was passed straight to Gemini.
 */
describe("toGeminiSchema", () => {
  const gemini = toGeminiSchema(TAG_ASSET_SCHEMA) as Record<string, any>;

  it("strips additionalProperties everywhere", () => {
    const serialized = JSON.stringify(gemini);
    expect(serialized).not.toContain("additionalProperties");
  });

  it("collapses union types to a single string type", () => {
    expect(gemini.properties.cover_description.type).toBe("string");
    expect(gemini.properties.licensor_id.type).toBe("string");
    expect(Array.isArray(gemini.properties.asset_type.type)).toBe(false);
  });

  it("removes null members from enums", () => {
    expect(gemini.properties.asset_type.enum).toEqual(["art_piece", "product"]);
    expect(gemini.properties.art_source.enum).not.toContain(null);
  });

  it("contains no array-typed `type` and no null enum members anywhere", () => {
    const walk = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if ("type" in node) expect(Array.isArray(node.type)).toBe(false);
      if (Array.isArray(node.enum)) expect(node.enum).not.toContain(null);
      Object.values(node).forEach(walk);
    };
    walk(gemini);
  });

  it("preserves required fields and array item types", () => {
    expect(gemini.required).toEqual(["tags", "ai_description", "scene_description", "content_type"]);
    expect(gemini.properties.tags.items.type).toBe("string");
  });
});
