/**
 * AI Tagging handler — persistent worker version.
 *
 * All AI calls go through OpenRouter (OpenAI-compatible API) so the model
 * is selectable from the admin panel without code changes.
 *
 * The live model is read from admin_config.AI_TASK_MODELS.vision_tagging
 * (production primary: "qwen/qwen3-vl-32b-instruct", fallback:
 * "minimax/minimax-m3"). DEFAULT_VISION_MODEL below is only a hardcoded
 * last-resort used if that config row is missing — it is NOT the configured
 * default.
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { buildProviderPin } from "../openrouter.js";
import type { BatchResult, OpState } from "../types.js";
import { AiTagCursorError, decodeAiTagCursor, encodeAiTagCursor } from "../ai-tag-cursor.js";
import { getAiRetryPageSize } from "../operation-retry.js";
import {
  buildImageTaggingMessages,
  buildImageTaggingPrompt,
  callTagAssetModel,
  fetchImageData,
  getAiTaggingApiKey,
  isStyleGuideSourcePdf,
} from "./ai-tagging-shared.js";

const AI_TIMEOUT_MS = 60_000;
// Last-resort fallback only, used if admin_config.AI_TASK_MODELS is missing.
// Kept in sync with the live production primary (see getVisionModels()).
const DEFAULT_VISION_MODEL = "qwen/qwen3-vl-32b-instruct";
const SAME_MODEL_STRUCTURED_RETRY_COUNT = 1;
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

let cachedModels: { primary: string; fallback: string | null; providerPin: string | null } | null = null;
let cacheExpiresAt = 0;

async function getVisionModels(): Promise<{ primary: string; fallback: string | null; providerPin: string | null }> {
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
    // Optional: pin routing to specific OpenRouter provider slug(s), comma-separated
    // (e.g. "anthropic" or "anthropic,amazon-bedrock"). When set, fallbacks are
    // disabled so a flaky endpoint hard-fails instead of silently rerouting.
    providerPin: models?.vision_tagging_provider || null,
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

function isRetryableStructuredOutputError(msg: string): boolean {
  const lower = msg.toLowerCase();
  if (
    lower.includes("data_inspection_failed") ||
    lower.includes("datainspection") ||
    lower.includes("inappropriate content")
  ) {
    return false;
  }

  return (
    lower.includes("structured tag output failed") &&
    (
      lower.includes("no endpoints found") ||
      lower.includes("tool use") ||
      lower.includes("tool_call") ||
      lower.includes("no parsable json") ||
      lower.includes("malformed tool call json") ||
      lower.includes("openrouter 404")
    )
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Single-asset tagging via OpenRouter ──────────────────────────────────────

type TagOutcome = { outcome: "tagged" | "skipped" | "failed"; error?: string };

export interface AiTagRpcClient {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: null | { message: string; code?: string } }>;
}

interface AiTagHandlerDependencies {
  client?: AiTagRpcClient;
  tagAsset?: (assetId: string, force: boolean) => Promise<TagOutcome>;
  batchSize?: number;
  concurrency?: number;
}

async function tagSingleAsset(assetId: string, force: boolean): Promise<TagOutcome> {
  const client = db();
  const apiKey = getAiTaggingApiKey();

  if (!apiKey) {
    logger.error("No AI API key configured (OPENROUTER_API_KEY)");
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
  const { primary: primaryModel, fallback: fallbackModel, providerPin } = await getVisionModels();
  const providerOverride = buildProviderPin(providerPin);

  type AttemptResult = TagOutcome & { _rawMsg?: string };
  const attemptTag = async (model: string): Promise<AttemptResult> => {
    for (let sameModelRetry = 0; sameModelRetry <= SAME_MODEL_STRUCTURED_RETRY_COUNT; sameModelRetry++) {
      // Call via OpenRouter
      try {
        const messages = buildImageTaggingMessages(
          systemPrompt,
          image,
          "Analyze this design asset image and return structured tags matching the tag_asset schema.",
        );
        const { tagData, outputMode, providerInfo, retryCount, attempts } = await callTagAssetModel(apiKey, model, messages, AI_TIMEOUT_MS, 4000, providerOverride);
        logger.info("ai-tag: received structured tags", { assetId, model, outputMode, providerInfo, retryCount, sameModelRetry });
        if (attempts.length > 1) logger.warn("ai-tag: model needed structured-output fallback", { assetId, model, attempts });

        const updates: Record<string, unknown> = {
          status: "tagged",
          ai_tagged_at: new Date().toISOString(),
          ai_model: model,
        };
        if (tagData.ai_description) updates.ai_description = tagData.ai_description;
        if (tagData.cover_description) updates.cover_description = tagData.cover_description;
        if (tagData.scene_description) updates.scene_description = tagData.scene_description;
        if (tagData.asset_type) updates.asset_type = tagData.asset_type;
        if (tagData.content_type) updates.content_type = tagData.content_type;
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
        if (sameModelRetry < SAME_MODEL_STRUCTURED_RETRY_COUNT && isRetryableStructuredOutputError(msg)) {
          logger.warn("ai-tag: structured output/routing error, retrying same model", {
            assetId,
            model,
            sameModelRetry: sameModelRetry + 1,
            error: msg.slice(0, 300),
          });
          await sleep(1500 * (sameModelRetry + 1));
          continue;
        }
        logger.warn("ai-tag: AI call error", { assetId, model, error: msg });
        return { outcome: "failed", error: `AI call error: ${humanizeError(msg).slice(0, 300)}`, _rawMsg: msg };
      }
    }

    return { outcome: "failed", error: "AI call error: same-model structured output retry exhausted" };
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

export async function handleBulkAiTag(
  opState: OpState,
  tagAll: boolean,
  dependencies: AiTagHandlerDependencies = {},
): Promise<BatchResult> {
  const client = (dependencies.client ?? db()) as AiTagRpcClient;
  const configuredBatchSize = dependencies.batchSize ?? config.aiBatchSize;
  const BATCH_SIZE = Math.max(10, Math.min(configuredBatchSize, opState.retry_page_size ?? configuredBatchSize));
  const CONCURRENCY = dependencies.concurrency ?? config.aiBatchConcurrency;
  const tagAsset = dependencies.tagAsset ?? tagSingleAsset;

  const rawCursor = opState.cursor;
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
          const result = await tagAsset(id, tagAll);
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

    return { ok: true, done: true, tagged, skipped, failed, failure_samples: failureSamples, skip_samples: [], nextOffset: rawCursor ?? 0, last_stage: "tag_write" };
  }

  let cursor;
  try {
    cursor = decodeAiTagCursor(rawCursor);
  } catch (error) {
    const cursorError = error instanceof AiTagCursorError ? error : null;
    return {
      ok: false,
      done: false,
      error: cursorError?.message ?? "Invalid AI tagging cursor",
      error_code: cursorError?.code ?? "invalid_cursor",
      error_stage: "candidate_fetch",
      last_stage_started_at: new Date().toISOString(),
    };
  }

  const stageStartedAt = new Date().toISOString();
  const fetchStarted = Date.now();
  const { data, error: fetchErr } = await client.rpc("get_ai_tag_candidates", {
    p_mode: tagAll ? "all" : "untagged",
    p_limit: BATCH_SIZE,
    p_after_tier: cursor?.tier ?? null,
    p_after_id: cursor?.id ?? null,
    p_group_ids: groupIds && groupIds.length > 0 ? groupIds : null,
  });
  const fetchElapsedMs = Date.now() - fetchStarted;

  if (fetchErr) {
    const isStatementTimeout = fetchErr.code === "57014" || fetchErr.message.toLowerCase().includes("statement timeout");
    logger.error("ai-tag: candidate fetch failed", {
      stage: "candidate_fetch",
      elapsed_ms: fetchElapsedMs,
      page_size: BATCH_SIZE,
      cursor_version: cursor ? "ai1" : "start",
      postgres_code: fetchErr.code,
      error: fetchErr.message,
    });
    return {
      ok: false,
      done: false,
      error: fetchErr.message,
      error_code: isStatementTimeout ? "statement_timeout" : fetchErr.code,
      postgres_code: fetchErr.code,
      error_stage: "candidate_fetch",
      last_stage_started_at: stageStartedAt,
      elapsed_ms: fetchElapsedMs,
      retry_page_size: isStatementTimeout
        ? getAiRetryPageSize(configuredBatchSize, opState.auto_resume_attempts ?? 0)
        : BATCH_SIZE,
    };
  }

  type Candidate = {
    id: string;
    thumbnail_url: string;
    filename: string;
    relative_path: string;
    style_group_id: string | null;
    primary_sort_tier: number;
  };
  const assets = (data ?? []) as Candidate[];

  logger.info("ai-tag: candidate page fetched", {
    stage: "candidate_fetch",
    elapsed_ms: fetchElapsedMs,
    rows: assets.length,
    page_size: BATCH_SIZE,
    cursor_version: cursor ? "ai1" : "start",
  });

  if (!assets || assets.length === 0) {
    return {
      ok: true,
      done: true,
      tagged: 0,
      skipped: 0,
      failed: 0,
      failure_samples: [],
      skip_samples: [],
      nextOffset: rawCursor ?? 0,
      last_stage: "candidate_fetch",
      last_stage_started_at: stageStartedAt,
      elapsed_ms: fetchElapsedMs,
    };
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
        const result = await tagAsset(asset.id as string, tagAll);
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

  const finalCandidate = assets[assets.length - 1];
  const nextCursor = encodeAiTagCursor({
    tier: finalCandidate.primary_sort_tier,
    id: finalCandidate.id,
  });

  return {
    ok: true,
    // Confirm completion with an empty page so concurrent inserts cannot make a
    // short page terminate the run early.
    done: false,
    tagged,
    skipped,
    failed,
    failure_samples: failureSamples.slice(-200),
    skip_samples: skipSamples.slice(-200),
    nextOffset: nextCursor,
    last_stage: "tag_write",
    last_stage_started_at: stageStartedAt,
    elapsed_ms: fetchElapsedMs,
  };
}
