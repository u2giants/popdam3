/**
 * ERP enrichment and classification handlers extracted from admin-api.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

/** Derive a short card label from an ERP item_description.
 *  "Lapdesk_Solid Blue_23.5x10" x15.5"" → "Lapdesk Solid Blue"
 */
function deriveErpCoverDescription(itemDescription: string | null): string | null {
  if (!itemDescription?.trim()) return null;
  let s = itemDescription.replace(/_/g, " ");
  s = s.replace(/\b\d+\.?\d*["″]?\s*[xX×]\s*\d+\.?\d*["″]?(?:\s*[xX×]\s*\d+\.?\d*["″]?)*/g, "");
  s = s.replace(/\s+/g, " ").replace(/^[\s\-_,]+|[\s\-_,]+$/g, "").trim();
  return s || null;
}

// ── Route: apply-erp-enrichment ─────────────────────────────────────

export async function handleApplyErpEnrichment(body: Record<string, unknown>) {
  const mode = body.mode as string || "dry-run";
  const batchSize = 100;
  const offset = typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;

  const db = serviceClient();

  // For dry-run: fetch items that actually match assets/groups so the sample is meaningful.
  // For apply: process all items in external_id order (pagination via offset).
  let erpItems:
    | Array<{
      id: string;
      external_id: string;
      style_number: string | null;
      item_description: string | null;
      mg_category: string | null;
      mg01_code: string | null;
      mg02_code: string | null;
      mg03_code: string | null;
      size_code: string | null;
      licensor_code: string | null;
      property_code: string | null;
      division_code: string | null;
    }>
    | null = null;
  let erpErr: { message: string } | null = null;

  if (mode === "dry-run") {
    // Fetch a candidate batch of ERP items (mg_category first), then filter to those
    // that have a matching asset SKU — avoids execute_readonly_query RPC restrictions.
    const { data: candidates, error: candidateErr } = await db
      .from("erp_items_current")
      .select(
        "id, external_id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code, division_code",
      )
      .not("style_number", "is", null)
      .neq("style_number", "")
      .order("mg_category", { ascending: true, nullsFirst: false })
      .order("external_id", { ascending: true })
      .limit(300);

    if (candidateErr) {
      erpItems = null;
      erpErr = { message: candidateErr.message };
    } else {
      const candidateSkus = (candidates ?? []).map((c) => c.style_number).filter(Boolean) as string[];
      const { data: matchedAssets } = await db
        .from("assets")
        .select("sku")
        .in("sku", candidateSkus.length > 0 ? candidateSkus : ["__none__"])
        .eq("is_deleted", false);
      const matchedSkuSet = new Set((matchedAssets ?? []).map((a) => a.sku).filter(Boolean));
      erpItems = (candidates ?? []).filter((c) => c.style_number && matchedSkuSet.has(c.style_number)).slice(0, 50);
      erpErr = null;
    }
  } else {
    const { data, error } = await db
      .from("erp_items_current")
      .select(
        "id, external_id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code, division_code",
      )
      .not("style_number", "is", null)
      .neq("style_number", "")
      .order("external_id")
      .range(offset, offset + batchSize - 1);
    erpItems = data;
    erpErr = error;
  }

  if (erpErr) return err(erpErr.message, 500);
  if (!erpItems || erpItems.length === 0) {
    return json({ ok: true, done: true, updated: 0, assets_updated: 0, groups_updated: 0, total: offset });
  }

  let assetsUpdated = 0;
  let groupsUpdated = 0;
  let skipped = 0;

  // Build proposed updates based on ERP data + predictions
  async function buildProposedUpdates(erpItem: {
    id: string;
    external_id: string;
    style_number: string | null;
    item_description: string | null;
    mg_category: string | null;
    mg01_code: string | null;
    mg02_code: string | null;
    mg03_code: string | null;
    size_code: string | null;
    licensor_code: string | null;
    property_code: string | null;
    division_code: string | null;
  }): Promise<
    {
      updates: Record<string, unknown>;
      classification_source: string | null;
      confidence: number | null;
      predicted_category: string | null;
      prediction_status: string | null;
    }
  > {
    const updates: Record<string, unknown> = {};
    let classificationSource: string | null = null;
    let confidence: number | null = null;
    let productCategory: string | null = null;
    let predictedCategory: string | null = null;
    let predictionStatus: string | null = null;

    // Try AI prediction if no ERP category
    if (!erpItem.mg_category) {
      const { data: predictionRow } = await db
        .from("product_category_predictions")
        .select("predicted_category, confidence, classification_source, status")
        .eq("erp_item_id", erpItem.id)
        .order("created_at", { ascending: false })
        .maybeSingle();

      if (predictionRow) {
        predictedCategory = predictionRow.predicted_category;
        predictionStatus = predictionRow.status;
        if (["approved", "auto_applied"].includes(predictionRow.status)) {
          productCategory = predictionRow.predicted_category;
          classificationSource = predictionRow.classification_source || "ai";
          confidence = predictionRow.confidence ?? 0.8;
        }
      }
    } else {
      productCategory = erpItem.mg_category;
      predictedCategory = erpItem.mg_category;
      predictionStatus = "erp";
      classificationSource = "erp";
      confidence = 1.0;
    }

    // Apply ERP fields
    if (erpItem.mg01_code) updates.mg01_code = erpItem.mg01_code;
    if (erpItem.mg02_code) updates.mg02_code = erpItem.mg02_code;
    if (erpItem.mg03_code) updates.mg03_code = erpItem.mg03_code;
    if (erpItem.size_code) updates.size_code = erpItem.size_code;
    if (erpItem.licensor_code) updates.licensor_code = erpItem.licensor_code;
    if (erpItem.property_code) updates.property_code = erpItem.property_code;
    if (erpItem.division_code) updates.division_code = erpItem.division_code;
    if (productCategory) updates.product_category = productCategory;

    return {
      updates,
      classification_source: classificationSource,
      confidence,
      predicted_category: predictedCategory,
      prediction_status: predictionStatus,
    };
  }

  if (mode === "dry-run") {
    const skus = erpItems.map((e) => e.style_number).filter(Boolean) as string[];

    const { count: assetCount } = await db.from("assets")
      .select("*", { count: "exact", head: true })
      .in("sku", skus)
      .eq("is_deleted", false);

    const { count: groupCount } = await db.from("style_groups")
      .select("*", { count: "exact", head: true })
      .in("sku", skus);

    const sampleSkus = skus.slice(0, 25);
    const [assetSampleRes, groupSampleRes] = await Promise.all([
      db.from("assets")
        .select("id, sku, filename")
        .in("sku", sampleSkus)
        .eq("is_deleted", false)
        .limit(250),
      db.from("style_groups")
        .select("id, sku")
        .in("sku", sampleSkus)
        .limit(250),
    ]);

    const assetSamples = assetSampleRes.data ?? [];
    const groupSamples = groupSampleRes.data ?? [];

    const assetCountBySku = new Map<string, number>();
    for (const a of assetSamples) {
      if (!a.sku) continue;
      assetCountBySku.set(a.sku, (assetCountBySku.get(a.sku) ?? 0) + 1);
    }

    const groupCountBySku = new Map<string, number>();
    for (const g of groupSamples) {
      if (!g.sku) continue;
      groupCountBySku.set(g.sku, (groupCountBySku.get(g.sku) ?? 0) + 1);
    }

    const sample_updates: Array<Record<string, unknown>> = [];
    for (const erpItem of erpItems.slice(0, 20)) {
      if (!erpItem.style_number) continue;
      const { updates, classification_source, confidence, predicted_category, prediction_status } = await buildProposedUpdates(erpItem);
      if (Object.keys(updates).length === 0 && !predicted_category) continue;

      sample_updates.push({
        external_id: erpItem.external_id,
        sku: erpItem.style_number,
        description: erpItem.item_description ?? null,
        classification_source,
        confidence,
        predicted_category,
        prediction_status,
        proposed_fields: updates,
        matching_asset_count: assetCountBySku.get(erpItem.style_number) ?? 0,
        matching_group_count: groupCountBySku.get(erpItem.style_number) ?? 0,
      });
    }

    return json({
      ok: true,
      done: true,
      assets_to_update: assetCount ?? 0,
      groups_to_update: groupCount ?? 0,
      new_categories: erpItems.filter((e) => e.mg_category).length,
      skipped_lower_confidence: 0,
      sample_updates,
    });
  }

  // Apply mode
  for (const erpItem of erpItems) {
    if (!erpItem.style_number) continue;

    const { updates } = await buildProposedUpdates(erpItem);

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    // Update assets
    const { data: assetRows } = await db.from("assets")
      .update(updates)
      .eq("sku", erpItem.style_number)
      .eq("is_deleted", false)
      .select("id");
    assetsUpdated += assetRows?.length ?? 0;

    // Update style_groups
    const { data: groupRows } = await db.from("style_groups")
      .update(updates)
      .eq("sku", erpItem.style_number)
      .select("id");
    groupsUpdated += groupRows?.length ?? 0;

    // Populate cover_description on untagged assets from ERP item_description.
    // Only writes where cover_description IS NULL so AI-tagged values are never overwritten.
    // The sync_cover_description_to_style_group trigger propagates it to style_groups.
    const coverDesc = deriveErpCoverDescription(erpItem.item_description ?? null);
    if (coverDesc) {
      await db.from("assets")
        .update({ cover_description: coverDesc })
        .eq("sku", erpItem.style_number)
        .eq("is_deleted", false)
        .is("cover_description", null);
    }
  }

  const done = erpItems.length < batchSize;
  return json({
    ok: true,
    done,
    nextOffset: offset + erpItems.length,
    assets_updated: assetsUpdated,
    groups_updated: groupsUpdated,
    skipped,
    updated: assetsUpdated + groupsUpdated,
    total: offset + erpItems.length,
  });
}

// ── Route: classify-erp-categories ──────────────────────────────────

export async function handleClassifyErpCategories(body: Record<string, unknown>) {
  const batchSize = 5;
  const scanWindow = 80;
  const maxScanWindows = 50;
  const offset = typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;

  const db = serviceClient();

  let scanOffset = offset;
  let scanned = 0;
  let exhausted = false;
  const candidates: Array<{
    id: string;
    external_id: string;
    style_number: string | null;
    item_description: string | null;
    mg01_code: string | null;
    mg02_code: string | null;
    mg03_code: string | null;
    raw_mg_fields: unknown;
  }> = [];

  // Scan windows of ERP rows until we either fill a batch or exhaust data.
  for (let i = 0; i < maxScanWindows && candidates.length < batchSize; i++) {
    const { data: windowRows, error: windowErr } = await db
      .from("erp_items_current")
      .select("id, external_id, style_number, item_description, mg01_code, mg02_code, mg03_code, raw_mg_fields")
      .is("mg_category", null)
      .not("style_number", "is", null)
      .neq("style_number", "")
      .order("external_id", { ascending: true })
      .range(scanOffset, scanOffset + scanWindow - 1);

    if (windowErr) return err(windowErr.message, 500);

    const rows = (windowRows ?? []) as typeof candidates;
    if (rows.length === 0) {
      exhausted = true;
      break;
    }

    scanned += rows.length;
    scanOffset += rows.length;

    const styleNumbers = [...new Set(rows.map((r) => r.style_number).filter((v): v is string => !!v))];
    const erpItemIds = rows.map((r) => r.id);

    const [assetMatchRes, groupMatchRes, existingPredictionsRes] = await Promise.all([
      styleNumbers.length ? db.from("assets").select("sku").in("sku", styleNumbers).eq("is_deleted", false) : Promise.resolve({ data: [], error: null }),
      styleNumbers.length ? db.from("style_groups").select("sku").in("sku", styleNumbers) : Promise.resolve({ data: [], error: null }),
      erpItemIds.length
        ? db.from("product_category_predictions").select("erp_item_id,status").in("erp_item_id", erpItemIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (assetMatchRes.error) return err(assetMatchRes.error.message, 500);
    if (groupMatchRes.error) return err(groupMatchRes.error.message, 500);
    if (existingPredictionsRes.error) return err(existingPredictionsRes.error.message, 500);

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

    if (rows.length < scanWindow) {
      exhausted = true;
      break;
    }
  }

  if (candidates.length === 0) {
    return json({
      ok: true,
      done: exhausted,
      classified: 0,
      skipped_unclassifiable: 0,
      total: 0,
      scanned,
      nextOffset: scanOffset,
    });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) return err("ANTHROPIC_API_KEY not configured", 500);

  let classified = 0;
  let skippedUnclassifiable = 0;
  const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];

  /** Check if an item has enough data for meaningful AI classification */
  function isUnclassifiable(item: { item_description: string | null; style_number: string | null; external_id: string }): boolean {
    const desc = (item.item_description || "").trim().toLowerCase();
    const style = (item.style_number || "").trim();
    if (!desc && !style) return true;
    if (desc === item.external_id?.toLowerCase() || desc === style?.toLowerCase()) return true;
    if (desc.length > 0 && desc.length <= 6 && /^[a-z0-9]+$/i.test(desc)) return true;
    const junkPatterns = [
      /^assortment$/i,
      /^test$/i,
      /^testing$/i,
      /^sample$/i,
      /^n\/?a$/i,
      /^tbd$/i,
      /^none$/i,
      /^null$/i,
      /^placeholder$/i,
      /^(desing|design)\s*(number|num|#)?(\s+function)?\s*(test)?\s*\d*$/i,
      /^\d{4,}$/,
      /^[a-z]{1,3}\d{4,}$/i,
    ];
    if (junkPatterns.some((p) => p.test(desc))) return true;
    return false;
  }

  for (const item of candidates) {
    if (isUnclassifiable(item)) {
      await db.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: "Unknown",
        confidence: 0,
        rationale: "Insufficient product data for classification",
        classification_source: "ai",
        ai_model: null,
        ai_prompt_version: "v1",
        status: "unclassifiable",
        input_context: {
          style_number: item.style_number,
          item_description: item.item_description,
          raw_mg_fields: item.raw_mg_fields,
        },
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
        signal: AbortSignal.timeout(20_000),
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
        console.error(`AI classification failed for ${item.external_id}: ${aiResp.status}`);
        continue;
      }

      const aiResult = await aiResp.json();
      const toolUse = aiResult.content?.find((c: { type: string }) => c.type === "tool_use");
      if (!toolUse?.input) continue;

      const parsed = toolUse.input as { category: string; confidence: number; rationale: string };

      if (!CATEGORIES.includes(parsed.category)) continue;

      const status = parsed.confidence >= 0.65 ? "auto_applied" : "pending";

      await db.from("product_category_predictions").insert({
        erp_item_id: item.id,
        external_id: item.external_id,
        predicted_category: parsed.category,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        classification_source: "ai",
        ai_model: "claude-haiku-4-5-20251001",
        ai_prompt_version: "v1",
        status,
        input_context: {
          style_number: item.style_number,
          item_description: item.item_description,
          raw_mg_fields: item.raw_mg_fields,
        },
      });

      classified++;
    } catch (e) {
      console.error(`AI classification error for ${item.external_id}:`, e);
    }
  }

  return json({
    ok: true,
    done: exhausted && candidates.length < batchSize,
    classified,
    skipped_unclassifiable: skippedUnclassifiable,
    total: classified + skippedUnclassifiable,
    scanned,
    nextOffset: scanOffset,
  });
}
