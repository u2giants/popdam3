import { isMetaDirectModel, isTerminalMetaModelApiError, metaChatCompletion } from "../meta-model-api.js";
import { db } from "../supabase.js";
import { getOpenRouterApiKey } from "../openrouter-key.js";
import { getGoogleAiApiKey } from "../google-ai-key.js";
import { getMetaApiKey } from "../provider-api-key.js";
import { isDirectGeminiBatchModel } from "../gemini-batch.js";
import { imageContent, publicImageContent, tool, OpenRouterError, type ChatCompletionRequest, type ChatMessage, type OpenRouterProviderInfo } from "../openrouter.js";
import { getRuntimeModelCapabilities } from "../model-capabilities.js";
import { executeStructuredOutput, type OutputAttempt } from "../structured-output.js";
import {
  TAG_ASSET_SCHEMA,
  CONTENT_TYPE_VALUES,
  buildTaggingSystemPrompt,
  isStyleGuideSourcePdf,
} from "../../../../supabase/functions/_shared/tag-asset-contract.js";
import { ASSET_TAG_CATEGORIES, normalizeMetadataTag } from "../tagging-metadata-policy.js";
import { canonicalItems } from "../canonical-erp-items.js";

const THUMBNAIL_FETCH_TIMEOUT_MS = 20_000;

export { TAG_ASSET_SCHEMA };

export const TAG_ASSET_TOOL = tool(
  "tag_asset",
  "Return structured tagging data for this design asset.",
  TAG_ASSET_SCHEMA,
);

export type TaggingPromptAsset = {
  id: string;
  filename: string | null;
  relative_path: string | null;
  file_type: string | null;
  tags: string[] | null;
  licensor_id: string | null;
  property_id: string | null;
  sku: string | null;
  division_code?: string | null;
  style_group_id?: string | null;
};

export type ImageData = {
  base64: string;
  mimeType: string;
};

export type TagAssetCompletionResult = {
  tagData: Record<string, unknown>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  outputMode: "json_schema" | "json_object" | "tool_named" | "tool_required" | "tool_auto" | "json_repair";
  providerInfo?: OpenRouterProviderInfo;
  retryCount: number;
  attempts: OutputAttempt[];
};

export function parseJsonObject(content: string | undefined): Record<string, unknown> | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function isToolCapabilityError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("tool_choice") ||
    msg.includes("tools") ||
    msg.includes("No endpoints found") ||
    msg.includes("unsupported") ||
    msg.includes("require_parameters") ||
    msg.includes("no structured tags")
  );
}

export function validateTagAssetData(value: Record<string, unknown>, mode: string) {
  const errors: string[] = [];
  if (!Array.isArray(value.asset_tags)) {
    errors.push("asset_tags must be an array");
  } else {
    const tags = value.asset_tags as Array<Record<string, unknown>>;
    if (tags.length < 4 || tags.length > 18) errors.push("asset_tags must contain 4-18 items");
    const normalizedTags: string[] = [];
    for (const item of tags) {
      if (!item || typeof item !== "object") {
        errors.push("every asset tag must be an object");
        continue;
      }
      const tag = normalizeMetadataTag(item.tag);
      if (!tag) errors.push("every asset tag must have a non-empty tag");
      else normalizedTags.push(tag);
      if (typeof item.category !== "string" || !ASSET_TAG_CATEGORIES.includes(item.category)) {
        errors.push("every asset tag must use an asset-only category");
      }
      if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        errors.push("every asset tag confidence must be between 0 and 1");
      }
      if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.some((entry) => typeof entry !== "string" || !entry.trim())) {
        errors.push("every asset tag must contain string evidence");
      }
    }
    if (new Set(normalizedTags).size !== normalizedTags.length) errors.push("asset tags must be distinct");
  }
  if (typeof value.ai_description !== "string" || value.ai_description.trim().length === 0) {
    errors.push("ai_description must be a non-empty string");
  }
  if (typeof value.scene_description !== "string" || value.scene_description.trim().length === 0) {
    errors.push("scene_description must be a non-empty string");
  }
  if (typeof value.content_type !== "string" || !CONTENT_TYPE_VALUES.includes(value.content_type)) {
    errors.push("content_type must be a recognized file kind");
  }
  for (const field of ["asset_type", "art_source"] as const) {
    const properties = TAG_ASSET_SCHEMA.properties as Record<string, { enum: unknown[] }>;
    const allowed = properties[field].enum;
    if (value[field] !== undefined && !allowed.includes(value[field])) {
      errors.push(`${field} must be one of ${JSON.stringify(allowed)}; use JSON null, never the string "null"`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Model returned invalid ${mode} tag data: ${errors.join("; ")}`);
  }
}

function validatedTagResult(
  tagData: Record<string, unknown>,
  usage: TagAssetCompletionResult["usage"],
  outputMode: TagAssetCompletionResult["outputMode"],
  providerInfo: OpenRouterProviderInfo | undefined,
  retryCount: number,
): TagAssetCompletionResult {
  validateTagAssetData(tagData, outputMode);
  return { tagData, usage, outputMode, providerInfo, retryCount, attempts: [] };
}

function withJsonObjectInstruction(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content:
        "Return only a valid JSON object matching the tag_asset schema. Include at minimum asset_tags, ai_description, scene_description, and content_type. Do not wrap it in markdown or prose.",
    },
  ];
}

function withJsonRepairInstruction(messages: ChatMessage[], errorMessage: string): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content:
        `The previous response could not be parsed or validated as JSON: ${errorMessage.slice(0, 300)}. Return a corrected JSON object only. Include asset_tags, ai_description, scene_description, and content_type. No markdown, no commentary.`,
    },
  ];
}

function providerInfoFromError(error: unknown): OpenRouterProviderInfo | undefined {
  if (error instanceof OpenRouterError) return error.providerInfo;
  const maybe = error as Error & { providerInfo?: OpenRouterProviderInfo };
  return maybe?.providerInfo;
}

export { isStyleGuideSourcePdf };

export async function fetchImageData(thumbnailUrl: string, timeoutMs = THUMBNAIL_FETCH_TIMEOUT_MS): Promise<ImageData> {
  const resp = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Thumbnail fetch HTTP ${resp.status}`);
  const mimeType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const bytes = Buffer.from(await resp.arrayBuffer());
  return { base64: bytes.toString("base64"), mimeType };
}

export class CharacterCatalogDependencyError extends Error {
  readonly code: string;
  constructor(code = "unknown") { super("Character catalog dependency failed; accepted response retained"); this.code = /^[A-Z0-9_]{1,16}$/i.test(code) ? code : "unknown"; this.name = "CharacterCatalogDependencyError"; }
}
export class AssetTagApplyError extends Error {
  readonly code: string;
  constructor(public readonly stage: "asset_reload" | "asset_tags" | "character_links" | "file_sources" | "asset_metadata", code?: string) {
    super(stage === "asset_tags" ? "Atomic AI tag write failed" : `Asset tagging save failed at ${stage}`); this.name = "AssetTagApplyError";
    this.code = code && /^[A-Z0-9_]{1,16}$/i.test(code) ? code : "unknown";
  }
}
export class CharacterReferenceValidationError extends Error {
  constructor() { super("Model returned invalid character references: character_ids must be UUIDs from the supplied character catalog and existing characters; select only exact visual matches"); this.name = "CharacterReferenceValidationError"; }
}
const CHARACTER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function normalizeCharacterIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !CHARACTER_UUID.test(id))) throw new CharacterReferenceValidationError();
  return [...new Set((value as string[]).map(id => id.toLowerCase()))];
}
/** Constrain synchronous trial output to the exact catalog supplied in its prompt. */
export function tagAssetSchemaForCharacters(binding?: string[]): Record<string, unknown> {
  if (binding === undefined) return TAG_ASSET_SCHEMA;
  const ids = normalizeCharacterIds(binding);
  const schema = structuredClone(TAG_ASSET_SCHEMA) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  properties.character_ids = {
    ...properties.character_ids,
    ...(ids.length ? { items: { type: "string", enum: ids } } : { maxItems: 0 }),
  };
  return schema;
}

export function validateTagCharacterBinding(value: unknown, binding: string[]): void {
  const ids = normalizeCharacterIds(value);
  const allowed = new Set(normalizeCharacterIds(binding));
  if (ids.some(id => !allowed.has(id))) throw new CharacterReferenceValidationError();
}

export async function validateCharacterReferences(
  value: unknown, binding: string[] | undefined, client: ReturnType<typeof db> = db(),
): Promise<string[]> {
  const ids = normalizeCharacterIds(value);
  if (binding && ids.some(id => !binding.includes(id))) throw new CharacterReferenceValidationError();
  if (!ids.length) return ids;
  let response;
  try { response = await client.from("characters").select("id").in("id", ids); }
  catch { throw new CharacterCatalogDependencyError("transport"); }
  const { data, error } = response;
  if (error || !data) throw new CharacterCatalogDependencyError(error?.code);
  if (!Array.isArray(data)) throw new CharacterCatalogDependencyError("catalog_contract");
  let existing: Set<string>;
  try { existing = new Set(normalizeCharacterIds(data.map(row => row.id))); } catch { throw new CharacterCatalogDependencyError("catalog_contract"); }
  if (ids.some(id => !existing.has(id))) throw new CharacterReferenceValidationError();
  return ids;
}
export interface TaggingPromptOptions {
  onCharacterCatalog?: (ids: string[]) => void;
  requireCharacterReadSuccess?: boolean;
  client?: ReturnType<typeof db>;
}

/** Grouped assets take licensing from their Style Group; only ungrouped assets fall back to their own columns. */
export async function resolveLicensingNames(
  client: ReturnType<typeof db>,
  asset: Pick<TaggingPromptAsset, "licensor_id" | "property_id" | "style_group_id">,
): Promise<{ licensorName: string | null; propertyName: string | null }> {
  if (asset.style_group_id) {
    const { data } = await client.from("style_groups").select("licensor_name, property_name").eq("id", asset.style_group_id).maybeSingle();
    return { licensorName: data?.licensor_name ?? null, propertyName: data?.property_name ?? null };
  }
  const [licensor, property] = await Promise.all([
    asset.licensor_id ? client.schema("core").from("licensor").select("name").eq("id", asset.licensor_id).maybeSingle() : null,
    asset.property_id ? client.schema("core").from("property").select("name").eq("id", asset.property_id).maybeSingle() : null,
  ]);
  return { licensorName: licensor?.data?.name ?? null, propertyName: property?.data?.name ?? null };
}

/**
 * Character catalog scope follows the same licensing source as the prompt:
 * grouped assets use their Style Group, ungrouped assets their own columns.
 */
export async function resolveCharacterScope(
  client: ReturnType<typeof db>,
  asset: Pick<TaggingPromptAsset, "licensor_id" | "property_id" | "style_group_id" | "sku">,
  checkedQuery: <T>(query: PromiseLike<T>) => Promise<T>,
  checkedCharacterRead: (error: { code?: string } | null, data: unknown) => void,
): Promise<{ licensor_id: string | null; property_id: string | null; unlicensed: boolean }> {
  let scope = { licensor_id: asset.licensor_id, property_id: asset.property_id, unlicensed: false };
  let sku = asset.sku;
  if (asset.style_group_id) {
    const { data, error } = await checkedQuery(client
      .from("style_groups")
      .select("sku, licensor_id, property_id, is_licensed")
      .eq("id", asset.style_group_id)
      .maybeSingle());
    if (error) checkedCharacterRead(error, null);
    const group = data as { sku: string | null; licensor_id: string | null; property_id: string | null; is_licensed: boolean | null } | null;
    if (group) {
      scope = {
        licensor_id: group.licensor_id ?? asset.licensor_id,
        property_id: group.property_id ?? asset.property_id,
        unlicensed: group.is_licensed === false,
      };
      sku = group.sku ?? sku;
    }
  }
  // No licensing ids: the SKU's licensor code (characters 6-7, e.g. VSM22MVDP01 → MV)
  // still scopes characters, so a Disney or DC product is never offered Marvel's list.
  const code = skuLicensorCode(sku);
  if (!scope.unlicensed && !scope.licensor_id && !scope.property_id && code) {
    const { data, error } = await checkedQuery(client.schema("core").from("licensor").select("id").eq("code", code).limit(2));
    checkedCharacterRead(error, data);
    if (data?.length === 1) scope.licensor_id = (data[0] as { id: string }).id;
  }
  return scope;
}

export function skuLicensorCode(sku: string | null | undefined): string | null {
  const match = sku?.trim().toUpperCase().match(/^[A-Z0-9]{5}([A-Z0-9]{2})/);
  return match ? match[1] : null;
}

export async function buildImageTaggingPrompt(asset: TaggingPromptAsset, options: TaggingPromptOptions = {}): Promise<string> {
  const client = options.client ?? db();
  const checkedCharacterRead = (error: { code?: string } | null, data: unknown) => { if (options.requireCharacterReadSuccess && (error || !Array.isArray(data))) throw new CharacterCatalogDependencyError(error?.code ?? "catalog_contract"); };
  const checkedQuery = async <T>(query: PromiseLike<T>): Promise<T> => {
    try { return await query; } catch (error) { if (options.requireCharacterReadSuccess) throw new CharacterCatalogDependencyError("transport"); throw error; }
  };

  const { data: instrRow } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "TAGGING_INSTRUCTIONS")
    .maybeSingle();
  const customInstructions = typeof instrRow?.value === "string" ? instrRow.value.trim() : null;

  let characters: { id: string; name: string }[] = [];
  const scope = await resolveCharacterScope(client, asset, checkedQuery, checkedCharacterRead);

  // Characters come only from the product's own property or licensor. With no
  // licensing context (or an unlicensed group) the model gets no characters:
  // a store-wide list let it attach Spider-Man to spider webs, Deadpool, etc.
  let propertyIds: string[] = [];
  if (!scope.unlicensed && scope.property_id) {
    propertyIds = [scope.property_id];
  } else if (!scope.unlicensed && scope.licensor_id) {
    const { data: propIds, error: propertyIdsError } = await checkedQuery(client
      .schema("core")
      .from("property")
      .select("id")
      .eq("licensor_id", scope.licensor_id));
    checkedCharacterRead(propertyIdsError, propIds);
    propertyIds = (propIds ?? []).map((p: { id: string }) => p.id);
  }
  if (propertyIds.length > 0) {
    const { data: scopedChars, error: scopedError } = await checkedQuery(client
      .from("dam_character_catalog")
      .select("id, name")
      .in("core_property_id", propertyIds)
      .order("is_priority", { ascending: false })
      .order("name"));
    checkedCharacterRead(scopedError, scopedChars);
    characters = scopedChars ?? [];
  }

  if (options.onCharacterCatalog) {
    let ids: string[];
    try { ids = normalizeCharacterIds(characters.map(character => character.id)); } catch { throw new CharacterCatalogDependencyError("catalog_contract"); }
    options.onCharacterCatalog(ids);
  }
  const taxonomyContext = characters.length
    ? `Characters for this product's property/licensor:\n${characters.map((c) => `${c.name} (${c.id})`).join(", ")}`
    : "Characters: none available for this product. Return character_ids as an empty array.";

  let erpDescription: string | null = null;
  let itemDescription: string | null = null;
  if (asset.sku) {
    let erpQuery = canonicalItems(client)
      .select("item_description")
      .eq("style_number", asset.sku)
      .order("division_code", { ascending: true })
      .limit(2);
    if (asset.division_code) erpQuery = erpQuery.eq("division_code", asset.division_code);
    const { data: erpRows } = await erpQuery;
    const erpItem = erpRows?.length === 1 ? erpRows[0] : null;
    erpDescription = erpItem?.item_description ?? null;

    const { data: humanDescription, error: humanDescriptionError } = await client
      .schema("dam")
      .from("sku_human_description")
      .select("description")
      .eq("sku", asset.sku)
      .maybeSingle();
    itemDescription = humanDescription?.description ?? null;

    if (humanDescriptionError && asset.style_group_id) {
      const { data: styleGroup } = await client
        .from("style_groups")
        .select("sku, item_description")
        .eq("id", asset.style_group_id)
        .maybeSingle();
      // Only this file's own product: a group holding another SKU would hand it
      // a different product's description as "authoritative" context.
      itemDescription = styleGroup?.sku === asset.sku ? styleGroup?.item_description ?? null : null;
    }
  }

  const { data: pdfSample } = await client
    .from("pdf_text_samples")
    .select("extracted_text")
    .eq("asset_id", asset.id)
    .order("sampled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const extractedPdfText = pdfSample?.extracted_text ?? null;
  const { licensorName, propertyName } = await resolveLicensingNames(client, asset);
  return buildTaggingSystemPrompt({
    asset,
    licensorName,
    propertyName,
    taxonomyContext,
    erpDescription,
    itemDescription,
    extractedPdfText,
    customInstructions,
  });
}

export function buildImageTaggingMessages(systemPrompt: string, image: ImageData, userText: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        imageContent(image.base64, image.mimeType),
        { type: "text", text: userText },
      ],
    },
  ];
}

export function buildBatchImageTaggingMessages(systemPrompt: string, imageUrl: string, userText: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        publicImageContent(imageUrl),
        { type: "text", text: userText },
      ],
    },
  ];
}

export function isRetryableTagTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /(?:timed out|timeout|fetch failed)/i.test(error.message);
}

export async function callTagAssetModel(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  maxTokens = 4000,
  provider?: ChatCompletionRequest["provider"],
  characterCatalogIds?: string[],
): Promise<TagAssetCompletionResult> {
  const directMeta = isMetaDirectModel(model);
  const selectedApiKey = directMeta ? await getMetaApiKey() : apiKey;
  if (directMeta && !selectedApiKey) throw new Error("Meta Model API key is not configured in Settings");
  const capabilities = directMeta ? {
    modelId: model,
    imageInput: true,
    tools: true,
    toolChoice: true,
    toolChoiceModes: ["auto" as const],
    structuredOutputs: true,
    jsonObject: true,
    prefer: ["json_schema" as const, "json_object" as const, "tool_auto" as const],
    source: "override" as const,
    fetchedAt: new Date().toISOString(),
  } : await getRuntimeModelCapabilities(selectedApiKey, model);
  const result = await executeStructuredOutput({
    apiKey: selectedApiKey, model, messages, schemaName: "tag_asset", schema: tagAssetSchemaForCharacters(characterCatalogIds),
    capabilities, timeoutMs, maxTokens, provider: directMeta ? undefined : provider,
    completion: directMeta ? metaChatCompletion : undefined,
    isTerminalError: directMeta ? (error) => isTerminalMetaModelApiError(error) || isRetryableTagTransportError(error) : undefined,
    validate(value) { validateTagAssetData(value, "structured"); if (characterCatalogIds !== undefined) validateTagCharacterBinding(value.character_ids, characterCatalogIds); return value; },
  });
  return { tagData: result.value, usage: result.usage as TagAssetCompletionResult["usage"], outputMode: result.outputMode, providerInfo: result.providerInfo, retryCount: result.repairCount, attempts: result.attempts };
}

export function getAiTaggingApiKey(model?: string): Promise<string> {
  if (model && isDirectGeminiBatchModel(model)) return getGoogleAiApiKey();
  return model && isMetaDirectModel(model) ? getMetaApiKey() : getOpenRouterApiKey();
}
