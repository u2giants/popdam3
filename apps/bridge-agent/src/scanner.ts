/**
 * Filesystem scanner per WORKER_LOGIC §4.
 *
 * - Validates roots at startup (fail-fast)
 * - Does NOT follow symlinks
 * - Tracks counters for all error conditions
 * - Yields file candidates (.psd, .ai) with stat info
 */

import { readdir, stat, lstat } from "node:fs/promises";
import { join, extname, basename, relative } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Counters } from "./api-client.js";

const SUPPORTED_EXTENSIONS = new Set([".psd", ".ai"]);

export interface FileCandidate {
  absolutePath: string;
  relativePath: string; // POSIX canonical (no leading slash)
  filename: string;
  fileType: "psd" | "ai";
  fileSize: number;
  modifiedAt: Date;
  fileCreatedAt: Date | null;
}

/**
 * Validate that all configured scan roots exist and are readable directories.
 * Per WORKER_LOGIC §4.1: refuse to scan if any root is invalid.
 */
export async function validateScanRoots(counters: Counters, scanRoots?: string[], mountRoot?: string): Promise<boolean> {
  const roots = scanRoots ?? config.scanRoots;
  const effectiveMountRoot = mountRoot || config.nasContainerMountRoot;
  let allValid = true;

  for (const root of roots) {
    // Validate against NAS_CONTAINER_MOUNT_ROOT
    if (!root.startsWith(effectiveMountRoot)) {
      logger.error("Scan root is outside NAS_CONTAINER_MOUNT_ROOT", { root, mountRoot: effectiveMountRoot });
      counters.roots_invalid++;
      allValid = false;
      continue;
    }

    try {
      const s = await stat(root);
      if (!s.isDirectory()) {
        logger.error("Scan root is not a directory", { root });
        counters.roots_invalid++;
        allValid = false;
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        logger.error("Scan root does not exist", { root });
        counters.roots_invalid++;
      } else if (code === "EACCES") {
        logger.error("Scan root is not readable", { root });
        counters.roots_unreadable++;
      } else {
        logger.error("Scan root stat failed", { root, error: (e as Error).message });
        counters.roots_invalid++;
      }
      allValid = false;
    }
  }

  return allValid;
}

/**
 * Recursively scan directories and yield file candidates.
 * Per WORKER_LOGIC §4.2: do NOT follow symlinks.
 */
export interface ScanCallbacks {
  shouldAbort?: () => boolean;
  onDir?: (dirPath: string) => void;
}

export async function* scanFiles(
  counters: Counters,
  scanRoots?: string[],
  callbacks?: ScanCallbacks,
): AsyncGenerator<FileCandidate> {
  const roots = scanRoots ?? config.scanRoots;
  for (const root of roots) {
    if (callbacks?.shouldAbort?.()) return;
    yield* scanDirectory(root, counters, callbacks);
  }
}

async function* scanDirectory(
  dirPath: string,
  counters: Counters,
  callbacks?: ScanCallbacks,
): AsyncGenerator<FileCandidate> {
  if (callbacks?.shouldAbort?.()) return;
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
    callbacks?.onDir?.(dirPath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES") {
      counters.dirs_skipped_permission++;
      logger.warn("Directory not readable, skipping", { dirPath });
    } else {
      logger.warn("Failed to read directory", { dirPath, error: (e as Error).message });
    }
    return;
  }

  for (const entry of entries) {
    if (callbacks?.shouldAbort?.()) return;

    const fullPath = join(dirPath, entry.name);

    // §4.2: Do NOT follow symlinks
    try {
      const ls = await lstat(fullPath);
      if (ls.isSymbolicLink()) continue;
    } catch {
      counters.files_stat_failed++;
      continue;
    }

    if (entry.isDirectory()) {
      yield* scanDirectory(fullPath, counters, callbacks);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    counters.files_checked++;

    try {
      const s = await stat(fullPath);

      // Build canonical relative path (POSIX, no leading slash) per PATH_UTILS.md §1
      let relPath = relative(config.nasContainerMountRoot, fullPath);
      relPath = relPath.split("\\").join("/"); // Ensure POSIX
      if (relPath.startsWith("/")) relPath = relPath.slice(1);

      const candidate: FileCandidate = {
        absolutePath: fullPath,
        relativePath: relPath,
        filename: basename(entry.name),
        fileType: ext === ".psd" ? "psd" : "ai",
        fileSize: s.size,
        modifiedAt: s.mtime,
        fileCreatedAt: s.birthtime || null,
      };

      counters.candidates_found++;
      yield candidate;
    } catch (e) {
      counters.files_stat_failed++;
      logger.warn("Failed to stat file", { fullPath, error: (e as Error).message });
    }
  }
}
