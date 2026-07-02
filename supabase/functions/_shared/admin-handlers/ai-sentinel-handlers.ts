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
import { markAiIgnored } from "../mark-ai-ignored.ts";
import { handleListSiblingImages } from "./sibling-scan-handlers.ts";

// The bridge agent's pdf-text-sampler collapses a confirmed sentinel's extracted_text
// to exactly this canonical phrase. We match it EXACTLY (not as a substring): a real
// artwork file may also contain "saved without PDF Content" somewhere in its real page
// text, and a substring match would wrongly list (and offer to delete) that artwork.
// Detection itself lives in the bridge agent (ai-sentinel-detect.ts).
const SENTINEL_PHRASE = "This is an Adobe® Illustrator® File that was saved without PDF Content.";

// ── GET: stats + pending files (with asset thumbnails) + recent log ──────────

export async function handleGetAiSentinelStatus() {
  const db = serviceClient();
  try {
    const [statsRes, logRes, pendingRes, cleanedUpRes, scanReqRes] = await Promise.all([
      db.rpc("get_ai_sentinel_stats"),
      db
        .from("ai_sentinel_cleanup_log")
        .select("id, ai_filename, ai_relative_path, replacement_filename, replacement_queued_for_thumbnail, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      // Fetch sentinel files with their asset thumbnails so the UI can show them for visual verification.
      // PostgREST can't parse a SQL subquery as a list of UUID values, so we filter
      // already-cleaned-up assets in application code (cleanedUpRes below).
      db
        .from("pdf_text_samples")
        .select("asset_id, filename, relative_path, assets!inner(thumbnail_url, is_deleted)")
        .eq("extracted_text", SENTINEL_PHRASE)
        .eq("assets.is_deleted", false)
        .limit(200),
      db.from("ai_sentinel_cleanup_log").select("ai_asset_id"),
      db.from("admin_config").select("value").eq("key", "AI_SENTINEL_SCAN_REQUEST").maybeSingle(),
    ]);

    if (statsRes.error) throw new Error(`Stats RPC failed: ${statsRes.error.message}`);

    const alreadyCleaned = new Set(
      ((cleanedUpRes.data ?? []) as Array<{ ai_asset_id: string }>).map((r) => r.ai_asset_id),
    );

    // Flatten the join: pull thumbnail_url out of the nested assets object
    const rawPending = ((pendingRes.data ?? []) as unknown as Array<{
      asset_id: string;
      filename: string;
      relative_path: string;
      assets: { thumbnail_url: string | null; is_deleted?: boolean | null } | Array<{ thumbnail_url: string | null; is_deleted?: boolean | null }> | null;
    }>).filter((r) => !alreadyCleaned.has(r.asset_id));

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
      const asset = Array.isArray(r.assets) ? r.assets[0] : r.assets;
      const replacement = replacementMap.get(dir) ?? null;
      return {
        asset_id: r.asset_id,
        filename: r.filename,
        relative_path: r.relative_path,
        thumbnail_url: asset?.thumbnail_url ?? null,
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
  // If the caller passes specific asset_ids, only process those; otherwise batch up to limit.
  const requestedIds = Array.isArray(body.asset_ids) && (body.asset_ids as unknown[]).length > 0 ? (body.asset_ids as string[]) : null;

  // 1. Find .ai assets with sentinel text and no thumbnail, not yet cleaned up
  let pendingQuery = db
    .from("pdf_text_samples")
    .select("asset_id, filename, relative_path, extraction_method")
    .eq("extracted_text", SENTINEL_PHRASE);

  if (requestedIds) {
    pendingQuery = pendingQuery.in("asset_id", requestedIds);
  } else {
    pendingQuery = pendingQuery.limit(limit * 2);
  }

  const { data: pending, error: pendingErr } = await pendingQuery;

  if (pendingErr) return err(`Query failed: ${pendingErr.message}`, 500);
  if (!pending || pending.length === 0) {
    return json({ ok: true, processed: 0, message: "No sentinel .ai files pending cleanup" });
  }

  // Filter to assets that are still alive, have no thumbnail, and not yet in the log
  const assetIds = pending.map((r: { asset_id: string }) => r.asset_id);
  const [assetsRes, alreadyDoneRes] = await Promise.all([
    db.from("assets").select("id, filename, relative_path, thumbnail_url, style_group_id")
      .in("id", assetIds)
      .eq("is_deleted", false)
      .eq("file_type", "ai"),
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

    // 3. Add to scanner permanent ignore list — bridge will never re-ingest this path
    await markAiIgnored(db, asset.relative_path, "no_pdf_compat");

    // 4. Delete its thumbnail from DO Spaces
    if (asset.thumbnail_url && creds) {
      try {
        await deleteSpacesObjects([`thumbnails/${asset.id}.jpg`], creds);
      } catch (e) {
        console.warn(`ai-sentinel: thumbnail delete failed for ${asset.id}:`, (e as Error).message);
      }
    }

    // 5. Queue a sibling image scan for this folder using the standard list-sibling-images
    // flow. The bridge will find any JPG/PNG/PDF on disk; the user can then choose to
    // ingest them via the normal sibling scan UI. We do not auto-ingest here.
    const folderPath = asset.relative_path.replace(/\/[^/]*$/, "");
    await handleListSiblingImages({ folder_path: folderPath, style_group_id: asset.style_group_id ?? undefined });

    // 6. Log the action (no replacement recorded — user picks from sibling scan results)
    await db.from("ai_sentinel_cleanup_log").insert({
      ai_asset_id: asset.id,
      ai_filename: asset.filename,
      ai_relative_path: asset.relative_path,
      replacement_asset_id: null,
      replacement_filename: null,
      replacement_relative_path: null,
      replacement_had_thumbnail: null,
      replacement_queued_for_thumbnail: false,
    });

    results.push({
      ai_asset_id: asset.id,
      ai_filename: asset.filename,
      replacement_asset_id: null,
      replacement_filename: null,
      queued: false,
    });
  }

  return json({
    ok: true,
    processed: results.length,
    sibling_scans_queued: results.length,
    results,
  });
}

// ── POST: start an AI sentinel scan ──────────────────────────────────────────

const AI_SENTINEL_BATCH_SIZE = 50;

export async function handleTriggerAiSentinelScan(body: Record<string, unknown>) {
  const db = serviceClient();

  const versionErr = await requireBridgeLatest(db);
  if (versionErr) return versionErr;

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

  const target = Number(body.target) || (totalAi ?? 999_999);

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

  // Use the dedicated fast-path: heartbeat reads batch + dispatches trigger_ai_sentinel_scan
  // to the bridge which runs a 64KB header check (runAiSentinelScan) per asset.
  // complete-ai-sentinel-scan advances the batch until target is met or all assets processed.
  await db.from("admin_config").upsert({
    key: "AI_SENTINEL_SCAN_REQUEST",
    value: {
      status: "scanning",
      target,
      batch_size: AI_SENTINEL_BATCH_SIZE,
      found: 0,
      processed: 0,
      total_ai: totalAi ?? 0,
      batch: firstBatch,
      last_id: lastId,
      started_at: nowIso,
    },
    updated_at: nowIso,
  });

  return json({ ok: true, total_ai: totalAi, batch_size: AI_SENTINEL_BATCH_SIZE, target });
}

// ── POST: trigger blank thumbnail cleanup ─────────────────────────────────────

const BLANK_THUMB_BATCH_SIZE = 25;

export async function handleTriggerBlankThumbCleanup() {
  const db = serviceClient();

  const { count: total } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .not("thumbnail_url", "is", null)
    .eq("is_deleted", false);

  const { data: firstBatch } = await db
    .from("assets")
    .select("id, thumbnail_url, file_type, relative_path")
    .not("thumbnail_url", "is", null)
    .eq("is_deleted", false)
    .order("id", { ascending: true })
    .limit(BLANK_THUMB_BATCH_SIZE);

  if (!firstBatch || firstBatch.length === 0) return err("No assets with thumbnails found", 404);

  const lastId = firstBatch[firstBatch.length - 1].id as string;
  const nowIso = new Date().toISOString();

  await db.from("admin_config").upsert({
    key: "BLANK_THUMB_CLEANUP_REQUEST",
    value: {
      status: "scanning",
      total: total ?? 0,
      processed: 0,
      cleaned: 0,
      batch: firstBatch,
      last_id: lastId,
      started_at: nowIso,
    },
    updated_at: nowIso,
  });

  return json({ ok: true, total: total ?? 0, batch_size: BLANK_THUMB_BATCH_SIZE });
}

export async function handleGetBlankThumbCleanupStatus() {
  const db = serviceClient();
  const { data } = await db.from("admin_config").select("value").eq("key", "BLANK_THUMB_CLEANUP_REQUEST").maybeSingle();
  return json({ ok: true, cleanup: data?.value ?? null });
}
