/**
 * ERP enrichment and classification handlers — edge function version.
 *
 * IMPORTANT: Only dry-run mode runs here (read-only, fast).
 * All write operations (apply, apply-force, classify) are handled by the
 * Railway worker (apps/worker/src/handlers/erp.ts) via persistent operations.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";
import { canonicalItemIdMap, canonicalItemKey, canonicalItemMatchKey } from "../canonical-erp-items.ts";

type ErpPreviewCandidate = {
  source_id: string;
  style_number: string;
  item_description: string | null;
  mg_category: string | null;
  mg01_code: string | null;
  mg02_code: string | null;
  mg03_code: string | null;
  size_code: string | null;
  licensor_code: string | null;
  property_code: string | null;
  division_code: string | null;
};

// Match api.plm_item_list's ColdLion fields and preview ordering without its
// legacy UUID ranking or prepack projection. Resolve canonical IDs separately
// so the shortlist never hides duplicates outside the candidate limit.
const ERP_PREVIEW_CANDIDATES_SQL = `SELECT
  candidate.item_number AS source_id,
  candidate.item_number AS style_number,
  candidate.description AS item_description,
  candidate.mg_category,
  candidate.raw ->> 'merchGroup01' AS mg01_code,
  candidate.raw ->> 'merchGroup02' AS mg02_code,
  candidate.raw ->> 'merchGroup03' AS mg03_code,
  candidate.raw ->> 'sizeRangeCode' AS size_code,
  licensor.code AS licensor_code,
  property.code AS property_code,
  candidate.raw ->> 'divisionCode' AS division_code
FROM (
  SELECT item_number, description, raw, licensor_id, property_id,
         raw ->> 'mGCategory' AS mg_category
  FROM plm.item
  WHERE source_system = 'coldlion' AND item_number IS NOT NULL AND item_number <> ''
  ORDER BY mg_category ASC NULLS LAST, item_number ASC
  LIMIT 300
) candidate
LEFT JOIN core.licensor licensor ON licensor.id = candidate.licensor_id
LEFT JOIN core.property property ON property.id = candidate.property_id
ORDER BY candidate.mg_category ASC NULLS LAST, candidate.item_number ASC`;

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
  const { data: candidateRows, error: candidateErr } = await db.rpc("execute_readonly_query", {
    query_text: ERP_PREVIEW_CANDIDATES_SQL,
  });

  if (candidateErr || !Array.isArray(candidateRows)) {
    console.error("ERP preview candidate read failed", { code: candidateErr?.code });
    return err("Could not load ERP preview candidates", 500);
  }

  const candidates = candidateRows as ErpPreviewCandidate[];
  const candidateSkus = candidates.map((c) => c.style_number).filter(Boolean);
  const { data: matchedAssets } = await db
    .from("assets")
    .select("sku, division_code")
    .in("sku", candidateSkus.length > 0 ? candidateSkus : ["__none__"])
    .eq("is_deleted", false);
  const matchedSkuSet = new Set((matchedAssets ?? []).map((a) => canonicalItemMatchKey(a.sku, a.division_code)));
  const matchedItems = candidates.filter((c) => c.style_number && matchedSkuSet.has(canonicalItemMatchKey(c.style_number, c.division_code)));
  let canonicalIds: Map<string, string>;
  try {
    canonicalIds = await canonicalItemIdMap(db, matchedItems.map((c) => ({ ...c, source_system: "coldlion" })));
  } catch {
    console.error("ERP preview canonical identity read failed");
    return err("Could not resolve ERP preview item identities", 500);
  }
  // Mirror the worker: ambiguous identities are skipped by apply, so the
  // preview must not count or sample them either.
  const erpItems = matchedItems
    .filter((c) => canonicalIds.has(canonicalItemKey({ ...c, source_system: "coldlion" })))
    .slice(0, 50);

  if (erpItems.length === 0) {
    return json({ ok: true, done: true, assets_to_update: 0, groups_to_update: 0, sample_updates: [] });
  }

  const skus = erpItems.map((e) => e.style_number).filter(Boolean) as string[];

  // Count per division, exactly as the worker updates by SKU + division; a
  // SKU-only count would include same-SKU rows in other divisions.
  const skusByDivision = new Map<string | null, string[]>();
  for (const e of erpItems) {
    if (!e.style_number) continue;
    const key = e.division_code ?? null;
    skusByDivision.set(key, [...(skusByDivision.get(key) ?? []), e.style_number]);
  }
  const byDivision = (q: any, division: string | null) => division === null ? q.is("division_code", null) : q.eq("division_code", division);
  const divisionCounts = await Promise.all([...skusByDivision].map(([division, divisionSkus]) =>
    Promise.all([
      byDivision(db.from("assets").select("*", { count: "exact", head: true }).in("sku", divisionSkus).eq("is_deleted", false), division),
      byDivision(db.from("style_groups").select("*", { count: "exact", head: true }).in("sku", divisionSkus), division),
    ])
  ));
  const assetCountRes = { count: divisionCounts.reduce((sum, [a]) => sum + (a.count ?? 0), 0) };
  const groupCountRes = { count: divisionCounts.reduce((sum, [, g]) => sum + (g.count ?? 0), 0) };

  const sampleSkus = skus.slice(0, 25);
  const [assetSampleRes, groupSampleRes] = await Promise.all([
    db.from("assets").select("id, sku, division_code, filename").in("sku", sampleSkus).eq("is_deleted", false).limit(250),
    db.from("style_groups").select("id, sku, division_code").in("sku", sampleSkus).limit(250),
  ]);

  const assetCountBySku = new Map<string, number>();
  for (const a of assetSampleRes.data ?? []) {
    if (!a.sku) continue;
    const key = canonicalItemMatchKey(a.sku, a.division_code);
    assetCountBySku.set(key, (assetCountBySku.get(key) ?? 0) + 1);
  }
  const groupCountBySku = new Map<string, number>();
  for (const g of groupSampleRes.data ?? []) {
    if (!g.sku) continue;
    const key = canonicalItemMatchKey(g.sku, g.division_code);
    groupCountBySku.set(key, (groupCountBySku.get(key) ?? 0) + 1);
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
        .eq("plm_item_id", canonicalIds.get(canonicalItemKey({ ...erpItem, source_system: "coldlion" })) ?? "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: false })
        .limit(1)
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
      external_id: erpItem.source_id,
      sku: erpItem.style_number,
      description: erpItem.item_description ?? null,
      classification_source: classificationSource,
      confidence,
      predicted_category: predictedCategory,
      prediction_status: predictionStatus,
      proposed_fields: updates,
      matching_asset_count: assetCountBySku.get(canonicalItemMatchKey(erpItem.style_number, erpItem.division_code)) ?? 0,
      matching_group_count: groupCountBySku.get(canonicalItemMatchKey(erpItem.style_number, erpItem.division_code)) ?? 0,
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
