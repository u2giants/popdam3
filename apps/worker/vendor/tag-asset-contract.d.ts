export const TAG_ASSET_REQUIRED_FIELDS: string[];
export const TAG_ASSET_SCHEMA: Record<string, unknown>;

export function buildTaggingSystemPrompt(context: {
  asset: {
    filename?: string | null;
    relative_path?: string | null;
    file_type?: string | null;
    tags?: string[] | null;
  };
  taxonomyContext: string;
  erpDescription?: string | null;
  extractedPdfText?: string | null;
  customInstructions?: string | null;
  usingPriorityOnly?: boolean;
}): string;

export function toGeminiSchema(schema: unknown): unknown;
export function isStyleGuideSourcePdf(asset: {
  filename?: string | null;
  file_type?: string | null;
}): boolean;
