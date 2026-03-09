/**
 * Extracted admin-api handlers for metadata reprocessing and SKU backfill.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { parseSku } from "../sku-parser.ts";
import { deriveMetadataFromPath } from "../metadata-derivation.ts";

// ── Route: reprocess-asset-metadata ─────────────────────────────────

export async function handleReprocessAssetMetadata(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 200;
  const db = serviceClient();

  // Fetch grand total once at the start of the operation (offset 0 only)
  let grandTotal: number | null = null;
  if (offset === 0) {
    try {
      const { count } = await db
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", false);
      grandTotal = count ?? null;
    } catch {
      // Non-fatal
    }
  }

  const { data: allLicensors } = await db
    .from("licensors")
    .select("id, name");
  const { data: allProperties } = await db
    .from("properties")
    .select("id, name, licensor_id");

  const licensorMap = new Map(
    (allLicensors ?? []).map((l) => [l.name.toLowerCase(), l.id]),
  );
  const propertyMap = new Map(
    (allProperties ?? []).map((p) => [`${p.licensor_id}:${p.name.toLowerCase()}`, p.id]),
  );

  const { data: assets, error: fetchErr } = await db
    .from("assets")
    .select("id, relative_path, filename, is_licensed, workflow_status, licensor_id, property_id, sku")
    .eq("is_deleted", false)
    .range(offset, offset + BATCH_SIZE - 1)
    .order("created_at");

  if (fetchErr) return err(fetchErr.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, done: true, updated: 0, total: 0, nextOffset: null });
  }

  let updated = 0;

  for (const asset of assets) {
    const updates: Record<string, unknown> = {};

    // Re-derive path-based metadata
    const derived = await deriveMetadataFromPath(asset.relative_path, db, licensorMap, propertyMap);

    if (asset.is_licensed !== derived.is_licensed) {
      updates.is_licensed = derived.is_licensed;
    }
    if (asset.workflow_status !== derived.workflow_status) {
      updates.workflow_status = derived.workflow_status;
    }
    if (!asset.licensor_id && derived.licensor_id) {
      updates.licensor_id = derived.licensor_id;
    }
    if (!asset.property_id && derived.property_id) {
      updates.property_id = derived.property_id;
    }

    // Re-derive SKU metadata from filename
    const parsed = await parseSku(asset.filename);
    if (parsed) {
      const skuFields: Record<string, string | null> = {
        sku: parsed.sku,
        mg01_code: parsed.mg01_code,
        mg01_name: parsed.mg01_name,
        mg02_code: parsed.mg02_code,
        mg02_name: parsed.mg02_name,
        mg03_code: parsed.mg03_code,
        mg03_name: parsed.mg03_name,
        size_code: parsed.size_code,
        size_name: parsed.size_name,
        licensor_code: parsed.licensor_code,
        licensor_name: parsed.licensor_name,
        property_code: parsed.property_code,
        property_name: parsed.property_name,
        sku_sequence: parsed.sku_sequence,
        product_category: parsed.product_category,
        division_code: parsed.division_code,
        division_name: parsed.division_name,
      };
      for (const [k, v] of Object.entries(skuFields)) {
        const current = (asset as Record<string, unknown>)[k];
        if (current !== v) {
          updates[k] = v;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await db
        .from("assets")
        .update(updates)
        .eq("id", asset.id);
      if (!updateErr) updated++;
    }
  }

  const done = assets.length < BATCH_SIZE;
  return json({
    ok: true,
    done,
    updated,
    total: assets.length,
    grand_total: grandTotal,
    assets_checked: offset + assets.length,
    nextOffset: done ? null : offset + BATCH_SIZE,
  });
}

// ── Route: backfill-sku-names ──────────────────────────────────────

export async function handleBackfillSkuNames() {
  const db = serviceClient();
  const BATCH = 500;
  let updated = 0;
  let groupsUpdated = 0;
  let offset = 0;
  const MAX = 10000;

  while (offset < MAX) {
    const { data: assets, error } = await db
      .from("assets")
      .select("id, filename, licensor_code, licensor_name, property_code, property_name, style_group_id")
      .eq("is_deleted", false)
      .not("sku", "is", null)
      .not("licensor_code", "is", null)
      .order("id")
      .range(offset, offset + BATCH - 1);

    if (error) return err(error.message, 500);
    if (!assets || assets.length === 0) break;
    offset += assets.length;

    const needsBackfill = assets.filter((a: any) =>
      (a.licensor_name === a.licensor_code) || (a.property_name === a.property_code)
    );

    for (const asset of needsBackfill) {
      const parsed = await parseSku(asset.filename);
      if (!parsed) continue;

      const updates: Record<string, unknown> = {};
      if (parsed.licensor_name && asset.licensor_name === asset.licensor_code) {
        updates.licensor_name = parsed.licensor_name;
      }
      if (parsed.property_name && asset.property_name === asset.property_code) {
        updates.property_name = parsed.property_name;
      }

      if (Object.keys(updates).length > 0) {
        await db.from("assets").update(updates).eq("id", asset.id);
        updated++;

        if (asset.style_group_id) {
          await db.from("style_groups").update(updates).eq("id", asset.style_group_id);
          groupsUpdated++;
        }
      }
    }
  }

  return json({ ok: true, assets_updated: updated, groups_updated: groupsUpdated, assets_checked: offset });
}
