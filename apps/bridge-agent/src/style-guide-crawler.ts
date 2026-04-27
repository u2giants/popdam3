/**
 * Style Guide Folder Crawler
 *
 * Recursively walks configured style guide NAS directories, generates
 * thumbnails for supported image types, and posts results to agent-api
 * in batches. Follows the claim/complete pattern used by sibling scans.
 */

import { readdir, lstat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { logger } from "./logger.js";
import * as api from "./api-client.js";
import { generateThumbnail } from "./thumbnailer.js";
import { uploadStyleGuideThumbnail } from "./uploader.js";

// ── Thumbnail generation ─────────────────────────────────────────────

const THUMB_MAX_DIM = 512;
const THUMB_TIMEOUT_MS = 30_000;
const MAX_THUMB_BYTES = 50 * 1024 * 1024; // skip files > 50 MB

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"]);
const VECTOR_EXTS = new Set<"psd" | "ai" | "pdf">(["psd", "ai", "pdf"]);

function stableKey(rootLabel: string, relPath: string): string {
  return createHash("sha256").update(`${rootLabel}/${relPath}`).digest("hex").slice(0, 16);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

async function makeThumbnail(
  filePath: string,
  ext: string | null,
  sizeBytes: number | null,
): Promise<{ buffer: Buffer } | { error: string }> {
  if (!ext) return { error: "no extension" };
  const lext = ext.toLowerCase();

  if (IMAGE_EXTS.has(lext)) {
    try {
      const buffer = await withTimeout(
        sharp(filePath)
          .flatten({ background: "#ffffff" })
          .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer(),
        THUMB_TIMEOUT_MS,
      );
      return { buffer };
    } catch (e) {
      return { error: (e as Error).message.slice(0, 200) };
    }
  }

  if (VECTOR_EXTS.has(lext as "psd" | "ai" | "pdf")) {
    if (sizeBytes && sizeBytes > MAX_THUMB_BYTES) return { error: "file too large" };
    try {
      const result = await withTimeout(
        generateThumbnail(filePath, lext as "psd" | "ai" | "pdf"),
        THUMB_TIMEOUT_MS * 2,
      );
      return { buffer: result.buffer };
    } catch (e) {
      return { error: (e as Error).message.slice(0, 200) };
    }
  }

  return { error: "unsupported type" };
}

// ── Normalization ────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy matching:
 * - lowercase
 * - replace spaces, hyphens, underscores → single underscore
 * - strip non-alphanumeric (except underscores)
 * - collapse multiple underscores → single
 * - strip leading/trailing underscores
 */
export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\-_]+/g, "_")          // spaces/hyphens/underscores → _
    .replace(/[^a-z0-9_]/g, "")         // strip non-alphanumeric (keep _)
    .replace(/_+/g, "_")                // collapse multiple _
    .replace(/^_|_$/g, "");             // strip leading/trailing _
}

// ── Skip logic (mirrors path-filters but simpler) ────────────────

const SKIP_NAMES = new Set([
  ".ds_store", "thumbs.db", "desktop.ini", ".localized",
]);

const SKIP_PREFIXES = [".", "@", "#", "$"];

function shouldSkipEntry(name: string): boolean {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (SKIP_NAMES.has(lower)) return true;
  if (SKIP_PREFIXES.includes(name[0])) return true;
  if (lower === "__macosx") return true;
  return false;
}

// ── File record shape (matches DB columns) ───────────────────────

export interface StyleGuideFileRecord {
  root_label: string;
  relative_path: string;
  directory_path: string;
  filename: string;
  basename_no_ext: string;
  file_extension: string | null;
  property_folder: string | null;    // segments[1] from root — licensor's property name
  style_guide_folder: string | null; // segments[2] from root — style guide name (key field)
  normalized_name: string;
  normalized_style_guide_folder: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  thumbnail_url: string | null;
  thumbnail_error: string | null;
}

// ── Walk logic ───────────────────────────────────────────────────

async function* walkDirectory(
  dirPath: string,
  rootPath: string,
  rootLabel: string,
): AsyncGenerator<StyleGuideFileRecord> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    logger.warn("Style guide crawl: cannot read directory", {
      dir: dirPath, error: code || (e as Error).message,
    });
    return;
  }

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;

    const fullPath = resolve(dirPath, entry.name);

    // Use lstat to avoid following symlinks
    let stats;
    try {
      stats = await lstat(fullPath);
    } catch {
      continue; // skip files we can't stat
    }

    if (stats.isSymbolicLink()) continue;

    if (stats.isDirectory()) {
      yield* walkDirectory(fullPath, rootPath, rootLabel);
    } else if (stats.isFile()) {
      // Build relative path (POSIX, no leading slash)
      const relPath = fullPath
        .slice(rootPath.length)
        .replace(/\\/g, "/")
        .replace(/^\//, "");

      const dirRelPath = relPath.split("/").slice(0, -1).join("/");
      const segments = dirRelPath.split("/").filter(Boolean);
      // Top-down fixed-depth extraction:
      // segments[0] = licensor (skip — already known from SKU)
      // segments[1] = property (maybe useful for matching)
      // segments[2] = style guide name (the key identifier)
      const propertyFolder = segments.length > 1 ? segments[1] : null;
      const styleGuideFolder = segments.length > 2 ? segments[2] : null;

      const ext = extname(entry.name);
      const basenameNoExt = basename(entry.name, ext);
      const fileExtension = ext ? ext.slice(1).toLowerCase() : null;

      // Generate thumbnail for supported types; skip on any error
      let thumbnailUrl: string | null = null;
      let thumbnailError: string | null = null;
      const thumbResult = await makeThumbnail(fullPath, fileExtension, stats.size);
      if ("buffer" in thumbResult) {
        try {
          thumbnailUrl = await uploadStyleGuideThumbnail(stableKey(rootLabel, relPath), thumbResult.buffer);
        } catch (e) {
          thumbnailError = (e as Error).message.slice(0, 200);
        }
      } else if (thumbResult.error !== "unsupported type") {
        thumbnailError = thumbResult.error;
      }

      yield {
        root_label: rootLabel,
        relative_path: relPath,
        directory_path: dirRelPath || ".",
        filename: entry.name,
        basename_no_ext: basenameNoExt,
        file_extension: fileExtension,
        property_folder: propertyFolder,
        style_guide_folder: styleGuideFolder,
        normalized_name: normalizeName(basenameNoExt),
        normalized_style_guide_folder: styleGuideFolder ? normalizeName(styleGuideFolder) : null,
        size_bytes: stats.size,
        modified_at: stats.mtime.toISOString(),
        thumbnail_url: thumbnailUrl,
        thumbnail_error: thumbnailError,
      };
    }
  }
}

// ── Main crawl function ──────────────────────────────────────────

const BATCH_SIZE = 500;

export async function crawlStyleGuides(roots: string[]): Promise<void> {
  if (roots.length === 0) {
    logger.warn("Style guide crawl: no roots configured");
    return;
  }

  // 1. Claim the crawl request
  let runId: string;
  try {
    const claimResult = await api.claimStyleGuideCrawl();
    if (!claimResult) {
      logger.info("Style guide crawl: nothing to claim");
      return;
    }
    runId = claimResult.run_id;
    logger.info("Style guide crawl claimed", { runId, roots });
  } catch (e) {
    logger.error("Style guide crawl: claim failed", { error: (e as Error).message });
    return;
  }

  let totalFiles = 0;
  let batch: StyleGuideFileRecord[] = [];
  const inaccessibleRoots: string[] = [];

  try {
    for (const root of roots) {
      const resolvedRoot = resolve(root);
      const rootLabel = basename(resolvedRoot);

      // Verify root exists
      try {
        const s = await lstat(resolvedRoot);
        if (!s.isDirectory()) {
          logger.warn("Style guide crawl: root is not a directory", { root });
          inaccessibleRoots.push(root);
          continue;
        }
      } catch (e) {
        logger.warn("Style guide crawl: root inaccessible", {
          root, error: (e as Error).message,
        });
        inaccessibleRoots.push(root);
        continue;
      }

      logger.info("Style guide crawl: walking root", { root, rootLabel });

      for await (const file of walkDirectory(resolvedRoot, resolvedRoot, rootLabel)) {
        batch.push(file);
        totalFiles++;

        if (batch.length >= BATCH_SIZE) {
          await api.completeStyleGuideCrawl(runId, batch, false);
          logger.info("Style guide crawl: batch sent", { totalSoFar: totalFiles });
          batch = [];
        }
      }
    }

    // Send final batch
    await api.completeStyleGuideCrawl(runId, batch, true, totalFiles, undefined, inaccessibleRoots);
    logger.info("Style guide crawl completed", { totalFiles, inaccessibleRoots });

  } catch (e) {
    const errorMsg = (e as Error).message;
    logger.error("Style guide crawl failed", { error: errorMsg });
    try {
      await api.completeStyleGuideCrawl(runId, [], true, totalFiles, errorMsg, inaccessibleRoots);
    } catch (e2) {
      logger.error("Style guide crawl: failed to report error", { error: (e2 as Error).message });
    }
  }
}
