/**
 * Extracted admin-api handlers for ERP browsing, review queue, sync triggers, and stats.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";

// ── trigger-erp-sync ────────────────────────────────────────────────

export async function handleTriggerErpSync(body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const syncBody: Record<string, unknown> = {};
  if (body.full_sync === true) syncBody.full_sync = true;
  if (body.startDate) syncBody.startDate = body.startDate;
  if (body.endDate) syncBody.endDate = body.endDate;

  const resp = await fetch(`${supabaseUrl}/functions/v1/erp-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(syncBody),
  });

  const contentType = resp.headers.get("content-type") || "";
  const text = await resp.text();

  if (!resp.ok) {
    const looksHtml = /<!doctype|<html|<head>/i.test(text);
    if (looksHtml) {
      return err("ERP sync backend returned an HTML 500 page (transient infrastructure error). Please retry.", 502);
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* ignore */ }
    return err((parsed.error as string) || `erp-sync returned ${resp.status}`, resp.status);
  }

  if (!contentType.includes("application/json")) {
    const looksHtml = /<!doctype|<html|<head>/i.test(text);
    if (looksHtml) {
      return err("ERP sync backend returned HTML instead of JSON (transient infrastructure error). Please retry.", 502);
    }
    return err(`Unexpected ERP sync response format: ${contentType || "unknown"}`, 502);
  }

  let result: Record<string, unknown> = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    return err("ERP sync backend returned malformed JSON.", 502);
  }
  return json({ ok: true, ...result });
}

// ── erp-sync-runs ───────────────────────────────────────────────────

export async function handleErpSyncRuns() {
  const db = serviceClient();
  const { data, error } = await db.from("erp_sync_runs")
    .select("id, status, started_at, ended_at, total_fetched, total_upserted, total_errors, error_samples, created_by, run_metadata")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) return err(error.message, 500);
  return json({ ok: true, runs: data });
}

// ── erp-enrichment-stats ────────────────────────────────────────────

export async function handleErpEnrichmentStats() {
  const db = serviceClient();

  const { count: totalErp } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true });

  const { count: withMgCat } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .not("mg_category", "is", null);

  const { count: pendingReview } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: aiClassified } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["approved", "auto_applied"]);

  const { count: ruleClassified } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .is("mg_category", null)
    .not("mg01_code", "is", null);

  const { count: needsAiRaw } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .is("mg_category", null);

  const { count: alreadyHandled } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["auto_applied", "approved", "pending"]);

  const needsAi = Math.max(0, (needsAiRaw ?? 0) - (alreadyHandled ?? 0));

  const { count: skuMatched } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .not("style_number", "is", null);

  // Items where mg01_code couldn't be resolved to a schema code (single-char)
  // These stored descriptions in the code field (pre-fix) or have unmatched API values
  const { count: unresolvedMg } = await db.from("erp_items_current")
    .select("*", { count: "exact", head: true })
    .not("mg01_code", "is", null)
    .not("mg01_code", "like", "_"); // single-char codes are length 1; descriptions are longer

  return json({
    ok: true,
    total_erp_items: totalErp ?? 0,
    with_mg_category: withMgCat ?? 0,
    rule_classified: ruleClassified ?? 0,
    ai_classified: aiClassified ?? 0,
    needs_ai: needsAi,
    pending_review: pendingReview ?? 0,
    sku_matched: skuMatched ?? 0,
    unmatched_skus: (totalErp ?? 0) - (skuMatched ?? 0),
    unresolved_mg_codes: unresolvedMg ?? 0,
  });
}

// ── erp-review-queue ────────────────────────────────────────────────

export async function handleErpReviewQueue(body: Record<string, unknown> = {}) {
  const db = serviceClient();
  const statusFilter = typeof body.status === "string" ? body.status : "pending";
  const page = typeof body.page === "number" ? Math.max(1, body.page) : 1;
  const pageSize = typeof body.page_size === "number" ? Math.min(body.page_size, 200) : 100;
  const offset = (page - 1) * pageSize;

  const validStatuses = ["pending", "low_confidence", "auto_applied", "approved", "rejected", "unclassifiable", "all"];
  if (!validStatuses.includes(statusFilter)) return err(`Invalid status filter: ${statusFilter}`);

  const isLowConfidenceFilter = statusFilter === "low_confidence";
  const effectiveStatus = isLowConfidenceFilter ? "pending" : statusFilter;

  let countQuery = db.from("product_category_predictions").select("id", { count: "exact", head: true });
  if (effectiveStatus !== "all") countQuery = countQuery.eq("status", effectiveStatus);
  if (isLowConfidenceFilter) countQuery = countQuery.lt("confidence", 0.5);
  const { count: totalCount, error: countErr } = await countQuery;
  if (countErr) return err(countErr.message, 500);

  // Parallel status count queries
  const statuses = ["pending", "auto_applied", "approved", "rejected", "unclassifiable"];
  const [statusResults, lowConfRes] = await Promise.all([
    Promise.all(statuses.map((s) =>
      db.from("product_category_predictions").select("id", { count: "exact", head: true }).eq("status", s)
        .then((r) => ({ status: s, count: r.count ?? 0 }))
    )),
    db.from("product_category_predictions")
      .select("id", { count: "exact", head: true }).eq("status", "pending").lt("confidence", 0.5),
  ]);
  const statusCounts: Record<string, number> = {};
  for (const r of statusResults) statusCounts[r.status] = r.count;
  statusCounts["low_confidence"] = lowConfRes.count ?? 0;

  let query = db.from("product_category_predictions")
    .select("id, external_id, predicted_category, confidence, rationale, classification_source, ai_model, status, created_at");
  if (effectiveStatus !== "all") query = query.eq("status", effectiveStatus);
  if (isLowConfidenceFilter) query = query.lt("confidence", 0.5);
  query = query.order("confidence", { ascending: true }).range(offset, offset + pageSize - 1);

  const { data, error } = await query;
  if (error) return err(error.message, 500);

  // Enrich with item descriptions
  const externalIds = (data || []).map((d: any) => d.external_id);
  const { data: erpItems } = await db.from("erp_items_current")
    .select("external_id, item_description, style_number")
    .in("external_id", externalIds.length > 0 ? externalIds : ["__none__"]);

  const descMap: Record<string, { description: string; style_number: string }> = {};
  for (const item of erpItems || []) {
    descMap[item.external_id] = {
      description: item.item_description || "",
      style_number: item.style_number || "",
    };
  }

  const items = (data || []).map((d: any) => ({
    ...d,
    description: descMap[d.external_id]?.description || null,
    style_number: descMap[d.external_id]?.style_number || d.external_id,
  }));

  return json({
    ok: true,
    items,
    total: totalCount ?? 0,
    page,
    page_size: pageSize,
    total_pages: Math.ceil((totalCount ?? 0) / pageSize),
    status_counts: statusCounts,
  });
}

// ── erp-review-action ───────────────────────────────────────────────

export async function handleErpReviewAction(body: Record<string, unknown>, userId: string) {
  const action = requireString(body, "review_action");

  if (!["approve", "reject", "revert", "bulk-reject", "bulk-dismiss"].includes(action)) {
    return err("review_action must be 'approve', 'reject', 'revert', 'bulk-reject', or 'bulk-dismiss'");
  }

  const db = serviceClient();
  const now = new Date().toISOString();

  if (action === "bulk-reject") {
    const ids = body.prediction_ids;
    if (!Array.isArray(ids) || ids.length === 0) return err("prediction_ids must be a non-empty array");
    const { error } = await db.from("product_category_predictions")
      .update({ status: "rejected", reviewed_by: userId === "system" ? null : userId, reviewed_at: now })
      .in("id", ids);
    if (error) return err(error.message, 500);
    return json({ ok: true, count: ids.length });
  }

  if (action === "bulk-dismiss") {
    const ids = body.prediction_ids;
    if (!Array.isArray(ids) || ids.length === 0) return err("prediction_ids must be a non-empty array");
    const { error } = await db.from("product_category_predictions")
      .update({ status: "unclassifiable", reviewed_by: userId === "system" ? null : userId, reviewed_at: now })
      .in("id", ids);
    if (error) return err(error.message, 500);
    return json({ ok: true, count: ids.length });
  }

  const predictionId = requireString(body, "prediction_id");

  if (action === "revert") {
    const { error } = await db.from("product_category_predictions")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null })
      .eq("id", predictionId);
    if (error) return err(error.message, 500);
    return json({ ok: true });
  }

  const overrideCategory = optionalString(body, "override_category");

  if (action === "approve") {
    const updates: Record<string, unknown> = {
      status: "approved",
      reviewed_by: userId === "system" ? null : userId,
      reviewed_at: now,
    };
    if (overrideCategory) updates.predicted_category = overrideCategory;
    const { error } = await db.from("product_category_predictions")
      .update(updates).eq("id", predictionId);
    if (error) return err(error.message, 500);
  } else {
    const { error } = await db.from("product_category_predictions")
      .update({ status: "rejected", reviewed_by: userId === "system" ? null : userId, reviewed_at: now })
      .eq("id", predictionId);
    if (error) return err(error.message, 500);
  }

  return json({ ok: true });
}

// ── erp-items-browse ────────────────────────────────────────────────

export async function handleErpItemsBrowse(body: Record<string, unknown>) {
  const db = serviceClient();
  const page = typeof body.page === "number" ? Math.max(1, body.page) : 1;
  const pageSize = typeof body.page_size === "number" ? Math.min(Math.max(1, body.page_size), 2000) : 1000;
  const search = typeof body.search === "string" ? body.search.trim() : "";
  const sortBy = typeof body.sort_by === "string" ? body.sort_by : "synced_at";
  const sortAsc = body.sort_asc === true;
  const maxDigitsStyle = typeof body.max_digits_style === "number" ? body.max_digits_style : null;
  const maxDigitsDesc = typeof body.max_digits_desc === "number" ? body.max_digits_desc : null;
  const showDismissed = body.show_dismissed === true;
  const dateFrom = typeof body.date_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_from) ? body.date_from : null;
  const dateTo = typeof body.date_to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_to) ? body.date_to : null;
  const offset = (page - 1) * pageSize;

  const ALLOWED_SORT_COLS = [
    "external_id",
    "style_number",
    "item_description",
    "mg_category",
    "mg01_code",
    "mg02_code",
    "mg03_code",
    "size_code",
    "licensor_code",
    "property_code",
    "division_code",
    "synced_at",
    "erp_updated_at",
  ];
  const effectiveSort = ALLOWED_SORT_COLS.includes(sortBy) ? sortBy : "synced_at";

  const useRawSql = maxDigitsStyle !== null || maxDigitsDesc !== null || dateFrom !== null || dateTo !== null;

  if (useRawSql) {
    const conditions: string[] = [];
    if (!showDismissed) conditions.push("dismissed = false");

    const digitFilters: string[] = [];
    if (maxDigitsStyle !== null && maxDigitsStyle > 0) {
      digitFilters.push(`(style_number IS NOT NULL AND length(style_number) <= ${maxDigitsStyle})`);
    }
    if (maxDigitsDesc !== null && maxDigitsDesc > 0) {
      digitFilters.push(`(item_description IS NOT NULL AND length(item_description) <= ${maxDigitsDesc})`);
    }
    if (digitFilters.length > 0) conditions.push(`(${digitFilters.join(" OR ")})`);

    if (dateFrom) conditions.push(`erp_updated_at >= '${dateFrom}'`);
    if (dateTo) conditions.push(`erp_updated_at < '${dateTo}'::date + interval '1 day'`);

    if (search) {
      const esc = search.replace(/'/g, "''");
      conditions.push(`(style_number ILIKE '%${esc}%' OR item_description ILIKE '%${esc}%')`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT count(*)::int as cnt FROM erp_items_current ${whereClause}`;
    const dataSql =
      `SELECT id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, size_code, licensor_code, property_code, division_code, prepack_code, prepack_codes, erp_updated_at, synced_at, raw_mg_fields, external_id, dismissed FROM erp_items_current ${whereClause} ORDER BY ${effectiveSort} ${
        sortAsc ? "ASC" : "DESC"
      } NULLS LAST LIMIT ${pageSize} OFFSET ${offset}`;

    const { data: countResult, error: countErr } = await db.rpc("execute_readonly_query", { query_text: countSql });
    if (countErr) console.error("ERP browse count query failed:", countErr.message);
    const total = Array.isArray(countResult) ? (countResult[0]?.cnt ?? 0) : 0;
    const { data: rows, error: dataErr } = await db.rpc("execute_readonly_query", { query_text: dataSql });
    if (dataErr) return err(`ERP browse query failed: ${dataErr.message}`, 500);

    return json({
      ok: true,
      items: Array.isArray(rows) ? rows : [],
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    });
  }

  // Standard Supabase query path
  let countQuery = db.from("erp_items_current").select("id", { count: "exact", head: true });
  if (!showDismissed) countQuery = countQuery.eq("dismissed", false);
  if (search) countQuery = countQuery.or(`style_number.ilike.%${search}%,item_description.ilike.%${search}%`);
  if (dateFrom) countQuery = countQuery.gte("erp_updated_at", dateFrom);
  if (dateTo) countQuery = countQuery.lte("erp_updated_at", dateTo + "T23:59:59Z");
  const { count, error: countErr } = await countQuery;
  if (countErr) return err(countErr.message, 500);

  let dataQuery = db.from("erp_items_current")
    .select(
      "id, external_id, style_number, item_description, mg_category, mg01_code, mg02_code, mg03_code, mg04_code, mg05_code, mg06_code, size_code, licensor_code, property_code, division_code, prepack_code, prepack_codes, erp_updated_at, synced_at, raw_mg_fields, dismissed",
    )
    .order(effectiveSort, { ascending: sortAsc, nullsFirst: false })
    .range(offset, offset + pageSize - 1);
  if (!showDismissed) dataQuery = dataQuery.eq("dismissed", false);
  if (search) dataQuery = dataQuery.or(`style_number.ilike.%${search}%,item_description.ilike.%${search}%`);
  if (dateFrom) dataQuery = dataQuery.gte("erp_updated_at", dateFrom);
  if (dateTo) dataQuery = dataQuery.lte("erp_updated_at", dateTo + "T23:59:59Z");
  const { data, error: dataErr } = await dataQuery;
  if (dataErr) return err(dataErr.message, 500);

  return json({
    ok: true,
    items: data || [],
    total: count ?? 0,
    page,
    page_size: pageSize,
    total_pages: Math.ceil((count ?? 0) / pageSize),
  });
}

// ── erp-items-dismiss ───────────────────────────────────────────────

export async function handleErpItemsDismiss(body: Record<string, unknown>) {
  const db = serviceClient();
  const ids = body.ids;
  const dismiss = body.dismiss !== false;
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array", 400);
  if (ids.length > 5000) return err("Max 5000 items per batch", 400);

  const { error } = await db.from("erp_items_current")
    .update({ dismissed: dismiss })
    .in("id", ids);
  if (error) return err(error.message, 500);

  return json({ ok: true, updated: ids.length, dismissed: dismiss });
}
