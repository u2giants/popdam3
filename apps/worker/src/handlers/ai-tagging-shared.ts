import { config } from "../config.js";
import { db } from "../supabase.js";
import { chatCompletion, imageContent, tool, OpenRouterError, type ChatCompletionRequest, type ChatMessage, type OpenRouterProviderInfo } from "../openrouter.js";
import {
  TAG_ASSET_SCHEMA,
  buildTaggingSystemPrompt,
  isStyleGuideSourcePdf,
} from "../../../../supabase/functions/_shared/tag-asset-contract.js";

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
  outputMode: "tool" | "json_schema" | "json_object" | "tool_content_json";
  providerInfo?: OpenRouterProviderInfo;
  retryCount: number;
};

function parseJsonObject(content: string | undefined): Record<string, unknown> | null {
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

// Model families that don't support OpenAI-style function/tool calling on
// OpenRouter. For these we skip the tool_choice leg entirely and go straight
// to structured JSON output — attempting the tool leg just wastes a full
// request (with its own timeout budget) that always fails over. Match against
// the bare model name so both "gemma-4-31b-it" and "google/gemma-4-31b-it"
// resolve the same way. Scout is image-capable, but some routed endpoints reject
// the image + function-calling combination; structured JSON keeps the production
// contract without forcing that brittle leg.
// minimax-m3: its first-party OpenRouter endpoint (where we pin it, see
// MODEL_ROUTING_OVERRIDES in openrouter.ts) supports response_format/JSON schema
// but NOT function-calling; the one tool-capable endpoint returns truncated
// tool JSON. Skip the tool leg and use the structured-JSON path directly.
const NON_TOOL_CALLING_MODEL_PATTERNS = [/(^|\/)gemma/i, /(^|\/)llama-4-scout/i, /(^|\/)minimax-m3/i];

export function modelSupportsTools(model: string): boolean {
  return !NON_TOOL_CALLING_MODEL_PATTERNS.some((re) => re.test(model));
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

function validateTagAssetData(value: Record<string, unknown>, mode: TagAssetCompletionResult["outputMode"]) {
  const errors: string[] = [];
  if (!Array.isArray(value.tags)) errors.push("tags must be an array");
  if (typeof value.ai_description !== "string" || value.ai_description.trim().length === 0) {
    errors.push("ai_description must be a non-empty string");
  }
  if (typeof value.scene_description !== "string" || value.scene_description.trim().length === 0) {
    errors.push("scene_description must be a non-empty string");
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
  return { tagData, usage, outputMode, providerInfo, retryCount };
}

function withJsonObjectInstruction(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content:
        "Return only a valid JSON object matching the tag_asset schema. Include at minimum tags, ai_description, and scene_description. Do not wrap it in markdown or prose.",
    },
  ];
}

function withJsonRepairInstruction(messages: ChatMessage[], errorMessage: string): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content:
        `The previous response could not be parsed or validated as JSON: ${errorMessage.slice(0, 300)}. Return a corrected JSON object only. Include tags, ai_description, and scene_description. No markdown, no commentary.`,
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

export async function buildImageTaggingPrompt(asset: TaggingPromptAsset): Promise<string> {
  const client = db();

  const { data: instrRow } = await client
    .from("admin_config")
    .select("value")
    .eq("key", "TAGGING_INSTRUCTIONS")
    .maybeSingle();
  const customInstructions = typeof instrRow?.value === "string" ? instrRow.value.trim() : null;

  const [licensorsRes, propertiesRes] = await Promise.all([
    client.from("licensors").select("id, name").limit(50),
    client.from("properties").select("id, name, licensor_id").limit(200),
  ]);
  const licensors = licensorsRes.data ?? [];
  const properties = propertiesRes.data ?? [];

  let characters: { id: string; name: string }[] = [];
  let usingPriorityOnly = false;

  if (asset.property_id) {
    const { data: priorityChars } = await client
      .from("characters")
      .select("id, name")
      .eq("property_id", asset.property_id)
      .eq("is_priority", true)
      .order("usage_count", { ascending: false });

    if (priorityChars && priorityChars.length > 0) {
      characters = priorityChars;
      usingPriorityOnly = true;
    } else {
      const { data: allChars } = await client
        .from("characters")
        .select("id, name")
        .eq("property_id", asset.property_id)
        .order("name");
      characters = allChars ?? [];
    }
  } else if (asset.licensor_id) {
    const { data: propIds } = await client
      .from("properties")
      .select("id")
      .eq("licensor_id", asset.licensor_id);
    const ids = (propIds ?? []).map((p: { id: string }) => p.id);

    if (ids.length > 0) {
      const { data: priorityChars } = await client
        .from("characters")
        .select("id, name")
        .in("property_id", ids)
        .eq("is_priority", true)
        .order("usage_count", { ascending: false })
        .limit(200);

      if (priorityChars && priorityChars.length > 0) {
        characters = priorityChars;
        usingPriorityOnly = true;
      } else {
        const { data: allChars } = await client
          .from("characters")
          .select("id, name")
          .in("property_id", ids)
          .limit(300);
        characters = allChars ?? [];
      }
    }
  } else {
    const { data: priorityChars } = await client
      .from("characters")
      .select("id, name")
      .eq("is_priority", true)
      .order("usage_count", { ascending: false })
      .limit(150);
    characters = priorityChars ?? [];
  }

  const charContext = usingPriorityOnly
    ? "Priority characters for this property/licensor (match from this list first):\n"
    : "Characters (full list for this property):\n";

  const taxonomyContext = [
    `Licensors: ${licensors.map((l) => `${l.name} (${l.id})`).join(", ")}`,
    `Properties: ${properties.map((p) => `${p.name} (${p.id})`).join(", ")}`,
    `${charContext}${characters.map((c) => `${c.name} (${c.id})`).join(", ")}`,
  ].join("\n");

  let erpDescription: string | null = null;
  if (asset.sku) {
    const { data: erpItem } = await client
      .from("erp_items_current")
      .select("item_description")
      .eq("style_number", asset.sku)
      .maybeSingle();
    erpDescription = erpItem?.item_description ?? null;
  }

  const { data: pdfSample } = await client
    .from("pdf_text_samples")
    .select("extracted_text")
    .eq("asset_id", asset.id)
    .order("sampled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const extractedPdfText = pdfSample?.extracted_text ?? null;
  return buildTaggingSystemPrompt({
    asset,
    taxonomyContext,
    erpDescription,
    extractedPdfText,
    customInstructions,
    usingPriorityOnly,
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

export async function callTagAssetModel(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
  maxTokens = 1500,
  provider?: ChatCompletionRequest["provider"],
): Promise<TagAssetCompletionResult> {
  let toolError: unknown = null;

  if (modelSupportsTools(model)) {
    try {
      const result = await chatCompletion(apiKey, {
        model,
        messages,
        tools: [TAG_ASSET_TOOL],
        tool_choice: "required",
        max_tokens: maxTokens,
        provider,
      }, timeoutMs);

      const toolData = result.toolCalls?.[0]?.arguments;
      if (toolData) return validatedTagResult(toolData, result.usage, "tool", result.providerInfo, 0);

      const contentData = parseJsonObject(result.content);
      if (contentData) return validatedTagResult(contentData, result.usage, "tool_content_json", result.providerInfo, 0);

      toolError = new Error("Model returned no structured tags from tool request");
    } catch (e) {
      toolError = e;
    }

    if (toolError && !isToolCapabilityError(toolError)) {
      throw toolError;
    }
  } else {
    toolError = new Error(`Skipped tool call: ${model} does not support tool calling`);
  }

  try {
    const result = await chatCompletion(apiKey, {
      model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tag_asset",
          strict: false,
          schema: TAG_ASSET_SCHEMA,
        },
      },
      max_tokens: maxTokens,
      provider,
    }, timeoutMs);

    const contentData = parseJsonObject(result.content);
    if (!contentData) throw new Error("Model returned no parsable JSON for tag_asset schema");
    return validatedTagResult(contentData, result.usage, "json_schema", result.providerInfo, 0);
  } catch (schemaError) {
    try {
      const result = await chatCompletion(apiKey, {
        model,
        messages: withJsonObjectInstruction(messages),
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        provider,
      }, timeoutMs);

      const contentData = parseJsonObject(result.content);
      if (!contentData) throw new Error("Model returned no parsable JSON object");
      return validatedTagResult(contentData, result.usage, "json_object", result.providerInfo, 0);
    } catch (jsonObjectError) {
      try {
        const repairMessage = jsonObjectError instanceof Error ? jsonObjectError.message : String(jsonObjectError);
        const result = await chatCompletion(apiKey, {
          model,
          messages: withJsonRepairInstruction(withJsonObjectInstruction(messages), repairMessage),
          response_format: { type: "json_object" },
          max_tokens: maxTokens,
          temperature: 0,
          provider,
        }, timeoutMs);

        const contentData = parseJsonObject(result.content);
        if (!contentData) throw new Error("Model returned no parsable JSON object after repair retry");
        return validatedTagResult(contentData, result.usage, "json_object", result.providerInfo, 1);
      } catch (repairError) {
        const first = toolError instanceof Error ? toolError.message : String(toolError);
        const second = schemaError instanceof Error ? schemaError.message : String(schemaError);
        const third = jsonObjectError instanceof Error ? jsonObjectError.message : String(jsonObjectError);
        const fourth = repairError instanceof Error ? repairError.message : String(repairError);
        const failure = new Error(`Structured tag output failed. tool_call: ${first}; json_schema: ${second}; json_object: ${third}; repair: ${fourth}`);
        (failure as Error & { providerInfo?: OpenRouterProviderInfo }).providerInfo =
          providerInfoFromError(repairError) ??
          providerInfoFromError(jsonObjectError) ??
          providerInfoFromError(schemaError) ??
          providerInfoFromError(toolError);
        throw failure;
      }
    }
  }
}

export function getAiTaggingApiKey() {
  return config.openRouterApiKey;
}
