// ── Parallel Lane System ────────────────────────────────────────────
// Operations in DIFFERENT lanes can run simultaneously.
// Operations in the SAME lane are mutually exclusive (conflict).

export const OP_LANES = {
  "ai-tag-untagged": "ai-tagging",
  "ai-tag-all": "ai-tagging",
  "ai-tag-groups": "ai-tagging",
  "ai-tag-parallel": "ai-parallel",
  "ai-tag-group-profiles": "ai-tagging",
  "ai-tag-bakeoff": "ai-tagging",
  "rebuild-style-groups": "style-groups",
  "reconcile-style-group-stats": "style-groups",
  "reprocess-metadata": "metadata",
  "backfill-sku-names": "metadata",
  "erp-enrichment": "erp",
  "erp-classify": "erp",
  "shorten-item-descriptions": "item-descriptions",
  "propagate-group-tags": "style-groups",
  "refresh-group-metadata": "style-groups",
  "cleanup-mega-group-tags": "style-groups",
  "relink-orphaned-assets": "style-groups",
  "rich-pdf-extract": "rich-pdf",
  "embed-dam-search": "search-index",
  "sg-embed-search": "search-index",
  "tag-popsg-files": "popsg-tags",
  "rebuild-image-vectors": "embed",
};

export function getOperationLane(opKey) {
  return OP_LANES[opKey] ?? opKey; // fallback: each unknown op is its own lane
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

export const OP_CONFLICTS = {
  "ai-tag-untagged": [
    "ai-tag-parallel",
    "rebuild-style-groups",
    "reprocess-metadata",
    "propagate-group-tags",
    "ai-tag-group-profiles",
    "refresh-group-metadata",
  ],
  "ai-tag-all": [
    "ai-tag-parallel",
    "rebuild-style-groups",
    "reprocess-metadata",
    "propagate-group-tags",
    "ai-tag-group-profiles",
    "refresh-group-metadata",
    "rebuild-image-vectors",
  ],
  "ai-tag-groups": ["ai-tag-parallel", "rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "ai-tag-parallel": [
    "ai-tag-untagged",
    "ai-tag-all",
    "ai-tag-groups",
    "rebuild-style-groups",
    "reprocess-metadata",
    "propagate-group-tags",
    "ai-tag-group-profiles",
    "refresh-group-metadata",
  ],
  "ai-tag-group-profiles": [
    "rebuild-style-groups",
    "reprocess-metadata",
    "propagate-group-tags",
    "ai-tag-untagged",
    "ai-tag-all",
    "ai-tag-groups",
    "ai-tag-parallel",
    "ai-tag-bakeoff",
    "refresh-group-metadata",
  ],
  "ai-tag-bakeoff": ["rebuild-style-groups", "reprocess-metadata", "propagate-group-tags", "ai-tag-group-profiles", "refresh-group-metadata"],
  "propagate-group-tags": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "refresh-group-metadata": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "ai-tag-group-profiles"],
  "rebuild-style-groups": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "rich-pdf-extract", "ai-tag-group-profiles"],
  "rich-pdf-extract": ["rebuild-style-groups"],
  "reprocess-metadata": ["ai-tag-untagged", "ai-tag-all", "ai-tag-groups", "ai-tag-parallel", "ai-tag-bakeoff", "erp-enrichment", "ai-tag-group-profiles"],
  "backfill-sku-names": ["erp-enrichment"],
  "erp-enrichment": ["reprocess-metadata", "backfill-sku-names"],
  // rebuild-image-vectors mass-enqueues image-embed index jobs while ai-tag-all
  // churns assets and thumbnails — keep them apart (plan Step 4b, L-6).
  "rebuild-image-vectors": ["ai-tag-all"],
};

/** Returns the ops that `opKey` cannot run alongside (empty array if none). */
export function conflictsFor(opKey) {
  return OP_CONFLICTS[opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey] ?? [];
}
