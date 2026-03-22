/**
 * AI Tagging handler — persistent worker version.
 *
 * Ports logic from:
 *   supabase/functions/ai-tag/index.ts          (Gemini call, DB writes)
 *   supabase/functions/_shared/admin-handlers/ai-tagging-handlers.ts (batch query, smart-skip)
 *
 * Key differences from edge function version:
 *   - No 25s AbortSignal on Gemini calls (60s generous timeout instead)
 *   - Batch size 15 (configurable) vs edge function's 2
 *   - Concurrency 15 (configurable) vs edge function's 2
 *   - Loops until done=true instead of returning after one batch
 *   - Calls Gemini directly — no edge function HTTP hop
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

const GEMINI_TIMEOUT_MS = 60_000;
const THUMBNAIL_FETCH_TIMEOUT_MS = 20_000;
const MAX_AI_RETRIES = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// ── Single-asset Gemini tagging ──────────────────────────────────────────────

async function tagSingleAsset(assetId: string, force: boolean): Promise<"tagged" | "skipped" | "failed"> {
  const client = db();
  const GOOGLE_AI_API_KEY = config.googleAiApiKey;

  if (!GOOGLE_AI_API_KEY) {
    logger.error("GOOGLE_AI_API_KEY not configured");
    return "failed";
  }

  // Fetch asset
  const { data: asset, error: fetchErr } = await client
    .from("assets")
    .select("id, filename, relative_path, file_type, tags, licensor_id, property_id, thumbnail_url, status, ai_tagged_at, sku, style_group_id")
    .eq("id", assetId)
    .single();

  if (fetchErr || !asset) {
    logger.warn("ai-tag: asset not found", { assetId });
    return "failed";
  }

  // Skip if already tagged (unless force)
  if (asset.status === "tagged" && asset.ai_tagged_at && !force) {
    return "skipped";
  }

  const thumbnailUrl = asset.thumbnail_url;
  if (!thumbnailUrl) {
    logger.warn("ai-tag: no thumbnail_url", { assetId });
    return "failed";
  }

  // Fetch custom tagging instructions
  const { data: instrRow } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "TAGGING_INSTRUCTIONS")
    .maybeSingle();
  const customInstructions = typeof instrRow?.value === "string" ? instrRow.value.trim() : null;

  // Fetch taxonomy context
  const [licensorsRes, propertiesRes] = await Promise.all([
    client.from("licensors").select("id, name").limit(50),
    client.from("properties").select("id, name, licensor_id").limit(200),
  ]);
  const licensors = licensorsRes.data ?? [];
  const properties = propertiesRes.data ?? [];

  // Two-tier character matching
  let characters: { id: string; name: string }[] = [];
  let usingPriorityOnly = false;

  if (asset.property_id) {
    const { data: priorityChars } = await client
      .from("characters")
      .select("id, name")
      .eq("property_id", asset.property_id)
      .eq("is_priority", true)
      .order("usage_count", { ascending: false });

    if (priorityChars && priorityChars.length > 0) {
      characters = priorityChars;
      usingPriorityOnly = true;
    } else {
      const { data: allChars } = await client
        .from("characters")
        .select("id, name")
        .eq("property_id", asset.property_id)
        .order("name");
      characters = allChars ?? [];
    }
  } else if (asset.licensor_id) {
    const { data: propIds } = await client
      .from("properties")
      .select("id")
      .eq("licensor_id", asset.licensor_id);
    const ids = (propIds ?? []).map((p: { id: string }) => p.id);

    if (ids.length > 0) {
      const { data: priorityChars } = await client
        .from("characters")
        .select("id, name")
        .in("property_id", ids)
        .eq("is_priority", true)
        .order("usage_count", { ascending: false })
        .limit(200);

      if (priorityChars && priorityChars.length > 0) {
        characters = priorityChars;
        usingPriorityOnly = true;
      } else {
        const { data: allChars } = await client
          .from("characters")
          .select("id, name")
          .in("property_id", ids)
          .limit(300);
        characters = allChars ?? [];
      }
    }
  } else {
    const { data: priorityChars } = await client
      .from("characters")
      .select("id, name")
      .eq("is_priority", true)
      .order("usage_count", { ascending: false })
      .limit(150);
    characters = priorityChars ?? [];
  }

  const charContext = usingPriorityOnly
    ? "Priority characters for this property/licensor (match from this list first):\n"
    : "Characters (full list for this property):\n";

  const taxonomyContext = [
    `Licensors: ${licensors.map((l) => `${l.name} (${l.id})`).join(", ")}`,
    `Properties: ${properties.map((p) => `${p.name} (${p.id})`).join(", ")}`,
    `${charContext}${characters.map((c) => `${c.name} (${c.id})`).join(", ")}`,
  ].join("\n");

  // Fetch ERP description for cover_description derivation
  let erpDescription: string | null = null;
  if (asset.sku) {
    const { data: erpItem } = await client
      .from("erp_items_current")
      .select("item_description")
      .eq("style_number", asset.sku)
      .maybeSingle();
    erpDescription = erpItem?.item_description ?? null;
  }

  const erpCoverContext = erpDescription ? `\nERP Product Description: "${erpDescription}"\n` : "";

  const systemPrompt = `You are a design asset tagger for a consumer products company that licenses characters (Disney, Marvel, Star Wars, etc.).

Analyze the thumbnail image and file metadata to produce structured tags.

File: ${asset.filename}
Path: ${asset.relative_path}
Type: ${asset.file_type}
Existing tags: ${(asset.tags || []).join(", ") || "none"}
${erpCoverContext}
Known taxonomy:
${taxonomyContext}

Based on the image and metadata, identify:
1. Characters visible (match to known characters if possible)
2. Style/design descriptors (flat, dimensional, vintage, modern, etc.)
3. Color palette keywords
4. Scene description (what's happening in the image)
5. Any style numbers or design references visible
6. Asset type: art_piece or product
7. Art source: freelancer, straight_style_guide, or style_guide_composition
8. Suggested licensor_id and property_id from the taxonomy (if identifiable)
9. If this is a Tech Pack or design document, extract the **Designer** (or Creative Designer) name, the **Technical Designer** name, and if freelancer art, the **Freelancer** name. Look for these in title blocks, header areas, or any text labels on the document. Return null for any you cannot find.
10. Cover description rule — **CRITICAL**: This is a PRODUCT label, NOT an image description. Derive a very short card label (max 8 words) as **PROPERTY + PRODUCT TYPE**.
   - If an "ERP Product Description" is provided above: extract the product type ONLY from that text. IGNORE the image entirely for this field — the image often shows artwork/art assets, NOT the actual product.
   - If NO ERP description is available: infer from the filename or folder path (e.g. "backpack", "lunchbox", "tee").
   - Format: "Frozen backpack", "Spider-Man lunchbox", "Mickey tee".
   - OMIT: licensor names (Disney/Marvel/etc.), SKUs, dimensions, art style, scene descriptions, file types.
${usingPriorityOnly
    ? "\nNOTE: You are seeing a curated list of characters that actually appear in this company's asset library. Match against these first. If the character is not in this list, return character_ids as empty array."
    : ""}${customInstructions ? `\n\nCOMPANY-SPECIFIC TAGGING INSTRUCTIONS:\n${customInstructions}` : ""}`;

  // Fetch thumbnail and encode as base64
  let imageBase64: string;
  let imageMimeType: string;
  try {
    const imgResp = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(THUMBNAIL_FETCH_TIMEOUT_MS) });
    if (!imgResp.ok) {
      logger.warn("ai-tag: thumbnail fetch failed", { assetId, status: imgResp.status });
      return "failed";
    }
    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    imageMimeType = contentType.split(";")[0].trim();
    const bytes = new Uint8Array(await imgResp.arrayBuffer());
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    imageBase64 = Buffer.from(binary, "binary").toString("base64");
  } catch (e) {
    logger.warn("ai-tag: thumbnail fetch error", { assetId, error: String(e) });
    return "failed";
  }

  // Call Gemini API with retry on 5xx
  let response: Response | null = null;
  for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
                { text: "Analyze this design asset image and return structured tags using the tag_asset function." },
              ],
            },
          ],
          tools: [
            {
              functionDeclarations: [
                {
                  name: "tag_asset",
                  description: "Return structured tagging data for this design asset.",
                  parameters: {
                    type: "object",
                    properties: {
                      tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Descriptive tags: characters, styles, colors, themes",
                      },
                      ai_description: {
                        type: "string",
                        description: "One-sentence description of the design asset",
                      },
                      cover_description: {
                        type: "string",
                        description:
                          "PRODUCT label (max 8 words). If ERP Product Description was provided, distill property + product type from THAT text ONLY — do NOT use the image. If no ERP description, infer from filename/path. Examples: 'Frozen backpack', 'Spider-Man lunchbox', 'Mickey tee'. NEVER describe the artwork/scene. OMIT licensor names, SKUs, dimensions.",
                      },
                      scene_description: {
                        type: "string",
                        description: "What is depicted in the image",
                      },
                      asset_type: {
                        type: "string",
                        enum: ["art_piece", "product"],
                      },
                      art_source: {
                        type: "string",
                        enum: ["freelancer", "straight_style_guide", "style_guide_composition"],
                      },
                      design_style: {
                        type: "string",
                        description: "e.g. flat, dimensional, vintage, modern",
                      },
                      design_ref: {
                        type: "string",
                        description: "Any style number or design reference visible",
                      },
                      character_ids: {
                        type: "array",
                        items: { type: "string" },
                        description: "UUIDs of identified characters from taxonomy",
                      },
                      licensor_id: {
                        type: "string",
                        description: "UUID of identified licensor",
                      },
                      property_id: {
                        type: "string",
                        description: "UUID of identified property",
                      },
                      designer_name: {
                        type: "string",
                        description:
                          "Name of the Designer or Creative Designer found on a Tech Pack / design document. Null if not visible.",
                      },
                      technical_designer_name: {
                        type: "string",
                        description:
                          "Name of the Technical Designer found on a Tech Pack / design document. Null if not visible.",
                      },
                      freelancer_name: {
                        type: "string",
                        description:
                          "Name of the freelancer artist, if this is freelancer art and the name is visible on the document. Null if not visible.",
                      },
                    },
                    required: ["tags", "ai_description", "scene_description"],
                  },
                },
              ],
            },
          ],
          tool_config: {
            function_calling_config: {
              mode: "ANY",
              allowed_function_names: ["tag_asset"],
            },
          },
        }),
      },
    );

    if (response.ok) break;

    if (response.status === 429) {
      logger.warn("ai-tag: rate limited by Gemini", { assetId });
      return "failed";
    }

    if (response.status >= 500 && attempt < MAX_AI_RETRIES) {
      logger.warn("ai-tag: Gemini transient error, retrying", { assetId, status: response.status, attempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    logger.error("ai-tag: Gemini API error", { assetId, status: response.status });
    return "failed";
  }

  if (!response) return "failed";

  const aiResult = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { args?: Record<string, unknown> } }> } } >;
  };
  const functionCall = aiResult.candidates?.[0]?.content?.parts?.[0]?.functionCall;

  if (!functionCall?.args) {
    logger.warn("ai-tag: Gemini did not return structured tags", { assetId });
    return "failed";
  }

  const tagData = functionCall.args;

  const updates: Record<string, unknown> = {
    status: "tagged",
    ai_tagged_at: new Date().toISOString(),
  };
  if (tagData.ai_description) updates.ai_description = tagData.ai_description;
  if (tagData.cover_description) updates.cover_description = tagData.cover_description;
  if (tagData.scene_description) updates.scene_description = tagData.scene_description;
  if (tagData.asset_type) updates.asset_type = tagData.asset_type;
  if (tagData.art_source) updates.art_source = tagData.art_source;
  if (tagData.design_style) updates.design_style = tagData.design_style;
  if (tagData.design_ref) updates.design_ref = tagData.design_ref;
  if (isValidUuid(tagData.licensor_id)) updates.licensor_id = tagData.licensor_id;
  if (isValidUuid(tagData.property_id)) updates.property_id = tagData.property_id;
  if (tagData.designer_name) updates.designer_name = tagData.designer_name;
  if (tagData.technical_designer_name) updates.technical_designer_name = tagData.technical_designer_name;
  if (tagData.freelancer_name) updates.freelancer_name = tagData.freelancer_name;

  let { error: updateErr } = await client.from("assets").update(updates).eq("id", assetId);

  // FK constraint failure: AI hallucinated a licensor/property UUID — retry without FK fields
  if (updateErr && (updateErr.code === "23503" || updateErr.code === "22P02")) {
    logger.warn("ai-tag: FK/type error, retrying without licensor_id/property_id", { assetId, error: updateErr.message });
    delete updates.licensor_id;
    delete updates.property_id;
    const retry = await client.from("assets").update(updates).eq("id", assetId);
    updateErr = retry.error;
  }

  if (updateErr) {
    logger.error("ai-tag: failed to save tags", { assetId, error: updateErr.message });
    return "failed";
  }

  // Write tags to asset_tags table
  if (Array.isArray(tagData.tags) && tagData.tags.length > 0) {
    await client.from("asset_tags").delete().eq("asset_id", assetId).eq("source", "ai");
    const tagRows = (tagData.tags as string[]).map((t: string) => ({
      asset_id: assetId,
      tag: t.trim().toLowerCase(),
      source: "ai",
    }));
    await client.from("asset_tags").upsert(tagRows, { onConflict: "asset_id,tag" });
  }

  // Write character links
  if (Array.isArray(tagData.character_ids) && tagData.character_ids.length > 0) {
    const validCharIds = (tagData.character_ids as string[]).filter((cid) => isValidUuid(cid));
    if (validCharIds.length > 0) {
      const charLinks = validCharIds.map((cid) => ({ asset_id: assetId, character_id: cid }));
      await client.from("asset_characters").upsert(charLinks, { onConflict: "asset_id,character_id" });
    }
  }

  return "tagged";
}

// ── Batch handler (called from operation-loop) ───────────────────────────────

export async function handleBulkAiTag(opState: OpState, tagAll: boolean): Promise<BatchResult> {
  const client = db();
  const BATCH_SIZE = config.aiBatchSize;
  const CONCURRENCY = config.aiBatchConcurrency;

  const cursor = typeof opState.cursor === "number" ? opState.cursor : 0;
  const groupIds = Array.isArray(opState.params?.group_ids) ? opState.params.group_ids as string[] : null;

  // Smart-skip: for untagged mode, exclude groups that already have a tagged representative
  let excludeGroupIds: string[] = [];
  if (!tagAll && !groupIds) {
    const { data: taggedGroups } = await client
      .from("assets")
      .select("style_group_id")
      .eq("is_deleted", false)
      .eq("status", "tagged")
      .not("style_group_id", "is", null)
      .not("ai_tagged_at", "is", null)
      .limit(1000);
    if (taggedGroups) {
      excludeGroupIds = [...new Set(taggedGroups.map((r: { style_group_id: string }) => r.style_group_id))];
    }
  }

  let query = client
    .from("assets")
    .select("id, thumbnail_url, filename, relative_path, style_group_id")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    .not("primary_sort_tier", "in", "(4,8)");

  if (Array.isArray(groupIds) && groupIds.length > 0) {
    query = query.in("style_group_id", groupIds);
  }

  if (!tagAll && !groupIds) {
    query = query.neq("status", "tagged");
  }

  if (excludeGroupIds.length > 0 && excludeGroupIds.length <= 200) {
    query = query.not("style_group_id", "in", `(${excludeGroupIds.join(",")})`);
  }

  const { data: assets, error: fetchErr } = await query
    .order("primary_sort_tier", { ascending: true })
    .order("id", { ascending: true })
    .range(cursor, cursor + BATCH_SIZE - 1);

  if (fetchErr) {
    return { ok: false, done: false, error: fetchErr.message };
  }

  if (!assets || assets.length === 0) {
    return { ok: true, done: true, tagged: 0, skipped: 0, failed: 0, failure_samples: [], skip_samples: [], nextOffset: cursor };
  }

  let tagged = 0;
  let skipped = 0;
  let failed = 0;
  const failureSamples: Array<{ at: string; asset_id: string; filename: string; relative_path: string; error: string }> = [];
  const skipSamples: Array<{ at: string; asset_id: string; filename: string; relative_path: string; reason: string }> = [];

  // Process in parallel chunks of CONCURRENCY
  for (let i = 0; i < assets.length; i += CONCURRENCY) {
    const chunk = assets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (asset) => {
        const outcome = await tagSingleAsset(asset.id as string, tagAll);
        return { outcome, asset };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { outcome, asset } = r.value;
        if (outcome === "tagged") {
          tagged++;
        } else if (outcome === "skipped") {
          skipped++;
          skipSamples.push({
            at: new Date().toISOString(),
            asset_id: asset.id as string,
            filename: (asset.filename as string) || "(unknown)",
            relative_path: (asset.relative_path as string) || "(unknown)",
            reason: "Already tagged",
          });
        } else {
          failed++;
          failureSamples.push({
            at: new Date().toISOString(),
            asset_id: asset.id as string,
            filename: (asset.filename as string) || "(unknown)",
            relative_path: (asset.relative_path as string) || "(unknown)",
            error: "Gemini call failed — see worker logs",
          });
        }
      } else {
        failed++;
        failureSamples.push({
          at: new Date().toISOString(),
          asset_id: "(unknown)",
          filename: "(unknown)",
          relative_path: "(unknown)",
          error: (r.reason instanceof Error ? r.reason.message : String(r.reason || "Unknown error")).slice(0, 500),
        });
      }
    }
  }

  const done = assets.length < BATCH_SIZE;
  return {
    ok: true,
    done,
    tagged,
    skipped,
    failed,
    failure_samples: failureSamples.slice(-200),
    skip_samples: skipSamples.slice(-200),
    nextOffset: cursor + assets.length,
  };
}
