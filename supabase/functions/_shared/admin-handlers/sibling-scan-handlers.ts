/**
 * Extracted admin-api handlers for sibling image scanning and ingestion.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";

// ── list-sibling-images ─────────────────────────────────────────────

export async function handleListSiblingImages(body: Record<string, unknown>) {
  const rawPath = requireString(body, "folder_path");
  const styleGroupId = optionalString(body, "style_group_id");
  const folderPath = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const db = serviceClient();

  // Check for a recent completed result for this folder (within 10 minutes)
  const { data: existingRows } = await db
    .from("admin_config")
    .select("key, value, updated_at")
    .like("key", "sibling_scan_request_%")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (existingRows) {
    for (const row of existingRows) {
      const val = row.value as Record<string, unknown>;
      if (!val || val.folder_path !== folderPath) continue;

      if (val.status === "completed") {
        console.log(`[list-sibling-images] Returning cached result for ${folderPath}`);
        return json({
          ok: true,
          status: "completed",
          request_id: row.key.replace("sibling_scan_request_", ""),
          images: val.images ?? [],
        });
      }

      if (val.status === "failed") {
        console.log(`[list-sibling-images] Returning cached failure for ${folderPath}`);
        return json({
          ok: true,
          status: "failed",
          request_id: row.key.replace("sibling_scan_request_", ""),
          images: [],
          error_message: val.error_message ?? "Scan failed",
        });
      }

      if (val.status === "pending" || val.status === "claimed") {
        console.log(`[list-sibling-images] Already ${val.status} for ${folderPath}`);
        return json({
          ok: true,
          status: "pending",
          request_id: row.key.replace("sibling_scan_request_", ""),
          images: [],
        });
      }
    }
  }

  // No recent result — create new pending request
  const requestId = crypto.randomUUID();
  console.log(`[list-sibling-images] Queuing new request ${requestId} for ${folderPath}`);
  const { error } = await db.from("admin_config").upsert({
    key: `sibling_scan_request_${requestId}`,
    value: {
      folder_path: folderPath,
      style_group_id: styleGroupId,
      requested_at: new Date().toISOString(),
      status: "pending",
      extensions: [".jpg", ".jpeg", ".png", ".pdf"],
    },
    updated_at: new Date().toISOString(),
  });

  if (error) return err(error.message, 500);

  return json({
    ok: true,
    status: "pending",
    request_id: requestId,
    images: [],
  });
}

// ── get-sibling-scan-result ─────────────────────────────────────────

export async function handleGetSiblingScanResult(body: Record<string, unknown>) {
  const requestId = requireString(body, "request_id");
  const db = serviceClient();

  const { data, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", `sibling_scan_request_${requestId}`)
    .maybeSingle();

  if (error) return err(error.message, 500);
  if (!data) return err("Request not found", 404);

  const val = data.value as Record<string, unknown>;
  return json({
    ok: true,
    status: val.status ?? "pending",
    images: val.images ?? [],
    error_message: val.error_message ?? null,
    processed_at: val.processed_at ?? null,
  });
}

// ── get-sibling-scan-by-folder ──────────────────────────────────────

export async function handleGetSiblingScanByFolder(body: Record<string, unknown>) {
  const rawPath = requireString(body, "folder_path");
  const folderPath = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const db = serviceClient();

  const { data: rows } = await db
    .from("admin_config")
    .select("key, value")
    .like("key", "sibling_scan_request_%")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (rows) {
    for (const row of rows) {
      const val = row.value as Record<string, unknown>;
      if (!val || val.folder_path !== folderPath) continue;

      const requestId = row.key.replace("sibling_scan_request_", "");

      if (val.status === "completed") {
        return json({
          ok: true,
          found: true,
          status: "completed",
          request_id: requestId,
          images: val.images ?? [],
          processed_at: val.processed_at ?? null,
        });
      }

      if (val.status === "failed") {
        return json({
          ok: true,
          found: true,
          status: "failed",
          request_id: requestId,
          images: [],
          error_message: val.error_message ?? "Scan failed",
          processed_at: val.processed_at ?? null,
        });
      }

      if (val.status === "pending" || val.status === "claimed") {
        return json({
          ok: true,
          found: true,
          status: "pending",
          request_id: requestId,
          images: [],
        });
      }
    }
  }

  return json({ ok: true, found: false });
}

// ── ingest-sibling-images ───────────────────────────────────────────

export async function handleIngestSiblingImages(body: Record<string, unknown>, userId: string) {
  const styleGroupId = requireString(body, "style_group_id");
  const images = body.images;
  if (!Array.isArray(images) || images.length === 0) {
    return err("images must be a non-empty array");
  }
  if (images.length > 50) {
    return err("Maximum 50 images per ingestion request");
  }

  const db = serviceClient();

  // Verify style group exists
  const { data: sg, error: sgErr } = await db
    .from("style_groups")
    .select("id, sku, folder_path")
    .eq("id", styleGroupId)
    .maybeSingle();
  if (sgErr) return err(sgErr.message, 500);
  if (!sg) return err("Style group not found", 404);

  const results: Array<{ filename: string; action: string; asset_id?: string; error?: string }> = [];
  const now = new Date().toISOString();

  for (const img of images) {
    const imgObj = img as Record<string, unknown>;
    const relativePath = typeof imgObj.relative_path === "string" ? imgObj.relative_path : "";
    const filename = typeof imgObj.filename === "string" ? imgObj.filename : "";
    const fileSize = typeof imgObj.file_size === "number" ? imgObj.file_size : 0;
    const thumbnailUrl = typeof imgObj.thumbnail_url === "string" ? imgObj.thumbnail_url : null;

    if (!relativePath || !filename) {
      results.push({ filename: filename || "unknown", action: "error", error: "Missing relative_path or filename" });
      continue;
    }

    // Check if asset already exists at this path
    const { data: existing } = await db
      .from("assets")
      .select("id")
      .eq("relative_path", relativePath)
      .maybeSingle();

    if (existing) {
      await db.from("assets").update({ style_group_id: styleGroupId }).eq("id", existing.id);
      results.push({ filename, action: "linked", asset_id: existing.id });
      continue;
    }

    // Determine file_type from extension
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const extMap: Record<string, string> = { psd: "psd", ai: "ai", jpg: "jpg", jpeg: "jpg", png: "png", pdf: "pdf" };
    const fileType = extMap[ext] ?? "jpg";

    const { data: inserted, error: insertErr } = await db
      .from("assets")
      .insert({
        relative_path: relativePath,
        filename,
        file_type: fileType,
        file_size: fileSize,
        modified_at: now,
        quick_hash: `sibling_${relativePath}`,
        quick_hash_version: 0,
        thumbnail_url: thumbnailUrl,
        style_group_id: styleGroupId,
        sku: sg.sku,
        last_seen_at: now,
        ingested_at: now,
      })
      .select("id")
      .single();

    if (insertErr) {
      results.push({ filename, action: "error", error: insertErr.message });
    } else {
      results.push({ filename, action: "created", asset_id: inserted.id });
    }
  }

  // Refresh style group counts
  const groupIds = [styleGroupId];
  try {
    await db.rpc("refresh_style_group_counts_batch", { p_group_ids: groupIds });
    await db.rpc("refresh_style_group_primaries", { p_group_ids: groupIds });
  } catch (e) {
    console.warn("Failed to refresh style group stats:", e);
  }

  const created = results.filter((r) => r.action === "created").length;
  const linked = results.filter((r) => r.action === "linked").length;
  const errors = results.filter((r) => r.action === "error").length;

  return json({ ok: true, results, summary: { created, linked, errors } });
}
