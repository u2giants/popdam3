/**
 * Multi-strategy renderer for the Windows Render Agent.
 *
 * Fallback chain:
 *   1. Sharp        — fast, handles PDF-compat .ai and most .psd
 *   2. Ghostscript  — complex .ai that Sharp can't read
 *   3. Sibling image — any .jpg/.png in same folder with matching name
 *
 * No Illustrator COM — this agent uses the same rendering tools
 * as the Bridge Agent (Sharp + Ghostscript).
 */

import sharp from "sharp";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const THUMB_MAX_DIM = 800;

export interface RenderResult {
  buffer: Buffer;
  width: number;
  height: number;
}

// ── Ghostscript path discovery ──────────────────────────────────

function findGhostscript(): string {
  if (process.env.GS_PATH) return process.env.GS_PATH;

  const gsRoot = "C:\\Program Files\\gs";
  try {
    const versions = readdirSync(gsRoot)
      .filter((d: string) => d.startsWith("gs"))
      .sort()
      .reverse(); // newest first
    for (const v of versions) {
      const candidate = `${gsRoot}\\${v}\\bin\\gswin64c.exe`;
      if (existsSync(candidate)) {
        logger.info("Found Ghostscript", { path: candidate });
        return candidate;
      }
    }
  } catch {
    /* gs directory not found — will try PATH */
  }

  logger.warn(
    "Ghostscript not found in Program Files\\gs, " +
    "falling back to PATH. Install from ghostscript.com " +
    "or set GS_PATH env var."
  );
  return "gswin64c"; // hope it's on PATH
}

const GS_EXE = findGhostscript();

// ── ImageMagick path discovery ──────────────────────────────────

function findImageMagick(): string | null {
  if (process.env.IM_PATH) return process.env.IM_PATH;

  const candidates = [
    "C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.0-Q16\\magick.exe",
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      logger.info("Found ImageMagick", { path: c });
      return c;
    }
  }

  try {
    execFileSync("magick", ["--version"], { timeout: 5000 });
    logger.info("Found ImageMagick on PATH");
    return "magick";
  } catch {
    logger.warn(
      "ImageMagick not found. Install from imagemagick.org " +
      "or set IM_PATH env var. PSD fallback will be unavailable."
    );
    return null;
  }
}

const IM_EXE = findImageMagick();

// ── Step 1: Sharp ───────────────────────────────────────────────

async function renderWithSharp(
  filePath: string,
  fileType: "ai" | "psd",
): Promise<RenderResult> {
  const options: sharp.SharpOptions = fileType === "ai"
    ? { density: 150 }
    : { pages: -1 }; // -1 = composite all PSD layers

  const img = sharp(filePath, options)
    .flatten({ background: "#ffffff" });

  const resized = img.resize(
    THUMB_MAX_DIM, THUMB_MAX_DIM,
    { fit: "inside", withoutEnlargement: true },
  );

  const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
  const meta = await sharp(buffer).metadata();

  return {
    buffer,
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

// ── Step 2: Ghostscript ─────────────────────────────────────────

async function renderWithGhostscript(
  filePath: string,
): Promise<RenderResult> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-gs-"));
  const outPath = path.join(tmpDir, "thumb.png");

  try {
    await execFileAsync(GS_EXE, [
      "-dNOPAUSE", "-dBATCH", "-dSAFER",
      "-sDEVICE=png16m",
      "-r150",
      "-dFirstPage=1", "-dLastPage=1",
      `-sOutputFile=${outPath}`,
      filePath,
    ], { timeout: 60_000 });

    const resized = sharp(outPath)
      .flatten({ background: "#ffffff" })
      .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, {
        fit: "inside",
        withoutEnlargement: true,
      });

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

// ── Step 2b: ImageMagick (PSD) ──────────────────────────────────

async function renderWithImageMagick(
  filePath: string,
): Promise<RenderResult> {
  if (!IM_EXE) throw new Error("ImageMagick not installed");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-im-"));
  const outPath = path.join(tmpDir, "thumb.jpg");

  try {
    // [0] = first/merged layer, -flatten removes transparency
    await execFileAsync(IM_EXE, [
      "-flatten",
      "-background", "white",
      `${filePath}[0]`,
      "-resize", `${THUMB_MAX_DIM}x${THUMB_MAX_DIM}>`,
      "-quality", "85",
      outPath,
    ], { timeout: 120_000 }); // PSDs can be slow

    if (!existsSync(outPath)) {
      throw new Error("ImageMagick produced no output");
    }

    const buffer = await sharp(outPath).jpeg({ quality: 85 }).toBuffer();
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

// ── Step 3: Sibling image ───────────────────────────────────────

async function renderFromSibling(
  filePath: string,
): Promise<RenderResult> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    throw new Error("cannot read directory");
  }

  // Prefer exact name match first
  for (const ext of IMAGE_EXTS) {
    const match = files.find(
      (f) => f.toLowerCase() === base + ext,
    );
    if (match) {
      const siblingPath = path.join(dir, match);
      logger.info("Using sibling image", { filePath, sibling: match });

      const buffer = await sharp(siblingPath)
        .flatten({ background: "#ffffff" })
        .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      const meta = await sharp(buffer).metadata();
      return {
        buffer,
        width: meta.width || 0,
        height: meta.height || 0,
      };
    }
  }

  throw new Error("no_sibling_image");
}

// ── Main entry: full fallback chain ─────────────────────────────

export async function renderFile(
  uncPath: string,
  fileType: "ai" | "psd",
): Promise<RenderResult> {
  // Step 1: Sharp (both AI and PSD)
  try {
    const result = await renderWithSharp(uncPath, fileType);
    logger.info("Sharp render succeeded", { uncPath });
    return result;
  } catch (e) {
    logger.warn("Sharp failed", { uncPath, error: (e as Error).message });
  }

  // Step 2a: Ghostscript (AI only — GS doesn't handle PSD)
  if (fileType === "ai") {
    try {
      const result = await renderWithGhostscript(uncPath);
      logger.info("Ghostscript render succeeded", { uncPath });
      return result;
    } catch (e) {
      logger.warn("Ghostscript failed", { uncPath, error: (e as Error).message });
    }
  }

  // Step 2b: ImageMagick (PSD only — handles 16-bit, smart objects, complex layers)
  if (fileType === "psd") {
    try {
      const result = await renderWithImageMagick(uncPath);
      logger.info("ImageMagick render succeeded", { uncPath });
      return result;
    } catch (e) {
      logger.warn("ImageMagick failed", { uncPath, error: (e as Error).message });
    }
  }

  // Step 3: Sibling image (both AI and PSD)
  try {
    const result = await renderFromSibling(uncPath);
    logger.info("Sibling render succeeded", { uncPath });
    return result;
  } catch (e) {
    logger.warn("Sibling not found", { uncPath });
  }

  throw new Error("render_failed: all methods exhausted (Sharp + Ghostscript/ImageMagick + sibling)");
}
