/**
 * PDF Text Sampler (Bridge Agent)
 *
 * Reads each PDF asset from the NAS and extracts text using a cascade:
 *
 *   1. mupdf  — native text extraction (primary; robust C library)
 *   2. OCR    — Indra (tesseract.js fallback) on a mupdf-rendered page image (scanned PDFs)
 *   3. AI     — vision model from PDF_EXTRACTION_CONFIG/AI_MODELS catalog
 *
 * Reports per-file progress back to the cloud so the UI shows real-time status.
 *
 * The AI-provider cascade (ScaleDown -> OpenRouter -> direct Google/Anthropic)
 * lives in packages/agent-common/src/pdf-ai-vision.ts, shared with the Windows
 * agent's sampler (#708). This module keeps the bridge-specific extraction
 * loop: eager native deps (Docker image ships them) and the .ai sentinel
 * classification pass, which the Windows sampler does not have.
 */

import { readFile, stat } from "node:fs/promises";
import { resolveUnderRoot } from "./common/path-containment.js";
import { logger } from "./common/logger.js";
import * as api from "./api-client.js";
import { uploadPdfPage } from "./uploader.js";
import { inspectAiPage } from "./ai-sentinel-detect.js";

import * as mupdf from "mupdf";
import { createWorker } from "tesseract.js";
import Anthropic from "@anthropic-ai/sdk";
import { indraPython, ocrPngWithIndra } from "./common/indra-ocr.js";
import { callPdfAiVision } from "./common/pdf-ai-vision.js";

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
  openRouterApiKey?: string;
  scaleDownApiKey?: string;
  aiTaskModels?: Record<string, string>;
}

/** Maximum PDF file size to load into memory (100 MB). Larger files are skipped. */
const PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;

export interface PdfTextSampleResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision" | "skipped";
  extracted_text: string | null;
  ocr_engine?: string | null;
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

export async function callAiVision(pngBuffer: Buffer, aiConfig: AiConfig): Promise<string> {
  return callPdfAiVision(pngBuffer, aiConfig, {
    // Docker image ships the SDK; the eager import preserves bridge behavior.
    loadAnthropicSdk: () => Anthropic,
    // No content-lease route on the bridge: a meta-direct/ selection fails
    // closed instead of being posted to openrouter.ai (docs/MODEL_RULES.md).
    metaDirectUnavailableMessage:
      "Direct Meta PDF transcription runs on the Windows agent; select a regular model or scaledown/ for the bridge",
  });
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

  // .ai files: classify sentinels with the shared detector, which combines the
  // page-0 warning-text check with a draw-operation probe. A plain text match is
  // NOT enough — real artwork often carries the CompatibilityAlert text too, and a
  // text-only match would flag (and later delete) genuine art. See ai-sentinel-detect.ts.
  //
  // A true sentinel's extracted_text is collapsed to exactly SENTINEL_PHRASE so the
  // cleanup UI can match it precisely; real .ai keep their actual extracted text.
  if (asset.filename.toLowerCase().endsWith(".ai")) {
    const SENTINEL_PHRASE = "This is an Adobe® Illustrator® File that was saved without PDF Content.";
    try {
      const info = await inspectAiPage(fullPath);

      if (info.isSentinel) {
        return {
          asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
          extraction_method: "pdf_text", ocr_engine: "embedded", extracted_text: SENTINEL_PHRASE,
          page_count: info.pageCount || 1, char_count: SENTINEL_PHRASE.length, extraction_error: null,
        };
      }

      const aiText = info.pageText.trim();
      return {
        asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
        extraction_method: "pdf_text", ocr_engine: "embedded",
        extracted_text: aiText || null,
        page_count: info.pageCount, char_count: aiText.length,
        extraction_error: null,
      };
    } catch (aiErr) {
      logger.warn("PDF text sample: .ai mupdf check failed", { filename: asset.filename, error: (aiErr as Error).message });
      return {
        asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
        extraction_method: "failed", extracted_text: null,
        page_count: null, char_count: 0,
        extraction_error: ((aiErr as Error).message).slice(0, 500),
      };
    }
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
      extraction_method: "pdf_text", ocr_engine: "embedded", extracted_text: text,
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

  // ── Step 3: OCR via Indra (tesseract.js only where Indra is not installed) ────────────────────────────────────
  let ocrText = "";
  let ocrEngine: "indra" | "tesseract" = "indra";
  if (pngBuffer) {
    await reportProgress(index, total, asset.filename, "ocr", fileResults);
    const indra = indraPython();
    let indraFailed = false;
    if (indra) {
      try {
        ocrText = await ocrPngWithIndra(indra, pngBuffer);
      } catch (e) {
        indraFailed = true;
        logger.warn("PDF text sample: Indra OCR failed, falling back to tesseract.js", { filename: asset.filename, error: (e as Error).message });
      }
    }
    if (!indra || indraFailed) {
      try {
        const worker = await createWorker("eng");
        const ocrResult = await worker.recognize(pngBuffer).finally(() => worker.terminate());
        ocrText = ocrResult.data.text.trim();
        ocrEngine = "tesseract";
      } catch (ocrErr) {
        logger.warn("PDF text sample: OCR failed", { filename: asset.filename, error: (ocrErr as Error).message });
      }
    }
  }

  if (ocrText.length >= 100) {
    logger.info("PDF text sample: extracted via OCR", {
      filename: asset.filename, chars: ocrText.length,
    });
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "ocr_text", ocr_engine: ocrEngine, extracted_text: ocrText,
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
      extraction_method: "ai_vision", ocr_engine: "ai_vision", extracted_text: aiText,
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
    extraction_method: method, ocr_engine: ocrText.length > 0 ? ocrEngine : "embedded",
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
    let fullPath = asset.relative_path;

    try {
      fullPath = resolveUnderRoot(mountRoot, asset.relative_path);
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
