/**
 * Style Guide Folder Crawler — Phase 1
 *
 * Recursively walks configured style guide NAS directories, records every
 * file it finds, and posts results to admin-api in batches.
 *
 * Read-only: no file opens, no thumbnails — only readdir + lstat.
 * Follows the claim/complete pattern used by sibling scans.
 */

import { readdir, lstat } from "node:fs/promises";
import { basename, extname, resolve, posix } from "node:path";
import { logger } from "./logger.js";
import * as api from "./api-client.js";

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
  parent_folder: string;
  grandparent_folder: string | null;
  normalized_name: string;
  normalized_parent_folder: string;
  size_bytes: number | null;
  modified_at: string | null;
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
      const parentFolder = segments.length > 0 ? segments[segments.length - 1] : rootLabel;
      const grandparentFolder = segments.length > 1 ? segments[segments.length - 2] : null;

      const ext = extname(entry.name);
      const basenameNoExt = basename(entry.name, ext);
      const fileExtension = ext ? ext.slice(1).toLowerCase() : null;

      yield {
        root_label: rootLabel,
        relative_path: relPath,
        directory_path: dirRelPath || ".",
        filename: entry.name,
        basename_no_ext: basenameNoExt,
        file_extension: fileExtension,
        parent_folder: parentFolder,
        grandparent_folder: grandparentFolder,
        normalized_name: normalizeName(basenameNoExt),
        normalized_parent_folder: normalizeName(parentFolder),
        size_bytes: stats.size,
        modified_at: stats.mtime.toISOString(),
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

  try {
    for (const root of roots) {
      const resolvedRoot = resolve(root);
      const rootLabel = basename(resolvedRoot);

      // Verify root exists
      try {
        const s = await lstat(resolvedRoot);
        if (!s.isDirectory()) {
          logger.warn("Style guide crawl: root is not a directory", { root });
          continue;
        }
      } catch (e) {
        logger.warn("Style guide crawl: root inaccessible", {
          root, error: (e as Error).message,
        });
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
    await api.completeStyleGuideCrawl(runId, batch, true, totalFiles);
    logger.info("Style guide crawl completed", { totalFiles });

  } catch (e) {
    const errorMsg = (e as Error).message;
    logger.error("Style guide crawl failed", { error: errorMsg });
    try {
      await api.completeStyleGuideCrawl(runId, [], true, totalFiles, errorMsg);
    } catch (e2) {
      logger.error("Style guide crawl: failed to report error", { error: (e2 as Error).message });
    }
  }
}
