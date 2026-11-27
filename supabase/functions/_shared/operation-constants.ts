import { conflictsFor } from "./operation-policy.js";
export { conflictsFor as getConflicts, getOperationLane as getLane, OP_CONFLICTS, OP_LANES } from "./operation-policy.js";

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
  "ai-tag-parallel": "Parallel File Tagging",
  "ai-tag-group-profiles": "Profile Style Groups",
  "ai-tag-bakeoff": "AI Tag Bake-Off",
  "reconcile-style-group-stats": "Reconcile Stats",
  "erp-enrichment": "ERP Enrichment",
  "erp-classify": "ERP Classify",
  "shorten-item-descriptions": "Shorten Item Descriptions",
  "propagate-group-tags": "Propagate Group Tags (deprecated)",
  "refresh-group-metadata": "Refresh Group Metadata",
  "cleanup-mega-group-tags": "Clean Mega-Group Tags",
  "relink-orphaned-assets": "Relink Orphaned Assets",
  "rich-pdf-extract": "Rich PDF Extract",
  "embed-dam-search": "Embed DAM Search",
  "sg-embed-search": "Embed PopSG Search",
  "tag-popsg-files": "Tag PopSG Files",
  "ai-tag-popsg": "AI-Tag PopSG Files",
  "rebuild-image-vectors": "Rebuild Image Vectors",
};

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
  if (msg.includes("57014") || msg.includes("statement timeout") || msg.includes("lock timeout")) return "statement_timeout";
  if (msg.includes("user_stop") || msg.includes("stopped by user")) return "user_stop";
  if (msg.includes("connection reset") || msg.includes("connection error")) return "connection_error";
  return "unknown";
}

/**
 * Returns the first currently-running op that conflicts with `opKey`,
 * or null if there are no conflicts.
 */
export function findRunningConflict(
  opKey: string,
  allOps: Record<string, { status: string }>,
): string | null {
  if (opKey === "ai-tag-parallel") {
    for (const [key, op] of Object.entries(allOps)) if (key.startsWith("ai-tag-single-") && op.status === "running") return key;
  }
  for (const conflictKey of conflictsFor(opKey)) {
    if (allOps[conflictKey]?.status === "running") return conflictKey;
  }
  return null;
}

// ── Operation action mapping ────────────────────────────────────────

export const OP_ACTIONS: Record<string, string> = {
  "reprocess-metadata": "reprocess-asset-metadata",
  "backfill-sku-names": "backfill-sku-names",
  "rebuild-style-groups": "rebuild-style-groups",
  "ai-tag-untagged": "bulk-ai-tag",
  "ai-tag-all": "bulk-ai-tag-all",
  "ai-tag-groups": "bulk-ai-tag-all",
  "ai-tag-parallel": "bulk-ai-tag-all",
  "ai-tag-group-profiles": "ai-tag-group-profiles",
  "ai-tag-bakeoff": "ai-tag-bakeoff",
  "reconcile-style-group-stats": "reconcile-style-group-stats",
  "erp-enrichment": "apply-erp-enrichment",
  "shorten-item-descriptions": "shorten-item-descriptions",
  "propagate-group-tags": "bulk-propagate-group-tags",
  "refresh-group-metadata": "refresh-group-metadata",
  "cleanup-mega-group-tags": "cleanup-mega-group-tags",
  "rich-pdf-extract": "rich-pdf-extract",
  "embed-dam-search": "embed-dam-search",
  "sg-embed-search": "sg-embed-search",
  "tag-popsg-files": "tag-popsg-files",
  "rebuild-image-vectors": "rebuild-image-vectors",
};
