/**
 * Extracted admin-api handlers for file hygiene scanning and management.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";

// ── list-hygiene-findings ───────────────────────────────────────────

export async function handleListHygieneFindings(body: Record<string, unknown>) {
  const db = serviceClient();
  const status = body.status as string | undefined;
  const checkType = body.check_type as string | undefined;
  const limit = typeof body.limit === "number" ? body.limit : 500;

  let query = db.from("hygiene_findings").select("*").order("found_at", { ascending: false }).limit(limit);

  if (status) query = query.eq("status", status);
  if (checkType) query = query.eq("check_type", checkType);

  const { data, error } = await query;
  if (error) return err(error.message, 500);

  // Summary counts
  const [openRes, dismissedRes, resolvedRes] = await Promise.all([
    db.from("hygiene_findings").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("hygiene_findings").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
    db.from("hygiene_findings").select("id", { count: "exact", head: true }).eq("status", "resolved"),
  ]);
  const summaryData = {
    open: openRes.count ?? 0,
    dismissed: dismissedRes.count ?? 0,
    resolved: resolvedRes.count ?? 0,
    total: (openRes.count ?? 0) + (dismissedRes.count ?? 0) + (resolvedRes.count ?? 0),
  };

  return json({ ok: true, findings: data || [], summary: summaryData || {} });
}

// ── update-hygiene-findings ─────────────────────────────────────────

export async function handleUpdateHygieneFindings(body: Record<string, unknown>, userId: string) {
  const ids = body.ids as string[];
  const status = body.status as string;

  if (!Array.isArray(ids) || ids.length === 0) return err("ids array required");
  if (!["open", "dismissed", "resolved"].includes(status)) return err("status must be open, dismissed, or resolved");

  const db = serviceClient();
  const { error } = await db.from("hygiene_findings")
    .update({
      status,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) return err(error.message, 500);
  return json({ ok: true, updated: ids.length });
}

// ── trigger-hygiene-scan ────────────────────────────────────────────

export async function handleTriggerHygieneScan(body: Record<string, unknown>, userId: string) {
  const checkTypes = (body.check_types as string[]) || ["ai_embedded_raster"];
  const db = serviceClient();

  await db.from("admin_config").upsert({
    key: "HYGIENE_SCAN_REQUEST",
    value: {
      status: "pending",
      check_types: checkTypes,
      requested_by: userId,
      requested_at: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  return json({ ok: true });
}

// ── stop-hygiene-scan ───────────────────────────────────────────────

export async function handleStopHygieneScan(userId: string) {
  const db = serviceClient();

  const { data } = await db.from("admin_config")
    .select("value").eq("key", "HYGIENE_SCAN_REQUEST").maybeSingle();
  const current = (data?.value as Record<string, unknown>) ?? {};

  if (current.status !== "pending" && current.status !== "claimed") {
    return json({ ok: true, message: "No active scan to stop" });
  }

  await db.from("admin_config").upsert({
    key: "HYGIENE_SCAN_REQUEST",
    value: {
      ...current,
      status: "cancelled",
      cancelled_by: userId,
      cancelled_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  return json({ ok: true, message: "Scan cancellation requested" });
}
