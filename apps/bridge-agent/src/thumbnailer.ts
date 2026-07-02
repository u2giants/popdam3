/**
 * Thumbnail generation per WORKER_LOGIC §5.
 *
 * PSD: Sharp reads PSD directly (flattened composite).
 * AI files:
 *   1) Try PDF-compat rendering via sharp (many .ai files are valid PDF)
 *   2) If fails, set thumbnail_error = "no_pdf_compat" and queue for Windows Render Agent
 */

import sharp from "sharp";
import { execFile } from "node:child_process";

// Disable libvips' operation cache — it accumulates native heap that V8's GC
// cannot reclaim, causing the process to grow to ~1 GB after days of idle
// post-scan operation.  Throughput impact is negligible for batch-once-per-scan
// usage patterns.
sharp.cache(false);
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorker } from "tesseract.js";
import { logger } from "./logger.js";
import { isAiSentinel } from "./ai-sentinel-detect.js";

const execFileAsync = promisify(execFile);

const THUMB_MAX_DIM = 800; // px
const SHARP_TIMEOUT_MS = 60_000; // 60 s per-step timeout — prevents hanging on corrupt/huge files
const PSD_TOTAL_TIMEOUT_MS = 90_000; // 90 s overall cap for the full PSD pipeline (3 steps × 60 s would exceed the UI's 3-min stale threshold)

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`sharp timeout after ${ms}ms (${label})`)), ms)
    ),
  ]);
}

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface PdfThumbnailResult extends ThumbnailResult {
  /** High-res page 1 image (1500px) for AI/OCR readability */
  hiresPage1Buffer: Buffer;
  /** High-res page 2 image (1500px) — undefined if PDF has only 1 page */
  hiresPage2Buffer?: Buffer;
  hiresPage2Width?: number;
  hiresPage2Height?: number;
}

/**
 * Generate a thumbnail for a PSD file.
 * Sharp can read PSD files directly (flattened composite).
 */
async function thumbnailPsd(filePath: string): Promise<ThumbnailResult> {
  try {
    const psdWork = async () => {
      // Pre-read into buffer so the OS file handle is released before we enter
      // the sharp pipeline.  If the pipeline hangs and withTimeout fires, the fd
      // is already closed — no leaked handles from timed-out processing.
      const fileBuffer = await readFile(filePath);
      const img = sharp(fileBuffer, { pages: -1 }).flatten({ background: "#ffffff" });
      const meta = await withTimeout(img.metadata(), SHARP_TIMEOUT_MS, "psd.metadata");
      const resized = img.resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
      const buffer = await withTimeout(resized.jpeg({ quality: 85 }).toBuffer(), SHARP_TIMEOUT_MS, "psd.toBuffer");
      const outMeta = await withTimeout(sharp(buffer).metadata(), SHARP_TIMEOUT_MS, "psd.outMeta");
      return {
        buffer,
        width: outMeta.width || meta.width || 0,
        height: outMeta.height || meta.height || 0,
      };
    };
    return await withTimeout(psdWork(), PSD_TOTAL_TIMEOUT_MS, "psd.total");
  } catch (e) {
    logger.warn("Sharp PSD failed", { filePath, error: (e as Error).message });
  }

  // Fallback: Try sibling image in same directory
  try {
    return await thumbnailFromSibling(filePath);
  } catch (e) {
    logger.warn("No sibling image found for PSD", { filePath });
  }

  throw new Error("no_preview_or_render_failed");
}

/**
 * Detect AI files saved without PDF compatibility (sentinels).
 *
 * When Illustrator saves without the "PDF compatibility" option, the embedded PDF
 * contains only Adobe's compatibility-alert warning page instead of real artwork.
 *
 * Delegates to the shared detector (see ai-sentinel-detect.ts), which combines the
 * page-0 warning-text check with a draw-operation probe so that real artwork carrying
 * the CompatibilityAlert text is NOT misclassified as a placeholder.
 *
 * Returns true if the file should skip PDF-based rendering.
 */
export async function isAiWithoutPdfCompat(filePath: string): Promise<boolean> {
  try {
    return await isAiSentinel(filePath);
  } catch {
    return false;
  }
}

/**
 * Create a long-lived Tesseract worker for compat-audit batch processing.
 * Caller is responsible for calling worker.terminate() when done.
 */
export async function createCompatAuditWorker() {
  return createWorker("eng");
}

/**
 * Checks whether a stored thumbnail URL visually shows an Illustrator
 * compatibility-alert warning page (the "no PDF compatibility" notice)
 * rather than real artwork.
 *
 * Strategy: OCR the thumbnail and look for the word "compatibility", which
 * Illustrator's warning page always contains prominently. Real artwork
 * thumbnails virtually never include that word.
 *
 * Returns false conservatively on fetch/OCR errors — better to miss one
 * than to accidentally clear a good thumbnail.
 *
 * Pass a pre-created worker (createCompatAuditWorker) to avoid reloading
 * the language model for every image in a batch.
 */
export async function isCompatAlertThumbnail(
  thumbnailUrl: string,
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<boolean> {
  try {
    const resp = await fetch(thumbnailUrl);
    if (!resp.ok) return false;
    const imgBuffer = Buffer.from(await resp.arrayBuffer());

    const { data: { text } } = await worker.recognize(imgBuffer);
    const lower = text.toLowerCase();

    // The Illustrator compatibility-alert page always contains "compatibility"
    // as a prominent heading. Real-artwork thumbnails never do.
    return lower.includes("compatibility");
  } catch (e) {
    logger.warn("isCompatAlertThumbnail: check failed — skipping", {
      url: thumbnailUrl,
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Generate a thumbnail for an AI file.
 * Many .ai files contain a PDF-compatible stream that sharp/poppler can read.
 */
async function findSiblingImage(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  // Priority 1: same base name + image extension
  for (const ext of IMAGE_EXTS) {
    const match = files.find(f => f.toLowerCase() === base + ext);
    if (match) return path.join(dir, match);
  }

  // Priority 2: any image file in the same directory
  const any = files.find(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
  if (any) return path.join(dir, any);

  return null;
}

async function thumbnailFromSibling(filePath: string): Promise<ThumbnailResult> {
  const siblingPath = await findSiblingImage(filePath);
  if (!siblingPath) throw new Error("no_sibling_image");

  logger.info("Using sibling image as thumbnail fallback", {
    filePath,
    siblingUsed: path.basename(siblingPath),
  });

  const siblingBuffer = await readFile(siblingPath);
  const resized = sharp(siblingBuffer)
    .flatten({ background: "#ffffff" })
    .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
  const buffer = await withTimeout(resized.jpeg({ quality: 85 }).toBuffer(), SHARP_TIMEOUT_MS, "sibling.toBuffer");
  const meta = await withTimeout(sharp(buffer).metadata(), SHARP_TIMEOUT_MS, "sibling.meta");
  return {
    buffer,
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

async function thumbnailAiGhostscript(filePath: string): Promise<ThumbnailResult> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-gs-"));
  const outPath = path.join(tmpDir, "thumb.png");
  try {
    await execFileAsync("gs", [
      "-dNOPAUSE", "-dBATCH", "-dSAFER",
      "-sDEVICE=png16m",
      `-r150`,
      "-dFirstPage=1", "-dLastPage=1",
      `-sOutputFile=${outPath}`,
      filePath,
    ], { timeout: 60_000 });

    const resized = sharp(outPath)
      .flatten({ background: "#ffffff" })
      .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
    const buffer = await withTimeout(resized.jpeg({ quality: 85 }).toBuffer(), SHARP_TIMEOUT_MS, "gs.toBuffer");
    const meta = await withTimeout(sharp(buffer).metadata(), SHARP_TIMEOUT_MS, "gs.meta");
    return {
      buffer,
      width: meta.width || 0,
      height: meta.height || 0,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((e) => {
      logger.warn("Failed to clean up Ghostscript temp dir", { tmpDir, error: (e as Error).message });
    });
  }
}

async function thumbnailAi(filePath: string): Promise<ThumbnailResult> {
  // Pre-flight: detect AI files saved without PDF compatibility.
  // These produce a /CompatibilityAlert page when rendered — a warning notice, not artwork.
  // Skip all PDF-based methods and attempt sibling fallback only.
  let skipPdfRendering = false;
  try {
    skipPdfRendering = await isAiWithoutPdfCompat(filePath);
  } catch (e) {
    logger.warn("AI compat pre-check failed, proceeding with normal render", { filePath, error: (e as Error).message });
  }

  if (skipPdfRendering) {
    logger.warn("AI file has no PDF compatibility — skipping PDF rendering to avoid placeholder thumbnail", { filePath });
    try {
      return await thumbnailFromSibling(filePath);
    } catch {
      // No sibling found either
    }
    throw new Error("no_pdf_compat");
  }

  // Step 1: Try sharp (PDF-compatible .ai files)
  try {
    const aiBuffer = await readFile(filePath);
    const img = sharp(aiBuffer, { density: 150 }).flatten({ background: "#ffffff" });
    const resized = img.resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
    const buffer = await withTimeout(resized.jpeg({ quality: 85 }).toBuffer(), SHARP_TIMEOUT_MS, "ai.toBuffer");
    const meta = await withTimeout(sharp(buffer).metadata(), SHARP_TIMEOUT_MS, "ai.meta");
    return {
      buffer,
      width: meta.width || 0,
      height: meta.height || 0,
    };
  } catch (e) {
    logger.warn("AI sharp PDF-compat failed, trying Ghostscript", { filePath, error: (e as Error).message });
  }

  // Step 2: Try Ghostscript directly
  try {
    return await thumbnailAiGhostscript(filePath);
  } catch (e) {
    logger.warn("AI Ghostscript rendering failed", { filePath, error: (e as Error).message });
  }

  // Step 3: Try sibling image in same directory
  try {
    return await thumbnailFromSibling(filePath);
  } catch (e) {
    logger.warn("No sibling image found", { filePath });
  }

  throw new Error("no_pdf_compat");
}

/**
 * Generate a thumbnail for a PDF file.
 * Renders page 1 as an 800px thumbnail + 1500px hi-res images for pages 1-2.
 */
async function thumbnailPdf(filePath: string): Promise<PdfThumbnailResult> {
  const PDF_HIRES_DIM = 1500;
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-pdf-"));

  try {
    // Render first 2 pages at 200 DPI via Ghostscript
    await execFileAsync("gs", [
      "-dNOPAUSE", "-dBATCH", "-dSAFER",
      "-sDEVICE=png16m",
      "-r200",
      "-dFirstPage=1", "-dLastPage=2",
      `-sOutputFile=${path.join(tmpDir, "page-%d.png")}`,
      filePath,
    ], { timeout: 90_000 });

    // Read page 1 output
    const page1Path = path.join(tmpDir, "page-1.png");
    const page1Img = sharp(page1Path).flatten({ background: "#ffffff" });

    // 800px thumbnail (standard UI size)
    const thumbBuffer = await withTimeout(
      page1Img.clone().resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer(),
      SHARP_TIMEOUT_MS, "pdf.thumb"
    );
    const thumbMeta = await withTimeout(sharp(thumbBuffer).metadata(), SHARP_TIMEOUT_MS, "pdf.thumbMeta");

    // 1500px hi-res page 1 (for AI/OCR)
    const hiresPage1Buffer = await withTimeout(
      page1Img.clone().resize(PDF_HIRES_DIM, PDF_HIRES_DIM, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 }).toBuffer(),
      SHARP_TIMEOUT_MS, "pdf.hires1"
    );

    const result: PdfThumbnailResult = {
      buffer: thumbBuffer,
      width: thumbMeta.width || 0,
      height: thumbMeta.height || 0,
      hiresPage1Buffer,
    };

    // Try page 2 (may not exist for single-page PDFs)
    const page2Path = path.join(tmpDir, "page-2.png");
    try {
      const page2Img = sharp(page2Path).flatten({ background: "#ffffff" });
      const hiresPage2Buffer = await withTimeout(
        page2Img.resize(PDF_HIRES_DIM, PDF_HIRES_DIM, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 90 }).toBuffer(),
        SHARP_TIMEOUT_MS, "pdf.hires2"
      );
      const p2Meta = await withTimeout(sharp(hiresPage2Buffer).metadata(), SHARP_TIMEOUT_MS, "pdf.hires2Meta");
      result.hiresPage2Buffer = hiresPage2Buffer;
      result.hiresPage2Width = p2Meta.width || 0;
      result.hiresPage2Height = p2Meta.height || 0;
    } catch {
      logger.debug("PDF has only 1 page (no page 2)", { filePath });
    }

    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((e) => {
      logger.warn("Failed to clean up PDF temp dir", { tmpDir, error: (e as Error).message });
    });
  }
}

/**
 * Returns true when a rendered thumbnail buffer is nearly pure white —
 * indicating a structurally empty file (e.g. a die-line template with
 * only hairline strokes, or a blank placeholder).
 *
 * Thresholds: all channels have mean > 250 and std < 6. Conservative
 * enough that any visible artwork (even a thin border on white) passes.
 */
export async function isBlankThumbnail(buffer: Buffer): Promise<boolean> {
  try {
    const stats = await sharp(buffer).stats();
    return stats.channels.every(ch => ch.mean > 250 && ch.stdev < 6);
  } catch {
    return false; // conservative: don't reject on stats failure
  }
}

/**
 * Main entry: generate thumbnail based on file type.
 */
export async function generateThumbnail(
  filePath: string,
  fileType: "psd" | "ai" | "pdf",
): Promise<ThumbnailResult | PdfThumbnailResult> {
  if (fileType === "psd") return thumbnailPsd(filePath);
  if (fileType === "ai") {
    const result = await thumbnailAi(filePath);
    if (await isBlankThumbnail(result.buffer)) {
      logger.warn("AI thumbnail is blank — likely a die-line or empty template", { filePath });
      throw new Error("blank_render");
    }
    return result;
  }
  if (fileType === "pdf") return thumbnailPdf(filePath);
  throw new Error(`Unsupported file type: ${fileType}`);
}
