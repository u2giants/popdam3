export const ASSET_TAG_CATEGORIES = [
  "file_type", "view", "scene", "color", "visible_content", "technique", "other",
];

export const GROUP_TAG_CATEGORIES = [
  "product_type", "theme", "style", "occasion", "audience", "technique", "other",
];

export const TAG_STATUSES = ["active", "candidate", "rejected"];

export const TAG_SOURCE_PRIORITY = Object.freeze({
  manual: 400,
  authoritative: 300,
  rich_pdf: 250,
  group_ai: 200,
  file_ai: 100,
  ai: 100,
  legacy_unscoped: 50,
});

export const GROUP_AI_AUTO_PROMOTION_CONFIDENCE = 0.85;
export const GROUP_AI_AUTO_PROMOTION_MIN_EVIDENCE = 2;

export function normalizeMetadataTag(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function sourcePriority(source) {
  return TAG_SOURCE_PRIORITY[source] ?? 0;
}

export function groupAiStatus(confidence, evidenceAssetIds) {
  const distinctEvidence = new Set((evidenceAssetIds ?? []).filter(Boolean));
  return Number(confidence) >= GROUP_AI_AUTO_PROMOTION_CONFIDENCE &&
    distinctEvidence.size >= GROUP_AI_AUTO_PROMOTION_MIN_EVIDENCE
    ? "active"
    : "candidate";
}

export function deriveAuthoritativeGroupTags(group) {
  const candidates = [
    [group?.product_category, "product_type"],
    [group?.big_theme, "theme"],
    [group?.little_theme, "theme"],
    [group?.design_style, "style"],
  ];
  const seen = new Set();
  return candidates.flatMap(([rawTag, category]) => {
    const tag = normalizeMetadataTag(rawTag);
    if (!tag || seen.has(tag)) return [];
    seen.add(tag);
    return [{ tag, category, source: "authoritative", status: "active", confidence: 1, evidence: { field: category } }];
  });
}
