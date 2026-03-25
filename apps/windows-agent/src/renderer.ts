/**
 * Multi-strategy renderer for the Windows Render Agent.
 *
 * Fallback chain for AI files:
 *   1. Sharp        — fast, handles PDF-compat .ai
 *   2. Ghostscript  — complex .ai that Sharp can't read
 *   3. Poppler      — alternative PDF engine (pdftoppm), handles GS edge-cases
 *   4. Inkscape     — independent engine (no PDF dependency), handles Adobe-specific .ai
 *   5. Sibling image — any .jpg/.png in same folder with matching name
 *
 * Fallback chain for PSD files:
 *   1. Sharp        — fast, handles most .psd
 *   2. ImageMagick  — 16-bit, smart objects, complex layers
 *   3. Sibling image — any .jpg/.png in same folder with matching name
 *
 * Inkscape is NOT used for PSD (it doesn't read PSD natively).
 * ImageMagick is NOT used for AI (it delegates to Ghostscript internally,
 * so it would fail on the same files GS already failed on).
 * Poppler is NOT used for PSD (it is a PDF engine only).
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
const PDF_HIRES_DIM = 1500;

export interface RenderResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface PdfRenderResult extends RenderResult {
  hiresPage1Buffer: Buffer;
  hiresPage2Buffer?: Buffer;
  hiresPage2Width?: number;
  hiresPage2Height?: number;
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

  // Dynamically scan Program Files for any ImageMagick-* installation
  const programFiles = "C:\\Program Files";
  try {
    const entries = readdirSync(programFiles)
      .filter((d: string) => d.startsWith("ImageMagick-"))
      .sort()
      .reverse(); // newest first
    for (const entry of entries) {
      const candidate = `${programFiles}\\${entry}\\magick.exe`;
      if (existsSync(candidate)) {
        logger.info("Found ImageMagick", { path: candidate });
        return candidate;
      }
    }
  } catch {
    /* Program Files not accessible */
  }

  // Fall back to PATH
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

// ── Poppler path discovery ───────────────────────────────────────

function findPoppler(): string | null {
  // POPPLER_PATH may point to the pdftoppm binary directly, or to the bin/ directory
  if (process.env.POPPLER_PATH) {
    const p = process.env.POPPLER_PATH;
    const exe = p.toLowerCase().endsWith("pdftoppm.exe") ? p : path.join(p, "pdftoppm.exe");
    if (existsSync(exe)) {
      logger.info("Found Poppler (pdftoppm) via POPPLER_PATH", { path: exe });
      return exe;
    }
    logger.warn("POPPLER_PATH set but pdftoppm.exe not found there", { POPPLER_PATH: p });
  }

  // Scan common Windows install locations
  const candidates: string[] = [];

  // Extracted release zips from github.com/oschwartz10612/poppler-windows
  const programFiles = "C:\\Program Files";
  const localAppData = process.env.LOCALAPPDATA || "";
  const programData = process.env.ProgramData || "C:\\ProgramData";
  const userProfile = process.env.USERPROFILE || "";

  try {
    for (const root of [programFiles, "C:\\poppler", "C:\\tools\\poppler"]) {
      try {
        readdirSync(root)
          .filter((d) => d.toLowerCase().startsWith("poppler"))
          .sort().reverse()
          .forEach((d) => candidates.push(path.join(root, d, "Library", "bin", "pdftoppm.exe")));
      } catch { /* not found */ }
    }
  } catch { /* ignore */ }

  // Conda environments
  for (const base of [
    path.join(programData, "miniconda3", "Library", "bin"),
    path.join(programData, "anaconda3", "Library", "bin"),
    path.join(localAppData, "miniconda3", "Library", "bin"),
    path.join(localAppData, "anaconda3", "Library", "bin"),
    path.join(userProfile, "miniconda3", "Library", "bin"),
    path.join(userProfile, "anaconda3", "Library", "bin"),
  ]) {
    candidates.push(path.join(base, "pdftoppm.exe"));
  }

  for (const c of candidates) {
    if (existsSync(c)) {
      logger.info("Found Poppler (pdftoppm)", { path: c });
      return c;
    }
  }

  // Fall back to PATH
  try {
    execFileSync("pdftoppm", ["-v"], { timeout: 5000 });
    logger.info("Found Poppler (pdftoppm) on PATH");
    return "pdftoppm";
  } catch {
    logger.warn(
      "Poppler not found. Download from github.com/oschwartz10612/poppler-windows " +
      "or install via `choco install poppler`. AI fallback rendering will skip Poppler."
    );
    return null;
  }
}

const POPPLER_EXE = findPoppler();

// ── Step 1: Sharp ───────────────────────────────────────────────

async function renderWithSharp(
  filePath: string,
  fileType: "ai" | "psd",
): Promise<RenderResult> {
  const options: sharp.SharpOptions = fileType === "ai"
    ? { density: 150 }
    : { pages: -1 }; // -1 = composite all PSD layers

  const img = sharp(filePath, { ...options, limitInputPixels: false })
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

    const resized = sharp(outPath, { limitInputPixels: false })
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

    const resized = sharp(outPath, { limitInputPixels: false })
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

// ── Step 2c: Poppler/pdftoppm (AI only — alternative PDF engine) ─

async function renderWithPoppler(
  filePath: string,
): Promise<RenderResult> {
  if (!POPPLER_EXE) throw new Error("Poppler not installed");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-poppler-"));
  const outPrefix = path.join(tmpDir, "thumb");

  try {
    // pdftoppm renders the first page of the PDF stream embedded in the .ai file.
    // Output files are named <prefix>-<N>.jpg (zero-padded based on total pages).
    await execFileAsync(POPPLER_EXE, [
      "-r", "150",
      "-jpeg",
      "-jpegopt", "quality=85",
      "-f", "1",
      "-l", "1",
      filePath,
      outPrefix,
    ], { timeout: 60_000 });

    // Find the output file — naming varies (thumb-1.jpg or thumb-01.jpg, etc.)
    const files = (await readdir(tmpDir)).filter((f) => f.endsWith(".jpg") || f.endsWith(".jpeg"));
    if (files.length === 0) throw new Error("Poppler produced no output");

    const outFile = path.join(tmpDir, files[0]);

    const resized = sharp(outFile, { limitInputPixels: false })
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

// ── Step 2d: ImageMagick (PSD) ──────────────────────────────────

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

    const buffer = await sharp(outPath, { limitInputPixels: false }).jpeg({ quality: 85 }).toBuffer();
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

  // Step 2c: Poppler/pdftoppm (AI only — different PDF engine, handles GS edge-cases)
  if (fileType === "ai") {
    try {
      const result = await renderWithPoppler(uncPath);
      logger.info("Poppler render succeeded", { uncPath });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      failures.push(`poppler: ${msg}`);
      logger.warn("Poppler failed", { uncPath, error: msg });
    }
  }

  // Step 2d: Inkscape (AI only — independent engine, no PDF dependency)
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

  // Step 2e: ImageMagick (PSD only — handles 16-bit, smart objects, complex layers)
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
