/**
 * Tag Propagation — propagates product-level tags & metadata
 * from a tagged asset to untagged (or all) siblings in the same style group.
 *
 * Strategy: Merge (union) — add missing product-level tags, never remove existing ones.
 *
 * Product-level fields (propagate):
 *   - tags (via asset_tags), excluding file-specific tags
 *   - licensor_id, property_id, is_licensed
 *   - big_theme, little_theme, design_style, cover_description
 *   - character links (asset_characters)
 *
 * File-specific fields (DO NOT propagate):
 *   - asset_type, art_source, ai_description, scene_description
 *   - designer_name, technical_designer_name, freelancer_name
 *   - design_ref
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Tags that describe the file itself, not the product — skip during propagation
const FILE_SPECIFIC_TAGS = new Set([
  "art_piece",
  "art piece",
  "product",
  "product shot",
  "product photo",
  "packaging",
  "package",
  "tech_pack",
  "tech pack",
  "technical pack",
  "photography",
  "photo",
  "mockup",
  "mock up",
  "mock-up",
  "front view",
  "back view",
  "side view",
  "flat lay",
  "flatlay",
  "render",
  "3d render",
]);

function isProductTag(tag: string): boolean {
  return !FILE_SPECIFIC_TAGS.has(tag.toLowerCase().trim());
}

interface PropagationResult {
  siblings_updated: number;
  tags_propagated: number;
  characters_propagated: number;
  skipped_reason?: string;
}

/**
 * Propagate product-level tags/metadata from a source asset to its style group siblings.
 * @param sourceAssetId - The asset that was just tagged (source of truth)
 * @param styleGroupId - The style group to propagate within
 * @param options.onlyUntagged - If true, only propagate to siblings without ai_tagged_at
 */
export async function propagateGroupTags(
  sourceAssetId: string,
  styleGroupId: string,
  options: { onlyUntagged?: boolean } = {},
): Promise<PropagationResult> {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Fetch the source asset's product-level fields
  const { data: source, error: srcErr } = await db
    .from("assets")
    .select("id, licensor_id, property_id, is_licensed, big_theme, little_theme, design_style, cover_description, style_group_id")
    .eq("id", sourceAssetId)
    .single();

  if (srcErr || !source) {
    return { siblings_updated: 0, tags_propagated: 0, characters_propagated: 0, skipped_reason: "source_not_found" };
  }

  if (source.style_group_id !== styleGroupId) {
    return { siblings_updated: 0, tags_propagated: 0, characters_propagated: 0, skipped_reason: "group_mismatch" };
  }

  // 2. Fetch source's AI tags (product-level only)
  const { data: sourceTags } = await db
    .from("asset_tags")
    .select("tag")
    .eq("asset_id", sourceAssetId)
    .eq("source", "ai");

  const productTags = (sourceTags ?? [])
    .map((t) => t.tag)
    .filter(isProductTag);

  // 3. Fetch source's character links
  const { data: sourceChars } = await db
    .from("asset_characters")
    .select("character_id")
    .eq("asset_id", sourceAssetId);

  const characterIds = (sourceChars ?? []).map((c) => c.character_id);

  // 4. Find siblings
  let siblingQuery = db
    .from("assets")
    .select("id, ai_tagged_at")
    .eq("style_group_id", styleGroupId)
    .eq("is_deleted", false)
    .neq("id", sourceAssetId);

  if (options.onlyUntagged) {
    siblingQuery = siblingQuery.is("ai_tagged_at", null);
  }

  const { data: siblings } = await siblingQuery;
  if (!siblings || siblings.length === 0) {
    return { siblings_updated: 0, tags_propagated: 0, characters_propagated: 0, skipped_reason: "no_siblings" };
  }

  let siblingsUpdated = 0;
  let totalTagsPropagated = 0;
  let totalCharsPropagated = 0;

  // 5. For each sibling, merge product-level data
  for (const sibling of siblings) {
    // 5a. Merge metadata fields (only fill nulls for merge strategy)
    const { data: sibData } = await db
      .from("assets")
      .select("licensor_id, property_id, is_licensed, big_theme, little_theme, design_style, cover_description")
      .eq("id", sibling.id)
      .single();

    if (!sibData) continue;

    const metaUpdates: Record<string, unknown> = {};
    if (!sibData.licensor_id && source.licensor_id) metaUpdates.licensor_id = source.licensor_id;
    if (!sibData.property_id && source.property_id) metaUpdates.property_id = source.property_id;
    if (sibData.is_licensed !== true && source.is_licensed) metaUpdates.is_licensed = source.is_licensed;
    if (!sibData.big_theme && source.big_theme) metaUpdates.big_theme = source.big_theme;
    if (!sibData.little_theme && source.little_theme) metaUpdates.little_theme = source.little_theme;
    if (!sibData.design_style && source.design_style) metaUpdates.design_style = source.design_style;
    if (!sibData.cover_description && source.cover_description) metaUpdates.cover_description = source.cover_description;

    if (Object.keys(metaUpdates).length > 0) {
      await db.from("assets").update(metaUpdates).eq("id", sibling.id);
    }

    // 5b. Merge product-level tags (union — never remove existing)
    if (productTags.length > 0) {
      // Get sibling's existing tags to avoid duplicates
      const { data: existingTags } = await db
        .from("asset_tags")
        .select("tag")
        .eq("asset_id", sibling.id);

      const existingTagSet = new Set((existingTags ?? []).map((t) => t.tag));
      const newTags = productTags.filter((t) => !existingTagSet.has(t));

      if (newTags.length > 0) {
        const tagRows = newTags.map((t) => ({
          asset_id: sibling.id,
          tag: t,
          source: "ai",
        }));
        await db.from("asset_tags").upsert(tagRows, { onConflict: "asset_id,tag" });
        totalTagsPropagated += newTags.length;
      }
    }

    // 5c. Merge character links
    if (characterIds.length > 0) {
      const { data: existingChars } = await db
        .from("asset_characters")
        .select("character_id")
        .eq("asset_id", sibling.id);

      const existingCharSet = new Set((existingChars ?? []).map((c) => c.character_id));
      const newChars = characterIds.filter((cid) => !existingCharSet.has(cid));

      if (newChars.length > 0) {
        const charRows = newChars.map((cid) => ({
          asset_id: sibling.id,
          character_id: cid,
        }));
        await db.from("asset_characters").upsert(charRows, { onConflict: "asset_id,character_id" });
        totalCharsPropagated += newChars.length;
      }
    }

    siblingsUpdated++;
  }

  console.log("tag-propagation DONE", {
    sourceAssetId,
    styleGroupId,
    siblingsUpdated,
    totalTagsPropagated,
    totalCharsPropagated,
  });

  return {
    siblings_updated: siblingsUpdated,
    tags_propagated: totalTagsPropagated,
    characters_propagated: totalCharsPropagated,
  };
}
