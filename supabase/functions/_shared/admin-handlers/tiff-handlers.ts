/**
 * Extracted admin-api handlers for TIFF hygiene operations.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";

// ── trigger-tiff-scan ───────────────────────────────────────────────

export async function handleTriggerTiffScan(userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const { error } = await db.from("admin_config").upsert({
    key: "TIFF_SCAN_REQUEST",
    value: {
      status: "pending",
      request_id: requestId,
      requested_by: userId,
      requested_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId });
}

// ── refresh-tiff-dates ──────────────────────────────────────────────

export async function handleRefreshTiffDates(body: Record<string, unknown>, userId: string) {
  const db = serviceClient();
  const requestId = crypto.randomUUID();

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds.filter((v): v is string => typeof v === "string" && v.length > 0);

  const { error } = await db.from("admin_config").upsert({
    key: "TIFF_REINSPECT_REQUEST",
    value: {
      status: "pending",
      request_id: requestId,
      requested_by: userId,
      requested_at: new Date().toISOString(),
      ids: ids.length > 0 ? ids : null,
      processed_count: 0,
      last_id: null,
    },
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });

  if (error) return err(error.message, 500);
  return json({ ok: true, request_id: requestId, scope: ids.length > 0 ? "selected" : "all_processed" });
}

// ── list-tiff-files ─────────────────────────────────────────────────

export async function handleListTiffFiles(body: Record<string, unknown>) {
  const db = serviceClient();
  const status = optionalString(body, "status");
  const compressionFilter = optionalString(body, "compression");
  const limit = typeof body.limit === "number" ? body.limit : 500;
  const offset = typeof body.offset === "number" ? body.offset : 0;

  let query = db.from("tiff_optimization_queue")
    .select("*", { count: "exact" })
    .order("relative_path", { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (compressionFilter === "none") query = query.eq("compression_type", "none");
  if (compressionFilter === "compressed") query = query.neq("compression_type", "none");

  const { data, error, count } = await query;
  if (error) return err(error.message, 500);

  // Get summary counts using separate queries
  const [totalRes, uncompRes, compRes, processedRes, failedRes, pendingRes] = await Promise.all([
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }),
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }).eq("compression_type", "none"),
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }).neq("compression_type", "none").not("compression_type", "is", null),
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }).eq("status", "completed"),
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("tiff_optimization_queue").select("id", { count: "exact", head: true }).in("status", ["queued_test", "queued_process", "processing"]),
  ]);

  const summary = {
    total: totalRes.count ?? 0,
    uncompressed: uncompRes.count ?? 0,
    compressed: compRes.count ?? 0,
    processed: processedRes.count ?? 0,
    failed: failedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
  };

  return json({ ok: true, files: data, total: count, summary });
}

// ── queue-tiff-jobs ─────────────────────────────────────────────────

export async function handleQueueTiffJobs(body: Record<string, unknown>) {
  const ids = body.ids as string[];
  const mode = requireString(body, "mode"); // 'test' or 'process'
  if (!["test", "process"].includes(mode)) return err("mode must be 'test' or 'process'");
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array");

  const db = serviceClient();
  const newStatus = mode === "test" ? "queued_test" : "queued_process";

  const { error } = await db.from("tiff_optimization_queue")
    .update({ status: newStatus, mode, error_message: null, claimed_by: null, claimed_at: null })
    .in("id", ids)
    .in("status", ["scanned", "failed", "completed"]); // allow re-queue

  if (error) return err(error.message, 500);
  return json({ ok: true, queued: ids.length, mode });
}

// ── delete-tiff-originals ───────────────────────────────────────────

export async function handleDeleteTiffOriginals(body: Record<string, unknown>) {
  const ids = body.ids as string[];
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array");

  const db = serviceClient();

  const { error } = await db.from("tiff_optimization_queue")
    .update({ status: "queued_delete", error_message: null })
    .in("id", ids)
    .eq("original_backed_up", true)
    .eq("original_deleted", false);

  if (error) return err(error.message, 500);
  return json({ ok: true, queued: ids.length });
}

// ── clear-tiff-scan ─────────────────────────────────────────────────

export async function handleClearTiffScan() {
  const db = serviceClient();
  const { error } = await db.from("tiff_optimization_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return err(error.message, 500);

  // Also clear scan request
  await db.from("admin_config").delete().eq("key", "TIFF_SCAN_REQUEST");
  return json({ ok: true });
}
