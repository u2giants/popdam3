/**
 * ERP enrichment & classification handlers — persistent worker version.
 *
 * Classification calls go through OpenRouter so the model is admin-selectable.
 * Model is read from admin_config.AI_TASK_MODELS.text_classification
 * (default: "anthropic/claude-3.5-haiku").
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { chatCompletion, tool, type ChatMessage } from "../openrouter.js";
import type { BatchResult, OpState } from "../types.js";

const DEFAULT_CLASSIFICATION_MODEL = "anthropic/claude-3.5-haiku";
let cachedClassModel: string | null = null;
let classCacheExpires = 0;

async function getClassificationModel(): Promise<string> {
  if (cachedClassModel && Date.now() < classCacheExpires) return cachedClassModel;
  const client = db();
  const { data } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "AI_TASK_MODELS")
    .maybeSingle();
  const models = data?.value as Record<string, string> | null;
  cachedClassModel = models?.text_classification || DEFAULT_CLASSIFICATION_MODEL;
  classCacheExpires = Date.now() + 60_000;
  return cachedClassModel;
}

// ── ERP Enrichment ───────────────────────────────────────────────────────────

/** Derive a short card label from an ERP item_description.
 *  "Lapdesk_Solid Blue_23.5x10" x15.5"" → "Lapdesk Solid Blue"
 */
function deriveErpCoverDescription(itemDescription: string | null): string | null {
  if (!itemDescription?.trim()) return null;
  let s = itemDescription.replace(/_/g, " ");
  // Strip dimension patterns: 23.5x10" x15.5", 10x15, etc.
  s = s.replace(/\b\d+\.?\d*["″]?\s*[xX×]\s*\d+\.?\d*["″]?(?:\s*[xX×]\s*\d+\.?\d*["″]?)*/g, "");
  s = s.replace(/\s+/g, " ").replace(/^[\s\-_,"″]+|[\s\-_,"″]+$/g, "").trim();
  return s || null;
}

export async function handleApplyErpEnrichment(opState: OpState): Promise<BatchResult> {
  const client = db();
  const mode = (opState.params?.mode as string) || "apply";
  const batchSize = 100;
  const offset = typeof opState.cursor === "number" ? opState.cursor : 0;
  const runId = typeof opState.run_id === "string" && opState.run_id.length > 0
    ? opState.run_id
    : crypto.randomUUID();

  const { data: erpItems, error: erpErr } = await client
    .from("erp_items_current")
    .select("id, external_id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code, division_code")
    .not("style_number", "is", null)
    .neq("style_number", "")
    .order("external_id")
    .range(offset, offset + batchSize - 1);

  if (erpErr) return { ok: false, done: false, error: erpErr.message };
  if (!erpItems || erpItems.length === 0) {
    return { ok: true, done: true, updated: 0, assets_updated: 0, groups_updated: 0, total: offset };
  }

  let assetsUpdated = 0;
  let groupsUpdated = 0;

  for (const erpItem of erpItems) {
    if (!erpItem.style_number) continue;

    const updates: Record<string, unknown> = {};
    let productCategory: string | null = null;
    let classificationSource = "erp";
    let confidence: number | null = null;

    if (!erpItem.mg_category) {
      const { data: predictionRow } = await client
        .from("product_category_predictions")
        .select("predicted_category, confidence, classification_source, status")
        .eq("erp_item_id", erpItem.id)
        .maybeSingle();

      if (predictionRow && ["approved", "auto_applied"].includes(predictionRow.status)) {
        productCategory = predictionRow.predicted_category;
        classificationSource = predictionRow.classification_source || "ai";
        confidence = predictionRow.confidence ?? null;
      }
    } else {
      productCategory = erpItem.mg_category;
      classificationSource = "erp";
      confidence = 1;
    }

    if (erpItem.mg01_code) updates.mg01_code = erpItem.mg01_code;
    if (erpItem.mg02_code) updates.mg02_code = erpItem.mg02_code;
    if (erpItem.mg03_code) updates.mg03_code = erpItem.mg03_code;
    if (erpItem.size_code) updates.size_code = erpItem.size_code;
    if (erpItem.licensor_code) updates.licensor_code = erpItem.licensor_code;
    if (erpItem.property_code) updates.property_code = erpItem.property_code;
    if (erpItem.division_code) updates.division_code = erpItem.division_code;
    if (productCategory) updates.product_category = productCategory;

    const coverDesc = deriveErpCoverDescription(erpItem.item_description ?? null);
    if (coverDesc) updates.cover_description = coverDesc;

    if (Object.keys(updates).length === 0) continue;

    if (mode !== "dry-run") {
      const updateFields = Object.keys(updates);

      const [{ data: currentAssets }, { data: currentGroups }] = await Promise.all([
        client
          .from("assets")
          .select(`id, ${updateFields.join(", ")}`)
          .eq("sku", erpItem.style_number)
          .eq("is_deleted", false)
          .limit(1),
        client
          .from("style_groups")
          .select(`id, ${updateFields.join(", ")}`)
          .eq("sku", erpItem.style_number)
          .limit(1),
      ]);

      const { data: assetRows } = await client
        .from("assets")
        .update(updates)
        .eq("sku", erpItem.style_number)
        .eq("is_deleted", false)
        .select("id");
      assetsUpdated += assetRows?.length ?? 0;

      const { data: groupRows } = await client
        .from("style_groups")
        .update(updates)
        .eq("sku", erpItem.style_number)
        .select("id");
      groupsUpdated += groupRows?.length ?? 0;

      const representative = currentAssets?.[0] ?? currentGroups?.[0] ?? null;
      const targetId = assetRows?.[0]?.id ?? groupRows?.[0]?.id ?? erpItem.id;
      const targetType = assetRows?.length ? "asset" : groupRows?.length ? "style_group" : "erp_item";

      const logEntries = updateFields
        .map((field) => {
          const oldVal = representative?.[field as keyof typeof representative];
          const newVal = updates[field];
          if (String(oldVal ?? "") === String(newVal ?? "")) return null;
          return {
            target_type: targetType,
            target_id: targetId,
            field_name: field,
            old_value: oldVal != null ? String(oldVal) : null,
            new_value: newVal != null ? String(newVal) : null,
            source: classificationSource,
            confidence,
            run_id: runId,
          };
        })
        .filter((entry): entry is {
          target_type: string;
          target_id: string;
          field_name: string;
          old_value: string | null;
          new_value: string | null;
          source: string;
          confidence: number | null;
          run_id: string;
        } => entry !== null);

      if (logEntries.length > 0) {
        const { error: logErr } = await client.from("erp_enrichment_log").insert(logEntries);
        if (logErr) {
          logger.warn("erp-enrichment: failed to insert audit log entries", {
            sku: erpItem.style_number,
            error: logErr.message,
            count: logEntries.length,
          });
        }
      }
    }
  }

  const done = erpItems.length < batchSize;
  return {
    ok: true,
    done,
    nextOffset: offset + erpItems.length,
    assets_updated: assetsUpdated,
    groups_updated: groupsUpdated,
    updated: assetsUpdated + groupsUpdated,
    total: offset + erpItems.length,
  };
}

// ── ERP Classification ───────────────────────────────────────────────────────

const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];

function isUnclassifiable(item: { item_description: string | null; style_number: string | null; external_id: string }): boolean {
  const desc = (item.item_description || "").trim().toLowerCase();
  const style = (item.style_number || "").trim();
  if (!desc && !style) return true;
  if (desc === item.external_id?.toLowerCase() || desc === style?.toLowerCase()) return true;
  if (desc.length > 0 && desc.length <= 6 && /^[a-z0-9]+$/i.test(desc)) return true;
  const junkPatterns = [
    /^assortment$/i, /^test$/i, /^testing$/i, /^sample$/i, /^n\/?a$/i,
    /^tbd$/i, /^none$/i, /^null$/i, /^placeholder$/i,
    /^(desing|design)\s*(number|num|#)?(\s+function)?\s*(test)?\s*\d*$/i,
    /^\d{4,}$/, /^[a-z]{1,3}\d{4,}$/i,
  ];
  if (junkPatterns.some((p) => p.test(desc))) return true;
  return false;
}

export async function handleClassifyErpCategories(opState: OpState): Promise<BatchResult> {
  const client = db();
  const apiKey = config.openRouterApiKey || config.anthropicApiKey;
  if (!apiKey) {
    return { ok: false, done: false, error: "No AI API key configured (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)" };
  }

  // Read model from admin_config (cached)
  const classificationModel = await getClassificationModel();

  // Under the old 45s edge function these were 5/80/50. The persistent worker
  // has no timeout, so we can classify more candidates per tick.
  const batchSize = 15;
  const scanWindow = 200;
  const maxScanWindows = 20;
  const offset = typeof opState.cursor === "number" ? opState.cursor : 0;

  let scanOffset = offset;
  let scanned = 0;
  let exhausted = false;

  type ErpCandidate = {
    id: string;
    external_id: string;
    style_number: string | null;
    item_description: string | null;
    mg01_code: string | null;
    mg02_code: string | null;
    mg03_code: string | null;
    raw_mg_fields: unknown;
  };

  const candidates: ErpCandidate[] = [];

  for (let i = 0; i < maxScanWindows && candidates.length < batchSize; i++) {
    const { data: windowRows, error: windowErr } = await client
      .from("erp_items_current")
      .select("id, external_id, style_number, item_description, mg01_code, mg02_code, mg03_code, raw_mg_fields")
      .is("mg_category", null)
      .not("style_number", "is", null)
      .neq("style_number", "")
      .order("external_id", { ascending: true })
      .range(scanOffset, scanOffset + scanWindow - 1);

    if (windowErr) return { ok: false, done: false, error: windowErr.message };

    const rows = (windowRows ?? []) as ErpCandidate[];
    if (rows.length === 0) { exhausted = true; break; }

    scanned += rows.length;
    scanOffset += rows.length;

    const styleNumbers = [...new Set(rows.map((r) => r.style_number).filter((v): v is string => !!v))];
    const erpItemIds = rows.map((r) => r.id);

    const [assetMatchRes, groupMatchRes, existingPredictionsRes] = await Promise.all([
      styleNumbers.length
        ? client.from("assets").select("sku").in("sku", styleNumbers).eq("is_deleted", false)
        : Promise.resolve({ data: [], error: null }),
      styleNumbers.length
        ? client.from("style_groups").select("sku").in("sku", styleNumbers)
        : Promise.resolve({ data: [], error: null }),
      erpItemIds.length
        ? client.from("product_category_predictions").select("erp_item_id,status").in("erp_item_id", erpItemIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const matchedSkuSet = new Set<string>([
      ...((assetMatchRes.data ?? []).map((r) => r.sku).filter((v): v is string => !!v)),
      ...((groupMatchRes.data ?? []).map((r) => r.sku).filter((v): v is string => !!v)),
    ]);

    const terminalPredictionIds = new Set<string>(
      (existingPredictionsRes.data ?? [])
        .filter((r) => ["auto_applied", "approved", "unclassifiable"].includes(r.status))
        .map((r) => r.erp_item_id)
        .filter((v): v is string => !!v),
    );

    for (const row of rows) {
      if (candidates.length >= batchSize) break;
      if (!row.style_number) continue;
      if (!matchedSkuSet.has(row.style_number)) continue;
      if (terminalPredictionIds.has(row.id)) continue;
      candidates.push(row);
    }

    if (rows.length < scanWindow) { exhausted = true; break; }
  }

  if (candidates.length === 0) {
    return { ok: true, done: exhausted, classified: 0, skipped_unclassifiable: 0, total: 0, scanned, nextOffset: scanOffset };
  }

  let classified = 0;
  let skippedUnclassifiable = 0;

  for (const item of candidates) {
    if (isUnclassifiable(item)) {
      await client.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: "Unknown",
        confidence: 0,
        rationale: "Insufficient product data for classification",
        classification_source: "ai",
        ai_model: null,
        ai_prompt_version: "v1",
        status: "unclassifiable",
        input_context: { style_number: item.style_number, item_description: item.item_description, raw_mg_fields: item.raw_mg_fields },
      });
      skippedUnclassifiable++;
      continue;
    }

    try {
      const prompt = `Classify this product into exactly ONE of these 7 categories for home décor products:
- Wall (wall art, wall clocks, wall signs, letters/plaques, canvas, frames, mirrors mounted on walls)
- Tabletop (picture frames that sit on tables, decorative objects, sculptures, figurines, candle holders, vases, desk accessories)
- Clock (any type of clock - wall clocks, desk clocks, mantle clocks, alarm clocks)
- Storage (boxes, baskets, bins, organizers, chests, cabinets)
- Workspace (desk organizers, office supplies, pen holders, paperweights, desk lamps)
- Floor (floor lamps, large sculptures, plant stands, umbrella stands, floor decor)
- Garden (outdoor décor, planters, garden statues, wind chimes, outdoor signs)

IMPORTANT CLASSIFICATION RULES:
1. "MDF letter" or "letter" items are WALL products (decorative letters mount on walls)
2. "Canvas" items are always WALL products
3. "MDF box" items are WALL products (decorative MDF wall art), NOT Storage
4. If description mentions specific characters (Marvel, Disney, etc.) look for product type keywords
5. If you cannot determine the category with certainty, set confidence below 0.5
6. DO NOT guess - if the description is ambiguous or unclear, use low confidence

CORRECTION EXAMPLES (learn from these past mistakes):
- "Disney MDF box" → Wall (MDF boxes in this company are decorative wall art panels, not storage)
- "Marvel MDF box 3D" → Wall (3D MDF wall art)
- "MDF letter A Disney" → Wall (decorative wall letter)
- "Canvas stretched Disney Princess" → Wall (stretched canvas wall art)
- "LED canvas Disney" → Wall (illuminated wall art)
- "Disney wooden box" → Wall (decorative wooden wall panels, not storage containers)

Product to classify:
- Style Number: ${item.style_number || "unknown"}
- Description: ${item.item_description || "none"}
- MG fields: ${JSON.stringify(item.raw_mg_fields || {})}

Use the provided tool to return your classification.`;

      const classifyTool = tool(
        "classify_product",
        "Classify a product into one of 7 categories",
        {
          type: "object",
          properties: {
            category: { type: "string", enum: CATEGORIES },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string", maxLength: 200 },
          },
          required: ["category", "confidence", "rationale"],
          additionalProperties: false,
        },
      );

      const messages: ChatMessage[] = [
        { role: "system", content: "You are a product classification expert for a home décor company. Classify each product into exactly one category." },
        { role: "user", content: prompt },
      ];

      const aiResult = await chatCompletion(apiKey, {
        model: classificationModel,
        messages,
        max_tokens: 1024,
        tools: [classifyTool],
        tool_choice: { type: "function", function: { name: "classify_product" } },
      });

      const parsed = aiResult.toolCalls?.[0]?.arguments as { category: string; confidence: number; rationale: string } | undefined;
      if (!parsed || !CATEGORIES.includes(parsed.category)) continue;

      const status = parsed.confidence >= 0.65 ? "auto_applied" : "pending";

      await client.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: parsed.category,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        classification_source: "ai",
        ai_model: classificationModel,
        ai_prompt_version: "v1",
        status,
        input_context: { style_number: item.style_number, item_description: item.item_description, raw_mg_fields: item.raw_mg_fields },
      });

      classified++;
    } catch (e) {
      logger.warn("erp-classify: classification error", { external_id: item.external_id, error: String(e) });
    }
  }

  return {
    ok: true,
    done: exhausted && candidates.length < batchSize,
    classified,
    skipped_unclassifiable: skippedUnclassifiable,
    total: classified + skippedUnclassifiable,
    scanned,
    nextOffset: scanOffset,
  };
}
