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
  "cleanup-mega-group-tags": "Clean Mega-Group Tags",
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
  "propagate-group-tags": "style-groups",
  "cleanup-mega-group-tags": "style-groups",
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
  if (msg.includes("57014") || msg.includes("statement timeout") || msg.includes("lock timeout")) return "statement_timeout";
  if (msg.includes("user_stop") || msg.includes("stopped by user")) return "user_stop";
  if (msg.includes("connection reset") || msg.includes("connection error")) return "connection_error";
  return "unknown";
}

// ── Cross-lane conflict map ─────────────────────────────────────────
// Operations in the SAME lane are already serialized by the lane system.
// This map enforces additional mutual-exclusion across DIFFERENT lanes.
//
// If op A lists op B here, they cannot run at the same time — the later-
// starting op is deferred (queued/auto-resume held) until the other finishes.
// Entries must be symmetric: if A blocks B then B must also block A.
//
// Confirmed incidents:
//   ai-tag-* + propagate-group-tags (2026-04-01, 2026-04-05): both wrote
//   asset_tags / asset_characters / assets concurrently → lock contention →
//   120 s statement timeout.
//
//   The assets UPDATE was fixed with FOR UPDATE SKIP LOCKED (migration
//   20260405000000). However INSERT INTO asset_tags / asset_characters still
//   experiences speculative-insert index locks when both jobs try to insert the
//   same (asset_id, tag) pair simultaneously (one waits for the other to commit
//   before resolving the ON CONFLICT). Across many groups with many siblings
//   these waits accumulate and still breach the 120 s statement_timeout.
//   Until the INSERT paths are also made lock-free these two jobs must not run
//   at the same time.
//
// Remaining risks (data-integrity, not just lock-wait):
//   ai-tag-* + rebuild-style-groups: rebuild clears style_group_id on every
//   asset while ai-tag reads it to scope propagation → tags propagate to the
//   wrong group or are lost entirely.
//
//   reprocess-metadata + ai-tag-*: both write licensor_id, property_id,
//   is_licensed, workflow_status on assets → last-writer-wins data races.
//
//   erp-enrichment + reprocess-metadata / backfill-sku-names: all three write
//   licensor/property code columns on assets and style_groups → data races.

export const OP_CONFLICTS: Readonly<Record<string, readonly string[]>> = {
  "ai-tag-untagged": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags"],
  "ai-tag-all": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags"],
  "ai-tag-groups": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags"],
  "propagate-group-tags": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups"],
  "rebuild-style-groups": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups"],
  "reprocess-metadata": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "erp-enrichment"],
  "backfill-sku-names": ["erp-enrichment"],
  "erp-enrichment": ["reprocess-metadata", "backfill-sku-names"],
};

/** Returns the ops that `opKey` cannot run alongside (empty array if none). */
export function getConflicts(opKey: string): readonly string[] {
  return OP_CONFLICTS[opKey] ?? [];
}

/**
 * Returns the first currently-running op that conflicts with `opKey`,
 * or null if there are no conflicts.
 */
export function findRunningConflict(
  opKey: string,
  allOps: Record<string, { status: string }>,
): string | null {
  for (const conflictKey of getConflicts(opKey)) {
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
  "reconcile-style-group-stats": "reconcile-style-group-stats",
  "erp-enrichment": "apply-erp-enrichment",
  "erp-classify": "classify-erp-categories",
  "propagate-group-tags": "bulk-propagate-group-tags",
  "cleanup-mega-group-tags": "cleanup-mega-group-tags",
};
