/**
 * ERP enrichment and classification handlers — edge function version.
 *
 * IMPORTANT: Only dry-run mode runs here (read-only, fast).
 * All write operations (apply, apply-force, classify) are handled by the
 * Railway worker (apps/worker/src/handlers/erp.ts) via persistent operations.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

// ── Route: apply-erp-enrichment ─────────────────────────────────────

export async function handleApplyErpEnrichment(body: Record<string, unknown>) {
  const mode = body.mode as string || "dry-run";

  // Only dry-run is handled in the edge function — apply modes run in the worker
  if (mode !== "dry-run") {
    return json({
      ok: false,
      error: "Apply/force modes are handled by the background worker. Use the persistent operation (Start button) instead of calling this endpoint directly.",
    }, 400);
  }

  const db = serviceClient();

  // Fetch a candidate batch of ERP items, then filter to those with matching assets
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

  if (candidateErr) return err(candidateErr.message, 500);

  const candidateSkus = (candidates ?? []).map((c) => c.style_number).filter(Boolean) as string[];
  const { data: matchedAssets } = await db
    .from("assets")
    .select("sku")
    .in("sku", candidateSkus.length > 0 ? candidateSkus : ["__none__"])
    .eq("is_deleted", false);
  const matchedSkuSet = new Set((matchedAssets ?? []).map((a) => a.sku).filter(Boolean));
  const erpItems = (candidates ?? []).filter((c) => c.style_number && matchedSkuSet.has(c.style_number)).slice(0, 50);

  if (erpItems.length === 0) {
    return json({ ok: true, done: true, assets_to_update: 0, groups_to_update: 0, sample_updates: [] });
  }

  const skus = erpItems.map((e) => e.style_number).filter(Boolean) as string[];

  const [assetCountRes, groupCountRes] = await Promise.all([
    db.from("assets").select("*", { count: "exact", head: true }).in("sku", skus).eq("is_deleted", false),
    db.from("style_groups").select("*", { count: "exact", head: true }).in("sku", skus),
  ]);

  const sampleSkus = skus.slice(0, 25);
  const [assetSampleRes, groupSampleRes] = await Promise.all([
    db.from("assets").select("id, sku, filename").in("sku", sampleSkus).eq("is_deleted", false).limit(250),
    db.from("style_groups").select("id, sku").in("sku", sampleSkus).limit(250),
  ]);

  const assetCountBySku = new Map<string, number>();
  for (const a of assetSampleRes.data ?? []) {
    if (!a.sku) continue;
    assetCountBySku.set(a.sku, (assetCountBySku.get(a.sku) ?? 0) + 1);
  }
  const groupCountBySku = new Map<string, number>();
  for (const g of groupSampleRes.data ?? []) {
    if (!g.sku) continue;
    groupCountBySku.set(g.sku, (groupCountBySku.get(g.sku) ?? 0) + 1);
  }

  const sample_updates: Array<Record<string, unknown>> = [];
  for (const erpItem of erpItems.slice(0, 20)) {
    if (!erpItem.style_number) continue;

    const updates: Record<string, unknown> = {};
    let classificationSource: string | null = null;
    let confidence: number | null = null;
    let predictedCategory: string | null = null;
    let predictionStatus: string | null = null;

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
          updates.product_category = predictionRow.predicted_category;
          classificationSource = predictionRow.classification_source || "ai";
          confidence = predictionRow.confidence ?? 0.8;
        }
      }
    } else {
      updates.product_category = erpItem.mg_category;
      predictedCategory = erpItem.mg_category;
      predictionStatus = "erp";
      classificationSource = "erp";
      confidence = 1.0;
    }

    if (erpItem.mg01_code) updates.mg01_code = erpItem.mg01_code;
    if (erpItem.mg02_code) updates.mg02_code = erpItem.mg02_code;
    if (erpItem.mg03_code) updates.mg03_code = erpItem.mg03_code;
    if (erpItem.size_code) updates.size_code = erpItem.size_code;
    if (erpItem.licensor_code) updates.licensor_code = erpItem.licensor_code;
    if (erpItem.property_code) updates.property_code = erpItem.property_code;
    if (erpItem.division_code) updates.division_code = erpItem.division_code;

    if (Object.keys(updates).length === 0 && !predictedCategory) continue;

    sample_updates.push({
      external_id: erpItem.external_id,
      sku: erpItem.style_number,
      description: erpItem.item_description ?? null,
      classification_source: classificationSource,
      confidence,
      predicted_category: predictedCategory,
      prediction_status: predictionStatus,
      proposed_fields: updates,
      matching_asset_count: assetCountBySku.get(erpItem.style_number) ?? 0,
      matching_group_count: groupCountBySku.get(erpItem.style_number) ?? 0,
    });
  }

  return json({
    ok: true,
    done: true,
    assets_to_update: assetCountRes.count ?? 0,
    groups_to_update: groupCountRes.count ?? 0,
    new_categories: erpItems.filter((e) => e.mg_category).length,
    skipped_lower_confidence: 0,
    sample_updates,
  });
}

// ── Route: classify-erp-categories ──────────────────────────────────

export async function handleClassifyErpCategories(_body: Record<string, unknown>) {
  return json({
    ok: false,
    error: "AI classification runs in the background worker. Use the persistent operation (Start button) instead of calling this endpoint directly.",
  }, 400);
}
