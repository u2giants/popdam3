/**
 * Handlers for the .ai sentinel cleanup flow.
 *
 * "Sentinel" .ai files are those saved from Illustrator without the
 * "Create PDF Compatible File" option — their embedded PDF contains only
 * Adobe's boilerplate warning text, not the actual artwork.
 *
 * TEMPORARY — delete these handlers (and the ai_sentinel_cleanup_log table,
 * ai_sentinel_stats_fn migration, and the Settings UI card) once the
 * reconciliation pass is complete and ingestion logic prevents this from
 * recurring. See CLAUDE.md for details.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { credentialsFromConfig, deleteSpacesObjects } from "../spaces-delete.ts";
import { requireBridgeLatest } from "../bridge-version.ts";

const SENTINEL_TEXT = "saved without PDF Content";

// ── GET: stats + pending files (with asset thumbnails) + recent log ──────────

export async function handleGetAiSentinelStatus() {
  const db = serviceClient();
  try {
    const [statsRes, logRes, pendingRes, scanReqRes] = await Promise.all([
      db.rpc("get_ai_sentinel_stats"),
      db
        .from("ai_sentinel_cleanup_log")
        .select("id, ai_filename, ai_relative_path, replacement_filename, replacement_queued_for_thumbnail, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      // Fetch pending sentinel files with asset thumbnail so the UI can preview them.
      db
        .from("pdf_text_samples")
        .select("asset_id, filename, relative_path, assets!inner(thumbnail_url, is_deleted)")
        .like("extracted_text", `%${SENTINEL_TEXT}%`)
        .eq("assets.is_deleted", false)
        .not("asset_id", "in", `(select ai_asset_id from ai_sentinel_cleanup_log)`)
        .limit(200),
      db.from("admin_config").select("value").eq("key", "AI_SENTINEL_SCAN_REQUEST").maybeSingle(),
    ]);

    if (statsRes.error) throw new Error(`Stats RPC failed: ${statsRes.error.message}`);

    // Flatten the join: pull thumbnail_url out of the nested assets object
    const rawPending = (pendingRes.data ?? []) as Array<{
      asset_id: string;
      filename: string;
      relative_path: string;
      assets: { thumbnail_url: string | null } | null;
    }>;

    // For each pending sentinel, find the best sibling tech-pack thumbnail
    // (the .ai itself has no thumbnail — we show the replacement so the user
    // can visually verify the detection is correct before deleting).
    const dirPrefixes = [...new Set(rawPending.map((r) => r.relative_path.replace(/\/[^/]*$/, "")))];
    const replacementMap: Map<string, { thumbnail_url: string; filename: string }> = new Map();

    if (dirPrefixes.length > 0) {
      // Query each directory individually — .or() with multi-word paths breaks
      // the PostgREST parser because spaces in values are not quoted.
      await Promise.all(dirPrefixes.map(async (dir) => {
        const { data: siblings } = await db
          .from("assets")
          .select("filename, thumbnail_url")
          .in("file_type", ["pdf", "png", "jpg"])
          .eq("is_deleted", false)
          .not("thumbnail_url", "is", null)
          .like("relative_path", `${dir}/%`)
          .limit(20);
        const rows = (siblings ?? []) as Array<{ filename: string; thumbnail_url: string }>;
        const techPack = rows.find((r) => /tech.?pack/i.test(r.filename));
        const best = techPack ?? rows[0] ?? null;
        if (best) replacementMap.set(dir, { thumbnail_url: best.thumbnail_url, filename: best.filename });
      }));
    }

    const pendingFiles = rawPending.map((r) => {
      const dir = r.relative_path.replace(/\/[^/]*$/, "");
      const replacement = replacementMap.get(dir) ?? null;
      return {
        asset_id: r.asset_id,
        filename: r.filename,
        relative_path: r.relative_path,
        thumbnail_url: r.assets?.thumbnail_url ?? null,
        replacement_thumbnail_url: replacement?.thumbnail_url ?? null,
        replacement_filename: replacement?.filename ?? null,
      };
    });

    const scanRequest = (scanReqRes.data?.value as Record<string, unknown>) ?? null;

    return json({
      ok: true,
      stats: statsRes.data,
      pending_files: pendingFiles,
      recent_log: logRes.data ?? [],
      scan_request: scanRequest,
    });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

// ── POST: run a cleanup batch ─────────────────────────────────────────

export async function handleRunAiSentinelCleanup(body: Record<string, unknown>) {
  const db = serviceClient();
  const limit = Math.min(Number(body.limit) || 50, 200);

  // 1. Find .ai assets with sentinel text not yet cleaned up
  const { data: pending, error: pendingErr } = await db
    .from("pdf_text_samples")
    .select("asset_id, filename, relative_path, extraction_method")
    .like("extracted_text", `%${SENTINEL_TEXT}%`)
    .limit(limit * 2); // over-fetch; we filter out already-logged below

  if (pendingErr) return err(`Query failed: ${pendingErr.message}`, 500);
  if (!pending || pending.length === 0) {
    return json({ ok: true, processed: 0, message: "No sentinel .ai files pending cleanup" });
  }

  // Filter to assets that are still alive and not yet in the log
  const assetIds = pending.map((r: { asset_id: string }) => r.asset_id);
  const [assetsRes, alreadyDoneRes] = await Promise.all([
    db.from("assets").select("id, filename, relative_path, thumbnail_url, style_group_id").in("id", assetIds).eq("is_deleted", false).eq("file_type", "ai"),
    db.from("ai_sentinel_cleanup_log").select("ai_asset_id").in("ai_asset_id", assetIds),
  ]);

  const alreadyDone = new Set((alreadyDoneRes.data ?? []).map((r: { ai_asset_id: string }) => r.ai_asset_id));
  const assets = (assetsRes.data ?? []).filter((a: { id: string }) => !alreadyDone.has(a.id)).slice(0, limit);

  if (assets.length === 0) {
    return json({ ok: true, processed: 0, message: "All found sentinel files already cleaned up" });
  }

  // Load DO Spaces credentials once
  const { data: configRows } = await db
    .from("admin_config")
    .select("key, value")
    .in("key", ["DO_SPACES_KEY", "DO_SPACES_SECRET", "SPACES_CONFIG"]);

  const configMap: Record<string, unknown> = {};
  for (const row of configRows ?? []) configMap[row.key] = row.value;
  const creds = credentialsFromConfig(configMap);

  const results: Array<{
    ai_asset_id: string;
    ai_filename: string;
    replacement_asset_id: string | null;
    replacement_filename: string | null;
    queued: boolean;
  }> = [];

  for (const asset of assets as Array<{ id: string; filename: string; relative_path: string; thumbnail_url: string | null; style_group_id: string | null }>) {
    // 2. Soft-delete the .ai asset
    await db.from("assets").update({ is_deleted: true, thumbnail_url: null }).eq("id", asset.id);

    // 3. Delete its thumbnail from DO Spaces
    if (asset.thumbnail_url && creds) {
      try {
        await deleteSpacesObjects([`thumbnails/${asset.id}.jpg`], creds);
      } catch (e) {
        console.warn(`ai-sentinel: thumbnail delete failed for ${asset.id}:`, (e as Error).message);
      }
    }

    // 4. Find a replacement PDF/PNG/JPG with 'tech pack' in the name, same dir or subdir
    const dirPrefix = asset.relative_path.replace(/\/[^/]*$/, "");
    const { data: replacements } = await db
      .from("assets")
      .select("id, filename, relative_path, thumbnail_url")
      .in("file_type", ["pdf", "png", "jpg"])
      .eq("is_deleted", false)
      .ilike("filename", "%tech pack%")
      .like("relative_path", `${dirPrefix}/%`)
      .order("thumbnail_url", { ascending: false }) // prefer assets that already have thumbnails
      .limit(1);

    const replacement = replacements?.[0] ?? null;
    let queued = false;

    if (replacement && !replacement.thumbnail_url) {
      // Queue thumbnail render for the replacement
      const { error: rqErr } = await db
        .from("render_queue")
        .insert({ asset_id: replacement.id, status: "pending" });
      if (!rqErr) queued = true;
    }

    // 5. Log the action
    await db.from("ai_sentinel_cleanup_log").insert({
      ai_asset_id: asset.id,
      ai_filename: asset.filename,
      ai_relative_path: asset.relative_path,
      replacement_asset_id: replacement?.id ?? null,
      replacement_filename: replacement?.filename ?? null,
      replacement_relative_path: replacement?.relative_path ?? null,
      replacement_had_thumbnail: replacement ? !!replacement.thumbnail_url : null,
      replacement_queued_for_thumbnail: queued,
    });

    results.push({
      ai_asset_id: asset.id,
      ai_filename: asset.filename,
      replacement_asset_id: replacement?.id ?? null,
      replacement_filename: replacement?.filename ?? null,
      queued,
    });
  }

  const withReplacement = results.filter((r) => r.replacement_asset_id !== null).length;
  const withoutReplacement = results.length - withReplacement;

  return json({
    ok: true,
    processed: results.length,
    with_replacement: withReplacement,
    without_replacement: withoutReplacement,
    queued_for_thumbnail: results.filter((r) => r.queued).length,
    results,
  });
}

// ── POST: start an AI sentinel scan ──────────────────────────────────────────
// Reuses the existing PDF_TEXT_SAMPLE_REQUEST / trigger_pdf_text_sample
// pipeline so the current bridge agent (which already handles that command)
// can do the work without requiring a code update.

const AI_SENTINEL_BATCH_SIZE = 50;

export async function handleTriggerAiSentinelScan(body: Record<string, unknown>) {
  const db = serviceClient();

  const versionErr = await requireBridgeLatest(db);
  if (versionErr) return versionErr;

  const target = Math.min(Number(body.target) || 25, 500);

  // Block if an active PDF sample (non-sentinel) is already running
  const { data: existing } = await db.from("admin_config").select("value").eq("key", "PDF_TEXT_SAMPLE_REQUEST").maybeSingle();
  const existingReq = existing?.value as Record<string, unknown> | null;
  if (existingReq && (existingReq.status === "pending" || existingReq.status === "processing")) {
    return err("A PDF text sample is already in progress. Wait for it to finish first.", 409);
  }

  const { count: totalAi } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("file_type", "ai")
    .eq("is_deleted", false);

  const { data: firstBatch, error } = await db
    .from("assets")
    .select("id, filename, relative_path")
    .eq("file_type", "ai")
    .eq("is_deleted", false)
    .order("id", { ascending: true })
    .limit(AI_SENTINEL_BATCH_SIZE);

  if (error) return err(`Failed to fetch .ai assets: ${error.message}`, 500);
  if (!firstBatch || firstBatch.length === 0) return err("No .ai assets found", 404);

  const lastId = firstBatch[firstBatch.length - 1].id as string;
  const nowIso = new Date().toISOString();

  // Queue via the existing PDF text sample pipeline (bridge agent already handles this)
  await db.from("admin_config").upsert({
    key: "PDF_TEXT_SAMPLE_REQUEST",
    value: {
      status: "pending",
      mode: "ai_sentinel",
      force_bridge: true,
      target,
      batch_size: AI_SENTINEL_BATCH_SIZE,
      found: 0,
      processed: 0,
      total_ai: totalAi ?? 0,
      last_id: lastId,
      assets: firstBatch,
      requested_at: nowIso,
    },
    updated_at: nowIso,
  });

  // Lightweight progress tracker for the sentinel status card
  await db.from("admin_config").upsert({
    key: "AI_SENTINEL_SCAN_REQUEST",
    value: { status: "scanning", target, found: 0, processed: 0, total_ai: totalAi ?? 0, started_at: nowIso },
    updated_at: nowIso,
  });

  return json({ ok: true, total_ai: totalAi, batch_size: AI_SENTINEL_BATCH_SIZE, target });
}
