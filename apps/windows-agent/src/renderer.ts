/**
 * Multi-strategy renderer for the Windows Render Agent.
 *
 * Fallback chain for AI files:
 *   1. Sharp        — fast, handles PDF-compat .ai
 *   2. Ghostscript  — complex .ai that Sharp can't read
 *   3. Inkscape     — independent engine (no GS dependency), handles Adobe-specific .ai
 *   4. Sibling image — any .jpg/.png in same folder with matching name
 *
 * Fallback chain for PSD files:
 *   1. Sharp        — fast, handles most .psd
 *   2. ImageMagick  — 16-bit, smart objects, complex layers
 *   3. Sibling image — any .jpg/.png in same folder with matching name
 *
 * Inkscape is NOT used for PSD (it doesn't read PSD natively).
 * ImageMagick is NOT used for AI (it delegates to Ghostscript internally,
 * so it would fail on the same files GS already failed on).
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

// ── Inkscape path discovery ─────────────────────────────────────

function findInkscape(): string | null {
  if (process.env.INKSCAPE_PATH) return process.env.INKSCAPE_PATH;

  const candidates = [
    "C:\\Program Files\\Inkscape\\bin\\inkscape.exe",
    "C:\\Program Files\\Inkscape\\inkscape.exe",
    "C:\\Program Files (x86)\\Inkscape\\bin\\inkscape.exe",
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      logger.info("Found Inkscape", { path: c });
      return c;
    }
  }

  try {
    execFileSync("inkscape", ["--version"], { timeout: 10000 });
    logger.info("Found Inkscape on PATH");
    return "inkscape";
  } catch {
    logger.warn(
      "Inkscape not found. Install from inkscape.org " +
      "or set INKSCAPE_PATH env var. AI fallback rendering will be limited."
    );
    return null;
  }
}

const INKSCAPE_EXE = findInkscape();

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

// ── Step 2a: Ghostscript ────────────────────────────────────────

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

// ── Step 2b: Inkscape (AI only — independent engine, no GS dependency) ──

async function renderWithInkscape(
  filePath: string,
): Promise<RenderResult> {
  if (!INKSCAPE_EXE) throw new Error("Inkscape not installed");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-ink-"));
  const outPath = path.join(tmpDir, "thumb.png");

  try {
    // Inkscape 1.x CLI: export to PNG
    // --export-area-drawing = crop to content (no whitespace)
    // --export-dpi=150 = matches our GS resolution
    await execFileAsync(INKSCAPE_EXE, [
      filePath,
      "--export-type=png",
      `--export-filename=${outPath}`,
      "--export-area-drawing",
      "--export-dpi=150",
    ], { timeout: 90_000 }); // Inkscape can be slow on first launch

    if (!existsSync(outPath)) {
      throw new Error("Inkscape produced no output");
    }

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

// ── Step 2c: ImageMagick (PSD) ──────────────────────────────────

async function renderWithImageMagick(
  filePath: string,
): Promise<RenderResult> {
  if (!IM_EXE) throw new Error("ImageMagick not installed");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-im-"));
  const outPath = path.join(tmpDir, "thumb.jpg");

  try {
    // Put input first so ImageMagick has an image list before -flatten
    await execFileAsync(IM_EXE, [
      `${filePath}[0]`,
      "-background", "white",
      "-flatten",
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
  const failures: string[] = [];

  // Step 1: Sharp (both AI and PSD)
  try {
    const result = await renderWithSharp(uncPath, fileType);
    logger.info("Sharp render succeeded", { uncPath });
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    failures.push(`sharp: ${msg}`);
    logger.warn("Sharp failed", { uncPath, error: msg });
  }

  // Step 2a: Ghostscript (AI only — GS doesn't handle PSD)
  if (fileType === "ai") {
    try {
      const result = await renderWithGhostscript(uncPath);
      logger.info("Ghostscript render succeeded", { uncPath });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      failures.push(`ghostscript: ${msg}`);
      logger.warn("Ghostscript failed", { uncPath, error: msg });
    }
  }

  // Step 2b: Inkscape (AI only — independent engine, does NOT use Ghostscript)
  if (fileType === "ai") {
    try {
      const result = await renderWithInkscape(uncPath);
      logger.info("Inkscape render succeeded", { uncPath });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      failures.push(`inkscape: ${msg}`);
      logger.warn("Inkscape failed", { uncPath, error: msg });
    }
  }

  // Step 2c: ImageMagick (PSD only — handles 16-bit, smart objects, complex layers)
  // NOTE: ImageMagick is NOT used for .ai because it delegates to Ghostscript
  // internally, so it would fail on the same files GS already failed on.
  if (fileType === "psd") {
    try {
      const result = await renderWithImageMagick(uncPath);
      logger.info("ImageMagick render succeeded", { uncPath });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      failures.push(`imagemagick: ${msg}`);
      logger.warn("ImageMagick failed", { uncPath, error: msg });
    }
  }

  // Step 3: Sibling image (both AI and PSD)
  try {
    const result = await renderFromSibling(uncPath);
    logger.info("Sibling render succeeded", { uncPath });
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    failures.push(`sibling: ${msg}`);
    logger.warn("Sibling not found", { uncPath });
  }

  throw new Error(`render_failed: ${failures.join(" | ")}`);
}
