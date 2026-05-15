/**
 * PDF Backfill Worker
 *
 * Processes every PDF asset in the library that hasn't been sampled yet.
 * Runs as a self-driven claim loop: claim 25 → process → commit → repeat.
 *
 * Key differences from runPdfTextSample (sample mode):
 *   - Fetches its own work batches via claim-pdf-backfill-batch (no pre-loaded list)
 *   - Submits results per-batch instead of accumulating all at the end
 *   - Always generates an 800px JPEG thumbnail for assets that are missing one
 *   - FILES USED parsing happens server-side in TypeScript (no PL/pgSQL timeout)
 *   - Stops cleanly when status becomes "paused" or "completed"
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { logger } from "./logger.js";
import * as api from "./api-client.js";
import { uploadThumbnail, uploadPdfPage } from "./uploader.js";
import * as mupdf from "mupdf";
import { createWorker } from "tesseract.js";
import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "./pdf-text-sampler.js";

const PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const THUMBNAIL_WIDTH = 800;

// ── AI vision (mirrors pdf-text-sampler.ts) ───────────────────────────────────

async function callAiVision(pngBuffer: Buffer, aiConfig: AiConfig): Promise<string> {
  const modelId = aiConfig.pdf_extraction?.ai_vision_model_id;
  if (!modelId) return "";

  const modelDef = aiConfig.models.find((m) => m.id === modelId);
  if (!modelDef || !modelDef.capabilities.includes("vision")) return "";

  const base64 = pngBuffer.toString("base64");

  if (modelDef.provider === "google") {
    if (!aiConfig.googleApiKey) return "";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelDef.apiModel}:generateContent?key=${aiConfig.googleApiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: "image/png", data: base64 } },
          { text: "Extract all text from this document page. Return only the raw extracted text with no commentary." },
        ]}],
      }),
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text as string || "").trim();
  }

  if (modelDef.provider === "anthropic") {
    if (!aiConfig.anthropicApiKey) return "";
    const anthropic = new Anthropic({ apiKey: aiConfig.anthropicApiKey });
    const aiResponse = await anthropic.messages.create({
      model: modelDef.apiModel,
      max_tokens: 2048,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        { type: "text", text: "Extract all text from this document page. Return only the raw extracted text with no commentary." },
      ]}],
    });
    const first = aiResponse.content[0];
    return (first.type === "text" ? first.text : "").trim();
  }

  return "";
}

// ── Process a single PDF ──────────────────────────────────────────────────────

async function processOne(
  asset: api.BackfillAsset,
  fullPath: string,
  aiConfig: AiConfig,
): Promise<api.BackfillResult> {
  const fileStat = await stat(fullPath);
  if (fileStat.size > PDF_SIZE_LIMIT_BYTES) {
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "skipped", extracted_text: null,
      page_count: null, char_count: 0, extraction_error: null,
      sample_thumbnail_url: null, asset_thumbnail_url: null,
    };
  }

  const buffer = await readFile(fullPath);
  let rawText = "";
  let numPages: number | null = null;
  let mupdfDoc: ReturnType<typeof mupdf.Document.openDocument> | null = null;

  // Step 1: mupdf text extraction
  try {
    mupdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
    numPages = mupdfDoc.countPages();
    const parts: string[] = [];
    for (let p = 0; p < numPages; p++) {
      parts.push(mupdfDoc.loadPage(p).toStructuredText("preserve-whitespace").asText());
    }
    rawText = parts.join("\n").trim();
  } catch (e) {
    logger.warn("PDF backfill: mupdf text failed", { filename: asset.filename, error: (e as Error).message });
  }

  // Step 2: render page 0 — always when thumbnail needed, or when text < 100 chars (OCR fallback)
  let pngBuffer: Buffer | null = null;
  let sampleThumbnailUrl: string | null = null;
  let assetThumbnailUrl: string | null = null;

  if (asset.needs_thumbnail || rawText.length < 100) {
    try {
      if (!mupdfDoc) {
        mupdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
        numPages = mupdfDoc.countPages();
      }
      const page = mupdfDoc.loadPage(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pixmap = page.toPixmap([2, 0, 0, 2, 0, 0] as any, (mupdf as any).ColorSpace.DeviceRGB, false);
      pngBuffer = Buffer.from(pixmap.asPNG() as Uint8Array);

      // Upload hi-res page image (for pdf_text_samples.thumbnail_url — OCR/AI input)
      try {
        sampleThumbnailUrl = await uploadPdfPage(asset.id, 0, pngBuffer);
      } catch (e) {
        logger.warn("PDF backfill: page upload failed (non-fatal)", { filename: asset.filename, error: (e as Error).message });
      }

      // Generate 800px JPEG thumbnail for assets.thumbnail_url
      if (asset.needs_thumbnail) {
        try {
          const jpegBuffer = await sharp(pngBuffer)
            .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          assetThumbnailUrl = await uploadThumbnail(asset.id, jpegBuffer);
        } catch (e) {
          logger.warn("PDF backfill: thumbnail generate failed (non-fatal)", { filename: asset.filename, error: (e as Error).message });
        }
      }
    } catch (e) {
      logger.warn("PDF backfill: page render failed", { filename: asset.filename, error: (e as Error).message });
    }
  }

  // Fast path: mupdf text was sufficient
  if (rawText.length >= 100) {
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "pdf_text", extracted_text: rawText,
      page_count: numPages, char_count: rawText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  // Step 3: OCR via tesseract.js
  let ocrText = "";
  if (pngBuffer) {
    try {
      const worker = await createWorker("eng");
      const result = await worker.recognize(pngBuffer);
      await worker.terminate();
      ocrText = result.data.text.trim();
    } catch (e) {
      logger.warn("PDF backfill: OCR failed", { filename: asset.filename, error: (e as Error).message });
    }
  }

  if (ocrText.length >= 100) {
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "ocr_text", extracted_text: ocrText,
      page_count: numPages, char_count: ocrText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  // Step 4: AI vision
  let aiText = "";
  let aiErr = "";
  if (pngBuffer) {
    try {
      aiText = await callAiVision(pngBuffer, aiConfig);
    } catch (e) {
      aiErr = (e as Error).message;
    }
  }

  if (aiText.length > 0) {
    return {
      asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
      extraction_method: "ai_vision", extracted_text: aiText,
      page_count: numPages, char_count: aiText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  const finalText = ocrText.length > 0 ? ocrText : rawText;
  const finalCount = finalText.length;
  const method = finalCount >= 100 ? "pdf_text" : finalCount > 0 ? "likely_scanned" : "failed";

  return {
    asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
    extraction_method: method,
    extracted_text: finalCount > 0 ? finalText : null,
    page_count: numPages, char_count: finalCount,
    extraction_error: aiErr ? aiErr.slice(0, 500) : null,
    sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
  };
}

// ── Main backfill loop ────────────────────────────────────────────────────────

export async function runPdfBackfill(
  mountRoot: string,
  aiConfig: AiConfig,
): Promise<void> {
  logger.info("PDF backfill: starting");
  let totalProcessed = 0;

  for (;;) {
    const batch = await api.claimPdfBackfillBatch();

    if (batch.status !== "running") {
      logger.info("PDF backfill: stopped by server", { status: batch.status });
      break;
    }

    if (batch.assets.length === 0) {
      logger.info("PDF backfill: no more assets — complete", { totalProcessed });
      break;
    }

    logger.info("PDF backfill: batch claimed", { count: batch.assets.length, remaining: batch.remaining });

    const results: api.BackfillResult[] = [];

    for (let i = 0; i < batch.assets.length; i++) {
      const asset = batch.assets[i];
      await api.reportPdfBackfillProgress(totalProcessed + i, batch.total, asset.filename, "processing");

      try {
        const result = await processOne(asset, join(mountRoot, asset.relative_path), aiConfig);
        results.push(result);
        logger.info("PDF backfill: file done", {
          filename: asset.filename,
          method: result.extraction_method,
          chars: result.char_count,
          thumbnail: !!result.asset_thumbnail_url,
        });
      } catch (e) {
        const errMsg = (e as Error).message;
        logger.warn("PDF backfill: file failed", { filename: asset.filename, error: errMsg });
        results.push({
          asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
          extraction_method: "failed", extracted_text: null,
          page_count: null, char_count: 0, extraction_error: errMsg.slice(0, 500),
          sample_thumbnail_url: null, asset_thumbnail_url: null,
        });
      }
    }

    const { remaining } = await api.completePdfBackfillBatch(results);
    totalProcessed += results.length;

    await api.reportPdfBackfillProgress(totalProcessed, batch.total, null, "idle");
    logger.info("PDF backfill: batch committed", { totalProcessed, remaining });

    if (remaining <= 0) {
      logger.info("PDF backfill: all files processed", { totalProcessed });
      break;
    }
  }

  logger.info("PDF backfill: loop exited", { totalProcessed });
}
