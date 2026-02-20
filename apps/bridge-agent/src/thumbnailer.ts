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
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

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
    const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      width: meta.width || 0,
      height: meta.height || 0,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function thumbnailAi(filePath: string): Promise<ThumbnailResult> {
  // Step 1: Try sharp (PDF-compatible .ai files)
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
    logger.warn("AI sharp PDF-compat failed, trying Ghostscript", { filePath, error: (e as Error).message });
  }

  // Step 2: Try Ghostscript directly
  try {
    return await thumbnailAiGhostscript(filePath);
  } catch (e) {
    logger.warn("AI Ghostscript rendering failed", { filePath, error: (e as Error).message });
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
