export const TAG_ASSET_REQUIRED_FIELDS: readonly string[];
export const TAG_ASSET_SCHEMA: Record<string, unknown>;

export interface TaggingPromptContext {
  asset: {
    filename: string | null;
    relative_path: string | null;
    file_type: string | null;
    tags: string[] | null;
  };
  taxonomyContext: string;
  erpDescription?: string | null;
  extractedPdfText?: string | null;
  customInstructions?: string | null;
  usingPriorityOnly?: boolean;
}

export function buildTaggingSystemPrompt(context: TaggingPromptContext): string;
export function toGeminiSchema(schema: unknown): Record<string, unknown>;
export function isStyleGuideSourcePdf(asset: {
  file_type: string | null;
  filename: string | null;
}): boolean;
