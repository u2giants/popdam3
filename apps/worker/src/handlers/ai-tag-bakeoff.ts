/**
 * AI tag model bake-off handler.
 *
 * Runs configured vision models against the same assets and stores their
 * outputs in shadow tables. This never writes production asset tags.
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { chatCompletion, imageContent, tool, type ChatMessage } from "../openrouter.js";
import type { BatchResult, OpState } from "../types.js";

const THUMBNAIL_FETCH_TIMEOUT_MS = 20_000;
const AI_TIMEOUT_MS = 60_000;
const ASSETS_PER_BATCH = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAG_ASSET_TOOL = tool(
  "tag_asset",
  "Return structured tagging data for this design asset.",
  {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
      ai_description: { type: "string" },
      character_ids: { type: "array", items: { type: "string" } },
      property_id: { type: "string" },
    },
    required: ["tags", "ai_description"],
  },
);

const SLOTS = ["a", "b", "c", "d", "e"] as const;
type Slot = typeof SLOTS[number];

type BakeoffRun = {
  id: string;
  model_a: string;
  model_b: string;
  model_c: string;
  model_d: string | null;
  model_e: string | null;
  asset_ids: string[];
};

type BakeoffAsset = {
  id: string;
  filename: string | null;
  relative_path: string | null;
  file_type: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  licensor_id: string | null;
  property_id: string | null;
  sku: string | null;
};

function validUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 30);
}

type ModelPricing = {
  prompt: number | null;
  completion: number | null;
};

let pricingCache: { fetchedAt: number; prices: Map<string, ModelPricing> } | null = null;

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

async function getOpenRouterPrices(apiKey: string): Promise<Map<string, ModelPricing>> {
  const now = Date.now();
  if (pricingCache && now - pricingCache.fetchedAt < 10 * 60 * 1000) return pricingCache.prices;

  const resp = await fetch("https://openrouter.ai/api/v1/models/user", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`OpenRouter model pricing HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

  const payload = await resp.json() as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const items = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
  const prices = new Map<string, ModelPricing>();
  for (const item of items) {
    const id = typeof item.id === "string" ? item.id : null;
    const pricing = item.pricing as Record<string, unknown> | undefined;
    if (!id || !pricing) continue;
    prices.set(id, {
      prompt: parsePrice(pricing.prompt),
      completion: parsePrice(pricing.completion),
    });
  }

  pricingCache = { fetchedAt: now, prices };
  return prices;
}

function computeCostUsd(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, pricing: ModelPricing | undefined): number | null {
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
  if (!pricing || typeof promptTokens !== "number" || typeof completionTokens !== "number") return null;
  if (pricing.prompt === null || pricing.completion === null) return null;
  return (promptTokens * pricing.prompt) + (completionTokens * pricing.completion);
}

async function fetchImageData(thumbnailUrl: string): Promise<{ base64: string; mimeType: string }> {
  const resp = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(THUMBNAIL_FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Thumbnail fetch HTTP ${resp.status}`);
  const mimeType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const bytes = Buffer.from(await resp.arrayBuffer());
  return { base64: bytes.toString("base64"), mimeType };
}

async function buildPrompt(asset: BakeoffAsset): Promise<string> {
  const client = db();
  const [licensorsRes, propertiesRes] = await Promise.all([
    client.from("licensors").select("id, name").limit(50),
    client.from("properties").select("id, name, licensor_id").limit(200),
  ]);

  let characters: { id: string; name: string }[] = [];
  if (asset.property_id) {
    const { data } = await client
      .from("characters")
      .select("id, name")
      .eq("property_id", asset.property_id)
      .eq("is_priority", true)
      .order("usage_count", { ascending: false })
      .limit(200);
    characters = data ?? [];
  } else if (asset.licensor_id) {
    const { data: propIds } = await client
      .from("properties")
      .select("id")
      .eq("licensor_id", asset.licensor_id);
    const ids = (propIds ?? []).map((p: { id: string }) => p.id);
    if (ids.length > 0) {
      const { data } = await client
        .from("characters")
        .select("id, name")
        .in("property_id", ids)
        .eq("is_priority", true)
        .order("usage_count", { ascending: false })
        .limit(200);
      characters = data ?? [];
    }
  } else {
    const { data } = await client
      .from("characters")
      .select("id, name")
      .eq("is_priority", true)
      .order("usage_count", { ascending: false })
      .limit(150);
    characters = data ?? [];
  }

  const taxonomyContext = [
    `Licensors: ${(licensorsRes.data ?? []).map((l) => `${l.name} (${l.id})`).join(", ")}`,
    `Properties: ${(propertiesRes.data ?? []).map((p) => `${p.name} (${p.id})`).join(", ")}`,
    `Priority characters: ${characters.map((c) => `${c.name} (${c.id})`).join(", ")}`,
  ].join("\n");

  return `You are a design asset tagger for a consumer products company that licenses characters.

Analyze the thumbnail image and file metadata. Return structured data only through the tag_asset function.

File: ${asset.filename ?? ""}
Path: ${asset.relative_path ?? ""}
Type: ${asset.file_type ?? ""}
Existing tags: ${(asset.tags ?? []).join(", ") || "none"}

Known taxonomy:
${taxonomyContext}

Evaluate only these fields for this model comparison:
1. tags: useful searchable tags, including characters, colors, themes, art style, product clues
2. ai_description: one concise sentence describing the asset
3. character_ids: matching UUIDs from the provided character list
4. property_id: matching UUID from the provided property list

Do not invent UUIDs. If a character or property is uncertain, omit it.`;
}

async function resolveNames(characterIds: string[], propertyId: string | null): Promise<{ characterNames: string[]; propertyName: string | null }> {
  const client = db();
  const [charsRes, propRes] = await Promise.all([
    characterIds.length > 0
      ? client.from("characters").select("id, name").in("id", characterIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    propertyId
      ? client.from("properties").select("name").eq("id", propertyId).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  return {
    characterNames: (charsRes.data ?? []).map((c: { name: string }) => c.name),
    propertyName: propRes.data?.name ?? null,
  };
}

async function runModel(runId: string, asset: BakeoffAsset, slot: Slot, modelId: string, prompt: string, image: { base64: string; mimeType: string }, pricing: ModelPricing | undefined) {
  const client = db();
  await client.from("ai_tag_bakeoff_results").upsert({
    run_id: runId,
    asset_id: asset.id,
    model_slot: slot,
    model_id: modelId,
    status: "running",
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    cost_usd: null,
    pricing_snapshot: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "run_id,asset_id,model_slot" });

  const started = Date.now();
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          imageContent(image.base64, image.mimeType),
          { type: "text", text: "Tag this asset for the model comparison." },
        ],
      },
    ];
    const result = await chatCompletion(config.openRouterApiKey || config.googleAiApiKey, {
      model: modelId,
      messages,
      tools: [TAG_ASSET_TOOL],
      tool_choice: "required",
      max_tokens: 900,
    }, AI_TIMEOUT_MS);

    const output = result.toolCalls?.[0]?.arguments;
    if (!output) throw new Error("Model returned no structured tag data");

    const tags = normalizeTags(output.tags);
    const characterIds = Array.isArray(output.character_ids)
      ? (output.character_ids as unknown[]).filter(validUuid)
      : [];
    const propertyId = validUuid(output.property_id) ? output.property_id : null;
    const { characterNames, propertyName } = await resolveNames(characterIds, propertyId);
    const costUsd = computeCostUsd(result.usage, pricing);

    await client.from("ai_tag_bakeoff_results").upsert({
      run_id: runId,
      asset_id: asset.id,
      model_slot: slot,
      model_id: modelId,
      status: "succeeded",
      tags,
      ai_description: typeof output.ai_description === "string" ? output.ai_description : null,
      character_ids: characterIds,
      character_names: characterNames,
      property_id: propertyId,
      property_name: propertyName,
      raw_output: output,
      latency_ms: Date.now() - started,
      prompt_tokens: result.usage?.prompt_tokens ?? null,
      completion_tokens: result.usage?.completion_tokens ?? null,
      total_tokens: result.usage?.total_tokens ?? null,
      cost_usd: costUsd,
      pricing_snapshot: pricing ? {
        source: "openrouter.models.user",
        fetched_at: pricingCache ? new Date(pricingCache.fetchedAt).toISOString() : new Date().toISOString(),
        prompt_per_token: pricing.prompt,
        completion_per_token: pricing.completion,
      } : null,
      error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "run_id,asset_id,model_slot" });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn("ai-tag-bakeoff: model failed", { runId, assetId: asset.id, slot, modelId, error: msg });
    await client.from("ai_tag_bakeoff_results").upsert({
      run_id: runId,
      asset_id: asset.id,
      model_slot: slot,
      model_id: modelId,
      status: "failed",
      latency_ms: Date.now() - started,
      pricing_snapshot: pricing ? {
        source: "openrouter.models.user",
        fetched_at: pricingCache ? new Date(pricingCache.fetchedAt).toISOString() : new Date().toISOString(),
        prompt_per_token: pricing.prompt,
        completion_per_token: pricing.completion,
      } : null,
      error_message: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    }, { onConflict: "run_id,asset_id,model_slot" });
    return { ok: false, error: msg };
  }
}

export async function handleAiTagBakeoff(opState: OpState): Promise<BatchResult> {
  const client = db();
  const runId = typeof opState.params?.run_id === "string" ? opState.params.run_id : null;
  if (!runId) return { ok: false, done: false, error: "run_id param is required" };
  if (!(config.openRouterApiKey || config.googleAiApiKey)) return { ok: false, done: false, error: "No AI API key configured" };

  const { data: run, error: runErr } = await client
    .from("ai_tag_bakeoff_runs")
    .select("id, model_a, model_b, model_c, model_d, model_e, asset_ids")
    .eq("id", runId)
    .single();
  if (runErr || !run) return { ok: false, done: false, error: runErr?.message ?? "Bake-off run not found" };

  const typedRun = run as BakeoffRun;
  const cursor = typeof opState.cursor === "number" ? opState.cursor : 0;
  const assetIds = typedRun.asset_ids ?? [];
  const batchIds = assetIds.slice(cursor, cursor + ASSETS_PER_BATCH);

  if (cursor === 0) {
    await client.from("ai_tag_bakeoff_runs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", runId);
  }

  if (batchIds.length === 0) {
    await client.from("ai_tag_bakeoff_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    const modelCount = [typedRun.model_a, typedRun.model_b, typedRun.model_c, typedRun.model_d, typedRun.model_e].filter(Boolean).length;
    return { ok: true, done: true, total_count: assetIds.length * modelCount, evaluated: 0, failed: 0, nextOffset: cursor };
  }

  const { data: assets, error: assetErr } = await client
    .from("assets")
    .select("id, filename, relative_path, file_type, tags, thumbnail_url, licensor_id, property_id, sku")
    .in("id", batchIds);
  if (assetErr) return { ok: false, done: false, error: assetErr.message };

  let evaluated = 0;
  let failed = 0;
  const failureSamples: Array<{ at: string; asset_id: string; filename: string; relative_path: string; error: string }> = [];
  const runModels = [typedRun.model_a, typedRun.model_b, typedRun.model_c, typedRun.model_d, typedRun.model_e];
  const models: Array<[Slot, string]> = SLOTS
    .map((slot, index): [Slot, string | null] => [slot, runModels[index] ?? null])
    .filter((entry): entry is [Slot, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  let prices = new Map<string, ModelPricing>();
  if (config.openRouterApiKey) {
    try {
      prices = await getOpenRouterPrices(config.openRouterApiKey);
    } catch (e) {
      logger.warn("ai-tag-bakeoff: failed to fetch current OpenRouter pricing", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const asset of (assets ?? []) as BakeoffAsset[]) {
    if (!asset.thumbnail_url) {
      failed += models.length;
      failureSamples.push({ at: new Date().toISOString(), asset_id: asset.id, filename: asset.filename ?? "", relative_path: asset.relative_path ?? "", error: "No thumbnail URL" });
      continue;
    }
    try {
      const [prompt, image] = await Promise.all([buildPrompt(asset), fetchImageData(asset.thumbnail_url)]);
      for (const [slot, modelId] of models) {
        const result = await runModel(runId, asset, slot, modelId, prompt, image, prices.get(modelId));
        if (result.ok) evaluated++;
        else {
          failed++;
          failureSamples.push({ at: new Date().toISOString(), asset_id: asset.id, filename: asset.filename ?? "", relative_path: asset.relative_path ?? "", error: result.error?.slice(0, 500) ?? "AI call failed" });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed += models.length;
      failureSamples.push({ at: new Date().toISOString(), asset_id: asset.id, filename: asset.filename ?? "", relative_path: asset.relative_path ?? "", error: msg.slice(0, 500) });
    }
  }

  const nextOffset = cursor + batchIds.length;
  const done = nextOffset >= assetIds.length;
  if (done) {
    await client.from("ai_tag_bakeoff_runs").update({
      status: failed > 0 && evaluated === 0 ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return {
    ok: true,
    done,
    evaluated,
    failed,
    failure_samples: failureSamples.slice(-50),
    total_count: assetIds.length * models.length,
    nextOffset,
  };
}
