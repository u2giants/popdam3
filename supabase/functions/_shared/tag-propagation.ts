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

import { serviceClient } from "./service-client.ts";

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
 *
 * Optimised: fetches all sibling data in one query, then does bulk upserts
 * instead of per-sibling sequential queries. This keeps the total DB round-trips
 * roughly constant regardless of sibling count.
 *
 * @param sourceAssetId - The asset that was just tagged (source of truth)
 * @param styleGroupId - The style group to propagate within
 * @param options.onlyUntagged - If true, only propagate to siblings without ai_tagged_at
 */
export async function propagateGroupTags(
  sourceAssetId: string,
  styleGroupId: string,
  options: { onlyUntagged?: boolean } = {},
): Promise<PropagationResult> {
  const db = serviceClient();

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

  // 4. Find siblings — fetch their metadata in the SAME query to avoid N+1
  let siblingQuery = db
    .from("assets")
    .select("id, ai_tagged_at, licensor_id, property_id, is_licensed, big_theme, little_theme, design_style, cover_description")
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

  const siblingIds = siblings.map((s) => s.id);

  // 5. Batch-fetch existing tags & characters for ALL siblings in two queries
  const [existingTagsResult, existingCharsResult] = await Promise.all([
    productTags.length > 0
      ? db.from("asset_tags").select("asset_id, tag").in("asset_id", siblingIds)
      : Promise.resolve({ data: [] as { asset_id: string; tag: string }[] }),
    characterIds.length > 0
      ? db.from("asset_characters").select("asset_id, character_id").in("asset_id", siblingIds)
      : Promise.resolve({ data: [] as { asset_id: string; character_id: string }[] }),
  ]);

  // Build lookup sets per sibling
  const siblingTagSets = new Map<string, Set<string>>();
  for (const row of (existingTagsResult.data ?? []) as Array<{ asset_id: string; tag: string }>) {
    if (!siblingTagSets.has(row.asset_id)) siblingTagSets.set(row.asset_id, new Set());
    siblingTagSets.get(row.asset_id)!.add(row.tag);
  }

  const siblingCharSets = new Map<string, Set<string>>();
  for (const row of (existingCharsResult.data ?? []) as Array<{ asset_id: string; character_id: string }>) {
    if (!siblingCharSets.has(row.asset_id)) siblingCharSets.set(row.asset_id, new Set());
    siblingCharSets.get(row.asset_id)!.add(row.character_id);
  }

  // 6. Build all mutations in memory, then execute in bulk
  let totalTagsPropagated = 0;
  let totalCharsPropagated = 0;
  const allNewTags: Array<{ asset_id: string; tag: string; source: string }> = [];
  const allNewChars: Array<{ asset_id: string; character_id: string }> = [];
  const metaUpdatePromises: Promise<unknown>[] = [];

  for (const sibling of siblings) {
    // 6a. Metadata updates (only fill nulls)
    const metaUpdates: Record<string, unknown> = {};
    if (!sibling.licensor_id && source.licensor_id) metaUpdates.licensor_id = source.licensor_id;
    if (!sibling.property_id && source.property_id) metaUpdates.property_id = source.property_id;
    if (sibling.is_licensed !== true && source.is_licensed) metaUpdates.is_licensed = source.is_licensed;
    if (!sibling.big_theme && source.big_theme) metaUpdates.big_theme = source.big_theme;
    if (!sibling.little_theme && source.little_theme) metaUpdates.little_theme = source.little_theme;
    if (!sibling.design_style && source.design_style) metaUpdates.design_style = source.design_style;
    if (!sibling.cover_description && source.cover_description) metaUpdates.cover_description = source.cover_description;

    if (Object.keys(metaUpdates).length > 0) {
      metaUpdatePromises.push(Promise.resolve(db.from("assets").update(metaUpdates).eq("id", sibling.id)));
    }

    // 6b. Collect new tags
    if (productTags.length > 0) {
      const existing = siblingTagSets.get(sibling.id) ?? new Set();
      for (const t of productTags) {
        if (!existing.has(t)) {
          allNewTags.push({ asset_id: sibling.id, tag: t, source: "ai" });
          totalTagsPropagated++;
        }
      }
    }

    // 6c. Collect new characters
    if (characterIds.length > 0) {
      const existing = siblingCharSets.get(sibling.id) ?? new Set();
      for (const cid of characterIds) {
        if (!existing.has(cid)) {
          allNewChars.push({ asset_id: sibling.id, character_id: cid });
          totalCharsPropagated++;
        }
      }
    }
  }

  // 7. Execute all writes in parallel (max 3 parallel DB calls)
  const writePromises: Promise<unknown>[] = [...metaUpdatePromises];

  if (allNewTags.length > 0) {
    writePromises.push(
      db.from("asset_tags").upsert(allNewTags, { onConflict: "asset_id,tag" }).then(),
    );
  }

  if (allNewChars.length > 0) {
    writePromises.push(
      db.from("asset_characters").upsert(allNewChars, { onConflict: "asset_id,character_id" }).then(),
    );
  }

  await Promise.all(writePromises);

  const siblingsUpdated = siblings.length;

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
