/**
 * Extracted admin-api handlers for ERP browsing, review queue, sync triggers, and stats.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";
import {
  canonicalItemKey,
  canonicalItemKeySql,
  canonicalItems,
  predictionSourceId,
} from "../canonical-erp-items.ts";

// ── erp-enrichment-stats ────────────────────────────────────────────

export async function handleErpEnrichmentStats() {
  const db = serviceClient();

  const { count: totalErp } = await canonicalItems(db)
    .select("*", { count: "exact", head: true });

  const { count: withMgCat } = await canonicalItems(db)
    .select("*", { count: "exact", head: true })
    .not("mg_category", "is", null);

  const { count: pendingReview } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: aiClassified } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["approved", "auto_applied"]);

  const { count: ruleClassified } = await canonicalItems(db)
    .select("*", { count: "exact", head: true })
    .is("mg_category", null)
    .not("mg01_code", "is", null);

  const { count: needsAiRaw } = await canonicalItems(db)
    .select("*", { count: "exact", head: true })
    .is("mg_category", null);

  const { count: alreadyHandled } = await db.from("product_category_predictions")
    .select("*", { count: "exact", head: true })
    .in("status", ["auto_applied", "approved", "pending"]);

  const needsAi = Math.max(0, (needsAiRaw ?? 0) - (alreadyHandled ?? 0));

  const { count: skuMatched } = await canonicalItems(db)
    .select("*", { count: "exact", head: true })
    .not("style_number", "is", null);

  // Items where mg01_code couldn't be resolved to a schema code (single-char)
  // These stored descriptions in the code field (pre-fix) or have unmatched API values
  const { count: unresolvedMg } = await canonicalItems(db)
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
  const externalIds = (data || []).map((d: any) => d.external_id as string);
  const sourceIds = [...new Set(externalIds.map(predictionSourceId))];
  const { data: erpItems } = await canonicalItems(db)
    .select("source_id, source_system, division_code, item_description, style_number")
    .in("source_id", sourceIds.length > 0 ? sourceIds : ["__none__"])
    .order("division_code", { ascending: true });

  const descMap: Record<string, { description: string; style_number: string }> = {};
  for (const item of erpItems || []) {
    const value = {
      description: item.item_description || "",
      style_number: item.style_number || "",
    };
    descMap[canonicalItemKey(item)] = value;
    if (!descMap[item.source_id]) descMap[item.source_id] = value;
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

  if (!["approve", "reject", "revert", "bulk-reject", "bulk-dismiss", "bulk-approve"].includes(action)) {
    return err("review_action must be 'approve', 'reject', 'revert', 'bulk-reject', 'bulk-dismiss', or 'bulk-approve'");
  }

  const db = serviceClient();
  const now = new Date().toISOString();

  if (action === "bulk-approve") {
    const ids = body.prediction_ids;
    if (!Array.isArray(ids) || ids.length === 0) return err("prediction_ids must be a non-empty array");
    const { error } = await db.from("product_category_predictions")
      .update({ status: "approved", reviewed_by: userId === "system" ? null : userId, reviewed_at: now })
      .in("id", ids);
    if (error) return err(error.message, 500);
    return json({ ok: true, count: ids.length });
  }

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
  const pageSize = typeof body.page_size === "number" ? Math.min(Math.max(1, body.page_size), 500) : 50;
  const search = typeof body.search === "string" ? body.search.trim() : "";
  const sortBy = typeof body.sort_by === "string" ? body.sort_by : "prediction_confidence";
  const sortAsc = body.sort_asc !== false;
  const showDismissed = body.show_dismissed === true;
  const pendingOnly = body.pending_predictions_only !== false;
  const maxDigitsStyle = typeof body.max_digits_style === "number" ? body.max_digits_style : null;
  const maxDigitsDesc = typeof body.max_digits_desc === "number" ? body.max_digits_desc : null;
  const dateFrom = typeof body.date_from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_from) ? body.date_from : null;
  const dateTo = typeof body.date_to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_to) ? body.date_to : null;
  const offset = (page - 1) * pageSize;

  const SORT_MAP: Record<string, string> = {
    style_number: "e.style_number",
    item_description: "e.item_description",
    mg_category: "e.mg_category",
    mg01_code: "e.mg01_code",
    mg02_code: "e.mg02_code",
    mg03_code: "e.mg03_code",
    synced_at: "e.synced_at",
    erp_updated_at: "e.erp_updated_at",
    prediction_confidence: "p.confidence",
    predicted_category: "p.predicted_category",
    category_then_confidence: "p.predicted_category",
  };
  const effectiveSort = SORT_MAP[sortBy] ?? "e.synced_at";
  const secondarySort = sortBy === "category_then_confidence" ? ", p.confidence ASC NULLS LAST" : "";

  const conditions: string[] = [];
  if (!showDismissed) conditions.push("e.dismissed = false");
  if (maxDigitsStyle !== null && maxDigitsStyle > 0) {
    conditions.push(`(e.style_number IS NOT NULL AND length(e.style_number) <= ${maxDigitsStyle})`);
  }
  if (maxDigitsDesc !== null && maxDigitsDesc > 0) {
    conditions.push(`(e.item_description IS NOT NULL AND length(e.item_description) <= ${maxDigitsDesc})`);
  }
  if (dateFrom) conditions.push(`e.erp_updated_at >= '${dateFrom}'`);
  if (dateTo) conditions.push(`e.erp_updated_at < '${dateTo}'::date + interval '1 day'`);
  if (search) {
    const esc = search.replace(/'/g, "''");
    conditions.push(`(e.style_number ILIKE '%${esc}%' OR e.item_description ILIKE '%${esc}%')`);
  }
  if (pendingOnly) conditions.push("p.id IS NOT NULL");

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const itemKeySql = canonicalItemKeySql("e");
  const predJoin = `LEFT JOIN LATERAL (
    SELECT id, external_id, predicted_category, confidence, rationale, status
    FROM product_category_predictions candidate
    WHERE candidate.status = 'pending'
      AND candidate.external_id IN (${itemKeySql}, e.source_id)
    ORDER BY CASE WHEN candidate.external_id = ${itemKeySql} THEN 0 ELSE 1 END, candidate.created_at DESC
    LIMIT 1
  ) p ON true`;

  const countSql = `SELECT count(*)::int as cnt FROM api.plm_item_list e ${predJoin} ${whereClause}`;
  const dataSql = `SELECT
    e.id, e.source_id as external_id, ${itemKeySql} as item_identity,
    e.style_number, e.item_description, e.mg_category,
    e.mg01_code, e.mg02_code, e.mg03_code, e.size_code, e.licensor_code,
    e.property_code, e.division_code, e.erp_updated_at, e.synced_at,
    jsonb_strip_nulls(jsonb_build_object(
      'mg_category', e.mg_category,
      'mg01', e.mg01_code, 'mg01_code', e.mg01_code,
      'mg02', e.mg02_code, 'mg02_code', e.mg02_code,
      'mg03', e.mg03_code, 'mg03_code', e.mg03_code
    )) as raw_mg_fields,
    e.dismissed,
    p.id as prediction_id, p.predicted_category, p.confidence as prediction_confidence,
    p.rationale as prediction_rationale, p.status as prediction_status
  FROM api.plm_item_list e ${predJoin} ${whereClause}
  ORDER BY ${effectiveSort} ${sortAsc ? "ASC" : "DESC"} NULLS LAST${secondarySort}
  LIMIT ${pageSize} OFFSET ${offset}`;

  const [countRes, dataRes] = await Promise.all([
    db.rpc("execute_readonly_query", { query_text: countSql }),
    db.rpc("execute_readonly_query", { query_text: dataSql }),
  ]);

  if (countRes.error) console.error("ERP browse count failed:", countRes.error.message);
  if (dataRes.error) return err(`ERP browse query failed: ${dataRes.error.message}`, 500);

  const total = Array.isArray(countRes.data) ? (countRes.data[0]?.cnt ?? 0) : 0;

  return json({
    ok: true,
    items: Array.isArray(dataRes.data) ? dataRes.data : [],
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  });
}

// ── erp-items-dismiss ───────────────────────────────────────────────

export async function handleErpItemsDismiss(body: Record<string, unknown>) {
  const db = serviceClient();
  const ids = body.ids;
  const dismiss = body.dismiss !== false;
  if (!Array.isArray(ids) || ids.length === 0) return err("ids must be a non-empty array", 400);
  if (ids.length > 5000) return err("Max 5000 items per batch", 400);

  const itemKeys = ids.filter((id): id is string => typeof id === "string" && id.split("|").length === 3);
  if (itemKeys.length !== ids.length) return err("Every id must be a canonical item identity", 400);

  const { data, error } = await db.rpc("set_popdam_item_dismissed", {
    item_keys: itemKeys,
    dismissed: dismiss,
  });
  if (error) return err(error.message, 500);

  const updated = typeof data === "number" ? data : itemKeys.length;
  return json({ ok: true, updated, dismissed: dismiss });
}
