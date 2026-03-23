/**
 * ERP enrichment & classification handlers — persistent worker version.
 *
 * Ports logic from:
 *   supabase/functions/_shared/admin-handlers/erp-handlers.ts
 *
 * Key differences from edge function version:
 *   - No 20s AbortSignal on Anthropic calls
 *   - Batch loops until done=true instead of returning after one batch
 *   - ANTHROPIC_API_KEY read from process.env (not Deno.env)
 */

import { db } from "../supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

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

    if (!erpItem.mg_category) {
      const { data: predictionRow } = await client
        .from("product_category_predictions")
        .select("predicted_category, confidence, classification_source, status")
        .eq("erp_item_id", erpItem.id)
        .maybeSingle();

      if (predictionRow && ["approved", "auto_applied"].includes(predictionRow.status)) {
        productCategory = predictionRow.predicted_category;
      }
    } else {
      productCategory = erpItem.mg_category;
    }

    if (erpItem.mg01_code) updates.mg01_code = erpItem.mg01_code;
    if (erpItem.mg02_code) updates.mg02_code = erpItem.mg02_code;
    if (erpItem.mg03_code) updates.mg03_code = erpItem.mg03_code;
    if (erpItem.size_code) updates.size_code = erpItem.size_code;
    if (erpItem.licensor_code) updates.licensor_code = erpItem.licensor_code;
    if (erpItem.property_code) updates.property_code = erpItem.property_code;
    if (erpItem.division_code) updates.division_code = erpItem.division_code;
    if (productCategory) updates.product_category = productCategory;

    if (Object.keys(updates).length === 0) continue;

    if (mode !== "dry-run") {
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

      // Populate cover_description on assets from ERP item_description.
      // ERP always takes precedence — overwrites AI-tagged values.
      // The sync_cover_description_to_style_group trigger propagates it to style_groups.
      const coverDesc = deriveErpCoverDescription(erpItem.item_description ?? null);
      if (coverDesc) {
        await client
          .from("assets")
          .update({ cover_description: coverDesc })
          .eq("sku", erpItem.style_number)
          .eq("is_deleted", false);
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
  const ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, done: false, error: "ANTHROPIC_API_KEY not configured" };
  }

  const batchSize = 5;
  const scanWindow = 80;
  const maxScanWindows = 50;
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

      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: "You are a product classification expert for a home décor company. Classify each product into exactly one category.",
          messages: [{ role: "user", content: prompt }],
          tools: [{
            name: "classify_product",
            description: "Classify a product into one of 7 categories",
            input_schema: {
              type: "object",
              properties: {
                category: { type: "string", enum: CATEGORIES },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                rationale: { type: "string", maxLength: 200 },
              },
              required: ["category", "confidence", "rationale"],
              additionalProperties: false,
            },
          }],
          tool_choice: { type: "tool", name: "classify_product" },
        }),
      });

      if (!aiResp.ok) {
        logger.warn("erp-classify: Anthropic API error", { external_id: item.external_id, status: aiResp.status });
        continue;
      }

      const aiResult = await aiResp.json() as { content?: Array<{ type: string; input?: { category: string; confidence: number; rationale: string } }> };
      const toolUse = aiResult.content?.find((c) => c.type === "tool_use");
      if (!toolUse?.input) continue;

      const parsed = toolUse.input;
      if (!CATEGORIES.includes(parsed.category)) continue;

      const status = parsed.confidence >= 0.65 ? "auto_applied" : "pending";

      await client.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: parsed.category,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        classification_source: "ai",
        ai_model: "claude-haiku-4-5-20251001",
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
