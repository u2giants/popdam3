import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: require valid JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return err("Missing Authorization header", 401);
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return err("LOVABLE_API_KEY not configured", 500);
  }

  try {
    const body = await req.json();
    // Accept both "asset_id" and "assetId" for compatibility
    const assetId = body.asset_id || body.assetId;

    if (!assetId) {
      return err("asset_id is required");
    }

    // Fetch asset metadata for context
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: asset, error: fetchErr } = await db
      .from("assets")
      .select("id, filename, relative_path, file_type, tags, licensor_id, property_id, thumbnail_url")
      .eq("id", assetId)
      .single();

    if (fetchErr || !asset) return err("Asset not found", 404);

    // Use provided thumbnail_url or fall back to the one stored on the asset
    const thumbnailUrl = body.thumbnail_url || asset.thumbnail_url;
    if (!thumbnailUrl) {
      return err("Asset has no thumbnail_url — cannot analyze without an image");
    }

    

    // Fetch custom tagging instructions
    const { data: instrRow } = await db
      .from("admin_config")
      .select("value")
      .eq("key", "TAGGING_INSTRUCTIONS")
      .maybeSingle();
    const customInstructions = typeof instrRow?.value === "string"
      ? instrRow.value.trim() : null;

    // Fetch taxonomy context
    const { data: licensors } = await db.from("licensors").select("id, name").limit(50);
    const { data: properties } = await db.from("properties").select("id, name, licensor_id").limit(200);
    const { data: characters } = await db.from("characters").select("id, name, property_id").limit(500);

    const taxonomyContext = [
      `Licensors: ${(licensors || []).map((l) => `${l.name} (${l.id})`).join(", ")}`,
      `Properties: ${(properties || []).map((p) => `${p.name} (${p.id})`).join(", ")}`,
      `Characters: ${(characters || []).map((c) => `${c.name} (${c.id})`).join(", ")}`,
    ].join("\n");

    const systemPrompt = `You are a design asset tagger for a consumer products company that licenses characters (Disney, Marvel, Star Wars, etc.).

Analyze the thumbnail image and file metadata to produce structured tags.

File: ${asset.filename}
Path: ${asset.relative_path}
Type: ${asset.file_type}
Existing tags: ${(asset.tags || []).join(", ") || "none"}

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
8. Suggested licensor_id and property_id from the taxonomy (if identifiable)${customInstructions ? `\n\nCOMPANY-SPECIFIC TAGGING INSTRUCTIONS:\n${customInstructions}` : ""}`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: thumbnailUrl },
                },
                {
                  type: "text",
                  text: "Analyze this design asset image and return structured tags using the tag_asset tool.",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "tag_asset",
                description:
                  "Return structured tagging data for this design asset.",
                parameters: {
                  type: "object",
                  properties: {
                    tags: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Descriptive tags: characters, styles, colors, themes",
                    },
                    ai_description: {
                      type: "string",
                      description:
                        "One-sentence description of the design asset",
                    },
                    scene_description: {
                      type: "string",
                      description: "What is depicted in the image",
                    },
                    asset_type: {
                      type: "string",
                      enum: ["art_piece", "product"],
                    },
                    art_source: {
                      type: "string",
                      enum: [
                        "freelancer",
                        "straight_style_guide",
                        "style_guide_composition",
                      ],
                    },
                    design_style: {
                      type: "string",
                      description: "e.g. flat, dimensional, vintage, modern",
                    },
                    design_ref: {
                      type: "string",
                      description:
                        "Any style number or design reference visible",
                    },
                    character_ids: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "UUIDs of identified characters from taxonomy",
                    },
                    licensor_id: {
                      type: "string",
                      description: "UUID of identified licensor",
                    },
                    property_id: {
                      type: "string",
                      description: "UUID of identified property",
                    },
                  },
                  required: ["tags", "ai_description", "scene_description"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "tag_asset" },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return err("AI rate limit exceeded. Try again later.", 429);
      }
      if (response.status === 402) {
        return err("AI credits exhausted. Add credits in workspace settings.", 402);
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return err("AI gateway error", 500);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return err("AI did not return structured tags", 500);
    }

    let tagData: Record<string, unknown>;
    try {
      tagData =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
    } catch {
      return err("Failed to parse AI tag response", 500);
    }

    // Apply tags to asset
    const updates: Record<string, unknown> = {
      status: "tagged",
    };
    if (tagData.tags) updates.tags = tagData.tags;
    if (tagData.ai_description) updates.ai_description = tagData.ai_description;
    if (tagData.scene_description) updates.scene_description = tagData.scene_description;
    if (tagData.asset_type) updates.asset_type = tagData.asset_type;
    if (tagData.art_source) updates.art_source = tagData.art_source;
    if (tagData.design_style) updates.design_style = tagData.design_style;
    if (tagData.design_ref) updates.design_ref = tagData.design_ref;
    if (tagData.licensor_id) updates.licensor_id = tagData.licensor_id;
    if (tagData.property_id) updates.property_id = tagData.property_id;

    const { error: updateErr } = await db
      .from("assets")
      .update(updates)
      .eq("id", assetId);

    if (updateErr) {
      console.error("Failed to update asset:", updateErr);
      return err("Failed to save tags", 500);
    }

    // Link characters if identified
    if (Array.isArray(tagData.character_ids) && tagData.character_ids.length > 0) {
      const charLinks = (tagData.character_ids as string[]).map((cid) => ({
        asset_id: assetId,
        character_id: cid,
      }));
      await db.from("asset_characters").upsert(charLinks, {
        onConflict: "asset_id,character_id",
      });
    }

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
