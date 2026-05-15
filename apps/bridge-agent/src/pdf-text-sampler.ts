/**
 * PDF Text Sampler (Bridge Agent)
 *
 * Reads each PDF asset from the NAS and extracts text using a cascade:
 *
 *   1. mupdf  — native text extraction (primary; robust C library)
 *   2. OCR    — tesseract.js on a mupdf-rendered page image (scanned PDFs)
 *   3. AI     — vision model from PDF_EXTRACTION_CONFIG/AI_MODELS catalog
 *
 * Reports per-file progress back to the cloud so the UI shows real-time status.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger.js";
import * as api from "./api-client.js";
import { uploadPdfPage } from "./uploader.js";
import { isAiWithoutPdfCompat } from "./thumbnailer.js";

import * as mupdf from "mupdf";
import { createWorker } from "tesseract.js";
import Anthropic from "@anthropic-ai/sdk";

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
}

/** Maximum PDF file size to load into memory (100 MB). Larger files are skipped. */
const PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;

export interface PdfTextSampleResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision" | "skipped";
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
  thumbnail_url?: string;
  /** Set when a file was intentionally skipped rather than failing */
  skip_reason?: string;
}

interface FileProgressEntry {
  filename: string;
  status: "success" | "failed";
  method: string;
  chars: number;
  error?: string;
}

// ── AI vision call (provider-agnostic, resolved from model catalog) ──────────

async function callAiVision(pngBuffer: Buffer, aiConfig: AiConfig): Promise<string> {
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

  const base64 = pngBuffer.toString("base64");

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
            { text: "Extract all text from this document page. Return only the raw extracted text with no commentary." },
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
    const anthropic = new Anthropic({ apiKey: aiConfig.anthropicApiKey });
    const aiResponse = await anthropic.messages.create({
      model: modelDef.apiModel,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
          { type: "text", text: "Extract all text from this document page. Return only the raw extracted text with no commentary." },
        ],
      }],
    });
    const first = aiResponse.content[0];
    return (first.type === "text" ? first.text : "").trim();
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
      file_results: fileResults.slice(-25),
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
  await reportProgress(index, total, asset.filename, "reading", fileResults);

  // .ai files: use the 64 KB header check instead of loading into mupdf.
  // Works regardless of file size; returns the known sentinel text if found.
  if (asset.filename.toLowerCase().endsWith(".ai")) {
    const isSentinel = await isAiWithoutPdfCompat(fullPath);
    const sentinelText = "This is an Adobe® Illustrator® File that was saved without PDF Content.";
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "pdf_text",
      extracted_text: isSentinel ? sentinelText : null,
      page_count: 1, char_count: isSentinel ? sentinelText.length : 0,
      extraction_error: null,
    };
  }

  // Check file size before loading into memory
  const fileStat = await stat(fullPath);
  if (fileStat.size > PDF_SIZE_LIMIT_BYTES) {
    const skipReason = `File too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB > ${PDF_SIZE_LIMIT_BYTES / 1024 / 1024} MB limit)`;
    logger.warn("PDF text sample: skipping oversized file", {
      filename: asset.filename, size_bytes: fileStat.size, limit_bytes: PDF_SIZE_LIMIT_BYTES,
    });
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "skipped", extracted_text: null,
      page_count: null, char_count: 0,
      extraction_error: null, skip_reason: skipReason,
    };
  }

  const buffer = await readFile(fullPath);

  let rawText = "";
  let numPages: number | null = null;
  let mupdfDoc: ReturnType<typeof mupdf.Document.openDocument> | null = null;

  // ── Step 1: mupdf text extraction ───────────────────────────────────
  await reportProgress(index, total, asset.filename, "mupdf", fileResults);
  try {
    mupdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
    numPages = mupdfDoc.countPages();
    const parts: string[] = [];
    for (let p = 0; p < numPages; p++) {
      parts.push(mupdfDoc.loadPage(p).toStructuredText("preserve-whitespace").asText());
    }
    rawText = parts.join("\n");
  } catch (mupdfErr) {
    logger.warn("PDF text sample: mupdf text extraction failed", {
      filename: asset.filename, error: (mupdfErr as Error).message,
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
  let thumbnailUrl: string | undefined;
  try {
    if (!mupdfDoc) {
      mupdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
      numPages = mupdfDoc.countPages();
    }
    const page = mupdfDoc.loadPage(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pixmap = page.toPixmap([2, 0, 0, 2, 0, 0] as any, (mupdf as any).ColorSpace.DeviceRGB, false);
    pngBuffer = Buffer.from(pixmap.asPNG() as Uint8Array);
    // Upload thumbnail so the UI can show a preview (best-effort, non-fatal)
    try {
      thumbnailUrl = await uploadPdfPage(asset.id, 0, pngBuffer);
    } catch (uploadErr) {
      logger.warn("PDF text sample: thumbnail upload failed (non-fatal)", {
        filename: asset.filename, error: (uploadErr as Error).message,
      });
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
      const worker = await createWorker("eng");
      const ocrResult = await worker.recognize(pngBuffer);
      await worker.terminate();
      ocrText = ocrResult.data.text.trim();
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
      thumbnail_url: thumbnailUrl,
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
      thumbnail_url: thumbnailUrl,
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
    thumbnail_url: thumbnailUrl,
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
      if (result.extraction_method === "skipped") {
        logger.warn("PDF text sample: file skipped — admin alert", {
          filename: asset.filename,
          relative_path: asset.relative_path,
          skip_reason: result.skip_reason,
        });
      }
      fileResults.push({
        filename: asset.filename,
        status: result.extraction_method === "failed" ? "failed" : "success",
        method: result.extraction_method,
        chars: result.char_count,
        error: result.skip_reason ?? result.extraction_error ?? undefined,
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
    await reportProgress(results.length, assets.length, null, "done", fileResults, (e as Error).message);
  }
}
