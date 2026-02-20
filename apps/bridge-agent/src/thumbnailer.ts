/**
 * Thumbnail generation per WORKER_LOGIC §5.
 *
 * PSD: Sharp reads PSD directly (flattened composite).
 * AI files:
 *   1) Try PDF-compat rendering via sharp (many .ai files are valid PDF)
 *   2) If fails, set thumbnail_error = "no_pdf_compat" and queue for Windows Render Agent
 */

import sharp from "sharp";
import { logger } from "./logger.js";

const THUMB_MAX_DIM = 800; // px

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Generate a thumbnail for a PSD file.
 * Sharp can read PSD files directly (flattened composite).
 */
async function thumbnailPsd(filePath: string): Promise<ThumbnailResult> {
  try {
    const img = sharp(filePath, { pages: -1 }).flatten({ background: "#ffffff" });
    const meta = await img.metadata();
    const resized = img.resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
    const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
    const outMeta = await sharp(buffer).metadata();
    return {
      buffer,
      width: outMeta.width || meta.width || 0,
      height: outMeta.height || meta.height || 0,
    };
  } catch (e) {
    logger.warn("Sharp PSD fallback failed", { filePath, error: (e as Error).message });
  }

  throw new Error("no_preview_or_render_failed");
}

/**
 * Generate a thumbnail for an AI file.
 * Many .ai files contain a PDF-compatible stream that sharp/poppler can read.
 */
async function thumbnailAi(filePath: string): Promise<ThumbnailResult> {
  // AI files that are PDF-compatible can be read by sharp
  try {
    const img = sharp(filePath, { density: 150 }).flatten({ background: "#ffffff" });
    const resized = img.resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true });
    const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      width: meta.width || 0,
      height: meta.height || 0,
    };
  } catch (e) {
    logger.warn("AI PDF-compat rendering failed", { filePath, error: (e as Error).message });
  }

  throw new Error("no_pdf_compat");
}

/**
 * Main entry: generate thumbnail based on file type.
 */
export async function generateThumbnail(
  filePath: string,
  fileType: "psd" | "ai",
): Promise<ThumbnailResult> {
  if (fileType === "psd") return thumbnailPsd(filePath);
  if (fileType === "ai") return thumbnailAi(filePath);
  throw new Error(`Unsupported file type: ${fileType}`);
}
