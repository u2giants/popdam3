export const TAG_STYLE_GROUP_REQUIRED_FIELDS: readonly string[];
export const TAG_STYLE_GROUP_SCHEMA: Record<string, unknown>;
export function buildStyleGroupTaggingPrompt(context: {
  styleGroup: Record<string, unknown>;
  representativeAssets?: Array<{ id: string; descriptor?: string; content_type?: string }>;
  richMetadata?: unknown;
}): string;
