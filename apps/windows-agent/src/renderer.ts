/**
 * Multi-strategy renderer for the Windows Render Agent.
 *
 * Fallback chain:
 *   1. Sharp        — fast, handles PDF-compat .ai and most .psd
 *   2. Ghostscript  — complex .ai that Sharp can't read
 *   3. Sibling image — any .jpg/.png in same folder with matching name
 *   4. Illustrator COM — last resort, only for .ai files
 *
 * Per PROJECT_BIBLE §1C: Windows agent is Optional Muscle #2.
 */

import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";
import { renderWithIllustrator } from "./illustrator";

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
  // NAS mapping is handled centrally by ensureNasMapped() in preflight/startup.
  // All paths (drive-letter or UNC) are already accessible when we get here.

  // Step 1: Sharp
  try {
    const result = await renderWithSharp(uncPath, fileType);
    logger.info("Sharp render succeeded", { uncPath });
    return result;
  } catch (e) {
    logger.warn("Sharp failed", { uncPath, error: (e as Error).message });
  }

  // Step 2: Ghostscript (AI only — GS doesn't handle PSD)
  if (fileType === "ai") {
    try {
      const result = await renderWithGhostscript(uncPath);
      logger.info("Ghostscript render succeeded", { uncPath });
      return result;
    } catch (e) {
      logger.warn("Ghostscript failed", { uncPath, error: (e as Error).message });
    }
  }

  // Step 3: Sibling image
  try {
    const result = await renderFromSibling(uncPath);
    logger.info("Sibling render succeeded", { uncPath });
    return result;
  } catch (e) {
    logger.warn("Sibling not found", { uncPath });
  }

  // Step 4: Illustrator COM (AI only, last resort)
  if (fileType === "ai") {
    logger.info(
      "Falling back to Illustrator COM — Sharp and Ghostscript both failed",
      { uncPath },
    );
    return await renderWithIllustrator(uncPath);
  }

  throw new Error("render_failed: all methods exhausted");
}
