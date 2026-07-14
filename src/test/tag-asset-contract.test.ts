import { describe, expect, it } from "vitest";
import {
  TAG_ASSET_REQUIRED_FIELDS,
  TAG_ASSET_SCHEMA,
} from "../../supabase/functions/_shared/tag-asset-contract.js";

describe("tag asset contract", () => {
  it("keeps the strict object shape and required fields canonical", () => {
    expect(TAG_ASSET_SCHEMA.type).toBe("object");
    expect(TAG_ASSET_SCHEMA.additionalProperties).toBe(false);
    expect(TAG_ASSET_SCHEMA.required).toBe(TAG_ASSET_REQUIRED_FIELDS);
    expect(TAG_ASSET_REQUIRED_FIELDS).toEqual(["tags", "ai_description", "scene_description"]);
  });

  it("uses nullable unions for optional string fields", () => {
    const properties = TAG_ASSET_SCHEMA.properties as Record<string, { type: unknown }>;
    for (const field of ["cover_description", "design_style", "licensor_id", "property_id"]) {
      expect(properties[field].type).toEqual(["string", "null"]);
    }
  });
});
