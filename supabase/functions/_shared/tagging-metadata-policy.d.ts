export const ASSET_TAG_CATEGORIES: readonly string[];
export const GROUP_TAG_CATEGORIES: readonly string[];
export const TAG_STATUSES: readonly string[];
export const TAG_SOURCE_PRIORITY: Readonly<Record<string, number>>;
export const GROUP_AI_AUTO_PROMOTION_CONFIDENCE: number;
export const GROUP_AI_AUTO_PROMOTION_MIN_EVIDENCE: number;
export function normalizeMetadataTag(value: unknown): string;
export function sourcePriority(source: string): number;
export function groupAiStatus(confidence: number, evidenceAssetIds: string[]): "active" | "candidate";
export function deriveAuthoritativeGroupTags(group: {
  product_category?: string | null;
  big_theme?: string | null;
  little_theme?: string | null;
  design_style?: string | null;
}): Array<{ tag: string; category: string; source: "authoritative"; status: "active"; confidence: 1; evidence: { field: string } }>;
