/**
 * PDF/.ai full-library backfill — Windows render agent.
 *
 * Self-driven claim loop (claim 25 → process → commit → repeat). This is the same work the
 * bridge agent used to do, relocated to the on-LAN Windows VM so ALL text-extraction CPU
 * (mupdf parse, page render, tesseract OCR, AI vision) stays off the Synology NAS. Files are
 * read over the mapped SMB drive; the AI-vision step reuses callAiVision() from the existing
 * pdf-text-sampler pipeline.
 *
 * Resilience: a claim/commit fault logs + breaks the loop (the next heartbeat re-triggers).
 * runPdfBackfill must NEVER throw — an uncaught rejection here would take down the whole
 * agent process (this is exactly what crash-looped the bridge agent).
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger";
import * as api from "./api-client";
import { uploadThumbnail, uploadPdfPage } from "./uploader";
import { callAiVision, type AiConfig } from "./pdf-text-sampler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

const PDF_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const THUMBNAIL_WIDTH = 800;

// ── Process a single file (.pdf / .ai) ────────────────────────────────────────

async function processOne(
  asset: api.BackfillAsset,
  fullPath: string,
  aiConfig: AiConfig,
): Promise<api.BackfillResult> {
  const base = {
    asset_id: asset.id,
    filename: asset.filename,
    relative_path: asset.relative_path,
  };

  const fileStat = await stat(fullPath);
  if (fileStat.size > PDF_SIZE_LIMIT_BYTES) {
    return {
      ...base, extraction_method: "skipped", extracted_text: null,
      page_count: null, char_count: 0, extraction_error: null,
      sample_thumbnail_url: null, asset_thumbnail_url: null,
    };
  }

  const buffer = await readFile(fullPath);
  let rawText = "";
  let numPages: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mupdfRef: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mupdfDoc: any = null;

  // Step 1: mupdf native text extraction
  try {
    mupdfRef = await dynamicImport("mupdf").catch(() => null);
    if (!mupdfRef) throw new Error("mupdf not installed");
    mupdfDoc = mupdfRef.Document.openDocument(buffer, "application/pdf");
    numPages = mupdfDoc.countPages();
    const parts: string[] = [];
    for (let p = 0; p < (numPages ?? 0); p++) {
      parts.push(mupdfDoc.loadPage(p).toStructuredText("preserve-whitespace").asText());
    }
    rawText = parts.join("\n").trim();
  } catch (e) {
    logger.warn("PDF backfill: mupdf text failed", { filename: asset.filename, error: (e as Error).message });
  }

  // Step 2: render page 0 — when a thumbnail is needed, or text was scarce (OCR/AI input)
  let pngBuffer: Buffer | null = null;
  let sampleThumbnailUrl: string | null = null;
  let assetThumbnailUrl: string | null = null;

  if (asset.needs_thumbnail || rawText.length < 100) {
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

        // Hi-res page image for OCR/AI input + UI preview (pdf_text_samples.thumbnail_url)
        try {
          sampleThumbnailUrl = await uploadPdfPage(asset.id, 0, pngBuffer);
        } catch (e) {
          logger.warn("PDF backfill: page upload failed (non-fatal)", { filename: asset.filename, error: (e as Error).message });
        }

        // 800px JPEG asset thumbnail when the asset is missing one
        if (asset.needs_thumbnail) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sharpLib: any = await dynamicImport("sharp").catch(() => null);
            const sharp = sharpLib?.default ?? sharpLib;
            if (sharp) {
              const jpegBuffer = await sharp(pngBuffer)
                .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
              assetThumbnailUrl = await uploadThumbnail(asset.id, jpegBuffer);
            }
          } catch (e) {
            logger.warn("PDF backfill: thumbnail generate failed (non-fatal)", { filename: asset.filename, error: (e as Error).message });
          }
        }
      }
    } catch (e) {
      logger.warn("PDF backfill: page render failed", { filename: asset.filename, error: (e as Error).message });
    }
  }

  // Fast path: mupdf text was sufficient
  if (rawText.length >= 100) {
    return {
      ...base, extraction_method: "pdf_text", extracted_text: rawText,
      page_count: numPages, char_count: rawText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  // Step 3: OCR via tesseract.js
  let ocrText = "";
  if (pngBuffer) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tesseractLib: any = await dynamicImport("tesseract.js").catch(() => null);
      if (!tesseractLib) throw new Error("tesseract.js not installed");
      const worker = await tesseractLib.createWorker("eng");
      const result = await worker.recognize(pngBuffer);
      await worker.terminate();
      ocrText = (result.data.text as string).trim();
    } catch (e) {
      logger.warn("PDF backfill: OCR failed", { filename: asset.filename, error: (e as Error).message });
    }
  }

  if (ocrText.length >= 100) {
    return {
      ...base, extraction_method: "ocr_text", extracted_text: ocrText,
      page_count: numPages, char_count: ocrText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  // Step 4: AI vision (reuses the sampler's OpenRouter/Gemini/Anthropic routing)
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
      ...base, extraction_method: "ai_vision", extracted_text: aiText,
      page_count: numPages, char_count: aiText.length, extraction_error: null,
      sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
    };
  }

  const finalText = ocrText.length > 0 ? ocrText : rawText;
  const finalCount = finalText.length;
  const method = finalCount >= 100 ? "pdf_text" : finalCount > 0 ? "likely_scanned" : "failed";

  return {
    ...base, extraction_method: method,
    extracted_text: finalCount > 0 ? finalText : null,
    page_count: numPages, char_count: finalCount,
    extraction_error: aiErr ? aiErr.slice(0, 500) : null,
    sample_thumbnail_url: sampleThumbnailUrl, asset_thumbnail_url: assetThumbnailUrl,
  };
}

// ── Main backfill loop ────────────────────────────────────────────────────────

export async function runPdfBackfill(mountRoot: string, aiConfig: AiConfig): Promise<void> {
  logger.info("PDF backfill: starting", { mountRoot });
  let totalProcessed = 0;

  for (;;) {
    let batch: Awaited<ReturnType<typeof api.claimPdfBackfillBatch>>;
    try {
      batch = await api.claimPdfBackfillBatch();
    } catch (e) {
      // Never throw out of this function — log, stop, let the next heartbeat re-trigger.
      logger.error("PDF backfill: claim failed — stopping (will retry on next heartbeat)", { error: (e as Error).message });
      break;
    }

    if (batch.status !== "running") {
      logger.info("PDF backfill: stopped by server", { status: batch.status });
      break;
    }
    if (batch.assets.length === 0) {
      logger.info("PDF backfill: no more files — complete", { totalProcessed });
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
        logger.info("PDF backfill: file done", { filename: asset.filename, method: result.extraction_method, chars: result.char_count });
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

    try {
      const { remaining } = await api.completePdfBackfillBatch(results);
      totalProcessed += results.length;
      await api.reportPdfBackfillProgress(totalProcessed, batch.total, null, "idle");
      logger.info("PDF backfill: batch committed", { totalProcessed, remaining });
      if (remaining <= 0) {
        logger.info("PDF backfill: all files processed", { totalProcessed });
        break;
      }
    } catch (e) {
      logger.error("PDF backfill: commit failed — stopping (will retry on next heartbeat)", { error: (e as Error).message });
      break;
    }
  }

  logger.info("PDF backfill: loop exited", { totalProcessed });
}
