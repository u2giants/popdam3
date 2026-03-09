/**
 * Shared operation constants for bulk jobs.
 * Single source of truth for operation names, lanes, and reason codes.
 */

// ── Operation display names ─────────────────────────────────────────

export const OP_NAMES: Record<string, string> = {
  "reprocess-metadata": "Reprocess Metadata",
  "backfill-sku-names": "Backfill SKU Names",
  "rebuild-style-groups": "Rebuild Style Groups",
  "ai-tag-untagged": "AI Tag Untagged",
  "ai-tag-all": "Re-tag Everything",
  "ai-tag-groups": "AI Tag Groups",
  "reconcile-style-group-stats": "Reconcile Stats",
  "erp-enrichment": "ERP Enrichment",
  "erp-classify": "ERP Classify",
  "propagate-group-tags": "Propagate Group Tags",
};

// ── Parallel Lane System ────────────────────────────────────────────
// Operations in DIFFERENT lanes can run simultaneously.
// Operations in the SAME lane are mutually exclusive (conflict).

export const OP_LANES: Record<string, string> = {
  "ai-tag-untagged": "ai-tagging",
  "ai-tag-all": "ai-tagging",
  "ai-tag-groups": "ai-tagging",
  "rebuild-style-groups": "style-groups",
  "reconcile-style-group-stats": "style-groups",
  "reprocess-metadata": "metadata",
  "backfill-sku-names": "metadata",
  "erp-enrichment": "erp",
  "erp-classify": "erp",
  "propagate-group-tags": "ai-tagging",
};

export function getLane(opKey: string): string {
  return OP_LANES[opKey] ?? opKey; // fallback: each unknown op is its own lane
}

// ── Interruption reason codes ───────────────────────────────────────

export const REASON_LABELS: Record<string, string> = {
  gateway_timeout: "Gateway timeout (502/503/504)",
  statement_timeout: "Database statement timeout",
  rate_limited: "Rate limited (429)",
  user_stop: "Stopped by user",
  stale_run: "No progress detected (stale lock)",
  connection_error: "Connection error",
  legacy_format: "Legacy operation format",
  unknown: "Unknown reason",
};

export function classifyInterruptionReason(
  statusCode: number | null,
  errorMsg: string,
): string {
  if (!errorMsg && !statusCode) return "unknown";
  const msg = (errorMsg || "").toLowerCase();
  if (statusCode === 429 || msg.includes("rate limit exceeded")) return "rate_limited";
  if (statusCode && [502, 503, 504].includes(statusCode)) return "gateway_timeout";
  if (msg.includes("57014") || msg.includes("statement timeout")) return "statement_timeout";
  if (msg.includes("user_stop") || msg.includes("stopped by user")) return "user_stop";
  if (msg.includes("connection reset") || msg.includes("connection error")) return "connection_error";
  return "unknown";
}

// ── Operation action mapping ────────────────────────────────────────

export const OP_ACTIONS: Record<string, string> = {
  "reprocess-metadata": "reprocess-asset-metadata",
  "backfill-sku-names": "backfill-sku-names",
  "rebuild-style-groups": "rebuild-style-groups",
  "ai-tag-untagged": "bulk-ai-tag",
  "ai-tag-all": "bulk-ai-tag-all",
  "ai-tag-groups": "bulk-ai-tag-all",
  "reconcile-style-group-stats": "reconcile-style-group-stats",
  "erp-enrichment": "apply-erp-enrichment",
  "erp-classify": "classify-erp-categories",
};
