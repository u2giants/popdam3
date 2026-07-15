export const CONTENT_TYPE_VALUES = [
  "source_art",
  "style_guide_art",
  "pattern_allover",
  "icon_badge",
  "product_photo",
  "lifestyle_photo",
  "render_mockup",
  "tech_pack",
  "licensing_sheet",
  "spec_layout_doc",
  "packaging_art",
  "sticker",
  "jcard",
  "other",
];

export const TAG_ASSET_REQUIRED_FIELDS = ["tags", "ai_description", "scene_description", "content_type"];

export const TAG_ASSET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Descriptive tags: characters, styles, colors, themes, and product type. Always include the specific product type as a tag (e.g. 'lapdesk', 'backpack', 'mug', 'desk organizer', 'lunchbox', 'tee') - derive from the ERP Product Description if provided, otherwise from filename or folder path.",
    },
    ai_description: {
      type: "string",
      description:
        "One search-friendly sentence for non-technical designers and salespeople. Include useful visible or metadata-supported terms: character/property, product or asset kind, shot/view type, style/treatment, motif/theme, major colors, and placement/use.",
    },
    cover_description: {
      type: ["string", "null"],
      description:
        "PRODUCT label (max 8 words). If ERP Product Description was provided, distill property + product type from THAT text ONLY - do NOT use the image. If no ERP description, infer from filename/path. Examples: 'Frozen backpack', 'Spider-Man lunchbox', 'Mickey tee'. NEVER describe the artwork/scene. OMIT licensor names, SKUs, dimensions.",
    },
    scene_description: {
      type: "string",
      description:
        "One literal visual sentence describing only what is visible: subject, composition, pose/action, product area, angle, colors, readable text, and photo/render/document cues.",
    },
    content_type: {
      type: "string",
      enum: CONTENT_TYPE_VALUES,
      description: "One primary file kind, classified from the image plus filename and path.",
    },
    asset_type: { type: ["string", "null"], enum: ["art_piece", "product", null] },
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
    licensor_id: { type: ["string", "null"], description: "UUID of identified licensor" },
    property_id: { type: ["string", "null"], description: "UUID of identified property" },
    designer_name: {
      type: ["string", "null"],
      description: "Name of the Designer or Creative Designer found on a Tech Pack / design document. Null if not visible.",
    },
    technical_designer_name: {
      type: ["string", "null"],
      description: "Name of the Technical Designer found on a Tech Pack / design document. Null if not visible.",
    },
    freelancer_name: {
      type: ["string", "null"],
      description: "Name of the freelancer artist, if this is freelancer art and the name is visible on the document. Null if not visible.",
    },
    files_used: {
      type: "array",
      items: { type: "string" },
      description:
        "All entries from any 'Files Used' / 'Source Files' / 'Art Files' sections in the tech pack PDF text. Deduplicated across all sections. Empty array if no such section exists.",
    },
  },
  required: TAG_ASSET_REQUIRED_FIELDS,
};

export function buildTaggingSystemPrompt(context) {
  const {
    asset,
    taxonomyContext,
    erpDescription = null,
    itemDescription = null,
    extractedPdfText = null,
    customInstructions = null,
    usingPriorityOnly = false,
  } = context;
  const erpContext = erpDescription ? `\nERP Product Description: "${erpDescription}"\n` : "";
  const itemDescriptionContext = itemDescription
    ? `\nAuthoritative product/item description for this SKU's group (context only — do NOT restate or override it; use it to inform tags/classification): "${itemDescription}"\n`
    : "";
  const pdfContext = extractedPdfText ? `\nExtracted PDF text (first 4000 chars):\n${extractedPdfText.slice(0, 4000)}\n` : "";

  return `You are a design asset tagger for a consumer products company that licenses characters (Disney, Marvel, Star Wars, etc.).

Analyze the thumbnail image and file metadata to produce structured tags.

File: ${asset.filename ?? ""}
Path: ${asset.relative_path ?? ""}
Type: ${asset.file_type ?? ""}
Existing tags: ${(asset.tags || []).join(", ") || "none"}
${erpContext}${itemDescriptionContext}${pdfContext}
Known taxonomy:
${taxonomyContext}

Write for PopDAM search and browsing. Users are non-technical designers, salespeople, and production staff searching licensed consumer-product assets by character/property, product, visual style, color, motif, view, use case, and document type.

Description rules:
- ai_description: one search-friendly sentence, 14-28 words. Include the most useful searchable facts visible or supported by metadata: character/property, product or asset kind, view/shot type, art style/treatment, motif/theme, major colors, and placement/use.
- scene_description: one literal visual sentence, 10-24 words. Describe only what is visible: subject, composition, pose/action, product area, angle, colors, readable text, and photo/render/document cues.
- Recognize asset kinds such as source art, icons, badges, patterns, allover prints, style-guide art, full product photos, renders, mockups, professional/lifestyle photography, close-ups/details, tech packs, licensing sheets, spec/layout documents, packaging art, stickers, and J-cards.
- Product context: PopDAM often includes wall art/canvas/framed prints, clocks, storage boxes/bins, lap desks/desktop items, mats, tabletop/garden decor, and packaging. Use this only as context; never force a product type if it is not visible or supported by filename/path/ERP metadata.
- Avoid marketing copy, subjective praise, long lists, tiny irrelevant details, vague words, and multi-sentence answers.

Based on the image and metadata, identify:
1. Characters visible (match to known characters if possible)
2. Style/design descriptors (flat, dimensional, vintage, modern, etc.)
3. Color palette keywords
4. Scene description (literal visual content only)
5. Any style numbers or design references visible
6. Asset type: art_piece or product
7. Art source: freelancer, straight_style_guide, or style_guide_composition
8. Content type: choose exactly one primary file kind from source_art, style_guide_art, pattern_allover, icon_badge, product_photo, lifestyle_photo, render_mockup, tech_pack, licensing_sheet, spec_layout_doc, packaging_art, sticker, jcard, or other. Classify from the image together with the filename and path.
8b. Product type - always derive from the ERP Product Description if provided (e.g. "Lap Desk" -> tag "lapdesk"), otherwise infer from filename or folder path. Include as a tag even when the image shows artwork rather than the physical product.
9. Suggested licensor_id and property_id from the taxonomy (if identifiable)
10. If this is a Tech Pack or design document, extract the **Designer** (or Creative Designer) name, the **Technical Designer** name, and if freelancer art, the **Freelancer** name. Look for these in title blocks, header areas, or any text labels on the document. Return null for any you cannot find.
11. Cover description rule - **CRITICAL**: This is a PRODUCT label, NOT an image description. Derive a very short card label (max 8 words) as **PROPERTY + PRODUCT TYPE**.
   - If an "ERP Product Description" is provided above: extract the product type ONLY from that text. IGNORE the image entirely for this field - the image often shows artwork/art assets, NOT the actual product.
   - If NO ERP description is available: infer from the filename or folder path (e.g. "backpack", "lunchbox", "tee").
   - Format: "Frozen backpack", "Spider-Man lunchbox", "Mickey tee".
   - OMIT: licensor names (Disney/Marvel/etc.), SKUs, dimensions, art style, scene descriptions, file types.
12. If extracted PDF text is provided, scan the **entire text** for ALL sections labeled "Files Used", "Files used in design", "Source Files", "Art Files", or any similar heading. There may be multiple such sections (e.g. one per page, one per colorway). Collect every entry across all of them into a single deduplicated list. Entries may or may not have file extensions - include them regardless. Return as files_used. If no such section exists, return an empty array.
${
    usingPriorityOnly
      ? "\nNOTE: You are seeing a curated list of characters that actually appear in this company's asset library. Match against these first. If the character is not in this list, return character_ids as empty array."
      : ""
  }${customInstructions ? `\n\nCOMPANY-SPECIFIC TAGGING INSTRUCTIONS:\n${customInstructions}` : ""}

Return structured data matching the tag_asset schema. Do not invent UUIDs. Use character_ids, licensor_id, and property_id only for exact matches from the provided taxonomy.`;
}

/**
 * Convert the canonical OpenAI/OpenRouter JSON Schema into the dialect Google's
 * Gemini `functionDeclarations[].parameters` accepts. Gemini's schema subset
 * rejects array-valued `type` (e.g. ["string","null"]), `null` members in
 * `enum`, and `additionalProperties`. This mirrors the plain-string shape the
 * edge function used before the schema was unified, so the Gemini path keeps
 * working from the single canonical definition.
 */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && Array.isArray(value)) {
      // Collapse union types to the first non-null type (nullability is implicit).
      out.type = value.find((t) => t !== "null") ?? "string";
    } else if (key === "enum" && Array.isArray(value)) {
      out.enum = value.filter((v) => v !== null);
    } else if (value && typeof value === "object") {
      out[key] = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function isStyleGuideSourcePdf(asset) {
  const filename = (asset.filename ?? "").toLowerCase();
  return asset.file_type === "pdf" && (
    filename.includes("licensing sheet") || filename.includes("licensing_sheet") ||
    filename.includes("license sheet") || filename.includes("license_sheet") ||
    filename.includes("tech pack") || filename.includes("tech_pack") ||
    filename.includes("techpack")
  );
}
