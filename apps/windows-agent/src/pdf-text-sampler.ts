/**
 * PDF Text Sampler (Windows Agent)
 *
 * Reads each PDF asset from the NAS and extracts text using a cascade:
 *
 *   1. mupdf  — native text extraction (primary; robust C library)
 *   2. OCR    — tesseract.js on a mupdf-rendered page image (scanned PDFs)
 *   3. AI     — vision model from PDF_EXTRACTION_CONFIG/AI_MODELS catalog
 *
 * Reports per-file progress back to the cloud so the UI shows real-time status.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger";
import * as api from "./api-client";

// OTA-safe: mupdf, tesseract.js, and @anthropic-ai/sdk are only available after
// a full installer run, not OTA dist updates. Load them lazily inside the function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryRequire(mod: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(mod);
  } catch {
    return null;
  }
}

export interface PdfSampleAsset {
  id: string;
  relative_path: string;
  filename: string;
}

export interface AiModelDef {
  id: string;
  provider: string;
  apiModel: string;
  capabilities: string[];
}

export interface AiConfig {
  models: AiModelDef[];
  pdf_extraction: { ai_vision_model_id: string } | null;
  googleApiKey: string;
  anthropicApiKey: string;
  /** OpenRouter API key — if set, all AI vision calls go through openrouter.ai */
  openRouterApiKey?: string;
  /** Per-task model overrides from AI_TASK_MODELS admin config */
  aiTaskModels?: Record<string, string>;
}

export interface PdfTextSampleResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision";
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
}

interface FileProgressEntry {
  filename: string;
  status: "success" | "failed";
  method: string;
  chars: number;
  error?: string;
}

// ── AI vision call ────────────────────────────────────────────────────────────

const PDF_EXTRACTION_PROMPT = "Extract all text from this document page. Return only the raw extracted text with no commentary.";

async function callAiVision(pngBuffer: Buffer, aiConfig: AiConfig): Promise<string> {
  const base64 = pngBuffer.toString("base64");

  // ── Path 1: OpenRouter (preferred when key is configured) ───────────────
  if (aiConfig.openRouterApiKey) {
    const model = aiConfig.aiTaskModels?.pdf_extraction ?? "google/gemini-2.0-flash-001";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aiConfig.openRouterApiKey}`,
        "Content-Type": "application/json",
      },
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
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter API ${res.status}: ${errText.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return ((data?.choices?.[0]?.message?.content as string) ?? "").trim();
  }

  // ── Path 2: Legacy direct API (backward compat when no OpenRouter key) ──
  const modelId = aiConfig.pdf_extraction?.ai_vision_model_id;
  if (!modelId) return "";

  const modelDef = aiConfig.models.find((m) => m.id === modelId);
  if (!modelDef) {
    logger.warn("PDF text sample: ai vision model not found in catalog", { modelId });
    return "";
  }
  if (!modelDef.capabilities.includes("vision")) {
    logger.warn("PDF text sample: selected model has no vision capability", { modelId });
    return "";
  }

  if (modelDef.provider === "google") {
    if (!aiConfig.googleApiKey) {
      logger.warn("PDF text sample: GOOGLE_AI_API_KEY not configured");
      return "";
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
      return "";
    }
    const AnthropicLib = tryRequire("@anthropic-ai/sdk");
    if (!AnthropicLib) throw new Error("@anthropic-ai/sdk not installed");
    const Anthropic = AnthropicLib.default ?? AnthropicLib;
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
  return "";
}

// ── Progress reporter (fire-and-forget) ──────────────────────────────────────

async function reportProgress(
  processed: number,
  total: number,
  currentFile: string | null,
  currentStep: string | null,
  fileResults: FileProgressEntry[],
  error?: string,
): Promise<void> {
  try {
    await api.reportPdfTextSampleProgress({
      processed,
      total,
      current_file: currentFile,
      current_step: currentStep,
      file_results: fileResults.slice(-25), // keep last 25 for UI
      ...(error ? { error } : {}),
    });
  } catch (e) {
    logger.warn("PDF text sample: progress report failed (non-fatal)", {
      error: (e as Error).message,
    });
  }
}

// ── Process a single PDF ─────────────────────────────────────────────────────

async function processSinglePdf(
  asset: PdfSampleAsset,
  fullPath: string,
  aiConfig: AiConfig,
  index: number,
  total: number,
  fileResults: FileProgressEntry[],
): Promise<PdfTextSampleResult> {
  // Report: starting this file
  await reportProgress(index, total, asset.filename, "reading", fileResults);

  const buffer = await readFile(fullPath);

  let rawText = "";
  let numPages: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mupdfRef: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mupdfDoc: any = null;

  // ── Step 1: mupdf text extraction ───────────────────────────────────
  await reportProgress(index, total, asset.filename, "mupdf", fileResults);
  try {
    mupdfRef = await dynamicImport("mupdf").catch(() => null);
    if (!mupdfRef) throw new Error("mupdf not installed");
    mupdfDoc = mupdfRef.Document.openDocument(buffer, "application/pdf");
    numPages = mupdfDoc.countPages();
    const parts: string[] = [];
    for (let p = 0; p < (numPages ?? 0); p++) {
      parts.push(mupdfDoc.loadPage(p).toStructuredText("preserve-whitespace").asText());
    }
    rawText = parts.join("\n");
  } catch (mupdfErr) {
    logger.warn("PDF text sample: mupdf text extraction failed", {
      filename: asset.filename,
      error: (mupdfErr as Error).message,
    });
  }

  const text = rawText.trim();
  const charCount = text.length;

  if (charCount >= 100) {
    logger.info("PDF text sample: extracted via mupdf text", {
      filename: asset.filename, chars: charCount, pages: numPages,
    });
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "pdf_text", extracted_text: text,
      page_count: numPages, char_count: charCount, extraction_error: null,
    };
  }

  // ── Step 2: render page 0 to PNG ────────────────────────────────────
  await reportProgress(index, total, asset.filename, "rendering", fileResults);
  let pngBuffer: Buffer | null = null;
  try {
    if (!mupdfRef) mupdfRef = await dynamicImport("mupdf").catch(() => null);
    if (mupdfRef) {
      if (!mupdfDoc) {
        mupdfDoc = mupdfRef.Document.openDocument(buffer, "application/pdf");
        numPages = mupdfDoc.countPages();
      }
      const page = mupdfDoc.loadPage(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pixmap = page.toPixmap([2, 0, 0, 2, 0, 0] as any, mupdfRef.ColorSpace.DeviceRGB, false);
      pngBuffer = Buffer.from(pixmap.asPNG() as Uint8Array);
    }
  } catch (renderErr) {
    logger.warn("PDF text sample: mupdf page render failed", {
      filename: asset.filename, error: (renderErr as Error).message,
    });
  }

  // ── Step 3: OCR via tesseract.js ────────────────────────────────────
  let ocrText = "";
  if (pngBuffer) {
    await reportProgress(index, total, asset.filename, "ocr", fileResults);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tesseractLib: any = await dynamicImport("tesseract.js").catch(() => null);
      if (!tesseractLib) throw new Error("tesseract.js not installed");
      const worker = await tesseractLib.createWorker("eng");
      const ocrResult = await worker.recognize(pngBuffer);
      await worker.terminate();
      ocrText = (ocrResult.data.text as string).trim();
    } catch (ocrErr) {
      logger.warn("PDF text sample: OCR failed", {
        filename: asset.filename, error: (ocrErr as Error).message,
      });
    }
  }

  if (ocrText.length >= 100) {
    logger.info("PDF text sample: extracted via OCR", {
      filename: asset.filename, chars: ocrText.length,
    });
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "ocr_text", extracted_text: ocrText,
      page_count: numPages, char_count: ocrText.length, extraction_error: null,
    };
  }

  // ── Step 4: AI vision ───────────────────────────────────────────────
  let aiText = "";
  let aiErrMsg = "";
  if (pngBuffer) {
    await reportProgress(index, total, asset.filename, "ai_vision", fileResults);
    try {
      aiText = await callAiVision(pngBuffer, aiConfig);
    } catch (aiErr) {
      aiErrMsg = (aiErr as Error).message;
      logger.warn("PDF text sample: AI vision failed", {
        filename: asset.filename, error: aiErrMsg,
      });
    }
  }

  if (aiText.length > 0) {
    logger.info("PDF text sample: extracted via AI vision", {
      filename: asset.filename, chars: aiText.length,
    });
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "ai_vision", extracted_text: aiText,
      page_count: numPages, char_count: aiText.length, extraction_error: null,
    };
  }

  const finalText = ocrText.length > 0 ? ocrText : text;
  const finalCount = finalText.length;
  const method: "pdf_text" | "likely_scanned" | "failed" =
    finalCount >= 100 ? "pdf_text" : finalCount > 0 ? "likely_scanned" : "failed";

  return {
    asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
    extraction_method: method,
    extracted_text: finalCount > 0 ? finalText : null,
    page_count: numPages, char_count: finalCount,
    extraction_error: aiErrMsg ? aiErrMsg.slice(0, 500) : null,
  };
}

// ── Main sampler ──────────────────────────────────────────────────────────────

export async function runPdfTextSample(
  assets: PdfSampleAsset[],
  mountRoot: string,
  aiConfig: AiConfig,
): Promise<void> {
  if (assets.length === 0) {
    logger.info("PDF text sample: no assets to process");
    return;
  }

  logger.info("PDF text sample: starting", { count: assets.length, mountRoot });

  const results: PdfTextSampleResult[] = [];
  const fileResults: FileProgressEntry[] = [];

  // Report initial pickup
  await reportProgress(0, assets.length, null, "starting", []);

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const fullPath = join(mountRoot, asset.relative_path);

    try {
      const result = await processSinglePdf(asset, fullPath, aiConfig, i, assets.length, fileResults);
      results.push(result);
      fileResults.push({
        filename: asset.filename,
        status: result.extraction_method === "failed" ? "failed" : "success",
        method: result.extraction_method,
        chars: result.char_count,
        error: result.extraction_error ?? undefined,
      });
    } catch (e) {
      const errMsg = (e as Error).message;
      logger.warn("PDF text sample: extraction failed", {
        filename: asset.filename, path: fullPath, error: errMsg,
      });
      results.push({
        asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
        extraction_method: "failed", extracted_text: null,
        page_count: null, char_count: 0, extraction_error: errMsg.slice(0, 500),
      });
      fileResults.push({
        filename: asset.filename, status: "failed", method: "failed", chars: 0, error: errMsg.slice(0, 200),
      });
    }

    // Report progress after each file
    await reportProgress(i + 1, assets.length, null, "done", fileResults);
  }

  try {
    await api.completePdfTextSample(results);
    logger.info("PDF text sample: completed", { total: results.length });
  } catch (e) {
    logger.error("PDF text sample: failed to submit results", { error: (e as Error).message });
    // Report the error so UI shows it
    await reportProgress(results.length, assets.length, null, "done", fileResults, (e as Error).message);
  }
}
