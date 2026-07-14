import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsServe, err, json } from "../_shared/http.ts";
import { buildTaggingSystemPrompt, isStyleGuideSourcePdf, TAG_ASSET_SCHEMA, toGeminiSchema } from "../_shared/tag-asset-contract.js";

// Gemini's functionDeclarations schema dialect rejects the canonical schema's
// union types / null enums / additionalProperties, so adapt it once here.
const GEMINI_TAG_ASSET_SCHEMA = toGeminiSchema(TAG_ASSET_SCHEMA);

corsServe(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return err("Missing Authorization header", 401);
  }

  const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!GOOGLE_AI_API_KEY) {
    return err("GOOGLE_AI_API_KEY not configured", 500);
  }

  try {
    const body = await req.json();
    const assetId = body.asset_id || body.assetId;
    const force = body.force === true;

    if (!assetId) {
      return err("asset_id is required");
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: asset, error: fetchErr } = await db
      .from("assets")
      .select("id, filename, relative_path, file_type, tags, licensor_id, property_id, thumbnail_url, status, ai_tagged_at, sku, style_group_id")
      .eq("id", assetId)
      .single();

    if (fetchErr || !asset) return err("Asset not found", 404);

    if (asset.status === "tagged" && asset.ai_tagged_at && !force) {
      console.log("ai-tag SKIP", {
        assetId,
        reason: "already_tagged",
        ai_tagged_at: asset.ai_tagged_at,
      });
      return json({
        ok: true,
        skipped: true,
        reason: "already_tagged",
        asset_id: assetId,
        ai_tagged_at: asset.ai_tagged_at,
      });
    }

    const thumbnailUrl = body.thumbnail_url || asset.thumbnail_url;
    if (!thumbnailUrl) {
      return err("Asset has no thumbnail_url \u2014 cannot analyze without an image");
    }

    // Fetch custom tagging instructions and AI model config in parallel
    const [instrResult, modelsResult] = await Promise.all([
      db.from("admin_config").select("value").eq("key", "TAGGING_INSTRUCTIONS").maybeSingle(),
      db.from("admin_config").select("value").eq("key", "AI_MODELS").maybeSingle(),
    ]);
    const customInstructions = typeof instrResult.data?.value === "string" ? instrResult.data.value.trim() : null;

    // Resolve which Gemini model to use — prefer the configured vision-capable Google model
    const aiModels = Array.isArray(modelsResult.data?.value)
      ? modelsResult.data.value as Array<{
        id: string;
        provider: string;
        apiModel: string;
        capabilities: string[];
      }>
      : [];
    const visionModel = aiModels.find(
      (m) => m.provider === "google" && Array.isArray(m.capabilities) && m.capabilities.includes("vision"),
    );
    const geminiModel = visionModel?.apiModel ?? "gemini-2.5-flash-preview-04-17";

    // Fetch taxonomy context
    const { data: licensors } = await db.from("licensors").select("id, name").limit(50);
    const { data: properties } = await db.from("properties").select("id, name, licensor_id").limit(200);

    // Two-tier character matching: priority characters first, full list as fallback
    let characters: { id: string; name: string }[] = [];
    let usingPriorityOnly = false;

    if (asset.property_id) {
      // Tier 1: priority characters for this property
      const { data: priorityChars } = await db
        .from("characters")
        .select("id, name")
        .eq("property_id", asset.property_id)
        .eq("is_priority", true)
        .order("usage_count", { ascending: false });

      if (priorityChars && priorityChars.length > 0) {
        characters = priorityChars;
        usingPriorityOnly = true;
      } else {
        // Tier 2: all characters for this property
        const { data: allChars } = await db
          .from("characters")
          .select("id, name")
          .eq("property_id", asset.property_id)
          .order("name");
        characters = allChars ?? [];
      }
    } else if (asset.licensor_id) {
      const { data: propIds } = await db
        .from("properties")
        .select("id")
        .eq("licensor_id", asset.licensor_id);
      const ids = (propIds ?? []).map((p: { id: string }) => p.id);

      if (ids.length > 0) {
        // Tier 1: priority chars across all licensor properties
        const { data: priorityChars } = await db
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
          // Tier 2: all chars for licensor, capped
          const { data: allChars } = await db
            .from("characters")
            .select("id, name")
            .in("property_id", ids)
            .limit(300);
          characters = allChars ?? [];
        }
      }
    } else {
      // No licensor known \u2014 priority chars globally
      const { data: priorityChars } = await db
        .from("characters")
        .select("id, name")
        .eq("is_priority", true)
        .order("usage_count", { ascending: false })
        .limit(150);
      characters = priorityChars ?? [];
    }

    const charContext = usingPriorityOnly
      ? `Priority characters for this property/licensor (match from this list first):\n`
      : `Characters (full list for this property):\n`;

    const taxonomyContext = [
      `Licensors: ${(licensors || []).map((l) => `${l.name} (${l.id})`).join(", ")}`,
      `Properties: ${(properties || []).map((p) => `${p.name} (${p.id})`).join(", ")}`,
      `${charContext}${(characters || []).map((c) => `${c.name} (${c.id})`).join(", ")}`,
    ].join("\n");

    // Fetch ERP item_description for cover_description derivation
    let erpDescription: string | null = null;
    if (asset.sku) {
      const { data: erpItem } = await db
        .from("erp_items_current")
        .select("item_description")
        .eq("style_number", asset.sku)
        .maybeSingle();
      erpDescription = erpItem?.item_description ?? null;
    }

    // Fetch extracted PDF text (if this asset has a text sample)
    const { data: pdfSample } = await db
      .from("pdf_text_samples")
      .select("extracted_text")
      .eq("asset_id", asset.id)
      .order("sampled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const extractedPdfText = pdfSample?.extracted_text ?? null;

    const systemPrompt = buildTaggingSystemPrompt({
      asset,
      taxonomyContext,
      erpDescription,
      extractedPdfText,
      customInstructions,
      usingPriorityOnly,
    });

    console.log("ai-tag START", {
      assetId,
      force,
      currentStatus: asset.status,
      alreadyTagged: !!asset.ai_tagged_at,
      usingPriorityOnly,
      characterCount: characters.length,
    });

    // Fetch thumbnail and encode as base64 for Gemini inlineData
    let imageBase64: string;
    let imageMimeType: string;
    try {
      const imgResp = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(15_000) });
      if (!imgResp.ok) return err(`Failed to fetch thumbnail: ${imgResp.status}`, 500);
      const contentType = imgResp.headers.get("content-type") || "image/jpeg";
      imageMimeType = contentType.split(";")[0].trim();
      const bytes = new Uint8Array(await imgResp.arrayBuffer());
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      imageBase64 = btoa(binary);
    } catch (e) {
      return err(`Failed to load thumbnail image: ${e instanceof Error ? e.message : e}`, 500);
    }

    // Retry logic for transient AI errors
    const MAX_AI_RETRIES = 2;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GOOGLE_AI_API_KEY}`,
        {
          signal: AbortSignal.timeout(25_000),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
                  { text: "Analyze this design asset image and return structured tags using the tag_asset function." },
                ],
              },
            ],
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "tag_asset",
                    description: "Return structured tagging data for this design asset.",
                    parameters: GEMINI_TAG_ASSET_SCHEMA as never,
                  },
                ],
              },
            ],
            tool_config: {
              function_calling_config: {
                mode: "ANY",
                allowed_function_names: ["tag_asset"],
              },
            },
          }),
        },
      );

      if (response!.ok) break;

      // Non-retryable errors
      if (response!.status === 429) {
        return err("AI rate limit exceeded. Try again later.", 429);
      }

      // Retryable: 5xx errors
      if (response!.status >= 500 && attempt < MAX_AI_RETRIES) {
        console.warn(`ai-tag transient error (attempt ${attempt + 1}/${MAX_AI_RETRIES + 1}): ${response!.status}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      const text = await response!.text();
      console.error("Gemini API error:", response!.status, text);
      return err("AI API error", 500);
    }

    const aiResult = await response!.json();
    const functionCall = aiResult.candidates?.[0]?.content?.parts?.[0]?.functionCall;

    if (!functionCall?.args) {
      return err("AI did not return structured tags", 500);
    }

    const tagData = functionCall.args as Record<string, unknown>;

    // UUID validation helper \u2014 AI models sometimes return "null", descriptive text, or malformed strings
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

    const updates: Record<string, unknown> = {
      status: "tagged",
      ai_tagged_at: new Date().toISOString(),
    };
    // Tags now go into asset_tags table, not the flat array
    if (tagData.ai_description) updates.ai_description = tagData.ai_description;
    if (tagData.cover_description) updates.cover_description = tagData.cover_description;
    if (tagData.scene_description) updates.scene_description = tagData.scene_description;
    if (tagData.asset_type) updates.asset_type = tagData.asset_type;
    if (tagData.art_source) updates.art_source = tagData.art_source;
    if (tagData.design_style) updates.design_style = tagData.design_style;
    if (tagData.design_ref) updates.design_ref = tagData.design_ref;
    // Only write UUID foreign-key fields if the AI returned a valid UUID
    if (isValidUuid(tagData.licensor_id)) updates.licensor_id = tagData.licensor_id;
    if (isValidUuid(tagData.property_id)) updates.property_id = tagData.property_id;
    if (tagData.designer_name) updates.designer_name = tagData.designer_name;
    if (tagData.technical_designer_name) updates.technical_designer_name = tagData.technical_designer_name;
    if (tagData.freelancer_name) updates.freelancer_name = tagData.freelancer_name;

    let { error: updateErr } = await db
      .from("assets")
      .update(updates)
      .eq("id", assetId);

    // If FK constraint fails (AI hallucinated a licensor/property UUID), retry without FK fields
    if (updateErr && (updateErr.code === "23503" || updateErr.code === "22P02")) {
      console.warn("ai-tag: FK/type error, retrying without licensor_id/property_id:", updateErr.message);
      delete updates.licensor_id;
      delete updates.property_id;
      const retry = await db.from("assets").update(updates).eq("id", assetId);
      updateErr = retry.error;
    }

    if (updateErr) {
      console.error("Failed to update asset:", updateErr);
      return err("Failed to save tags", 500);
    }

    // Write tags to asset_tags with provenance
    if (Array.isArray(tagData.tags) && tagData.tags.length > 0) {
      // Delete old AI tags for this asset (preserves manual tags)
      await db.from("asset_tags").delete().eq("asset_id", assetId).eq("source", "ai");

      // Insert new AI tags
      const tagRows = (tagData.tags as string[]).map((t: string) => ({
        asset_id: assetId,
        tag: t.trim().toLowerCase(),
        source: "ai",
      }));
      const { error: tagInsertErr } = await db.from("asset_tags").upsert(tagRows, {
        onConflict: "asset_id,tag",
      });
      if (tagInsertErr) {
        console.error("Failed to insert asset_tags:", tagInsertErr);
        // Non-fatal: asset metadata was already saved
      }
    }

    console.log("ai-tag SUCCESS", {
      assetId,
      tagsCount: (tagData.tags as string[])?.length ?? 0,
      hasDescription: !!tagData.ai_description,
    });

    if (Array.isArray(tagData.character_ids) && tagData.character_ids.length > 0) {
      const validCharIds = (tagData.character_ids as string[]).filter((cid) => isValidUuid(cid));
      if (validCharIds.length > 0) {
        const charLinks = validCharIds.map((cid) => ({
          asset_id: assetId,
          character_id: cid,
        }));
        await db.from("asset_characters").upsert(charLinks, {
          onConflict: "asset_id,character_id",
        });
      }
    }

    // Upsert files_used entries to sku_files_used (licensed products only).
    // Style Guide Sources may ONLY come from a licensing-sheet / tech-pack PDF
    // (see migration 20260610070731). Tagging of other artwork (.ai, packaging,
    // non-licensing PDFs) must NOT write rows here even if the model returns a
    // files_used list. ignoreDuplicates keeps pre-gating legacy rows intact.
    if (
      isStyleGuideSourcePdf(asset) && asset.sku &&
      Array.isArray(tagData.files_used) && (tagData.files_used as string[]).length > 0
    ) {
      const rows = (tagData.files_used as string[])
        .filter((f: string) => typeof f === "string" && f.trim().length > 0)
        .map((f: string) => ({ sku: asset.sku as string, file_name: f.trim(), source: "ai_tag" }));
      if (rows.length > 0) {
        await db.from("sku_files_used").upsert(rows, { onConflict: "sku,file_name", ignoreDuplicates: true });
      }
    }

    // NOTE: Do not propagate sibling tags here.
    // Bulk propagation is handled by the dedicated propagate job / Tag + Propagate flow.
    // Keeping per-asset tagging focused prevents gateway timeouts on large runs.
    return json({
      ok: true,
      asset_id: assetId,
      tag_data: tagData,
    });
  } catch (e) {
    console.error("ai-tag error:", e);
    return err(e instanceof Error ? e.message : "Internal error", 500);
  }
});
