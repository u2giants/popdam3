/**
 * Shared AI-provider cascade for PDF page transcription (#708): ScaleDown →
 * OpenRouter → legacy direct Google/Anthropic, resolved from the model catalog.
 * Previously duplicated between the bridge and Windows pdf-text-sampler
 * modules; the ScaleDown envelope rules and OpenRouter failure handling must
 * stay in lockstep, so they live here once.
 *
 * Platform branches are injected by each agent's sampler wrapper:
 *   - loadAnthropicSdk: the bridge eagerly imports @anthropic-ai/sdk (its
 *     Docker image ships it); the Windows agent loads it lazily via require()
 *     because OTA dist updates may not include it.
 *   - directPdfVision: Windows-only lease-bound route for `meta-direct/`
 *     selections (docs/MODEL_RULES.md). When absent, a meta-direct selection
 *     fails closed with the caller's message instead of ever reaching
 *     openrouter.ai — the bridge has no lease and must never forward one.
 */

import { logger } from "./logger.js";

export const PDF_EXTRACTION_PROMPT = "Transcribe only text that is visually legible. Preserve reading order where possible. Do not infer, complete, correct, or invent unclear text. Omit unreadable text. Return only the transcription.";

const SCALEDOWN_URL = "https://api.scaledown.xyz/v1/chat/completions";

export interface PdfAiModelDef {
  id: string;
  provider: string;
  apiModel: string;
  capabilities: string[];
}

/** The AI fields both agents' AiConfig carry (structurally compatible). */
export interface PdfAiVisionConfig {
  models: PdfAiModelDef[];
  pdf_extraction: { ai_vision_model_id: string } | null;
  googleApiKey: string;
  anthropicApiKey: string;
  openRouterApiKey?: string;
  scaleDownApiKey?: string;
  aiTaskModels?: Record<string, string>;
}

export interface PdfAiVisionDeps {
  /** Returns the Anthropic SDK class (or its module namespace), or null when unavailable. */
  loadAnthropicSdk: () => unknown;
  /** Windows-only: server-side content-lease route for meta-direct/ selections. */
  directPdfVision?: (page: Buffer) => Promise<string>;
  /** Error thrown when a meta-direct/ selection has no lease route (fail closed). */
  metaDirectUnavailableMessage: string;
}

/**
 * ScaleDown's summarize model takes the page as a base64 `document` (its own
 * non-standard field, the same shape the worker's image tagging uses) and
 * usually answers with {"summary": "..."} — unwrap it, but accept plain text.
 * A truncated or error envelope is an error, not page text: extraction output
 * is indexed for search and fed into image tagging, so JSON must never land
 * there (the worker's ScaleDown client rejects the same condition).
 */
async function transcribeWithScaleDown(base64: string, apiKey: string): Promise<string> {
  const resp = await fetch(SCALEDOWN_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: "summarize",
      messages: [
        { role: "system", content: PDF_EXTRACTION_PROMPT },
        { role: "user", content: "Transcribe the document image." },
      ],
      document: base64,
      document_mime_type: "image/png",
      max_tokens: 4096,
    }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`ScaleDown ${resp.status}: ${body.slice(0, 200)}`);
  const payload = JSON.parse(body) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("ScaleDown PDF transcription hit the output token limit");
  const content = choice?.message?.content;
  if (!content || !content.trim()) throw new Error("ScaleDown returned an empty PDF transcription");
  const trimmed = content.trim();
  let envelope: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) envelope = parsed as Record<string, unknown>;
  } catch {
    // Not JSON — the model answered with the transcription itself.
  }
  if (envelope && ("summary" in envelope || "finish_reason" in envelope || "error" in envelope)) {
    // The envelope's own finish_reason/error wins over a partial summary —
    // same rule as the worker's ScaleDown client.
    if (envelope.finish_reason === "length") throw new Error("ScaleDown PDF transcription hit the output token limit");
    if (envelope.error) throw new Error(`ScaleDown returned an error envelope: ${trimmed.slice(0, 200)}`);
    if (typeof envelope.summary === "string" && envelope.summary.trim()) return envelope.summary.trim();
    throw new Error(`ScaleDown returned no transcription text: ${trimmed.slice(0, 200)}`);
  }
  return trimmed;
}

export async function callPdfAiVision(
  pngBuffer: Buffer,
  aiConfig: PdfAiVisionConfig,
  deps: PdfAiVisionDeps,
): Promise<string> {
  // Checked before everything else: a direct Meta selection is lease-bound and
  // Windows-only. Without the lease route it fails closed rather than being
  // posted to openrouter.ai (docs/MODEL_RULES.md).
  if (aiConfig.aiTaskModels?.pdf_extraction?.trim().startsWith("meta-direct/")) {
    if (!deps.directPdfVision) throw new Error(deps.metaDirectUnavailableMessage);
    return deps.directPdfVision(pngBuffer);
  }

  const base64 = pngBuffer.toString("base64");

  // Checked before the OpenRouter path: a ScaleDown id must never be posted
  // to openrouter.ai, which does not host it.
  if (aiConfig.aiTaskModels?.pdf_extraction?.trim().startsWith("scaledown/")) {
    if (!aiConfig.scaleDownApiKey) throw new Error("SCALEDOWN_API_KEY is not configured in Settings");
    return transcribeWithScaleDown(base64, aiConfig.scaleDownApiKey);
  }

  // ── Path 1: OpenRouter (preferred when key is configured) ───────────────
  if (aiConfig.openRouterApiKey) {
    const model = aiConfig.aiTaskModels?.pdf_extraction;
    if (!model) throw new Error("PDF AI configuration has an OpenRouter key but no pdf_extraction model");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${aiConfig.openRouterApiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
            { type: "text", text: PDF_EXTRACTION_PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string } }> };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new Error("OpenRouter refused PDF transcription");
    if (!choice?.message || typeof choice.message.content !== "string") throw new Error("OpenRouter returned a malformed PDF transcription response");
    return choice.message.content.trim();
  }

  // ── Path 2: Legacy direct API (backward compat when no OpenRouter key) ──
  const modelId = aiConfig.pdf_extraction?.ai_vision_model_id;
  if (!modelId) throw new Error("No usable PDF AI provider is configured");

  const modelDef = aiConfig.models.find((m) => m.id === modelId);
  if (!modelDef) {
    logger.warn("PDF text sample: ai vision model not found in catalog", { modelId });
    throw new Error(`PDF AI model ${modelId} was not found in the catalog`);
  }
  if (!modelDef.capabilities.includes("vision")) {
    logger.warn("PDF text sample: selected model has no vision capability", { modelId });
    throw new Error(`PDF AI model ${modelId} does not support vision`);
  }

  if (modelDef.provider === "google") {
    if (!aiConfig.googleApiKey) {
      logger.warn("PDF text sample: GOOGLE_AI_API_KEY not configured");
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelDef.apiModel}:generateContent?key=${aiConfig.googleApiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: base64 } },
            { text: PDF_EXTRACTION_PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text as string || "").trim();

  } else if (modelDef.provider === "anthropic") {
    if (!aiConfig.anthropicApiKey) {
      logger.warn("PDF text sample: ANTHROPIC_API_KEY not configured");
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AnthropicLib = deps.loadAnthropicSdk() as any;
    if (!AnthropicLib) throw new Error("@anthropic-ai/sdk not installed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Anthropic: any = AnthropicLib.default ?? AnthropicLib;
    const anthropic = new Anthropic({ apiKey: aiConfig.anthropicApiKey });
    const aiResponse = await anthropic.messages.create({
      model: modelDef.apiModel,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
          { type: "text", text: PDF_EXTRACTION_PROMPT },
        ],
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = aiResponse.content[0] as any;
    return (first?.type === "text" ? (first.text as string) : "").trim();
  }

  logger.warn("PDF text sample: unsupported ai vision provider", { provider: modelDef.provider });
  throw new Error(`Unsupported PDF AI provider: ${modelDef.provider}`);
}
