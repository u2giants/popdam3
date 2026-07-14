import { config } from "../config.js";
import { db } from "../supabase.js";
import { chatCompletion, imageContent, tool, type ChatMessage } from "../openrouter.js";

const THUMBNAIL_FETCH_TIMEOUT_MS = 20_000;

export const TAG_ASSET_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Descriptive tags: characters, styles, colors, themes",
    },
    ai_description: {
      type: "string",
      description: "One-sentence description of the design asset",
    },
    cover_description: {
      type: ["string", "null"],
      description:
        "PRODUCT label (max 8 words). If ERP Product Description was provided, distill property + product type from THAT text ONLY - do NOT use the image. If no ERP description, infer from filename/path. Examples: 'Frozen backpack', 'Spider-Man lunchbox', 'Mickey tee'. NEVER describe the artwork/scene. OMIT licensor names, SKUs, dimensions.",
    },
    scene_description: {
      type: "string",
      description: "What is depicted in the image",
    },
    asset_type: {
      type: ["string", "null"],
      enum: ["art_piece", "product", null],
    },
    art_source: {
      type: ["string", "null"],
      enum: ["freelancer", "straight_style_guide", "style_guide_composition", null],
    },
    design_style: {
      type: ["string", "null"],
      description: "e.g. flat, dimensional, vintage, modern",
    },
    design_ref: {
      type: ["string", "null"],
      description: "Any style number or design reference visible",
    },
    character_ids: {
      type: "array",
      items: { type: "string" },
      description: "UUIDs of identified characters from taxonomy",
    },
    licensor_id: {
      type: ["string", "null"],
      description: "UUID of identified licensor",
    },
    property_id: {
      type: ["string", "null"],
      description: "UUID of identified property",
    },
    designer_name: {
      type: ["string", "null"],
      description:
        "Name of the Designer or Creative Designer found on a Tech Pack / design document. Null if not visible.",
    },
    technical_designer_name: {
      type: ["string", "null"],
      description:
        "Name of the Technical Designer found on a Tech Pack / design document. Null if not visible.",
    },
    freelancer_name: {
      type: ["string", "null"],
      description:
        "Name of the freelancer artist, if this is freelancer art and the name is visible on the document. Null if not visible.",
    },
    files_used: {
      type: "array",
      items: { type: "string" },
      description:
        "All entries from any 'Files Used' / 'Source Files' / 'Art Files' sections in the tech pack PDF text. Deduplicated across all sections. Empty array if no such section exists.",
    },
  },
  required: ["tags", "ai_description", "scene_description"],
};

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
  outputMode: "tool" | "json_schema" | "tool_content_json";
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

export function isStyleGuideSourcePdf(asset: { file_type: string | null; filename: string | null }): boolean {
  const filename = (asset.filename ?? "").toLowerCase();
  return asset.file_type === "pdf" && (
    filename.includes("licensing sheet") || filename.includes("licensing_sheet") ||
    filename.includes("license sheet") || filename.includes("license_sheet") ||
    filename.includes("tech pack") || filename.includes("tech_pack") ||
    filename.includes("techpack")
  );
}

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

  const erpCoverContext = erpDescription ? `\nERP Product Description: "${erpDescription}"\n` : "";

  const { data: pdfSample } = await client
    .from("pdf_text_samples")
    .select("extracted_text")
    .eq("asset_id", asset.id)
    .order("sampled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const extractedPdfText = pdfSample?.extracted_text ?? null;
  const pdfTextContext = extractedPdfText ? `\nExtracted PDF text (first 4000 chars):\n${extractedPdfText.slice(0, 4000)}\n` : "";

  return `You are a design asset tagger for a consumer products company that licenses characters (Disney, Marvel, Star Wars, etc.).

Analyze the thumbnail image and file metadata to produce structured tags.

File: ${asset.filename ?? ""}
Path: ${asset.relative_path ?? ""}
Type: ${asset.file_type ?? ""}
Existing tags: ${(asset.tags || []).join(", ") || "none"}
${erpCoverContext}${pdfTextContext}
Known taxonomy:
${taxonomyContext}

Based on the image and metadata, identify:
1. Characters visible (match to known characters if possible)
2. Style/design descriptors (flat, dimensional, vintage, modern, etc.)
3. Color palette keywords
4. Scene description (what's happening in the image)
5. Any style numbers or design references visible
6. Asset type: art_piece or product
7. Art source: freelancer, straight_style_guide, or style_guide_composition
8. Suggested licensor_id and property_id from the taxonomy (if identifiable)
9. If this is a Tech Pack or design document, extract the **Designer** (or Creative Designer) name, the **Technical Designer** name, and if freelancer art, the **Freelancer** name. Look for these in title blocks, header areas, or any text labels on the document. Return null for any you cannot find.
10. Cover description rule - **CRITICAL**: This is a PRODUCT label, NOT an image description. Derive a very short card label (max 8 words) as **PROPERTY + PRODUCT TYPE**.
   - If an "ERP Product Description" is provided above: extract the product type ONLY from that text. IGNORE the image entirely for this field - the image often shows artwork/art assets, NOT the actual product.
   - If NO ERP description is available: infer from the filename or folder path (e.g. "backpack", "lunchbox", "tee").
   - Format: "Frozen backpack", "Spider-Man lunchbox", "Mickey tee".
   - OMIT: licensor names (Disney/Marvel/etc.), SKUs, dimensions, art style, scene descriptions, file types.
11. If extracted PDF text is provided, scan the **entire text** for ALL sections labeled "Files Used", "Files used in design", "Source Files", "Art Files", or any similar heading. There may be multiple such sections (e.g. one per page, one per colorway). Collect every entry across all of them into a single deduplicated list. Entries may or may not have file extensions - include them regardless. Return as files_used. If no such section exists, return an empty array.
${usingPriorityOnly
    ? "\nNOTE: You are seeing a curated list of characters that actually appear in this company's asset library. Match against these first. If the character is not in this list, return character_ids as empty array."
    : ""}${customInstructions ? `\n\nCOMPANY-SPECIFIC TAGGING INSTRUCTIONS:\n${customInstructions}` : ""}

Return structured data matching the tag_asset schema. Do not invent UUIDs. Use character_ids, licensor_id, and property_id only for exact matches from the provided taxonomy.`;
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
): Promise<TagAssetCompletionResult> {
  let toolError: unknown = null;

  try {
    const result = await chatCompletion(apiKey, {
      model,
      messages,
      tools: [TAG_ASSET_TOOL],
      tool_choice: "required",
      max_tokens: maxTokens,
    }, timeoutMs);

    const toolData = result.toolCalls?.[0]?.arguments;
    if (toolData) return { tagData: toolData, usage: result.usage, outputMode: "tool" };

    const contentData = parseJsonObject(result.content);
    if (contentData) return { tagData: contentData, usage: result.usage, outputMode: "tool_content_json" };

    toolError = new Error("Model returned no structured tags from tool request");
  } catch (e) {
    toolError = e;
  }

  if (toolError && !isToolCapabilityError(toolError)) {
    throw toolError;
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
    }, timeoutMs);

    const contentData = parseJsonObject(result.content);
    if (!contentData) throw new Error("Model returned no parsable JSON for tag_asset schema");
    return { tagData: contentData, usage: result.usage, outputMode: "json_schema" };
  } catch (schemaError) {
    const first = toolError instanceof Error ? toolError.message : String(toolError);
    const second = schemaError instanceof Error ? schemaError.message : String(schemaError);
    throw new Error(`Structured tag output failed. tool_call: ${first}; json_schema: ${second}`);
  }
}

export function getAiTaggingApiKey() {
  return config.openRouterApiKey || config.googleAiApiKey;
}
