/**
 * Extracted admin-api handlers for metadata reprocessing and SKU backfill.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { parseSku } from "../sku-parser.ts";
import { deriveMetadataFromPath } from "../metadata-derivation.ts";
import { loadAuthoritativeLicensingMaps, resolveAuthoritativeLicensing } from "../licensing-resolution.ts";

// ── Route: reprocess-asset-metadata ─────────────────────────────────

/**
 * Fill-only licensing mode. Used after new licensor/property codes land in
 * master data: walks only licensed assets whose licensor_id is still NULL, by
 * id keyset (rows leaving the set cannot shift the cursor), and writes ONLY
 * licensing columns that are currently NULL. It never touches SKU/MG fields,
 * is_licensed, workflow_status, or any non-null value, and every UPDATE is
 * guarded on licensor_id still being NULL so concurrent writers win.
 */
export const FILL_MISSING_LICENSING_MODE = "fill-missing-licensing";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LICENSING_COLUMNS = ["licensor_id", "licensor_code", "licensor_name", "property_id", "property_code", "property_name"] as const;

export interface FillLicensingDeps {
  parse: typeof parseSku;
  loadMaps: typeof loadAuthoritativeLicensingMaps;
  resolve: typeof resolveAuthoritativeLicensing;
}

// deno-lint-ignore no-explicit-any
export async function fillMissingLicensing(body: Record<string, unknown>, db: any, deps: FillLicensingDeps = {
  parse: parseSku,
  loadMaps: loadAuthoritativeLicensingMaps,
  resolve: resolveAuthoritativeLicensing,
}): Promise<Record<string, unknown>> {
  const after = typeof body.after_id === "string" && UUID_RE.test(body.after_id) ? body.after_id : null;
  if (body.after_id !== undefined && body.after_id !== null && body.after_id !== 0 && !after) {
    throw new Error("after_id must be a UUID");
  }
  const requested = typeof body.batch_size === "number" ? Math.floor(body.batch_size) : 200;
  const batchSize = Math.max(1, Math.min(requested, 200));

  let query = db.from("assets")
    .select(`id, filename, file_created_at, is_licensed, ${LICENSING_COLUMNS.join(", ")}`)
    .eq("is_deleted", false)
    .eq("is_licensed", true)
    .is("licensor_id", null);
  if (after) query = query.gt("id", after);
  const { data: assets, error } = await query.order("id").limit(batchSize);
  if (error) throw new Error(error.message);
  const rows = (assets ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { ok: true, done: true, updated: 0, total: 0, nextOffset: null, unresolved_licensor: 0, unresolved_property: 0 };

  const parsed = await Promise.all(rows.map(async (a) => ({
    asset: a,
    parsed: await deps.parse(String(a.filename), { fileDate: a.file_created_at as string | null }),
  })));
  const maps = await deps.loadMaps(db, parsed.flatMap(({ parsed }) => parsed ? [parsed.sku] : []));

  let updated = 0;
  let unresolvedLicensor = 0;
  let unresolvedProperty = 0;
  for (const { asset, parsed: p } of parsed) {
    const r = await deps.resolve(db, true, p, maps);
    if (r.unresolved_licensor || !r.licensor_id) {
      unresolvedLicensor++;
      continue;
    }
    if (r.unresolved_property) unresolvedProperty++;
    const updates: Record<string, unknown> = {};
    for (const col of LICENSING_COLUMNS) {
      const next = (r as unknown as Record<string, unknown>)[col];
      if (asset[col] === null && next !== null && next !== undefined) updates[col] = next;
    }
    if (Object.keys(updates).length === 0) continue;
    // Guard every written column (and licensor_id) on still being NULL, so a
    // concurrent writer to any licensing field wins instead of being overwritten.
    let guarded = db.from("assets").update(updates).eq("id", asset.id).is("licensor_id", null);
    for (const col of Object.keys(updates)) if (col !== "licensor_id") guarded = guarded.is(col, null);
    const { data: written, error: updateErr } = await guarded.select("id");
    // A failed row must fail the batch so the worker retries it, never skip it.
    if (updateErr) throw new Error(`asset ${asset.id}: ${updateErr.message}`);
    if (Array.isArray(written) && written.length > 0) updated++;
  }

  const done = rows.length < batchSize;
  return {
    ok: true,
    done,
    updated,
    total: rows.length,
    unresolved_licensor: unresolvedLicensor,
    unresolved_property: unresolvedProperty,
    nextOffset: done ? null : String(rows[rows.length - 1].id),
  };
}

export async function handleReprocessAssetMetadata(body: Record<string, unknown>) {
  if (body.mode === FILL_MISSING_LICENSING_MODE) return json(await fillMissingLicensing(body, serviceClient()));
  const offset = typeof body.offset === "number" ? body.offset : 0;
  // Keep one edge invocation below the authenticated database ceiling. The
  // persistent worker supplies 25; direct/older callers retain the old 200.
  const requestedBatchSize = typeof body.batch_size === "number" ? Math.floor(body.batch_size) : 200;
  const BATCH_SIZE = Math.max(1, Math.min(requestedBatchSize, 200));
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

  const { data: assets, error: fetchErr } = await db
    .from("assets")
    .select("id, relative_path, filename, is_licensed, workflow_status, licensor_id, property_id, sku, file_created_at")
    .eq("is_deleted", false)
    .range(offset, offset + BATCH_SIZE - 1)
    // UUID order uses the primary-key index. created_at had no usable index and
    // timed out even for a one-row authenticated batch.
    .order("id");

  if (fetchErr) return err(fetchErr.message, 500);
  if (!assets || assets.length === 0) {
    return json({ ok: true, done: true, updated: 0, total: 0, nextOffset: null });
  }

  const parsedAssets = await Promise.all(assets.map(async (asset) => ({ asset, parsed: await parseSku(asset.filename, { fileDate: asset.file_created_at }) })));
  let licensingMaps;
  try {
    licensingMaps = await loadAuthoritativeLicensingMaps(
      db,
      parsedAssets.flatMap(({ parsed }) => parsed ? [parsed.sku] : []),
    );
  } catch (error) {
    return err(error instanceof Error ? error.message : "Could not load authoritative licensing taxonomy", 500);
  }

  let updated = 0;
  let unresolvedLicensor = 0;
  let unresolvedProperty = 0;

  for (const { asset, parsed } of parsedAssets) {
    const updates: Record<string, unknown> = {};

    // Re-derive path-based metadata
    const derived = await deriveMetadataFromPath(asset.relative_path, db);

    if (asset.is_licensed !== derived.is_licensed) {
      updates.is_licensed = derived.is_licensed;
    }
    if (asset.workflow_status !== derived.workflow_status) {
      updates.workflow_status = derived.workflow_status;
    }
    // Re-derive SKU metadata from filename
    const licensing = await resolveAuthoritativeLicensing(db, derived.is_licensed, parsed, licensingMaps);
    if (asset.licensor_id !== licensing.licensor_id) updates.licensor_id = licensing.licensor_id;
    if (asset.property_id !== licensing.property_id) updates.property_id = licensing.property_id;
    if (licensing.unresolved_licensor) unresolvedLicensor++;
    if (licensing.unresolved_property) unresolvedProperty++;
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
        licensor_code: licensing.licensor_code,
        licensor_name: licensing.licensor_name,
        property_code: licensing.property_code,
        property_name: licensing.property_name,
        sku_sequence: parsed.sku_sequence,
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
    unresolved_licensor: unresolvedLicensor,
    unresolved_property: unresolvedProperty,
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

    const needsBackfill = assets.filter((a: any) => (a.licensor_name === a.licensor_code) || (a.property_name === a.property_code));

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
