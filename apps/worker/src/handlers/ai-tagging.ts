/**
 * AI Tagging handler — persistent worker version.
 *
 * All AI calls go through OpenRouter (OpenAI-compatible API) so the model
 * is selectable from the admin panel without code changes.
 *
 * The model is read from admin_config.AI_TASK_MODELS.vision_tagging
 * (default: "google/gemini-2.0-flash-001").
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";
import {
  buildImageTaggingMessages,
  buildImageTaggingPrompt,
  callTagAssetModel,
  fetchImageData,
  getAiTaggingApiKey,
  isStyleGuideSourcePdf,
} from "./ai-tagging-shared.js";

const AI_TIMEOUT_MS = 60_000;
const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Convert raw AI/DB error strings into human-readable messages. */
function humanizeError(raw: string): string {
  // Alibaba Cloud / Qwen content inspection failures
  if (raw.includes("data_inspection_failed") || raw.includes("inappropriate content"))
    return "Image rejected by provider content filter (Alibaba/Qwen) — try a different model for this asset";
  if (raw.includes("Unable to download the media resource") || raw.includes("DataInspection") || raw.includes("data_inspection"))
    return "Provider could not process image during content inspection (Alibaba/Qwen) — try a different model";
  if (raw.includes("Failed to download multimodal content"))
    return "Provider failed to fetch image for multimodal processing — try a different model";
  // Raw HTML from a gateway error — strip it
  if (raw.trimStart().startsWith("<!") || raw.trimStart().startsWith("<html"))
    return "Supabase returned a gateway error (502/503) — transient, will retry";
  return raw;
}

// ── Read model assignment from admin_config ─────────────────────────────────

let cachedModels: { primary: string; fallback: string | null } | null = null;
let cacheExpiresAt = 0;

async function getVisionModels(): Promise<{ primary: string; fallback: string | null }> {
  if (cachedModels && Date.now() < cacheExpiresAt) return cachedModels;
  const client = db();
  const { data } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "AI_TASK_MODELS")
    .maybeSingle();
  const models = data?.value as Record<string, string> | null;
  cachedModels = {
    primary: models?.vision_tagging || DEFAULT_VISION_MODEL,
    fallback: models?.vision_tagging_fallback || null,
  };
  cacheExpiresAt = Date.now() + 60_000; // cache 1 min
  return cachedModels;
}

/** Returns true if the error is specific to the model/provider (not a transient infra failure). */
function isModelSpecificError(msg: string): boolean {
  return (
    msg.includes("data_inspection_failed") ||
    msg.includes("DataInspection") ||
    msg.includes("data_inspection") ||
    msg.includes("inappropriate content") ||
    msg.includes("Unable to download the media resource") ||
    msg.includes("Failed to download multimodal content") ||
    msg.includes("No endpoints found")
  );
}

// ── Single-asset tagging via OpenRouter ──────────────────────────────────────

type TagOutcome = { outcome: "tagged" | "skipped" | "failed"; error?: string };

async function tagSingleAsset(assetId: string, force: boolean): Promise<TagOutcome> {
  const client = db();
  const apiKey = getAiTaggingApiKey();

  if (!apiKey) {
    logger.error("No AI API key configured (OPENROUTER_API_KEY or GOOGLE_AI_API_KEY)");
    return { outcome: "failed", error: "No AI API key configured (set OPENROUTER_API_KEY in Railway)" };
  }

  // Fetch asset
  const { data: asset, error: fetchErr } = await client
    .from("assets")
    .select("id, filename, relative_path, file_type, tags, licensor_id, property_id, thumbnail_url, status, ai_tagged_at, sku, style_group_id")
    .eq("id", assetId)
    .single();

  if (fetchErr || !asset) {
    logger.warn("ai-tag: asset not found", { assetId });
    return { outcome: "failed", error: `Asset not found: ${fetchErr?.message ?? "no data"}` };
  }

  // Skip if already tagged (unless force)
  if (asset.status === "tagged" && asset.ai_tagged_at && !force) {
    return { outcome: "skipped" };
  }

  const thumbnailUrl = asset.thumbnail_url;
  if (!thumbnailUrl) {
    logger.warn("ai-tag: no thumbnail_url", { assetId });
    return { outcome: "failed", error: "No thumbnail URL" };
  }

  const systemPrompt = await buildImageTaggingPrompt(asset);
  let image: { base64: string; mimeType: string };
  try {
    image = await fetchImageData(thumbnailUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn("ai-tag: thumbnail fetch error", { assetId, error: msg });
    if (msg.includes("Thumbnail fetch HTTP 403") || msg.includes("Thumbnail fetch HTTP 404")) {
      const status = msg.match(/HTTP (\d+)/)?.[1] ?? "unknown";
      await client.from("assets").update({ thumbnail_error: `Thumbnail not found in storage (HTTP ${status})` }).eq("id", assetId);
      return { outcome: "skipped" };
    }
    return { outcome: "failed", error: `Thumbnail fetch error: ${msg.slice(0, 200)}` };
  }

  // Get model from admin_config (cached for 1 min)
  const { primary: primaryModel, fallback: fallbackModel } = await getVisionModels();

  type AttemptResult = TagOutcome & { _rawMsg?: string };
  const attemptTag = async (model: string): Promise<AttemptResult> => {
    // Call via OpenRouter
    try {
      const messages = buildImageTaggingMessages(
        systemPrompt,
        image,
        "Analyze this design asset image and return structured tags matching the tag_asset schema.",
      );
      const { tagData, outputMode } = await callTagAssetModel(apiKey, model, messages, AI_TIMEOUT_MS, 1500);
      logger.info("ai-tag: received structured tags", { assetId, model, outputMode });

      const updates: Record<string, unknown> = {
        status: "tagged",
        ai_tagged_at: new Date().toISOString(),
        ai_model: model,
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
        return { outcome: "failed", error: `DB write failed: ${humanizeError(updateErr.message ?? "").slice(0, 300)}` };
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

      // Upsert files_used entries to sku_files_used (licensed products only).
      // Style Guide Sources may ONLY come from a licensing-sheet / tech-pack PDF.
      // The DB parser and edge ai-tag path enforce the same rule; keep the
      // persistent worker aligned because Railway runs the batch tagger.
      if (
        isStyleGuideSourcePdf(asset) && asset.sku &&
        Array.isArray(tagData.files_used) && (tagData.files_used as string[]).length > 0
      ) {
        const rows = (tagData.files_used as string[])
          .filter((f) => typeof f === "string" && f.trim().length > 0)
          .map((f) => ({ sku: asset.sku as string, file_name: f.trim(), source: "ai_tag" }));
        if (rows.length > 0) {
          await client.from("sku_files_used").upsert(rows, { onConflict: "sku,file_name", ignoreDuplicates: true });
        }
      }

      return { outcome: "tagged" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("ai-tag: AI call error", { assetId, model, error: msg });
      return { outcome: "failed", error: `AI call error: ${humanizeError(msg).slice(0, 300)}`, _rawMsg: msg };
    }
  };

  const primaryResult = await attemptTag(primaryModel);
  if (primaryResult.outcome === "tagged") return primaryResult;

  // If the primary model failed with a model-specific error and a fallback is configured, retry once
  const rawMsg = primaryResult._rawMsg ?? primaryResult.error ?? "";
  if (fallbackModel && isModelSpecificError(rawMsg)) {
    logger.info("ai-tag: primary model failed with model-specific error — trying fallback", { assetId, primaryModel, fallbackModel, error: rawMsg.slice(0, 200) });
    const fallbackResult = await attemptTag(fallbackModel);
    if (fallbackResult.outcome === "tagged") return fallbackResult;
    // Both failed — return the primary error (more informative) with a note
    const fallbackErr = fallbackResult.error ?? "fallback also failed";
    return { outcome: "failed", error: `${primaryResult.error} (fallback ${fallbackModel}: ${fallbackErr})`.slice(0, 400) };
  }

  return primaryResult;
}

// ── Batch handler (called from operation-loop) ───────────────────────────────

export async function handleBulkAiTag(opState: OpState, tagAll: boolean): Promise<BatchResult> {
  const client = db();
  const BATCH_SIZE = config.aiBatchSize;
  const CONCURRENCY = config.aiBatchConcurrency;

  const cursor = typeof opState.cursor === "number" ? opState.cursor : 0;
  const groupIds = Array.isArray(opState.params?.group_ids) ? opState.params.group_ids as string[] : null;
  const assetIds = Array.isArray(opState.params?.asset_ids) ? opState.params.asset_ids as string[] : null;

  // Fast path: tag specific assets by ID (used for single-asset re-tag from UI)
  if (assetIds && assetIds.length > 0) {
    let tagged = 0, skipped = 0, failed = 0;
    const failureSamples: Array<{ at: string; asset_id: string; filename: string; relative_path: string; error: string }> = [];

    for (let i = 0; i < assetIds.length; i += CONCURRENCY) {
      const chunk = assetIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (id) => {
          const result = await tagSingleAsset(id, tagAll);
          return { ...result, asset_id: id };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value.outcome === "tagged") tagged++;
          else if (r.value.outcome === "skipped") skipped++;
          else { failed++; failureSamples.push({ at: new Date().toISOString(), asset_id: r.value.asset_id, filename: "", relative_path: "", error: r.value.error ?? "AI call failed" }); }
        } else {
          failed++;
          failureSamples.push({ at: new Date().toISOString(), asset_id: "(unknown)", filename: "", relative_path: "", error: String(r.reason).slice(0, 500) });
        }
      }
    }

    return { ok: true, done: true, tagged, skipped, failed, failure_samples: failureSamples, skip_samples: [], nextOffset: cursor };
  }

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
        const result = await tagSingleAsset(asset.id as string, tagAll);
        return { ...result, asset };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const { outcome, error: tagError, asset } = r.value;
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
            error: tagError ?? "AI call failed",
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

  // Emit total_count on the first batch so the UI can show progress bar / ETA
  // even when the op was auto-resumed from an old state that had total=0.
  let totalCount: number | undefined;
  if (cursor === 0 || !(opState.progress?.total)) {
    const countQuery = client
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("is_deleted", false)
      .not("thumbnail_url", "is", null)
      .not("primary_sort_tier", "in", "(4,8)");
    if (!tagAll && !groupIds) {
      countQuery.neq("status", "tagged");
    }
    const { count } = await countQuery;
    if (count !== null) totalCount = count;
  }

  return {
    ok: true,
    done,
    tagged,
    skipped,
    failed,
    failure_samples: failureSamples.slice(-200),
    skip_samples: skipSamples.slice(-200),
    nextOffset: cursor + assets.length,
    ...(totalCount !== undefined ? { total_count: totalCount } : {}),
  };
}
