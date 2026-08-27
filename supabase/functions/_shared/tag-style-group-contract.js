import { GROUP_TAG_CATEGORIES } from "./tagging-metadata-policy.js";

export const TAG_STYLE_GROUP_REQUIRED_FIELDS = ["group_ai_description", "group_tags"];

export const TAG_STYLE_GROUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    group_ai_description: {
      type: "string",
      description: "Concise artwork/theme summary for the Style Group; never replace authoritative product identity.",
    },
    group_tags: {
      type: "array",
      maxItems: 18,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tag: { type: "string" },
          category: { type: "string", enum: GROUP_TAG_CATEGORIES },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence_asset_ids: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
        required: ["tag", "category", "confidence", "evidence_asset_ids"],
      },
    },
  },
  required: TAG_STYLE_GROUP_REQUIRED_FIELDS,
};

export function buildStyleGroupTaggingPrompt(context) {
  const { styleGroup, representativeAssets = [], richMetadata = null } = context;
  return `Profile one PopDAM Style Group using authoritative product context and multiple representative files.

SKU: ${styleGroup.sku ?? ""}
Authoritative item description: ${styleGroup.item_description ?? "unknown"}
Licensor: ${styleGroup.licensor_name ?? "unknown"}
Property: ${styleGroup.property_name ?? "unknown"}
Product category: ${styleGroup.product_category ?? "unknown"}
Rich PDF summary: ${richMetadata ? JSON.stringify(richMetadata).slice(0, 4000) : "none"}
Representative assets: ${representativeAssets.map((asset) => `${asset.id}: ${asset.descriptor ?? asset.content_type ?? "unknown"}`).join("; ")}

Return group_ai_description plus group_tags. Group tags may describe product type, artwork theme/style, occasion, audience, or technique only when supported across the group. Never rewrite or contradict licensor, property, SKU, product category, or item description. Never promote file type, view, scene, color, or a character visible in only one representative to the group. Cite every supporting representative in evidence_asset_ids. Use only these categories: ${
    GROUP_TAG_CATEGORIES.join(", ")
  }.`;
}
